from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
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

# Get allowed origins from environment variable or use default
allowed_origins = os.getenv(
    "ALLOWED_ORIGINS", 
    "http://localhost:3000,http://localhost:8000,http://127.0.0.1:3000,http://localhost:5173,http://localhost:8080"
).split(",")
logger.info(f"Configured CORS allowed origins: {allowed_origins}")

# Custom CORS middleware to handle all responses
@app.middleware("http")
async def robust_cors_middleware(request: Request, call_next):
    # Handle preflight requests
    if request.method == "OPTIONS":
        origin = request.headers.get("origin")
        if origin in allowed_origins:
            response = JSONResponse(content={"status": "ok"})
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "*"
            response.headers["Access-Control-Max-Age"] = "86400"
            return response

    # Process the actual request
    response = await call_next(request)
    
    # Add CORS headers to the response
    origin = request.headers.get("origin")
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        
        # Add aggressive cache-control headers for all responses to prevent caching issues
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    return response

# Mount static files directories
app.mount("/data", StaticFiles(directory="data"), name="data")
app.mount("/static/projects", StaticFiles(directory="projects"), name="projects")

# Mount static files directories - COMMENTED OUT TO USE CUSTOM HANDLERS
# app.mount("/data", StaticFiles(directory="data"), name="data")
# app.mount("/static/projects", StaticFiles(directory="projects"), name="projects")

# Custom static file handlers with explicit CORS
@app.get("/static/projects/{file_path:path}")
async def serve_project_files(file_path: str, request: Request):
    """Custom handler for project static files with explicit CORS"""
    full_path = Path("projects") / file_path
    
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    
    # Determine media type
    media_type = None
    suffix = full_path.suffix.lower()
    if suffix in ['.jpg', '.jpeg']:
        media_type = 'image/jpeg'
    elif suffix == '.png':
        media_type = 'image/png'
    elif suffix == '.gif':
        media_type = 'image/gif'
    elif suffix == '.webp':
        media_type = 'image/webp'
    
    response = FileResponse(
        path=str(full_path),
        media_type=media_type,
        filename=full_path.name
    )
    
    # Explicitly add CORS headers
    origin = request.headers.get("origin")
    logger.info(f"Static file request: {file_path}, Origin: {origin}")
    
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Expose-Headers"] = "*"
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        logger.info(f"Added CORS headers to static file response for origin: {origin}")
    
    return response

@app.get("/data/{file_path:path}")
async def serve_data_files(file_path: str, request: Request):
    """Custom handler for data static files with explicit CORS"""
    full_path = Path("data") / file_path
    
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    
    # Determine media type
    media_type = None
    suffix = full_path.suffix.lower()
    if suffix in ['.jpg', '.jpeg']:
        media_type = 'image/jpeg'
    elif suffix == '.png':
        media_type = 'image/png'
    elif suffix == '.gif':
        media_type = 'image/gif'
    elif suffix == '.webp':
        media_type = 'image/webp'
    
    response = FileResponse(
        path=str(full_path),
        media_type=media_type,
        filename=full_path.name
    )
    
    # Explicitly add CORS headers
    origin = request.headers.get("origin")
    
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Allow-Methods"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Expose-Headers"] = "*"
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,
)

# Mount static files directories - COMMENTED OUT TO USE CUSTOM HANDLERS
# app.mount("/data", StaticFiles(directory="data"), name="data")
# app.mount("/static/projects", StaticFiles(directory="projects"), name="projects")

@app.get("/health-check")
async def health_check():
    return {"status": "ok"}


# Import routers
from .routers import projects, datasets, tasks, augmentations, dataset_groups, annotation_db, image_collections, segmentation, database_backup

# Include routers
app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(tasks.router)
app.include_router(augmentations.router)
app.include_router(dataset_groups.router)
app.include_router(annotation_db.router)
app.include_router(image_collections.router)
app.include_router(segmentation.router)
app.include_router(database_backup.router)
