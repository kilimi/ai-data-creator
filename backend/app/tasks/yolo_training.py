"""
YOLO training task implementation.
Separated from training_tasks.py for better organization.
"""
import os
import shutil
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, Tuple

from app.tasks.training_tasks import TrainingTask, SessionLocal
from app.models import Task as TaskModel
from app.celery_app import celery_app

logger = logging.getLogger(__name__)


class YOLOTrainingTask(TrainingTask):
    """YOLO training task implementation"""
    
    def __init__(self):
        super().__init__()
        self.task_id: Optional[int] = None
        self.training_config: Optional[Dict[str, Any]] = None
        self.db = None
        self.task: Optional[TaskModel] = None
        self.output_base: Optional[Path] = None
        self.weights_dir: Optional[Path] = None
        self.model = None
        self.results = None
    
    def execute(self, task_id: int, training_config: Dict[str, Any]):
        """
        Main entry point for YOLO training task.
        This method contains the actual training logic.
        """
        self.task_id = task_id
        self.training_config = training_config
        self.db = SessionLocal()
        
        try:
            celery_task_id = self.request.id if hasattr(self, 'request') and self.request else 'N/A'
            logger.info(f"Starting YOLO training task {task_id} (Celery task {celery_task_id})")
            
            # Initialize task
            self._initialize_task()
            
            # Setup directories
            self._setup_directories()
            
            # Prepare dataset
            dataset_info = self._prepare_dataset()
            
            # Load model
            self._load_model()
            
            # Setup training arguments
            train_args = self._build_training_args(dataset_info)
            
            # Train model
            self._train_model(train_args)
            
            # Handle weights
            self._handle_weights()
            
            # Complete task
            self._complete_task(dataset_info)
            
            logger.info(f"Training completed successfully for task {task_id}")
            
            return {
                "status": "completed",
                "task_id": task_id,
                "best_model": str(self.weights_dir / "best.pt") if (self.weights_dir / "best.pt").exists() else None
            }
            
        except Exception as e:
            logger.error(f"Error in training task {task_id}: {str(e)}", exc_info=True)
            self._handle_error(e)
            raise
        finally:
            if self.db:
                self.db.close()
    
    
    def _initialize_task(self):
        """Initialize task in database"""
        self.task = self.db.query(TaskModel).filter(TaskModel.id == self.task_id).first()
        if not self.task:
            raise ValueError(f"Task {self.task_id} not found")
        
        self.task.status = "running"
        self.task.started_at = datetime.utcnow()
        self.task.progress = 10
        self.task.task_metadata = {
            **(self.task.task_metadata or {}),  # Preserve existing metadata
            "stage": "preparing_dataset",
            "celery_task_id": self.request.id
        }
        self.db.commit()
    
    def _setup_directories(self):
        """Create and setup output directories with proper permissions"""
        from app.tasks.yolo_training_helpers import setup_training_directories
        
        project_id = self.training_config['project_id']
        output_paths = setup_training_directories(project_id, self.task_id)
        
        self.output_base = output_paths['output_base']
        self.weights_dir = output_paths['weights_dir']
        
        logger.info(f"Output directory: {self.output_base}")
        logger.info(f"Weights directory: {self.weights_dir}")
    
    def _prepare_dataset(self):
        """Prepare YOLO dataset from database annotations"""
        from app.routers.training import prepare_yolo_dataset
        
        logger.info(f"Preparing dataset for task {self.task_id}")
        
        dataset_dir = self.output_base / "dataset"
        model_type = self.training_config.get('model_type', 'yolo11n-seg.pt')
        
        dataset_info = prepare_yolo_dataset(
            self.db,
            self.training_config['dataset_configs'],
            dataset_dir,
            model_type=model_type,
            remove_images_without_annotations=self.training_config.get('remove_images_without_annotations', True)
        )
        
        logger.info(f"Dataset prepared: {dataset_info}")
        self.task.progress = 30
        self.task.task_metadata = {
            **(self.task.task_metadata or {}),  # Preserve existing metadata (including dataset_configs)
            "stage": "dataset_prepared",
            "dataset_info": dataset_info,
            "celery_task_id": self.request.id
        }
        self.db.commit()
        
        return dataset_info
    
    def _load_model(self):
        """Load YOLO model"""
        from ultralytics import YOLO
        
        model_type = self.training_config.get('model_type', 'yolo11n-seg.pt')
        logger.info(f"Loading YOLO model: {model_type}")
        
        model_path = Path(model_type)
        if not model_path.exists():
            model_path = model_type
        
        self.model = YOLO(str(model_path))
        
        # Add progress callback
        total_epochs = self.training_config.get('epochs', 100)
        progress_callback = self._create_progress_callback(total_epochs)
        self.model.add_callback("on_train_epoch_end", progress_callback.on_train_epoch_end)
        
        self.task.progress = 40
        self.task.task_metadata = {
            **self.task.task_metadata,
            "stage": "training",
            "model_loaded": str(model_path),
            "total_epochs": total_epochs
        }
        self.db.commit()
    
    def _create_progress_callback(self, total_epochs: int):
        """Create progress callback for training updates"""
        from app.tasks.yolo_training_helpers import ProgressCallback
        
        return ProgressCallback(self, self.task_id, total_epochs, self.db)
    
    def _build_training_args(self, dataset_info: Dict[str, Any]) -> Dict[str, Any]:
        """Build training arguments dictionary"""
        from app.tasks.yolo_training_helpers import build_yolo_training_args
        
        project_path = self.output_base.resolve()
        logger.info(f"Setting YOLO project to: {project_path}")
        
        train_args = build_yolo_training_args(
            dataset_info,
            self.training_config,
            project_path,
            self.task_id
        )
        
        logger.info(f"Starting training with args: {train_args}")
        logger.info(f"IMAGE SIZE EXPLICITLY SET TO: {train_args.get('imgsz', 'NOT SET')}")
        
        return train_args
    
    def _train_model(self, train_args: Dict[str, Any]):
        """Execute YOLO model training"""
        logger.info(f"Starting YOLO training with project={train_args['project']}, name={train_args['name']}")
        
        # Recursively ensure all directories in the path have correct permissions
        # This is critical because YOLO creates directories during training
        from app.tasks.yolo_training_helpers import fix_path_permissions_recursive
        
        # Ensure weights directory and all parent directories have correct permissions
        if self.weights_dir:
            try:
                # Create the directory structure
                self.weights_dir.mkdir(parents=True, exist_ok=True)
                # Fix permissions recursively on the entire path
                fix_path_permissions_recursive(self.weights_dir)
                logger.info(f"Ensured weights directory and all parents have permissions: {self.weights_dir}")
            except Exception as e:
                logger.warning(f"Could not ensure weights directory permissions: {e}")
        
        # Also ensure the output_base and training directories have correct permissions
        if self.output_base:
            try:
                fix_path_permissions_recursive(self.output_base)
                training_dir = self.output_base / "training"
                if training_dir.exists():
                    fix_path_permissions_recursive(training_dir)
            except Exception as e:
                logger.warning(f"Could not ensure output_base permissions: {e}")
        
        # Set umask to 0 so files are created with 666 permissions
        old_umask = os.umask(0)
        try:
            self.results = self.model.train(**train_args)
            logger.info(f"Training completed. Results type: {type(self.results)}")
            
            # After training, recursively fix permissions on weights directory and all files
            if self.weights_dir and self.weights_dir.exists():
                try:
                    fix_path_permissions_recursive(self.weights_dir)
                    # Fix permissions on any weight files that were created
                    for weight_file in self.weights_dir.rglob("*.pt"):
                        try:
                            os.chmod(weight_file, 0o666)
                            logger.info(f"Fixed permissions on {weight_file}")
                        except Exception as e:
                            logger.warning(f"Could not fix permissions on {weight_file}: {e}")
                except Exception as e:
                    logger.warning(f"Could not fix permissions after training: {e}")
        finally:
            os.umask(old_umask)
    
    def _handle_weights(self):
        """Handle weight files after training"""
        from app.tasks.yolo_training_helpers import (
            get_yolo_save_directory,
            copy_weights_to_expected_location
        )
        
        logger.info("Training completed. Checking actual image size used...")
        if hasattr(self.model, 'trainer') and hasattr(self.model.trainer, 'args'):
            logger.info(f"Trainer args imgsz: {self.model.trainer.args.imgsz}")
        if hasattr(self.results, 'args'):
            logger.info(f"Results args imgsz: {self.results.args.imgsz}")
        
        # Get actual save directory from YOLO
        actual_save_dir = get_yolo_save_directory(self.model, self.results)
        
        self.task.progress = 90
        self.task.task_metadata = {
            **self.task.task_metadata,
            "stage": "training_completed",
            "results_saved": str(self.output_base / "training"),
            "yolo_actual_save_dir": str(actual_save_dir) if actual_save_dir else None
        }
        self.db.commit()
        
        # Copy weights to expected location
        weights_info = copy_weights_to_expected_location(
            actual_save_dir,
            self.weights_dir,
            self.output_base
        )
        
        # Store weights info in task metadata
        self.task.task_metadata.update(weights_info)
    
    def _complete_task(self, dataset_info: Dict[str, Any]):
        """Mark task as completed and update metadata"""
        best_model_path = self.weights_dir / "best.pt"
        last_model_path = self.weights_dir / "last.pt"
        
        self.task.status = "completed"
        self.task.completed_at = datetime.utcnow()
        self.task.progress = 100
        self.task.task_metadata = {
            **self.task.task_metadata,
            "stage": "completed",
            "best_model": str(best_model_path) if best_model_path.exists() else None,
            "last_model": str(last_model_path) if last_model_path.exists() else None,
            "class_names": dataset_info['class_names'],
            "class_count": dataset_info['class_count'],
            "image_counts": dataset_info['image_counts'],
            "results_dir": str(self.output_base / "training")
        }
        self.db.commit()
    
    def _handle_error(self, error: Exception):
        """Handle training errors"""
        if self.task:
            self.task.status = "failed"
            self.task.completed_at = datetime.utcnow()
            self.task.error_message = str(error)
            self.task.task_metadata = {
                **(self.task.task_metadata or {}),
                "stage": "failed",
                "error": str(error)
            }
            self.db.commit()


# Register as Celery task with the original name for backward compatibility
@celery_app.task(base=YOLOTrainingTask, bind=True, name='app.tasks.training_tasks.train_yolo_model')
def train_yolo_model(self, task_id: int, training_config: Dict[str, Any]):
    """
    Celery task wrapper for YOLO training.
    This is the entry point called by Celery.
    When bind=True, 'self' is the task instance (YOLOTrainingTask).
    Uses the original task name for backward compatibility.
    """
    # self is already an instance of YOLOTrainingTask
    return self.execute(task_id, training_config)
