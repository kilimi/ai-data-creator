"""
Celery tasks for annotation file processing and merging (CPU / I/O).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional

from celery import Task
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import models
from app.celery.general_app import celery_app

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@db/lai_db")
engine = create_engine(DATABASE_URL)
SessionLocalWorker = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class AnnotationTask(Task):
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        logger.error("Annotation task %s failed: %s", task_id, exc)
        if args and len(args) > 0:
            db_task_id = args[0]
            db = SessionLocalWorker()
            try:
                task = db.query(models.Task).filter(models.Task.id == db_task_id).first()
                if task:
                    task.status = "failed"
                    task.completed_at = datetime.utcnow()
                    task.error_message = str(exc)
                    db.commit()
            finally:
                db.close()


@celery_app.task(
    base=AnnotationTask,
    bind=True,
    name="app.tasks.annotation_tasks.process_annotation_file",
)
def process_annotation_file(
    self,
    task_id: int,
    dataset_id: int,
    file_id: str,
):
    """Process an uploaded COCO annotation file (replaces API background thread)."""
    from app.routers.annotation_db import process_coco_annotation_file_task

    db = SessionLocalWorker()
    try:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            raise ValueError(f"Task {task_id} not found")

        metadata = dict(task.task_metadata or {})
        coco_data = metadata.get("coco_data")
        if not coco_data:
            raise ValueError("task_metadata.coco_data is required for annotation processing")

        task.status = "running"
        task.started_at = datetime.utcnow()
        task.progress = 10
        db.commit()

        process_coco_annotation_file_task(
            task_id=task_id,
            file_id=file_id,
            coco_data=coco_data,
            db=db,
        )

        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if task:
            task.status = "completed"
            task.completed_at = datetime.utcnow()
            task.progress = 100
            db.commit()
        logger.info("Annotation processing completed for task %s", task_id)
    except Exception as e:
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if task:
            task.status = "failed"
            task.completed_at = datetime.utcnow()
            task.error_message = str(e)
            db.commit()
        raise
    finally:
        db.close()


@celery_app.task(
    base=AnnotationTask,
    bind=True,
    name="app.tasks.annotation_tasks.merge_annotation_files",
)
def merge_annotation_files(
    self,
    task_id: int,
    dataset_id: int,
    file_ids: List[str],
    merged_filename: str,
    strategy_cfg: Optional[Dict[str, Any]] = None,
):
    """Merge annotation files (replaces API background thread)."""
    from app.routers.datasets import merge_annotation_files_task

    asyncio.run(
        merge_annotation_files_task(
            task_id=task_id,
            dataset_id=dataset_id,
            file_ids=file_ids,
            merged_filename=merged_filename,
            strategy_cfg=strategy_cfg,
        )
    )
