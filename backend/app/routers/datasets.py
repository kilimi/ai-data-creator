from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, BackgroundTasks
from sqlalchemy.orm import Session
from typing import Optional, List
import json
import base64
from pathlib import Path
import os
from datetime import datetime
from datetime import datetime
import asyncio
import shutil
import uuid

from .. import models, schemas
from ..database import get_db

router = APIRouter()


@router.post("/datasets/", response_model=schemas.Dataset)
async def create_dataset(
    name: str = Form(...),
    description: str | None = Form(None),
    type: str = Form(...),
    project_id: int = Form(...),
    tags: Optional[str] = Form(None),
    logo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    try:
        parsed_tags = json.loads(tags) if tags else []
        dataset_data = {
            "name": name,
            "description": description,
            "type": type,
            "project_id": project_id,
            "tags": json.dumps(parsed_tags)
        }
        db_dataset = models.Dataset(**dataset_data)
        if logo:
            logo_data = await logo.read()
            db_dataset.logo = logo_data
            mime_type = logo.content_type or "image/png"
            logo_base64 = base64.b64encode(logo_data).decode()
            db_dataset.logo_url = f"data:{mime_type};base64,{logo_base64}"
            db_dataset.thumbnailUrl = db_dataset.logo_url
        db.add(db_dataset)
        db.commit()
        db.refresh(db_dataset)
        return db_dataset
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/datasets/", response_model=List[schemas.Dataset])
def read_datasets(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    datasets = db.query(models.Dataset).offset(skip).limit(limit).all()
    return datasets


@router.get("/datasets/{dataset_id}", response_model=schemas.Dataset)
def read_dataset(dataset_id: int, db: Session = Depends(get_db)):
    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return dataset


@router.put("/datasets/{dataset_id}", response_model=schemas.Dataset)
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
        if tags:
            dataset.tags = json.loads(tags)
        dataset.name = name
        dataset.description = description
        dataset.type = type
        if logo:
            logo_data = await logo.read()
            dataset.logo = logo_data
            mime_type = logo.content_type or "image/png"
            logo_base64 = base64.b64encode(logo_data).decode()
            dataset.logo_url = f"data:{mime_type};base64,{logo_base64}"
            dataset.thumbnailUrl = dataset.logo_url
        db.commit()
        db.refresh(dataset)
        return dataset
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(dataset_id: int, db: Session = Depends(get_db)):
    """
    Delete a dataset and all its associated data.
    This removes both the database records and all physical files.
    """
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Delete physical files before deleting database records
        try:
            project_id = dataset.project_id
            
            # Delete from new projects structure: projects/{project_id}/{dataset_id}/
            dataset_dir = Path("projects") / str(project_id) / str(dataset_id)
            if dataset_dir.exists():
                shutil.rmtree(dataset_dir)
                print(f"Deleted dataset directory: {dataset_dir}")
            else:
                print(f"Dataset directory not found: {dataset_dir}")
            
            # Also check and delete from old data structure for backward compatibility
            # Old structure: data/images/{dataset_id}/ and data/annotations/{dataset_id}/
            old_images_dir = Path("data/images") / str(dataset_id)
            old_annotations_dir = Path("data/annotations") / str(dataset_id)
            
            if old_images_dir.exists():
                shutil.rmtree(old_images_dir)
                print(f"Deleted old images directory: {old_images_dir}")
            
            if old_annotations_dir.exists():
                shutil.rmtree(old_annotations_dir)
                print(f"Deleted old annotations directory: {old_annotations_dir}")
                
        except Exception as file_error:
            print(f"Warning: Could not delete some physical files: {file_error}")
            # Continue with database deletion even if file deletion fails
        
        # Delete the dataset record (this will cascade delete images and annotations)
        db.delete(dataset)
        db.commit()
        
        return {
            "success": True,
            "message": "Dataset and all associated data deleted successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/datasets/{dataset_id}/duplicate")
async def duplicate_dataset(dataset_id: int, db: Session = Depends(get_db)):
    try:
        original_dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if original_dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
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
        db.commit()
        db.refresh(new_dataset)
        return new_dataset
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/datasets/{dataset_id}/images")
async def upload_images(
    request: Request,
    dataset_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db)
):
    try:
        # Add debug logging
        print(f"DEBUG: Upload request received for dataset {dataset_id} with {len(files)} files")
        
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        base_url = str(request.base_url).rstrip('/')
        
        # Use projects/{project_id}/{dataset_id}/images/ directory structure
        project_id = dataset.project_id
        dataset_dir = Path("projects") / str(project_id) / str(dataset_id) / "images"
        dataset_dir.mkdir(parents=True, exist_ok=True)
        
        uploaded_images = []
        overwritten_images = []
        
        for file in files:
            if not file.content_type.startswith('image/'):
                continue
            
            # Extract just the filename, not the full path (for folder uploads)
            clean_filename = os.path.basename(file.filename)
            file_path = dataset_dir / clean_filename
            
            try:
                contents = await file.read()
                
                # Check if image with same filename already exists in database
                existing_image = db.query(models.Image).filter(
                    models.Image.dataset_id == dataset_id,
                    models.Image.file_name == clean_filename
                ).first()
                
                # Write the file (overwrite if exists)
                with open(file_path, 'wb') as f:
                    f.write(contents)
                
                # Update URL to use the new structure
                relative_url = f"/static/projects/{project_id}/{dataset_id}/images/{clean_filename}"
                
                if existing_image:
                    # Update existing image record
                    existing_image.file_size = len(contents)
                    existing_image.url = relative_url
                    existing_image.thumbnail_url = relative_url
                    existing_image.uploaded_at = datetime.utcnow()
                    overwritten_images.append(existing_image)
                    print(f"Overwriting existing image: {clean_filename}")
                else:
                    # Create new image record
                    db_image = models.Image(
                        dataset_id=dataset_id,
                        file_name=clean_filename,
                        file_size=len(contents),
                        width=0,
                        height=0,
                        url=relative_url,
                        thumbnail_url=relative_url,
                        annotations_count=0
                    )
                    db.add(db_image)
                    uploaded_images.append(db_image)
                    print(f"Adding new image: {clean_filename}")
                    
            except Exception as e:
                print(f"Error uploading file {file.filename}: {e}")
                continue
        
        # Update dataset image count (only add count for new images, not overwritten ones)
        current_image_count = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).count()
        dataset.image_count = current_image_count + len(uploaded_images)
        db.commit()
        
        # Prepare response including both new and overwritten images
        response_images = []
        all_processed_images = uploaded_images + overwritten_images
        
        for img in all_processed_images:
            url = f"{base_url}{img.url}" if img.url.startswith('/') else img.url
            thumbnail_url = f"{base_url}{img.thumbnail_url}" if img.thumbnail_url.startswith('/') else img.thumbnail_url
            response_images.append({
                "id": str(img.id),
                "datasetId": str(dataset_id),
                "fileName": img.file_name,
                "fileSize": img.file_size,
                "width": img.width,
                "height": img.height,
                "url": url,
                "thumbnailUrl": thumbnail_url,
                "uploadedAt": img.uploaded_at.isoformat(),
                "annotationsCount": img.annotations_count
            })
            
        return {
            "success": True,
            "data": {
                "uploaded": len(uploaded_images),
                "overwritten": len(overwritten_images),
                "images": response_images
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/datasets/{dataset_id}/images")
def get_dataset_images(request: Request, dataset_id: int, db: Session = Depends(get_db)):
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        base_url = str(request.base_url).rstrip('/')
        images = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
        response_images = []
        for img in images:
            url = img.url
            thumbnail_url = img.thumbnail_url
            if url and url.startswith('/'):
                url = f"{base_url}{url}"
            if thumbnail_url and thumbnail_url.startswith('/'):
                thumbnail_url = f"{base_url}{thumbnail_url}"
            response_images.append({
                "id": str(img.id),
                "datasetId": str(dataset_id),
                "fileName": img.file_name,
                "fileSize": img.file_size,
                "width": img.width,
                "height": img.height,
                "url": url,
                "thumbnailUrl": thumbnail_url,
                "uploadedAt": img.uploaded_at.isoformat(),
                "annotationsCount": img.annotations_count
            })
        return {
            "success": True,
            "data": response_images
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/datasets/{dataset_id}/images/{image_id}")
async def delete_image(dataset_id: int, image_id: int, db: Session = Depends(get_db)):
    """
    Delete a specific image from a dataset.
    This removes both the database record and the physical file.
    """
    try:
        # Find the image in the database
        image = db.query(models.Image).filter(
            models.Image.id == image_id,
            models.Image.dataset_id == dataset_id
        ).first()
        
        if not image:
            raise HTTPException(status_code=404, detail="Image not found")
        
        # Find the dataset to update the image count
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Try to delete the physical file from the new projects structure
        try:
            project_id = dataset.project_id
            dataset_dir = Path("projects") / str(project_id) / str(dataset_id) / "images"
            file_path = dataset_dir / image.file_name
            if file_path.exists():
                os.remove(file_path)
                print(f"Deleted physical file: {file_path}")
            else:
                print(f"Physical file not found: {file_path}")
                
                # Fallback: also try the old data/images structure for backward compatibility
                old_dataset_dir = Path("data/images") / str(dataset_id)
                old_file_path = old_dataset_dir / image.file_name
                if old_file_path.exists():
                    os.remove(old_file_path)
                    print(f"Deleted physical file from old location: {old_file_path}")
        except Exception as file_error:
            print(f"Warning: Could not delete physical file: {file_error}")
            # Continue with database deletion even if file deletion fails
        
        # Delete the image record (this will also cascade delete annotations)
        db.delete(image)
        
        # Update the dataset's image count
        current_image_count = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).count()
        dataset.image_count = current_image_count - 1  # -1 because we're about to delete one
        
        db.commit()
        
        return {
            "success": True,
            "message": "Image deleted successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete image: {str(e)}")


@router.post("/datasets/{dataset_id}/import-annotations")
async def import_annotations(
    dataset_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Import annotations from a file (COCO format) - Database storage only"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Read the uploaded file
        contents = await file.read()
        
        # Generate a random ID for the annotation file to avoid conflicts
        import uuid
        random_id = str(uuid.uuid4())[:8]  # Use first 8 characters of UUID
        
        # Try to parse as JSON (COCO format) to get statistics
        imported_count = 0
        image_count = 0
        category_count = 0
        coco_data = None
        
        try:
            coco_data = json.loads(contents.decode('utf-8'))
            
            # Basic COCO format processing - just count
            if 'annotations' in coco_data:
                imported_count = len(coco_data['annotations'])
            
            if 'images' in coco_data:
                image_count = len(coco_data['images'])
                
            if 'categories' in coco_data:
                category_count = len(coco_data['categories'])
                
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Only COCO JSON format is supported")
        
        if not coco_data:
            raise HTTPException(status_code=400, detail="Invalid COCO format")
        
        # Use database-based storage
        from .annotation_db import process_coco_annotation_file
        
        # Create database record for the annotation file
        annotation_file_record = models.AnnotationFile(
            id=random_id,
            dataset_id=dataset_id,
            name=file.filename,
            format='COCO',
            file_size=len(contents),
            annotation_count=0,  # Will be updated by processing
            image_count=0,
            category_count=0,
            is_processed=False,
            processing_status="pending"
        )
        
        db.add(annotation_file_record)
        db.commit()
        
        # Process the file in the background
        background_tasks.add_task(
            process_coco_annotation_file,
            random_id,
            coco_data,
            db
        )
        
        return {
            "success": True,
            "data": {
                "message": f"Annotation file '{file.filename}' uploaded and processing started",
                "file_id": random_id,
                "original_filename": file.filename,
                "processing_status": "pending",
                "use_database": True,
                "estimated_annotations": imported_count,
                "estimated_images": image_count,
                "estimated_categories": category_count
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import annotations: {str(e)}")


@router.delete("/datasets/{dataset_id}/annotations/{annotation_id}")
async def delete_dataset_annotation(
    dataset_id: int,
    annotation_id: str,
    db: Session = Depends(get_db)
):
    """Delete an annotation file by its ID (database-only)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Find the annotation file in database
        db_annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if not db_annotation_file:
            raise HTTPException(
                status_code=404,
                detail=f"Annotation file with ID '{annotation_id}' not found in dataset {dataset_id}"
            )
        
        # Get count for reporting
        annotations_count = db_annotation_file.annotation_count
        
        # Delete the database record (this will cascade delete all annotations and classes)
        db.delete(db_annotation_file)
        db.commit()
        
        return {
            "success": True,
            "message": f"Annotation file '{db_annotation_file.name}' deleted successfully",
            "annotations_removed": annotations_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error deleting annotation file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete annotation file: {str(e)}")


@router.get("/datasets/{dataset_id}/annotations")
async def get_dataset_annotations(
    dataset_id: int,
    db: Session = Depends(get_db)
):
    """Get all annotation files for a dataset (database-only)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get all annotation file records from database
        db_annotation_files = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.dataset_id == dataset_id
        ).all()
        
        annotation_files = []
        for db_file in db_annotation_files:
            file_info = {
                "id": db_file.id,
                "name": db_file.name,
                "format": db_file.format or 'COCO',
                "type": db_file.type,
                "tags": db_file.tags,
                "size": db_file.file_size or 0,
                "annotation_count": db_file.annotation_count,
                "image_count": db_file.image_count,
                "category_count": db_file.category_count,
                "is_processed": db_file.is_processed,
                "processing_status": db_file.processing_status,
                "error_message": db_file.error_message,
                "created_at": db_file.created_at.isoformat(),
                "modified_at": db_file.updated_at.isoformat(),
            }
            annotation_files.append(file_info)
        
        return {
            "success": True,
            "data": annotation_files
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in get_dataset_annotations: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get annotations: {str(e)}")


@router.get("/datasets/{dataset_id}/annotations/list")
async def get_dataset_annotations_list(
    dataset_id: int,
    db: Session = Depends(get_db)
):
    """Get all individual annotations from annotation files (database-only)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get all individual annotations from database
        annotations = db.query(models.Annotation).filter(
            models.Annotation.dataset_id == dataset_id
        ).all()
        
        all_annotations = []
        for ann in annotations:
            annotation_data = {
                'id': ann.id,
                'annotation_file_id': ann.annotation_file_id,
                'image_id': ann.image_id,
                'dataset_id': ann.dataset_id,
                'coco_image_id': ann.coco_image_id,
                'coco_annotation_id': ann.coco_annotation_id,
                'category_id': ann.category_id,
                'category': ann.category,
                'bbox_x': ann.bbox_x,
                'bbox_y': ann.bbox_y,
                'bbox_width': ann.bbox_width,
                'bbox_height': ann.bbox_height,
                'bbox': ann.bbox,
                'segmentation': ann.segmentation,
                'area': ann.area,
                'confidence': ann.confidence,
                'uploaded_at': ann.uploaded_at.isoformat()
            }
            all_annotations.append(annotation_data)
        
        print(f"Found {len(all_annotations)} individual annotations in dataset {dataset_id}")
        if all_annotations:
            sample_ids = [str(ann['id']) for ann in all_annotations[:10]]
            print(f"Sample annotation IDs: {sample_ids}")
        
        return {
            "success": True,
            "data": all_annotations
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in get_dataset_annotations_list: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get annotations: {str(e)}")


@router.get("/datasets/{dataset_id}/annotations/{annotation_id}/content")
async def get_dataset_annotation_content(
    dataset_id: int,
    annotation_id: str,
    db: Session = Depends(get_db)
):
    """Get the content of a specific annotation file (database-only)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Check if annotation file exists in database
        annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if not annotation_file:
            raise HTTPException(status_code=404, detail="Annotation file not found")
        
        # Generate COCO format from database
        from .annotation_db import get_annotation_data, get_annotation_classes
        
        # Get all annotations and classes
        annotations_response = await get_annotation_data(
            dataset_id, annotation_id, None, 1, 10000, None, db
        )
        classes_response = await get_annotation_classes(
            dataset_id, annotation_id, db
        )
        
        if not annotations_response["success"] or not classes_response["success"]:
            raise HTTPException(status_code=500, detail="Failed to retrieve annotation data")
        
        # Build COCO format
        coco_data = {
            "info": {
                "description": f"Annotations for dataset {dataset_id}",
                "version": "1.0",
                "year": 2025,
                "contributor": "AI Data Creator",
                "date_created": annotation_file.created_at.isoformat() if annotation_file.created_at else None
            },
            "categories": [],
            "images": [],
            "annotations": []
        }
        
        # Add categories
        category_id_map = {}
        for i, cls in enumerate(classes_response["data"]["classes"]):
            category_id = cls.get("categoryId", i + 1)
            category_id_map[cls["className"]] = category_id
            coco_data["categories"].append({
                "id": category_id,
                "name": cls["className"],
                "supercategory": ""
            })
        
        # Get image information
        image_id_map = {}
        for ann in annotations_response["data"]["annotations"]:
            image_id = ann["imageId"]
            if image_id not in image_id_map:
                # Get image details
                image = db.query(models.Image).filter(models.Image.id == image_id).first()
                if image:
                    coco_image_id = ann.get("cocoImageId", len(image_id_map) + 1)
                    image_id_map[image_id] = coco_image_id
                    coco_data["images"].append({
                        "id": coco_image_id,
                        "file_name": image.file_name,
                        "width": image.width or 1,
                        "height": image.height or 1
                    })
        
        # Add annotations
        for ann in annotations_response["data"]["annotations"]:
            if ann["bbox"] and len(ann["bbox"]) == 4:
                # Convert normalized bbox back to pixel coordinates
                image_id = ann["imageId"]
                image = db.query(models.Image).filter(models.Image.id == image_id).first()
                if image:
                    width = image.width or 1
                    height = image.height or 1
                    bbox = [
                        ann["bbox"][0] * width,   # x
                        ann["bbox"][1] * height,  # y  
                        ann["bbox"][2] * width,   # width
                        ann["bbox"][3] * height   # height
                    ]
                    
                    coco_ann = {
                        "id": ann.get("cocoAnnotationId", ann["id"]),
                        "image_id": image_id_map.get(image_id, 1),
                        "category_id": category_id_map.get(ann["className"], 1),
                        "bbox": bbox,
                        "area": ann.get("area", bbox[2] * bbox[3]),
                        "iscrowd": 0
                    }
                    
                    if ann.get("segmentation"):
                        coco_ann["segmentation"] = ann["segmentation"]
                        
                    coco_data["annotations"].append(coco_ann)
        
        content = json.dumps(coco_data, indent=2)
        
        return {
            "success": True,
            "data": {
                "content": content,
                "filename": annotation_file.name,
                "format": "COCO",
                "size": len(content),
                "source": "database"
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in get_dataset_annotation_content: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get annotation content: {str(e)}")


@router.put("/datasets/{dataset_id}/annotations/{annotation_id}/rename")
async def rename_annotation_file(
    dataset_id: int,
    annotation_id: str,
    new_name: str = Form(...),
    db: Session = Depends(get_db)
):
    """Rename an annotation file (database-only)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Find the annotation file in database
        annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if not annotation_file:
            raise HTTPException(
                status_code=404,
                detail=f"Annotation file with ID '{annotation_id}' not found"
            )
        
        # Validate new name
        if not new_name.strip():
            raise HTTPException(status_code=400, detail="New filename cannot be empty")
        
        new_name = new_name.strip()
        
        # Check if new name already exists
        existing_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.name == new_name,
            models.AnnotationFile.dataset_id == dataset_id,
            models.AnnotationFile.id != annotation_id
        ).first()
        
        if existing_file:
            raise HTTPException(
                status_code=409, 
                detail=f"A file with the name '{new_name}' already exists"
            )
        
        # Update the name in database
        old_name = annotation_file.name
        annotation_file.name = new_name
        annotation_file.updated_at = datetime.utcnow()
        db.commit()
        
        return {
            "success": True,
            "message": f"Annotation file renamed from '{old_name}' to '{new_name}'",
            "old_filename": old_name,
            "new_filename": new_name,
            "display_name": new_name
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error in rename_annotation_file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to rename annotation file: {str(e)}")


@router.put("/datasets/{dataset_id}/annotations/{annotation_id}/tags")
async def update_annotation_tags(
    dataset_id: int,
    annotation_id: str,
    tags: List[str] = Form(...),
    db: Session = Depends(get_db)
):
    """Update tags for an annotation file (database-only)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Find the annotation file in database
        annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if not annotation_file:
            raise HTTPException(
                status_code=404,
                detail=f"Annotation file with ID '{annotation_id}' not found"
            )
        
        # Update tags
        annotation_file.tags = tags
        annotation_file.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(annotation_file)
        
        return {
            "success": True,
            "message": f"Tags updated for annotation file '{annotation_file.name}'",
            "tags": annotation_file.tags
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error in update_annotation_tags: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update annotation tags: {str(e)}")


@router.put("/datasets/{dataset_id}/annotations/{annotation_id}/content")
async def update_annotation_content(
    dataset_id: int,
    annotation_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Update the content of an existing annotation file (database-only)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Find the annotation file in database
        annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if not annotation_file:
            raise HTTPException(
                status_code=404,
                detail=f"Annotation file with ID '{annotation_id}' not found"
            )

        # Read and validate uploaded content
        contents = await file.read()
        content_str = contents.decode('utf-8')
        
        # Validate JSON format
        try:
            content_json = json.loads(content_str)
        except json.JSONDecodeError as e:
            raise HTTPException(status_code=400, detail=f"Invalid JSON format: {str(e)}")
        
        # Update annotation file metadata based on new content
        annotation_count = len(content_json.get('annotations', []))
        image_count = len(content_json.get('images', []))
        category_count = len(content_json.get('categories', []))
        
        # Clear existing annotations and create new ones
        db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == annotation_id
        ).delete()
        
        # Process new annotations
        await annotation_db.process_annotation_file(
            db, annotation_file, content_json, dataset_id
        )
        
        # Update annotation file metadata
        annotation_file.annotation_count = annotation_count
        annotation_file.image_count = image_count
        annotation_file.category_count = category_count
        annotation_file.file_size = len(contents)
        annotation_file.updated_at = datetime.utcnow()
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Annotation file '{annotation_file.name}' updated successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error in update_annotation_content: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update annotation content: {str(e)}")
