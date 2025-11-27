# Celery tasks module
from app.tasks.training_tasks import train_yolo_model, cleanup_old_tasks

__all__ = ['train_yolo_model', 'cleanup_old_tasks']
