from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from typing import List, Optional
import json
import os
import base64
import shutil
from pathlib import Path
import logging
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('backend_debug.log')
    ]
)

# Create logger
logger = logging.getLogger(__name__)

from . import models, schemas
from .database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Ensure required directories exist
Path("data").mkdir(exist_ok=True)
Path("projects").mkdir(exist_ok=True)

# Mount static files directories
app.mount("/data", StaticFiles(directory="data"), name="data")
app.mount("/static/projects", StaticFiles(directory="projects"), name="projects")

# Get allowed origins from environment variable or use default
allowed_origins = os.getenv(
    "ALLOWED_ORIGINS", 
    "http://localhost:3000,http://localhost:8000,http://127.0.0.1:3000,http://localhost:5173,http://localhost:8080"
).split(",")
logger.info(f"Configured CORS allowed origins: {allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

@app.get("/health-check")
async def health_check():
    return {"status": "ok"}


# Import routers
from .routers import projects, datasets, tasks, augmentations, dataset_groups, annotation_db, image_collections, segmentation

# Include routers
app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(tasks.router)
app.include_router(augmentations.router)
app.include_router(dataset_groups.router)
app.include_router(annotation_db.router)
app.include_router(image_collections.router)
app.include_router(segmentation.router)
