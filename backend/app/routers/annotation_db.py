from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from typing import List, Optional, Dict, Any
import json
import uuid
from datetime import datetime

from ..database import get_db
from ..models import Dataset, AnnotationFile, Annotation, AnnotationClass, Image
from ..database import SessionLocal

router = APIRouter()

async def process_coco_annotation_file(
    annotation_file_id: str,
    coco_data: Dict[str, Any]
):
    """Background task to process COCO annotation file and store in database"""
    # Use a fresh session inside background task
    db = SessionLocal()
    try:
        # Update processing status
        annotation_file = db.query(AnnotationFile).filter(AnnotationFile.id == annotation_file_id).first()
        if not annotation_file:
            return
            
        annotation_file.processing_status = "processing"
        db.commit()
        
        # Clear existing annotations and classes for this file
        db.query(Annotation).filter(Annotation.annotation_file_id == annotation_file_id).delete()
        db.query(AnnotationClass).filter(AnnotationClass.annotation_file_id == annotation_file_id).delete()
        
        # Reset sequence to prevent ID conflicts (important for merged files)
        try:
            from sqlalchemy import text
            db.execute(text("SELECT setval('annotations_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM annotations))"))
            db.execute(text("SELECT setval('annotation_classes_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM annotation_classes))"))
            db.commit()
        except Exception:
            # If sequence reset fails, continue anyway
            pass
        
        # Create image name to ID mapping
        image_mapping = {}
        dataset_images = db.query(Image).filter(Image.dataset_id == annotation_file.dataset_id).all()
        for img in dataset_images:
            image_mapping[img.file_name] = img.id
            # Also try without extension
            base_name = img.file_name.rsplit('.', 1)[0] if '.' in img.file_name else img.file_name
            image_mapping[base_name] = img.id
        
        # Process COCO images and create mapping
        coco_image_mapping = {}
        if 'images' in coco_data:
            for coco_img in coco_data['images']:
                coco_image_id = coco_img['id']
                file_name = coco_img['file_name']
                
                # Find matching dataset image
                dataset_image_id = None
                if file_name in image_mapping:
                    dataset_image_id = image_mapping[file_name]
                else:
                    # Try without extension
                    base_name = file_name.rsplit('.', 1)[0] if '.' in file_name else file_name
                    if base_name in image_mapping:
                        dataset_image_id = image_mapping[base_name]
                
                if dataset_image_id:
                    coco_image_mapping[coco_image_id] = {
                        'dataset_image_id': dataset_image_id,
                        'width': coco_img.get('width', 1),
                        'height': coco_img.get('height', 1),
                        'file_name': file_name
                    }
        
        # Process categories
        category_mapping = {}
        class_counts = {}
        if 'categories' in coco_data:
            for cat in coco_data['categories']:
                category_id = cat['id']
                class_name = cat['name']
                category_mapping[category_id] = class_name
                class_counts[class_name] = 0
        
        # Process annotations
        annotation_count = 0
        if 'annotations' in coco_data:
            for coco_ann in coco_data['annotations']:
                coco_image_id = coco_ann['image_id']
                category_id = coco_ann['category_id']
                
                if coco_image_id not in coco_image_mapping:
                    continue  # Skip if image not found in dataset
                    
                image_info = coco_image_mapping[coco_image_id]
                class_name = category_mapping.get(category_id, f"category_{category_id}")
                
                # Normalize bbox coordinates
                bbox_x = bbox_y = bbox_width = bbox_height = None
                if 'bbox' in coco_ann and coco_ann['bbox']:
                    bbox = coco_ann['bbox']
                    if len(bbox) >= 4:
                        img_width = image_info['width']
                        img_height = image_info['height']
                        bbox_x = bbox[0] / img_width
                        bbox_y = bbox[1] / img_height
                        bbox_width = bbox[2] / img_width
                        bbox_height = bbox[3] / img_height
                
                # Create annotation record (explicitly let database auto-generate ID)
                annotation_data = {
                    'annotation_file_id': annotation_file_id,
                    'image_id': image_info['dataset_image_id'],
                    'dataset_id': annotation_file.dataset_id,
                    'coco_image_id': coco_image_id,
                    'coco_annotation_id': coco_ann.get('id'),
                    'category_id': category_id,
                    'category': class_name,
                    'bbox_x': bbox_x,
                    'bbox_y': bbox_y,
                    'bbox_width': bbox_width,
                    'bbox_height': bbox_height,
                    'bbox': coco_ann.get('bbox'),  # Keep original for backward compatibility
                    'segmentation': coco_ann.get('segmentation'),
                    'area': coco_ann.get('area'),
                    'confidence': 1.0
                }
                
                annotation = Annotation(**annotation_data)
                db.add(annotation)
                annotation_count += 1
                class_counts[class_name] = class_counts.get(class_name, 0) + 1
        
        # Create annotation classes
        for class_name, count in class_counts.items():
            category_id = None
            for cat_id, cat_name in category_mapping.items():
                if cat_name == class_name:
                    category_id = cat_id
                    break
                    
            annotation_class = AnnotationClass(
                annotation_file_id=annotation_file_id,
                class_name=class_name,
                category_id=category_id,
                count=count,
                color='#ea384c',  # Default color
                opacity=0.25
            )
            db.add(annotation_class)
        
        # Update annotation file status
        annotation_file.is_processed = True
        annotation_file.processing_status = "completed"
        annotation_file.annotation_count = annotation_count
        annotation_file.category_count = len(class_counts)
        annotation_file.image_count = len(coco_image_mapping)
        
        db.commit()
        
    except Exception as e:
        # Update error status
        try:
            annotation_file = db.query(AnnotationFile).filter(AnnotationFile.id == annotation_file_id).first()
            if annotation_file:
                annotation_file.processing_status = "failed"
                annotation_file.error_message = str(e)
                db.commit()
        except Exception:
            pass
        raise e
    finally:
        db.close()


@router.post("/datasets/{dataset_id}/annotations/upload-coco")
async def upload_coco_annotation_file(
    dataset_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Upload and process a COCO annotation file"""
    
    # Verify dataset exists
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Read and parse the COCO file
    try:
        content = await file.read()
        coco_data = json.loads(content.decode('utf-8'))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error reading file: {str(e)}")
    
    # Create annotation file record
    annotation_file_id = str(uuid.uuid4())
    annotation_file = AnnotationFile(
        id=annotation_file_id,
        dataset_id=dataset_id,
        name=file.filename,
        format="COCO",
        type="segmentation",  # Default, can be updated later
        file_size=len(content),
        is_processed=False,
        processing_status="pending"
    )
    
    db.add(annotation_file)
    db.commit()
    
    # Process the file in the background
    background_tasks.add_task(
        process_coco_annotation_file,
        annotation_file_id,
        coco_data,
        db
    )
    
    return {
        "success": True,
        "annotation_file_id": annotation_file_id,
        "message": "File uploaded and processing started"
    }


@router.get("/datasets/{dataset_id}/annotations/{annotation_file_id}/data")
async def get_annotation_data(
    dataset_id: int,
    annotation_file_id: str,
    image_ids: Optional[str] = Query(None, description="Comma-separated image IDs"),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=1000),
    class_name: Optional[str] = Query(None, description="Filter by class name"),
    db: Session = Depends(get_db)
):
    """Get paginated annotation data for specific images"""
    
    # Verify annotation file exists
    annotation_file = db.query(AnnotationFile).filter(
        and_(AnnotationFile.id == annotation_file_id, AnnotationFile.dataset_id == dataset_id)
    ).first()
    
    if not annotation_file:
        raise HTTPException(status_code=404, detail="Annotation file not found")
    
    # Build query
    query = db.query(Annotation).filter(Annotation.annotation_file_id == annotation_file_id)
    
    # Filter by image IDs if provided
    if image_ids:
        try:
            image_id_list = [int(id.strip()) for id in image_ids.split(',') if id.strip()]
            query = query.filter(Annotation.image_id.in_(image_id_list))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid image IDs format")
    
    # Filter by class name if provided
    if class_name:
        query = query.filter(Annotation.category == class_name)
    
    # Get total count
    total_count = query.count()
    
    # Apply pagination
    offset = (page - 1) * limit
    annotations = query.offset(offset).limit(limit).all()
    
    # Convert to response format
    annotation_data = []
    for ann in annotations:
        annotation_data.append({
            "id": ann.id,
            "imageId": ann.image_id,
            "className": ann.category,
            "bbox": [ann.bbox_x, ann.bbox_y, ann.bbox_width, ann.bbox_height] if all(v is not None for v in [ann.bbox_x, ann.bbox_y, ann.bbox_width, ann.bbox_height]) else None,
            "segmentation": ann.segmentation,
            "area": ann.area,
            "confidence": ann.confidence,
            "cocoImageId": ann.coco_image_id,
            "cocoAnnotationId": ann.coco_annotation_id
        })
    
    return {
        "success": True,
        "data": {
            "annotations": annotation_data,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total_count,
                "pages": (total_count + limit - 1) // limit
            }
        }
    }


@router.get("/datasets/{dataset_id}/annotations/{annotation_file_id}/classes")
async def get_annotation_classes(
    dataset_id: int,
    annotation_file_id: str,
    db: Session = Depends(get_db)
):
    """Get class statistics for an annotation file"""
    
    # Verify annotation file exists
    annotation_file = db.query(AnnotationFile).filter(
        and_(AnnotationFile.id == annotation_file_id, AnnotationFile.dataset_id == dataset_id)
    ).first()
    
    if not annotation_file:
        raise HTTPException(status_code=404, detail="Annotation file not found")
    
    # Get classes
    classes = db.query(AnnotationClass).filter(
        AnnotationClass.annotation_file_id == annotation_file_id
    ).all()
    
    class_data = []
    for cls in classes:
        class_data.append({
            "className": cls.class_name,
            "count": cls.count,
            "color": cls.color,
            "opacity": cls.opacity,
            "categoryId": cls.category_id
        })
    
    return {
        "success": True,
        "data": {
            "classes": class_data,
            "totalClasses": len(class_data),
            "totalAnnotations": annotation_file.annotation_count
        }
    }


@router.get("/datasets/{dataset_id}/annotations/{annotation_file_id}/status")
async def get_processing_status(
    dataset_id: int,
    annotation_file_id: str,
    db: Session = Depends(get_db)
):
    """Get processing status of an annotation file"""
    
    annotation_file = db.query(AnnotationFile).filter(
        and_(AnnotationFile.id == annotation_file_id, AnnotationFile.dataset_id == dataset_id)
    ).first()
    
    if not annotation_file:
        raise HTTPException(status_code=404, detail="Annotation file not found")
    
    return {
        "success": True,
        "data": {
            "status": annotation_file.processing_status,
            "isProcessed": annotation_file.is_processed,
            "errorMessage": annotation_file.error_message,
            "annotationCount": annotation_file.annotation_count,
            "imageCount": annotation_file.image_count,
            "categoryCount": annotation_file.category_count
        }
    }


@router.put("/datasets/{dataset_id}/annotations/{annotation_file_id}/annotation/{annotation_id}")
async def update_annotation(
    dataset_id: int,
    annotation_file_id: str,
    annotation_id: int,
    update_data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Update a specific annotation"""
    
    annotation = db.query(Annotation).filter(
        and_(
            Annotation.id == annotation_id,
            Annotation.annotation_file_id == annotation_file_id,
            Annotation.dataset_id == dataset_id
        )
    ).first()
    
    if not annotation:
        raise HTTPException(status_code=404, detail="Annotation not found")
    
    # Update allowed fields
    if "className" in update_data:
        old_class = annotation.category
        new_class = update_data["className"]
        annotation.category = new_class
        
        # Update class counts
        if old_class != new_class:
            # Decrease old class count
            old_class_obj = db.query(AnnotationClass).filter(
                and_(
                    AnnotationClass.annotation_file_id == annotation_file_id,
                    AnnotationClass.class_name == old_class
                )
            ).first()
            if old_class_obj and old_class_obj.count > 0:
                old_class_obj.count -= 1
            
            # Increase new class count or create new class
            new_class_obj = db.query(AnnotationClass).filter(
                and_(
                    AnnotationClass.annotation_file_id == annotation_file_id,
                    AnnotationClass.class_name == new_class
                )
            ).first()
            
            if new_class_obj:
                new_class_obj.count += 1
            else:
                # Create new class
                new_class_obj = AnnotationClass(
                    annotation_file_id=annotation_file_id,
                    class_name=new_class,
                    count=1,
                    color='#ea384c',
                    opacity=0.25
                )
                db.add(new_class_obj)
    
    if "confidence" in update_data:
        annotation.confidence = float(update_data["confidence"])
    
    db.commit()
    
    return {
        "success": True,
        "message": "Annotation updated successfully"
    }


def process_coco_annotation_file_task(
    task_id: int,
    file_id: str,
    coco_data: Dict[str, Any],
    db: Session
):
    """Process COCO annotation file as a task (for background processing)"""
    try:
        # Get the annotation file record
        annotation_file = db.query(AnnotationFile).filter(AnnotationFile.id == file_id).first()
        if not annotation_file:
            raise Exception(f"Annotation file with ID {file_id} not found")
        
        # Update processing status
        annotation_file.processing_status = "processing"
        db.commit()
        
        # Get the task to update progress
        from ..models import Task
        task = db.query(Task).filter(Task.id == task_id).first()
        if task:
            task.progress = 20
            db.commit()
        
        # Clear existing annotations and classes for this file
        db.query(Annotation).filter(Annotation.annotation_file_id == file_id).delete()
        db.query(AnnotationClass).filter(AnnotationClass.annotation_file_id == file_id).delete()
        
        # Reset sequence to prevent ID conflicts (important for merged files)
        try:
            from sqlalchemy import text
            db.execute(text("SELECT setval('annotations_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM annotations))"))
            db.execute(text("SELECT setval('annotation_classes_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM annotation_classes))"))
            db.commit()
        except Exception:
            # If sequence reset fails, continue anyway
            pass
        
        if task:
            task.progress = 30
            db.commit()
        
        # Create image name to ID mapping
        image_mapping = {}
        dataset_images = db.query(Image).filter(Image.dataset_id == annotation_file.dataset_id).all()
        for img in dataset_images:
            image_mapping[img.file_name] = img.id
            # Also try without extension
            base_name = img.file_name.rsplit('.', 1)[0] if '.' in img.file_name else img.file_name
            image_mapping[base_name] = img.id
        
        # Process COCO images and create mapping
        coco_image_mapping = {}
        if 'images' in coco_data:
            for coco_img in coco_data['images']:
                coco_image_id = coco_img['id']
                file_name = coco_img['file_name']
                
                # Find matching dataset image
                dataset_image_id = None
                
                # Try exact filename match first
                if file_name in image_mapping:
                    dataset_image_id = image_mapping[file_name]
                else:
                    # Try without extension
                    base_name = file_name.rsplit('.', 1)[0] if '.' in file_name else file_name
                    if base_name in image_mapping:
                        dataset_image_id = image_mapping[base_name]
                    else:
                        # Try partial matches
                        for img_name, img_id in image_mapping.items():
                            img_base = img_name.rsplit('.', 1)[0] if '.' in img_name else img_name
                            if img_base == base_name or img_name == file_name:
                                dataset_image_id = img_id
                                break
                
                if dataset_image_id:
                    coco_image_mapping[coco_image_id] = {
                        'dataset_image_id': dataset_image_id,
                        'file_name': file_name,
                        'width': coco_img.get('width', 1),
                        'height': coco_img.get('height', 1)
                    }
        
        if task:
            task.progress = 50
            db.commit()
        
        # Process categories
        category_mapping = {}
        if 'categories' in coco_data:
            for category in coco_data['categories']:
                category_mapping[category['id']] = category['name']
        
        # Process annotations
        annotation_count = 0
        class_counts = {}
        
        if 'annotations' in coco_data:
            total_annotations = len(coco_data['annotations'])
            for i, coco_ann in enumerate(coco_data['annotations']):
                # Update progress periodically
                if task and i % 100 == 0:
                    progress = 50 + int((i / total_annotations) * 40)
                    task.progress = min(progress, 90)
                    db.commit()
                
                coco_image_id = coco_ann['image_id']
                category_id = coco_ann['category_id']
                
                # Skip if image not found
                if coco_image_id not in coco_image_mapping:
                    continue
                
                image_info = coco_image_mapping[coco_image_id]
                class_name = category_mapping.get(category_id, f"class_{category_id}")
                
                # Process bbox (normalize if needed)
                bbox = coco_ann.get('bbox')
                bbox_x = bbox_y = bbox_width = bbox_height = None
                
                if bbox and len(bbox) >= 4:
                    img_width = image_info['width']
                    img_height = image_info['height']
                    
                    # Check if bbox is already normalized (values between 0 and 1)
                    if all(0 <= v <= 1 for v in bbox):
                        bbox_x, bbox_y, bbox_width, bbox_height = bbox
                    else:
                        # Normalize bbox coordinates
                        bbox_x = bbox[0] / img_width
                        bbox_y = bbox[1] / img_height
                        bbox_width = bbox[2] / img_width
                        bbox_height = bbox[3] / img_height
                
                # Create annotation record (explicitly let database auto-generate ID)
                annotation_data = {
                    'annotation_file_id': file_id,
                    'image_id': image_info['dataset_image_id'],
                    'dataset_id': annotation_file.dataset_id,
                    'coco_image_id': coco_image_id,
                    'coco_annotation_id': coco_ann.get('id'),
                    'category_id': category_id,
                    'category': class_name,
                    'bbox_x': bbox_x,
                    'bbox_y': bbox_y,
                    'bbox_width': bbox_width,
                    'bbox_height': bbox_height,
                    'bbox': coco_ann.get('bbox'),  # Keep original for backward compatibility
                    'segmentation': coco_ann.get('segmentation'),
                    'area': coco_ann.get('area'),
                    'confidence': 1.0
                }
                
                annotation = Annotation(**annotation_data)
                db.add(annotation)
                annotation_count += 1
                class_counts[class_name] = class_counts.get(class_name, 0) + 1
        
        if task:
            task.progress = 95
            db.commit()
        
        # Create annotation classes
        for class_name, count in class_counts.items():
            category_id = None
            for cat_id, cat_name in category_mapping.items():
                if cat_name == class_name:
                    category_id = cat_id
                    break
                    
            annotation_class = AnnotationClass(
                annotation_file_id=file_id,
                class_name=class_name,
                category_id=category_id,
                count=count,
                color='#ea384c',  # Default color
                opacity=0.25
            )
            db.add(annotation_class)
        
        # Update annotation file status
        annotation_file.is_processed = True
        annotation_file.processing_status = "completed"
        annotation_file.annotation_count = annotation_count
        annotation_file.category_count = len(class_counts)
        annotation_file.image_count = len(coco_image_mapping)
        
        db.commit()
        
        return {
            "success": True,
            "annotations_processed": annotation_count,
            "classes_created": len(class_counts),
            "images_matched": len(coco_image_mapping)
        }
        
    except Exception as e:
        # Update error status
        if annotation_file:
            annotation_file.processing_status = "failed"
            annotation_file.error_message = str(e)
            db.commit()
        
        if task:
            task.status = 'failed'
            task.error_message = str(e)
            db.commit()
        
        raise e
