from fastapi import APIRouter, Depends, HTTPException, Form, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any
import json
import asyncio
from datetime import datetime
import cv2
import numpy as np
from PIL import Image
import albumentations as A
from pathlib import Path
import os
import shutil
import logging

from .. import models, schemas
from ..database import get_db

# Create logger for this module
logger = logging.getLogger(__name__)

router = APIRouter()

# COCO class names
COCO_CLASSES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake",
    "chair", "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop",
    "mouse", "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]

# Size label for tags (short code -> display)
SIZE_LABELS = {"n": "nano", "s": "small", "m": "medium", "l": "large", "x": "xlarge"}


def _auto_annotate_tags(model_name: str, task_type: str) -> List[str]:
    """Build tags for auto-annotate: auto, model type, size, and task (detection/segmentation/classification)."""
    import re
    tags = ["auto"]
    task_label = {"detect": "detection", "segment": "segmentation", "classify": "classification"}.get(
        task_type, task_type
    )
    tags.append(task_label)
    if model_name.startswith("depth_anything"):
        # e.g. depth_anything_v2_small
        parts = model_name.split("_")
        if "v2" in parts:
            tags.insert(1, "depth_anything_v2")
        else:
            tags.insert(1, "depth_anything")
        size_part = parts[-1] if parts else ""
        if size_part:
            tags.insert(2, size_part)
    else:
        # YOLO-style: yolo11n, yolo26s, yolo_nasm, rtdetrl
        match = re.match(r"(yolo11|yolo26|yolo_nas|rtdetr)([nsmlx])", model_name, re.IGNORECASE)
        if match:
            arch, size = match.group(1), match.group(2).lower()
            tags.insert(1, arch)
            tags.insert(2, SIZE_LABELS.get(size, size))
        else:
            tags.insert(1, model_name)
    return tags


# Pre-downloaded models from Docker build (same as export_tasks)
PRETRAINED_MODELS_DIR = Path("/app/models")


def load_yolo_model(model_name: str, task_id: int, task_type: str = "detect"):
    """Load YOLO model and return model object with metadata.
    
    task_type: 'detect', 'segment', or 'classify'
    Model file suffix: base name for detect, -seg for segment, -cls for classify.
    Uses pre-downloaded model from /app/models when present (from Docker build).
    """
    from ultralytics import YOLO
    
    suffix_map = {"detect": "", "segment": "-seg", "classify": "-cls"}
    model_suffix = suffix_map.get(task_type, "")
    full_model_name = f"{model_name}{model_suffix}"
    pt_name = f"{full_model_name}.pt"
    
    pretrained_path = PRETRAINED_MODELS_DIR / pt_name
    if pretrained_path.exists():
        logger.info(f"Task {task_id}: Loading YOLO model from pre-downloaded {pretrained_path}")
        model = YOLO(str(pretrained_path))
    else:
        logger.info(f"Task {task_id}: Loading YOLO model {full_model_name} (task_type={task_type})")
        model = YOLO(pt_name)
    
    use_segmentation = task_type == "segment"
    is_classification = task_type == "classify"
    logger.info(f"Task {task_id}: Model type: {task_type}, segmentation: {use_segmentation}, classification: {is_classification}")
    
    return model, use_segmentation, is_classification


def create_annotation_file_with_classes(
    db,
    dataset_id: int,
    annotation_file_name: str,
    use_segmentation: bool,
    task_id: int,
    tags: Optional[List[str]] = None,
    is_classification: bool = False,
):
    """Create annotation file and annotation classes. Optionally set tags (e.g. model type, size, task).
    For classification, type is set to 'Classification' and no initial classes are created (added on the fly)."""
    import uuid

    annotation_file_id = str(uuid.uuid4())
    if is_classification:
        file_type = "Classification"
    else:
        file_type = "Segmentation (mask+bbox)" if use_segmentation else "Object Detection (bbox)"
    annotation_file = models.AnnotationFile(
        id=annotation_file_id,
        dataset_id=dataset_id,
        name=annotation_file_name if annotation_file_name.endswith('.json') else f"{annotation_file_name}.json",
        format="COCO",
        type=file_type,
        is_processed=False,
        processing_status="processing",
    )
    if tags:
        annotation_file.tags = list(tags)
    db.add(annotation_file)
    db.commit()
    logger.info(f"Task {task_id}: Created annotation file {annotation_file_id}" + (f" type={file_type}" if is_classification else "") + (f" with tags {tags}" if tags else ""))
    
    # Create annotation classes only for detection/segmentation (COCO 80 classes); classification adds classes on the fly
    if not is_classification:
        for idx, class_name in enumerate(COCO_CLASSES):
            ann_class = models.AnnotationClass(
                annotation_file_id=annotation_file_id,
                class_name=class_name,
                category_id=idx + 1
            )
            db.add(ann_class)
        db.commit()
    
    return annotation_file_id


def get_or_create_annotation_class(db, annotation_file_id: str, class_name: str) -> int:
    """Get or create an AnnotationClass for this file and class; return category_id."""
    existing = db.query(models.AnnotationClass).filter(
        models.AnnotationClass.annotation_file_id == annotation_file_id,
        models.AnnotationClass.class_name == class_name,
    ).first()
    if existing:
        return existing.category_id
    max_id = db.query(models.AnnotationClass).filter(
        models.AnnotationClass.annotation_file_id == annotation_file_id,
    ).count()
    category_id = max_id + 1
    ann_class = models.AnnotationClass(
        annotation_file_id=annotation_file_id,
        class_name=class_name,
        category_id=category_id,
        count=0,
    )
    db.add(ann_class)
    db.commit()
    return category_id


def calculate_polygon_area(segmentation: List[float]) -> float:
    """Calculate area of polygon using shoelace formula"""
    n = len(segmentation) // 2
    if n < 3:
        return 0.0
    
    poly_area = 0.0
    for i in range(n):
        j = (i + 1) % n
        x_i, y_i = segmentation[i * 2], segmentation[i * 2 + 1]
        x_j, y_j = segmentation[j * 2], segmentation[j * 2 + 1]
        poly_area += x_i * y_j - x_j * y_i
    
    return abs(poly_area) / 2.0


def extract_segmentation_from_result(result, box_idx: int, use_segmentation: bool):
    """Extract segmentation mask from YOLO result if available"""
    if not use_segmentation or not hasattr(result, 'masks') or result.masks is None:
        return None
    
    try:
        if box_idx < len(result.masks.xy):
            mask_coords = result.masks.xy[box_idx]
            if len(mask_coords) > 0:
                return [float(coord) for point in mask_coords for coord in point]
    except Exception as e:
        logger.warning(f"Failed to extract mask: {e}")
    
    return None


def create_annotation_from_detection(db, box, box_idx: int, result, annotation_file_id: str, 
                                    image_id: int, dataset_id: int, use_segmentation: bool):
    """Create annotation object from YOLO detection"""
    
    class_id = int(box.cls.item())
    confidence = float(box.conf.item())
    
    if class_id >= len(COCO_CLASSES):
        return None
    
    class_name = COCO_CLASSES[class_id]
    
    # Get bbox
    xyxy = box.xyxy[0].cpu().numpy()
    x1, y1, x2, y2 = xyxy
    bbox_x = float(x1)
    bbox_y = float(y1)
    bbox_width = float(x2 - x1)
    bbox_height = float(y2 - y1)
    bbox = [bbox_x, bbox_y, bbox_width, bbox_height]
    area = bbox_width * bbox_height
    
    # Get segmentation if available
    segmentation = extract_segmentation_from_result(result, box_idx, use_segmentation)
    if segmentation:
        area = calculate_polygon_area(segmentation)
    
    # Create annotation
    annotation = models.Annotation(
        annotation_file_id=annotation_file_id,
        image_id=image_id,
        dataset_id=dataset_id,
        category=class_name,
        category_id=class_id + 1,
        bbox_x=bbox_x,
        bbox_y=bbox_y,
        bbox_width=bbox_width,
        bbox_height=bbox_height,
        bbox=bbox,
        segmentation=segmentation,
        area=area,
        confidence=confidence
    )
    db.add(annotation)
    
    return class_name


def process_single_image(db, model, img, project_id: int, dataset_id: int, 
                        annotation_file_id: str, use_segmentation: bool, class_counts: dict,
                        conf_threshold: float = 0.25):
    """Process a single image with YOLO inference and create annotations"""
    import uuid
    
    # Construct image path - try multiple locations
    img_path = Path("projects") / str(project_id) / str(dataset_id) / "images" / img.file_name
    logger.info(f"Trying image path: {img_path} (exists: {img_path.exists()})")
    if not img_path.exists():
        img_path = Path("data") / "images" / str(dataset_id) / img.file_name
        logger.info(f"Trying fallback path: {img_path} (exists: {img_path.exists()})")
    if not img_path.exists():
        # Try absolute path from img.url if available
        if img.url:
            # url is like /static/projects/1/2/images/file.png - strip /static/ prefix
            url_path = img.url.lstrip('/')
            if url_path.startswith('static/'):
                url_path = url_path[len('static/'):]
            alt_path = Path(url_path)
            logger.info(f"Trying URL-based path: {alt_path} (exists: {alt_path.exists()})")
            if alt_path.exists():
                img_path = alt_path
            else:
                logger.warning(f"Image not found at any path for {img.file_name} (id={img.id}, url={img.url})")
                # List what actually exists in the expected directory
                expected_dir = Path("projects") / str(project_id) / str(dataset_id) / "images"
                if expected_dir.exists():
                    files = list(expected_dir.iterdir())[:5]
                    logger.warning(f"  Directory {expected_dir} exists with {len(list(expected_dir.iterdir()))} files, first 5: {[f.name for f in files]}")
                else:
                    logger.warning(f"  Directory {expected_dir} does NOT exist")
                return 0
        else:
            logger.warning(f"Image not found and no URL: {img.file_name} (id={img.id})")
            return 0
    
    logger.info(f"Processing image: {img_path} (size: {img_path.stat().st_size} bytes)")
    
    # Run inference
    try:
        results = model.predict(source=str(img_path), conf=conf_threshold, iou=0.45, verbose=False, save=False)
    except Exception as e:
        logger.error(f"Inference failed on {img_path}: {e}", exc_info=True)
        return 0
    
    if not results or len(results) == 0:
        logger.warning(f"No results returned for {img_path}")
        return 0
    
    result = results[0]
    img_height, img_width = result.orig_shape
    logger.info(f"Image {img.file_name}: shape={result.orig_shape}, boxes={len(result.boxes) if result.boxes is not None else 'None'}")
    
    # Log raw detection info for debugging
    if result.boxes is not None and len(result.boxes) > 0:
        for i, box in enumerate(result.boxes):
            cls_id = int(box.cls.item())
            conf = float(box.conf.item())
            cls_name = COCO_CLASSES[cls_id] if cls_id < len(COCO_CLASSES) else f"unknown_{cls_id}"
            logger.info(f"  Detection {i}: class={cls_name}(id={cls_id}), conf={conf:.3f}, xyxy={box.xyxy[0].cpu().numpy()}")
    else:
        logger.info(f"  No detections for {img.file_name} at conf_threshold={conf_threshold}")
    
    # Create AnnotationFileImage
    ann_file_img = models.AnnotationFileImage(
        annotation_file_id=annotation_file_id,
        dataset_image_id=img.id,
        file_name=img.file_name,
        width=img_width,
        height=img_height
    )
    db.add(ann_file_img)
    
    # Process detections
    annotations_count = 0
    if result.boxes is not None and len(result.boxes) > 0:
        for box_idx, box in enumerate(result.boxes):
            class_name = create_annotation_from_detection(
                db, box, box_idx, result, annotation_file_id, img.id, dataset_id, use_segmentation
            )
            if class_name:
                class_counts[class_name] += 1
                annotations_count += 1
    
    logger.info(f"Image {img.file_name}: created {annotations_count} annotations")
    return annotations_count


def _resolve_image_path(img, project_id: int, dataset_id: int) -> Optional[Path]:
    """Resolve image path using same order as process_single_image. Returns None if not found."""
    img_path = Path("projects") / str(project_id) / str(dataset_id) / "images" / img.file_name
    logger.info(f"Classification: trying image path {img_path} (exists={img_path.exists()})")
    if img_path.exists():
        return img_path.resolve()
    img_path = Path("data") / "images" / str(dataset_id) / img.file_name
    logger.info(f"Classification: fallback path {img_path} (exists={img_path.exists()})")
    if img_path.exists():
        return img_path.resolve()
    if img.url:
        url_path = img.url.lstrip("/")
        if url_path.startswith("static/"):
            url_path = url_path[len("static/"):]
        alt_path = Path(url_path)
        if alt_path.exists():
            logger.info(f"Classification: using URL-based path {alt_path}")
            return alt_path.resolve()
        # Try projects/ relative to CWD in case url is like "projects/1/2/images/file.jpg"
        if not url_path.startswith("projects"):
            alt_path = Path("projects") / url_path
        else:
            alt_path = Path(url_path)
        if alt_path.exists():
            return alt_path.resolve()
    return None


def process_single_image_classification(
    db,
    model,
    img,
    project_id: int,
    annotation_file_id: str,
    dataset_id: int,
    class_counts: dict,
):
    """Run YOLO classification on one image and create one Annotation (image-level label, no bbox/segmentation)."""
    img_path = _resolve_image_path(img, project_id, dataset_id)
    if img_path is None:
        logger.warning(f"Image not found for classification: {img.file_name} (project_id={project_id}, dataset_id={dataset_id}, url={getattr(img, 'url', None)})")
        return 0
    source_str = str(img_path)
    try:
        # Classification models (e.g. ImageNet) expect 224x224 by default
        results = model.predict(source=source_str, imgsz=224, verbose=False)
    except Exception as e:
        logger.error(f"Classification inference failed on {source_str}: {e}", exc_info=True)
        return 0
    if not results or len(results) == 0:
        logger.warning(f"Classification: no results returned for {img.file_name}")
        return 0
    result = results[0]
    probs = getattr(result, "probs", None)
    if probs is None:
        logger.warning(
            f"No probs in result for {img.file_name}; result type={type(result).__name__}, "
            f"has boxes={hasattr(result, 'boxes') and result.boxes is not None}"
        )
        return 0
    top1_val = getattr(probs, "top1", None)
    if top1_val is None:
        logger.warning(f"Classification: probs has no top1 for {img.file_name}")
        return 0
    top1_idx = int(top1_val.item()) if hasattr(top1_val, "item") else int(top1_val)
    names = getattr(result, "names", None) or getattr(model, "names", None) or {}
    if isinstance(names, (list, tuple)):
        class_name = names[int(top1_idx)] if int(top1_idx) < len(names) else f"class_{top1_idx}"
    elif isinstance(names, dict):
        class_name = names.get(int(top1_idx), str(top1_idx))
    else:
        class_name = f"class_{top1_idx}"
    confidence = None
    if hasattr(probs, "data") and probs.data is not None:
        try:
            data = probs.data
            if hasattr(data, "shape") and len(data.shape) > 1:
                confidence = float(data[0, int(top1_idx)].item())
            else:
                confidence = float(data[int(top1_idx)].item())
        except Exception:
            pass
    # Image dimensions for AnnotationFileImage
    img_width = getattr(result, "orig_shape", (0, 0))[1] if hasattr(result, "orig_shape") else 0
    img_height = getattr(result, "orig_shape", (0, 0))[0] if hasattr(result, "orig_shape") else 0
    if not img_width or not img_height:
        img_width = img.width or 1
        img_height = img.height or 1
    ann_file_img = models.AnnotationFileImage(
        annotation_file_id=annotation_file_id,
        dataset_image_id=img.id,
        file_name=img.file_name,
        width=img_width,
        height=img_height,
    )
    db.add(ann_file_img)
    category_id = get_or_create_annotation_class(db, annotation_file_id, class_name)
    class_counts[class_name] = class_counts.get(class_name, 0) + 1
    ann = models.Annotation(
        annotation_file_id=annotation_file_id,
        image_id=img.id,
        dataset_id=dataset_id,
        category=class_name,
        category_id=category_id,
        bbox=None,
        segmentation=None,
        area=None,
        confidence=confidence,
    )
    db.add(ann)
    db.commit()
    logger.info(f"Image {img.file_name}: classification -> {class_name}")
    return 1


def finalize_annotation_file(db, annotation_file_id: str, total_annotations: int, 
                             processed_images: int, class_counts: dict):
    """Update annotation file with final statistics. Remove classes with count 0 and renumber category_id."""
    annotation_file = db.query(models.AnnotationFile).filter(
        models.AnnotationFile.id == annotation_file_id
    ).first()
    
    if not annotation_file:
        return

    # Update count on each AnnotationClass from class_counts
    for ann_cls in db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_file_id
    ).all():
        ann_cls.count = class_counts.get(ann_cls.class_name, 0)
    db.commit()

    # Keep only classes that have at least one annotation
    used_class_names = [name for name, count in class_counts.items() if count > 0]
    if not used_class_names:
        annotation_file.annotation_count = total_annotations
        annotation_file.image_count = processed_images
        annotation_file.category_count = 0
        annotation_file.statistics = {
            'class_counts': class_counts,
            'total_annotations': total_annotations
        }
        annotation_file.is_processed = True
        annotation_file.processing_status = "completed"
        db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_file_id
        ).delete()
        db.commit()
        return

    # Delete classes with count 0
    db.query(models.AnnotationClass).filter(
        models.AnnotationClass.annotation_file_id == annotation_file_id,
        ~models.AnnotationClass.class_name.in_(used_class_names)
    ).delete(synchronize_session=False)
    db.commit()

    # Renumber category_id 1, 2, 3, ... for remaining classes (stable order by class name)
    remaining_classes = db.query(models.AnnotationClass).filter(
        models.AnnotationClass.annotation_file_id == annotation_file_id
    ).order_by(models.AnnotationClass.class_name).all()
    name_to_new_category_id = {}
    for idx, ann_cls in enumerate(remaining_classes):
        new_id = idx + 1
        name_to_new_category_id[ann_cls.class_name] = new_id
        ann_cls.category_id = new_id
    db.commit()

    # Update annotations to use new category_id
    for ann in db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == annotation_file_id
    ).all():
        if ann.category in name_to_new_category_id:
            ann.category_id = name_to_new_category_id[ann.category]
    db.commit()

    annotation_file.annotation_count = total_annotations
    annotation_file.image_count = processed_images
    annotation_file.category_count = len(remaining_classes)
    annotation_file.statistics = {
        'class_counts': {k: v for k, v in class_counts.items() if v > 0},
        'total_annotations': total_annotations
    }
    annotation_file.is_processed = True
    annotation_file.processing_status = "completed"
    db.commit()


async def preannotate_with_foundation_model_task(task_id: int, db_path: str, model_name: str, dataset_id: int, conf_threshold: float = 0.25, task_type: str = "detect"):
    """Background task to run YOLO inference and create annotations"""
    logger.info(f"Starting preannotate task {task_id} with model {model_name}")
    
    from ..database import SessionLocal
    
    db = SessionLocal()
    try:
        # Get and validate task
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            logger.error(f"Task {task_id} not found")
            return
        
        if task.status == 'cancelled':
            logger.info(f"Task {task_id}: Task was cancelled")
            return
        
        # Update task to running
        task.status = 'running'
        task.started_at = datetime.utcnow()
        task.progress = 0.0
        db.commit()
        logger.info(f"Task {task_id}: Status set to running")
        
        # Get dataset and images
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise Exception(f"Dataset {dataset_id} not found")
        
        images = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
        logger.info(f"Task {task_id}: Found {len(images)} images to process in dataset {dataset_id} (project {dataset.project_id})")
        
        if len(images) > 0:
            # Log first few image details for debugging
            for i, img in enumerate(images[:3]):
                logger.info(f"  Image {i}: id={img.id}, file_name={img.file_name}, url={img.url}")
        
        if len(images) == 0:
            raise Exception("No images found in dataset")
        
        task.progress = 10.0
        db.commit()
        
        # Load YOLO model
        model, use_segmentation, is_classification = load_yolo_model(model_name, task_id, task_type)
        task.progress = 20.0
        db.commit()
        
        # Create annotation file with tags: model type, size, task (detection/segmentation/classification)
        annotation_file_name = task.task_metadata.get('annotation_file_name', f'Auto_{model_name}')
        auto_tags = _auto_annotate_tags(model_name, task_type)
        annotation_file_id = create_annotation_file_with_classes(
            db, dataset_id, annotation_file_name, use_segmentation, task_id, tags=auto_tags,
            is_classification=is_classification,
        )
        
        # Process all images
        total_annotations = 0
        class_counts = {} if is_classification else {name: 0 for name in COCO_CLASSES}
        processed_images = 0
        project_id = dataset.project_id or 0
        
        for img_idx, img in enumerate(images):
            if is_classification:
                annotations_count = process_single_image_classification(
                    db, model, img, project_id, annotation_file_id, dataset_id, class_counts
                )
            else:
                annotations_count = process_single_image(
                    db, model, img, project_id, dataset_id,
                    annotation_file_id, use_segmentation, class_counts,
                    conf_threshold=conf_threshold
                )
            
            total_annotations += annotations_count
            processed_images += 1
            
            # Update progress
            if (img_idx + 1) % 10 == 0 or (img_idx + 1) == len(images):
                progress = 20.0 + (processed_images / len(images)) * 70.0
                task.progress = progress
                db.commit()
                logger.info(f"Task {task_id}: Processed {processed_images}/{len(images)} images")
        
        # Finalize annotation file
        finalize_annotation_file(db, annotation_file_id, total_annotations, processed_images, class_counts)
        
        # Complete task
        task.status = 'completed'
        task.progress = 100.0
        task.completed_at = datetime.utcnow()
        task.task_metadata = {
            **task.task_metadata,
            'total_annotations': total_annotations,
            'processed_images': processed_images,
            'annotation_file_id': annotation_file_id
        }
        db.commit()
        logger.info(f"Task {task_id}: Completed with {total_annotations} annotations")
        
    except Exception as e:
        logger.error(f"Task {task_id}: Error - {str(e)}", exc_info=True)
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if task and task.status != 'cancelled':
            task.status = 'failed'
            task.error_message = str(e)
            task.completed_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()





@router.post("/preannotate")
async def start_preannotate(
    request: Dict[str, Any],
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: Session = Depends(get_db)
):
    """Start auto-annotation with foundation model or depth estimation"""
    try:
        model_name = request.get("model_name")
        dataset_id = request.get("dataset_id")
        save_as = request.get("save_as")
        new_dataset_name = request.get("new_dataset_name")
        annotation_file_name = request.get("annotation_file_name")
        conf_threshold = request.get("conf_threshold", 0.25)
        task_type = request.get("task_type", "detect")
        environment = request.get("environment", "outdoor")
        model_size = request.get("model_size", "vitb")
        
        if not model_name or not dataset_id:
            raise HTTPException(status_code=400, detail="model_name and dataset_id are required")
        
        # Get the dataset
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Check if this is a depth estimation request
        is_depth_estimation = model_name.startswith("depth_anything")
        
        # Create task record
        task_name = f"Generate depth maps for {dataset.name}" if is_depth_estimation else f"Auto-annotate {dataset.name} with {model_name}"
        task = models.Task(
            name=task_name,
            task_type="depth_estimation" if is_depth_estimation else "preannotate",
            status="pending",
            progress=0.0,
            project_id=dataset.project_id,
            created_at=datetime.utcnow(),
            task_metadata={
                "model_name": model_name,
                "dataset_id": dataset_id,
                "project_id": dataset.project_id,
                "save_as": save_as,
                "new_dataset_name": new_dataset_name,
                "annotation_file_name": annotation_file_name or f"Auto_{model_name}",
                "conf_threshold": conf_threshold,
                "task_type": task_type,
                "environment": environment,
                "model_size": model_size
            }
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        
        # Get database URL from environment
        db_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@db/lai_db")
        
        # Start appropriate background task
        if is_depth_estimation:
            # Import depth estimation task
            from ..tasks.depth_estimation_tasks import generate_depth_maps
            
            # Start depth estimation task
            celery_task = generate_depth_maps.delay(
                task.id,
                dataset_id,
                model_size,
                environment,
                save_as or "collection",
                new_dataset_name
            )
            task.task_metadata = {**(task.task_metadata or {}), "celery_task_id": celery_task.id}
            db.commit()

            logger.info(f"Started depth estimation task {task.id} for dataset {dataset_id} with model {model_name}")
            message = f"Depth estimation started with {model_name}"
        else:
            # Start YOLO auto-annotation task
            background_tasks.add_task(
                preannotate_with_foundation_model_task,
                task.id,
                db_url,
                model_name,
                dataset_id,
                conf_threshold,
                task_type
            )
            
            logger.info(f"Started preannotate task {task.id} for dataset {dataset_id} with model {model_name}")
            message = f"Auto-annotation started with {model_name}"
        
        return {
            "success": True,
            "task_id": task.id,
            "message": message,
            "task": {
                "id": task.id,
                "name": task.name,
                "status": task.status,
                "progress": task.progress
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting preannotate: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))