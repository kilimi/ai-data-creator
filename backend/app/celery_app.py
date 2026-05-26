"""
Celery application for background task processing.
"""
import os
import json
import shutil
import subprocess
from datetime import datetime
from celery import Celery
from kombu import Queue

# Get Redis URL from environment or use default
REDIS_URL = os.environ.get('REDIS_URL', 'redis://redis:6379/0')

# Create Celery app
celery_app = Celery(
    'lai',
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['app.tasks.training_tasks', 'app.tasks.yolo_training', 'app.tasks.evaluation_tasks', 'app.tasks.augmentation_tasks', 'app.tasks.dataset_tasks', 'app.tasks.export_tasks', 'app.tasks.depth_estimation_tasks', 'app.tasks.auto_annotation_tasks', 'app.tasks.task_monitoring']
)

# Celery configuration
celery_app.conf.update(
    # Task settings
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    
    # Worker settings
    worker_prefetch_multiplier=1,  # Only fetch one task at a time
    worker_max_tasks_per_child=1,  # Restart worker after each task (to clear GPU memory)
    
    # Queue configuration - single queue for sequential processing
    task_default_queue='training',
    task_queues=(
        Queue('training', routing_key='training'),
    ),
    
    # Result backend settings
    result_expires=3600 * 24,  # Keep results for 24 hours
    result_backend_transport_options={
        'master_name': 'mymaster',
    },
    
    # Task routing
    task_routes={
        'app.tasks.training_tasks.*': {'queue': 'training'},
        'app.tasks.evaluation_tasks.*': {'queue': 'training'},
        'app.tasks.augmentation_tasks.*': {'queue': 'training'},
        'app.tasks.dataset_tasks.*': {'queue': 'training'},
        'app.tasks.export_tasks.*': {'queue': 'training'},
        'app.tasks.depth_estimation_tasks.*': {'queue': 'training'},
        'app.tasks.auto_annotation_tasks.*': {'queue': 'training'},
    },
    
    # Retry settings
    task_acks_late=True,  # Acknowledge task after completion
    task_reject_on_worker_lost=True,  # Requeue task if worker dies
    
    # Logging
    worker_log_format='[%(asctime)s: %(levelname)s/%(processName)s] %(message)s',
    worker_task_log_format='[%(asctime)s: %(levelname)s/%(processName)s] [%(task_name)s(%(task_id)s)] %(message)s',
)

# Optional: Add periodic tasks if needed
from celery.schedules import crontab
from datetime import timedelta

# Include backup tasks
celery_app.conf.update(
    include=['app.tasks.training_tasks', 'app.tasks.yolo_training', 'app.tasks.evaluation_tasks',
             'app.tasks.augmentation_tasks', 'app.tasks.dataset_tasks',
             'app.tasks.export_tasks', 'app.tasks.backup_tasks',
             'app.tasks.depth_estimation_tasks', 'app.tasks.auto_annotation_tasks',
             'app.tasks.task_monitoring']
)

# Periodic backup check - runs every hour to check if backup is due
celery_app.conf.beat_schedule = {
    'check-backup-schedule': {
        'task': 'app.tasks.backup_tasks.run_automatic_backup',
        'schedule': timedelta(hours=1),  # Check every hour
    },
    # Watchdog: auto-cancel stale pending/running tasks with no activity.
    'auto-cancel-stale-tasks': {
        'task': 'app.tasks.task_monitoring.auto_cancel_stale_tasks',
        'schedule': timedelta(minutes=30),  # Detect stale tasks promptly
    },
}


# ===== WORKER STARTUP: Sync Celery tasks with database on restart =====
# This prevents requeued tasks that should be stopped from running again
import logging
from celery.signals import worker_process_init

logger = logging.getLogger(__name__)
GPU_STATUS_REDIS_KEY = os.environ.get('LAI_GPU_STATUS_REDIS_KEY', 'lai:worker_gpu_status')
GPU_STATUS_TTL_SECONDS = int(os.environ.get('LAI_GPU_STATUS_TTL_SECONDS', '300'))


def _run_nvidia_smi() -> list[dict]:
    """Best-effort nvidia-smi query from the worker container."""
    candidates = []
    which_path = shutil.which('nvidia-smi')
    if which_path:
        candidates.append(which_path)
    candidates.extend(['nvidia-smi', '/usr/bin/nvidia-smi'])

    seen = set()
    for exe in candidates:
        if not exe or exe in seen:
            continue
        seen.add(exe)
        try:
            out = subprocess.run(
                [
                    exe,
                    '--query-gpu=name,memory.used,memory.total,utilization.gpu',
                    '--format=csv,noheader,nounits',
                ],
                capture_output=True,
                text=True,
                timeout=3,
            )
            if out.returncode != 0 or not out.stdout.strip():
                continue
            gpus = []
            for line in out.stdout.strip().split('\n'):
                parts = [p.strip() for p in line.split(',')]
                if len(parts) < 4:
                    continue
                try:
                    gpus.append({
                        'name': parts[0],
                        'memory_used_mb': int(float(parts[1] or 0)),
                        'memory_total_mb': int(float(parts[2] or 0)),
                        'utilization_percent': int(float(parts[3] or 0)),
                    })
                except ValueError:
                    continue
            if gpus:
                return gpus
        except Exception:
            continue
    return []


def _collect_worker_gpu_status() -> dict:
    gpus = _run_nvidia_smi()
    total_used_mb = sum(g.get('memory_used_mb', 0) for g in gpus)
    total_mb = sum(g.get('memory_total_mb', 0) for g in gpus)
    return {
        'has_gpu': len(gpus) > 0,
        'gpu_count': len(gpus),
        'gpus': gpus,
        'memory_used_mb': total_used_mb,
        'memory_total_mb': total_mb,
        'source': 'celery_worker',
        'updated_at': datetime.utcnow().isoformat() + 'Z',
    }


def _publish_worker_gpu_status() -> None:
    """Publish worker-visible GPU status into Redis for API-side reads."""
    try:
        import redis

        status = _collect_worker_gpu_status()
        client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        client.setex(GPU_STATUS_REDIS_KEY, GPU_STATUS_TTL_SECONDS, json.dumps(status))
        logger.info(
            "Published worker GPU status to Redis key=%s has_gpu=%s count=%s",
            GPU_STATUS_REDIS_KEY,
            status.get('has_gpu'),
            status.get('gpu_count'),
        )
    except Exception as e:
        logger.warning("Failed to publish worker GPU status: %s", e)


def _upsert_worker_gpu_status_db() -> None:
    """Persist latest worker-visible GPU usage in DB for API reads."""
    try:
        from app.database import SessionLocal
        from app.models import WorkerGpuStatus

        status = _collect_worker_gpu_status()
        db = SessionLocal()
        try:
            row = db.query(WorkerGpuStatus).filter(WorkerGpuStatus.id == 1).first()
            if row is None:
                row = WorkerGpuStatus(id=1)
                db.add(row)
            row.has_gpu = bool(status.get('has_gpu', False))
            row.gpu_count = int(status.get('gpu_count', 0) or 0)
            row.gpus = list(status.get('gpus', []))
            row.memory_used_mb = int(status.get('memory_used_mb', 0) or 0)
            row.memory_total_mb = int(status.get('memory_total_mb', 0) or 0)
            row.source = str(status.get('source', 'celery_worker'))
            row.updated_at = datetime.utcnow()
            db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.warning("Failed to persist worker GPU status to DB: %s", e)


@worker_process_init.connect
def sync_tasks_with_database(sender=None, **kwargs):
    """
    On worker startup, clean up any Celery tasks that were stopped/cancelled in the database.
    This prevents task_reject_on_worker_lost=True from auto-requeuing stopped tasks after
    container restart.
    """
    import time
    time.sleep(1)  # Brief delay to ensure database is ready
    
    try:
        from app.models import Task
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        import os
        
        DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://postgres:postgres@db/lai_db')
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        
        logger.info("=== Worker startup: Syncing Celery tasks with database ===")
        
        try:
            # Find all tasks that should be stopped but might be queued in Celery
            stopped_tasks = db.query(Task).filter(
                Task.status.in_(['stopped', 'cancelled', 'paused'])
            ).all()
            
            for task in stopped_tasks:
                if task.task_metadata and isinstance(task.task_metadata, dict):
                    celery_task_id = task.task_metadata.get('celery_task_id')
                    if celery_task_id:
                        try:
                            # Revoke this task and remove from result backend
                            celery_app.control.revoke(
                                celery_task_id,
                                terminate=True,
                                signal='SIGKILL'
                            )
                            # Also delete from result backend to prevent requeue
                            celery_app.backend.delete(celery_task_id)
                            logger.info(f"Revoked and purged Celery task {celery_task_id} (DB task {task.id} status={task.status})")
                        except Exception as e:
                            logger.warning(f"Failed to revoke Celery task {celery_task_id}: {e}")
            
            logger.info(f"=== Worker startup sync complete: Cleaned {len(stopped_tasks)} stopped/cancelled tasks ===")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Error during worker startup task sync: {e}", exc_info=True)
    finally:
        # Keep this outside DB sync success/failure so the API can still learn GPU
        # availability from the worker even when DB is temporarily unavailable.
        _publish_worker_gpu_status()
        _upsert_worker_gpu_status_db()
