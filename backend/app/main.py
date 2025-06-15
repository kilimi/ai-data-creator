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

from . import models, schemas
from .database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Mount static files directory
app.mount("/data", StaticFiles(directory="data"), name="data")

# Get allowed origins from environment variable or use default
import os
allowed_origins = os.getenv(
    "ALLOWED_ORIGINS", 
    "http://localhost:3000,http://localhost:8000,http://127.0.0.1:3000,http://localhost:5173,http://localhost:8080"
).split(",")
print(f"Configured CORS allowed origins: {allowed_origins}")

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
from .routers import projects, datasets

# Include routers
app.include_router(projects.router)
app.include_router(datasets.router)
