"""
Celery tasks for YOLO training.
"""
import os
import json
import shutil
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List

from celery import Task
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.celery_app import celery_app
from app.models import Task as TaskModel, Annotation, AnnotationClass, AnnotationFile, Dataset, Image, ImageCollection
from app.database import get_db

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


@celery_app.task(base=TrainingTask, bind=True, name='app.tasks.training_tasks.train_yolo_model')
def train_yolo_model(self, task_id: int, training_config: Dict[str, Any]):
    """
    Celery task to train YOLO model with progress updates.
    This task is executed by Celery worker with proper queuing.
    """
    from app.routers.training import prepare_yolo_dataset
    
    logger.info(f"Starting YOLO training task {task_id} (Celery task {self.request.id})")
    db = SessionLocal()
    
    # Custom callback for progress updates
    class ProgressCallback:
        def __init__(self, celery_task, task_id: int, total_epochs: int, db_session):
            self.celery_task = celery_task
            self.task_id = task_id
            self.total_epochs = total_epochs
            self.current_epoch = 0
            self.db = db_session
            self.metrics_history = []
            
        def on_train_epoch_end(self, trainer):
            """Called at the end of each training epoch"""
            self.current_epoch = trainer.epoch + 1
            # Progress: 40% (loading) + 50% (training) + 10% (saving)
            progress = 40 + int((self.current_epoch / self.total_epochs) * 50)
            
            # Extract metrics from trainer
            metrics = {}
            try:
                # Get loss items directly from trainer
                losses = {}
                if hasattr(trainer, 'loss_items') and trainer.loss_items is not None:
                    loss_names = ['box_loss', 'cls_loss', 'dfl_loss']
                    if hasattr(trainer, 'model') and hasattr(trainer.model, 'model'):
                        # Check if it's a segmentation model
                        model_yaml = str(trainer.args.model).lower() if hasattr(trainer, 'args') else ''
                        if 'seg' in model_yaml:
                            loss_names.append('seg_loss')
                    
                    for i, name in enumerate(loss_names):
                        if i < len(trainer.loss_items):
                            losses[name] = float(trainer.loss_items[i])
                
                # Get validation metrics from trainer.metrics if available
                val_metrics = {}
                if hasattr(trainer, 'metrics') and trainer.metrics:
                    metrics_data = trainer.metrics
                    
                    # Log available keys for debugging (only first epoch)
                    if self.current_epoch == 1:
                        logger.info(f"Available metric keys: {list(metrics_data.keys())}")
                    
                    # Extract validation metrics
                    for key in metrics_data.keys():
                        if 'precision' in key.lower():
                            val_metrics['precision'] = float(metrics_data[key])
                        elif 'recall' in key.lower():
                            val_metrics['recall'] = float(metrics_data[key])
                        elif 'map50-95' in key.lower() or 'map@50:95' in key.lower():
                            val_metrics['mAP50_95'] = float(metrics_data[key])
                        elif 'map50' in key.lower() or 'map@50' in key.lower():
                            val_metrics['mAP50'] = float(metrics_data[key])
                
                # Build metrics dictionary
                metrics = {
                    'epoch': self.current_epoch,
                    **losses,
                    **val_metrics,
                    'lr0': float(trainer.optimizer.param_groups[0]['lr']) if hasattr(trainer, 'optimizer') else 0,
                    'lr1': float(trainer.optimizer.param_groups[1]['lr']) if hasattr(trainer, 'optimizer') and len(trainer.optimizer.param_groups) > 1 else 0,
                    'lr2': float(trainer.optimizer.param_groups[2]['lr']) if hasattr(trainer, 'optimizer') and len(trainer.optimizer.param_groups) > 2 else 0,
                }
                
                self.metrics_history.append(metrics)
                logger.info(f"Epoch {self.current_epoch} metrics: {metrics}")
            except Exception as e:
                logger.warning(f"Could not extract metrics: {e}", exc_info=True)
            
            # Update task in database
            try:
                task = self.db.query(TaskModel).filter(TaskModel.id == self.task_id).first()
                if task:
                    task.progress = min(progress, 90)
                    task.task_metadata = {
                        **(task.task_metadata or {}),
                        "current_epoch": self.current_epoch,
                        "stage": "training",
                        "latest_metrics": metrics,
                        "metrics_history": self.metrics_history[-10:]  # Keep last 10 epochs
                    }
                    self.db.commit()
                    
                    # Update Celery task state
                    self.celery_task.update_state(
                        state='PROGRESS',
                        meta={
                            'current': self.current_epoch,
                            'total': self.total_epochs,
                            'progress': progress,
                            'status': f'Training epoch {self.current_epoch}/{self.total_epochs}',
                            'metrics': metrics
                        }
                    )
                    logger.info(f"Task {self.task_id}: Completed epoch {self.current_epoch}/{self.total_epochs}")
            except Exception as e:
                logger.error(f"Error updating progress: {e}")
    
    try:
        # Update task status
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if not task:
            logger.error(f"Task {task_id} not found")
            return
        
        task.status = "running"
        task.started_at = datetime.utcnow()
        db.commit()
        
        # Prepare dataset
        logger.info(f"Preparing dataset for task {task_id}")
        task.progress = 10
        task.task_metadata = {"stage": "preparing_dataset", "celery_task_id": self.request.id}
        db.commit()
        
        # Create output directory
        output_base = Path("projects") / str(training_config['project_id']) / "training" / f"task_{task_id}"
        output_base.mkdir(parents=True, exist_ok=True)
        
        dataset_dir = output_base / "dataset"
        dataset_info = prepare_yolo_dataset(
            db,
            training_config['dataset_configs'],
            dataset_dir
        )
        
        logger.info(f"Dataset prepared: {dataset_info}")
        task.progress = 30
        task.task_metadata = {
            "stage": "dataset_prepared",
            "dataset_info": dataset_info,
            "celery_task_id": self.request.id
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
        progress_callback = ProgressCallback(self, task_id, total_epochs, db)
        
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
            'save_period': training_config.get('save_period', -1),  # -1 = only best and last, or every N epochs
            'verbose': True,
        }
        
        # Add augmentation parameters if provided
        augmentations = training_config.get('augmentations', {})
        if augmentations:
            # Color augmentations
            if augmentations.get('enable_color', True):
                train_args['hsv_h'] = augmentations.get('hsv_h', 0.015)
                train_args['hsv_s'] = augmentations.get('hsv_s', 0.7)
                train_args['hsv_v'] = augmentations.get('hsv_v', 0.4)
            else:
                train_args['hsv_h'] = 0.0
                train_args['hsv_s'] = 0.0
                train_args['hsv_v'] = 0.0
            
            # Geometric augmentations
            if augmentations.get('enable_geometric', True):
                train_args['degrees'] = augmentations.get('degrees', 0.0)
                train_args['translate'] = augmentations.get('translate', 0.1)
                train_args['scale'] = augmentations.get('scale', 0.5)
                train_args['shear'] = augmentations.get('shear', 0.0)
                train_args['perspective'] = augmentations.get('perspective', 0.0)
                train_args['flipud'] = augmentations.get('flipud', 0.0)
                train_args['fliplr'] = augmentations.get('fliplr', 0.5)
            else:
                train_args['degrees'] = 0.0
                train_args['translate'] = 0.0
                train_args['scale'] = 0.0
                train_args['shear'] = 0.0
                train_args['perspective'] = 0.0
                train_args['flipud'] = 0.0
                train_args['fliplr'] = 0.0
            
            # Advanced augmentations
            if augmentations.get('enable_advanced', True):
                train_args['mosaic'] = augmentations.get('mosaic', 1.0)
                train_args['mixup'] = augmentations.get('mixup', 0.0)
                train_args['copy_paste'] = augmentations.get('copy_paste', 0.0)
                if 'auto_augment' in augmentations:
                    train_args['auto_augment'] = augmentations['auto_augment']
                train_args['erasing'] = augmentations.get('erasing', 0.4)
                train_args['crop_fraction'] = augmentations.get('crop_fraction', 1.0)
            else:
                train_args['mosaic'] = 0.0
                train_args['mixup'] = 0.0
                train_args['copy_paste'] = 0.0
                train_args['erasing'] = 0.0
        
        # Add W&B if enabled
        if training_config.get('use_wandb'):
            train_args['project'] = training_config.get('wandb_project', f"yolo_training_{task_id}")
            if training_config.get('wandb_entity'):
                train_args['entity'] = training_config['wandb_entity']
        
        logger.info(f"Starting training with args: {train_args}")
        logger.info(f"IMAGE SIZE EXPLICITLY SET TO: {train_args.get('imgsz', 'NOT SET')}")
        
        # Train the model
        results = model.train(**train_args)
        
        logger.info(f"Training completed. Checking actual image size used...")
        if hasattr(model, 'trainer') and hasattr(model.trainer, 'args'):
            logger.info(f"Trainer args imgsz: {model.trainer.args.imgsz}")
        if hasattr(results, 'args'):
            logger.info(f"Results args imgsz: {results.args.imgsz}")
        
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
        
        return {
            "status": "completed",
            "task_id": task_id,
            "best_model": str(best_model_path) if best_model_path.exists() else None
        }
        
    except Exception as e:
        logger.error(f"Error in training task {task_id}: {str(e)}", exc_info=True)
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
        model_type = training_config.get('model_type', 'rtdetr-r50.pt')
        logger.info(f"Loading RT-DETR model: {model_type}")
        model = RTDETR(model_type)
        
        # Progress callback
        class ProgressCallback:
            def __init__(self, task_id, db_session):
                self.task_id = task_id
                self.db = db_session
                self.last_progress = 0
                
            def __call__(self, trainer):
                """Called during training"""
                if hasattr(trainer, 'epoch') and hasattr(trainer, 'epochs'):
                    progress = int((trainer.epoch / trainer.epochs) * 100)
                    
                    # Only update if progress changed
                    if progress != self.last_progress:
                        task = self.db.query(TaskModel).filter(TaskModel.id == self.task_id).first()
                        if task:
                            task.progress = progress
                            task.task_metadata = {
                                **task.task_metadata,
                                "stage": "training",
                                "current_epoch": trainer.epoch,
                                "total_epochs": trainer.epochs
                            }
                            self.db.commit()
                            self.last_progress = progress
                            logger.info(f"Task {self.task_id} progress: {progress}%")
        
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
            'workers': 8,
            'callbacks': [ProgressCallback(task_id, db)]
        }
        
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
