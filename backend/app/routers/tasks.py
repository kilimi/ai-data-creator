from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import logging
import shutil
from pathlib import Path
from celery import Celery
from pydantic import BaseModel

from .. import models, schemas
from ..database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)

# Initialize Celery app for task control
celery_app = Celery('tasks', broker='redis://redis:6379/0', backend='redis://redis:6379/0')


class TaskUpdateRequest(BaseModel):
    name: Optional[str] = None


@router.get("/tasks/", response_model=List[schemas.Task])
async def get_tasks(
    project_id: Optional[int] = None,
    task_type: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get tasks with optional filtering"""
    try:
        query = db.query(models.Task)
        
        # Apply filters in order of selectivity (most selective first)
        # This helps the query optimizer use indexes efficiently
        if project_id:
            query = query.filter(models.Task.project_id == project_id)
        if status:
            query = query.filter(models.Task.status == status)
        if task_type:
            query = query.filter(models.Task.task_type == task_type)
        
        # Order by created_at descending (most recent first)
        # Use index on created_at for better performance
        return query.order_by(models.Task.created_at.desc()).offset(skip).limit(limit).all()
    except Exception as e:
        logger.error(f"Database error in get_tasks: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/tasks/active", response_model=List[schemas.Task])
async def get_active_tasks(
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Get currently active tasks (pending or running)"""
    try:
        query = db.query(models.Task).filter(
            models.Task.status.in_(['pending', 'running'])
        )
        
        if project_id:
            query = query.filter(models.Task.project_id == project_id)
        
        # Use execution options for better connection management
        query = query.execution_options(autocommit=True)
        
        return query.order_by(models.Task.created_at.desc()).all()
    except Exception as e:
        logger.error(f"Database error in get_active_tasks: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Database error")


@router.get("/tasks/count", response_model=dict)
async def get_task_counts(
    project_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """Get count of tasks by status"""
    query = db.query(models.Task)
    
    if project_id:
        query = query.filter(models.Task.project_id == project_id)
    
    # Count tasks by status
    pending_count = query.filter(models.Task.status == 'pending').count()
    running_count = query.filter(models.Task.status == 'running').count()
    completed_count = query.filter(models.Task.status == 'completed').count()
    failed_count = query.filter(models.Task.status == 'failed').count()
    cancelled_count = query.filter(models.Task.status == 'cancelled').count()
    
    active_count = pending_count + running_count
    
    return {
        "active": active_count,
        "pending": pending_count,
        "running": running_count,
        "completed": completed_count,
        "failed": failed_count,
        "cancelled": cancelled_count,
        "total": query.count()
    }


@router.get("/tasks/{task_id}", response_model=schemas.Task)
async def get_task(task_id: int, db: Session = Depends(get_db)):
    """Get task status and progress"""
    try:
        # Use first() with proper error handling instead of all()
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Explicitly commit the read to release connection quickly
        db.commit()
        return task
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Database error in get_task: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Database error")


@router.patch("/tasks/{task_id}/cancel")
async def cancel_task(task_id: int, db: Session = Depends(get_db)):
    """Cancel a task and terminate its Celery process"""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.status in ['completed', 'failed', 'cancelled', 'stopped']:
        raise HTTPException(status_code=400, detail=f"Cannot cancel task with status '{task.status}'")
    
    # Get the Celery task ID from metadata
    celery_task_id = None
    if task.task_metadata and isinstance(task.task_metadata, dict):
        celery_task_id = task.task_metadata.get('celery_task_id')
    
    # Update task status in database FIRST so training loop can detect it
    task.status = 'stopped'
    task.completed_at = datetime.utcnow()
    task.error_message = 'Task stopped by user'
    db.commit()
    
    # Revoke the Celery task to kill the process
    if celery_task_id:
        try:
            # Use SIGTERM first for graceful shutdown, then SIGKILL as fallback
            celery_app.control.revoke(celery_task_id, terminate=True, signal='SIGTERM')
            logger.info(f"Sent SIGTERM to Celery task {celery_task_id} for task {task_id}")
            
            # Also try immediate revoke with SIGKILL as backup
            import time
            time.sleep(0.5)  # Give it a moment to respond to SIGTERM
            celery_app.control.revoke(celery_task_id, terminate=True, signal='SIGKILL')
            logger.info(f"Sent SIGKILL to Celery task {celery_task_id} for task {task_id}")
        except Exception as e:
            logger.error(f"Failed to revoke Celery task {celery_task_id}: {e}")
    
    return {
        "success": True,
        "message": "Task stopped successfully",
        "task_id": task_id,
        "celery_task_revoked": celery_task_id is not None
    }


@router.patch("/tasks/{task_id}")
async def update_task(task_id: int, update: TaskUpdateRequest, db: Session = Depends(get_db)):
    """Update task properties like name"""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # Update name if provided
    if update.name is not None:
        task.name = update.name
    
    db.commit()
    db.refresh(task)
    
    return {
        "success": True,
        "message": "Task updated successfully",
        "task": {
            "id": task.id,
            "name": task.name,
            "status": task.status
        }
    }


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int, db: Session = Depends(get_db)):
    """Delete a task and its associated data, including model files"""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Check if task is still running - only warn for active tasks
        if task.status in ['pending', 'running']:
            # Try to cancel it first
            if task.task_metadata and isinstance(task.task_metadata, dict):
                celery_task_id = task.task_metadata.get('celery_task_id')
                if celery_task_id:
                    try:
                        celery_app.control.revoke(celery_task_id, terminate=True, signal='SIGKILL')
                        logger.info(f"Terminated Celery task {celery_task_id} before deletion")
                    except Exception as e:
                        logger.error(f"Failed to terminate Celery task {celery_task_id}: {e}")
        
        # Delete training model files if this is a training task
        if task.task_type in ['yolo_training', 'training']:
            try:
                task_metadata = task.task_metadata or {}
                results_dir = task_metadata.get('results_dir')
                
                # Also try to construct the path from project_id and task_id
                if not results_dir and task.project_id:
                    training_dir = Path("projects") / str(task.project_id) / "training" / f"task_{task_id}"
                    if training_dir.exists():
                        results_dir = str(training_dir / "training")
                
                if results_dir:
                    results_path = Path(results_dir)
                    if results_path.exists():
                        # Delete the entire training directory for this task
                        task_dir = results_path.parent  # Go up to task_{task_id} directory
                        if task_dir.exists() and task_dir.name.startswith('task_'):
                            shutil.rmtree(task_dir, ignore_errors=True)
                            logger.info(f"Deleted training files for task {task_id} from {task_dir}")
            except Exception as e:
                logger.warning(f"Failed to delete training files for task {task_id}: {e}")
                # Continue with database deletion even if file deletion fails
        
        # Delete associated augmentation if exists
        augmentation = db.query(models.Augmentation).filter(models.Augmentation.task_id == task_id).first()
        if augmentation:
            db.delete(augmentation)
        
        # Delete the task
        db.delete(task)
        db.commit()
        
        return {
            "success": True,
            "message": "Task deleted successfully"
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete task: {str(e)}")


@router.delete("/projects/{project_id}/tasks/failed")
async def delete_failed_tasks(project_id: int, db: Session = Depends(get_db)):
    """Delete all failed tasks for a project"""
    try:
        # Get all failed tasks for this project
        failed_tasks = db.query(models.Task).filter(
            models.Task.project_id == project_id,
            models.Task.status == 'failed'
        ).all()
        
        if not failed_tasks:
            return {
                "success": True,
                "message": "No failed tasks to delete",
                "deleted_count": 0
            }
        
        deleted_count = len(failed_tasks)
        
        # Delete associated augmentations if they exist
        for task in failed_tasks:
            augmentation = db.query(models.Augmentation).filter(
                models.Augmentation.task_id == task.id
            ).first()
            if augmentation:
                db.delete(augmentation)
            db.delete(task)
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Deleted {deleted_count} failed task(s)",
            "deleted_count": deleted_count
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete tasks: {str(e)}")


@router.patch("/tasks/{task_id}/retry")
async def retry_task(task_id: int, db: Session = Depends(get_db)):
    """Retry a failed task"""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.status not in ['failed', 'cancelled']:
        raise HTTPException(status_code=400, detail=f"Cannot retry task with status '{task.status}'")
    
    # Reset task status
    task.status = 'pending'
    task.progress = 0.0
    task.started_at = None
    task.completed_at = None
    task.error_message = None
    db.commit()
    
    # Note: In a real implementation, you would need to restart the background task here
    # For now, we just reset the status
    
    return {
        "success": True,
        "message": "Task reset to pending status",
        "task_id": task_id
    }


@router.post("/tasks/{task_id}/rerun")
async def rerun_task(task_id: int, db: Session = Depends(get_db)):
    """Rerun a model evaluation task with the same parameters"""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.task_type != 'model_evaluation':
        raise HTTPException(status_code=400, detail="Only model evaluation tasks can be rerun")
    
    # Allow rerunning completed, failed, cancelled, or stopped tasks
    if task.status not in ['completed', 'failed', 'cancelled', 'stopped']:
        raise HTTPException(status_code=400, detail=f"Cannot rerun task with status '{task.status}'")
    
    # Get parameters from task metadata
    metadata = task.task_metadata or {}
    training_task_id = metadata.get('training_task_id')
    dataset_id = metadata.get('dataset_id')
    annotation_file_id = metadata.get('annotation_file_id')
    checkpoint = metadata.get('checkpoint', 'best')
    conf_threshold = metadata.get('conf_threshold', 0.25)
    iou_threshold = metadata.get('iou_threshold', 0.45)
    use_grid = metadata.get('use_grid', False)
    grid_size = metadata.get('grid_size', 640)
    grid_overlap = metadata.get('grid_overlap', 0.2)
    
    if not training_task_id or not dataset_id:
        raise HTTPException(status_code=400, detail="Task metadata is missing required parameters")
    
    # Validate training task exists
    training_task = db.query(models.Task).filter(models.Task.id == training_task_id).first()
    if not training_task or training_task.status != 'completed':
        raise HTTPException(status_code=404, detail="Training task not found or not completed")
    
    # Validate dataset exists
    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Get annotation file name if provided
    annotation_file_name = None
    if annotation_file_id:
        from ..models import AnnotationFile
        annotation_file = db.query(AnnotationFile).filter(AnnotationFile.id == annotation_file_id).first()
        if annotation_file:
            annotation_file_name = annotation_file.name
    
    # Generate new task name, removing existing (Rerun) suffix if present
    base_name = task.name
    if base_name.endswith(" (Rerun)"):
        base_name = base_name[:-8]  # Remove " (Rerun)"
    new_task_name = f"{base_name} (Rerun)"
    
    # Create new evaluation task with same parameters
    new_task = models.Task(
        name=new_task_name,
        task_type="model_evaluation",
        status="pending",
        project_id=task.project_id,
        progress=0,
        task_metadata={
            "training_task_id": training_task_id,
            "training_task_name": metadata.get('training_task_name'),
            "dataset_id": dataset_id,
            "dataset_name": metadata.get('dataset_name'),
            "annotation_file_id": annotation_file_id,
            "annotation_file_name": annotation_file_name,
            "checkpoint": checkpoint,
            "conf_threshold": conf_threshold,
            "iou_threshold": iou_threshold,
            "model_type": metadata.get('model_type', 'Unknown'),
            "has_ground_truth": annotation_file_id is not None,
            "use_grid": use_grid,
            "grid_size": grid_size,
            "grid_overlap": grid_overlap
        }
    )
    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    
    # Start Celery task
    try:
        from app.tasks.evaluation_tasks import evaluate_model as evaluate_model_task
        
        celery_task = evaluate_model_task.delay(
            new_task.id,
            training_task_id,
            dataset_id,
            annotation_file_id,
            checkpoint,
            conf_threshold,
            iou_threshold,
            use_grid,
            grid_size,
            grid_overlap
        )
        
        # Update task with Celery ID
        new_task.task_metadata = {
            **new_task.task_metadata,
            'celery_task_id': celery_task.id
        }
        db.commit()
        
        logger.info(f"Started rerun evaluation task {new_task.id} with Celery task {celery_task.id}")
        
    except Exception as e:
        logger.error(f"Error starting rerun evaluation: {str(e)}", exc_info=True)
        # Update task status to failed
        new_task.status = 'failed'
        new_task.error_message = f"Failed to start evaluation: {str(e)}"
        db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to start evaluation: {str(e)}")
    
    return {
        "success": True,
        "message": "Evaluation task rerun started",
        "task_id": new_task.id,
        "task_name": new_task.name
    }


@router.get("/tasks/{task_id}/logs")
async def get_task_logs(task_id: int, db: Session = Depends(get_db)):
    """Get logs for a specific task"""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # In a real implementation, you would store and retrieve actual log files
    # For now, we'll return basic task information as "logs"
    logs = []
    
    logs.append(f"[{task.created_at}] Task created: {task.name}")
    
    if task.started_at:
        logs.append(f"[{task.started_at}] Task started")
    
    if task.status == 'running':
        logs.append(f"[{datetime.utcnow()}] Task in progress: {task.progress:.1f}% complete")
    elif task.status == 'completed':
        logs.append(f"[{task.completed_at}] Task completed successfully")
    elif task.status == 'failed':
        logs.append(f"[{task.completed_at}] Task failed: {task.error_message}")
    elif task.status == 'cancelled':
        logs.append(f"[{task.completed_at}] Task cancelled: {task.error_message}")
    
    return {
        "success": True,
        "task_id": task_id,
        "logs": logs
    }
