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

# Function to get base URL
def get_base_url(request: Request) -> str:
    return str(request.base_url).rstrip('/')

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

@app.post("/projects/{project_id}/duplicate")
async def duplicate_project(project_id: int, db: Session = Depends(get_db)):
    try:
        # Get the original project
        original_project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if original_project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        # Create a new project with the same data
        new_project = models.Project(
            name=f"{original_project.name} (Copy)",
            description=original_project.description,
            tags=original_project.tags,
            logo=original_project.logo,
            logo_url=original_project.logo_url
        )
        
        db.add(new_project)
        db.flush()  # Flush to get the new project ID
        
        # Copy all datasets
        for dataset in original_project.datasets:
            new_dataset = models.Dataset(
                name=dataset.name,
                description=dataset.description,
                type=dataset.type,
                tags=dataset.tags,
                project_id=new_project.id,
                image_count=dataset.image_count,
                annotation_count=dataset.annotation_count
            )
            db.add(new_dataset)
        
        db.commit()
        db.refresh(new_project)
        
        return {
            "success": True,
            "data": {
                "id": new_project.id,
                "name": new_project.name,
                "description": new_project.description,
                "tags": new_project.tags,
                "created_at": new_project.created_at.isoformat(),
                "updated_at": new_project.updated_at.isoformat(),
                "datasets": new_project.datasets,
                "logo_url": new_project.logo_url
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

# Dataset endpoints
@app.post("/datasets/", response_model=schemas.Dataset)
async def create_dataset(
    name: str = Form(...),
    description: str | None = Form(None),  # Make description optional
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
            "description": description,  # This will now be None if not provided
            "type": type,
            "project_id": project_id,
            "tags": json.dumps(parsed_tags)  # Store tags as JSON string
        }
        
        db_dataset = models.Dataset(**dataset_data)
        
        # Handle logo if provided
        if logo:
            logo_data = await logo.read()
            db_dataset.logo = logo_data
            # Create a data URL for the logo
            mime_type = logo.content_type or "image/png"
            logo_base64 = base64.b64encode(logo_data).decode()
            db_dataset.logo_url = f"data:{mime_type};base64,{logo_base64}"
            # Set thumbnailUrl to be the same as logo_url for now
            db_dataset.thumbnailUrl = db_dataset.logo_url
            
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

@app.put("/datasets/{dataset_id}", response_model=schemas.Dataset)
async def update_dataset(
    dataset_id: int,
    name: str = Form(...),
    description: str | None = Form(None),
    type: str = Form(...),
    tags: Optional[str] = Form(None),
    logo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Parse tags if provided
        if tags:
            dataset.tags = json.loads(tags)
        
        # Update basic info
        dataset.name = name
        dataset.description = description
        dataset.type = type

        # Handle logo if provided
        if logo:
            logo_data = await logo.read()
            dataset.logo = logo_data
            # Create a data URL for the logo
            mime_type = logo.content_type or "image/png"
            logo_base64 = base64.b64encode(logo_data).decode()
            dataset.logo_url = f"data:{mime_type};base64,{logo_base64}"
            # Update thumbnailUrl to be the same as logo_url
            dataset.thumbnailUrl = dataset.logo_url

        db.commit()
        db.refresh(dataset)
        return dataset

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: int, db: Session = Depends(get_db)):
    try:
        # Get the dataset
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Delete all images and annotations associated with this dataset
        # Note: This assumes cascading delete is set up in the models
        db.delete(dataset)
        db.commit()
        return {"message": "Dataset and all associated data deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/datasets/{dataset_id}/duplicate", response_model=schemas.DatasetResponse)
def duplicate_dataset(dataset_id: int, db: Session = Depends(get_db)):
    # Get the original dataset
    original_dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not original_dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Create new dataset with copied attributes
    new_dataset = models.Dataset(
        name=f"{original_dataset.name} (Copy)",
        description=original_dataset.description,
        logo_path=original_dataset.logo_path,
        project_id=original_dataset.project_id
    )
    db.add(new_dataset)
    db.flush()  # Flush to get the new dataset ID

    # Copy images
    images_dir = os.path.join("data", "images", str(dataset_id))
    new_images_dir = os.path.join("data", "images", str(new_dataset.id))
    if os.path.exists(images_dir):
        shutil.copytree(images_dir, new_images_dir, dirs_exist_ok=True)

    # Copy annotations
    annotations_dir = os.path.join("data", "annotations", str(dataset_id))
    new_annotations_dir = os.path.join("data", "annotations", str(new_dataset.id))
    if os.path.exists(annotations_dir):
        shutil.copytree(annotations_dir, new_annotations_dir, dirs_exist_ok=True)

    # Copy database records for images and annotations
    original_images = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
    for image in original_images:
        new_image = models.Image(
            dataset_id=new_dataset.id,
            filename=image.filename,
            path=image.path.replace(str(dataset_id), str(new_dataset.id))
        )
        db.add(new_image)
        db.flush()

        # Copy annotations for this image
        annotations = db.query(models.Annotation).filter(models.Annotation.image_id == image.id).all()
        for annotation in annotations:
            new_annotation = models.Annotation(
                image_id=new_image.id,
                type=annotation.type,
                data=annotation.data,
                label=annotation.label
            )
            db.add(new_annotation)

    db.commit()
    return schemas.DatasetResponse(
        success=True,
        data=new_dataset
    )

@app.post("/datasets/{dataset_id}/duplicate")
async def duplicate_dataset(dataset_id: int, db: Session = Depends(get_db)):
    try:
        # Get the original dataset
        original_dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if original_dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Create a new dataset with the same data
        new_dataset = models.Dataset(
            name=f"{original_dataset.name} (Copy)",
            description=original_dataset.description,
            type=original_dataset.type,
            _tags=original_dataset._tags,
            project_id=original_dataset.project_id,
            logo=original_dataset.logo,
            logo_url=original_dataset.logo_url,
            thumbnailUrl=original_dataset.thumbnailUrl
        )
        
        db.add(new_dataset)
        db.flush()  # Flush to get the new dataset ID

        # Copy all images
        for image in original_dataset.images:
            new_image = models.Image(
                dataset_id=new_dataset.id,
                file_name=image.file_name,
                file_size=image.file_size,
                width=image.width,
                height=image.height,
                url=image.url,
                thumbnail_url=image.thumbnail_url,
                annotations_count=image.annotations_count
            )
            db.add(new_image)
            db.flush()

            # Copy all annotations for this image
            for annotation in image.annotations:
                new_annotation = models.Annotation(
                    image_id=new_image.id,
                    dataset_id=new_dataset.id,
                    category=annotation.category,
                    bbox=annotation.bbox,
                    segmentation=annotation.segmentation,
                    area=annotation.area
                )
                db.add(new_annotation)

        # Update counts
        new_dataset.image_count = original_dataset.image_count
        new_dataset.annotation_count = original_dataset.annotation_count

        db.commit()
        db.refresh(new_dataset)
        return new_dataset

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/datasets/{dataset_id}/duplicate", response_model=schemas.Dataset)
def duplicate_dataset(dataset_id: int, db: Session = Depends(get_db)):
    # Get the original dataset
    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Create a new dataset with copied attributes
    new_dataset = models.Dataset(
        name=f"{dataset.name} (Copy)",
        description=dataset.description,
        project_id=dataset.project_id,
        created_at=datetime.datetime.now(),
        updated_at=datetime.datetime.now()
    )
    db.add(new_dataset)
    db.flush()  # Flush to get the new dataset ID

    # Copy images
    images_dir = os.path.join("data", "images", str(dataset_id))
    new_images_dir = os.path.join("data", "images", str(new_dataset.id))
    if os.path.exists(images_dir):
        shutil.copytree(images_dir, new_images_dir)

    # Copy annotations
    annotations_dir = os.path.join("data", "annotations", str(dataset_id))
    new_annotations_dir = os.path.join("data", "annotations", str(new_dataset.id))
    if os.path.exists(annotations_dir):
        shutil.copytree(annotations_dir, new_annotations_dir)

    # Copy image records and annotations from database
    original_images = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
    for img in original_images:
        new_image = models.Image(
            dataset_id=new_dataset.id,
            filename=img.filename,
            path=img.path.replace(str(dataset_id), str(new_dataset.id)),
            created_at=datetime.datetime.now()
        )
        db.add(new_image)
        db.flush()

        # Copy annotations for this image
        annotations = db.query(models.Annotation).filter(models.Annotation.image_id == img.id).all()
        for ann in annotations:
            new_annotation = models.Annotation(
                image_id=new_image.id,
                data=ann.data,
                filename=ann.filename,
                path=ann.path.replace(str(dataset_id), str(new_dataset.id)),
                created_at=datetime.datetime.now()
            )
            db.add(new_annotation)

    db.commit()
    return new_dataset

@app.post("/datasets/{dataset_id}/images")
async def upload_images(
    request: Request,
    dataset_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    try:
        # Verify dataset exists
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Get base URL
        base_url = get_base_url(request)
        
        # Create images directory if it doesn't exist
        dataset_dir = Path("data/images") / str(dataset_id)
        dataset_dir.mkdir(parents=True, exist_ok=True)

        uploaded_images = []
        for file in files:
            if not file.content_type.startswith('image/'):
                continue

            # Save the file
            file_path = dataset_dir / file.filename
            try:
                contents = await file.read()
                with open(file_path, 'wb') as f:
                    f.write(contents)
            except Exception as e:
                print(f"Error saving file {file.filename}: {str(e)}")
                continue

            # Create image record in database with full URLs
            db_image = models.Image(
                dataset_id=dataset_id,
                file_name=file.filename,
                file_size=len(contents),
                width=0,
                height=0,
                url=f"{base_url}/data/images/{dataset_id}/{file.filename}",
                thumbnail_url=f"{base_url}/data/images/{dataset_id}/{file.filename}",
                annotations_count=0
            )
            db.add(db_image)
            uploaded_images.append(db_image)

        # Update dataset image count
        current_image_count = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).count()
        dataset.image_count = current_image_count + len(uploaded_images)
        
        db.commit()

        return {
            "success": True,
            "data": {
                "uploaded": len(uploaded_images),
                "images": [
                    {
                        "id": img.id,
                        "file_name": img.file_name,
                        "url": img.url,
                        "thumbnail_url": img.thumbnail_url
                    } for img in uploaded_images
                ]
            }
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/datasets/{dataset_id}/images", response_model=List[schemas.Image])
def get_dataset_images(request: Request, dataset_id: int, db: Session = Depends(get_db)):
    try:
        # Verify dataset exists
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Get base URL
        base_url = get_base_url(request)
        
        # Get all images for this dataset
        images = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
        
        # Update URLs with base URL if they're relative
        for image in images:
            if image.url.startswith('/'):
                image.url = f"{base_url}{image.url}"
            if image.thumbnail_url.startswith('/'):
                image.thumbnail_url = f"{base_url}{image.thumbnail_url}"
        
        return images

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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