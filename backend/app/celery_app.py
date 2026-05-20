"""
Celery application for background task processing.
"""
import os
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
