from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import List, Optional
import json
import os
import base64

from . import models, schemas
from .database import engine, get_db

models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Get allowed origins from environment variable or use default
allowed_origins = os.getenv(
    "ALLOWED_ORIGINS", 
    "http://localhost:3000,http://localhost:8000,http://127.0.0.1:3000,http://localhost:5173,http://localhost:8080"
).split(",")

print(f"Configured CORS allowed origins: {allowed_origins}")  # Debug print

# Add CORS middleware
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

# Project endpoints
@app.post("/projects/")
async def create_project(
    name: str = Form(...),
    description: str = Form(""),  # Make description optional with empty default
    tags: Optional[str] = Form(None),
    logo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    try:
        # Parse tags if provided, otherwise use empty list
        parsed_tags = json.loads(tags) if tags else []
        
        # Create project with basic info
        project_data = {
            "name": name,
            "description": description,
            "tags": json.dumps(parsed_tags)  # Store tags as JSON string
        }

        db_project = models.Project(**project_data)

        # Handle logo if provided
        if logo:
            logo_data = await logo.read()
            db_project.logo = logo_data
            # Create a data URL for the logo
            mime_type = logo.content_type or "image/png"
            logo_base64 = base64.b64encode(logo_data).decode()
            db_project.logo_url = f"data:{mime_type};base64,{logo_base64}"

        db.add(db_project)
        db.commit()
        db.refresh(db_project)

        return {
            "success": True,
            "data": {
                "id": db_project.id,
                "name": db_project.name,
                "description": db_project.description,
                "tags": db_project.tags,
                "created_at": db_project.created_at.isoformat(),
                "updated_at": db_project.updated_at.isoformat(),
                "logo_url": db_project.logo_url
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/projects/", response_model=List[schemas.Project])
def read_projects(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    try:
        projects = db.query(models.Project).offset(skip).limit(limit).all()
        # Convert projects to dict and ensure datasets, tags, and logo_url are included
        return [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "created_at": p.created_at,
                "updated_at": p.updated_at,
                "is_project": p.is_project,
                "datasets": p.datasets or [],
                "logo_url": p.logo_url,
                "thumbnailUrl": p.logo_url,  # Include for backward compatibility
                "tags": p.tags  # Add tags to the response
            }
            for p in projects
        ]
    except Exception as e:
        print(f"Error in read_projects: {str(e)}")  # For debugging
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/projects/{project_id}", response_model=schemas.Project)
def read_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project

@app.put("/projects/{project_id}", response_model=schemas.Project)
async def update_project(
    project_id: int,
    name: str = Form(...),
    description: str = Form(""),  # Make description optional with empty default
    tags: Optional[str] = Form(None),  # Add tags parameter
    logo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    try:
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        # Parse tags if provided
        if tags:
            project.tags = json.loads(tags)
        
        # Update basic info
        project.name = name
        project.description = description

        # Handle logo if provided
        if logo:
            logo_data = await logo.read()
            project.logo = logo_data
            # Create a data URL for the logo
            mime_type = logo.content_type or "image/png"
            logo_base64 = base64.b64encode(logo_data).decode()
            project.logo_url = f"data:{mime_type};base64,{logo_base64}"

        db.commit()
        db.refresh(project)
        return project

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/projects/{project_id}")
async def delete_project(project_id: int, db: Session = Depends(get_db)):
    try:
        # First delete all datasets belonging to this project
        db.query(models.Dataset).filter(models.Dataset.project_id == project_id).delete()
        
        # Then delete the project
        result = db.query(models.Project).filter(models.Project.id == project_id).delete()
        if result == 0:
            raise HTTPException(status_code=404, detail="Project not found")
            
        db.commit()
        return {"success": True, "message": "Project and all its datasets have been deleted"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# Dataset endpoints
@app.post("/datasets/", response_model=schemas.Dataset)
async def create_dataset(
    name: str = Form(...),
    description: str = Form(...),
    type: str = Form(...),
    project_id: int = Form(...),
    tags: Optional[str] = Form(None),
    logo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    try:
        # Parse tags if provided, otherwise use empty list
        parsed_tags = json.loads(tags) if tags else []
        
        dataset_data = {
            "name": name,
            "description": description,
            "type": type,
            "project_id": project_id,
            "tags": json.dumps(parsed_tags)  # Store tags as JSON string
        }
        
        db_dataset = models.Dataset(**dataset_data)
        
        if logo:
            logo_data = await logo.read()
            db_dataset.logo = logo_data
            
        db.add(db_dataset)
        db.commit()
        db.refresh(db_dataset)
        return db_dataset
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))

@app.get("/datasets/", response_model=List[schemas.Dataset])
def read_datasets(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    datasets = db.query(models.Dataset).offset(skip).limit(limit).all()
    return datasets

@app.get("/datasets/{dataset_id}", response_model=schemas.Dataset)
def read_dataset(dataset_id: int, db: Session = Depends(get_db)):
    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset

@app.get("/test-project-tags")
async def test_project_tags(db: Session = Depends(get_db)):
    # Create a test project with tags
    project = models.Project(
        name="Test Project with Tags",
        description="Testing tags functionality",
        tags=["test", "tags", "feature"]
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    
    # Return the created project to verify tags are working
    return {
        "success": True,
        "data": {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "tags": project.tags
        }
    }