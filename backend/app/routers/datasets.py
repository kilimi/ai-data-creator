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
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Import annotations from a file (COCO format, YOLO format, etc.)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Create annotations directory using projects/{project_id}/{dataset_id}/annotations/ structure
        project_id = dataset.project_id
        annotations_dir = Path("projects") / str(project_id) / str(dataset_id) / "annotations"
        annotations_dir.mkdir(parents=True, exist_ok=True)
        
        # Read the uploaded file
        contents = await file.read()
        
        # Generate a random ID for the annotation file to avoid conflicts
        import uuid
        random_id = str(uuid.uuid4())[:8]  # Use first 8 characters of UUID
        file_extension = Path(file.filename).suffix or '.json'
        safe_filename = f"{random_id}_{file.filename}"
        
        # Save the annotation file physically with random ID prefix
        annotation_file_path = annotations_dir / safe_filename
        with open(annotation_file_path, 'wb') as f:
            f.write(contents)
        
        # Try to parse as JSON (COCO format) to get statistics
        imported_count = 0
        image_count = 0
        category_count = 0
        
        try:
            annotations_data = json.loads(contents.decode('utf-8'))
            
            # Basic COCO format processing - just count, don't save to database
            if 'annotations' in annotations_data:
                imported_count = len(annotations_data['annotations'])
            
            if 'images' in annotations_data:
                image_count = len(annotations_data['images'])
                
            if 'categories' in annotations_data:
                category_count = len(annotations_data['categories'])
                
        except json.JSONDecodeError:
            # Handle non-JSON files (like YOLO format)
            # For now, just save the file and return success
            print(f"Non-JSON annotation file saved: {annotation_file_path}")
        
        # Create database record for the annotation file
        try:
            annotation_file_record = models.AnnotationFile(
                id=random_id,
                dataset_id=dataset_id,
                name=file.filename,
                file_path=str(annotation_file_path),
                format='COCO' if file_extension.lower() == '.json' else 'Unknown',
                tags=[],  # Initialize with empty tags
                file_size=len(contents),
                annotation_count=imported_count,
                image_count=image_count,
                category_count=category_count
            )
            
            db.add(annotation_file_record)
            db.commit()
            db.refresh(annotation_file_record)
            print(f"Created database record for annotation file: {random_id}")
            
        except Exception as db_error:
            print(f"Warning: Could not create database record for annotation file: {db_error}")
            # Continue without failing the import if database record creation fails
        
        return {
            "success": True,
            "data": {
                "message": f"Annotation file saved as {safe_filename}",
                "imported": imported_count,
                "skipped": 0,
                "file_path": str(annotation_file_path),
                "file_id": random_id,  # Return the ID for frontend reference
                "original_filename": file.filename,
                "annotation_count": imported_count,
                "image_count": image_count,
                "category_count": category_count
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
    """Delete an annotation file by its ID"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get the project ID from the dataset
        project_id = dataset.project_id
        
        # Construct the path to the annotations directory
        annotations_dir = Path("projects") / str(project_id) / str(dataset_id) / "annotations"
        
        # Check if annotations directory exists
        if not annotations_dir.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Annotations directory not found for dataset {dataset_id}"
            )
        
        # Look for annotation file that starts with the annotation_id
        found_file = None
        print(f"Looking for annotation file with ID: {annotation_id}")
        print(f"Searching in directory: {annotations_dir}")
        
        all_files = list(annotations_dir.glob("*"))
        print(f"All files in directory: {[f.name for f in all_files if f.is_file()]}")
        
        for file_path in annotations_dir.glob("*"):
            if file_path.is_file():
                filename = file_path.name
                print(f"Checking file: {filename}")
                # Check if filename starts with the annotation_id
                if filename.startswith(f"{annotation_id}_") or filename == annotation_id:
                    found_file = file_path
                    print(f"Found matching file: {filename}")
                    break
                else:
                    print(f"File {filename} does not start with {annotation_id}_")
        
        if found_file:
            # Count annotations before deletion for reporting
            annotations_count = 0
            try:
                if found_file.suffix.lower() == '.json':
                    with open(found_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    if 'annotations' in data:
                        annotations_count = len(data['annotations'])
            except:
                pass
            
            # Delete the file
            found_file.unlink()
            print(f"Deleted annotation file: {found_file}")
            
            # Also delete the database record if it exists
            try:
                db_annotation_file = db.query(models.AnnotationFile).filter(
                    models.AnnotationFile.id == annotation_id,
                    models.AnnotationFile.dataset_id == dataset_id
                ).first()
                
                if db_annotation_file:
                    db.delete(db_annotation_file)
                    db.commit()
                    print(f"Deleted database record for annotation file: {annotation_id}")
                
            except Exception as db_error:
                print(f"Warning: Could not delete database record for annotation file: {db_error}")
                # Continue without failing the deletion if database cleanup fails
            
            # If the annotations directory is empty, we can remove it
            try:
                remaining_files = list(annotations_dir.glob('*'))
                if not remaining_files:
                    annotations_dir.rmdir()
                    print(f"Removed empty annotations directory: {annotations_dir}")
            except Exception as e:
                print(f"Warning: Could not remove empty annotations directory: {e}")
            
            return {
                "success": True,
                "message": f"Annotation file '{found_file.name}' deleted successfully",
                "annotations_removed": annotations_count
            }
        
        # If file wasn't found, provide helpful error message
        all_files = [f.name for f in annotations_dir.glob("*")]
        available_ids = []
        for file_path in annotations_dir.glob("*"):
            if file_path.is_file():
                filename = file_path.name
                if '_' in filename:
                    file_id = filename.split('_', 1)[0]
                    available_ids.append(file_id)
                else:
                    available_ids.append(file_path.stem)
        
        error_detail = f"Annotation file with ID '{annotation_id}' not found in dataset {dataset_id}."
        if all_files:
            error_detail += f" Available files: {all_files}"
        if available_ids:
            error_detail += f" Available annotation IDs: {available_ids}"
            
        raise HTTPException(
            status_code=404,
            detail=error_detail
        )
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in delete_dataset_annotation: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete annotation: {str(e)}")


@router.get("/datasets/{dataset_id}/annotations")
async def get_dataset_annotations(
    dataset_id: int,
    db: Session = Depends(get_db)
):
    """Get all annotation files for a dataset"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get the project ID from the dataset
        project_id = dataset.project_id
        
        # Construct the path to the annotations directory
        annotations_dir = Path("projects") / str(project_id) / str(dataset_id) / "annotations"
        
        # Check if annotations directory exists
        if not annotations_dir.exists():
            return {
                "success": True,
                "data": []
            }
        
        # Get all annotation files
        annotation_files = []
        
        # First, get all annotation file records from database
        db_annotation_files = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.dataset_id == dataset_id
        ).all()
        
        # Create a lookup dictionary for database records
        db_files_by_id = {af.id: af for af in db_annotation_files}
        
        for file_path in annotations_dir.glob("*"):
            if file_path.is_file():
                try:
                    # Read file stats
                    file_stats = file_path.stat()
                    
                    # Extract the random ID and original filename from the filename
                    filename = file_path.name
                    if '_' in filename:
                        # Format: randomid_originalname.json
                        parts = filename.split('_', 1)
                        file_id = parts[0]
                        original_name = parts[1] if len(parts) > 1 else filename
                    else:
                        # Fallback for files without random ID (legacy files)
                        file_id = file_path.stem
                        original_name = filename
                    
                    file_info = {
                        "id": file_id,  # Use the random ID part
                        "name": original_name,  # Show the original filename
                        "filename": filename,  # Full filename for reference
                        "path": str(file_path),
                        "size": file_stats.st_size,
                        "created_at": datetime.fromtimestamp(file_stats.st_ctime).isoformat(),
                        "modified_at": datetime.fromtimestamp(file_stats.st_mtime).isoformat(),
                        "tags": []  # Default empty tags
                    }
                    
                    # Check if we have a database record for this file
                    if file_id in db_files_by_id:
                        db_file = db_files_by_id[file_id]
                        file_info["tags"] = db_file.tags
                        # Use database metadata if available
                        if db_file.annotation_count:
                            file_info['annotation_count'] = db_file.annotation_count
                        if db_file.image_count:
                            file_info['image_count'] = db_file.image_count
                        if db_file.category_count:
                            file_info['category_count'] = db_file.category_count
                        if db_file.format:
                            file_info['format'] = db_file.format
                    
                    # Try to read and parse JSON files to get additional info (if not from database)
                    if file_path.suffix.lower() == '.json' and 'annotation_count' not in file_info:
                        try:
                            with open(file_path, 'r', encoding='utf-8') as f:
                                content = json.load(f)
                                if 'annotations' in content:
                                    file_info['annotation_count'] = len(content['annotations'])
                                if 'images' in content:
                                    file_info['image_count'] = len(content['images'])
                                if 'categories' in content:
                                    file_info['category_count'] = len(content['categories'])
                                    file_info['categories'] = content['categories']
                                file_info['format'] = 'COCO'
                        except (json.JSONDecodeError, UnicodeDecodeError) as e:
                            print(f"Could not parse JSON file {file_path}: {e}")
                            file_info['format'] = 'Unknown'
                    elif 'format' not in file_info:
                        file_info['format'] = 'Unknown'
                    
                    annotation_files.append(file_info)
                    
                except Exception as e:
                    print(f"Error processing file {file_path}: {e}")
                    continue
        
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
    """Get all individual annotations from annotation files"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get the project ID from the dataset
        project_id = dataset.project_id
        
        # Construct the path to the annotations directory
        annotations_dir = Path("projects") / str(project_id) / str(dataset_id) / "annotations"
        
        # Check if annotations directory exists
        if not annotations_dir.exists():
            return {
                "success": True,
                "data": []
            }
        
        # Get all individual annotations from all files
        all_annotations = []
        for file_path in annotations_dir.glob("*.json"):
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                if 'annotations' in data:
                    for ann in data['annotations']:
                        # Add metadata about which file this annotation comes from
                        annotation_with_meta = {
                            **ann,
                            'source_file': file_path.name,
                            'dataset_id': dataset_id
                        }
                        all_annotations.append(annotation_with_meta)
                        
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                print(f"Could not parse annotation file {file_path}: {e}")
                continue
            except Exception as e:
                print(f"Error processing annotation file {file_path}: {e}")
                continue
        
        print(f"Found {len(all_annotations)} individual annotations in dataset {dataset_id}")
        if all_annotations:
            sample_ids = [str(ann.get('id', 'no-id')) for ann in all_annotations[:10]]
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
    """Get the content of a specific annotation file"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get the project ID from the dataset
        project_id = dataset.project_id
        
        # Construct the path to the annotations directory
        annotations_dir = Path("projects") / str(project_id) / str(dataset_id) / "annotations"
        
        # Check if annotations directory exists
        if not annotations_dir.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Annotations directory not found for dataset {dataset_id}"
            )
        
        # Look for annotation file that starts with the annotation_id
        found_file = None
        for file_path in annotations_dir.glob("*"):
            if file_path.is_file():
                filename = file_path.name
                # Check if filename starts with the annotation_id
                if filename.startswith(f"{annotation_id}_") or filename == annotation_id:
                    found_file = file_path
                    break
        
        if not found_file:
            raise HTTPException(
                status_code=404,
                detail=f"Annotation file with ID '{annotation_id}' not found in dataset {dataset_id}"
            )
        
        # Read and return the file content
        try:
            with open(found_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Try to parse as JSON to validate
            try:
                json.loads(content)
                file_format = 'COCO'
            except json.JSONDecodeError:
                file_format = 'Unknown'
            
            return {
                "success": True,
                "data": {
                    "content": content,
                    "filename": found_file.name,
                    "format": file_format,
                    "size": len(content)
                }
            }
            
        except Exception as read_error:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to read annotation file: {str(read_error)}"
            )
        
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
    """Rename an annotation file"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get the project ID from the dataset
        project_id = dataset.project_id
        
        # Construct the path to the annotations directory
        annotations_dir = Path("projects") / str(project_id) / str(dataset_id) / "annotations"
        
        # Check if annotations directory exists
        if not annotations_dir.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Annotations directory not found for dataset {dataset_id}"
            )
        
        # Look for annotation file that starts with the annotation_id
        found_file = None
        for file_path in annotations_dir.glob("*"):
            if file_path.is_file():
                filename = file_path.name
                # Check if filename starts with the annotation_id
                if filename.startswith(f"{annotation_id}_") or filename == annotation_id:
                    found_file = file_path
                    break
        
        if not found_file:
            raise HTTPException(
                status_code=404,
                detail=f"Annotation file with ID '{annotation_id}' not found in dataset {dataset_id}"
            )
        
        # Validate new name
        if not new_name.strip():
            raise HTTPException(status_code=400, detail="New filename cannot be empty")
        
        # Ensure the new name has the correct extension
        new_name = new_name.strip()
        if not new_name.endswith('.json') and found_file.suffix.lower() == '.json':
            new_name += '.json'
        
        # Create new filename with the annotation ID prefix
        if '_' in found_file.name:
            # Keep the same random ID prefix
            prefix = found_file.name.split('_', 1)[0]
            new_filename = f"{prefix}_{new_name}"
        else:
            # For legacy files without prefix, add one
            new_filename = f"{annotation_id}_{new_name}"
        
        new_file_path = annotations_dir / new_filename
        
        # Check if target filename already exists
        if new_file_path.exists():
            raise HTTPException(
                status_code=409, 
                detail=f"A file with the name '{new_filename}' already exists"
            )
        
        # Rename the file
        found_file.rename(new_file_path)
        
        return {
            "success": True,
            "message": f"Annotation file renamed from '{found_file.name}' to '{new_filename}'",
            "old_filename": found_file.name,
            "new_filename": new_filename,
            "display_name": new_name
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in rename_annotation_file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to rename annotation file: {str(e)}")


@router.put("/datasets/{dataset_id}/annotations/{annotation_id}/tags")
async def update_annotation_tags(
    dataset_id: int,
    annotation_id: str,
    tags: List[str] = Form(...),
    db: Session = Depends(get_db)
):
    """Update tags for an annotation file"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Try to find existing annotation file record in database
        annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if annotation_file:
            # Update existing database record
            annotation_file.tags = tags
            annotation_file.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(annotation_file)
        else:
            # If no database record exists, check if the physical file exists and create a database record
            project_id = dataset.project_id
            annotations_dir = Path("projects") / str(project_id) / str(dataset_id) / "annotations"
            
            if not annotations_dir.exists():
                raise HTTPException(status_code=404, detail="Annotations directory not found")
            
            # Look for the physical file
            found_file = None
            for file_path in annotations_dir.glob("*"):
                if file_path.is_file():
                    filename = file_path.name
                    if filename.startswith(f"{annotation_id}_") or filename == annotation_id:
                        found_file = file_path
                        break
            
            if not found_file:
                raise HTTPException(status_code=404, detail=f"Annotation file with ID '{annotation_id}' not found")
            
            # Extract original name from filename
            filename = found_file.name
            if '_' in filename:
                original_name = filename.split('_', 1)[1]
            else:
                original_name = filename
            
            # Get file metadata
            file_stats = found_file.stat()
            file_size = file_stats.st_size
            
            # Try to parse the annotation file to get counts
            annotation_count = 0
            image_count = 0
            category_count = 0
            file_format = 'COCO'
            
            try:
                if found_file.suffix.lower() == '.json':
                    with open(found_file, 'r', encoding='utf-8') as f:
                        content = json.load(f)
                        if 'annotations' in content:
                            annotation_count = len(content['annotations'])
                        if 'images' in content:
                            image_count = len(content['images'])
                        if 'categories' in content:
                            category_count = len(content['categories'])
            except Exception as parse_error:
                print(f"Could not parse annotation file for metadata: {parse_error}")
            
            # Create new database record
            annotation_file = models.AnnotationFile(
                id=annotation_id,
                dataset_id=dataset_id,
                name=original_name,
                file_path=str(found_file),
                format=file_format,
                tags=tags,
                file_size=file_size,
                annotation_count=annotation_count,
                image_count=image_count,
                category_count=category_count
            )
            
            db.add(annotation_file)
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
        print(f"Error in update_annotation_tags: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to update annotation tags: {str(e)}")


@router.put("/datasets/{dataset_id}/annotations/{annotation_id}/content")
async def update_annotation_content(
    dataset_id: int,
    annotation_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Overwrite the content of an existing annotation file.
    """
    import os
    from pathlib import Path

    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    project_id = dataset.project_id
    annotations_dir = Path("projects") / str(project_id) / str(dataset_id) / "annotations"
    if not annotations_dir.exists():
        raise HTTPException(status_code=404, detail="Annotations directory not found")

    # Find the file with the annotation_id prefix
    found_file = None
    for file_path in annotations_dir.glob("*"):
        if file_path.is_file():
            filename = file_path.name
            if filename.startswith(f"{annotation_id}_") or filename == annotation_id:
                found_file = file_path
                break

    if not found_file:
        raise HTTPException(status_code=404, detail=f"Annotation file with ID '{annotation_id}' not found")

    # Overwrite the file content
    contents = await file.read()
    with open(found_file, "wb") as f:
        f.write(contents)

    return {"success": True, "message": f"Annotation file '{found_file.name}' updated."}
