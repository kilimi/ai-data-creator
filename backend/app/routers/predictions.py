from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import logging
import json
import subprocess
import tempfile
import os

from ..database import get_db
from ..models import Task, Dataset, Image

router = APIRouter()
logger = logging.getLogger(__name__)


class EvaluationRequest(BaseModel):
    """Request model for model evaluation"""
    task_id: int  # Training task ID
    dataset_id: int
    annotation_file_id: Optional[str] = None  # Ground truth annotations
    checkpoint: str = "best"  # "best" or "last"
    conf_threshold: float = 0.25
    iou_threshold: float = 0.45
    evaluation_name: Optional[str] = None  # Custom name for evaluation
    # Grid inference settings
    use_grid: bool = False  # Enable grid-based inference
    grid_size: int = 640  # Size of each grid tile
    grid_overlap: float = 0.2  # Overlap ratio (0.0 to 0.5)


@router.post("/predictions/evaluate")
async def evaluate_model(
    request: EvaluationRequest,
    db: Session = Depends(get_db)
):
    """
    Start model evaluation as a background task
    """
    try:
        # Validate training task exists
        training_task = db.query(Task).filter(Task.id == request.task_id).first()
        if not training_task or training_task.status != 'completed':
            raise HTTPException(status_code=404, detail="Training task not found or not completed")
        
        # Validate dataset exists
        dataset = db.query(Dataset).filter(Dataset.id == request.dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get model info from training task
        task_metadata = training_task.task_metadata or {}
        model_type = task_metadata.get('model_type', 'Unknown')
        
        # Use custom name if provided, otherwise generate default name
        eval_name = request.evaluation_name.strip() if request.evaluation_name else f"Evaluation - {training_task.name} on {dataset.name}"
        
        # Get annotation file name if provided
        annotation_file_name = None
        if request.annotation_file_id:
            from ..models import AnnotationFile
            annotation_file = db.query(AnnotationFile).filter(AnnotationFile.id == request.annotation_file_id).first()
            if annotation_file:
                annotation_file_name = annotation_file.name
        
        # Create evaluation task in database
        eval_task = Task(
            name=eval_name,
            task_type="model_evaluation",
            status="pending",
            project_id=dataset.project_id,
            progress=0,
            task_metadata={
                "training_task_id": request.task_id,
                "training_task_name": training_task.name,
                "dataset_id": request.dataset_id,
                "dataset_name": dataset.name,
                "annotation_file_id": request.annotation_file_id,
                "annotation_file_name": annotation_file_name,
                "checkpoint": request.checkpoint,
                "conf_threshold": request.conf_threshold,
                "iou_threshold": request.iou_threshold,
                "model_type": model_type,
                "has_ground_truth": request.annotation_file_id is not None,
                "use_grid": request.use_grid,
                "grid_size": request.grid_size,
                "grid_overlap": request.grid_overlap
            }
        )
        db.add(eval_task)
        db.commit()
        db.refresh(eval_task)
        
        # Import and start Celery task
        from app.tasks.evaluation_tasks import evaluate_model as evaluate_model_task
        
        celery_task = evaluate_model_task.delay(
            eval_task.id,
            request.task_id,
            request.dataset_id,
            request.annotation_file_id,
            request.checkpoint,
            request.conf_threshold,
            request.iou_threshold,
            request.use_grid,
            request.grid_size,
            request.grid_overlap
        )
        
        # Update task with Celery ID
        eval_task.task_metadata = {
            **eval_task.task_metadata,
            'celery_task_id': celery_task.id
        }
        db.commit()
        
        logger.info(f"Started evaluation task {eval_task.id} with Celery task {celery_task.id}")
        
        return {
            "success": True,
            "message": "Evaluation started",
            "task_id": eval_task.id,
            "task_name": eval_task.name
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting evaluation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to start evaluation: {str(e)}")


@router.get("/predictions/export-coco/{task_id}")
async def export_coco_results(
    task_id: int,
    db: Session = Depends(get_db)
):
    """Export evaluation results in COCO format"""
    try:
        # Get evaluation task
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        if task.task_type != 'model_evaluation':
            raise HTTPException(status_code=400, detail="Task is not an evaluation task")
        
        if task.status != 'completed':
            raise HTTPException(status_code=400, detail="Evaluation not completed")
        
        # Get results from metadata
        results = task.task_metadata.get('results', {})
        if not results:
            raise HTTPException(status_code=404, detail="No evaluation results found")
        
        # Get evaluation parameters
        dataset_id = results.get('dataset_id')
        class_names = results.get('class_names', [])
        predictions = results.get('predictions', [])
        conf_threshold = results.get('conf_threshold', 0.25)
        iou_threshold = results.get('iou_threshold', 0.45)
        checkpoint = results.get('checkpoint', 'best')
        
        if not predictions:
            raise HTTPException(status_code=404, detail="No predictions found in evaluation results")
        
        # Get dataset
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get images from dataset
        images = db.query(Image).filter(Image.dataset_id == dataset_id).all()
        if not images:
            raise HTTPException(status_code=400, detail="No images found in dataset")
        
        # Create image lookup
        image_dict = {img.id: img for img in images}
        
        # Initialize COCO structure
        coco_output = {
            "info": {
                "description": f"Evaluation results for task {task_id}",
                "date_created": datetime.utcnow().isoformat(),
                "task_name": task.name,
                "model_checkpoint": checkpoint,
                "conf_threshold": conf_threshold,
                "iou_threshold": iou_threshold
            },
            "images": [],
            "annotations": [],
            "categories": []
        }
        
        # Add categories
        for idx, class_name in enumerate(class_names):
            coco_output["categories"].append({
                "id": idx,
                "name": class_name,
                "supercategory": "object"
            })
        
        # Add images
        for img in images:
            coco_output["images"].append({
                "id": img.id,
                "file_name": img.file_name,
                "width": img.width or 0,
                "height": img.height or 0,
                "date_captured": img.uploaded_at.isoformat() if img.uploaded_at else None
            })
        
        # Add predictions from stored results
        for idx, pred in enumerate(predictions, start=1):
            # Wrap segmentation in array if it exists and is not empty
            segmentation = pred.get('segmentation', [])
            if segmentation and len(segmentation) > 0:
                # COCO format expects array of polygons: [[x1,y1,x2,y2,...]]
                segmentation = [segmentation]
            
            coco_output["annotations"].append({
                "id": idx,
                "image_id": pred['image_id'],
                "category_id": pred['class_id'],
                "bbox": pred['bbox'],  # Already in xywh format
                "score": pred['conf'],
                "segmentation": segmentation
            })
        
        # Create filename
        filename = f"evaluation_{task_id}_coco.json"
        
        return JSONResponse(
            content=coco_output,
            headers={
                "Content-Disposition": f"attachment; filename={filename}"
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error exporting COCO results: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to export results: {str(e)}")


@router.post("/predictions/view-fiftyone/{task_id}")
async def view_in_fiftyone(
    task_id: int,
    db: Session = Depends(get_db)
):
    """Open evaluation results in FiftyOne with predictions and ground truth"""
    try:
        # Get evaluation task
        task = db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        if task.task_type != 'model_evaluation':
            raise HTTPException(status_code=400, detail="Task is not an evaluation task")
        
        if task.status != 'completed':
            raise HTTPException(status_code=400, detail="Evaluation not completed")
        
        # Get results from metadata
        metadata = task.task_metadata or {}
        results = metadata.get('results', {})
        if not results:
            raise HTTPException(status_code=404, detail="No evaluation results found")
        
        dataset_id = results.get('dataset_id')
        class_names = results.get('class_names', [])
        predictions = results.get('predictions', [])
        annotation_file_id = metadata.get('annotation_file_id')
        
        # Get dataset
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        project_id = dataset.project_id
        
        # Get images
        images = db.query(Image).filter(Image.dataset_id == dataset_id).all()
        if not images:
            raise HTTPException(status_code=400, detail="No images found in dataset")
        
        # Create image lookup
        image_dict = {img.id: img for img in images}
        
        # Load ground truth if available
        ground_truth_by_image = {}
        if annotation_file_id:
            from ..models import Annotation, AnnotationFile
            
            annotation_file = db.query(AnnotationFile).filter(
                AnnotationFile.id == annotation_file_id
            ).first()
            
            if annotation_file:
                annotations = db.query(Annotation).filter(
                    Annotation.annotation_file_id == annotation_file_id
                ).all()
                
                for ann in annotations:
                    if ann.image_id not in ground_truth_by_image:
                        ground_truth_by_image[ann.image_id] = []
                    
                    # Get bbox from either individual fields or JSON bbox field
                    bbox_x, bbox_y, bbox_width, bbox_height = None, None, None, None
                    if ann.bbox_x is not None and ann.bbox_y is not None and ann.bbox_width is not None and ann.bbox_height is not None:
                        bbox_x, bbox_y = ann.bbox_x, ann.bbox_y
                        bbox_width, bbox_height = ann.bbox_width, ann.bbox_height
                    elif ann.bbox and isinstance(ann.bbox, list) and len(ann.bbox) >= 4:
                        bbox_x, bbox_y = ann.bbox[0], ann.bbox[1]
                        bbox_width, bbox_height = ann.bbox[2], ann.bbox[3]
                    
                    # Skip annotations with missing bbox data
                    if bbox_x is None or bbox_y is None or bbox_width is None or bbox_height is None:
                        continue
                    
                    # Get class index
                    class_id = -1
                    if ann.category and ann.category in class_names:
                        class_id = class_names.index(ann.category)
                    
                    if class_id >= 0:
                        img_width = ann.image.width if ann.image else 1
                        img_height = ann.image.height if ann.image else 1
                        ground_truth_by_image[ann.image_id].append({
                            'label': ann.category,
                            'bbox': [
                                bbox_x / img_width if img_width else 0,
                                bbox_y / img_height if img_height else 0,
                                bbox_width / img_width if img_width else 0,
                                bbox_height / img_height if img_height else 0
                            ],
                            'confidence': 1.0  # Ground truth has 100% confidence
                        })
        
        # Organize predictions by image
        predictions_by_image = {}
        for pred in predictions:
            img_id = pred['image_id']
            if img_id not in predictions_by_image:
                predictions_by_image[img_id] = []
            
            if img_id in image_dict:
                img = image_dict[img_id]
                bbox_xywh = pred['bbox']
                
                # Normalize bbox to [0, 1] range for FiftyOne
                if img.width and img.height:
                    predictions_by_image[img_id].append({
                        'label': class_names[pred['class_id']] if pred['class_id'] < len(class_names) else 'unknown',
                        'bbox': [
                            bbox_xywh[0] / img.width,
                            bbox_xywh[1] / img.height,
                            bbox_xywh[2] / img.width,
                            bbox_xywh[3] / img.height
                        ],
                        'confidence': pred['conf']
                    })
        
        # Prepare data for FiftyOne script - convert keys to strings for JSON
        image_dict_json = json.dumps({str(img.id): {'file_name': img.file_name, 'width': img.width, 'height': img.height} for img in images})
        # Convert image_id keys to strings in predictions and ground truth
        predictions_by_image_str = {str(k): v for k, v in predictions_by_image.items()}
        ground_truth_by_image_str = {str(k): v for k, v in ground_truth_by_image.items()}
        predictions_json = json.dumps(predictions_by_image_str)
        ground_truth_json = json.dumps(ground_truth_by_image_str)
        
        # Create Python script to launch FiftyOne
        script_content = f"""
import fiftyone as fo
import json
from pathlib import Path

# Create dataset
dataset_name = "eval_task_{task_id}"

# Delete if exists
if dataset_name in fo.list_datasets():
    fo.delete_dataset(dataset_name)

dataset = fo.Dataset(dataset_name)
dataset.persistent = False

# Add samples
samples = []
predictions_by_image = json.loads('''{predictions_json}''')
ground_truth_by_image = json.loads('''{ground_truth_json}''')
image_dict = json.loads('''{image_dict_json}''')

for img_id, img_info in image_dict.items():
    # Construct image path
    img_path = Path("projects") / "{project_id}" / "{dataset_id}" / "images" / img_info['file_name']
    
    # Fallback to old structure
    if not img_path.exists():
        img_path = Path("data") / "images" / "{dataset_id}" / img_info['file_name']
    
    if not img_path.exists():
        continue
    
    sample = fo.Sample(filepath=str(img_path))
    
    # Add predictions
    if img_id in predictions_by_image:
        detections = []
        for pred in predictions_by_image[img_id]:
            detection = fo.Detection(
                label=pred['label'],
                bounding_box=pred['bbox'],
                confidence=pred['confidence']
            )
            detections.append(detection)
        sample["predictions"] = fo.Detections(detections=detections)
    
    # Add ground truth
    if img_id in ground_truth_by_image:
        detections = []
        for gt in ground_truth_by_image[img_id]:
            detection = fo.Detection(
                label=gt['label'],
                bounding_box=gt['bbox'],
                confidence=gt['confidence']
            )
            detections.append(detection)
        sample["ground_truth"] = fo.Detections(detections=detections)
    
    samples.append(sample)

dataset.add_samples(samples)

total_predictions = sum(len(preds) for preds in predictions_by_image.values())
total_gt = sum(len(gts) for gts in ground_truth_by_image.values())
print(f"Loaded {{len(samples)}} samples into FiftyOne")
print(f"Classes: {class_names}")
print(f"Predictions: {{total_predictions}} total detections")
print(f"Ground truth: {{total_gt}} annotations")

# Launch the app - bind to 0.0.0.0 to make it accessible from outside Docker
import signal
import sys

def signal_handler(sig, frame):
    print('Shutting down FiftyOne...')
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

print('Launching FiftyOne app on port 5151...')
session = fo.launch_app(dataset, port=5151, address="0.0.0.0")
print('FiftyOne app launched successfully')
print('Keeping session alive...')

# Keep the session alive indefinitely
session.wait(-1)
"""
        
        # Write script to temp file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(script_content)
            script_path = f.name
        
        # Launch FiftyOne in background
        try:
            import time
            
            # Use subprocess to run the script in background
            # Use DEVNULL to prevent blocking on pipe buffer fill
            # start_new_session=True ensures the process survives after parent exits
            process = subprocess.Popen(
                ['python', script_path],
                stdout=open('/tmp/fiftyone_stdout.log', 'w'),
                stderr=open('/tmp/fiftyone_stderr.log', 'w'),
                env={**os.environ, 'FIFTYONE_DEFAULT_APP_PORT': '5151', 'FIFTYONE_DEFAULT_APP_ADDRESS': '0.0.0.0'},
                start_new_session=True
            )
            
            # Wait a bit to see if process starts successfully
            time.sleep(2)
            
            # Check if process is still running
            poll_result = process.poll()
            if poll_result is not None:
                # Process ended - read error log
                try:
                    with open('/tmp/fiftyone_stderr.log', 'r') as f:
                        stderr_content = f.read()
                    logger.error(f"FiftyOne process exited with code {poll_result}: {stderr_content}")
                    raise HTTPException(status_code=500, detail=f"FiftyOne failed to start: {stderr_content[:500]}")
                except FileNotFoundError:
                    raise HTTPException(status_code=500, detail=f"FiftyOne failed to start with exit code {poll_result}")
            
            logger.info(f"Launched FiftyOne for evaluation task {task_id} with PID {process.pid}")
            
            return {
                "success": True,
                "message": "FiftyOne is starting. The app will open in a new window at http://localhost:5151",
                "url": "http://localhost:5151"
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Failed to launch FiftyOne: {e}", exc_info=True)
            # Clean up temp file on error
            try:
                os.unlink(script_path)
            except:
                pass
            raise HTTPException(status_code=500, detail=f"Failed to launch FiftyOne: {str(e)}")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error preparing FiftyOne view: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to prepare FiftyOne view: {str(e)}")
