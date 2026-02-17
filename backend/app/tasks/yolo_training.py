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
        logger.info(f"YOLOTrainingTask.execute() called with task_id={task_id}, training_config keys={list(training_config.keys())}")
        
        self.task_id = task_id
        self.training_config = training_config
        self.db = SessionLocal()
        
        try:
            celery_task_id = self.request.id if hasattr(self, 'request') and self.request else 'N/A'
            logger.info(f"Starting YOLO training task {task_id} (Celery task {celery_task_id})")
            logger.info(f"Training config: model_type={training_config.get('model_type')}, epochs={training_config.get('epochs')}, batch_size={training_config.get('batch_size')}")
            
            # Initialize task
            logger.info(f"Step 1: Initializing task {task_id}")
            self._initialize_task()
            logger.info(f"Task {task_id} initialized, status set to running")
            
            # Setup directories
            logger.info(f"Step 2: Setting up directories for task {task_id}")
            self._setup_directories()
            logger.info(f"Directories set up: output_base={self.output_base}, weights_dir={self.weights_dir}")
            
            # Prepare dataset
            logger.info(f"Step 3: Preparing dataset for task {task_id}")
            dataset_info = self._prepare_dataset()
            logger.info(f"Dataset prepared: {len(dataset_info.get('class_names', []))} classes, {dataset_info.get('image_counts', {})}")
            
            # Load model
            logger.info(f"Step 4: Loading YOLO model for task {task_id}")
            self._load_model()
            logger.info(f"Model loaded: {self.model}")
            
            # Setup training arguments
            logger.info(f"Step 5: Building training arguments for task {task_id}")
            train_args = self._build_training_args(dataset_info)
            logger.info(f"Training args prepared: project={train_args.get('project')}, epochs={train_args.get('epochs')}")
            
            # Train model
            logger.info(f"Step 6: Starting model training for task {task_id}")
            logger.info(f"About to call model.train() with args: {list(train_args.keys())}")
            self._train_model(train_args)
            logger.info(f"Model training completed for task {task_id}")
            
            # Handle weights
            logger.info(f"Step 7: Handling weights for task {task_id}")
            self._handle_weights()
            
            # Complete task
            logger.info(f"Step 8: Completing task {task_id}")
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
        
        try:
            # Check CUDA availability before loading model
            import torch
            logger.info(f"PyTorch version: {torch.__version__}")
            logger.info(f"CUDA available: {torch.cuda.is_available()}")
            if torch.cuda.is_available():
                logger.info(f"CUDA device count: {torch.cuda.device_count()}")
                logger.info(f"Current CUDA device: {torch.cuda.current_device()}")
                logger.info(f"CUDA device name: {torch.cuda.get_device_name(0)}")
            else:
                logger.warning("CUDA is not available - training will use CPU (very slow)")
            
            logger.info(f"Instantiating YOLO with: {model_path}")
            self.model = YOLO(str(model_path))
            logger.info(f"Model loaded successfully: {type(self.model)}")
            logger.info(f"Model has train method: {hasattr(self.model, 'train')}")
            
            # Test that the model object is valid
            if self.model is None:
                raise ValueError("Model object is None after loading")
            
            # Verify model.train is callable
            if not callable(getattr(self.model, 'train', None)):
                raise ValueError("Model.train is not callable")
                
            logger.info(f"Model validation passed - ready for training")
                
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}", exc_info=True)
            raise
        
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
        logger.info(f"Dataset info keys: {list(dataset_info.keys())}")
        logger.info(f"Dataset yaml_path: {dataset_info.get('yaml_path')}")
        
        train_args = build_yolo_training_args(
            dataset_info,
            self.training_config,
            project_path,
            self.task_id
        )
        
        logger.info(f"Built training args with keys: {list(train_args.keys())}")
        logger.info(f"Starting training with args: {train_args}")
        logger.info(f"IMAGE SIZE EXPLICITLY SET TO: {train_args.get('imgsz', 'NOT SET')}")
        
        # Verify critical paths exist
        data_path = Path(train_args.get('data', ''))
        if not data_path.exists():
            raise FileNotFoundError(f"Data YAML file does not exist: {data_path}")
        logger.info(f"Verified data.yaml exists: {data_path}")
        
        project_dir = Path(train_args.get('project', ''))
        if not project_dir.exists():
            logger.warning(f"Project directory does not exist: {project_dir}, will be created by YOLO")
        else:
            logger.info(f"Project directory exists: {project_dir}")
        
        return train_args
    
    def _train_model(self, train_args: Dict[str, Any]):
        """Execute YOLO model training"""
        logger.info(f"=== _train_model() called ===")
        logger.info(f"Starting YOLO training with project={train_args.get('project')}, name={train_args.get('name')}")
        logger.info(f"Model type: {type(self.model)}")
        logger.info(f"Train args keys: {list(train_args.keys())}")
        train_args_filtered = {k: v for k, v in train_args.items() if k != 'model'}
        logger.info(f"Train args (without full model): {train_args_filtered}")
        
        # Skip permission fixing for now - it might be causing hangs on large directories
        # Just ensure directories exist
        if self.weights_dir:
            try:
                self.weights_dir.mkdir(parents=True, exist_ok=True)
                logger.info(f"Ensured weights directory exists: {self.weights_dir}")
            except Exception as e:
                logger.warning(f"Could not create weights directory: {e}")
        
        if self.output_base:
            try:
                self.output_base.mkdir(parents=True, exist_ok=True)
                logger.info(f"Ensured output_base exists: {self.output_base}")
            except Exception as e:
                logger.warning(f"Could not create output_base: {e}")
        
        # Verify data.yaml exists before training (double check)
        data_yaml_path = Path(train_args.get('data', ''))
        if not data_yaml_path.exists():
            raise FileNotFoundError(f"Data YAML file does not exist: {data_yaml_path}")
        logger.info(f"Final verification: data.yaml exists: {data_yaml_path}")
        
        # Set umask to 0 so files are created with 666 permissions
        old_umask = os.umask(0)
        try:
            logger.info(f"=== About to call model.train() ===")
            logger.info(f"Model: {self.model}, type: {type(self.model)}")
            logger.info(f"Model has train method: {hasattr(self.model, 'train')}")
            logger.info(f"Train args: {train_args}")
            logger.info(f"Data YAML path: {train_args.get('data')} (exists: {Path(train_args.get('data', '')).exists()})")
            logger.info(f"Project path: {train_args.get('project')} (exists: {Path(train_args.get('project', '')).exists()})")
            
            # Flush logs before training to ensure we see them
            import sys
            sys.stdout.flush()
            sys.stderr.flush()
            
            logger.info(f"Calling: self.model.train(**train_args)")
            logger.info(f"This may take a while - training is starting...")
            
            # Force log flush to ensure we see this message
            import sys
            for handler in logger.handlers:
                handler.flush()
            sys.stdout.flush()
            sys.stderr.flush()
            
            # Verify model is still valid before training
            if self.model is None:
                raise ValueError("Model is None - cannot train")
            
            if not hasattr(self.model, 'train'):
                raise ValueError("Model does not have train method")
            
            # Actually call model.train() - this is the critical line
            # Wrap in try-except to catch any silent failures
            try:
                logger.info(f"EXECUTING: model.train() NOW...")
                logger.info(f"Model type before train: {type(self.model)}")
                logger.info(f"Train args data path: {train_args.get('data')}")
                logger.info(f"Train args project: {train_args.get('project')}")
                
                # Double-check data.yaml exists
                data_path = Path(train_args.get('data', ''))
                if not data_path.exists():
                    raise FileNotFoundError(f"Data YAML does not exist at: {data_path}")
                
                # Read and log first few lines of data.yaml for debugging
                try:
                    with open(data_path, 'r') as f:
                        yaml_content = f.read()
                        logger.info(f"Data YAML content (first 500 chars): {yaml_content[:500]}")
                except Exception as e:
                    logger.warning(f"Could not read data.yaml: {e}")
                
                # Force another log flush
                sys.stdout.flush()
                sys.stderr.flush()
                
                # THE ACTUAL TRAINING CALL
                logger.info(f"*** CALLING model.train() NOW - THIS SHOULD START TRAINING ***")
                self.results = self.model.train(**train_args)
                logger.info(f"*** model.train() RETURNED - TRAINING COMPLETED ***")
                logger.info(f"SUCCESS: model.train() completed")
            except Exception as train_error:
                logger.error(f"ERROR in model.train(): {train_error}", exc_info=True)
                logger.error(f"Error type: {type(train_error)}")
                logger.error(f"Error args: {train_error.args}")
                raise
            
            logger.info(f"=== model.train() returned ===")
            logger.info(f"Training completed. Results type: {type(self.results)}")
            logger.info(f"Results: {self.results}")
            
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
        
        # Copy training results to Windows-accessible location
        self._export_training_results(actual_save_dir)
    
    def _export_training_results(self, actual_save_dir: Path):
        """Export training results (weights, plots, metrics) to backups directory for easy access"""
        try:
            # Create export directory in backups (Windows-accessible)
            export_dir = Path("backups") / "training_exports" / f"task_{self.task_id}"
            export_dir.mkdir(parents=True, exist_ok=True)
            
            logger.info(f"Exporting training results to {export_dir}")
            
            # Copy weights
            for weight_name in ["best.pt", "last.pt"]:
                source = self.weights_dir / weight_name
                if source.exists():
                    shutil.copy2(source, export_dir / weight_name)
                    logger.info(f"✓ Exported {weight_name}")
            
            # Copy results files (plots, metrics, CSV)
            if actual_save_dir and actual_save_dir.exists():
                for pattern in ["*.png", "*.csv", "results.json", "args.yaml"]:
                    for file in actual_save_dir.glob(pattern):
                        shutil.copy2(file, export_dir / file.name)
                        logger.info(f"✓ Exported {file.name}")
            
            # Create README with task info
            readme_path = export_dir / "README.txt"
            with open(readme_path, 'w') as f:
                f.write(f"Training Task #{self.task_id}\n")
                f.write(f"{'='*50}\n\n")
                f.write(f"Exported: {datetime.utcnow().isoformat()}\n")
                f.write(f"Model: {self.training_config.get('model_type', 'unknown')}\n")
                f.write(f"Epochs: {self.training_config.get('epochs', 'unknown')}\n")
                f.write(f"\nFiles in this directory:\n")
                f.write(f"  - best.pt: Best model weights (lowest validation loss)\n")
                f.write(f"  - last.pt: Final epoch weights\n")
                f.write(f"  - *.png: Training plots and visualizations\n")
                f.write(f"  - results.csv: Training metrics per epoch\n")
                f.write(f"\nOriginal location (Docker volume):\n")
                f.write(f"  {self.output_base / 'training'}\n")
            
            logger.info(f"✓ Training results exported to: {export_dir}")
            
            # Update task metadata with export location
            self.task.task_metadata["exported_to"] = str(export_dir)
            self.db.commit()
            
        except Exception as e:
            logger.warning(f"Could not export training results: {e}")
            # Don't fail the task if export fails
    
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
    logger.info(f"=== train_yolo_model() called by Celery ===")
    logger.info(f"Task ID: {task_id}, Training config keys: {list(training_config.keys())}")
    logger.info(f"Self type: {type(self)}, has execute: {hasattr(self, 'execute')}")
    
    # Force log flush immediately
    import sys
    sys.stdout.flush()
    sys.stderr.flush()
    for handler in logger.handlers:
        handler.flush()
    
    # self is already an instance of YOLOTrainingTask
    try:
        logger.info(f"About to call self.execute() for task {task_id}")
        result = self.execute(task_id, training_config)
        logger.info(f"=== train_yolo_model() completed successfully ===")
        return result
    except Exception as e:
        logger.error(f"=== train_yolo_model() failed with exception ===")
        logger.error(f"Exception: {e}", exc_info=True)
        logger.error(f"Exception type: {type(e)}")
        logger.error(f"Exception args: {e.args}")
        raise
