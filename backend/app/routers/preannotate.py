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


def load_yolo_model(model_name: str, task_id: int):
    """Load YOLO model and return model object with metadata"""
    from ultralytics import YOLO
    
    logger.info(f"Task {task_id}: Loading YOLO model {model_name}")
    model = YOLO(f"{model_name}.pt")
    
    model_task = getattr(model, 'task', 'detect')
    use_segmentation = model_task in ['segment', 'segmentation']
    logger.info(f"Task {task_id}: Model type: {model_task}, segmentation: {use_segmentation}")
    
    return model, use_segmentation


def create_annotation_file_with_classes(db, dataset_id: int, annotation_file_name: str, use_segmentation: bool, task_id: int):
    """Create annotation file and annotation classes"""
    import uuid
    
    annotation_file_id = str(uuid.uuid4())
    annotation_file = models.AnnotationFile(
        id=annotation_file_id,
        dataset_id=dataset_id,
        name=annotation_file_name if annotation_file_name.endswith('.json') else f"{annotation_file_name}.json",
        format="COCO",
        type="Segmentation (mask+bbox)" if use_segmentation else "Object Detection (bbox)",
        is_processed=False,
        processing_status="processing"
    )
    db.add(annotation_file)
    db.commit()
    logger.info(f"Task {task_id}: Created annotation file {annotation_file_id}")
    
    # Create annotation classes
    for idx, class_name in enumerate(COCO_CLASSES):
        ann_class = models.AnnotationClass(
            annotation_file_id=annotation_file_id,
            class_name=class_name,
            category_id=idx + 1
        )
        db.add(ann_class)
    db.commit()
    
    return annotation_file_id


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


def finalize_annotation_file(db, annotation_file_id: str, total_annotations: int, 
                             processed_images: int, class_counts: dict):
    """Update annotation file with final statistics"""
    annotation_file = db.query(models.AnnotationFile).filter(
        models.AnnotationFile.id == annotation_file_id
    ).first()
    
    if annotation_file:
        annotation_file.annotation_count = total_annotations
        annotation_file.image_count = processed_images
        annotation_file.category_count = len(COCO_CLASSES)
        annotation_file.statistics = {
            'class_counts': class_counts,
            'total_annotations': total_annotations
        }
        annotation_file.is_processed = True
        annotation_file.processing_status = "completed"
        db.commit()


async def preannotate_with_foundation_model_task(task_id: int, db_path: str, model_name: str, dataset_id: int, conf_threshold: float = 0.25):
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
        model, use_segmentation = load_yolo_model(model_name, task_id)
        task.progress = 20.0
        db.commit()
        
        # Create annotation file
        annotation_file_name = task.task_metadata.get('annotation_file_name', f'Auto_{model_name}')
        annotation_file_id = create_annotation_file_with_classes(
            db, dataset_id, annotation_file_name, use_segmentation, task_id
        )
        
        # Process all images
        total_annotations = 0
        class_counts = {name: 0 for name in COCO_CLASSES}
        processed_images = 0
        project_id = dataset.project_id
        
        for img_idx, img in enumerate(images):
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
    """Start auto-annotation with foundation model"""
    try:
        model_name = request.get("model_name")
        dataset_id = request.get("dataset_id")
        save_as = request.get("save_as")
        new_dataset_name = request.get("new_dataset_name")
        annotation_file_name = request.get("annotation_file_name")
        conf_threshold = request.get("conf_threshold", 0.25)
        
        if not model_name or not dataset_id:
            raise HTTPException(status_code=400, detail="model_name and dataset_id are required")
        
        # Get the dataset
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Create task record
        task = models.Task(
            name=f"Auto-annotate {dataset.name} with {model_name}",
            task_type="preannotate",
            status="pending",
            progress=0.0,
            project_id=dataset.project_id,
            created_at=datetime.utcnow(),
            task_metadata={
                "model_name": model_name,
                "dataset_id": dataset_id,
                "save_as": save_as,
                "new_dataset_name": new_dataset_name,
                "annotation_file_name": annotation_file_name or f"Auto_{model_name}",
                "conf_threshold": conf_threshold
            }
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        
        # Get database URL from environment
        db_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@db/lai_db")
        
        # Start background task
        background_tasks.add_task(
            preannotate_with_foundation_model_task,
            task.id,
            db_url,
            model_name,
            dataset_id,
            conf_threshold
        )
        
        logger.info(f"Started preannotate task {task.id} for dataset {dataset_id} with model {model_name}")
        
        return {
            "success": True,
            "task_id": task.id,
            "message": f"Auto-annotation started with {model_name}",
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