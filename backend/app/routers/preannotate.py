from fastapi import APIRouter, Depends, HTTPException, Form, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional, List, Dict, Any
import json
import asyncio
from datetime import datetime
import cv2
import numpy as np
from PIL import Image
import albumentations as A
from pathlib import Path
import os
import shutil
import logging

from .. import models, schemas
from ..database import get_db

# Create logger for this module
logger = logging.getLogger(__name__)

router = APIRouter()


async def preannotate_with_foundation_model_task(task_id: int, db_path: str, model_name: str, dataset_id: int):
    """Background task to process augmented dataset creation"""
    logger.info(f"Starting augmentation task {task_id}")
    
    from ..database import SessionLocal
    
    db = SessionLocal()
    try:
        # Get the task
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            logger.error(f"Task {task_id} not found")
            return
        
        logger.info(f"Task {task_id}: Found task, current status: {task.status}")
        
        # Check if task was cancelled before starting
        if task.status == 'cancelled':
            logger.info(f"Task {task_id}: Task was cancelled before starting")
            return
        
        # Update task status to running
        task.status = 'running'
        task.started_at = datetime.utcnow()
        task.progress = 0.0
        db.commit()
        logger.info(f"Task {task_id}: Updated status to running")
       
        # Complete the task
        task.status = 'completed'
        task.progress = 100.0
        task.completed_at = datetime.utcnow()
        db.commit()
        
    except Exception as e:
        # Handle any unexpected errors
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if task and task.status != 'cancelled':  # Don't override cancelled status
            task.status = 'failed'
            task.error_message = f'Unexpected error: {str(e)}'
            task.completed_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()