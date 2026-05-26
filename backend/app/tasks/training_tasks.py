"""
Celery training task entry points.

This module re-exports task callables for backward compatibility with existing
imports (routers, celery routing, tests). Implementation lives in focused modules:
- training_common.py   — shared TrainingTask base class
- yolo_training.py     — Ultralytics YOLO training
- rtdetr_training.py   — RT-DETR training
- mmyolo_training.py   — MMYOLO / DJI training
- mmyolo_config.py     — MMYOLO config generation
- mmyolo_dji.py        — DJI repo clone/patch/install
"""
import logging

from app.celery_app import celery_app
from app.database import SessionLocal
from app.tasks.mmyolo_config import resolve_mmyolo_base_config
from app.tasks.mmyolo_dji import prepare_dji_mmyolo_repo
from app.tasks.mmyolo_training import train_mmyolo_model
from app.tasks.rtdetr_training import train_rtdetr_model
from app.tasks.training_common import MMYOLO_PYTHON, TrainingTask
from app.tasks.yolo_training import train_yolo_model

logger = logging.getLogger(__name__)

# Backward-compatible aliases for private helpers used elsewhere/tests.
_resolve_mmyolo_base_config = resolve_mmyolo_base_config
_prepare_dji_mmyolo_repo = prepare_dji_mmyolo_repo

__all__ = [
    "TrainingTask",
    "SessionLocal",
    "MMYOLO_PYTHON",
    "train_yolo_model",
    "train_rtdetr_model",
    "train_mmyolo_model",
    "cleanup_old_tasks",
    "resolve_mmyolo_base_config",
    "prepare_dji_mmyolo_repo",
    "_resolve_mmyolo_base_config",
    "_prepare_dji_mmyolo_repo",
]


@celery_app.task(name="app.tasks.training_tasks.cleanup_old_tasks")
def cleanup_old_tasks():
    """Cleanup old completed/failed tasks and their files."""
    db = SessionLocal()
    try:
        logger.info("Cleanup task executed")
    finally:
        db.close()
