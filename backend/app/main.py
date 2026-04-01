from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import text
from typing import List, Optional
from datetime import datetime
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

# Add permissive CORS middleware - specify origins when credentials are allowed
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8000",
        "http://localhost:8080",
        "http://localhost:8081",
        "http://localhost:8082",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:8081",
        "http://127.0.0.1:8082",
    ],
    # Vite uses host "::"; browsers may send Origin: http://[::1]:8080 — not in list above
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Add a simple test endpoint for debugging CORS
@app.get("/test-cors")
async def test_cors(request: Request):
    """Simple endpoint to test CORS configuration"""
    origin = request.headers.get("origin")
    print(f"[DEBUG] Test CORS endpoint called from origin: {origin}")
    
    response = JSONResponse(content={"message": "CORS test successful", "origin": origin})
    
    allowed_origins = [
        "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
        "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
        "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081", 
        "http://127.0.0.1:8082"
    ]
    
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Expose-Headers"] = "*"
        print(f"[DEBUG] Added CORS headers for origin: {origin}")
    else:
        print(f"[DEBUG] Origin {origin} not in allowed list")
    
    return response

# Mount static files directories - COMMENTED OUT TO USE CUSTOM HANDLERS
# app.mount("/data", StaticFiles(directory="data"), name="data")
# app.mount("/static/projects", StaticFiles(directory="projects"), name="projects")

# Add OPTIONS handler for static files CORS preflight
@app.options("/static/projects/{file_path:path}")
async def options_project_files(file_path: str, request: Request):
    """Handle CORS preflight requests for static files"""
    origin = request.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
        "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
        "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081", 
        "http://127.0.0.1:8082"
    ]
    
    headers = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400"
    }
    
    if origin in allowed_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    
    return JSONResponse(content={}, headers=headers)

# Custom static file handlers with explicit CORS
@app.get("/static/projects/{file_path:path}")
async def serve_project_files(file_path: str, request: Request, thumb: Optional[int] = None):
    """Custom handler for project static files with explicit CORS and optional thumbnail generation"""
    print(f"[DEBUG] Static file request: /static/projects/{file_path}, thumb={thumb}")
    print(f"[DEBUG] Request origin: {request.headers.get('origin', 'None')}")
    
    full_path = Path("projects") / file_path
    
    if not full_path.exists() or not full_path.is_file():
        print(f"[DEBUG] File not found: {full_path}")
        raise HTTPException(status_code=404, detail="File not found")
    
    print(f"[DEBUG] File exists, serving: {full_path}")
    
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
    
    # If thumbnail requested, generate/serve thumbnail
    if thumb and suffix in ['.jpg', '.jpeg', '.png', '.webp']:
        thumb_size = min(thumb, 800)  # Cap at 800px
        thumb_dir = full_path.parent / ".thumbs"
        thumb_path = thumb_dir / f"{full_path.stem}_{thumb_size}{suffix}"
        
        # Generate thumbnail if it doesn't exist
        if not thumb_path.exists():
            try:
                from PIL import Image
                thumb_dir.mkdir(exist_ok=True)
                
                with Image.open(full_path) as img:
                    # Calculate aspect ratio preserving dimensions
                    ratio = min(thumb_size / img.width, thumb_size / img.height)
                    new_size = (int(img.width * ratio), int(img.height * ratio))
                    
                    # Use LANCZOS for high quality downscaling
                    thumb_img = img.resize(new_size, Image.Resampling.LANCZOS)
                    
                    # Convert RGBA to RGB for JPEG
                    if suffix in ['.jpg', '.jpeg'] and thumb_img.mode == 'RGBA':
                        thumb_img = thumb_img.convert('RGB')
                    
                    thumb_img.save(thumb_path, quality=85, optimize=True)
                    print(f"[DEBUG] Generated thumbnail: {thumb_path}")
            except Exception as e:
                print(f"[DEBUG] Thumbnail generation failed: {e}, serving original")
                # Fall through to serve original
        
        if thumb_path.exists():
            full_path = thumb_path
    
    # Create FileResponse with explicit CORS headers
    response = FileResponse(
        path=str(full_path),
        media_type=media_type,
        filename=full_path.name
    )
    
    # Add cache headers for thumbnails
    if thumb:
        response.headers["Cache-Control"] = "public, max-age=31536000"  # 1 year cache
    
    # Explicitly add CORS headers
    origin = request.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
        "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
        "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081", 
        "http://127.0.0.1:8082"
    ]
    
    # Add CORS headers - handle both specific origins and None origin
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Expose-Headers"] = "*"
        print(f"[DEBUG] Added CORS headers for origin: {origin}")
    elif origin is None:
        # Allow requests without origin header (direct navigation, same-origin, etc.)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Expose-Headers"] = "*"
        print(f"[DEBUG] Added wildcard CORS headers for request without origin")
    else:
        print(f"[DEBUG] Origin {origin} not in allowed list")
    
    return response

@app.options("/data/{file_path:path}")
async def options_data_files(file_path: str, request: Request):
    """Handle CORS preflight requests for data files"""
    origin = request.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
        "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
        "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081", 
        "http://127.0.0.1:8082"
    ]
    
    headers = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400"
    }
    
    if origin in allowed_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    
    return JSONResponse(content={}, headers=headers)

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
    
    # Create FileResponse with explicit CORS headers
    response = FileResponse(
        path=str(full_path),
        media_type=media_type,
        filename=full_path.name
    )
    
    # Explicitly add CORS headers
    origin = request.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
        "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
        "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081", 
        "http://127.0.0.1:8082"
    ]
    
    # Add CORS headers - handle both specific origins and None origin
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Expose-Headers"] = "*"
    elif origin is None:
        # Allow requests without origin header (direct navigation, same-origin, etc.)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Expose-Headers"] = "*"
    
    return response

# Ensure exports directory exists
Path("static/exports").mkdir(parents=True, exist_ok=True)

# Add OPTIONS handler for exports CORS preflight
@app.options("/static/exports/{file_path:path}")
async def options_export_files(file_path: str, request: Request):
    """Handle CORS preflight requests for export files"""
    origin = request.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
        "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
        "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081", 
        "http://127.0.0.1:8082"
    ]
    
    headers = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400"
    }
    
    if origin in allowed_origins:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Access-Control-Allow-Credentials"] = "true"
    
    return JSONResponse(content={}, headers=headers)

# Custom static file handler for exports
@app.get("/static/exports/{file_path:path}")
async def serve_export_files(file_path: str, request: Request):
    """Custom handler for export files with explicit CORS"""
    full_path = Path("static/exports") / file_path
    
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="Export file not found")
    
    # Create FileResponse with explicit CORS headers
    response = FileResponse(
        path=str(full_path),
        media_type='application/octet-stream',
        filename=full_path.name
    )
    
    # Explicitly add CORS headers
    origin = request.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
        "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
        "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081", 
        "http://127.0.0.1:8082"
    ]
    
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Expose-Headers"] = "*"
    elif origin is None:
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Expose-Headers"] = "*"
    
    return response

# Ensure inference_results directory exists
Path("static/inference_results").mkdir(parents=True, exist_ok=True)

@app.options("/static/inference_results/{file_path:path}")
async def options_inference_files(file_path: str, request: Request):
    """Handle CORS preflight requests for inference result files"""
    origin = request.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
        "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
        "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081", 
        "http://127.0.0.1:8082"
    ]
    
    headers = {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Max-Age": "86400"
    }
    
    if origin in allowed_origins:
        headers["Access-Control-Allow-Origin"] = origin
    elif origin is None:
        headers["Access-Control-Allow-Origin"] = "*"
    
    return JSONResponse(content={}, headers=headers)

# Custom static file handler for inference results
@app.get("/static/inference_results/{file_path:path}")
async def serve_inference_files(file_path: str, request: Request):
    """Custom handler for inference result images with explicit CORS"""
    full_path = Path("static/inference_results") / file_path
    
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status_code=404, detail="Inference result file not found")
    
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
    
    # Create FileResponse with explicit CORS headers
    response = FileResponse(
        path=str(full_path),
        media_type=media_type or 'image/jpeg',
        filename=full_path.name
    )
    
    # Explicitly add CORS headers
    origin = request.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000", "http://localhost:8000", "http://localhost:8080",
        "http://localhost:8081", "http://localhost:8082", "http://127.0.0.1:3000",
        "http://127.0.0.1:8000", "http://127.0.0.1:8080", "http://127.0.0.1:8081", 
        "http://127.0.0.1:8082"
    ]
    
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Expose-Headers"] = "*"
    elif origin is None:
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Expose-Headers"] = "*"
    
    return response

# CORS middleware is handled by the custom middleware above
# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=allowed_origins,
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
#     expose_headers=["*"],
#     max_age=3600,
# )

# Mount static files directories - COMMENTED OUT TO USE CUSTOM HANDLERS
# app.mount("/data", StaticFiles(directory="data"), name="data")
# app.mount("/static/projects", StaticFiles(directory="projects"), name="projects")

@app.get("/health-check")
async def health_check(db: Session = Depends(get_db)):
    """Health check endpoint that verifies both API and database connectivity"""
    try:
        # Test database connection by executing a simple query
        db.execute(text("SELECT 1"))
        db.commit()
        
        return {
            "status": "ok",
            "database": "connected",
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        # Still return 200 but indicate database issue
        return {
            "status": "degraded",
            "database": "disconnected",
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat()
        }


# Import routers
from .routers import projects, datasets, tasks, augmentations, dataset_groups, annotation_db, image_collections, segmentation, database_backup, training, predictions, backup, export, pipelines, auto_annotation, preannotate, system

# Include routers
app.include_router(system.router)
app.include_router(projects.router)
app.include_router(datasets.router)
app.include_router(tasks.router)
app.include_router(augmentations.router)
app.include_router(dataset_groups.router)
app.include_router(annotation_db.router)
app.include_router(image_collections.router)
app.include_router(segmentation.router)
app.include_router(database_backup.router)
app.include_router(training.router)
app.include_router(predictions.router)
app.include_router(backup.router)
app.include_router(export.router)
app.include_router(pipelines.router)
app.include_router(auto_annotation.router)
app.include_router(preannotate.router)