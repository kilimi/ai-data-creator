"""YOLO format dataset writer for Ultralytics training."""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List

from app.models import Annotation, AnnotationClass, AnnotationFile, Dataset, Image, ImageCollection
from app.ml.dataset.builder import generate_safe_output_filename, resolve_source_image_path

logger = logging.getLogger(__name__)


def _yolo_detection_line_from_bbox(
    class_id: int,
    *,
    x: float,
    y: float,
    w: float,
    h: float,
    coords_are_normalized: bool,
    img_width: int,
    img_height: int,
) -> str:
    """Format one YOLO detection label line (class + normalized xywh center)."""
    if coords_are_normalized:
        x_center = x + w / 2
        y_center = y + h / 2
        norm_w, norm_h = w, h
    else:
        x_center = (x + w / 2) / img_width
        y_center = (y + h / 2) / img_height
        norm_w = w / img_width
        norm_h = h / img_height
    return f"{class_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}"


def _append_yolo_detection_bbox(
    label_lines: List[str],
    annotation: Annotation,
    *,
    class_id: int,
    img_width: int,
    img_height: int,
    stats: Dict[str, Any],
    split_name: str,
    class_name: str,
) -> bool:
    """Append a detection label from COCO pixel bbox or normalized bbox_* columns."""
    x = y = w = h = None
    coords_are_normalized = False

    if annotation.bbox and isinstance(annotation.bbox, list) and len(annotation.bbox) >= 4:
        x, y, w, h = annotation.bbox[0], annotation.bbox[1], annotation.bbox[2], annotation.bbox[3]
        coords_are_normalized = False
    elif annotation.bbox_x is not None and annotation.bbox_width is not None:
        x = annotation.bbox_x
        y = annotation.bbox_y or 0
        w = annotation.bbox_width
        h = annotation.bbox_height or 0
        coords_are_normalized = True

    if x is None or y is None or w is None or h is None:
        return False

    label_lines.append(
        _yolo_detection_line_from_bbox(
            class_id,
            x=float(x),
            y=float(y),
            w=float(w),
            h=float(h),
            coords_are_normalized=coords_are_normalized,
            img_width=img_width,
            img_height=img_height,
        )
    )
    if class_name not in stats["annotations_per_class"]:
        stats["annotations_per_class"][class_name] = {"train": 0, "val": 0, "test": 0}
    stats["annotations_per_class"][class_name][split_name] += 1
    stats["total_annotations"][split_name] += 1
    return True


def _annotation_has_bbox(annotation: Annotation) -> bool:
    if annotation.bbox and isinstance(annotation.bbox, list) and len(annotation.bbox) >= 4:
        return any(float(v) > 0 for v in annotation.bbox[:4])
    return (
        annotation.bbox_x is not None
        and annotation.bbox_width is not None
        and float(annotation.bbox_width or 0) > 0
        and float(annotation.bbox_height or 0) > 0
    )


def _annotation_has_segmentation(annotation: Annotation) -> bool:
    seg = annotation.segmentation
    return bool(seg and isinstance(seg, list) and len(seg) > 0)


def _is_classification_label_annotation(annotation: Annotation) -> bool:
    """Image-level class label without spatial geometry."""
    if _annotation_has_bbox(annotation) or _annotation_has_segmentation(annotation):
        return False
    return annotation.category_id is not None or bool(annotation.category)


def _safe_class_dirname(class_name: str) -> str:
    safe = "".join(c if c.isalnum() or c in ("-", "_", " ") else "_" for c in class_name.strip())
    return safe or "unknown_class"


def _prepare_yolo_classification_dataset(
    db,
    dataset_configs: List[Dict[str, Any]],
    output_dir: Path,
    *,
    remove_images_without_annotations: bool = True,
) -> Dict[str, Any]:
    """
    Build Ultralytics classification layout: train/<class>/img.jpg, val/<class>/img.jpg.
    """
    stats = {
        "total_images": {"train": 0, "val": 0, "test": 0},
        "total_annotations": {"train": 0, "val": 0, "test": 0},
        "annotations_per_class": {},
        "images_filtered": 0,
        "images_processed": 0,
    }
    total_images = {"train": 0, "val": 0, "test": 0}

    for split in ("train", "val", "test"):
        (output_dir / split).mkdir(parents=True, exist_ok=True)

    all_classes: set[str] = set()
    for config in dataset_configs:
        annotation_file_id = config["annotation_file_id"]
        annotation_classes = db.query(AnnotationClass).filter(
            AnnotationClass.annotation_file_id == annotation_file_id
        ).all()
        for ann_class in annotation_classes:
            all_classes.add(ann_class.class_name)

    sorted_classes = sorted(all_classes)
    if not sorted_classes:
        raise ValueError(
            "No annotation classes found. Make sure your classification dataset has class labels defined."
        )

    for config in dataset_configs:
        dataset_id = config["dataset_id"]
        annotation_file_id = config["annotation_file_id"]
        image_collection = config.get("image_collection")
        split = config.get("split", {"train": 80, "val": 20, "test": 0})

        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            logger.warning(f"Dataset {dataset_id} not found, skipping")
            continue

        images_query = db.query(Image).filter(Image.dataset_id == dataset_id)
        if image_collection:
            images_query = images_query.join(Image.collection).filter(
                ImageCollection.name == image_collection
            )
        images = images_query.all()
        if not images:
            logger.warning(f"No images found for dataset {dataset_id}, skipping")
            continue

        if remove_images_without_annotations:
            filtered: list[Image] = []
            for img in images:
                annotations = db.query(Annotation).filter(
                    Annotation.image_id == img.id,
                    Annotation.annotation_file_id == annotation_file_id,
                ).all()
                if any(_is_classification_label_annotation(a) for a in annotations):
                    filtered.append(img)
            stats["images_filtered"] += len(images) - len(filtered)
            images = filtered
            if not images:
                logger.warning(
                    f"No classification labels for dataset {dataset_id} after filtering, skipping"
                )
                continue

        total_count = len(images)
        train_count = int(total_count * split["train"] / 100)
        val_count = int(total_count * split["val"] / 100)
        train_images = images[:train_count]
        val_images = images[train_count : train_count + val_count]
        test_images = images[train_count + val_count :]

        for split_name, split_images in (
            ("train", train_images),
            ("val", val_images),
            ("test", test_images),
        ):
            for image in split_images:
                src_image_path = resolve_source_image_path(image, dataset_id)
                if src_image_path is None or not src_image_path.exists():
                    logger.warning(f"Image file not found for image {image.id}")
                    continue

                annotations = db.query(Annotation).filter(
                    Annotation.image_id == image.id,
                    Annotation.annotation_file_id == annotation_file_id,
                ).all()
                class_labels: list[str] = []
                for annotation in annotations:
                    if not _is_classification_label_annotation(annotation):
                        continue
                    ann_class = db.query(AnnotationClass).filter(
                        AnnotationClass.annotation_file_id == annotation_file_id,
                        AnnotationClass.category_id == annotation.category_id,
                    ).first()
                    label = (
                        ann_class.class_name
                        if ann_class
                        else (annotation.category or "").strip()
                    )
                    if label and label not in class_labels:
                        class_labels.append(label)

                if not class_labels:
                    continue

                class_name = class_labels[0]
                if len(class_labels) > 1:
                    logger.warning(
                        "Image %s has multiple classification labels %s; using %s",
                        image.id,
                        class_labels,
                        class_name,
                    )

                class_dir = output_dir / split_name / _safe_class_dirname(class_name)
                class_dir.mkdir(parents=True, exist_ok=True)
                safe_filename = generate_safe_output_filename(src_image_path.name, image.dataset_id)
                dst_image_path = class_dir / safe_filename
                try:
                    if not dst_image_path.exists():
                        os.link(src_image_path, dst_image_path)
                except OSError:
                    shutil.copy2(src_image_path, dst_image_path)

                stats["total_images"][split_name] += 1
                stats["images_processed"] += 1
                stats["total_annotations"][split_name] += 1
                if class_name not in stats["annotations_per_class"]:
                    stats["annotations_per_class"][class_name] = {"train": 0, "val": 0, "test": 0}
                stats["annotations_per_class"][class_name][split_name] += 1
                total_images[split_name] += 1

    if total_images["train"] == 0 and total_images["val"] == 0:
        raise ValueError(
            "No images were processed. Classification training requires image-level class labels "
            "(no bounding boxes or polygons). Check that your annotation file is a classification export."
        )

    abs_path = output_dir.absolute()
    if not str(abs_path).startswith("/app/"):
        abs_path = Path("/app") / output_dir

    logger.info(
        "Classification dataset: %s train, %s val, %s test images; classes=%s",
        total_images["train"],
        total_images["val"],
        total_images["test"],
        sorted_classes,
    )

    return {
        "yaml_path": str(abs_path),
        "dataset_format": "classify",
        "class_names": sorted_classes,
        "class_count": len(sorted_classes),
        "image_counts": total_images,
        "dataset_stats": stats,
    }


def prepare_yolo_dataset(
    db,
    dataset_configs: List[Dict[str, Any]],
    output_dir: Path,
    model_type: str = "yolo11n-seg.pt",
    remove_images_without_annotations: bool = True
) -> Dict[str, Any]:
    """
    Prepare YOLO format dataset from database annotations.
    
    Args:
        db: Database session
        dataset_configs: List of dataset configurations
        output_dir: Output directory for the dataset
        model_type: YOLO model type (e.g., 'yolo11n-seg.pt' for segmentation)
    
    Returns:
        Dict with paths and class names
    """
    if "-cls" in model_type.lower():
        return _prepare_yolo_classification_dataset(
            db,
            dataset_configs,
            output_dir,
            remove_images_without_annotations=remove_images_without_annotations,
        )

    # Determine if this is a segmentation model
    is_segmentation_model = '-seg' in model_type.lower()
    
    # Track skipped annotations
    skipped_annotations = {'missing_seg': 0, 'missing_bbox': 0, 'missing_both': 0}
    
    # Statistics tracking
    stats = {
        'total_images': {"train": 0, "val": 0, "test": 0},
        'total_annotations': {"train": 0, "val": 0, "test": 0},
        'annotations_per_class': {},  # Will be filled during processing
        'images_filtered': 0,  # Images removed due to no valid annotations
        'images_processed': 0,
    }
    
    # Create directory structure
    train_images_dir = output_dir / "images" / "train"
    val_images_dir = output_dir / "images" / "val"
    test_images_dir = output_dir / "images" / "test"
    train_labels_dir = output_dir / "labels" / "train"
    val_labels_dir = output_dir / "labels" / "val"
    test_labels_dir = output_dir / "labels" / "test"
    
    for directory in [train_images_dir, val_images_dir, test_images_dir, 
                     train_labels_dir, val_labels_dir, test_labels_dir]:
        directory.mkdir(parents=True, exist_ok=True)
    
    # Collect all classes across all datasets
    all_classes = set()
    class_mapping = {}
    
    # Track annotation types for validation
    has_segmentation = False
    has_bbox_only = False
    
    # First pass: collect all unique classes
    for config in dataset_configs:
        dataset_id = config['dataset_id']
        annotation_file_id = config['annotation_file_id']
        
        logger.info(f"Looking for annotation classes - dataset_id: {dataset_id}, annotation_file_id: {annotation_file_id}")
        
        # Get annotation classes
        annotation_classes = db.query(AnnotationClass).filter(
            AnnotationClass.annotation_file_id == annotation_file_id
        ).all()
        
        logger.info(f"Found {len(annotation_classes)} annotation classes for annotation_file_id: {annotation_file_id}")
        
        if not annotation_classes:
            # Try to find the annotation file first
            annotation_file = db.query(AnnotationFile).filter(
                AnnotationFile.dataset_id == dataset_id
            ).first()
            
            if annotation_file:
                logger.info(f"Found annotation file with id: {annotation_file.id}, name: {annotation_file.name}")
                # Retry with the correct ID
                annotation_classes = db.query(AnnotationClass).filter(
                    AnnotationClass.annotation_file_id == annotation_file.id
                ).all()
                logger.info(f"Found {len(annotation_classes)} annotation classes using annotation_file.id")
        
        for ann_class in annotation_classes:
            all_classes.add(ann_class.class_name)
            logger.info(f"Added class: {ann_class.class_name}")
    
    logger.info(f"Total unique classes found: {len(all_classes)} - {sorted(list(all_classes))}")
    
    # Create class mapping (sorted for consistency)
    sorted_classes = sorted(list(all_classes))
    class_mapping = {class_name: idx for idx, class_name in enumerate(sorted_classes)}
    
    # Process each dataset configuration
    total_images = {"train": 0, "val": 0, "test": 0}
    
    for config in dataset_configs:
        dataset_id = config['dataset_id']
        annotation_file_id = config['annotation_file_id']
        image_collection = config.get('image_collection')
        split = config.get('split', {'train': 80, 'val': 20, 'test': 0})
        
        # Get dataset and images
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            logger.warning(f"Dataset {dataset_id} not found, skipping")
            continue
        
        # Query images, optionally filter by collection
        images_query = db.query(Image).filter(Image.dataset_id == dataset_id)
        if image_collection:
            # Filter by collection name through the relationship
            images_query = images_query.join(Image.collection).filter(
                ImageCollection.name == image_collection
            )
        
        images = images_query.all()
        
        if not images:
            logger.warning(f"No images found for dataset {dataset_id}, skipping")
            continue
        
        # Filter out images without VALID annotations BEFORE splitting (if flag is set)
        if remove_images_without_annotations:
            images_with_annotations = []
            for img in images:
                # Get annotations for this image
                annotations = db.query(Annotation).filter(
                    Annotation.image_id == img.id,
                    Annotation.annotation_file_id == annotation_file_id
                ).all()
                
                # Check if ANY annotation meets the requirements
                has_valid_annotation = False
                for annotation in annotations:
                    # For segmentation models, annotation must have BOTH segmentation and bbox
                    if is_segmentation_model:
                        has_seg = annotation.segmentation and len(annotation.segmentation) > 0
                        has_bbox = (annotation.bbox or 
                                   (annotation.bbox_x is not None and annotation.bbox_width is not None))
                        if has_seg and has_bbox:
                            has_valid_annotation = True
                            break
                    else:
                        # For detection models, just need bbox
                        has_bbox = (annotation.bbox or 
                                   (annotation.bbox_x is not None and annotation.bbox_width is not None))
                        if has_bbox:
                            has_valid_annotation = True
                            break
                
                if has_valid_annotation:
                    images_with_annotations.append(img)
            
            images_before = len(images)
            images = images_with_annotations
            images_after = len(images)
            
            filtered_count = images_before - images_after
            stats['images_filtered'] += filtered_count
            if images_before != images_after:
                logger.info(f"Filtered dataset {dataset_id}: {images_before} → {images_after} images (removed {filtered_count} without valid annotations)")
            
            if not images:
                logger.warning(f"No images with annotations found for dataset {dataset_id} after filtering, skipping")
                continue
        
        # Calculate split indices
        total_count = len(images)
        train_count = int(total_count * split['train'] / 100)
        val_count = int(total_count * split['val'] / 100)
        # test gets the remainder
        
        # Split images
        train_images = images[:train_count]
        val_images = images[train_count:train_count + val_count]
        test_images = images[train_count + val_count:]
        
        # Process each split
        for split_name, split_images, img_dir, lbl_dir in [
            ('train', train_images, train_images_dir, train_labels_dir),
            ('val', val_images, val_images_dir, val_labels_dir),
            ('test', test_images, test_images_dir, test_labels_dir)
        ]:
            for image in split_images:
                # Construct image file path from URL or file_name
                # Images are stored in projects/{dataset_id}/ directory
                if image.url:
                    # URL format: /static/projects/{dataset_id}/{filename}
                    # or could be absolute path
                    if image.url.startswith('/static/projects/'):
                        # Convert URL to file path
                        src_image_path = Path('projects') / image.url.replace('/static/projects/', '')
                    elif image.url.startswith('projects/'):
                        src_image_path = Path(image.url)
                    else:
                        # Assume it's just the dataset_id/filename
                        src_image_path = Path('projects') / str(dataset_id) / image.file_name
                else:
                    # Fallback to constructing from dataset_id and file_name
                    src_image_path = Path('projects') / str(dataset_id) / image.file_name
                
                if not src_image_path.exists():
                    logger.warning(f"Image file not found: {src_image_path}")
                    continue
                
                # Generate safe filename with dataset_id to prevent collisions
                safe_filename = generate_safe_output_filename(src_image_path.name, image.dataset_id)
                safe_stem = Path(safe_filename).stem
                dst_image_path = img_dir / safe_filename
                
                # Create hard link or copy
                try:
                    if not dst_image_path.exists():
                        os.link(src_image_path, dst_image_path)
                except:
                    shutil.copy2(src_image_path, dst_image_path)
                
                # Get annotations for this image
                annotations = db.query(Annotation).filter(
                    Annotation.image_id == image.id,
                    Annotation.annotation_file_id == annotation_file_id
                ).all()
                
                # At this point, images without annotations have already been filtered out
                # during the pre-split filtering step if remove_images_without_annotations is True
                if not annotations:
                    if remove_images_without_annotations:
                        # This shouldn't happen since we filtered before splitting
                        logger.warning(f"Image {image.id} has no annotations but wasn't filtered - this is unexpected")
                        continue
                    else:
                        # Create empty label file for images without annotations
                        label_path = lbl_dir / f"{safe_stem}.txt"
                        label_path.touch()
                        total_images[split_name] += 1
                        continue
                
                # Create YOLO format label file
                label_lines = []
                for annotation in annotations:
                    # Get class ID from mapping
                    ann_class = db.query(AnnotationClass).filter(
                        AnnotationClass.annotation_file_id == annotation_file_id,
                        AnnotationClass.category_id == annotation.category_id
                    ).first()
                    
                    if not ann_class:
                        continue
                    
                    class_id = class_mapping.get(ann_class.class_name)
                    if class_id is None:
                        continue
                    
                    # For segmentation models, skip annotations without both segmentation and bbox
                    if is_segmentation_model:
                        has_seg = annotation.segmentation and len(annotation.segmentation) > 0
                        has_bbox = (annotation.bbox or 
                                   (annotation.bbox_x is not None and annotation.bbox_width is not None))
                        
                        if not (has_seg and has_bbox):
                            # Track which type of data is missing
                            if not has_seg and not has_bbox:
                                skipped_annotations['missing_both'] += 1
                            elif not has_seg:
                                skipped_annotations['missing_seg'] += 1
                            else:
                                skipped_annotations['missing_bbox'] += 1
                            logger.debug(f"Skipping annotation {annotation.id} - missing seg or bbox (has_seg={has_seg}, has_bbox={has_bbox})")
                            continue
                    
                    # Get image dimensions. Fall back to reading the real image size
                    # if DB metadata is missing, otherwise normalized labels become invalid.
                    img_width = image.width
                    img_height = image.height
                    if not img_width or not img_height or img_width <= 0 or img_height <= 0:
                        try:
                            from PIL import Image as PILImage
                            with PILImage.open(dst_image_path) as pil_img:
                                img_width, img_height = pil_img.size
                        except Exception as dim_err:
                            logger.warning(
                                f"Could not read image dimensions for {dst_image_path}: {dim_err}; using 1x1 fallback"
                            )
                            img_width, img_height = 1, 1
                    
                    class_name = ann_class.class_name

                    # Segmentation labels only for -seg models; detection models use bboxes.
                    if is_segmentation_model and annotation.segmentation:
                        seg = annotation.segmentation
                        if isinstance(seg, list) and len(seg) > 0:
                            # Polygon format: [[x1, y1, x2, y2, ...]] or [x1, y1, x2, y2, ...]
                            if isinstance(seg[0], list):
                                polygon = seg[0]
                            else:
                                polygon = seg

                            if len(polygon) >= 6:
                                needs_normalization = any(abs(val) > 2 for val in polygon)
                                normalized_coords = []
                                if needs_normalization:
                                    for i in range(0, len(polygon), 2):
                                        if i + 1 < len(polygon):
                                            normalized_coords.extend(
                                                [
                                                    polygon[i] / img_width,
                                                    polygon[i + 1] / img_height,
                                                ]
                                            )
                                else:
                                    normalized_coords = polygon

                                if normalized_coords and len(normalized_coords) >= 6:
                                    coords_str = " ".join(f"{c:.6f}" for c in normalized_coords)
                                    label_lines.append(f"{class_id} {coords_str}")
                                    if class_name not in stats["annotations_per_class"]:
                                        stats["annotations_per_class"][class_name] = {
                                            "train": 0,
                                            "val": 0,
                                            "test": 0,
                                        }
                                    stats["annotations_per_class"][class_name][split_name] += 1
                                    stats["total_annotations"][split_name] += 1
                                    has_segmentation = True
                                    continue

                    if _append_yolo_detection_bbox(
                        label_lines,
                        annotation,
                        class_id=class_id,
                        img_width=img_width,
                        img_height=img_height,
                        stats=stats,
                        split_name=split_name,
                        class_name=class_name,
                    ):
                        has_bbox_only = True
                
                # Write label file (create empty file if no annotations but image is kept)
                if label_lines:
                    label_path = lbl_dir / f"{safe_stem}.txt"
                    with open(label_path, 'w') as f:
                        f.write('\n'.join(label_lines))
                    # Track image was processed
                    stats['total_images'][split_name] += 1
                    stats['images_processed'] += 1
                elif not remove_images_without_annotations:
                    # Create empty label file if we're keeping images without annotations
                    label_path = lbl_dir / f"{safe_stem}.txt"
                    label_path.touch()
                    # Track this image too
                    stats['total_images'][split_name] += 1
                    stats['images_processed'] += 1
                
                total_images[split_name] += 1
    
    # Log annotation type summary
    logger.info(f"Annotation summary - has_segmentation: {has_segmentation}, has_bbox_only: {has_bbox_only}")
    logger.info(f"Model type: {model_type}, is_segmentation_model: {is_segmentation_model}")
    
    # Log skipped annotations
    total_skipped = sum(skipped_annotations.values())
    if total_skipped > 0:
        logger.warning(f"⚠️ Skipped {total_skipped} annotations during dataset preparation:")
        if skipped_annotations['missing_seg'] > 0:
            logger.warning(f"  - {skipped_annotations['missing_seg']} annotations missing segmentation data")
        if skipped_annotations['missing_bbox'] > 0:
            logger.warning(f"  - {skipped_annotations['missing_bbox']} annotations missing bounding box data")
        if skipped_annotations['missing_both'] > 0:
            logger.warning(f"  - {skipped_annotations['missing_both']} annotations missing both segmentation and bbox data")
        logger.warning(f"  Reason: Segmentation models require both polygon and bounding box data for each annotation.")
    
    # Validate annotation format matches model type
    if is_segmentation_model and not has_segmentation:
        if has_bbox_only:
            raise ValueError(
                f"ERROR ❌ Model type '{model_type}' requires segmentation annotations (polygons), "
                f"but only bounding box annotations were found.\n\n"
                f"To fix this:\n"
                f"1. Use a detection model (e.g., 'yolo11n.pt' instead of 'yolo11n-seg.pt'), OR\n"
                f"2. Create segmentation annotations (polygons) for your dataset instead of bounding boxes.\n\n"
                f"See https://docs.ultralytics.com/datasets/segment/ for segmentation dataset format."
            )
        else:
            raise ValueError(
                f"ERROR ❌ No valid annotations found for training.\n"
                f"Model type '{model_type}' requires segmentation annotations (polygons).\n\n"
                f"Please check:\n"
                f"1. Your dataset has annotations uploaded\n"
                f"2. The annotations contain segmentation data (polygons)\n"
                f"3. The annotation file is properly linked to images"
            )
    elif not is_segmentation_model and has_segmentation and not has_bbox_only:
        logger.warning(
            f"Model type '{model_type}' is a detection model, but segmentation annotations were found. "
            f"Consider using a segmentation model (e.g., 'yolo11n-seg.pt') to utilize polygon annotations."
        )
    
    # Create data.yaml file for YOLO
    if not class_mapping:
        raise ValueError("No annotation classes found. Make sure your datasets have annotations with classes defined.")
    
    if total_images['train'] == 0 and total_images['val'] == 0:
        raise ValueError("No images were processed. Check that your datasets have images with annotations.")
    
    # Get absolute path - ensure it starts with /app in Docker context
    abs_path = output_dir.absolute()
    if not str(abs_path).startswith('/app/'):
        # If path is relative or doesn't start with /app, prepend /app
        abs_path = Path('/app') / output_dir
    
    yaml_content = {
        'path': str(abs_path),
        'train': 'images/train',
        'val': 'images/val',
        'test': 'images/test' if total_images['test'] > 0 else None,
        'names': {idx: name for name, idx in class_mapping.items()},
        'nc': len(class_mapping)
    }
    
    logger.info(f"Dataset summary: {total_images['train']} train, {total_images['val']} val, {total_images['test']} test images")
    logger.info(f"Classes: {class_mapping}")
    
    yaml_path = output_dir / "data.yaml"
    with open(yaml_path, 'w') as f:
        # Write YAML manually for better control
        f.write(f"path: {yaml_content['path']}\n")
        f.write(f"train: {yaml_content['train']}\n")
        f.write(f"val: {yaml_content['val']}\n")
        if yaml_content['test']:
            f.write(f"test: {yaml_content['test']}\n")
        # Add task type for segmentation models
        if is_segmentation_model:
            f.write("task: segment\n")
        f.write(f"nc: {yaml_content['nc']}\n")
        f.write("names:\n")
        for idx, name in yaml_content['names'].items():
            f.write(f"  {idx}: {name}\n")
    
    return {
        'yaml_path': str(yaml_path),
        'class_names': sorted_classes,
        'class_count': len(sorted_classes),
        'image_counts': total_images,
        'dataset_stats': stats  # Include comprehensive statistics
    }