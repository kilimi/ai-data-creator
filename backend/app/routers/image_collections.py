from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from sqlalchemy.orm import Session
from typing import List, Optional
import os
import shutil
from datetime import datetime
import uuid
from pathlib import Path

from ..database import get_db
from ..models import ImageCollection, Image, Dataset
from ..schemas import (
    ImageCollectionCreate, 
    ImageCollection as ImageCollectionSchema,
    ImageCollectionWithImages,
    Image as ImageSchema
)

router = APIRouter()

@router.get("/datasets/{dataset_id}/image-collections", response_model=List[ImageCollectionWithImages])
def get_image_collections(request: Request, dataset_id: int, db: Session = Depends(get_db)):
    """Get all image collections for a dataset"""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    base_url = str(request.base_url).rstrip('/')
    
    # Ensure default collection exists
    default_collection = db.query(ImageCollection).filter(
        ImageCollection.dataset_id == dataset_id,
        ImageCollection.is_default == True
    ).first()
    
    if not default_collection:
        # Create default collection if it doesn't exist
        default_collection = ImageCollection(
            dataset_id=dataset_id,
            name="RGB Images",
            description="Default image collection",
            is_default=True
        )
        db.add(default_collection)
        db.commit()
        db.refresh(default_collection)
        
        # Move any unassigned images to the default collection
        unassigned_images = db.query(Image).filter(
            Image.dataset_id == dataset_id,
            Image.collection_id.is_(None)
        ).all()
        
        for image in unassigned_images:
            image.collection_id = default_collection.id
        
        if unassigned_images:
            db.commit()
    
    collections = db.query(ImageCollection).filter(
        ImageCollection.dataset_id == dataset_id
    ).order_by(ImageCollection.is_default.desc(), ImageCollection.created_at.asc()).all()
    
    # Convert to response format with image counts
    result = []
    for collection in collections:
        collection_dict = {
            "id": collection.id,
            "dataset_id": collection.dataset_id,
            "name": collection.name,
            "description": collection.description,
            "is_default": collection.is_default,
            "created_at": collection.created_at,
            "updated_at": collection.updated_at,
            "image_count": len(collection.images),
            "images": [
                {
                    "id": img.id,
                    "datasetId": img.dataset_id,
                    "fileName": img.file_name,
                    "fileSize": img.file_size,
                    "width": img.width,
                    "height": img.height,
                    "url": f"{base_url}{img.url}" if img.url and img.url.startswith('/') else img.url,
                    "thumbnailUrl": f"{base_url}{img.thumbnail_url}" if img.thumbnail_url and img.thumbnail_url.startswith('/') else img.thumbnail_url,
                    "uploadedAt": img.uploaded_at,
                    "annotationsCount": img.annotations_count
                }
                for img in collection.images
            ]
        }
        result.append(collection_dict)
    
    return result

@router.post("/datasets/{dataset_id}/image-collections", response_model=ImageCollectionSchema)
def create_image_collection(
    dataset_id: int, 
    collection_data: ImageCollectionCreate, 
    db: Session = Depends(get_db)
):
    """Create a new image collection for a dataset"""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Check if collection name already exists in this dataset
    existing = db.query(ImageCollection).filter(
        ImageCollection.dataset_id == dataset_id,
        ImageCollection.name == collection_data.name
    ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Collection name already exists")
    
    collection = ImageCollection(
        dataset_id=dataset_id,
        name=collection_data.name,
        description=collection_data.description,
        is_default=collection_data.is_default
    )
    
    db.add(collection)
    db.commit()
    db.refresh(collection)
    
    return collection

@router.delete("/datasets/{dataset_id}/image-collections/{collection_id}")
def delete_image_collection(
    dataset_id: int, 
    collection_id: int, 
    db: Session = Depends(get_db)
):
    """Delete an image collection and move its images back to the default collection"""
    collection = db.query(ImageCollection).filter(
        ImageCollection.id == collection_id,
        ImageCollection.dataset_id == dataset_id
    ).first()
    
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    if collection.is_default:
        raise HTTPException(status_code=400, detail="Cannot delete default collection")
    
    # Get or create default collection
    default_collection = db.query(ImageCollection).filter(
        ImageCollection.dataset_id == dataset_id,
        ImageCollection.is_default == True
    ).first()
    
    if not default_collection:
        default_collection = ImageCollection(
            dataset_id=dataset_id,
            name="RGB Images",
            description="Default image collection",
            is_default=True
        )
        db.add(default_collection)
        db.commit()
        db.refresh(default_collection)
    
    # Move all images from this collection to the default collection
    images_to_move = db.query(Image).filter(Image.collection_id == collection_id).all()
    for image in images_to_move:
        image.collection_id = default_collection.id
    
    # Delete the collection
    db.delete(collection)
    db.commit()
    
    return {"message": "Collection deleted successfully"}

@router.post("/datasets/{dataset_id}/image-collections/{collection_id}/images")
async def upload_images_to_collection(
    request: Request,
    dataset_id: int,
    collection_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    """Upload images directly to a specific collection"""
    collection = db.query(ImageCollection).filter(
        ImageCollection.id == collection_id,
        ImageCollection.dataset_id == dataset_id
    ).first()
    
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    base_url = str(request.base_url).rstrip('/')
    
    # Create upload directory using the same structure as the main upload
    project_id = dataset.project_id
    dataset_dir = Path("projects") / str(project_id) / str(dataset_id) / "images"
    dataset_dir.mkdir(parents=True, exist_ok=True)
    
    uploaded_images = []
    
    for file in files:
        if not file.content_type or not file.content_type.startswith('image/'):
            continue
            
        # Extract just the filename, not the full path (for folder uploads)
        clean_filename = os.path.basename(file.filename)
        
        # Check if file already exists on disk (across all collections)
        original_path = dataset_dir / clean_filename
        final_filename = clean_filename
        counter = 1
        
        # Generate unique filename if file already exists on disk
        # Include collection name for better identification
        while original_path.exists():
            name, ext = os.path.splitext(clean_filename)
            if counter == 1:
                # First conflict: use collection name
                final_filename = f"{name}_{collection.name.replace(' ', '_')}{ext}"
            else:
                # Subsequent conflicts: use collection name + number
                final_filename = f"{name}_{collection.name.replace(' ', '_')}_{counter}{ext}"
            original_path = dataset_dir / final_filename
            counter += 1
        
        file_path = original_path
        
        try:
            contents = await file.read()
            
            # Write the file with unique name
            with open(file_path, 'wb') as f:
                f.write(contents)
            
            # Update URL to use the new structure with the final filename
            relative_url = f"/static/projects/{project_id}/{dataset_id}/images/{final_filename}"
            
            # Always create new image record since we generate unique filenames
            image = Image(
                dataset_id=dataset_id,
                collection_id=collection_id,  # Assign to specific collection
                file_name=final_filename,  # Use the unique filename
                file_size=len(contents),
                width=0,  # TODO: Extract actual dimensions
                height=0,  # TODO: Extract actual dimensions
                url=relative_url,
                thumbnail_url=relative_url,
                uploaded_at=datetime.utcnow()
            )
            
            db.add(image)
            uploaded_images.append(image)
            print(f"Adding new image to collection {collection_id}: {final_filename}")
                
        except Exception as e:
            print(f"Error uploading file {file.filename}: {e}")
            continue
    
    # Update dataset image count
    current_image_count = db.query(Image).filter(Image.dataset_id == dataset_id).count()
    dataset.image_count = current_image_count + len([img for img in uploaded_images if img.id is None])  # Only count new images
    
    db.commit()
    
    return {
        "message": f"Successfully uploaded {len(files)} images to collection '{collection.name}'",
        "images": [
            {
                "id": str(img.id),
                "datasetId": str(dataset_id),
                "fileName": img.file_name,
                "fileSize": img.file_size,
                "width": img.width,
                "height": img.height,
                "url": f"{base_url}{img.url}" if img.url.startswith('/') else img.url,
                "thumbnailUrl": f"{base_url}{img.thumbnail_url}" if img.thumbnail_url.startswith('/') else img.thumbnail_url,
                "uploadedAt": img.uploaded_at.isoformat(),
                "annotationsCount": img.annotations_count
            }
            for img in uploaded_images
        ]
    }

@router.put("/images/{image_id}/collection")
def move_image_to_collection(
    image_id: int,
    request: dict,  # {"collection_id": int}
    db: Session = Depends(get_db)
):
    """Move an image to a different collection"""
    collection_id = request.get("collection_id")
    if not collection_id:
        raise HTTPException(status_code=400, detail="collection_id is required")
    
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    collection = db.query(ImageCollection).filter(
        ImageCollection.id == collection_id,
        ImageCollection.dataset_id == image.dataset_id
    ).first()
    
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    image.collection_id = collection_id
    db.commit()
    
    return {"message": "Image moved successfully"}

@router.post("/datasets/{dataset_id}/image-collections/initialize")
def initialize_default_collection(dataset_id: int, db: Session = Depends(get_db)):
    """Initialize default collection for existing datasets"""
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Check if default collection already exists
    default_collection = db.query(ImageCollection).filter(
        ImageCollection.dataset_id == dataset_id,
        ImageCollection.is_default == True
    ).first()
    
    if default_collection:
        return {"message": "Default collection already exists"}
    
    # Create default collection
    default_collection = ImageCollection(
        dataset_id=dataset_id,
        name="RGB Images",
        description="Default image collection",
        is_default=True
    )
    db.add(default_collection)
    db.commit()
    db.refresh(default_collection)
    
    # Move all existing images to default collection
    images = db.query(Image).filter(
        Image.dataset_id == dataset_id,
        Image.collection_id.is_(None)
    ).all()
    
    for image in images:
        image.collection_id = default_collection.id
    
    db.commit()
    
    return {
        "message": "Default collection initialized",
        "collection": default_collection,
        "images_moved": len(images)
    }
