from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from datetime import datetime
import os
import json
import shutil
from pathlib import Path
import logging

from ..database import get_db, SessionLocal
from ..models import Task, Dataset, AnnotationFile, Image, Annotation, AnnotationClass, ImageCollection
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)

# Check if Celery is available
USE_CELERY = os.environ.get('USE_CELERY', 'true').lower() == 'true'
celery_train_task = None
celery_rtdetr_task = None

if USE_CELERY:
    try:
        from app.tasks.training_tasks import train_yolo_model as celery_train_task
        from app.tasks.training_tasks import train_rtdetr_model as celery_rtdetr_task
        logger.info("Celery task queue enabled for training")
    except ImportError as e:
        logger.warning(f"Celery not available: {e}. Set USE_CELERY=false to disable.")
        USE_CELERY = False


class YoloTrainingRequest(BaseModel):
    """Request model for YOLO training"""
    project_id: int
    dataset_configs: List[Dict[str, Any]]  # List of {dataset_id, annotation_file_id, image_collection, split: {train, val, test}}
    model_type: str = "yolo11n-seg.pt"  # YOLO model variant
    epochs: int = 100
    batch_size: int = 16
    image_size: int = 640
    device: str = "0"  # GPU device or "cpu"
    task_name: Optional[str] = None
    # Additional YOLO training parameters
    patience: int = 50
    optimizer: str = "auto"
    learning_rate: float = 0.01
    momentum: float = 0.937
    weight_decay: float = 0.0005
    save_period: int = -1  # -1 = only best and last, or save every N epochs
    augmentations: Optional[Dict[str, Any]] = None  # Augmentation settings
    # Weights & Biases integration
    use_wandb: bool = False
    wandb_project: Optional[str] = None
    wandb_entity: Optional[str] = None


class RTDETRTrainingRequest(BaseModel):
    """Request model for RT-DETR training"""
    project_id: int
    dataset_configs: List[Dict[str, Any]]
    model_type: str = "rtdetr-l.pt"  # RT-DETR model variant (rtdetr-l.pt or rtdetr-x.pt)
    epochs: int = 100
    batch_size: int = 16
    image_size: int = 640
    device: str = "0"
    task_name: Optional[str] = None
    # RT-DETR specific parameters
    patience: int = 50
    optimizer: str = "AdamW"
    learning_rate: float = 0.0001
    weight_decay: float = 0.0001
    save_period: int = -1  # -1 = only best and last, or save every N epochs
    # Weights & Biases integration
    use_wandb: bool = False
    wandb_project: Optional[str] = None
    wandb_entity: Optional[str] = None


def prepare_yolo_dataset(
    db: Session,
    dataset_configs: List[Dict[str, Any]],
    output_dir: Path,
    model_type: str = "yolo11n-seg.pt"
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
    # Determine if this is a segmentation model
    is_segmentation_model = '-seg' in model_type.lower()
    
    # Track skipped annotations
    skipped_annotations = {'missing_seg': 0, 'missing_bbox': 0, 'missing_both': 0}
    
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
                
                dst_image_path = img_dir / src_image_path.name
                
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
                    
                    # Get image dimensions
                    img_width = image.width or 1
                    img_height = image.height or 1
                    
                    # Handle segmentation if present
                    if annotation.segmentation:
                        seg = annotation.segmentation
                        if isinstance(seg, list) and len(seg) > 0:
                            # Polygon format: [[x1, y1, x2, y2, ...]] or [x1, y1, x2, y2, ...]
                            if isinstance(seg[0], list):
                                polygon = seg[0]
                            else:
                                polygon = seg
                            
                            # Only process if polygon has valid data
                            if len(polygon) >= 6:  # At least 3 points (6 coordinates)
                                # Check if coordinates are already normalized (0-1) or in pixel coordinates
                                # If any value is > 2, assume pixel coordinates that need normalization
                                needs_normalization = any(abs(val) > 2 for val in polygon)
                                
                                normalized_coords = []
                                if needs_normalization:
                                    # Pixel coordinates - normalize them
                                    for i in range(0, len(polygon), 2):
                                        if i + 1 < len(polygon):
                                            norm_x = polygon[i] / img_width
                                            norm_y = polygon[i + 1] / img_height
                                            normalized_coords.extend([norm_x, norm_y])
                                else:
                                    # Already normalized - use as is
                                    normalized_coords = polygon
                                
                                # YOLO segmentation format: class_id x1 y1 x2 y2 ...
                                if normalized_coords and len(normalized_coords) >= 6:
                                    coords_str = ' '.join(f"{c:.6f}" for c in normalized_coords)
                                    label_lines.append(f"{class_id} {coords_str}")
                                    has_segmentation = True
                                    continue  # Skip bbox processing for this annotation
                    
                    # Handle bbox (COCO format: [x, y, width, height])
                    elif annotation.bbox:
                        has_bbox_only = True
                        bbox = annotation.bbox
                        if isinstance(bbox, list) and len(bbox) == 4:
                            x, y, w, h = bbox
                        elif isinstance(bbox, dict):
                            x = bbox.get('x', 0)
                            y = bbox.get('y', 0)
                            w = bbox.get('width', 0)
                            h = bbox.get('height', 0)
                        else:
                            # Try individual fields
                            x = annotation.bbox_x or 0
                            y = annotation.bbox_y or 0
                            w = annotation.bbox_width or 0
                            h = annotation.bbox_height or 0
                        
                        # Convert to YOLO format (normalized center x, center y, width, height)
                        x_center = (x + w / 2) / img_width
                        y_center = (y + h / 2) / img_height
                        norm_w = w / img_width
                        norm_h = h / img_height
                        
                        # YOLO detection format
                        label_lines.append(f"{class_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}")
                    
                    # Try individual bbox fields if bbox JSON is not present
                    elif annotation.bbox_x is not None and annotation.bbox_width is not None:
                        x = annotation.bbox_x
                        y = annotation.bbox_y or 0
                        w = annotation.bbox_width
                        h = annotation.bbox_height or 0
                        
                        # Convert to YOLO format (normalized center x, center y, width, height)
                        x_center = (x + w / 2) / img_width
                        y_center = (y + h / 2) / img_height
                        norm_w = w / img_width
                        norm_h = h / img_height
                        
                        # YOLO detection format
                        label_lines.append(f"{class_id} {x_center:.6f} {y_center:.6f} {norm_w:.6f} {norm_h:.6f}")
                
                # Write label file
                if label_lines:
                    label_path = lbl_dir / (src_image_path.stem + '.txt')
                    with open(label_path, 'w') as f:
                        f.write('\n'.join(label_lines))
                
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
        'image_counts': total_images
    }


async def train_yolo_model_task(
    task_id: int,
    training_config: Dict[str, Any]
):
    """Background task to train YOLO model with progress updates"""
    logger.info(f"Starting YOLO training task {task_id}")
    db = SessionLocal()
    
    # Custom callback for progress updates
    class ProgressCallback:
        def __init__(self, task_id: int, total_epochs: int):
            self.task_id = task_id
            self.total_epochs = total_epochs
            self.current_epoch = 0
            
        def on_train_epoch_end(self, trainer):
            """Called at the end of each training epoch"""
            self.current_epoch = trainer.epoch + 1
            # Progress: 40% (loading) + 50% (training) + 10% (saving)
            progress = 40 + int((self.current_epoch / self.total_epochs) * 50)
            
            # Update task in database
            db_local = SessionLocal()
            try:
                task = db_local.query(Task).filter(Task.id == self.task_id).first()
                if task:
                    task.progress = min(progress, 90)
                    task.task_metadata = {
                        **(task.task_metadata or {}),
                        "current_epoch": self.current_epoch,
                        "total_epochs": self.total_epochs,
                        "stage": "training"
                    }
                    db_local.commit()
                    logger.info(f"Task {self.task_id}: Epoch {self.current_epoch}/{self.total_epochs} - Progress: {progress}%")
            except Exception as e:
                logger.error(f"Failed to update progress: {e}")
            finally:
                db_local.close()
    
    try:
        # Update task status
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            logger.error(f"Task {task_id} not found")
            return
        
        task.status = "running"
        task.started_at = datetime.utcnow()
        db.commit()
        
        # Prepare dataset
        logger.info(f"Preparing dataset for task {task_id}")
        task.progress = 10
        task.task_metadata = {"stage": "preparing_dataset"}
        db.commit()
        
        # Create output directory
        output_base = Path("projects") / str(training_config['project_id']) / "training" / f"task_{task_id}"
        output_base.mkdir(parents=True, exist_ok=True)
        
        dataset_dir = output_base / "dataset"
        model_type = training_config.get('model_type', 'yolo11n-seg.pt')
        dataset_info = prepare_yolo_dataset(
            db,
            training_config['dataset_configs'],
            dataset_dir,
            model_type=model_type
        )
        
        logger.info(f"Dataset prepared: {dataset_info}")
        task.progress = 30
        task.task_metadata = {
            "stage": "dataset_prepared",
            "dataset_info": dataset_info
        }
        db.commit()
        
        # Import ultralytics and train
        try:
            from ultralytics import YOLO
        except ImportError:
            raise Exception("ultralytics package not installed. Install with: pip install ultralytics")
        
        # Initialize model
        model_type = training_config.get('model_type', 'yolo11n-seg.pt')
        logger.info(f"Loading YOLO model: {model_type}")
        
        # Check if model file exists in project root, otherwise use pretrained
        model_path = Path(model_type)
        if not model_path.exists():
            # Use model name directly, ultralytics will download if needed
            model_path = model_type
        
        model = YOLO(str(model_path))
        
        # Add progress callback
        total_epochs = training_config.get('epochs', 100)
        progress_callback = ProgressCallback(task_id, total_epochs)
        
        # Add callback to model
        model.add_callback("on_train_epoch_end", progress_callback.on_train_epoch_end)
        
        task.progress = 40
        task.task_metadata = {
            **task.task_metadata,
            "stage": "training",
            "model_loaded": str(model_path),
            "total_epochs": total_epochs
        }
        db.commit()
        
        # Set up training arguments
        train_args = {
            'data': dataset_info['yaml_path'],
            'epochs': total_epochs,
            'batch': training_config.get('batch_size', 16),
            'imgsz': training_config.get('image_size', 640),
            'device': training_config.get('device', '0'),
            'patience': training_config.get('patience', 50),
            'optimizer': training_config.get('optimizer', 'auto'),
            'lr0': training_config.get('learning_rate', 0.01),
            'momentum': training_config.get('momentum', 0.937),
            'weight_decay': training_config.get('weight_decay', 0.0005),
            'project': str(output_base),
            'name': 'training',
            'exist_ok': True,
            'save': True,
            'save_period': 10,  # Save checkpoint every 10 epochs
            'verbose': True,
        }
        
        # Add W&B if enabled
        if training_config.get('use_wandb'):
            train_args['project'] = training_config.get('wandb_project', f"yolo_training_{task_id}")
            if training_config.get('wandb_entity'):
                train_args['entity'] = training_config['wandb_entity']
        
        logger.info(f"Starting training with args: {train_args}")
        
        # Train the model
        results = model.train(**train_args)
        
        task.progress = 90
        task.task_metadata = {
            **task.task_metadata,
            "stage": "training_completed",
            "results_saved": str(output_base / "training")
        }
        db.commit()
        
        # Save final model and results info
        best_model_path = output_base / "training" / "weights" / "best.pt"
        last_model_path = output_base / "training" / "weights" / "last.pt"
        
        task.status = "completed"
        task.completed_at = datetime.utcnow()
        task.progress = 100
        task.task_metadata = {
            **task.task_metadata,
            "stage": "completed",
            "best_model": str(best_model_path) if best_model_path.exists() else None,
            "last_model": str(last_model_path) if last_model_path.exists() else None,
            "class_names": dataset_info['class_names'],
            "class_count": dataset_info['class_count'],
            "image_counts": dataset_info['image_counts'],
            "results_dir": str(output_base / "training")
        }
        db.commit()
        
        logger.info(f"Training completed successfully for task {task_id}")
        
    except Exception as e:
        logger.error(f"Error in training task {task_id}: {str(e)}", exc_info=True)
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            task.status = "failed"
            task.completed_at = datetime.utcnow()
            task.error_message = str(e)
            task.task_metadata = {
                **(task.task_metadata or {}),
                "stage": "failed",
                "error": str(e)
            }
            db.commit()
    finally:
        db.close()


@router.post("/training/yolo/start")
async def start_yolo_training(
    request: YoloTrainingRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Start YOLO model training using Celery task queue.
    """
    try:
        # Validate datasets exist
        for config in request.dataset_configs:
            dataset = db.query(Dataset).filter(Dataset.id == config['dataset_id']).first()
            if not dataset:
                raise HTTPException(status_code=404, detail=f"Dataset {config['dataset_id']} not found")
            
            ann_file = db.query(AnnotationFile).filter(
                AnnotationFile.id == config['annotation_file_id']
            ).first()
            if not ann_file:
                raise HTTPException(
                    status_code=404,
                    detail=f"Annotation file {config['annotation_file_id']} not found"
                )
        
        # Create task
        task_name = request.task_name or f"YOLO Training - {request.model_type}"
        
        # Prepare dataset configs with names for metadata
        dataset_configs_with_names = []
        for config in request.dataset_configs:
            dataset = db.query(Dataset).filter(Dataset.id == config['dataset_id']).first()
            ann_file = db.query(AnnotationFile).filter(
                AnnotationFile.id == config['annotation_file_id']
            ).first()
            
            dataset_configs_with_names.append({
                'dataset_id': config['dataset_id'],
                'dataset_name': dataset.name if dataset else None,
                'annotation_file_id': config['annotation_file_id'],
                'annotation_file_name': ann_file.name if ann_file else None,
                'image_collection': config.get('image_collection'),
                'split': config.get('split', {'train': 80, 'val': 20, 'test': 0})
            })
        
        task = Task(
            name=task_name,
            description=f"Training YOLO model with {len(request.dataset_configs)} dataset(s)",
            task_type="yolo_training",
            status="pending",
            project_id=request.project_id,
            progress=0,
            task_metadata={
                "model_type": request.model_type,
                "epochs": request.epochs,
                "batch_size": request.batch_size,
                "image_size": request.image_size,
                "dataset_count": len(request.dataset_configs),
                "dataset_ids": [config['dataset_id'] for config in request.dataset_configs],
                "dataset_configs": dataset_configs_with_names,
                "training_params": {
                    "batch_size": request.batch_size,
                    "epochs": request.epochs,
                    "image_size": request.image_size,
                    "imgsz": request.image_size,
                    "device": request.device,
                    "optimizer": request.optimizer,
                    "lr0": request.learning_rate,
                    "momentum": request.momentum,
                    "weight_decay": request.weight_decay,
                    "save_period": request.save_period,
                    "patience": request.patience
                },
                "model_config": {
                    "model": request.model_type,
                    "task": "detect",
                    "augmentations": request.augmentations or {}
                }
            }
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        
        # Prepare training config
        training_config = {
            'project_id': request.project_id,
            'dataset_configs': request.dataset_configs,
            'model_type': request.model_type,
            'epochs': request.epochs,
            'batch_size': request.batch_size,
            'image_size': request.image_size,
            'device': request.device,
            'patience': request.patience,
            'optimizer': request.optimizer,
            'learning_rate': request.learning_rate,
            'momentum': request.momentum,
            'weight_decay': request.weight_decay,
            'save_period': request.save_period,
            'augmentations': request.augmentations or {},
            'use_wandb': request.use_wandb,
            'wandb_project': request.wandb_project,
            'wandb_entity': request.wandb_entity,
        }
        
        # Start background task
        if USE_CELERY:
            # Use Celery for proper task queuing
            celery_task = celery_train_task.delay(task.id, training_config)
            logger.info(f"Queued training task {task.id} in Celery (task_id: {celery_task.id})")
            
            # Store Celery task ID in metadata
            task.task_metadata = {
                **task.task_metadata,
                "celery_task_id": celery_task.id
            }
            db.commit()
        else:
            # Fallback to FastAPI BackgroundTasks (not recommended for production)
            logger.warning("Using BackgroundTasks instead of Celery - tasks may run concurrently!")
            background_tasks.add_task(
                train_yolo_model_task,
                task.id,
                training_config
            )
        
        return {
            "success": True,
            "task_id": task.id,
            "message": "YOLO training started",
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
        logger.error(f"Error starting YOLO training: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/training/task/{task_id}/status")
async def get_training_status(task_id: int, db: Session = Depends(get_db)):
    """Get the status of a training task"""
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return {
        "success": True,
        "task": {
            "id": task.id,
            "name": task.name,
            "status": task.status,
            "progress": task.progress,
            "created_at": task.created_at.isoformat() if task.created_at else None,
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None,
            "error_message": task.error_message,
            "metadata": task.task_metadata
        }
    }


@router.post("/training/rtdetr")
async def start_rtdetr_training(
    request: RTDETRTrainingRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Start RT-DETR model training using Celery task queue.
    """
    try:
        # Create task record first to get task_id
        task_name = request.task_name or f"RT-DETR Training - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        task = Task(
            project_id=request.project_id,
            name=task_name,
            task_type="training",
            status="queued",
            progress=0,
            task_metadata={
                "model_type": "rtdetr",
                "model_variant": request.model_type,
                "training_params": request.dict(exclude={'project_id', 'dataset_configs', 'task_name'}),
                "dataset_configs": request.dataset_configs,
            }
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        
        # Create output directory using task_id (same as YOLO)
        output_dir = Path(f"projects/{request.project_id}/training/task_{task.id}")
        output_dir.mkdir(parents=True, exist_ok=True)
        
        dataset_info = prepare_yolo_dataset(  # RT-DETR uses YOLO format
            db=db,
            dataset_configs=request.dataset_configs,
            output_dir=output_dir,
            model_type=request.model_type
        )
        
        # Create data.yaml for RT-DETR
        data_yaml = {
            'path': str(output_dir.absolute()),
            'train': 'images/train',
            'val': 'images/val',
            'test': 'images/test',
            'names': {i: name for i, name in enumerate(dataset_info['class_names'])},
            'nc': len(dataset_info['class_names'])
        }
        
        yaml_path = output_dir / "data.yaml"
        with open(yaml_path, 'w') as f:
            import yaml
            yaml.dump(data_yaml, f)
        
        # Update task with dataset info
        task.task_metadata = {
            **task.task_metadata,
            "output_dir": str(output_dir),
            "data_yaml": str(yaml_path),
            "num_classes": len(dataset_info['class_names']),
            "classes": dataset_info['class_names']
        }
        db.commit()
        db.refresh(task)
        
        training_config = {
            "task_id": task.id,
            "model_type": request.model_type,
            "data_yaml": str(yaml_path),
            "epochs": request.epochs,
            "batch_size": request.batch_size,
            "image_size": request.image_size,
            "device": request.device,
            "output_dir": str(output_dir),
            "patience": request.patience,
            "optimizer": request.optimizer,
            "learning_rate": request.learning_rate,
            "weight_decay": request.weight_decay,
            "use_wandb": request.use_wandb,
            "wandb_project": request.wandb_project,
            "wandb_entity": request.wandb_entity
        }
        
        if USE_CELERY:
            celery_task = celery_rtdetr_task.delay(task.id, training_config)
            logger.info(f"Queued RT-DETR training task {task.id} in Celery (task_id: {celery_task.id})")
            
            task.task_metadata = {
                **task.task_metadata,
                "celery_task_id": celery_task.id
            }
            db.commit()
        else:
            logger.warning("Using BackgroundTasks instead of Celery - tasks may run concurrently!")
            # Note: Would need to implement background task handler for RT-DETR
            raise HTTPException(status_code=500, detail="RT-DETR training requires Celery")
        
        return {
            "success": True,
            "task_id": task.id,
            "message": "RT-DETR training started",
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
        logger.error(f"Error starting RT-DETR training: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

