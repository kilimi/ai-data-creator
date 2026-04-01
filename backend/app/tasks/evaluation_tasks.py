"""
Celery tasks for model evaluation.
"""
import os
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional
import numpy as np
import time
from PIL import Image as PILImage

from celery import Task
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.evaluation_artifacts import write_evaluation_blobs
from app.models import Task as TaskModel, Annotation, AnnotationClass, AnnotationFile, Dataset, Image

logger = logging.getLogger(__name__)

# Database setup for Celery workers
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@db/lai_db')
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class EvaluationTask(Task):
    """Base task for evaluation with progress tracking"""
    
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Called when task fails"""
        logger.error(f"Evaluation task {task_id} failed: {exc}")
        
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


def calculate_iou(box1: List[float], box2: List[float]) -> float:
    """Calculate IoU between two boxes [x1, y1, x2, y2]"""
    x1 = max(box1[0], box2[0])
    y1 = max(box1[1], box2[1])
    x2 = min(box1[2], box2[2])
    y2 = min(box1[3], box2[3])
    
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    area1 = (box1[2] - box1[0]) * (box1[3] - box1[1])
    area2 = (box2[2] - box2[0]) * (box2[3] - box2[1])
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0


def generate_grid_tiles(image_width: int, image_height: int, tile_size: int, overlap: float) -> List[Dict[str, int]]:
    """
    Generate grid tiles with overlap for an image
    Returns list of tiles with coordinates: [{x, y, width, height}, ...]
    """
    tiles = []
    stride = int(tile_size * (1 - overlap))
    
    for y in range(0, image_height, stride):
        for x in range(0, image_width, stride):
            # Calculate tile bounds
            tile_x = x
            tile_y = y
            tile_w = min(tile_size, image_width - x)
            tile_h = min(tile_size, image_height - y)
            
            # Only add tiles that are at least 50% of the tile_size in both dimensions
            if tile_w >= tile_size * 0.5 and tile_h >= tile_size * 0.5:
                tiles.append({
                    'x': tile_x,
                    'y': tile_y,
                    'width': tile_w,
                    'height': tile_h
                })
    
    return tiles


def nms_predictions(predictions: List[Dict], iou_threshold: float = 0.5) -> List[Dict]:
    """
    Apply Non-Maximum Suppression to merge overlapping predictions from grid tiles
    """
    if not predictions:
        return []
    
    # Sort by confidence score (descending)
    predictions = sorted(predictions, key=lambda x: x['conf'], reverse=True)
    
    keep = []
    while predictions:
        # Take the prediction with highest confidence
        current = predictions.pop(0)
        keep.append(current)
        
        # Remove predictions that overlap significantly with current
        filtered = []
        for pred in predictions:
            # Only compare predictions of the same class
            if pred['class_id'] != current['class_id']:
                filtered.append(pred)
                continue
            
            # Calculate IoU
            iou = calculate_iou(current['bbox_xyxy'], pred['bbox_xyxy'])
            
            # Keep if IoU is below threshold
            if iou < iou_threshold:
                filtered.append(pred)
        
        predictions = filtered
    
    return keep


@celery_app.task(base=EvaluationTask, bind=True, name='app.tasks.evaluation_tasks.evaluate_model')
def evaluate_model(
    self,
    task_id: int,
    training_task_id: int,
    dataset_id: int,
    annotation_file_id: Optional[str],
    checkpoint: str,
    conf_threshold: float,
    iou_threshold: float,
    use_grid: bool = False,
    grid_size: int = 640,
    grid_overlap: float = 0.2,
    ignored_classes: Optional[List[str]] = None
):
    """
    Run model evaluation as a background task
    Supports grid-based inference for high-resolution images
    ignored_classes: List of class names to ignore when calculating metrics
    """
    db = SessionLocal()
    task = None
    
    try:
        # Get the task record
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} not found")
        
        # Update task status
        task.status = 'running'
        task.progress = 0
        task.task_metadata = {
            **task.task_metadata,
            'stage': 'initializing',
            'celery_task_id': self.request.id
        }
        db.commit()
        
        # Import YOLO here to avoid loading it at module level
        from ultralytics import YOLO
        
        # Get the training task
        training_task = db.query(TaskModel).filter(TaskModel.id == training_task_id).first()
        if not training_task or training_task.status != 'completed':
            raise ValueError("Training task not found or not completed")
        
        # Get model path from training task metadata
        task_metadata = training_task.task_metadata or {}
        model_path = None
        
        if checkpoint == "best":
            model_path = task_metadata.get('best_model')
        else:
            last_model = task_metadata.get('last_model')
            if last_model:
                model_path = last_model
            elif task_metadata.get('results_dir'):
                model_path = str(Path(task_metadata['results_dir']) / "weights" / "last.pt")
        
        if not model_path or not Path(model_path).exists():
            raise ValueError(f"Model checkpoint '{checkpoint}' not found")
        
        logger.info(f"Loading model from {model_path}")
        task.progress = 10
        task.task_metadata = {**task.task_metadata, 'stage': 'loading_model'}
        db.commit()
        
        # Load model
        model = YOLO(model_path)
        
        # Get dataset
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            raise ValueError("Dataset not found")
        
        # Get class names from training task
        class_names = task_metadata.get('class_names', [])
        if not class_names:
            raise ValueError("No class names found in training task")
        
        num_classes = len(class_names)
        
        task.progress = 20
        task.task_metadata = {**task.task_metadata, 'stage': 'loading_annotations'}
        db.commit()
        
        # Check if ground truth is available
        has_ground_truth = False
        ground_truth_annotations = {}
        
        if annotation_file_id:
            annotation_file = db.query(AnnotationFile).filter(
                AnnotationFile.id == annotation_file_id
            ).first()
            
            if annotation_file:
                has_ground_truth = True
                annotations = db.query(Annotation).filter(
                    Annotation.annotation_file_id == annotation_file_id
                ).all()
                
                logger.info(f"Loading {len(annotations)} ground truth annotations from annotation file {annotation_file_id}")

                # Build a map of image_id → (width, height) for denormalization
                ann_image_ids = {ann.image_id for ann in annotations}
                image_dims = {
                    img.id: (img.width or 1, img.height or 1)
                    for img in db.query(Image).filter(Image.id.in_(ann_image_ids)).all()
                }
                
                for ann in annotations:
                    if ann.image_id not in ground_truth_annotations:
                        ground_truth_annotations[ann.image_id] = []
                    
                    img_w, img_h = image_dims.get(ann.image_id, (1, 1))

                    # Get bbox — bbox_x/y/width/height are stored NORMALIZED (0-1).
                    # The legacy ann.bbox JSON field may be absolute pixels (COCO [x,y,w,h]).
                    bbox_x, bbox_y, bbox_width, bbox_height = None, None, None, None
                    if ann.bbox_x is not None and ann.bbox_y is not None and ann.bbox_width is not None and ann.bbox_height is not None:
                        # Denormalize to absolute pixel coordinates
                        bbox_x  = ann.bbox_x     * img_w
                        bbox_y  = ann.bbox_y     * img_h
                        bbox_width  = ann.bbox_width  * img_w
                        bbox_height = ann.bbox_height * img_h
                    elif ann.bbox and isinstance(ann.bbox, list) and len(ann.bbox) >= 4:
                        # Legacy JSON bbox — already absolute pixel coords [x, y, w, h]
                        bbox_x, bbox_y = ann.bbox[0], ann.bbox[1]
                        bbox_width, bbox_height = ann.bbox[2], ann.bbox[3]
                    
                    # Skip annotations with missing bbox data
                    if bbox_x is None or bbox_y is None or bbox_width is None or bbox_height is None:
                        logger.warning(f"Skipping annotation {ann.id} with incomplete bbox data")
                        continue
                    
                    # Use category (class name) directly from annotation
                    # Case-insensitive match to handle e.g. "Car" vs "car"
                    class_id = -1
                    if ann.category:
                        ann_cat_lower = ann.category.lower()
                        for idx_cn, cn in enumerate(class_names):
                            if cn.lower() == ann_cat_lower:
                                class_id = idx_cn
                                break
                        if class_id == -1:
                            logger.warning(
                                f"GT category '{ann.category}' not found in training class_names "
                                f"{class_names} (case-insensitive) - annotation excluded from metrics"
                            )
                    
                    ground_truth_annotations[ann.image_id].append({
                        'class_id': class_id,
                        'bbox': [bbox_x, bbox_y,
                                 bbox_x + bbox_width,
                                 bbox_y + bbox_height]
                    })
            else:
                logger.warning(f"Annotation file {annotation_file_id} not found")
        else:
            logger.info("No annotation file specified - metrics will not be calculated")
        
        task.progress = 30
        task.task_metadata = {**task.task_metadata, 'stage': 'running_inference'}
        db.commit()
        
        # Get images
        images = db.query(Image).filter(Image.dataset_id == dataset_id).all()
        if not images:
            raise ValueError("No images found in dataset")
        
        # Map image_id → file_name for frontend threshold explorer
        image_id_to_filename = {img.id: img.file_name for img in images}
        
        # Get project_id for constructing image paths
        project_id = dataset.project_id
        if not project_id:
            raise ValueError("Dataset does not belong to a project")

        # Warn if GT image IDs don't overlap with eval dataset image IDs at all
        if has_ground_truth and ground_truth_annotations:
            eval_image_ids = {img.id for img in images}
            gt_image_ids = set(ground_truth_annotations.keys())
            overlap = gt_image_ids & eval_image_ids
            logger.info(
                f"GT covers {len(gt_image_ids)} images, eval dataset has {len(eval_image_ids)} images, "
                f"overlap={len(overlap)}"
            )
            if not overlap:
                logger.error(
                    f"ZERO overlap between GT image IDs {sorted(gt_image_ids)[:5]} and "
                    f"eval image IDs {sorted(eval_image_ids)[:5]}. "
                    "precision/recall will be 0 — the annotation file may belong to a different "
                    "collection or dataset."
                )

        # Determine which class IDs to ignore based on ignored_classes list
        ignored_class_ids = set()
        if ignored_classes:
            for class_name in ignored_classes:
                if class_name in class_names:
                    ignored_class_ids.add(class_names.index(class_name))
            logger.info(f"Ignoring classes for metrics: {ignored_classes} (IDs: {ignored_class_ids})")
        
        # Initialize metrics
        # Size is (num_classes + 1) x (num_classes + 1): the extra row/column at index
        # num_classes represents "background" (unmatched predictions / missed GT boxes)
        confusion_matrix = np.zeros((num_classes + 1, num_classes + 1), dtype=int)
        true_positives = 0
        false_positives = 0
        false_negatives = 0
        predictions_count = 0
        
        # Per-cell samples for interactive confusion matrix drill-down
        # Key: "row_col", value: list of up to MAX_CM_SAMPLES example dicts
        MAX_CM_SAMPLES = 20
        cm_samples: dict = {}

        def _add_cm_sample(row: int, col: int, sample: dict):
            key = f"{row}_{col}"
            if key not in cm_samples:
                cm_samples[key] = []
            if len(cm_samples[key]) < MAX_CM_SAMPLES:
                cm_samples[key].append(sample)
        
        # Store all predictions with bboxes and segmentation masks
        all_predictions = []
        
        start_time = time.time()
        total_images = len(images)
        
        # Run inference on each image
        for idx, img in enumerate(images):
            # Construct image path: projects/{project_id}/{dataset_id}/images/{file_name}
            img_path = Path("projects") / str(project_id) / str(dataset_id) / "images" / img.file_name
            
            # Fallback to old structure if new path doesn't exist
            if not img_path.exists():
                img_path = Path("data") / "images" / str(dataset_id) / img.file_name
            
            if not img_path.exists():
                logger.warning(f"Image file not found: {img_path}")
                continue
            
            # Store predictions for this image with bbox and segmentation
            image_predictions = []
            
            # Grid-based or full-image inference
            if use_grid:
                # Load image to get dimensions
                try:
                    pil_image = PILImage.open(img_path)
                    image_width, image_height = pil_image.size
                except Exception as e:
                    logger.warning(f"Failed to load image {img_path}: {e}")
                    continue
                
                # Create grid_images directory
                grid_output_dir = Path("projects") / str(project_id) / "training" / f"task_{training_task_id}" / "grid_images"
                grid_output_dir.mkdir(parents=True, exist_ok=True)
                
                # Generate grid tiles
                tiles = generate_grid_tiles(image_width, image_height, grid_size, grid_overlap)
                
                # Track all tile results for visualization
                tile_results = []
                
                # Run inference on each tile
                for tile_idx, tile in enumerate(tiles):
                    # Crop tile from image
                    tile_image = pil_image.crop((
                        tile['x'],
                        tile['y'],
                        tile['x'] + tile['width'],
                        tile['y'] + tile['height']
                    ))
                    
                    # Run prediction on tile
                    try:
                        results = model.predict(
                            source=np.array(tile_image),
                            conf=conf_threshold,
                            iou=iou_threshold,
                            verbose=False,
                            save=False  # Don't save via ultralytics
                        )
                    except Exception as e:
                        logger.warning(f"Failed to run inference on tile {tile_idx} of {img_path}: {e}")
                        continue
                    
                    if not results or len(results) == 0:
                        continue
                    
                    result = results[0]
                    
                    # Save annotated tile image
                    if result.boxes and len(result.boxes) > 0:
                        try:
                            # Get the annotated image from result
                            annotated_img = result.plot()  # Returns numpy array with annotations
                            annotated_pil = PILImage.fromarray(annotated_img)
                            
                            # Save with tile coordinates in filename
                            tile_filename = f"{img.file_name.rsplit('.', 1)[0]}_tile_{tile_idx}_{tile['x']}_{tile['y']}.jpg"
                            tile_save_path = grid_output_dir / tile_filename
                            annotated_pil.save(tile_save_path, quality=90)
                            
                            tile_results.append({
                                'tile_idx': tile_idx,
                                'saved_path': str(tile_save_path),
                                'detections': len(result.boxes)
                            })
                        except Exception as e:
                            logger.warning(f"Failed to save tile image: {e}")
                    
                    # Process predictions from this tile
                    if result.boxes:
                        for box_idx, box in enumerate(result.boxes):
                            pred_class_id = int(box.cls.item())
                            if pred_class_id < num_classes:
                                # Get bbox in xyxy format (relative to tile)
                                xyxy = box.xyxy[0].cpu().numpy()
                                tile_x1, tile_y1, tile_x2, tile_y2 = xyxy
                                
                                # Convert to full image coordinates
                                x1 = float(tile['x'] + tile_x1)
                                y1 = float(tile['y'] + tile_y1)
                                x2 = float(tile['x'] + tile_x2)
                                y2 = float(tile['y'] + tile_y2)
                                
                                # Convert to xywh for COCO format
                                bbox_xywh = [x1, y1, x2 - x1, y2 - y1]
                                
                                # Get segmentation mask if available
                                segmentation = []
                                if hasattr(result, 'masks') and result.masks is not None:
                                    try:
                                        mask = result.masks.xy[box_idx]
                                        if len(mask) > 0:
                                            # Adjust mask coordinates to full image
                                            segmentation = []
                                            for point in mask:
                                                segmentation.extend([
                                                    float(tile['x'] + point[0]),
                                                    float(tile['y'] + point[1])
                                                ])
                                    except (IndexError, AttributeError):
                                        pass
                                
                                pred_data = {
                                    'image_id': img.id,
                                    'class_id': pred_class_id,
                                    'bbox': bbox_xywh,
                                    'bbox_xyxy': [x1, y1, x2, y2],
                                    'conf': float(box.conf.item()),
                                    'segmentation': segmentation
                                }
                                
                                image_predictions.append(pred_data)
                
                # Apply NMS to remove duplicates from overlapping tiles
                if image_predictions:
                    image_predictions = nms_predictions(image_predictions, iou_threshold=0.5)
                    predictions_count += len(image_predictions)
                    
                    # Save full image with all predictions overlaid
                    try:
                        import cv2
                        img_array = np.array(pil_image)
                        
                        # Convert RGB to BGR for OpenCV
                        if len(img_array.shape) == 3 and img_array.shape[2] == 3:
                            img_bgr = cv2.cvtColor(img_array, cv2.COLOR_RGB2BGR)
                        else:
                            img_bgr = img_array
                        
                        # Draw each prediction
                        for pred in image_predictions:
                            x1, y1, x2, y2 = [int(v) for v in pred['bbox_xyxy']]
                            class_id = pred['class_id']
                            conf = pred['conf']
                            
                            # Draw bounding box
                            color = (0, 255, 0)  # Green
                            cv2.rectangle(img_bgr, (x1, y1), (x2, y2), color, 2)
                            
                            # Draw label
                            label = f"{class_names[class_id]}: {conf:.2f}"
                            label_size, _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
                            cv2.rectangle(img_bgr, (x1, y1 - label_size[1] - 4), 
                                        (x1 + label_size[0], y1), color, -1)
                            cv2.putText(img_bgr, label, (x1, y1 - 2), 
                                      cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 2)
                            
                            # Draw segmentation mask if available
                            if pred['segmentation']:
                                seg = pred['segmentation']
                                points = np.array([[seg[i], seg[i+1]] for i in range(0, len(seg), 2)], np.int32)
                                points = points.reshape((-1, 1, 2))
                                cv2.polylines(img_bgr, [points], True, (255, 0, 0), 2)
                        
                        # Save full annotated image
                        full_img_filename = f"{img.file_name.rsplit('.', 1)[0]}_grid_full.jpg"
                        full_img_path = grid_output_dir / full_img_filename
                        cv2.imwrite(str(full_img_path), img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 90])
                        
                        logger.info(f"Saved grid result: {full_img_path} with {len(image_predictions)} predictions")
                    except Exception as e:
                        logger.warning(f"Failed to save full annotated image: {e}")
                
            else:
                # Full image inference (original behavior)
                try:
                    results = model.predict(
                        source=str(img_path),
                        conf=conf_threshold,
                        iou=iou_threshold,
                        verbose=False
                    )
                except Exception as e:
                    logger.warning(f"Failed to run inference on {img_path}: {e}")
                    continue
                
                if not results or len(results) == 0:
                    continue
                
                result = results[0]
                
                if result.boxes:
                    for box_idx, box in enumerate(result.boxes):
                        pred_class_id = int(box.cls.item())
                        
                        # Skip predictions for ignored classes
                        if pred_class_id in ignored_class_ids:
                            continue
                            
                        if pred_class_id < num_classes:
                            # Get bbox in xyxy format
                            xyxy = box.xyxy[0].cpu().numpy()
                            x1, y1, x2, y2 = xyxy
                            
                            # Convert to xywh for COCO format
                            bbox_xywh = [float(x1), float(y1), float(x2 - x1), float(y2 - y1)]
                            
                            # Get segmentation mask if available
                            segmentation = []
                            if hasattr(result, 'masks') and result.masks is not None:
                                try:
                                    mask = result.masks.xy[box_idx]
                                    if len(mask) > 0:
                                        # Flatten the polygon points
                                        segmentation = [float(coord) for point in mask for coord in point]
                                except (IndexError, AttributeError):
                                    pass
                            
                            pred_data = {
                                'image_id': img.id,
                                'class_id': pred_class_id,
                                'bbox': bbox_xywh,
                                'bbox_xyxy': [float(x1), float(y1), float(x2), float(y2)],
                                'conf': float(box.conf.item()),
                                'segmentation': segmentation
                            }
                            
                            image_predictions.append(pred_data)
                            predictions_count += 1
            
            # Store predictions for this image (filtered predictions only)
            if image_predictions:
                all_predictions.extend(image_predictions)
            
            # If we have ground truth, calculate metrics
            if has_ground_truth and img.id in ground_truth_annotations:
                gt_boxes = ground_truth_annotations[img.id]
                pred_boxes = []
                
                for pred in image_predictions:
                    pred_boxes.append({
                        'class_id': pred['class_id'],
                        'bbox': pred['bbox_xyxy'],
                        'conf': pred['conf']
                    })
                
                # Filter out ignored classes from predictions and ground truth for metrics
                filtered_pred_boxes = [p for p in pred_boxes if p['class_id'] not in ignored_class_ids]
                filtered_gt_boxes = [g for g in gt_boxes if g['class_id'] not in ignored_class_ids and g['class_id'] >= 0]
                
                logger.info(f"Image {img.id}: Matching {len(filtered_pred_boxes)} predictions (filtered from {len(pred_boxes)}) with {len(filtered_gt_boxes)} ground truth boxes (filtered from {len(gt_boxes)})")
                
                # Match predictions with ground truth (using filtered lists for metrics)
                matched_gt = set()
                matched_pred = set()
                
                for i, pred in enumerate(filtered_pred_boxes):
                    best_iou = 0
                    best_gt_idx = -1
                    
                    for j, gt in enumerate(filtered_gt_boxes):
                        if j in matched_gt:
                            continue
                        
                        iou = calculate_iou(pred['bbox'], gt['bbox'])
                        if iou > best_iou:
                            best_iou = iou
                            best_gt_idx = j
                    
                    if best_iou >= iou_threshold:
                        matched_pred.add(i)
                        matched_gt.add(best_gt_idx)
                        
                        gt_class = filtered_gt_boxes[best_gt_idx]['class_id']
                        pred_class = pred['class_id']
                        
                        logger.debug(f"Match found: pred_class={pred_class}, gt_class={gt_class}, IoU={best_iou:.3f}")
                        
                        if gt_class >= 0 and pred_class >= 0:
                            confusion_matrix[gt_class][pred_class] += 1
                            _add_cm_sample(gt_class, pred_class, {
                                'file_name': img.file_name,
                                'pred_bbox': pred['bbox'],
                                'gt_bbox': filtered_gt_boxes[best_gt_idx]['bbox'],
                                'pred_class_name': class_names[pred_class],
                                'gt_class_name': class_names[gt_class],
                                'conf': float(pred['conf']),
                                'iou': float(best_iou),
                            })
                            if gt_class == pred_class:
                                true_positives += 1
                            else:
                                false_positives += 1
                    else:
                        false_positives += 1
                        # Unmatched prediction → background GT row, predicted class col
                        if pred['class_id'] < num_classes:
                            confusion_matrix[num_classes][pred['class_id']] += 1
                            _add_cm_sample(num_classes, pred['class_id'], {
                                'file_name': img.file_name,
                                'pred_bbox': pred['bbox'],
                                'gt_bbox': None,
                                'pred_class_name': class_names[pred['class_id']],
                                'gt_class_name': 'background',
                                'conf': float(pred['conf']),
                                'iou': float(best_iou),
                            })
                        if best_iou > 0:
                            logger.debug(f"No match: best IoU={best_iou:.3f} < threshold={iou_threshold}")
                
                # Unmatched GT boxes → GT class row, background predicted col
                for j in range(len(filtered_gt_boxes)):
                    if j not in matched_gt:
                        gt_class = filtered_gt_boxes[j]['class_id']
                        if 0 <= gt_class < num_classes:
                            confusion_matrix[gt_class][num_classes] += 1
                            _add_cm_sample(gt_class, num_classes, {
                                'file_name': img.file_name,
                                'pred_bbox': None,
                                'gt_bbox': filtered_gt_boxes[j]['bbox'],
                                'pred_class_name': 'background',
                                'gt_class_name': class_names[gt_class],
                                'conf': 0.0,
                                'iou': 0.0,
                            })
                
                false_negatives += len(filtered_gt_boxes) - len(matched_gt)
                logger.info(f"Image {img.id} results: TP={len(matched_pred)}, FP={len(filtered_pred_boxes)-len(matched_pred)}, FN={len(filtered_gt_boxes)-len(matched_gt)}")

            elif has_ground_truth:
                # Image exists in dataset but not in GT file → treat as 0 GT objects.
                # Any non-ignored predictions are false positives.
                extra_fp = sum(1 for p in image_predictions if p['class_id'] not in ignored_class_ids)
                false_positives += extra_fp
                if extra_fp:
                    logger.debug(f"Image {img.id} not in GT dict → {extra_fp} predictions counted as FP")
            
            # Update progress
            if (idx + 1) % max(1, total_images // 10) == 0:
                progress = 30 + int((idx + 1) / total_images * 60)
                task.progress = progress
                db.commit()
        
        inference_time_ms = (time.time() - start_time) * 1000
        
        # Build flat ground-truth list for frontend threshold explorer
        # (xyxy pixel coords, class_id, file_name per box)
        all_ground_truth = []
        if has_ground_truth:
            for img_id, gt_list in ground_truth_annotations.items():
                fname = image_id_to_filename.get(img_id, '')
                for box in gt_list:
                    cid = box['class_id']
                    if 0 <= cid < num_classes:
                        all_ground_truth.append({
                            'image_id': img_id,
                            'file_name': fname,
                            'class_id': cid,
                            'bbox': box['bbox'],   # [x1,y1,x2,y2] pixel coords
                            'class_name': class_names[cid],
                        })
        
        task.progress = 95
        task.task_metadata = {**task.task_metadata, 'stage': 'calculating_metrics'}
        db.commit()
        
        # Calculate final metrics
        logger.info(f"Final counts: TP={true_positives}, FP={false_positives}, FN={false_negatives}")
        precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0.0
        recall = true_positives / (true_positives + false_negatives) if (true_positives + false_negatives) > 0 else 0.0
        f1_score = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
        logger.info(f"Metrics: Precision={precision:.3f}, Recall={recall:.3f}, F1={f1_score:.3f}")
        
        # Store results in task metadata (heavy lists go to disk — see artifacts)
        results = {
            'precision': float(precision),
            'recall': float(recall),
            'f1_score': float(f1_score),
            'map50': 0.0,
            'map50_95': 0.0,
            'confusion_matrix': confusion_matrix.tolist(),
            'class_names': class_names + ['background'],  # background = unmatched row/col
            'project_id': project_id,
            'image_id_to_filename': {str(k): v for k, v in image_id_to_filename.items()},
            'predictions_count': predictions_count,
            'has_ground_truth': has_ground_truth,
            'inference_time_ms': float(inference_time_ms),
            'images_processed': total_images,
            'training_task_id': training_task_id,
            'dataset_id': dataset_id,
            'checkpoint': checkpoint,
            'conf_threshold': conf_threshold,
            'iou_threshold': iou_threshold,
            'use_grid': use_grid,
            'grid_size': grid_size if use_grid else None,
            'grid_overlap': grid_overlap if use_grid else None,
        }
        if all_predictions or all_ground_truth or cm_samples:
            blobs_rel = write_evaluation_blobs(
                project_id,
                task_id,
                all_predictions,
                all_ground_truth,
                cm_samples,
            )
            results['artifacts'] = {'blobs': blobs_rel, 'format_version': 1}
        
        task.status = 'completed'
        task.progress = 100
        task.completed_at = datetime.utcnow()
        task.task_metadata = {
            **task.task_metadata,
            'stage': 'completed',
            'results': results
        }
        db.commit()
        
        # Update parent task if this is a child task
        parent_task_id = task.task_metadata.get('parent_task_id')
        if parent_task_id:
            update_parent_task_status(db, parent_task_id)
        
        logger.info(f"Evaluation completed: {predictions_count} predictions on {total_images} images")
        return results
        
    except Exception as e:
        logger.error(f"Error in evaluation task: {str(e)}", exc_info=True)
        if task is not None:
            task.status = 'failed'
            task.completed_at = datetime.utcnow()
            task.error_message = f"Evaluation error: {str(e)}"
            db.commit()
            parent_task_id = task.task_metadata.get('parent_task_id') if task.task_metadata else None
            if parent_task_id:
                update_parent_task_status(db, parent_task_id)
        
        raise
    finally:
        db.close()


def update_parent_task_status(db, parent_task_id: int):
    """Update the parent task status based on child task statuses"""
    try:
        parent_task = db.query(TaskModel).filter(TaskModel.id == parent_task_id).first()
        if not parent_task:
            return
        
        parent_metadata = parent_task.task_metadata or {}
        child_task_ids = parent_metadata.get('child_task_ids', [])
        
        if not child_task_ids:
            return
        
        # Get all child tasks
        child_tasks = db.query(TaskModel).filter(TaskModel.id.in_(child_task_ids)).all()
        
        if not child_tasks:
            return
        
        # Calculate aggregate status
        completed_count = sum(1 for ct in child_tasks if ct.status == 'completed')
        failed_count = sum(1 for ct in child_tasks if ct.status == 'failed')
        running_count = sum(1 for ct in child_tasks if ct.status == 'running')
        total_count = len(child_tasks)
        
        # Calculate aggregate progress
        aggregate_progress = sum(ct.progress or 0 for ct in child_tasks) // total_count
        
        # Determine parent status
        if completed_count == total_count:
            parent_status = 'completed'
            parent_task.completed_at = datetime.utcnow()
        elif failed_count == total_count:
            parent_status = 'failed'
            parent_task.completed_at = datetime.utcnow()
        elif running_count > 0 or (completed_count + failed_count < total_count):
            parent_status = 'running'
        else:
            # Some completed, some failed
            parent_status = 'completed'  # Partial completion
            parent_task.completed_at = datetime.utcnow()
        
        # Aggregate results from completed children
        aggregate_results = None
        if completed_count > 0:
            completed_children = [ct for ct in child_tasks if ct.status == 'completed']
            total_images = sum(
                ct.task_metadata.get('results', {}).get('images_processed', 0) 
                for ct in completed_children if ct.task_metadata
            )
            total_predictions = sum(
                ct.task_metadata.get('results', {}).get('predictions_count', 0) 
                for ct in completed_children if ct.task_metadata
            )
            total_inference_time = sum(
                ct.task_metadata.get('results', {}).get('inference_time_ms', 0) 
                for ct in completed_children if ct.task_metadata
            )
            
            # Calculate average metrics
            avg_precision = sum(
                ct.task_metadata.get('results', {}).get('precision', 0) 
                for ct in completed_children if ct.task_metadata
            ) / completed_count
            avg_recall = sum(
                ct.task_metadata.get('results', {}).get('recall', 0) 
                for ct in completed_children if ct.task_metadata
            ) / completed_count
            avg_f1 = sum(
                ct.task_metadata.get('results', {}).get('f1_score', 0) 
                for ct in completed_children if ct.task_metadata
            ) / completed_count
            
            aggregate_results = {
                'precision': avg_precision,
                'recall': avg_recall,
                'f1_score': avg_f1,
                'images_processed': total_images,
                'predictions_count': total_predictions,
                'inference_time_ms': total_inference_time,
                'completed_datasets': completed_count,
                'failed_datasets': failed_count,
                'total_datasets': total_count
            }
        
        parent_task.status = parent_status
        parent_task.progress = aggregate_progress
        parent_task.task_metadata = {
            **parent_metadata,
            'aggregate_results': aggregate_results,
            'completed_count': completed_count,
            'failed_count': failed_count
        }
        db.commit()
        
        logger.info(f"Updated parent task {parent_task_id}: status={parent_status}, progress={aggregate_progress}%")
        
    except Exception as e:
        logger.error(f"Error updating parent task {parent_task_id}: {str(e)}")
