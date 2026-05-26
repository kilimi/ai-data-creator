"""Shared Celery training infrastructure."""
import logging
import os
from datetime import datetime

from celery import Task

from app.database import SessionLocal
from app.models import Task as TaskModel

logger = logging.getLogger(__name__)

MMYOLO_PYTHON = os.environ.get("MMYOLO_PYTHON", "/opt/mmyolo-venv/bin/python")


class TrainingTask(Task):
    """Base task for training with progress tracking."""

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        """Called when task fails."""
        logger.error(f"Task {task_id} failed: {exc}")

        db = SessionLocal()
        try:
            if not args:
                return
            db_task_id = args[0]
            task = db.query(TaskModel).filter(TaskModel.id == db_task_id).first()
            if not task:
                return

            task_meta = task.task_metadata or {}
            pause_requested = isinstance(task_meta, dict) and bool(task_meta.get("pause_requested_at"))
            stop_requested = isinstance(task_meta, dict) and bool(task_meta.get("stop_requested_at"))

            if task.status in ("stopped", "paused") or pause_requested or stop_requested:
                if pause_requested and task.status != "paused":
                    task.status = "paused"
                    task.task_metadata = {
                        **task_meta,
                        "stage": "paused",
                        "pause_requested_at": None,
                    }
                    db.commit()
                    logger.info(f"DB task {db_task_id} finalized as paused during on_failure")
                    return
                if stop_requested and task.status not in ("stopped", "paused"):
                    task.status = "stopped"
                    task.completed_at = datetime.utcnow()
                    task.error_message = "Task stopped by user"
                    task.task_metadata = {**task_meta, "stage": "stopped"}
                    db.commit()
                logger.info(
                    f"DB task {db_task_id} already has status='{task.status}', skipping on_failure update"
                )
                return

            task.status = "failed"
            task.completed_at = datetime.utcnow()
            task.error_message = str(exc)
            db.commit()
        finally:
            db.close()
