from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from typing import List, Optional, Dict, Any
import json
import uuid
from datetime import datetime
import numpy as np

from ..database import get_db
from ..models import Dataset, AnnotationFile, Annotation, AnnotationClass, Image, AnnotationFileImage
from ..database import SessionLocal

router = APIRouter()


def validate_and_normalize_segmentation(
    segmentation: Any,
    image_width: Optional[int] = None,
    image_height: Optional[int] = None,
    normalize: bool = False
) -> Optional[List]:
    """
    Validate and normalize segmentation coordinates.
    
    Args:
        segmentation: Segmentation data (list of polygons or RLE dict)
        image_width: Image width for validation (optional)
        image_height: Image height for validation (optional)
        normalize: If True, normalize coordinates to 0-1 range. If False, keep as pixel coordinates (integers)
    
    Returns:
        Validated segmentation with integer coordinates (or normalized if normalize=True), or None if invalid
    """
    if not segmentation:
        return None
    
    # Handle RLE format (dict) - return as-is
    if isinstance(segmentation, dict):
        return segmentation
    
    # Handle list of polygons
    if isinstance(segmentation, list):
        validated_polygons = []
        
        for polygon in segmentation:
            if not isinstance(polygon, list) or len(polygon) < 6:  # Need at least 3 points (6 values)
                continue
            
            validated_polygon = []
            
            # Process coordinates in pairs (x, y)
            for i in range(0, len(polygon), 2):
                if i + 1 >= len(polygon):
                    break
                
                x = polygon[i]
                y = polygon[i + 1]
                
                # Convert to float first
                try:
                    x = float(x)
                    y = float(y)
                except (ValueError, TypeError):
                    continue  # Skip invalid coordinates
                
                # Check for NaN or Inf
                if np.isnan(x) or np.isnan(y) or np.isinf(x) or np.isinf(y):
                    continue
                
                if normalize:
                    # Normalize to 0-1 range
                    if image_width and image_width > 0:
                        x = x / image_width
                    if image_height and image_height > 0:
                        y = y / image_height
                    
                    # Clamp to [0, 1]
                    x = max(0.0, min(1.0, x))
                    y = max(0.0, min(1.0, y))
                    validated_polygon.extend([x, y])
                else:
                    # Keep as pixel coordinates - convert to integers
                    # Clamp to image bounds if provided
                    if image_width and image_width > 0:
                        x = max(0.0, min(float(image_width - 1), x))
                    else:
                        x = max(0.0, x)  # At least ensure non-negative
                    
                    if image_height and image_height > 0:
                        y = max(0.0, min(float(image_height - 1), y))
                    else:
                        y = max(0.0, y)  # At least ensure non-negative
                    
                    # Convert to integer - ensure we clamp before rounding to prevent any negative values
                    # Double-check: even after max(0.0, x), ensure no negatives can slip through
                    x = max(0.0, x)
                    y = max(0.0, y)
                    
                    x_int = int(round(x))
                    y_int = int(round(y))
                    
                    # CRITICAL: Final validation - absolutely no negatives allowed
                    # This should never happen after clamping, but double-check anyway
                    if x_int < 0 or y_int < 0:
                        continue  # Skip this coordinate pair
                    
                    if image_width and image_height:
                        # Only add if within bounds
                        if x_int < image_width and y_int < image_height:
                            validated_polygon.extend([x_int, y_int])
                    else:
                        # No bounds check, but we've already ensured non-negative
                        validated_polygon.extend([x_int, y_int])
            
            # Only add polygon if it has at least 3 points (6 coordinates)
            if len(validated_polygon) >= 6:
                validated_polygons.append(validated_polygon)
        
        return validated_polygons if validated_polygons else None
    
    # Unknown format - return None
    return None


def detect_annotation_type(coco_data: Dict[str, Any]) -> Optional[str]:
    """
    Detect annotation type based on COCO data content.
    
    Returns:
        'Segmentation (mask+bbox)' if annotations have both segmentation and bbox data
        'Segmentation (bbox)' if annotations have bboxes but no segmentation
        'Segmentation (mask)' if annotations have segmentation but no bbox data
        'Classification' if only categories exist without spatial data
        'Other' if detection fails
    """
    try:
        annotations = coco_data.get('annotations', [])
        if not annotations:
            return 'Classification'  # Only categories, no annotations
            
        # Check for segmentation data and bbox data
        has_segmentation = False
        has_bbox = False
        
        for ann in annotations:
            if ann.get('segmentation'):
                # Check if segmentation is not empty (sometimes it's [] or null)
                seg = ann['segmentation']
                if seg and (isinstance(seg, list) and len(seg) > 0):
                    has_segmentation = True
            if ann.get('bbox') and len(ann['bbox']) >= 4:
                # Check if bbox is not just zero values
                bbox = ann['bbox']
                if any(val > 0 for val in bbox):
                    has_bbox = True
                
        if has_segmentation and has_bbox:
            return 'Segmentation (mask+bbox)'
        elif has_segmentation:
            return 'Segmentation (mask)'
        elif has_bbox:
            return 'Segmentation (bbox)'
        else:
            return 'Classification'
            
    except Exception as e:
        print(f"Error detecting annotation type: {e}")
        return 'Other'


def update_dataset_annotation_count(db: Session, dataset_id: int):
    """Update the annotation count for a dataset"""
    # Compute total annotations for dataset and return it. Do NOT write to a removed column.
    total_annotations = db.query(func.count(Annotation.id)).filter(
        Annotation.dataset_id == dataset_id
    ).scalar() or 0
    return total_annotations


async def process_coco_annotation_file(
    annotation_file_id: str,
    coco_data: Dict[str, Any]
):
    """Background task to process COCO annotation file and store in database"""
    print(f"DEBUG: Starting background processing for annotation file {annotation_file_id}")
    # Use a fresh session inside background task
    db = SessionLocal()
    try:
        # Update processing status
        annotation_file = db.query(AnnotationFile).filter(AnnotationFile.id == annotation_file_id).first()
        if not annotation_file:
            print(f"DEBUG: Annotation file {annotation_file_id} not found")
            return
            
        print(f"DEBUG: Found annotation file, updating status to processing")
        annotation_file.processing_status = "processing"
        db.commit()
        
        # Clear existing annotations, classes, and file-image mapping for this file
        db.query(Annotation).filter(Annotation.annotation_file_id == annotation_file_id).delete()
        db.query(AnnotationClass).filter(AnnotationClass.annotation_file_id == annotation_file_id).delete()
        db.query(AnnotationFileImage).filter(AnnotationFileImage.annotation_file_id == annotation_file_id).delete()
        
        # Reset sequence to prevent ID conflicts (important for merged files)
        try:
            from sqlalchemy import text
            db.execute(text("SELECT setval('annotations_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM annotations))"))
            db.execute(text("SELECT setval('annotation_classes_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM annotation_classes))"))
            db.commit()
        except Exception:
            # If sequence reset fails, continue anyway
            pass
        
        # Create image name to ID mapping - prioritize default collection
        image_mapping = {}
        
        # First, try to get images from the default collection
        from ..models import ImageCollection
        default_collection = db.query(ImageCollection).filter(
            ImageCollection.dataset_id == annotation_file.dataset_id,
            ImageCollection.is_default == True
        ).first()
        
        if default_collection:
            # Use only images from the default collection for coverage tracking
            print(f"DEBUG: Using default collection '{default_collection.name}' for coverage tracking")
            dataset_images = db.query(Image).filter(
                Image.dataset_id == annotation_file.dataset_id,
                Image.collection_id == default_collection.id
            ).all()
        else:
            # If no default collection, get the first collection or all images
            first_collection = db.query(ImageCollection).filter(
                ImageCollection.dataset_id == annotation_file.dataset_id
            ).first()
            
            if first_collection:
                print(f"DEBUG: No default collection found, using first collection '{first_collection.name}' for coverage tracking")
                dataset_images = db.query(Image).filter(
                    Image.dataset_id == annotation_file.dataset_id,
                    Image.collection_id == first_collection.id
                ).all()
            else:
                # Fallback: use all images (for datasets without collections)
                print(f"DEBUG: No collections found, using all images for coverage tracking")
                dataset_images = db.query(Image).filter(Image.dataset_id == annotation_file.dataset_id).all()
        
        for img in dataset_images:
            image_mapping[img.file_name] = img.id
            # Also try without extension
            base_name = img.file_name.rsplit('.', 1)[0] if '.' in img.file_name else img.file_name
            image_mapping[base_name] = img.id
        
        print(f"DEBUG: Created image mapping for {len(dataset_images)} images from collection")
        
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
                
                # Persist per-file image mapping for coverage queries
                afi = None
                if dataset_image_id:
                    coco_image_mapping[coco_image_id] = {
                        'dataset_image_id': dataset_image_id,
                        'width': coco_img.get('width', 1),
                        'height': coco_img.get('height', 1),
                        'file_name': file_name
                    }

                # Create AnnotationFileImage entry regardless of dataset match (so we know which images were referenced)
                try:
                    afi = AnnotationFileImage(
                        annotation_file_id=annotation_file_id,
                        coco_image_id=coco_image_id,
                        file_name=file_name,
                        dataset_image_id=dataset_image_id,
                        width=coco_img.get('width', None),
                        height=coco_img.get('height', None)
                    )
                    db.add(afi)
                    print(f"DEBUG: Added AnnotationFileImage for {file_name}, coco_id: {coco_image_id}")
                except Exception as e:
                    print(f"ERROR: Failed to create AnnotationFileImage for {file_name}: {e}")
                    # If model not present or insert fails, continue without blocking processing
                    pass
        
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
                
                # Normalize bbox coordinates (guard against zero width/height to avoid division by zero)
                bbox_x = bbox_y = bbox_width = bbox_height = None
                if 'bbox' in coco_ann and coco_ann['bbox']:
                    bbox = coco_ann['bbox']
                    if len(bbox) >= 4:
                        img_width = image_info.get('width') or 1
                        img_height = image_info.get('height') or 1
                        if img_width <= 0:
                            img_width = 1
                        if img_height <= 0:
                            img_height = 1
                        bbox_x = bbox[0] / img_width
                        bbox_y = bbox[1] / img_height
                        bbox_width = bbox[2] / img_width
                        bbox_height = bbox[3] / img_height

                # Normalize segmentation coordinates to relative (0..1) if present and polygon format
                segmentation_normalized = None
                if 'segmentation' in coco_ann and coco_ann['segmentation']:
                    seg = coco_ann['segmentation']
                    img_width = image_info.get('width', 1) or 1
                    img_height = image_info.get('height', 1) or 1
                    
                    # Validate and normalize segmentation (normalize to 0-1 range)
                    segmentation_normalized = validate_and_normalize_segmentation(
                        seg,
                        image_width=img_width,
                        image_height=img_height,
                        normalize=True
                    )
                    
                    # Fallback to storing raw segmentation if validation fails
                    if segmentation_normalized is None:
                        segmentation_normalized = coco_ann.get('segmentation')

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
                    'segmentation': segmentation_normalized,
                    'area': coco_ann.get('area'),
                    'confidence': 1.0
                }
                
                annotation = Annotation(**annotation_data)
                db.add(annotation)
                annotation_count += 1
                class_counts[class_name] = class_counts.get(class_name, 0) + 1

        # Determine annotation file type based on annotations
        detected_type = detect_annotation_type(coco_data)
        if annotation_file and detected_type:
            annotation_file.type = detected_type
        
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
        print(f"DEBUG: Processing completed for {annotation_file_id}. Final annotation count: {annotation_count}")
        annotation_file.is_processed = True
        annotation_file.processing_status = "completed"
        annotation_file.annotation_count = annotation_count
        annotation_file.category_count = len(class_counts)
        # image_count should reflect number of images referenced in the file
        annotation_file.image_count = db.query(func.count(AnnotationFileImage.id)).filter(
            AnnotationFileImage.annotation_file_id == annotation_file_id
        ).scalar() or 0
        
        # Update dataset annotation count
        update_dataset_annotation_count(db, annotation_file.dataset_id)
        
        db.commit()
        
    except Exception as e:
        # Update error status
        print(f"DEBUG: Error processing annotation file {annotation_file_id}: {str(e)}")
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
    
    # Detect annotation type from COCO data
    detected_type = detect_annotation_type(coco_data)
    
    annotation_file = AnnotationFile(
        id=annotation_file_id,
        dataset_id=dataset_id,
        name=file.filename,
        format="COCO",
        type=detected_type,  # Set type based on detection
        file_size=len(content),
        is_processed=False,
        processing_status="pending"
    )
    
    db.add(annotation_file)
    db.commit()
    db.close()  # Release so background task can use its own session

    try:
        # Process synchronously so annotations are in DB before we return (edit mode will then load them)
        await process_coco_annotation_file(annotation_file_id, coco_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"COCO processing failed: {str(e)}")

    return {
        "success": True,
        "annotation_file_id": annotation_file_id,
        "message": "Annotation file saved"
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
            "bbox": ann.bbox,  # Use the bbox JSON field directly
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
    
    # Get classes from AnnotationClass table
    classes = db.query(AnnotationClass).filter(
        AnnotationClass.annotation_file_id == annotation_file_id
    ).all()
    
    class_data = []
    for cls in classes:
        class_data.append({
            "className": cls.class_name,
            "count": cls.count if cls.count is not None else 0,
            "color": cls.color or "#ea384c",
            "opacity": cls.opacity if cls.opacity is not None else 0.25,
            "categoryId": cls.category_id
        })
    
    # If no class rows but file has annotations, derive from Annotation.category so UI is not empty
    if not class_data and annotation_file.annotation_count and annotation_file.annotation_count > 0:
        category_counts = (
            db.query(Annotation.category, func.count(Annotation.id))
            .filter(
                Annotation.annotation_file_id == annotation_file_id,
                Annotation.category.isnot(None),
                Annotation.category != ""
            )
            .group_by(Annotation.category)
            .all()
        )
        for category_name, count in category_counts:
            class_data.append({
                "className": category_name,
                "count": count or 0,
                "color": "#ea384c",
                "opacity": 0.25,
                "categoryId": None
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


@router.delete("/datasets/{dataset_id}/annotations/{annotation_file_id}/class/{class_name}")
async def delete_class_annotations(
    dataset_id: int,
    annotation_file_id: str,
    class_name: str,
    db: Session = Depends(get_db)
):
    """Delete all annotations of a specific class from an annotation file"""
    
    # Verify annotation file exists
    annotation_file = db.query(AnnotationFile).filter(
        and_(
            AnnotationFile.id == annotation_file_id,
            AnnotationFile.dataset_id == dataset_id
        )
    ).first()
    
    if not annotation_file:
        raise HTTPException(status_code=404, detail="Annotation file not found")
    
    try:
        # Delete all annotations with this class name
        deleted_count = db.query(Annotation).filter(
            and_(
                Annotation.annotation_file_id == annotation_file_id,
                Annotation.category == class_name
            )
        ).delete()
        
        # Delete the annotation class record
        db.query(AnnotationClass).filter(
            and_(
                AnnotationClass.annotation_file_id == annotation_file_id,
                AnnotationClass.class_name == class_name
            )
        ).delete()
        
        # Update annotation file counts
        remaining_annotation_count = db.query(func.count(Annotation.id)).filter(
            Annotation.annotation_file_id == annotation_file_id
        ).scalar() or 0
        
        remaining_class_count = db.query(func.count(AnnotationClass.id)).filter(
            AnnotationClass.annotation_file_id == annotation_file_id
        ).scalar() or 0
        
        annotation_file.annotation_count = remaining_annotation_count
        annotation_file.category_count = remaining_class_count
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Deleted {deleted_count} annotations for class '{class_name}'",
            "deleted_count": deleted_count,
            "remaining_annotations": remaining_annotation_count,
            "remaining_classes": remaining_class_count
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete class annotations: {str(e)}")


def process_coco_annotation_file_task(
    task_id: int,
    file_id: str,
    coco_data: Dict[str, Any],
    db: Session
):
    """Process COCO annotation file as a task (for background processing)"""
    print(f"DEBUG: Starting task processing for annotation file {file_id}, task {task_id}")
    try:
        # Get the annotation file record
        annotation_file = db.query(AnnotationFile).filter(AnnotationFile.id == file_id).first()
        if not annotation_file:
            print(f"DEBUG: Annotation file with ID {file_id} not found")
            raise Exception(f"Annotation file with ID {file_id} not found")
        
        # Update processing status
        print(f"DEBUG: Found annotation file {file_id}, updating status to processing")
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
        
        print(f"DEBUG: Processing annotations from COCO data. Found {len(coco_data.get('annotations', []))} annotations")
        
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
                    'segmentation': coco_ann.get('segmentation'),  # Will be validated below
                    'area': coco_ann.get('area'),
                    'confidence': 1.0
                }
                
                # Validate segmentation coordinates before saving
                if annotation_data['segmentation']:
                    img_width = image_info.get('width', 1) or 1
                    img_height = image_info.get('height', 1) or 1
                    validated_seg = validate_and_normalize_segmentation(
                        annotation_data['segmentation'],
                        image_width=img_width,
                        image_height=img_height,
                        normalize=False  # Keep as pixel coordinates (integers)
                    )
                    if validated_seg is not None:
                        annotation_data['segmentation'] = validated_seg
                    else:
                        # If validation fails, set to None
                        annotation_data['segmentation'] = None
                
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
        print(f"DEBUG: Task processing completed for {file_id}. Final annotation count: {annotation_count}")
        annotation_file.is_processed = True
        annotation_file.processing_status = "completed"
        annotation_file.annotation_count = annotation_count
        annotation_file.category_count = len(class_counts)
        annotation_file.image_count = len(coco_image_mapping)
        # Detect type based on presence of segmentation or bboxes
        detected_type = detect_annotation_type(coco_data)
        if detected_type:
            annotation_file.type = detected_type
        
        db.commit()
        print(f"DEBUG: Database committed for {file_id}. Annotation count set to: {annotation_file.annotation_count}")
        
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


@router.post("/datasets/{dataset_id}/annotations/recalculate-count")
async def recalculate_dataset_annotation_count(
    dataset_id: int,
    db: Session = Depends(get_db)
):
    """Recalculate the annotation count for a dataset"""
    
    # Verify dataset exists
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Update the annotation count
    total = update_dataset_annotation_count(db, dataset_id)
    db.commit()

    return {
        "success": True,
        "message": f"Annotation count recalculated: {total}",
        "total_annotations": total
    }


@router.post("/datasets/recalculate-all-counts")
async def recalculate_all_dataset_annotation_counts(
    db: Session = Depends(get_db)
):
    """Recalculate annotation counts for all datasets"""
    
    datasets = db.query(Dataset).all()
    updated_count = 0
    
    for dataset in datasets:
        # Compare previous computed count to new computed count
        old_count = db.query(func.count(Annotation.id)).filter(Annotation.dataset_id == dataset.id).scalar() or 0
        new_count = update_dataset_annotation_count(db, dataset.id)
        if new_count != old_count:
            updated_count += 1
    
    db.commit()
    
    return {
        "success": True,
        "message": f"Updated annotation counts for {updated_count} datasets"
    }
