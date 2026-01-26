"""
Celery tasks for training.
"""
import os
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

from celery import Task
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.models import Task as TaskModel

logger = logging.getLogger(__name__)

# Database setup for Celery workers
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@db/lai_db')
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class TrainingTask(Task):
    """Base task for training with progress tracking"""
    
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Called when task fails"""
        logger.error(f"Task {task_id} failed: {exc}")
        
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


# Import YOLO training task from separate module
from app.tasks.yolo_training import train_yolo_model

# Re-export for backward compatibility
# The actual implementation is now in yolo_training.py


@celery_app.task(name='app.tasks.training_tasks.cleanup_old_tasks')
def cleanup_old_tasks():
    """
    Cleanup old completed/failed tasks and their files.
    Can be run periodically via Celery Beat.
    """
    db = SessionLocal()
    try:
        # This is a placeholder - implement your cleanup logic
        logger.info("Cleanup task executed")
        # Example: Delete tasks older than 30 days
        # from datetime import timedelta
        # cutoff_date = datetime.utcnow() - timedelta(days=30)
        # old_tasks = db.query(TaskModel).filter(
        #     TaskModel.completed_at < cutoff_date,
        #     TaskModel.status.in_(['completed', 'failed'])
        # ).all()
        # for task in old_tasks:
        #     # Delete associated files
        #     # Delete task record
        #     pass
    finally:
        db.close()


@celery_app.task(base=TrainingTask, bind=True, name='app.tasks.training_tasks.train_rtdetr_model')
def train_rtdetr_model(self, task_id: int, training_config: Dict[str, Any]):
    """
    Train RT-DETR (Real-Time Detection Transformer) model.
    RT-DETR is an end-to-end object detector using transformers.
    """
    from ultralytics import RTDETR
    
    db = SessionLocal()
    
    try:
        logger.info(f"Starting RT-DETR training for task {task_id}")
        
        # Get task from database
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} not found")
        
        # Update task status
        task.status = "running"
        task.started_at = datetime.utcnow()
        task.progress = 0
        task.task_metadata = {
            **task.task_metadata,
            "stage": "initializing"
        }
        db.commit()
        
        # Load model
        model_type = training_config.get('model_type', 'rtdetr-l.pt')
        logger.info(f"Loading RT-DETR model: {model_type}")
        
        # Ultralytics will automatically download the model if it doesn't exist
        # Valid RT-DETR models: rtdetr-l.pt, rtdetr-x.pt
        try:
            model = RTDETR(model_type)
        except Exception as e:
            logger.error(f"Failed to load model {model_type}: {e}")
            # Try with just the base name without .pt
            base_name = model_type.replace('.pt', '')
            logger.info(f"Retrying with model name: {base_name}")
            model = RTDETR(base_name)
        
        # Training arguments
        train_args = {
            'data': training_config['data_yaml'],
            'epochs': training_config.get('epochs', 100),
            'batch': training_config.get('batch_size', 16),
            'imgsz': training_config.get('image_size', 640),
            'device': training_config.get('device', '0'),
            'patience': training_config.get('patience', 50),
            'optimizer': training_config.get('optimizer', 'AdamW'),
            'lr0': training_config.get('learning_rate', 0.0001),
            'weight_decay': training_config.get('weight_decay', 0.0001),
            'project': training_config['output_dir'],
            'name': 'training',
            'exist_ok': True,
            'verbose': True,
            'save': True,
            'save_period': 10,  # Save checkpoint every 10 epochs
            'cache': False,  # Don't cache images in RAM
            'workers': 8
        }
        
        # Note: RT-DETR doesn't support custom callbacks like YOLO does
        # Progress updates will need to be handled differently
        
        # W&B integration
        if training_config.get('use_wandb', False):
            train_args['project'] = training_config.get('wandb_project', 'rtdetr-training')
            if training_config.get('wandb_entity'):
                train_args['entity'] = training_config['wandb_entity']
        
        logger.info(f"Starting RT-DETR training with args: {train_args}")
        
        # Train the model
        results = model.train(**train_args)
        
        logger.info(f"RT-DETR training completed for task {task_id}")
        
        # Update task with completion
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if task:
            task.status = "completed"
            task.completed_at = datetime.utcnow()
            task.progress = 100
            
            output_base = Path(training_config['output_dir'])
            best_model_path = output_base / "training" / "weights" / "best.pt"
            last_model_path = output_base / "training" / "weights" / "last.pt"
            
            task.task_metadata = {
                **task.task_metadata,
                "stage": "completed",
                "best_model": str(best_model_path) if best_model_path.exists() else None,
                "last_model": str(last_model_path) if last_model_path.exists() else None,
                "results_dir": str(output_base / "training")
            }
            db.commit()
        
        logger.info(f"RT-DETR training completed successfully for task {task_id}")
        
        return {
            "status": "completed",
            "task_id": task_id,
            "best_model": str(best_model_path) if best_model_path.exists() else None
        }
        
    except Exception as e:
        logger.error(f"Error in RT-DETR training task {task_id}: {str(e)}", exc_info=True)
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
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
        raise
        
    finally:
        db.close()
