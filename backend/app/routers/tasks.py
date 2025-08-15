from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import Optional, List
from datetime import datetime
import logging

from .. import models, schemas
from ..database import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


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
        
        if project_id:
            query = query.filter(models.Task.project_id == project_id)
        if task_type:
            query = query.filter(models.Task.task_type == task_type)
        if status:
            query = query.filter(models.Task.status == status)
        
        # Use execution options for better connection management
        query = query.execution_options(autocommit=True)
        
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
    """Cancel a task"""
    task = db.query(models.Task).filter(models.Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    if task.status in ['completed', 'failed', 'cancelled']:
        raise HTTPException(status_code=400, detail=f"Cannot cancel task with status '{task.status}'")
    
    task.status = 'cancelled'
    task.completed_at = datetime.utcnow()
    task.error_message = 'Task cancelled by user'
    db.commit()
    
    return {
        "success": True,
        "message": "Task cancelled successfully",
        "task_id": task_id
    }


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: int, db: Session = Depends(get_db)):
    """Delete a task and its associated data"""
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")
        
        # Check if task is still running
        if task.status in ['pending', 'running']:
            raise HTTPException(status_code=400, detail="Cannot delete a running task. Cancel it first.")
        
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
