"""
Celery tasks for dataset augmentation operations using Albumentations.
"""
import os
import json
import shutil
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional
import numpy as np
from PIL import Image as PILImage
import cv2

try:
    import albumentations as A
except ImportError:
    A = None

from celery import Task
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import uuid

from app.celery_app import celery_app
from app.models import Task as TaskModel, Dataset, Image, Annotation, Augmentation, AnnotationFile, AnnotationClass, AnnotationFileImage

logger = logging.getLogger(__name__)

# Database setup for Celery workers
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@db/lai_db')
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class AugmentationTask(Task):
    """Base task for augmentation with progress tracking"""
    
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Called when task fails"""
        logger.error(f"Augmentation task {task_id} failed: {exc}")
        
        # Update task status in database
        db = SessionLocal()
        try:
            if args and len(args) > 0:
                db_task_id = args[0]
                task = db.query(TaskModel).filter(TaskModel.id == db_task_id).first()
                if task:
                    task.status = 'failed'
                    task.completed_at = datetime.utcnow()
                    task.error_message = str(exc)
                    db.commit()
        finally:
            db.close()


def create_albumentations_transform(augmentation_methods: List[str], method_parameters: Dict[str, Any]) -> 'A.Compose':
    """
    Create an Albumentations transform pipeline based on the selected methods and parameters.
    """
    if A is None:
        raise ImportError("Albumentations is not installed. Run: pip install albumentations")
    
    transforms = []
    
    for method in augmentation_methods:
        if method == 'rotation':
            params = method_parameters.get('rotation', {})
            min_angle = params.get('min_angle', -30)
            max_angle = params.get('max_angle', 30)
            transforms.append(A.Rotate(limit=(min_angle, max_angle), p=1.0, border_mode=cv2.BORDER_CONSTANT))
            
        elif method == 'flip_horizontal':
            transforms.append(A.HorizontalFlip(p=1.0))
            
        elif method == 'flip_vertical':
            transforms.append(A.VerticalFlip(p=1.0))
            
        elif method == 'scale':
            params = method_parameters.get('scale', {})
            min_scale = params.get('min_scale', 0.8)
            max_scale = params.get('max_scale', 1.2)
            transforms.append(A.RandomScale(scale_limit=(min_scale - 1.0, max_scale - 1.0), p=1.0))
            
        elif method == 'brightness':
            params = method_parameters.get('brightness', {})
            factor = params.get('factor', 0.2)
            transforms.append(A.RandomBrightness(limit=factor, p=1.0))
            
        elif method == 'contrast':
            params = method_parameters.get('contrast', {})
            factor = params.get('factor', 0.2)
            transforms.append(A.RandomContrast(limit=factor, p=1.0))
            
        elif method == 'saturation':
            params = method_parameters.get('saturation', {})
            factor = params.get('factor', 0.2)
            transforms.append(A.ColorJitter(saturation=factor, p=1.0))
            
        elif method == 'hue_shift':
            params = method_parameters.get('hue_shift', {})
            max_shift = params.get('max_shift', 0.1)
            transforms.append(A.HueSaturationValue(hue_shift_limit=int(max_shift * 180), p=1.0))
            
        elif method == 'gaussian_noise':
            params = method_parameters.get('gaussian_noise', {})
            std = params.get('std', 0.01)
            transforms.append(A.GaussNoise(var_limit=(0, std * 255), p=1.0))
            
        elif method == 'gaussian_blur':
            params = method_parameters.get('gaussian_blur', {})
            kernel_size = params.get('kernel_size', 3)
            # Ensure kernel size is odd
            if kernel_size % 2 == 0:
                kernel_size += 1
            transforms.append(A.GaussianBlur(blur_limit=(kernel_size, kernel_size), p=1.0))
            
        elif method == 'cutout':
            params = method_parameters.get('cutout', {})
            num_holes = params.get('num_holes', 1)
            max_size = params.get('max_size', 16)
            transforms.append(A.CoarseDropout(
                max_holes=num_holes, 
                max_height=max_size, 
                max_width=max_size, 
                p=1.0
            ))
            
        elif method == 'elastic_transform':
            params = method_parameters.get('elastic_transform', {})
            alpha = params.get('alpha', 1.0)
            sigma = params.get('sigma', 50.0)
            transforms.append(A.ElasticTransform(alpha=alpha, sigma=sigma, p=1.0))
            
        elif method == 'grid_distortion':
            params = method_parameters.get('grid_distortion', {})
            num_steps = params.get('num_steps', 5)
            distort_limit = params.get('distort_limit', 0.3)
            transforms.append(A.GridDistortion(
                num_steps=num_steps, 
                distort_limit=distort_limit, 
                p=1.0
            ))
    
    # Return composed transform with bounding box support
    # Note: We don't use keypoint_params since we don't have keypoint annotations
    # If keypoint_params is set, Albumentations expects a 'keypoints' argument
    return A.Compose(
        transforms,
        bbox_params=A.BboxParams(
            format='coco',  # [x, y, width, height]
            label_fields=['class_labels'],
            min_visibility=0.3  # Minimum visibility threshold for bboxes
        )
    )


def load_image_from_path(image_path: str) -> np.ndarray:
    """Load image from file path and convert to RGB numpy array."""
    try:
        # Try to load with PIL first (better format support)
        pil_image = PILImage.open(image_path).convert('RGB')
        return np.array(pil_image)
    except Exception:
        # Fallback to OpenCV
        image = cv2.imread(image_path)
        if image is not None:
            return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        else:
            raise ValueError(f"Could not load image from {image_path}")


def save_image_to_path(image: np.ndarray, output_path: str) -> bool:
    """Save numpy array image to file path."""
    try:
        # Convert RGB to PIL Image and save
        pil_image = PILImage.fromarray(image.astype(np.uint8))
        pil_image.save(output_path, quality=95, optimize=True)
        return True
    except Exception as e:
        logger.error(f"Error saving image to {output_path}: {e}")
        return False


def transform_bbox_with_augmentation(
    bbox: List[float], 
    image_width: int, 
    image_height: int, 
    augmentation_methods: List[str],
    method_parameters: Dict[str, Any],
    augmented_result: Dict
) -> Optional[List[float]]:
    """
    Transform bounding box coordinates based on the augmentation applied.
    Returns transformed bbox or None if bbox is no longer valid.
    """
    if not bbox or len(bbox) < 4:
        return None
    
    # The augmented_result contains transformed_bboxes if we passed bboxes to the transform
    # Otherwise, we need to compute manually based on augmentation type
    x, y, w, h = bbox[:4]
    
    for method in augmentation_methods:
        if method == 'flip_horizontal':
            # For horizontal flip: new_x = image_width - (x + w)
            x = image_width - (x + w)
        elif method == 'flip_vertical':
            # For vertical flip: new_y = image_height - (y + h)
            y = image_height - (y + h)
        elif method == 'scale':
            # For scaling, the bbox scales proportionally
            params = method_parameters.get('scale', {})
            # The actual scale factor varies, so we skip this for now
            # as it's handled by Albumentations
            pass
        elif method == 'rotation':
            # Rotation is complex and requires proper matrix transformation
            # Albumentations handles this internally
            pass
    
    # Ensure bbox is valid
    if x < 0 or y < 0 or w <= 0 or h <= 0:
        return None
    
    return [x, y, w, h]


def transform_segmentation_with_augmentation(
    segmentation: List,
    image_width: int,
    image_height: int,
    augmentation_methods: List[str],
    method_parameters: Dict[str, Any]
) -> Optional[List]:
    """
    Transform segmentation polygon coordinates based on the augmentation applied.
    Returns transformed segmentation or None if invalid.
    """
    if not segmentation:
        return None
    
    transformed_segmentation = []
    
    for polygon in segmentation:
        if not polygon or len(polygon) < 6:  # Need at least 3 points (6 values)
            continue
        
        transformed_polygon = []
        # Polygon is flat list: [x1, y1, x2, y2, x3, y3, ...]
        for i in range(0, len(polygon), 2):
            x = polygon[i]
            y = polygon[i + 1] if i + 1 < len(polygon) else 0
            
            for method in augmentation_methods:
                if method == 'flip_horizontal':
                    x = image_width - x
                elif method == 'flip_vertical':
                    y = image_height - y
            
            transformed_polygon.extend([x, y])
        
        if len(transformed_polygon) >= 6:
            transformed_segmentation.append(transformed_polygon)
    
    return transformed_segmentation if transformed_segmentation else None


@celery_app.task(base=AugmentationTask, bind=True, name='app.tasks.augmentation_tasks.create_augmented_dataset')
def create_augmented_dataset_task(self, task_id: int):
    """
    Celery task to create an augmented dataset with Albumentations.
    This task is executed by Celery worker with proper queuing and progress updates.
    """
    logger.info(f"Starting augmentation task {task_id} (Celery task {self.request.id})")
    db = SessionLocal()
    
    try:
        # Get the task record
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if not task:
            raise Exception(f"Task {task_id} not found")
        
        # Check if task was cancelled before starting
        if task.status == 'cancelled' or task.status == 'stopped':
            logger.info(f"Task {task_id} was cancelled/stopped before starting")
            return {"status": "cancelled"}
        
        # Update task status to running
        task.status = 'running'
        task.started_at = datetime.utcnow()
        task.progress = 0.0
        task.task_metadata = {
            **(task.task_metadata or {}),
            "celery_task_id": self.request.id,
            "stage": "initializing"
        }
        db.commit()
        logger.info(f"Task {task_id}: Updated status to running")
        
        # Get the augmentation configuration
        augmentation = db.query(Augmentation).filter(Augmentation.task_id == task_id).first()
        if not augmentation:
            raise Exception(f"Augmentation configuration not found for task {task_id}")
        
        logger.info(f"Task {task_id}: Found augmentation config - factor: {augmentation.augmentation_factor}, methods: {augmentation.augmentation_methods}")
        
        # Update progress
        task.progress = 5.0
        task.task_metadata = {**(task.task_metadata or {}), "stage": "loading_datasets"}
        db.commit()
        
        # Check for cancellation
        db.refresh(task)
        if task.status in ['cancelled', 'stopped']:
            return {"status": "cancelled"}
        
        # Get source datasets
        source_datasets = db.query(Dataset).filter(
            Dataset.id.in_(augmentation.source_dataset_ids)
        ).all()
        
        if not source_datasets:
            raise Exception("No source datasets found")
        
        logger.info(f"Task {task_id}: Found {len(source_datasets)} source datasets")
        
        # Get target dataset
        target_dataset = db.query(Dataset).filter(
            Dataset.id == augmentation.target_dataset_id
        ).first()
        
        if not target_dataset:
            raise Exception("Target dataset not found")
        
        logger.info(f"Task {task_id}: Target dataset: {target_dataset.name}")
        
        # Update progress
        task.progress = 10.0
        task.task_metadata = {**(task.task_metadata or {}), "stage": "collecting_images"}
        db.commit()
        
        # Get all images from source datasets
        all_source_images = []
        for dataset in source_datasets:
            dataset_images = db.query(Image).filter(
                Image.dataset_id == dataset.id
            ).all()
            all_source_images.extend([(img, dataset.project_id) for img in dataset_images])
            logger.info(f"Task {task_id}: Found {len(dataset_images)} images in dataset {dataset.name}")
        
        if not all_source_images:
            raise Exception("No images found in source datasets")
        
        total_images = len(all_source_images)
        augmentation_factor = int(augmentation.augmentation_factor)
        total_operations = total_images * augmentation_factor
        
        logger.info(f"Task {task_id}: Total images: {total_images}, factor: {augmentation_factor}, total operations: {total_operations}")
        
        # Update progress
        task.progress = 15.0
        task.task_metadata = {
            **(task.task_metadata or {}), 
            "stage": "processing",
            "total_images": total_images,
            "augmentation_factor": augmentation_factor
        }
        db.commit()
        
        # Create target directory
        target_dir = Path("projects") / str(target_dataset.project_id) / str(target_dataset.id) / "images"
        target_dir.mkdir(parents=True, exist_ok=True)
        
        # Create annotation file for the augmented dataset
        method_names = "_".join(augmentation.augmentation_methods[:3])
        annotation_file = AnnotationFile(
            id=str(uuid.uuid4()),
            dataset_id=target_dataset.id,
            name=f"augmented_{method_names}",
            format='COCO',
            type='classification',  # Will be updated based on source annotations
            file_size=0,
            annotation_count=0,
            image_count=0,
            category_count=0,
            is_processed=True,
            processing_status='completed',
            created_at=datetime.utcnow()
        )
        db.add(annotation_file)
        db.flush()  # Get the annotation file ID
        
        # Track categories for annotation classes
        category_counts = {}
        annotation_type = 'classification'  # Default, will detect from source
        
        # Process images
        current_operation = 0
        processed_images = 0
        processed_annotations = 0
        errors = []
        
        for source_image, source_project_id in all_source_images:
            # Check for cancellation
            db.refresh(task)
            if task.status in ['cancelled', 'stopped']:
                logger.info(f"Task {task_id}: Cancelled during processing")
                return {"status": "cancelled", "processed": processed_images}
            
            try:
                # Find source image file
                source_path = None
                
                # Try new projects structure first
                new_source_path = Path("projects") / str(source_project_id) / str(source_image.dataset_id) / "images" / source_image.file_name
                if new_source_path.exists():
                    source_path = new_source_path
                
                # Fall back to old data structure
                if source_path is None:
                    old_source_path = Path("data") / "images" / str(source_image.dataset_id) / source_image.file_name
                    if old_source_path.exists():
                        source_path = old_source_path
                
                if source_path is None:
                    logger.warning(f"Task {task_id}: Source image not found: {source_image.file_name}")
                    errors.append(f"Image not found: {source_image.file_name}")
                    current_operation += augmentation_factor
                    continue
                
                # Load the source image
                image_data = load_image_from_path(str(source_path))
                image_height, image_width = image_data.shape[:2]
                
                # Get source annotations for this image
                source_annotations = db.query(Annotation).filter(
                    Annotation.image_id == source_image.id
                ).all()
                
                # Prepare bboxes and labels for Albumentations
                bboxes = []
                class_labels = []
                annotation_data_list = []
                classification_annotations = []  # Annotations without bboxes (classification)
                
                for ann in source_annotations:
                    if ann.bbox and len(ann.bbox) >= 4:
                        # Albumentations COCO format: [x, y, width, height]
                        x, y, w, h = ann.bbox[:4]
                        # Clamp bbox to image bounds
                        x = max(0, min(x, image_width))
                        y = max(0, min(y, image_height))
                        w = min(w, image_width - x)
                        h = min(h, image_height - y)
                        
                        if w > 0 and h > 0:
                            bboxes.append([x, y, w, h])
                            class_labels.append(ann.category or 'unknown')
                            annotation_data_list.append({
                                'category': ann.category,
                                'segmentation': ann.segmentation,
                                'area': ann.area,
                                'category_id': ann.category_id
                            })
                    else:
                        # Classification annotation (no bbox) - store for copying
                        classification_annotations.append(ann)
                
                # Create augmented versions
                for i in range(augmentation_factor):
                    # Check for cancellation
                    db.refresh(task)
                    if task.status in ['cancelled', 'stopped']:
                        return {"status": "cancelled", "processed": processed_images}
                    
                    try:
                        # Create the augmentation pipeline
                        transform = create_albumentations_transform(
                            augmentation.augmentation_methods,
                            augmentation.method_parameters or {}
                        )
                        
                        # Apply augmentation
                        if bboxes and augmentation.transform_annotations:
                            augmented = transform(
                                image=image_data, 
                                bboxes=bboxes, 
                                class_labels=class_labels
                            )
                            transformed_bboxes = augmented['bboxes']
                            transformed_labels = augmented['class_labels']
                        else:
                            augmented = transform(image=image_data)
                            transformed_bboxes = []
                            transformed_labels = []
                        
                        augmented_image = augmented['image']
                        aug_height, aug_width = augmented_image.shape[:2]
                        
                        # Generate output filename
                        method_suffix = "_".join(augmentation.augmentation_methods[:2])
                        base_name = Path(source_image.file_name).stem
                        extension = Path(source_image.file_name).suffix or '.jpg'
                        file_name = f"aug_{i}_{method_suffix}_{base_name}{extension}"
                        
                        # Save augmented image
                        output_path = target_dir / file_name
                        success = save_image_to_path(augmented_image, str(output_path))
                        
                        if not success:
                            errors.append(f"Failed to save: {file_name}")
                            continue
                        
                        # Get file size
                        file_size = output_path.stat().st_size if output_path.exists() else 0
                        
                        # Create augmented image record
                        relative_url = f"/static/projects/{target_dataset.project_id}/{target_dataset.id}/images/{file_name}"
                        
                        augmented_image_record = Image(
                            dataset_id=target_dataset.id,
                            file_name=file_name,
                            file_size=file_size,
                            width=aug_width,
                            height=aug_height,
                            url=relative_url,
                            thumbnail_url=relative_url,
                            uploaded_at=datetime.utcnow()
                        )
                        db.add(augmented_image_record)
                        db.flush()  # Get the image ID
                        
                        # Create AnnotationFileImage entry
                        annotation_file_image = AnnotationFileImage(
                            annotation_file_id=annotation_file.id,
                            file_name=file_name,
                            dataset_image_id=augmented_image_record.id,
                            width=aug_width,
                            height=aug_height,
                            created_at=datetime.utcnow()
                        )
                        db.add(annotation_file_image)
                        
                        # Create annotations for augmented image
                        if augmentation.transform_annotations and transformed_bboxes:
                            for bbox_idx, (bbox, label) in enumerate(zip(transformed_bboxes, transformed_labels)):
                                if bbox_idx < len(annotation_data_list):
                                    ann_data = annotation_data_list[bbox_idx]
                                    
                                    # Transform segmentation if present
                                    transformed_seg = None
                                    if ann_data.get('segmentation'):
                                        transformed_seg = transform_segmentation_with_augmentation(
                                            ann_data['segmentation'],
                                            aug_width,
                                            aug_height,
                                            augmentation.augmentation_methods,
                                            augmentation.method_parameters or {}
                                        )
                                    
                                    # Calculate new area and convert numpy types to Python floats
                                    new_area = float(bbox[2] * bbox[3]) if len(bbox) >= 4 else ann_data.get('area')
                                    
                                    # Convert bbox values to Python floats (Albumentations returns numpy types)
                                    bbox_list = [float(v) for v in bbox]
                                    
                                    new_annotation = Annotation(
                                        annotation_file_id=annotation_file.id,
                                        image_id=augmented_image_record.id,
                                        dataset_id=target_dataset.id,
                                        category=label,
                                        category_id=ann_data.get('category_id'),
                                        bbox=bbox_list,
                                        bbox_x=float(bbox[0] / aug_width) if aug_width > 0 else 0,
                                        bbox_y=float(bbox[1] / aug_height) if aug_height > 0 else 0,
                                        bbox_width=float(bbox[2] / aug_width) if aug_width > 0 else 0,
                                        bbox_height=float(bbox[3] / aug_height) if aug_height > 0 else 0,
                                        segmentation=transformed_seg,
                                        area=float(new_area) if new_area is not None else None,
                                        uploaded_at=datetime.utcnow()
                                    )
                                    db.add(new_annotation)
                                    processed_annotations += 1
                                    
                                    # Track category counts and detect annotation type
                                    annotation_type = 'detection' if transformed_seg else 'detection'
                                    if ann_data.get('segmentation'):
                                        annotation_type = 'segmentation'
                                    category_counts[label] = category_counts.get(label, 0) + 1
                        
                        # Copy classification annotations (no bbox) - they apply to the whole image
                        if classification_annotations:
                            for ann in classification_annotations:
                                new_annotation = Annotation(
                                    annotation_file_id=annotation_file.id,
                                    image_id=augmented_image_record.id,
                                    dataset_id=target_dataset.id,
                                    category=ann.category,
                                    category_id=ann.category_id,
                                    bbox=None,
                                    bbox_x=None,
                                    bbox_y=None,
                                    bbox_width=None,
                                    bbox_height=None,
                                    segmentation=None,
                                    area=None,
                                    uploaded_at=datetime.utcnow()
                                )
                                db.add(new_annotation)
                                processed_annotations += 1
                                
                                # Track category counts
                                category_counts[ann.category] = category_counts.get(ann.category, 0) + 1
                        
                        # Copy annotations without transformation if disabled
                        if not augmentation.transform_annotations and source_annotations:
                            for ann in source_annotations:
                                new_annotation = Annotation(
                                    annotation_file_id=annotation_file.id,
                                    image_id=augmented_image_record.id,
                                    dataset_id=target_dataset.id,
                                    category=ann.category,
                                    category_id=ann.category_id,
                                    bbox=ann.bbox,
                                    bbox_x=ann.bbox_x,
                                    bbox_y=ann.bbox_y,
                                    bbox_width=ann.bbox_width,
                                    bbox_height=ann.bbox_height,
                                    segmentation=ann.segmentation,
                                    area=ann.area,
                                    uploaded_at=datetime.utcnow()
                                )
                                db.add(new_annotation)
                                processed_annotations += 1
                                
                                # Track category counts and detect annotation type
                                if ann.bbox:
                                    annotation_type = 'segmentation' if ann.segmentation else 'detection'
                                category_counts[ann.category] = category_counts.get(ann.category, 0) + 1
                        
                        processed_images += 1
                        current_operation += 1
                        
                    except Exception as e:
                        logger.error(f"Task {task_id}: Error processing augmentation {i} for {source_image.file_name}: {e}")
                        errors.append(f"Augmentation {i} failed for {source_image.file_name}: {str(e)}")
                        current_operation += 1
                
                # Update progress periodically
                if current_operation % 10 == 0:
                    progress = 15.0 + (current_operation / total_operations) * 75.0
                    task.progress = min(progress, 90.0)
                    task.task_metadata = {
                        **(task.task_metadata or {}),
                        "stage": "processing",
                        "processed_images": processed_images,
                        "processed_annotations": processed_annotations,
                        "current_operation": current_operation,
                        "total_operations": total_operations,
                        "errors_count": len(errors)
                    }
                    db.commit()
                    
                    # Update Celery task state
                    self.update_state(
                        state='PROGRESS',
                        meta={
                            'progress': task.progress,
                            'processed': processed_images,
                            'total': total_operations
                        }
                    )
                    
            except Exception as e:
                logger.error(f"Task {task_id}: Error processing image {source_image.file_name}: {e}")
                errors.append(f"Failed to process {source_image.file_name}: {str(e)}")
                current_operation += augmentation_factor
        
        # Final check for cancellation
        db.refresh(task)
        if task.status in ['cancelled', 'stopped']:
            return {"status": "cancelled", "processed": processed_images}
        
        # Update dataset counts
        task.progress = 95.0
        task.task_metadata = {**(task.task_metadata or {}), "stage": "finalizing"}
        db.commit()
        
        target_dataset.image_count = db.query(Image).filter(
            Image.dataset_id == target_dataset.id
        ).count()
        
        # Update image annotation counts
        for img in db.query(Image).filter(Image.dataset_id == target_dataset.id).all():
            img.annotations_count = db.query(Annotation).filter(
                Annotation.image_id == img.id
            ).count()
        
        # Update annotation file statistics
        annotation_file.annotation_count = processed_annotations
        annotation_file.image_count = processed_images
        annotation_file.category_count = len(category_counts)
        annotation_file.type = annotation_type
        annotation_file.statistics = {
            "category_distribution": category_counts
        }
        
        # Create AnnotationClass entries for each category
        for category_name, count in category_counts.items():
            ann_class = AnnotationClass(
                annotation_file_id=annotation_file.id,
                class_name=category_name,
                count=count,
                created_at=datetime.utcnow()
            )
            db.add(ann_class)
        
        db.commit()
        
        # Complete the task
        task.status = 'completed'
        task.progress = 100.0
        task.completed_at = datetime.utcnow()
        task.task_metadata = {
            **(task.task_metadata or {}),
            "stage": "completed",
            "processed_images": processed_images,
            "processed_annotations": processed_annotations,
            "errors": errors[:10] if errors else [],  # Keep first 10 errors
            "errors_count": len(errors)
        }
        db.commit()
        
        logger.info(f"Task {task_id}: Completed successfully. Processed {processed_images} images, {processed_annotations} annotations, {len(errors)} errors")
        
        return {
            "status": "completed",
            "processed_images": processed_images,
            "processed_annotations": processed_annotations,
            "errors_count": len(errors)
        }
        
    except Exception as e:
        logger.error(f"Task {task_id}: Fatal error: {e}", exc_info=True)
        
        # Update task status
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if task and task.status not in ['cancelled', 'stopped']:
            task.status = 'failed'
            task.completed_at = datetime.utcnow()
            task.error_message = str(e)
            task.task_metadata = {
                **(task.task_metadata or {}),
                "stage": "failed",
                "error": str(e)
            }
            db.commit()
        
        raise
        
    finally:
        db.close()
