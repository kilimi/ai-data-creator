"""Celery queue helpers for model backends."""
from __future__ import annotations

from typing import Any, Dict

from app.ml.registry import celery_queue_for_backend, get_backend


def enqueue_training_task(celery_task: Any, task_id: int, training_config: Dict[str, Any], framework_id: str):
    """Dispatch training to the runtime-profile Celery queue."""
    backend = get_backend(framework_id)
    queue = celery_queue_for_backend(backend)
    return celery_task.apply_async(args=[task_id, training_config], queue=queue)
