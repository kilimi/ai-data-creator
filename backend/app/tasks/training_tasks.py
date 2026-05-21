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
                    task_meta = task.task_metadata or {}
                    pause_requested = isinstance(task_meta, dict) and bool(task_meta.get("pause_requested_at"))
                    stop_requested = isinstance(task_meta, dict) and bool(task_meta.get("stop_requested_at"))
                    # Don't overwrite 'stopped' or 'paused' — those were set intentionally
                    # before the SIGTERM that triggered this failure callback.
                    if task.status in ('stopped', 'paused') or pause_requested or stop_requested:
                        if pause_requested and task.status != 'paused':
                            task.status = 'paused'
                            task.task_metadata = {
                                **task_meta,
                                'stage': 'paused',
                                'pause_requested_at': None,
                            }
                            db.commit()
                            logger.info(f"DB task {db_task_id} finalized as paused during on_failure")
                            return
                        if stop_requested and task.status not in ('stopped', 'paused'):
                            task.status = 'stopped'
                            task.completed_at = datetime.utcnow()
                            task.error_message = 'Task stopped by user'
                            task.task_metadata = {
                                **task_meta,
                                'stage': 'stopped',
                            }
                            db.commit()
                        logger.info(f"DB task {db_task_id} already has status='{task.status}', skipping on_failure update")
                        return
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
    from sqlalchemy.orm.attributes import flag_modified

    db = SessionLocal()

    # State shared with epoch callback closure
    state = {
        "current_epoch": 0,
        "total_epochs": training_config.get('epochs', 100),
        "metrics_history": [],
    }

    def _find_last_pt(trainer):
        try:
            if hasattr(trainer, 'last') and trainer.last and Path(trainer.last).exists():
                return Path(trainer.last)
            if hasattr(trainer, 'save_dir') and trainer.save_dir:
                candidate = Path(trainer.save_dir) / 'weights' / 'last.pt'
                if candidate.exists():
                    return candidate
        except Exception:
            pass
        return None

    def on_epoch_end(trainer):
        """Per-epoch callback: update DB progress and check for pause/stop."""
        current_epoch = trainer.epoch + 1
        state["current_epoch"] = current_epoch
        total = state["total_epochs"]
        progress = 40 + int((current_epoch / total) * 50)

        # Extract basic metrics
        metrics = {"epoch": current_epoch}
        try:
            if hasattr(trainer, 'metrics') and trainer.metrics:
                for key, val in trainer.metrics.items():
                    try:
                        metrics[key] = float(val)
                    except (TypeError, ValueError):
                        pass
            if hasattr(trainer, 'loss_items') and trainer.loss_items is not None:
                for i, name in enumerate(['box_loss', 'cls_loss', 'dfl_loss']):
                    if i < len(trainer.loss_items):
                        metrics[name] = float(trainer.loss_items[i])
        except Exception as e:
            logger.warning(f"RT-DETR: could not extract metrics: {e}")

        state["metrics_history"].append(metrics)

        try:
            task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
            if not task:
                return

            task_meta = task.task_metadata or {}
            pause_requested = isinstance(task_meta, dict) and bool(task_meta.get("pause_requested_at"))
            stop_requested = isinstance(task_meta, dict) and bool(task_meta.get("stop_requested_at"))

            if task.status in ('stopped', 'paused') or pause_requested or stop_requested:
                if task.status == 'paused' or pause_requested:
                    final_stage = 'paused'
                    if task.status != 'paused':
                        task.status = 'paused'
                else:
                    final_stage = 'stopped'
                    if task.status != 'stopped':
                        task.status = 'stopped'
                        task.completed_at = datetime.utcnow()
                        task.error_message = 'Task stopped by user'

                logger.info(f"RT-DETR task {task_id} entering stage='{final_stage}', stopping training loop")
                last_pt = _find_last_pt(trainer)
                updated_meta = {
                    **task_meta,
                    "current_epoch": current_epoch,
                    "stage": final_stage,
                    "latest_metrics": metrics,
                    "metrics_history": state["metrics_history"],
                    "pause_requested_at": None,
                }
                if last_pt:
                    updated_meta["resume_from"] = str(last_pt)
                    updated_meta["paused_epoch"] = current_epoch
                    logger.info(f"RT-DETR task {task_id}: saved resume_from={last_pt}")
                task.task_metadata = updated_meta
                flag_modified(task, "task_metadata")
                db.commit()
                trainer.stop = True
                return

            task.progress = min(progress, 90)
            task.task_metadata = {
                **(task.task_metadata or {}),
                "current_epoch": current_epoch,
                "stage": "training",
                "latest_metrics": metrics,
                "metrics_history": state["metrics_history"],
            }
            flag_modified(task, "task_metadata")
            db.commit()

            self.update_state(
                state='PROGRESS',
                meta={
                    'current': current_epoch,
                    'total': total,
                    'progress': progress,
                    'status': f'Training epoch {current_epoch}/{total}',
                    'metrics': metrics,
                }
            )
            logger.info(f"RT-DETR task {task_id}: epoch {current_epoch}/{total}")
        except Exception as e:
            logger.error(f"RT-DETR epoch callback error: {e}")

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
            **(task.task_metadata or {}),
            "stage": "initializing",
            "celery_task_id": self.request.id,
            "training_config": training_config,
        }
        db.commit()

        # Load model — support resume from paused checkpoint
        model_type = training_config.get('model_type', 'rtdetr-l.pt')
        resume_from = training_config.get('resume_from')
        logger.info(f"Loading RT-DETR model: {model_type}, resume_from={resume_from}")

        try:
            model = RTDETR(resume_from if resume_from else model_type)
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            base_name = model_type.replace('.pt', '')
            model = RTDETR(base_name)

        # Register epoch callback
        model.add_callback("on_train_epoch_end", on_epoch_end)

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
            'save_period': -1,  # -1 = disabled; last.pt and best.pt are always written each epoch
            'cache': False,
            'workers': 8,
        }

        if resume_from:
            train_args['resume'] = True

        logger.info(f"Starting RT-DETR training with args: {train_args}")
        results = model.train(**train_args)

        # Re-fetch task after blocking train() returns
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if not task:
            return {"status": "completed", "task_id": task_id}

        # If paused/stopped, the callback already set status — don't overwrite
        if task.status in ('paused', 'stopped'):
            logger.info(f"RT-DETR task {task_id} finished training loop with status='{task.status}'")
            return {"status": task.status, "task_id": task_id}

        logger.info(f"RT-DETR training completed for task {task_id}")

        output_base = Path(training_config['output_dir'])
        best_model_path = output_base / "training" / "weights" / "best.pt"
        last_model_path = output_base / "training" / "weights" / "last.pt"

        task.status = "completed"
        task.completed_at = datetime.utcnow()
        task.progress = 100
        task.task_metadata = {
            **(task.task_metadata or {}),
            "stage": "completed",
            "best_model": str(best_model_path) if best_model_path.exists() else None,
            "last_model": str(last_model_path) if last_model_path.exists() else None,
            "results_dir": str(output_base / "training"),
        }
        db.commit()

        return {
            "status": "completed",
            "task_id": task_id,
            "best_model": str(best_model_path) if best_model_path.exists() else None,
        }

    except Exception as e:
        logger.error(f"Error in RT-DETR training task {task_id}: {str(e)}", exc_info=True)
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if task:
            task_meta = task.task_metadata or {}
            pause_requested = isinstance(task_meta, dict) and bool(task_meta.get("pause_requested_at"))
            stop_requested = isinstance(task_meta, dict) and bool(task_meta.get("stop_requested_at"))
            if task.status in ('paused', 'stopped') or pause_requested or stop_requested:
                if pause_requested and task.status != 'paused':
                    task.status = 'paused'
                    task.task_metadata = {
                        **task_meta,
                        'stage': 'paused',
                        'pause_requested_at': None,
                    }
                    db.commit()
                if stop_requested and task.status not in ('paused', 'stopped'):
                    task.status = 'stopped'
                    task.completed_at = datetime.utcnow()
                    task.error_message = 'Task stopped by user'
                    task.task_metadata = {
                        **task_meta,
                        'stage': 'stopped',
                    }
                    db.commit()
            else:
                task.status = "failed"
                task.completed_at = datetime.utcnow()
                task.error_message = str(e)
                task.task_metadata = {
                    **task_meta,
                    "stage": "failed",
                    "error": str(e),
                }
                db.commit()
        raise
    finally:
        db.close()


# ── MMYOLO Celery task ────────────────────────────────────────────────────────

@celery_app.task(
    base=TrainingTask,
    bind=True,
    name="app.tasks.training_tasks.train_mmyolo_model",
)
def train_mmyolo_model(self, task_id: int, training_config: dict):
    """
    Train an MMYOLO / RTMDet model.

    Pipeline:
      1. Prepare COCO-JSON dataset via prepare_mmyolo_dataset()
      2. Build a minimal MMYolo Python config file
      3. Run  `python -m mim run mmyolo train <config_path>`  as a subprocess
      4. Stream stdout for epoch progress and update the DB task
      5. Store best.pth path and mark task completed

    The Celery task honours pause/stop requests the same way as the YOLO task.
    """
    import json as _json
    import subprocess
    import sys
    import tempfile
    from datetime import datetime
    from pathlib import Path

    from app.database import SessionLocal
    from app.models import Task as TaskModel

    db = SessionLocal()
    try:
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if not task:
            logger.error(f"MMYOLO task {task_id} not found in DB")
            return

        task.status = "running"
        task.started_at = datetime.utcnow()
        task.task_metadata = {**(task.task_metadata or {}), "stage": "preparing_dataset"}
        db.commit()

        project_id = training_config["project_id"]
        output_base = Path("projects") / str(project_id) / "training" / f"task_{task_id}"
        output_base.mkdir(parents=True, exist_ok=True)
        dataset_dir = output_base / "dataset"

        # 1. Prepare COCO dataset
        from app.routers.training import prepare_mmyolo_dataset

        dataset_info = prepare_mmyolo_dataset(
            db,
            training_config["dataset_configs"],
            dataset_dir,
            task=training_config.get("task", "detect"),
            remove_images_without_annotations=training_config.get(
                "remove_images_without_annotations", True
            ),
        )

        task.task_metadata = {
            **(task.task_metadata or {}),
            "stage": "dataset_prepared",
            "class_names": dataset_info["class_names"],
            "num_classes": dataset_info["class_count"],
            "image_counts": dataset_info["image_counts"],
        }
        task.progress = 10
        db.commit()

        # 2. Write a minimal Python config file for MMYolo
        arch: str = training_config.get("arch", "rtmdet")
        size: str = training_config.get("size", "s")
        config_id: str = training_config.get("config_id", f"{arch}_{size}")
        epochs: int = training_config.get("epochs", 300)
        batch_size: int = training_config.get("batch_size", 16)
        image_size: int = training_config.get("image_size", 640)
        device: str = training_config.get("device", "0")
        num_classes: int = dataset_info["class_count"]
        train_json: str = dataset_info["train_json"]
        val_json: str = dataset_info.get("val_json", train_json)
        train_images: str = str(dataset_dir / "images" / "train")
        val_images: str = str(dataset_dir / "images" / "val")

        cfg_content = f"""_base_ = ['{config_id}.py']

# Override dataset/training parameters
train_batch_size_per_gpu = {batch_size}
train_num_workers = 4
val_batch_size_per_gpu = 1
val_num_workers = 2
max_epochs = {epochs}
num_classes = {num_classes}
img_scale = ({image_size}, {image_size})

# Dataset paths
train_ann_file = '{train_json}'
train_data_prefix = '{train_images}/'
val_ann_file = '{val_json}'
val_data_prefix = '{val_images}/'

# Work dir (output)
work_dir = '{str(output_base / "training")}'
"""

        cfg_path = output_base / "mmyolo_config.py"
        cfg_path.write_text(cfg_content)

        task.task_metadata = {**(task.task_metadata or {}), "stage": "training", "config_path": str(cfg_path)}
        task.progress = 15
        db.commit()

        # 3. Run mim as a subprocess and stream output for progress
        cmd = [
            sys.executable, "-m", "mim", "run", "mmyolo", "train",
            str(cfg_path),
            "--cfg-options", f"train_batch_size_per_gpu={batch_size}",
        ]
        logger.info(f"MMYOLO task {task_id}: running command: {' '.join(cmd)}")

        env = {**__import__('os').environ}
        if device != "cpu":
            env["CUDA_VISIBLE_DEVICES"] = device

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
        )

        # 4. Stream and parse epoch progress
        epoch_log: list = []
        for line in process.stdout:  # type: ignore[union-attr]
            line = line.rstrip()
            logger.debug(f"MMYOLO[{task_id}]: {line}")
            epoch_log.append(line)

            # Check pause / stop
            db.refresh(task)
            task_meta = task.task_metadata or {}
            if task_meta.get("stop_requested_at"):
                process.terminate()
                task.status = "stopped"
                task.completed_at = datetime.utcnow()
                task.task_metadata = {**task_meta, "stage": "stopped"}
                db.commit()
                return
            if task_meta.get("pause_requested_at"):
                process.terminate()
                task.status = "paused"
                task.task_metadata = {**task_meta, "stage": "paused", "pause_requested_at": None}
                db.commit()
                return

            # Parse epoch line: "Epoch(train)  [N][M/L] ..."
            import re
            m = re.search(r"Epoch\s*\S*\s*\[\s*(\d+)\]", line)
            if m:
                current_epoch = int(m.group(1))
                progress = 15 + int((current_epoch / epochs) * 75)
                task.progress = min(progress, 90)
                task.task_metadata = {
                    **task_meta,
                    "stage": "training",
                    "current_epoch": current_epoch,
                    "total_epochs": epochs,
                }
                db.commit()

        process.wait()

        if process.returncode != 0:
            error_tail = "\n".join(epoch_log[-30:])
            raise RuntimeError(
                f"mim run mmyolo train exited with code {process.returncode}.\n{error_tail}"
            )

        # 5. Collect best.pth
        weights_dir = output_base / "training"
        best_model: str | None = None
        for candidate in [weights_dir / "best.pth", weights_dir / "epoch_last.pth"]:
            if candidate.exists():
                best_model = str(candidate)
                break

        task.status = "completed"
        task.completed_at = datetime.utcnow()
        task.progress = 100
        task.task_metadata = {
            **(task.task_metadata or {}),
            "stage": "completed",
            "best_model": best_model,
            "results_dir": str(weights_dir),
            "class_names": dataset_info["class_names"],
            "class_count": dataset_info["class_count"],
            "image_counts": dataset_info["image_counts"],
        }
        db.commit()
        logger.info(f"MMYOLO task {task_id} completed. best_model={best_model}")
        return {"status": "completed", "task_id": task_id, "best_model": best_model}

    except Exception as exc:
        logger.error(f"Error in MMYOLO training task {task_id}: {exc}", exc_info=True)
        task = db.query(TaskModel).filter(TaskModel.id == task_id).first()
        if task:
            task_meta = task.task_metadata or {}
            if task.status not in ("paused", "stopped"):
                task.status = "failed"
                task.completed_at = datetime.utcnow()
                task.error_message = str(exc)
                task.task_metadata = {**task_meta, "stage": "failed", "error": str(exc)}
                db.commit()
        raise
    finally:
        db.close()
