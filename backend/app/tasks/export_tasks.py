"""
Celery tasks for model export.
"""
import os
import logging
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

from celery import Task
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.models import Task as TaskModel
from ultralytics import YOLO

logger = logging.getLogger(__name__)

# Database setup for Celery workers
DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@db/lai_db')
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class ExportTask(Task):
    """Base task for export with progress tracking"""
    
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Called when task fails"""
        logger.error(f"Export task {task_id} failed: {exc}")
        
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


@celery_app.task(base=ExportTask, bind=True, name='app.tasks.export_tasks.export_yolo_model')
def export_yolo_model(self, task_id: int, export_config: Dict[str, Any]):
    """
    Celery task to export YOLO model to ONNX format.
    This task is executed by Celery worker with proper queuing.
    """
    logger.info(f"Starting YOLO export task {task_id} (Celery task {self.request.id})")
    db = SessionLocal()
    
    try:
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if not task:
            logger.error(f"Export task {task_id} not found")
            return
        
        task.status = "running"
        task.started_at = datetime.utcnow()
        task.progress = 10
        task.task_metadata = {
            **task.task_metadata,
            "stage": "starting",
            "celery_task_id": self.request.id
        }
        db.commit()
        
        model_path = export_config['model_path']
        export_format = export_config.get('export_format', 'onnx')
        # Use static/exports directory for easy access
        output_dir = Path("static/exports")
        output_dir.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"Starting export of model {model_path} to {export_format}")
        
        # Load YOLO model
        task.progress = 20
        task.task_metadata = {**task.task_metadata, "stage": "loading_model"}
        db.commit()
        
        model = YOLO(model_path)
        
        # Export to ONNX
        task.progress = 50
        task.task_metadata = {**task.task_metadata, "stage": "exporting"}
        db.commit()
        
        # Export model
        if export_format.lower() == 'onnx':
            # Determine output filename
            checkpoint = export_config.get('checkpoint', 'best')
            model_stem = Path(model_path).stem
            output_filename = f"{model_stem}_{checkpoint}.onnx"
            output_path = output_dir / output_filename
            
            # Export to ONNX - YOLO exports to the same directory as the model
            model.export(format='onnx', imgsz=640)  # Default image size, can be made configurable
            
            # Find the exported file (YOLO exports to same directory as model by default)
            model_dir = Path(model_path).parent
            exported_file = model_dir / f"{model_stem}.onnx"
            
            if not exported_file.exists():
                # Try alternative location (without .pt extension)
                exported_file = model_dir / f"{Path(model_path).stem.replace('.pt', '')}.onnx"
            
            if not exported_file.exists():
                # Try with just the base name
                exported_file = Path(model_path).with_suffix('.onnx')
            
            if exported_file.exists():
                # Copy to output directory (static/exports)
                shutil.copy2(str(exported_file), str(output_path))
                logger.info(f"Model exported to {output_path}")
            else:
                raise FileNotFoundError(f"Exported ONNX file not found. Searched in {model_dir}")
        else:
            raise ValueError(f"Unsupported export format: {export_format}")
        
        # Update task metadata with relative path for download
        relative_path = f"/static/exports/{output_path.name}"
        task.status = "completed"
        task.completed_at = datetime.utcnow()
        task.progress = 100
        task.task_metadata = {
            **task.task_metadata,
            "stage": "completed",
            "exported_file": str(output_path),
            "exported_file_url": relative_path,
            "export_format": export_format,
            "file_size": output_path.stat().st_size if output_path.exists() else 0
        }
        db.commit()
        
        logger.info(f"Export completed successfully for task {task_id}")
        
        return {
            "status": "completed",
            "task_id": task_id,
            "exported_file": str(output_path)
        }
        
    except Exception as e:
        logger.error(f"Error in export task {task_id}: {str(e)}", exc_info=True)
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if task:
            task.status = "failed"
            task.completed_at = datetime.utcnow()
            task.error_message = str(e)
            task.task_metadata = {
                **(task.task_metadata or {}),
                "stage": "failed",
                "error": str(e),
                "error_details": {
                    "type": type(e).__name__,
                    "message": str(e),
                    "traceback": None  # Could add traceback if needed
                }
            }
            db.commit()
        raise
        
    finally:
        if db:
            db.close()
