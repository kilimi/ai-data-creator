from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, func
from typing import List, Optional, Dict, Any
import json
import uuid
from datetime import datetime
import numpy as np

from ..database import get_db
from ..models import Dataset, AnnotationFile, Annotation, AnnotationClass, Image, AnnotationFileImage, ImageCollection
from ..database import SessionLocal

router = APIRouter()


def _filename_lookup_candidates(raw: Optional[str]) -> List[str]:
    """Variants of a filesystem / COCO file_name useful for matching DB rows."""
    if not raw:
        return []
    s = str(raw).strip().replace("\\", "/")
    while s.startswith("./"):
        s = s[2:]
    out: List[str] = []
    seen: set = set()

    def push(x: str) -> None:
        x = x.strip("/")
        if x and x not in seen:
            seen.add(x)
            out.append(x)

    push(s)
    if "/" in s:
        push(s.rsplit("/", 1)[-1])
    basename = s.rsplit("/", 1)[-1]
    if "." in basename:
        push(basename.rsplit(".", 1)[0])
    # Peel left path segments ("datasplit/images/foo.jpg" -> "images/foo.jpg" -> ...)
    rest = s
    while "/" in rest:
        rest = rest.split("/", 1)[1]
        push(rest)
        if "." in rest:
            push(rest.rsplit(".", 1)[0])
    return out


def _build_image_lookup_indexes(images: List[Image]) -> tuple[Dict[str, int], Dict[str, int]]:
    """Exact and case-insensitive filename -> image id (first occurrence wins)."""
    exact: Dict[str, int] = {}
    ci: Dict[str, int] = {}
    for img in images:
        iid = img.id
        for key in _filename_lookup_candidates(getattr(img, "file_name", None)):
            if key not in exact:
                exact[key] = iid
            lk = key.lower()
            if lk not in ci:
                ci[lk] = iid
    return exact, ci


def _resolve_image_id_for_coco_filename(
    exact_map: Dict[str, int],
    ci_map: Dict[str, int],
    coco_file_name: Any,
) -> Optional[int]:
    for key in _filename_lookup_candidates(
        coco_file_name if coco_file_name is None else str(coco_file_name)
    ):
        if key in exact_map:
            return exact_map[key]
        lk = key.lower()
        if lk in ci_map:
            return ci_map[lk]
    return None


def resolve_dataset_image_by_filename(
    db: Session,
    dataset_id: int,
    file_name: str,
    preferred_collection_id: Optional[int] = None,
) -> Optional[Image]:
    """
    Deterministically resolve a dataset image from a bare filename.

    Since the image-collections feature landed, multiple `images` rows can share
    the same `file_name` in a single dataset (one per collection, e.g. RGB + Depth).
    Previously callers used ``.filter(...).first()`` with no ordering, so save and
    load paths could resolve to *different* rows — annotations would be written
    against one collection's image and read back against another, making them
    appear lost on reload.

    If a preferred collection is provided (e.g. the currently edited layer),
    resolve there first. Otherwise canonicalise to the dataset's default
    collection (typically RGB). If neither yields a match, fall back to the
    oldest matching image by id, which is stable across processes.
    """
    if not file_name:
        return None

    if preferred_collection_id is not None:
        preferred_image = (
            db.query(Image)
            .filter(
                Image.dataset_id == dataset_id,
                Image.file_name == file_name,
                Image.collection_id == preferred_collection_id,
            )
            .order_by(Image.id.asc())
            .first()
        )
        if preferred_image is not None:
            return preferred_image

    default_collection = (
        db.query(ImageCollection)
        .filter(
            ImageCollection.dataset_id == dataset_id,
            ImageCollection.is_default.is_(True),
        )
        .order_by(ImageCollection.id.asc())
        .first()
    )

    if default_collection is not None:
        image = (
            db.query(Image)
            .filter(
                Image.dataset_id == dataset_id,
                Image.file_name == file_name,
                Image.collection_id == default_collection.id,
            )
            .order_by(Image.id.asc())
            .first()
        )
        if image is not None:
            return image

    return (
        db.query(Image)
        .filter(Image.dataset_id == dataset_id, Image.file_name == file_name)
        .order_by(Image.id.asc())
        .first()
    )


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
        Validated segmentation with integer pixel coordinates (or normalized if normalize=True), or None if invalid
        
    Note:
        For consistency, segmentation coordinates are stored as pixel coordinates (normalize=False).
        This avoids coordinate transformation issues when images have different dimensions.
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
        
        # Index ALL dataset images so coverage reflects real matches (any collection).
        # Previously only the default/first collection was indexed — COCO filenames then
        # rarely matched → dataset_image_id stayed NULL everywhere → UI showed 0 coverage.
        dataset_images = db.query(Image).filter(
            Image.dataset_id == annotation_file.dataset_id
        ).all()
        image_exact, image_ci = _build_image_lookup_indexes(dataset_images)
        print(
            f"DEBUG: Image lookup index built from {len(dataset_images)} dataset images "
            f"({len(image_exact)} exact keys)"
        )
        
        # Process COCO images and create mapping
        coco_image_mapping = {}
        if 'images' in coco_data:
            for coco_img in coco_data['images']:
                coco_image_id = coco_img['id']
                file_name = coco_img.get('file_name') or coco_img.get('name') or ''

                dataset_image_id = _resolve_image_id_for_coco_filename(
                    image_exact, image_ci, file_name
                )
                
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

                # Keep segmentation coordinates as pixel values (not normalized)
                segmentation_pixels = None
                if 'segmentation' in coco_ann and coco_ann['segmentation']:
                    seg = coco_ann['segmentation']
                    img_width = image_info.get('width', 1) or 1
                    img_height = image_info.get('height', 1) or 1
                    
                    # Validate segmentation but keep as pixel coordinates (integers)
                    segmentation_pixels = validate_and_normalize_segmentation(
                        seg,
                        image_width=img_width,
                        image_height=img_height,
                        normalize=False  # Keep as pixel coordinates
                    )
                    
                    # Fallback to storing raw segmentation if validation fails
                    if segmentation_pixels is None:
                        segmentation_pixels = coco_ann.get('segmentation')

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
                    'segmentation': segmentation_pixels,
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


@router.post("/datasets/{dataset_id}/annotations/save-direct")
async def save_annotations_direct(
    dataset_id: int,
    data: Dict[str, Any],
    db: Session = Depends(get_db)
):
    """Save annotations directly without COCO file building (more efficient)"""
    
    # Verify dataset exists
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Extract data
    name = data.get('name')
    if not name or not name.strip():
        raise HTTPException(status_code=400, detail="Annotation file name is required")
    
    categories = data.get('categories', [])
    images = data.get('images', [])
    annotations = data.get('annotations', [])
    requested_collection_id_raw = data.get("active_collection_id")
    requested_collection_id: Optional[int] = None
    if requested_collection_id_raw is not None:
        try:
            requested_collection_id = int(requested_collection_id_raw)
        except (TypeError, ValueError):
            requested_collection_id = None
    
    if not categories:
        raise HTTPException(status_code=400, detail="At least one category is required")
    
    # Create annotation file record
    annotation_file_id = str(uuid.uuid4())
    
    annotation_file = AnnotationFile(
        id=annotation_file_id,
        dataset_id=dataset_id,
        name=name if name.endswith('.json') else f"{name}.json",
        format="COCO",
        type="Segmentation (mask+bbox)",
        is_processed=False,
        processing_status="processing"
    )
    
    db.add(annotation_file)
    db.commit()
    
    try:
        # Create image name to ID mapping.
        #
        # IMPORTANT: multiple `images` rows can share the same `file_name` in one
        # dataset (one per image-collection). Naively doing `mapping[fn] = img`
        # for each row would let the last-iterated row win, so annotations get
        # saved against an arbitrary collection's image — and the load path,
        # which uses a different ordering, would miss them. Use the same
        # deterministic resolver as the load path so the two cannot disagree.
        image_mapping: Dict[str, Image] = {}
        default_collection = (
            db.query(ImageCollection)
            .filter(
                ImageCollection.dataset_id == dataset_id,
                ImageCollection.is_default.is_(True),
            )
            .order_by(ImageCollection.id.asc())
            .first()
        )
        default_collection_id = default_collection.id if default_collection else None

        dataset_images = (
            db.query(Image)
            .filter(Image.dataset_id == dataset_id)
            .order_by(Image.id.asc())
            .all()
        )
        for img in dataset_images:
            if not img.file_name:
                continue
            base_name = img.file_name.rsplit('.', 1)[0] if '.' in img.file_name else img.file_name

            for key in (img.file_name, base_name):
                existing = image_mapping.get(key)
                if existing is None:
                    image_mapping[key] = img
                    continue
                # Prefer the explicitly requested collection first (active layer),
                # then the dataset default collection, then oldest id.
                existing_is_requested = (
                    requested_collection_id is not None
                    and existing.collection_id == requested_collection_id
                )
                new_is_requested = (
                    requested_collection_id is not None
                    and img.collection_id == requested_collection_id
                )
                existing_is_default = (
                    default_collection_id is not None
                    and existing.collection_id == default_collection_id
                )
                new_is_default = (
                    default_collection_id is not None
                    and img.collection_id == default_collection_id
                )
                if new_is_requested and not existing_is_requested:
                    image_mapping[key] = img
                elif (
                    new_is_requested == existing_is_requested
                    and new_is_default
                    and not existing_is_default
                ):
                    image_mapping[key] = img
                elif (
                    new_is_requested == existing_is_requested
                    and new_is_default == existing_is_default
                    and img.id < existing.id
                ):
                    image_mapping[key] = img
        
        # Process categories
        category_mapping = {}
        class_counts = {}
        for cat in categories:
            cat_id = cat.get('id')
            cat_name = cat.get('name')
            if cat_id and cat_name:
                category_mapping[cat_id] = cat_name
                class_counts[cat_name] = 0
        
        # Process images and create mapping
        coco_image_mapping = {}
        for img_data in images:
            coco_image_id = img_data.get('id')
            file_name = img_data.get('file_name')
            img_width = img_data.get('width', 1) or 1
            img_height = img_data.get('height', 1) or 1
            
            if not file_name:
                continue
            
            # Find matching dataset image
            dataset_image = image_mapping.get(file_name)
            if not dataset_image:
                base_name = file_name.rsplit('.', 1)[0] if '.' in file_name else file_name
                dataset_image = image_mapping.get(base_name)
            
            if dataset_image:
                coco_image_mapping[coco_image_id] = {
                    'dataset_image_id': dataset_image.id,
                    'width': img_width,
                    'height': img_height,
                    'file_name': file_name
                }
                
                # Create AnnotationFileImage entry
                try:
                    afi = AnnotationFileImage(
                        annotation_file_id=annotation_file_id,
                        coco_image_id=coco_image_id,
                        file_name=file_name,
                        dataset_image_id=dataset_image.id,
                        width=img_width,
                        height=img_height
                    )
                    db.add(afi)
                except Exception:
                    pass
        
        # Process annotations
        annotation_count = 0
        for ann_data in annotations:
            coco_image_id = ann_data.get('image_id')
            category_id = ann_data.get('category_id')
            
            if coco_image_id not in coco_image_mapping:
                continue
            
            image_info = coco_image_mapping[coco_image_id]
            class_name = category_mapping.get(category_id, f"category_{category_id}")
            
            # Process bbox
            bbox = ann_data.get('bbox')
            bbox_x = bbox_y = bbox_width = bbox_height = None
            
            if bbox and len(bbox) >= 4:
                img_width = image_info['width']
                img_height = image_info['height']
                
                # Check if already normalized
                if all(0 <= v <= 1 for v in bbox):
                    bbox_x, bbox_y, bbox_width, bbox_height = bbox
                else:
                    # Normalize
                    bbox_x = bbox[0] / img_width
                    bbox_y = bbox[1] / img_height
                    bbox_width = bbox[2] / img_width
                    bbox_height = bbox[3] / img_height
            
            # Process segmentation - keep as pixel coordinates
            segmentation_pixels = None
            if ann_data.get('segmentation'):
                seg = ann_data['segmentation']
                img_width = image_info.get('width', 1) or 1
                img_height = image_info.get('height', 1) or 1
                
                segmentation_pixels = validate_and_normalize_segmentation(
                    seg,
                    image_width=img_width,
                    image_height=img_height,
                    normalize=False
                )
                
                if segmentation_pixels is None:
                    segmentation_pixels = seg
            
            # Create annotation
            annotation = Annotation(
                annotation_file_id=annotation_file_id,
                image_id=image_info['dataset_image_id'],
                dataset_id=dataset_id,
                coco_image_id=coco_image_id,
                coco_annotation_id=ann_data.get('id'),
                category_id=category_id,
                category=class_name,
                bbox_x=bbox_x,
                bbox_y=bbox_y,
                bbox_width=bbox_width,
                bbox_height=bbox_height,
                bbox=bbox,
                segmentation=segmentation_pixels,
                area=ann_data.get('area'),
                confidence=1.0
            )
            
            db.add(annotation)
            annotation_count += 1
            class_counts[class_name] = class_counts.get(class_name, 0) + 1
        
        # Create annotation classes
        for class_name, count in class_counts.items():
            cat_id = None
            for c_id, c_name in category_mapping.items():
                if c_name == class_name:
                    cat_id = c_id
                    break
            
            annotation_class = AnnotationClass(
                annotation_file_id=annotation_file_id,
                class_name=class_name,
                category_id=cat_id,
                count=count,
                color='#ea384c',
                opacity=0.25
            )
            db.add(annotation_class)
        
        # Update annotation file
        annotation_file.is_processed = True
        annotation_file.processing_status = "completed"
        annotation_file.annotation_count = annotation_count
        annotation_file.category_count = len(class_counts)
        annotation_file.image_count = len(coco_image_mapping)
        
        # Update dataset annotation count
        update_dataset_annotation_count(db, dataset_id)
        
        db.commit()
        
        return {
            "success": True,
            "annotation_file_id": annotation_file_id,
            "message": f"Saved {annotation_count} annotations from {len(coco_image_mapping)} images"
        }
        
    except Exception as e:
        db.rollback()
        # Update error status
        try:
            annotation_file.processing_status = "failed"
            annotation_file.error_message = str(e)
            db.commit()
        except Exception:
            pass
        raise HTTPException(status_code=500, detail=f"Failed to save annotations: {str(e)}")


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
    
    # Preload image dimensions from AnnotationFileImage
    image_ids_in_result = set(ann.image_id for ann in annotations)
    ann_file_images = db.query(AnnotationFileImage).filter(
        AnnotationFileImage.annotation_file_id == annotation_file_id,
        AnnotationFileImage.dataset_image_id.in_(image_ids_in_result)
    ).all()
    image_dims = {afi.dataset_image_id: (afi.width, afi.height) for afi in ann_file_images}
    
    # Convert to response format
    annotation_data = []
    for ann in annotations:
        dims = image_dims.get(ann.image_id, (None, None))
        annotation_data.append({
            "id": ann.id,
            "imageId": ann.image_id,
            "className": ann.category,
            "bbox": ann.bbox,  # Use the bbox JSON field directly
            "segmentation": ann.segmentation,
            "area": ann.area,
            "confidence": ann.confidence,
            "cocoImageId": ann.coco_image_id,
            "cocoAnnotationId": ann.coco_annotation_id,
            "imageWidth": dims[0],
            "imageHeight": dims[1]
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


@router.get("/datasets/{dataset_id}/annotations/{annotation_file_id}/image-annotations")
async def get_annotations_for_image(
    dataset_id: int,
    annotation_file_id: str,
    image_filename: str = Query(..., description="Image filename (e.g. photo.png)"),
    collection_id: Optional[int] = Query(None, description="Preferred image-collection id"),
    db: Session = Depends(get_db)
):
    """Return all annotations for a single image inside an annotation file (by filename)."""
    annotation_file = db.query(AnnotationFile).filter(
        and_(AnnotationFile.id == annotation_file_id, AnnotationFile.dataset_id == dataset_id)
    ).first()
    if not annotation_file:
        raise HTTPException(status_code=404, detail="Annotation file not found")

    # Use the shared resolver so this matches exactly the row the save paths wrote to.
    image = resolve_dataset_image_by_filename(
        db,
        dataset_id,
        image_filename,
        preferred_collection_id=collection_id,
    )
    if not image:
        raise HTTPException(status_code=404, detail=f"Image '{image_filename}' not found in dataset")

    annotations = db.query(Annotation).filter(
        and_(
            Annotation.annotation_file_id == annotation_file_id,
            Annotation.image_id == image.id,
        )
    ).all()

    cls_rows = db.query(AnnotationClass).filter(
        AnnotationClass.annotation_file_id == annotation_file_id
    ).all()
    cls_map = {c.category_id: {"name": c.class_name, "color": c.color or "#ea384c"} for c in cls_rows}

    result = []
    for ann in annotations:
        cls_info = cls_map.get(ann.category_id, {"name": ann.category or "unknown", "color": "#ea384c"})
        seg = ann.segmentation
        if seg and isinstance(seg, list) and len(seg) > 0:
            first = seg[0]
            flat = seg if isinstance(first, (int, float)) else (first if isinstance(first, list) else seg)
        else:
            flat = []
        result.append({
            "id": ann.id,
            "className": cls_info["name"],
            "color": cls_info["color"],
            "segmentation": flat,
            "bbox": ann.bbox,
            "area": ann.area,
            "confidence": ann.confidence,
        })

    return {
        "success": True,
        "data": {
            "annotations": result,
            "imageWidth": image.width or 1,
            "imageHeight": image.height or 1,
            "imageFilename": image.file_name,
            "imageId": image.id,
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
        
        # Create image name to ID mapping. Scope to the dataset's default
        # collection so we don't attach annotations to depth/other derived
        # collections that share filenames with the source images. Matches the
        # resolver used elsewhere (see resolve_dataset_image_by_filename).
        image_mapping = {}
        default_collection = (
            db.query(ImageCollection)
            .filter(
                ImageCollection.dataset_id == annotation_file.dataset_id,
                ImageCollection.is_default.is_(True),
            )
            .order_by(ImageCollection.id.asc())
            .first()
        )
        base_img_query = db.query(Image).filter(Image.dataset_id == annotation_file.dataset_id)
        if default_collection is not None:
            dataset_images = base_img_query.filter(
                Image.collection_id == default_collection.id
            ).order_by(Image.id.asc()).all()
        else:
            dataset_images = base_img_query.order_by(Image.id.asc()).all()
        for img in dataset_images:
            if not img.file_name:
                continue
            image_mapping.setdefault(img.file_name, img.id)
            base_name = img.file_name.rsplit('.', 1)[0] if '.' in img.file_name else img.file_name
            image_mapping.setdefault(base_name, img.id)
        
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
                
                # Validate segmentation coordinates before saving (keep as pixel coordinates)
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
