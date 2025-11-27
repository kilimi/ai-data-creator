from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from pydantic import BaseModel
from pathlib import Path
from datetime import datetime
import logging
import json

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
                annotation_file_name = annotation_file.file_name
        
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
