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
    'ai_data_creator',
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['app.tasks.training_tasks', 'app.tasks.evaluation_tasks', 'app.tasks.augmentation_tasks', 'app.tasks.dataset_tasks']
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
    },
    
    # Retry settings
    task_acks_late=True,  # Acknowledge task after completion
    task_reject_on_worker_lost=True,  # Requeue task if worker dies
    
    # Logging
    worker_log_format='[%(asctime)s: %(levelname)s/%(processName)s] %(message)s',
    worker_task_log_format='[%(asctime)s: %(levelname)s/%(processName)s] [%(task_name)s(%(task_id)s)] %(message)s',
)

# Optional: Add periodic tasks if needed
# from celery.schedules import crontab
# celery_app.conf.beat_schedule = {
#     'cleanup-old-tasks': {
#         'task': 'app.tasks.training_tasks.cleanup_old_tasks',
#         'schedule': crontab(hour=2, minute=0),  # Run daily at 2 AM
#     },
# }
