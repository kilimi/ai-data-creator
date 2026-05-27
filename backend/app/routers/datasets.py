from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional, List
from pydantic import BaseModel
import json
import base64
from pathlib import Path
import os
import re
import base64
import tempfile
import subprocess
import time
import logging
from datetime import datetime
import asyncio
import shutil
import threading
from PIL import Image
import io
import uuid
import cv2
import numpy as np

from .. import models, schemas
from ..database import get_db, SessionLocal

router = APIRouter()
logger = logging.getLogger(__name__)


def _primary_projects_disk_root() -> Path:
    """ Writable ``projects`` directory used for uploads (Docker: /app/projects ). """
    candidates: List[Path] = []
    env = os.environ.get("LAI_PROJECTS_ROOT", "").strip()
    if env:
        candidates.append(Path(env))
    backend_root = Path(__file__).resolve().parents[2]  # .../backend
    repo_root = backend_root.parent
    candidates.extend(
        [
            Path("/app/projects"),
            Path("projects"),
            backend_root / "projects",
            repo_root / "projects",
            repo_root / ".lai-data" / "projects",
        ]
    )
    seen = set()
    for raw in candidates:
        p = raw.resolve() if raw.exists() else raw
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        try:
            if p.is_dir():
                return p.resolve()
        except OSError:
            continue
    base = Path("projects")
    base.mkdir(parents=True, exist_ok=True)
    return base.resolve()


def _apply_storage_url_rewrite_for_project_move(
    db: Session,
    dataset: models.Dataset,
    *,
    dataset_id: int,
    old_project_id: int,
    new_project_id: int,
) -> None:
    """Update dataset + image rows so /static/projects/<old>/ paths match the new project folder."""
    for field_name in ("logo_url", "thumbnailUrl", "url"):
        val = getattr(dataset, field_name, None)
        if val:
            setattr(
                dataset,
                field_name,
                _rewrite_dataset_storage_url_segment(
                    val,
                    old_project_id=old_project_id,
                    new_project_id=new_project_id,
                    dataset_id=dataset_id,
                ),
            )
    for im in (
        db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
    ):
        if im.url:
            im.url = _rewrite_dataset_storage_url_segment(
                im.url,
                old_project_id=old_project_id,
                new_project_id=new_project_id,
                dataset_id=dataset_id,
            )
        if im.thumbnail_url:
            im.thumbnail_url = _rewrite_dataset_storage_url_segment(
                im.thumbnail_url,
                old_project_id=old_project_id,
                new_project_id=new_project_id,
                dataset_id=dataset_id,
            )


def _rewrite_dataset_storage_url_segment(
    value: Optional[str],
    *,
    old_project_id: int,
    new_project_id: int,
    dataset_id: int,
) -> Optional[str]:
    """Rewrite paths pointing at projects/<old_pid>/<dataset_id>/ to new project id."""
    if value is None or value == "":
        return value
    pairs = (
        (
            f"/static/projects/{old_project_id}/{dataset_id}/",
            f"/static/projects/{new_project_id}/{dataset_id}/",
        ),
        (
            f"/projects/{old_project_id}/{dataset_id}/",
            f"/projects/{new_project_id}/{dataset_id}/",
        ),
        (
            f"projects/{old_project_id}/{dataset_id}/",
            f"projects/{new_project_id}/{dataset_id}/",
        ),
        # Windows-style URLs occasionally stored incorrectly
        (
            f"/static/projects\\{old_project_id}\\{dataset_id}\\",
            f"/static/projects/{new_project_id}/{dataset_id}/",
        ),
    )
    out = value
    for old_seg, new_seg in pairs:
        out = out.replace(old_seg, new_seg)
    return out


def _filesystem_relocate_dataset_tree(
    old_project_id: int,
    new_project_id: int,
    dataset_id: int,
) -> tuple[bool, Optional[str]]:
    """
    Move ``projects/<old>/<dataset_id>/`` -> ``projects/<new>/<dataset_id>/``.
    Returns (did_relocate_tree, None) or (False, error_message_on_failure).
    ``did_relocate`` is False if source tree did not exist (nothing to move).
    """
    root = _primary_projects_disk_root()
    src = root / str(old_project_id) / str(dataset_id)
    dst_parent = root / str(new_project_id)
    dst = dst_parent / str(dataset_id)

    try:
        if not src.exists():
            logger.warning(
                "Dataset move: no filesystem tree at %s (dataset_id=%s)",
                src,
                dataset_id,
            )
            return False, None

        dst_parent.mkdir(parents=True, exist_ok=True)

        if dst.exists():
            try:
                if dst.samefile(src):
                    return False, None
            except OSError:
                pass
            # Collision: refuse rather than merge silently.
            if any(dst.iterdir()):
                return False, (
                    f"Target dataset directory already exists and is not empty: {dst}. "
                    "Rename or remove it before moving this dataset."
                )
            try:
                shutil.rmtree(dst)
            except OSError as exc:
                return False, f"Cannot clear empty target directory {dst}: {exc}"

        shutil.move(str(src), str(dst))
        logger.info(
            "Moved dataset filesystem tree %s -> %s",
            src,
            dst,
        )
        return True, None

    except OSError as exc:
        return False, f"Failed to move dataset files from {src} to {dst}: {exc}"



# --------------------------------------------------------------------------- #
# Video-extraction progress tracking
# --------------------------------------------------------------------------- #
# The /video-extract endpoint is synchronous (the single HTTP response
# carries the full result), so the client has no way to observe how far the
# server has gotten through a long clip. We maintain a tiny in-process
# progress dict keyed by a client-provided job id and expose it via
# /video-extract/progress/{job_id} so the UI can poll while the main
# request is still in flight. This is intentionally in-memory (no DB,
# no Redis): the single backend process already serves both requests,
# entries are short-lived, and we clean them up on completion.
_VIDEO_EXTRACT_PROGRESS: "dict[str, dict]" = {}
_VIDEO_EXTRACT_PROGRESS_LOCK = threading.Lock()
_VIDEO_EXTRACT_PROGRESS_TTL_SECONDS = 300  # keep terminal entries around briefly for final polls


def _video_progress_set(job_id: str, **fields) -> None:
    if not job_id:
        return
    now = time.time()
    with _VIDEO_EXTRACT_PROGRESS_LOCK:
        entry = _VIDEO_EXTRACT_PROGRESS.get(job_id) or {"job_id": job_id, "created_at": now}
        entry.update(fields)
        entry["updated_at"] = now
        _VIDEO_EXTRACT_PROGRESS[job_id] = entry
        # Opportunistically evict stale completed/errored entries.
        stale = [
            jid for jid, e in _VIDEO_EXTRACT_PROGRESS.items()
            if e.get("stage") in ("done", "error")
            and now - e.get("updated_at", now) > _VIDEO_EXTRACT_PROGRESS_TTL_SECONDS
        ]
        for jid in stale:
            _VIDEO_EXTRACT_PROGRESS.pop(jid, None)


def _video_progress_get(job_id: str) -> Optional[dict]:
    with _VIDEO_EXTRACT_PROGRESS_LOCK:
        entry = _VIDEO_EXTRACT_PROGRESS.get(job_id)
        return dict(entry) if entry else None


class MergeStrategyConfig(BaseModel):
    # 'exact' | 'iou' | 'priority' | 'union'
    strategy: str = "exact"
    iou_threshold: float = 0.5
    # 'largest' | 'smallest' | 'first' | 'last'
    tie_breaker: str = "largest"
    # Ordered list of annotation_file_ids; index 0 = highest priority
    priority_order: Optional[List[str]] = None
    # 'keep' | 'priority'
    cross_class: str = "keep"
    cross_class_iou: float = 0.7


class MergeAnnotationFilesRequest(BaseModel):
    annotation_file_ids: List[str]
    merged_filename: Optional[str] = None
    strategy: Optional[MergeStrategyConfig] = None


class ViewFiftyOneRequest(BaseModel):
    annotation_file_ids: List[str]
    # Which image collection (layer) to show in FiftyOne; default = RGB / non-depth preferred
    image_collection_id: Optional[int] = None


class MoveDatasetRequest(BaseModel):
    project_id: int


def _create_thumbnail(image_data: bytes, mime_type: str, max_size: tuple = (200, 200)) -> str:
    """Create a thumbnail from image data and return base64 encoded string."""
    try:
        # Open image from bytes
        img = Image.open(io.BytesIO(image_data))
        
        # Convert RGBA to RGB if necessary
        if img.mode == 'RGBA':
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])  # 3 is the alpha channel
            img = background
        elif img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Create thumbnail maintaining aspect ratio
        img.thumbnail(max_size, Image.Resampling.LANCZOS)
        
        # Save to bytes
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=85, optimize=True)
        thumbnail_data = buffer.getvalue()
        
        # Encode to base64
        thumbnail_base64 = base64.b64encode(thumbnail_data).decode()
        return f"data:image/jpeg;base64,{thumbnail_base64}"
    except Exception as e:
        print(f"Error creating thumbnail: {e}")
        # Return original if thumbnail creation fails
        original_base64 = base64.b64encode(image_data).decode()
        return f"data:{mime_type};base64,{original_base64}"


def _is_base64_image(url: str | None) -> bool:
    """Check if a URL is a base64 encoded image data URL."""
    if not url:
        return False
    return url.startswith("data:image/")


def _truncate_base64_url(url: str | None, include_base64: bool = False) -> str | None:
    """
    Truncate base64 image URLs to reduce response size.
    If include_base64 is False, returns None for base64 URLs.
    """
    if not url:
        return None
    if _is_base64_image(url) and not include_base64:
        return None  # Exclude base64 data from response
    return url


def _set_random_image_as_logo(dataset: models.Dataset, db: Session, base_url: str = ""):
    """
    Set a random image from the dataset as the logo/thumbnail if no logo is set.
    Uses ORDER BY RANDOM() LIMIT 1 to avoid loading all dataset images.
    """
    # Only set if logo is not already set
    if dataset.thumbnailUrl or dataset.logo_url or dataset.logo:
        return
    
    # Pick one random image directly in SQL - no need to load all images
    random_image = (
        db.query(models.Image)
        .filter(models.Image.dataset_id == dataset.id, models.Image.url.isnot(None))
        .order_by(func.random())
        .first()
    )
    
    if not random_image:
        return
    
    # Use the image URL as thumbnail (it will be served with ?thumb=300 for thumbnails)
    if random_image.url:
        # Use the full URL if it's relative
        if random_image.url.startswith('/'):
            dataset.thumbnailUrl = f"{base_url}{random_image.url}?thumb=300" if base_url else random_image.url
            dataset.logo_url = f"{base_url}{random_image.url}?thumb=300" if base_url else random_image.url
        else:
            dataset.thumbnailUrl = random_image.url
            dataset.logo_url = random_image.url
        db.commit()
        print(f"Set random image {random_image.file_name} as logo for dataset {dataset.id}")


@router.post("/datasets/", response_model=schemas.Dataset)
async def create_dataset(
    name: str = Form(...),
    description: str | None = Form(None),
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
            "project_id": project_id,
            "tags": json.dumps(parsed_tags)
        }
        db_dataset = models.Dataset(**dataset_data)
        if logo:
            logo_data = await logo.read()
            db_dataset.logo = logo_data  # Store full image in binary field
            mime_type = logo.content_type or "image/png"
            
            # Create optimized thumbnail instead of storing full base64
            thumbnail_url = _create_thumbnail(logo_data, mime_type, max_size=(200, 200))
            db_dataset.thumbnailUrl = thumbnail_url
            db_dataset.logo_url = thumbnail_url  # Use thumbnail for logo_url too
        db.add(db_dataset)
        db.commit()
        db.refresh(db_dataset)
        return db_dataset
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/datasets/", response_model=List[schemas.Dataset])
def read_datasets(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    from sqlalchemy import func
    
    datasets = db.query(models.Dataset).offset(skip).limit(limit).all()
    
    if not datasets:
        return []
    
    # Get all dataset IDs
    dataset_ids = [d.id for d in datasets]
    
    # Efficient batch count queries
    annotation_counts = dict(
        db.query(
            models.Annotation.dataset_id,
            func.count(models.Annotation.id)
        ).filter(
            models.Annotation.dataset_id.in_(dataset_ids)
        ).group_by(models.Annotation.dataset_id).all()
    )
    
    annotation_file_counts = dict(
        db.query(
            models.AnnotationFile.dataset_id,
            func.count(models.AnnotationFile.id)
        ).filter(
            models.AnnotationFile.dataset_id.in_(dataset_ids)
        ).group_by(models.AnnotationFile.dataset_id).all()
    )
    
    # Return datasets with corrected annotation counts
    result = []
    for dataset in datasets:
        result.append({
            "id": dataset.id,
            "name": dataset.name,
            "description": dataset.description,
            "tags": dataset.tags,
            "created_at": dataset.created_at,
            "updated_at": dataset.updated_at,
            "image_count": dataset.image_count,
            "annotation_count": annotation_counts.get(dataset.id, 0),
            "annotation_file_count": annotation_file_counts.get(dataset.id, 0),
            "project_id": dataset.project_id,
            "thumbnailUrl": dataset.thumbnailUrl,
            "logo_url": dataset.logo_url,
            "url": dataset.url
        })
    return result


@router.get("/datasets/{dataset_id}", response_model=schemas.Dataset)
def read_dataset(dataset_id: int, request: Request, db: Session = Depends(get_db)):
    from sqlalchemy import func
    
    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if dataset is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    # Set random image as logo if no logo is set and images exist
    base_url = str(request.base_url).rstrip('/')
    _set_random_image_as_logo(dataset, db, base_url)
    # Refresh to get updated logo
    db.refresh(dataset)
    
    # Efficient count queries
    annotation_count = db.query(func.count(models.Annotation.id)).filter(
        models.Annotation.dataset_id == dataset_id
    ).scalar() or 0
    
    annotation_file_count = db.query(func.count(models.AnnotationFile.id)).filter(
        models.AnnotationFile.dataset_id == dataset_id
    ).scalar() or 0
    
    # Return dataset with corrected annotation count
    return {
        "id": dataset.id,
        "name": dataset.name,
        "description": dataset.description,
        "tags": dataset.tags,
        "created_at": dataset.created_at,
        "updated_at": dataset.updated_at,
        "image_count": dataset.image_count,
        "annotation_count": annotation_count,
        "annotation_file_count": annotation_file_count,
        "project_id": dataset.project_id,
        "thumbnailUrl": dataset.thumbnailUrl,
        "logo_url": dataset.logo_url,
        "url": dataset.url
    }


@router.put("/datasets/{dataset_id}", response_model=schemas.Dataset)
async def update_dataset(
    dataset_id: int,
    name: str = Form(...),
    description: str | None = Form(None),
    tags: Optional[str] = Form(None),
    project_id: Optional[int] = Form(None),
    logo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    filesystem_moved = False
    put_old_pid: Optional[int] = None
    put_new_pid: Optional[int] = None
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        old_project_id = dataset.project_id
        if tags:
            dataset.tags = json.loads(tags)
        dataset.name = name
        dataset.description = description
        if project_id is not None and project_id != old_project_id:
            target_project = db.query(models.Project).filter(models.Project.id == project_id).first()
            if target_project is None:
                raise HTTPException(status_code=404, detail="Target project not found")
            moved_id_put = int(dataset_id)
            new_pid_put = int(project_id)
            if old_project_id is not None:
                did_move_put, fs_err_put = _filesystem_relocate_dataset_tree(
                    int(old_project_id),
                    new_pid_put,
                    moved_id_put,
                )
                if fs_err_put:
                    code = (
                        409 if "already exists" in fs_err_put.lower() else 500
                    )
                    raise HTTPException(status_code=code, detail=fs_err_put)
                if did_move_put:
                    filesystem_moved = True
                    put_old_pid = int(old_project_id)
                    put_new_pid = new_pid_put
            dataset.project_id = new_pid_put

            if old_project_id is not None:
                _apply_storage_url_rewrite_for_project_move(
                    db,
                    dataset,
                    dataset_id=moved_id_put,
                    old_project_id=int(old_project_id),
                    new_project_id=new_pid_put,
                )

            # Keep dataset groups consistent in the source project.
            if old_project_id is not None:
                groups = db.query(models.DatasetGroup).filter(
                    models.DatasetGroup.project_id == old_project_id
                ).all()
                for group in groups:
                    ids = group.datasets_list or []
                    if moved_id_put in ids:
                        group.datasets_list = [x for x in ids if int(x) != moved_id_put]
        if logo:
            logo_data = await logo.read()
            dataset.logo = logo_data  # Store full image in binary field
            mime_type = logo.content_type or "image/png"
            
            # Create optimized thumbnail instead of storing full base64
            thumbnail_url = _create_thumbnail(logo_data, mime_type, max_size=(200, 200))
            dataset.thumbnailUrl = thumbnail_url
            dataset.logo_url = thumbnail_url  # Use thumbnail for logo_url too
        db.commit()
        db.refresh(dataset)
        
        # Get annotation counts before detaching from session
        annotation_count = dataset.actual_annotation_count
        annotation_file_count = dataset.actual_annotation_file_count
        
        # Return a properly formatted response
        # Exclude base64 thumbnails from response to prevent hanging with large images
        # The thumbnail is small (200x200, ~10-20KB) but we still exclude it for consistency
        # Frontend can fetch it separately if needed, or we can include it since it's optimized
        return schemas.Dataset(
            id=dataset.id,
            name=dataset.name,
            description=dataset.description,
            tags=dataset.tags,
            created_at=dataset.created_at,
            updated_at=dataset.updated_at,
            image_count=dataset.image_count,
            annotation_count=annotation_count,
            annotation_file_count=annotation_file_count,
            annotation_files=[],  # Empty list to avoid serialization issues
            project_id=dataset.project_id,
            # Include thumbnail since it's now optimized (200x200, ~10-20KB max)
            thumbnailUrl=dataset.thumbnailUrl,
            logo_url=dataset.logo_url,
            url=dataset.url
        )
    except HTTPException as exc:
        db.rollback()
        if filesystem_moved and put_old_pid is not None and put_new_pid is not None:
            _, rev_put = _filesystem_relocate_dataset_tree(
                put_new_pid, put_old_pid, int(dataset_id)
            )
            if rev_put:
                logger.critical(
                    "update_dataset rollback: could not reverse filesystem move for dataset_id=%s: %s",
                    dataset_id,
                    rev_put,
                )
        raise exc
    except Exception as e:
        db.rollback()
        if filesystem_moved and put_old_pid is not None and put_new_pid is not None:
            _, rev_put = _filesystem_relocate_dataset_tree(
                put_new_pid, put_old_pid, int(dataset_id)
            )
            if rev_put:
                logger.critical(
                    "update_dataset rollback: could not reverse filesystem move for dataset_id=%s: %s",
                    dataset_id,
                    rev_put,
                )
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/datasets/{dataset_id}/augmented-datasets")
async def get_augmented_datasets(dataset_id: int, db: Session = Depends(get_db)):
    """
    Get datasets that were created by augmenting this dataset.
    """
    try:
        # Find augmentations where this dataset was a source
        augmentations = db.query(models.Augmentation).all()
        augmented_dataset_ids = []
        
        for aug in augmentations:
            if aug.source_dataset_ids and dataset_id in aug.source_dataset_ids:
                if aug.target_dataset_id:
                    augmented_dataset_ids.append(aug.target_dataset_id)
        
        # Get the actual datasets
        augmented_datasets = []
        for ds_id in augmented_dataset_ids:
            ds = db.query(models.Dataset).filter(models.Dataset.id == ds_id).first()
            if ds:
                augmented_datasets.append({
                    "id": ds.id,
                    "name": ds.name,
                    "description": ds.description
                })
        
        return {
            "augmented_datasets": augmented_datasets,
            "count": len(augmented_datasets)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/datasets/{dataset_id}")
async def delete_dataset(
    dataset_id: int, 
    delete_augmented: bool = False,
    db: Session = Depends(get_db)
):
    """
    Delete a dataset and all its associated data.
    This removes both the database records and all physical files.
    
    Args:
        dataset_id: ID of the dataset to delete
        delete_augmented: If True, also delete datasets that were created by augmenting this one
    """
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        project_id = dataset.project_id
        datasets_to_delete = [dataset_id]
        
        # If delete_augmented is True, find and include augmented datasets
        if delete_augmented:
            augmentations = db.query(models.Augmentation).all()
            for aug in augmentations:
                if aug.source_dataset_ids and dataset_id in aug.source_dataset_ids:
                    if aug.target_dataset_id and aug.target_dataset_id not in datasets_to_delete:
                        datasets_to_delete.append(aug.target_dataset_id)
        
        # Delete each dataset
        for ds_id in datasets_to_delete:
            ds = db.query(models.Dataset).filter(models.Dataset.id == ds_id).first()
            if not ds:
                continue
                
            # Delete physical files
            try:
                ds_project_id = ds.project_id
                
                # Delete from new projects structure
                dataset_dir = Path("projects") / str(ds_project_id) / str(ds_id)
                if dataset_dir.exists():
                    shutil.rmtree(dataset_dir)
                    print(f"Deleted dataset directory: {dataset_dir}")
                
                # Also check old data structure for backward compatibility
                old_images_dir = Path("data/images") / str(ds_id)
                old_annotations_dir = Path("data/annotations") / str(ds_id)
                
                if old_images_dir.exists():
                    shutil.rmtree(old_images_dir)
                
                if old_annotations_dir.exists():
                    shutil.rmtree(old_annotations_dir)
                    
            except Exception as file_error:
                print(f"Warning: Could not delete some physical files for dataset {ds_id}: {file_error}")
            
            # Remove from dataset groups
            groups = db.query(models.DatasetGroup).all()
            for group in groups:
                if group.datasets_list and ds_id in group.datasets_list:
                    updated_ids = [id for id in group.datasets_list if id != ds_id]
                    group.datasets_list = updated_ids
            
            # Delete augmentations where this is the target dataset
            target_augmentations = db.query(models.Augmentation).filter(
                models.Augmentation.target_dataset_id == ds_id
            ).all()
            for aug in target_augmentations:
                db.delete(aug)
            
            # Update augmentations that have this dataset in source_dataset_ids
            all_augmentations = db.query(models.Augmentation).all()
            for aug in all_augmentations:
                if aug.source_dataset_ids and ds_id in aug.source_dataset_ids:
                    updated_source_ids = [id for id in aug.source_dataset_ids if id != ds_id]
                    aug.source_dataset_ids = updated_source_ids
            
            # Delete the dataset record
            db.delete(ds)
        
        db.commit()
        
        deleted_count = len(datasets_to_delete)
        return {
            "success": True,
            "message": f"Successfully deleted {deleted_count} dataset(s)",
            "deleted_count": deleted_count,
            "deleted_ids": datasets_to_delete
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        import traceback
        print(f"Error deleting dataset: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/datasets/{dataset_id}/duplicate")
async def duplicate_dataset(dataset_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Start a background task to duplicate a dataset with all its associated data:
    - Dataset metadata
    - Image collections
    - Images (database records and physical files)
    - Annotation files (database records and physical files)
    - Annotations
    - Annotation classes
    
    Returns immediately with a task ID that can be used to track progress.
    """
    try:
        # Check if Celery is available
        USE_CELERY = os.environ.get('USE_CELERY', 'true').lower() == 'true'
        
        # Verify dataset exists
        original_dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if original_dataset is None:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Create a task record for tracking
        task = models.Task(
            name=f"Duplicate Dataset: {original_dataset.name}",
            description=f"Duplicating dataset '{original_dataset.name}' with all images, annotations, and metadata",
            task_type="dataset_duplication",
            status="pending",
            project_id=original_dataset.project_id,
            progress=0.0,
            task_metadata={
                "dataset_id": dataset_id,
                "dataset_name": original_dataset.name
            }
        )
        db.add(task)
        db.commit()
        db.refresh(task)
        
        # Start the background task
        if USE_CELERY:
            # Import here to avoid circular imports
            from app.tasks.dataset_tasks import duplicate_dataset_task
            
            # Use Celery for proper task queuing
            celery_task = duplicate_dataset_task.delay(task.id, dataset_id)
            
            # Store Celery task ID in metadata
            task.task_metadata = {
                **task.task_metadata,
                "celery_task_id": celery_task.id
            }
            db.commit()
            
            return {
                "success": True,
                "task_id": task.id,
                "message": "Dataset duplication started in background",
                "task": {
                    "id": task.id,
                    "name": task.name,
                    "status": task.status,
                    "progress": task.progress
                }
            }
        else:
            # Fallback: execute synchronously (not recommended for production)
            from app.tasks.dataset_tasks import duplicate_dataset_task
            
            result = duplicate_dataset_task(task.id, dataset_id)
            
            # Get the new dataset
            new_dataset_id = result.get("new_dataset_id")
            new_dataset = db.query(models.Dataset).filter(models.Dataset.id == new_dataset_id).first()
            
            return new_dataset
            
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/datasets/{dataset_id}/move", response_model=schemas.Dataset)
async def move_dataset(
    dataset_id: int,
    req: MoveDatasetRequest,
    db: Session = Depends(get_db),
):
    """
    Move a dataset to another project: updates DB, rewrites static image URLs,
    and physically relocates ``projects/<old_project>/<dataset_id>/`` (entire tree)
    under the target project folder when ``old_project_id`` is known and the tree exists.
    """
    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    target_project = db.query(models.Project).filter(models.Project.id == req.project_id).first()
    if not target_project:
        raise HTTPException(status_code=404, detail="Target project not found")

    old_project_id = dataset.project_id
    new_project_id = int(req.project_id)
    moved_id = int(dataset_id)

    if old_project_id == new_project_id:
        return dataset

    filesystem_moved = False
    if old_project_id is not None:
        did_move, fs_err = _filesystem_relocate_dataset_tree(
            int(old_project_id), new_project_id, moved_id
        )
        if fs_err:
            code = 409 if "already exists" in fs_err.lower() else 500
            raise HTTPException(status_code=code, detail=fs_err)
        filesystem_moved = bool(did_move)

    try:
        dataset.project_id = new_project_id
        dataset.updated_at = datetime.utcnow()

        if old_project_id is not None:
            _apply_storage_url_rewrite_for_project_move(
                db,
                dataset,
                dataset_id=moved_id,
                old_project_id=int(old_project_id),
                new_project_id=new_project_id,
            )
            groups = (
                db.query(models.DatasetGroup)
                .filter(models.DatasetGroup.project_id == old_project_id)
                .all()
            )
            for group in groups:
                ids = group.datasets_list or []
                if moved_id in ids:
                    group.datasets_list = [x for x in ids if int(x) != moved_id]

        db.commit()
        db.refresh(dataset)
        return dataset
    except Exception as exc:
        db.rollback()
        if filesystem_moved and old_project_id is not None:
            rev_ok, rev_err = _filesystem_relocate_dataset_tree(
                new_project_id, int(old_project_id), moved_id
            )
            if rev_err or not rev_ok:
                logger.critical(
                    "Dataset move DB failed after relocating files; rollback move may be incomplete "
                    "(dataset_id=%s new_project=%s old_project=%s): %s — reverse_error=%s",
                    moved_id,
                    new_project_id,
                    old_project_id,
                    exc,
                    rev_err,
                )
        logger.exception("move_dataset failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to move dataset: {exc}") from exc


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
        
        for file in files:
            # Check if file is an image by MIME type or file extension (for TIF files)
            clean_filename = os.path.basename(file.filename or "")
            is_image_mime = file.content_type and file.content_type.startswith('image/')
            is_tiff_file = clean_filename.lower().endswith(('.tif', '.tiff'))
            
            if not (is_image_mime or is_tiff_file):
                continue
            
            # Get or create default collection for this dataset (we need it for naming)
            default_collection = db.query(models.ImageCollection).filter(
                models.ImageCollection.dataset_id == dataset_id,
                models.ImageCollection.is_default == True
            ).first()
            
            if not default_collection:
                # Create default collection if it doesn't exist
                default_collection = models.ImageCollection(
                    dataset_id=dataset_id,
                    name="RGB Images",
                    description="Default image collection",
                    is_default=True
                )
                db.add(default_collection)
                db.flush()  # Get the ID without committing the full transaction
            
            # Check if file already exists on disk (across all collections) and generate unique filename
            original_path = dataset_dir / clean_filename
            final_filename = clean_filename
            counter = 1
            
            # Generate unique filename if file already exists on disk
            # Include collection name for better identification
            while original_path.exists():
                name, ext = os.path.splitext(clean_filename)
                if counter == 1:
                    # First conflict: use collection name
                    final_filename = f"{name}_{default_collection.name.replace(' ', '_')}{ext}"
                else:
                    # Subsequent conflicts: use collection name + number
                    final_filename = f"{name}_{default_collection.name.replace(' ', '_')}_{counter}{ext}"
                original_path = dataset_dir / final_filename
                counter += 1
            
            file_path = original_path
            
            try:
                contents = await file.read()
                
                # Extract image dimensions using Pillow
                width, height = 0, 0
                is_tiff_file = final_filename.lower().endswith(('.tif', '.tiff'))

                try:
                    img = Image.open(io.BytesIO(contents))
                    width, height = img.size
                    
                    # Handle multi-channel TIF images by converting to 3-channel PNG
                    if is_tiff_file and (img.mode not in ['RGB', 'L', 'P']): # L for grayscale, P for palette
                        print(f"DEBUG: Converting multi-channel TIF image: {final_filename}, mode: {img.mode}")
                        
                        if img.mode == 'RGBA' or img.mode == 'CMYK':
                            img = img.convert('RGB')
                        else:
                            # For other multi-band images, assume first 3 bands are R, G, B
                            bands = img.split()
                            if len(bands) >= 3:
                                img = Image.merge('RGB', (bands[0], bands[1], bands[2]))
                            else:
                                # Not enough bands to create RGB, maybe it's grayscale with alpha
                                img = img.convert('RGB') # Fallback

                        # Change filename to png and ensure it's unique
                        name, _ = os.path.splitext(final_filename)
                        png_filename = f"{name}.png"
                        
                        png_path = dataset_dir / png_filename
                        counter = 1
                        while png_path.exists():
                            png_filename = f"{name}_{counter}.png"
                            png_path = dataset_dir / png_filename
                            counter += 1
                        
                        final_filename = png_filename
                        file_path = png_path
                        
                        # Save as PNG
                        img_byte_arr = io.BytesIO()
                        img.save(img_byte_arr, format='PNG')
                        contents = img_byte_arr.getvalue()

                except Exception as img_error:
                    print(f"Warning: PIL failed for {final_filename}: {img_error}")
                    
                    # Fallback to OpenCV for problematic TIF files
                    if is_tiff_file:
                        try:
                            print(f"DEBUG: Trying OpenCV for {final_filename}")
                            # Save temp file for OpenCV to read
                            temp_path = dataset_dir / f"temp_{uuid.uuid4().hex[:8]}.tif"
                            with open(temp_path, 'wb') as temp_file:
                                temp_file.write(contents)
                            
                            # Read with OpenCV
                            cv_img = cv2.imread(str(temp_path), cv2.IMREAD_UNCHANGED)
                            
                            if cv_img is not None:
                                height, width = cv_img.shape[:2]
                                print(f"DEBUG: OpenCV read image with shape: {cv_img.shape}")
                                
                                # Convert multi-channel to RGB for multispectral imagery
                                if len(cv_img.shape) == 3:
                                    channels = cv_img.shape[2]
                                    print(f"DEBUG: Image has {channels} channels, dtype: {cv_img.dtype}")
                                    
                                    if channels == 4:
                                        # For DJI Mavic 3M: channels are Green, Red, Red Edge, NIR
                                        # Use NIR channel (channel 3) as grayscale for best visualization
                                        print("DEBUG: Processing DJI Mavic 3M multispectral image - using NIR channel")
                                        
                                        # Extract NIR channel (most informative for vegetation)
                                        nir_ch = cv_img[:, :, 3]     # Near Infrared channel
                                        
                                        # Normalize NIR channel to 0-255 range
                                        if nir_ch.dtype != np.uint8:
                                            nir_ch = nir_ch.astype(np.float64)
                                            ch_min, ch_max = nir_ch.min(), nir_ch.max()
                                            print(f"DEBUG: NIR channel range: {ch_min} to {ch_max}")
                                            
                                            # Handle signed data - clip negative values for NIR
                                            if ch_min < 0:
                                                print("DEBUG: Clipping negative NIR values (likely nodata)")
                                                nir_ch = np.clip(nir_ch, 0, None)  # Remove negative values
                                                ch_min = nir_ch.min()
                                                ch_max = nir_ch.max()
                                                print(f"DEBUG: After clipping negatives: {ch_min} to {ch_max}")
                                            
                                            # Apply percentile stretch for better contrast
                                            p2, p98 = np.percentile(nir_ch[nir_ch > 0], [2, 98])
                                            print(f"DEBUG: Using percentile stretch: {p2} to {p98}")
                                            nir_ch = np.clip(nir_ch, p2, p98)
                                            
                                            # Normalize to 0-255
                                            if p98 > p2:
                                                nir_ch = (nir_ch - p2) / (p98 - p2) * 255
                                            nir_ch = np.clip(nir_ch, 0, 255).astype(np.uint8)
                                        
                                        # Convert grayscale NIR to RGB for display
                                        cv_img = cv2.cvtColor(nir_ch, cv2.COLOR_GRAY2RGB)
                                        print(f"DEBUG: Created NIR grayscale RGB shape: {cv_img.shape}")
                                        
                                    elif channels > 4:
                                        # For other multi-channel images, take first 3 channels
                                        cv_img_rgb = cv_img[:, :, :3]
                                        
                                        # Normalize to 0-255 range if needed
                                        if cv_img_rgb.dtype != np.uint8:
                                            cv_img_rgb = cv_img_rgb.astype(np.float64)
                                            cv_img_rgb = (cv_img_rgb - cv_img_rgb.min()) / (cv_img_rgb.max() - cv_img_rgb.min()) * 255
                                            cv_img_rgb = cv_img_rgb.astype(np.uint8)
                                        
                                        # OpenCV uses BGR, we need RGB for PIL
                                        cv_img = cv2.cvtColor(cv_img_rgb, cv2.COLOR_BGR2RGB)
                                    elif channels == 3:
                                        # Standard BGR to RGB
                                        cv_img = cv2.cvtColor(cv_img, cv2.COLOR_BGR2RGB)
                                    elif channels == 1:
                                        # Grayscale to RGB
                                        cv_img = cv2.cvtColor(cv_img, cv2.COLOR_GRAY2RGB)
                                else:
                                    # Grayscale image
                                    cv_img = cv2.cvtColor(cv_img, cv2.COLOR_GRAY2RGB)
                                
                                # Convert to PNG
                                name, _ = os.path.splitext(final_filename)
                                png_filename = f"{name}.png"
                                
                                png_path = dataset_dir / png_filename
                                counter = 1
                                while png_path.exists():
                                    png_filename = f"{name}_{counter}.png"
                                    png_path = dataset_dir / png_filename
                                    counter += 1
                                
                                final_filename = png_filename
                                file_path = png_path
                                
                                # Save as PNG using OpenCV
                                cv2.imwrite(str(file_path), cv2.cvtColor(cv_img, cv2.COLOR_RGB2BGR))
                                
                                # Read the saved PNG file content for database storage
                                with open(file_path, 'rb') as png_file:
                                    contents = png_file.read()
                                
                                print(f"DEBUG: Successfully converted TIF to PNG: {final_filename} ({width}x{height})")
                            
                            # Clean up temp file
                            if temp_path.exists():
                                os.remove(temp_path)
                                
                        except Exception as cv_error:
                            print(f"Warning: OpenCV also failed for {final_filename}: {cv_error}")
                            # Clean up temp file in case of error
                            if 'temp_path' in locals() and temp_path.exists():
                                os.remove(temp_path)
                
                # Write the file with unique name
                with open(file_path, 'wb') as f:
                    f.write(contents)
                
                # Update URL to use the new structure with the final filename
                relative_url = f"/static/projects/{project_id}/{dataset_id}/images/{final_filename}"
                # Always create new image record since we generate unique filenames
                db_image = models.Image(
                    dataset_id=dataset_id,
                    collection_id=default_collection.id,  # Assign to default collection
                    file_name=final_filename,  # Use the unique filename
                    file_size=len(contents),
                    width=width,
                    height=height,
                    url=relative_url,
                    thumbnail_url=relative_url,
                    annotations_count=0
                )
                db.add(db_image)
                uploaded_images.append(db_image)
                print(f"Adding new image to default collection with unique name: {final_filename} ({width}x{height})")
                    
            except Exception as e:
                print(f"Error uploading file {file.filename}: {e}")
                continue
        
        # Update dataset image count (all images are new since we create unique filenames)
        current_image_count = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).count()
        dataset.image_count = current_image_count + len(uploaded_images)
        db.commit()
        
        # Set random image as logo if no logo is set
        _set_random_image_as_logo(dataset, db, base_url)
        
        # Prepare response with uploaded images
        response_images = []
        
        for img in uploaded_images:
            url = f"{base_url}{img.url}" if img.url.startswith('/') else img.url
            thumbnail_url = f"{base_url}{img.thumbnail_url}?thumb=300" if img.thumbnail_url.startswith('/') else img.thumbnail_url
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
                "overwritten": 0,  # We no longer overwrite, always create unique filenames
                "images": response_images
            }
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/datasets/{dataset_id}/video-extract")
async def extract_frames_from_video(
    request: Request,
    dataset_id: int,
    video: UploadFile = File(...),
    interval_seconds: float = Form(1.0),
    frame_step: int = Form(1),
    max_frames: int = Form(0),
    job_id: str = Form(""),
    collection_id: Optional[int] = Form(None),
    sequential_names: bool = Form(False),
    resize_width: int = Form(0),
    resize_height: int = Form(0),
    db: Session = Depends(get_db)
):
    """Upload a video file; extract frames at the given interval and add them as images to the dataset.

    When ``collection_id`` is provided the extracted frames are attached to
    that collection (must belong to this dataset). Otherwise frames are added
    to the dataset's default collection — the old behaviour.

    If the client sends a ``job_id`` form field, progress is published to an
    in-memory store so the UI can poll ``GET /video-extract/progress/{job_id}``
    while this request is still in flight.
    """
    def _progress(**fields):
        if job_id:
            _video_progress_set(job_id, dataset_id=dataset_id, **fields)

    _progress(stage="starting", extracted=0, total=0, percent=0.0)
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Validate video type
        name = (video.filename or "").lower()
        if not any(name.endswith(ext) for ext in (".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v", ".wmv")):
            raise HTTPException(status_code=400, detail="Invalid video file. Supported: MP4, AVI, MOV, MKV, WebM, M4V, WMV")

        if interval_seconds <= 0:
            raise HTTPException(status_code=400, detail="interval_seconds must be positive")
        if frame_step <= 0:
            raise HTTPException(status_code=400, detail="frame_step must be >= 1")
        if max_frames < 0:
            raise HTTPException(status_code=400, detail="max_frames must be >= 0")

        base_url = str(request.base_url).rstrip("/")
        project_id = dataset.project_id
        dataset_dir = Path("projects") / str(project_id) / str(dataset_id) / "images"
        dataset_dir.mkdir(parents=True, exist_ok=True)
        # When sequential_names is requested, frames are stored in a
        # collection-specific subdirectory so that two collections (e.g. RGB
        # and Thermo) can both have 0001.jpg without colliding on disk.
        # file_name in the DB stays "0001.jpg" for both so annotation
        # layer-switching can match frames across collections by name.
        _sequential_subdir: Optional[Path] = None  # resolved after collection is known

        # Pick the target collection. Prefer an explicit `collection_id` from
        # the client (the tab the user was viewing when they clicked Upload
        # Video) and fall back to the dataset's default collection. This
        # matches the image-upload flow, which already writes to whatever
        # collection tab is active.
        target_collection: Optional[models.ImageCollection] = None
        if collection_id is not None:
            target_collection = db.query(models.ImageCollection).filter(
                models.ImageCollection.id == collection_id,
                models.ImageCollection.dataset_id == dataset_id,
            ).first()
            if not target_collection:
                raise HTTPException(
                    status_code=400,
                    detail=f"collection_id {collection_id} does not belong to dataset {dataset_id}",
                )

        if target_collection is None:
            target_collection = db.query(models.ImageCollection).filter(
                models.ImageCollection.dataset_id == dataset_id,
                models.ImageCollection.is_default == True
            ).first()
        if not target_collection:
            target_collection = models.ImageCollection(
                dataset_id=dataset_id,
                name="RGB Images",
                description="Default image collection",
                is_default=True
            )
            db.add(target_collection)
            db.flush()

        # Now that target_collection is resolved, pin the write directory.
        if sequential_names:
            _sequential_subdir = dataset_dir / f"c{target_collection.id}"
            _sequential_subdir.mkdir(parents=True, exist_ok=True)

        _progress(stage="receiving", extracted=0, total=0, percent=0.0)
        # Stream the upload directly to disk — avoids holding the entire video in RAM.
        # For large files (GBs) this is the single biggest latency fix.
        video_base = os.path.splitext(os.path.basename(video.filename or "video"))[0]
        temp_video = dataset_dir / f"_temp_{uuid.uuid4().hex[:12]}_{os.path.basename(video.filename or 'video')}"
        try:
            with open(temp_video, "wb") as f:
                while True:
                    chunk = await video.read(1 << 20)  # 1 MiB chunks
                    if not chunk:
                        break
                    f.write(chunk)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to save video: {e}")

        cap = cv2.VideoCapture(str(temp_video))
        if not cap.isOpened():
            if temp_video.exists():
                temp_video.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail="Could not open video file")

        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total_source_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

        # CAP_PROP_FRAME_COUNT is unreliable for many MP4 files (H.265, VFR,
        # camera-recorded).  Fall back to the seek-to-end trick: MP4 stores a
        # frame index in the moov atom so the seek is O(1) and does not decode
        # any video data.
        if total_source_frames <= 0:
            try:
                cap.set(cv2.CAP_PROP_POS_AVI_RATIO, 1.0)
                total_source_frames = int(cap.get(cv2.CAP_PROP_POS_FRAMES) or 0)
            except Exception:
                total_source_frames = 0
            finally:
                cap.set(cv2.CAP_PROP_POS_FRAMES, 0)

        # Two sampling modes:
        # 1) frame_step > 1  => keep every Nth source frame (user-friendly for
        #    large skips like "every 100th frame").
        # 2) frame_step == 1 => fallback to time-based interval_seconds.
        frame_interval = (
            max(1, int(frame_step))
            if frame_step > 1
            else max(1, int(round(fps * interval_seconds)))
        )

        # Compute the expected number of output frames up front so the progress
        # bar has a real denominator.
        if total_source_frames > 0:
            projected_extractions = (total_source_frames + frame_interval - 1) // frame_interval
        else:
            projected_extractions = 0
        if max_frames > 0:
            if projected_extractions > 0:
                projected_extractions = min(projected_extractions, max_frames)
            else:
                projected_extractions = max_frames

        _progress(
            stage="extracting",
            extracted=0,
            total=projected_extractions,
            percent=0.0,
            fps=fps,
            frame_interval=frame_interval,
            source_frames=total_source_frames,
            frame_step=frame_step,
        )

        frame_idx = 0
        extracted = 0
        uploaded_images = []
        last_progress_push = time.time()

        try:
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                if max_frames > 0 and extracted >= max_frames:
                    break
                if frame_idx % frame_interval != 0:
                    frame_idx += 1
                    continue
                extracted += 1
                height, width = frame.shape[:2]
                if sequential_names:
                    # Use collection subdirectory — no collision avoidance needed
                    # because each collection has its own folder.
                    bare_filename = f"{extracted:04d}.jpg"
                    write_dir = _sequential_subdir  # type: ignore[assignment]
                    file_path = write_dir / bare_filename
                    final_filename = bare_filename  # stored in DB as-is for cross-collection matching
                    url_path = f"c{target_collection.id}/{bare_filename}"
                else:
                    final_filename = f"{video_base}_frame_{extracted:06d}.jpg"
                    write_dir = dataset_dir
                    file_path = write_dir / final_filename
                    counter = 1
                    while file_path.exists():
                        final_filename = f"{video_base}_frame_{extracted:06d}_{counter}.jpg"
                        file_path = write_dir / final_filename
                        counter += 1
                    url_path = final_filename
                # Resize frame if a target resolution was requested
                if resize_width > 0 and resize_height > 0:
                    frame = cv2.resize(frame, (resize_width, resize_height), interpolation=cv2.INTER_AREA)
                    height, width = resize_height, resize_width
                elif resize_width > 0:
                    scale = resize_width / width
                    frame = cv2.resize(frame, (resize_width, int(height * scale)), interpolation=cv2.INTER_AREA)
                    height, width = frame.shape[:2]
                elif resize_height > 0:
                    scale = resize_height / height
                    frame = cv2.resize(frame, (int(width * scale), resize_height), interpolation=cv2.INTER_AREA)
                    height, width = frame.shape[:2]
                # JPEG (quality 90) is ~8x faster to encode and 5-10x smaller than PNG
                success = cv2.imwrite(str(file_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 90])
                if not success:
                    continue
                # Get file size from stat — avoids re-reading the whole file just for len()
                file_size = file_path.stat().st_size
                relative_url = f"/static/projects/{project_id}/{dataset_id}/images/{url_path}"
                db_image = models.Image(
                    dataset_id=dataset_id,
                    collection_id=target_collection.id,
                    file_name=final_filename,
                    file_size=file_size,
                    width=int(width),
                    height=int(height),
                    url=relative_url,
                    thumbnail_url=relative_url,
                    annotations_count=0
                )
                db.add(db_image)
                uploaded_images.append(db_image)
                frame_idx += 1

                # Throttle progress updates — ~3 Hz is plenty for a smooth bar.
                now = time.time()
                if job_id and (now - last_progress_push >= 0.3):
                    pct = (extracted / projected_extractions * 100.0) if projected_extractions > 0 else 0.0
                    _progress(
                        stage="extracting",
                        extracted=extracted,
                        total=projected_extractions,
                        percent=min(99.0, pct),
                    )
                    last_progress_push = now
        finally:
            cap.release()
            if temp_video.exists():
                temp_video.unlink(missing_ok=True)

        _progress(stage="saving", extracted=extracted, total=projected_extractions or extracted, percent=99.0)

        # Avoid an extra COUNT(*) — image_count was already accurate before this upload.
        dataset.image_count = (dataset.image_count or 0) + len(uploaded_images)
        db.commit()
        _set_random_image_as_logo(dataset, db, base_url)

        response_images = []
        for img in uploaded_images:
            url = f"{base_url}{img.url}" if img.url.startswith("/") else img.url
            thumbnail_url = f"{base_url}{img.thumbnail_url}?thumb=300" if img.thumbnail_url.startswith("/") else img.thumbnail_url
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

        _progress(stage="done", extracted=extracted, total=extracted, percent=100.0, uploaded=len(uploaded_images))

        return {
            "success": True,
            "data": {
                "uploaded": len(uploaded_images),
                "overwritten": 0,
                "images": response_images
            }
        }
    except HTTPException as http_exc:
        _progress(stage="error", error=str(http_exc.detail), percent=0.0)
        raise
    except Exception as e:
        if db:
            db.rollback()
        _progress(stage="error", error=str(e), percent=0.0)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/datasets/{dataset_id}/video-extract/progress/{job_id}")
def get_video_extract_progress(dataset_id: int, job_id: str):
    """Poll the current progress for an in-flight ``/video-extract`` request.

    Returns ``{ stage, extracted, total, percent, ... }`` for known jobs or
    ``stage: "unknown"`` if the id hasn't been registered yet (e.g. the main
    request hasn't reached the progress-emitting code path).
    """
    entry = _video_progress_get(job_id)
    if entry is None:
        return {
            "success": True,
            "data": {"job_id": job_id, "stage": "unknown", "extracted": 0, "total": 0, "percent": 0.0},
        }
    if entry.get("dataset_id") not in (None, dataset_id):
        raise HTTPException(status_code=404, detail="Job does not belong to this dataset")
    return {"success": True, "data": entry}


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
                # Append ?thumb=300 for on-demand thumbnail generation
                thumbnail_url = f"{base_url}{thumbnail_url}?thumb=300"
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
        # Before deleting, clear any AnnotationFileImage references to this image
        try:
            from ..models import AnnotationFileImage
            db.query(AnnotationFileImage).filter(AnnotationFileImage.dataset_image_id == image_id).update({
                'dataset_image_id': None
            })
        except Exception:
            pass

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



@router.get("/datasets/{dataset_id}/annotations/{annotation_file_id}/coverage")
def get_annotation_file_coverage(dataset_id: int, annotation_file_id: str, db: Session = Depends(get_db)):
    """Return coverage info for a single annotation file: which images referenced are present/missing."""
    try:
        # Verify file
        af = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_file_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        if not af:
            raise HTTPException(status_code=404, detail="Annotation file not found")

        # Get all AnnotationFileImage entries for the file
        from ..models import AnnotationFileImage
        afi_list = db.query(AnnotationFileImage).filter(AnnotationFileImage.annotation_file_id == annotation_file_id).all()

        total_referenced = len(afi_list)
        present = []
        missing = []
        for afi in afi_list:
            if afi.dataset_image_id:
                # Ensure the referenced image still exists
                img = db.query(models.Image).filter(models.Image.id == afi.dataset_image_id, models.Image.dataset_id == dataset_id).first()
                if img:
                    present.append({"image_id": img.id, "file_name": img.file_name})
                else:
                    missing.append({"coco_image_id": afi.coco_image_id, "file_name": afi.file_name})
            else:
                missing.append({"coco_image_id": afi.coco_image_id, "file_name": afi.file_name})

        return {
            "success": True,
            "data": {
                "annotation_file_id": annotation_file_id,
                "total_referenced_images": total_referenced,
                "present_count": len(present),
                "missing_count": len(missing),
                "present": present,
                "missing": missing
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in get_annotation_file_coverage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/datasets/{dataset_id}/annotations/{annotation_file_id}/collection-counts")
def get_annotation_file_collection_counts(
    dataset_id: int,
    annotation_file_id: str,
    db: Session = Depends(get_db),
):
    """Return annotation counts per image collection for a given annotation file."""
    try:
        af = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_file_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        if not af:
            raise HTTPException(status_code=404, detail="Annotation file not found")

        collections = db.query(models.ImageCollection).filter(
            models.ImageCollection.dataset_id == dataset_id
        ).all()

        grouped_rows = (
            db.query(
                models.Image.collection_id,
                func.count(models.Annotation.id).label("annotation_count"),
            )
            .join(models.Image, models.Image.id == models.Annotation.image_id)
            .filter(
                models.Annotation.annotation_file_id == annotation_file_id,
                models.Image.dataset_id == dataset_id,
            )
            .group_by(models.Image.collection_id)
            .all()
        )

        grouped_map = {
            int(row.collection_id): int(row.annotation_count or 0)
            for row in grouped_rows
            if row.collection_id is not None
        }

        return {
            "success": True,
            "data": [
                {
                    "collection_id": int(col.id),
                    "collection_name": col.name,
                    "annotation_count": grouped_map.get(int(col.id), 0),
                }
                for col in collections
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in get_annotation_file_collection_counts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/datasets/{dataset_id}/annotations/coverage")
def get_dataset_annotations_coverage(dataset_id: int, db: Session = Depends(get_db)):
    """Return coverage summary for all annotation files in a dataset."""
    try:
        files = db.query(models.AnnotationFile).filter(models.AnnotationFile.dataset_id == dataset_id).order_by(models.AnnotationFile.created_at.desc()).all()
        result = []
        from ..models import AnnotationFileImage
        for f in files:
            afi_list = db.query(AnnotationFileImage).filter(AnnotationFileImage.annotation_file_id == f.id).all()
            total = len(afi_list)
            present_count = 0
            for afi in afi_list:
                if afi.dataset_image_id:
                    img = db.query(models.Image).filter(models.Image.id == afi.dataset_image_id, models.Image.dataset_id == dataset_id).first()
                    if img:
                        present_count += 1
            result.append({
                "annotation_file_id": f.id,
                "name": f.name,
                "total_referenced_images": total,
                "present_count": present_count,
                "missing_count": total - present_count
            })

        return {"success": True, "data": result}

    except Exception as e:
        print(f"Error in get_dataset_annotations_coverage: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/datasets/{dataset_id}/import-annotations")
async def import_annotations(
    dataset_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Import annotations from a file (COCO format) - Database storage only"""
    print(f"DEBUG: import_annotations endpoint called for dataset {dataset_id}, file: {file.filename}")
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
        from .annotation_db import process_coco_annotation_file, detect_annotation_type
        
        # Detect annotation type from COCO data
        detected_type = detect_annotation_type(coco_data)
        
        # Create database record for the annotation file
        annotation_file_record = models.AnnotationFile(
            id=random_id,
            dataset_id=dataset_id,
            name=file.filename,
            format='COCO',
            type=detected_type,  # Set type based on detection
            file_size=len(contents),
            annotation_count=imported_count,  # Set initial count from COCO data
            image_count=image_count,  # Set initial count from COCO data
            category_count=category_count,  # Set initial count from COCO data
            is_processed=False,
            processing_status="pending"
        )
        
        db.add(annotation_file_record)
        db.commit()
        
        # Save the file to disk for the background task to process
        import os
        os.makedirs(f'/app/projects/{dataset_id}', exist_ok=True)
        file_path = f'/app/projects/{dataset_id}/{random_id}.json'
        with open(file_path, 'w') as f:
            json.dump(coco_data, f)
        
        print(f"DEBUG: About to add background task for annotation file {random_id}")
        # Process the file in the background using a fresh DB session
        # Do not pass the request-scoped session `db` into background tasks
        background_tasks.add_task(
            process_coco_annotation_file,
            random_id,
            coco_data
        )
        print(f"DEBUG: Background task added for annotation file {random_id}")
        
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


@router.post("/datasets/{dataset_id}/create-annotation-task")
async def create_annotation_processing_task(
    dataset_id: int,
    file: UploadFile = File(...),
    annotation_type: Optional[str] = Form(None),
    task_name: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """Create a background task for annotation processing"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Read the uploaded file
        contents = await file.read()
        
        # Generate a random ID for the annotation file
        import uuid
        file_id = str(uuid.uuid4())[:8]
        
        # Validate file format
        try:
            coco_data = json.loads(contents.decode('utf-8'))
            if not all(key in coco_data for key in ['images', 'annotations', 'categories']):
                raise HTTPException(status_code=400, detail="Invalid COCO format - missing required fields")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Only COCO JSON format is supported")
        
        # Get basic statistics and detect annotation type
        annotation_count = len(coco_data.get('annotations', []))
        image_count = len(coco_data.get('images', []))
        category_count = len(coco_data.get('categories', []))
        
        # Detect annotation type from the COCO data
        from .annotation_db import detect_annotation_type
        detected_type = detect_annotation_type(coco_data)
        
        # Create the annotation file record (initially not processed)
        annotation_file_record = models.AnnotationFile(
            id=file_id,
            dataset_id=dataset_id,
            name=file.filename,
            format='COCO',
            type=detected_type,  # Set type based on detection
            file_size=len(contents),
            annotation_count=annotation_count,
            image_count=image_count,
            category_count=category_count,
            is_processed=False,
            processing_status="pending"
        )
        
        db.add(annotation_file_record)
        db.flush()  # Get the ID without committing
        
        # Create the task record
        task_name_final = task_name or f"Process annotation file: {file.filename}"
        task_description = f"Processing annotation file '{file.filename}' for dataset '{dataset.name}' ({annotation_count} annotations, {image_count} images)"
        
        task = models.Task(
            name=task_name_final,
            description=task_description,
            task_type='annotation_processing',
            status='pending',
            progress=0,
            project_id=dataset.project_id,
            task_metadata={
                'dataset_id': dataset_id,
                'file_id': file_id,
                'filename': file.filename,
                'annotation_type': annotation_type,
                'file_size': len(contents),
                'annotation_count': annotation_count,
                'image_count': image_count,
                'category_count': category_count,
                'coco_data': coco_data  # Store the actual data for processing
            }
        )
        
        db.add(task)
        db.commit()
        
        # Save the task ID before the task object becomes detached
        task_id = task.id
        
        # TODO: Here you would normally dispatch the task to a task queue (Celery, RQ, etc.)
        # For now, we'll simulate immediate background processing
        from .annotation_db import process_coco_annotation_file_task
        import threading
        
        def process_task():
            """Run processing in a separate thread with its own DB session."""
            session = SessionLocal()
            try:
                # Reload the task within this session
                task_db = session.query(models.Task).filter(models.Task.id == task_id).first()
                if task_db:
                    task_db.status = 'running'
                    task_db.started_at = datetime.utcnow()
                    task_db.progress = 10
                    session.commit()
                
                # Process the annotation file using the same dedicated session
                process_coco_annotation_file_task(
                    task_id=task_id,
                    file_id=file_id,
                    coco_data=coco_data,
                    db=session
                )
                
                # Mark as completed
                task_db = session.query(models.Task).filter(models.Task.id == task_id).first()
                if task_db:
                    task_db.status = 'completed'
                    task_db.completed_at = datetime.utcnow()
                    task_db.progress = 100
                    session.commit()
            except Exception as e:
                # Mark as failed
                task_db = session.query(models.Task).filter(models.Task.id == task_id).first()
                if task_db:
                    task_db.status = 'failed'
                    task_db.completed_at = datetime.utcnow()
                    task_db.error_message = str(e)
                    session.commit()
            finally:
                session.close()

        # Start background processing thread
        processing_thread = threading.Thread(target=process_task)
        processing_thread.daemon = True
        processing_thread.start()

        return {
            "success": True,
            "data": {
                "task_id": task_id,
                "file_id": file_id,
                "status": "pending",
                "message": f"Annotation processing task created for '{file.filename}'"
            }
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to create annotation processing task: {str(e)}")


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
        
        # Get all annotation file records from database, ordered by creation date (newest first)
        db_annotation_files = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.dataset_id == dataset_id
        ).order_by(models.AnnotationFile.created_at.desc()).all()
        
        annotation_files = []
        for db_file in db_annotation_files:
            # Calculate correct image coverage from AnnotationFileImage table
            from ..models import AnnotationFileImage
            afi_list = db.query(AnnotationFileImage).filter(AnnotationFileImage.annotation_file_id == db_file.id).all()
            
            total_referenced_images = len(afi_list)
            present_count = sum(1 for afi in afi_list if afi.dataset_image_id is not None)
            missing_count = total_referenced_images - present_count
            
            file_info = {
                "id": db_file.id,
                "name": db_file.name,
                "format": db_file.format or 'COCO',
                "type": db_file.type,
                "tags": db_file.tags,
                "size": db_file.file_size or 0,
                "annotation_count": db_file.annotation_count,
                "image_count": total_referenced_images,  # Total images referenced in annotation file
                "image_coverage": {
                    "total_referenced": total_referenced_images,
                    "present": present_count,
                    "missing": missing_count
                },
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


@router.get("/datasets/{dataset_id}/annotations/{annotation_id}")
async def get_dataset_annotation(
    dataset_id: int,
    annotation_id: str,
    db: Session = Depends(get_db)
):
    """Get a specific annotation file metadata"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Get the specific annotation file record from database
        db_annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if not db_annotation_file:
            raise HTTPException(status_code=404, detail="Annotation file not found")
        
        file_info = {
            "id": db_annotation_file.id,
            "name": db_annotation_file.name,
            "file_name": db_annotation_file.name,  # Add file_name for compatibility
            "format": db_annotation_file.format or 'COCO',
            "type": db_annotation_file.type,
            "tags": db_annotation_file.tags,
            "size": db_annotation_file.file_size or 0,
            "annotation_count": db_annotation_file.annotation_count,
            "image_count": db_annotation_file.image_count,
            "category_count": db_annotation_file.category_count,
            "is_processed": db_annotation_file.is_processed,
            "processing_status": db_annotation_file.processing_status,
            "error_message": db_annotation_file.error_message,
            "created_at": db_annotation_file.created_at.isoformat(),
            "modified_at": db_annotation_file.updated_at.isoformat(),
        }
        
        return {
            "success": True,
            "data": file_info
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in get_dataset_annotation: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get annotation: {str(e)}")


@router.get("/datasets/{dataset_id}/annotations/summary")
async def get_dataset_annotations_summary(
    dataset_id: int,
    db: Session = Depends(get_db)
):
    """Get fast summary of annotation data (counts only) for a dataset"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Fast aggregated queries using COUNT()
        from sqlalchemy import func
        
        # Get annotation file count and total annotation count efficiently
        file_count_result = db.query(func.count(models.AnnotationFile.id)).filter(
            models.AnnotationFile.dataset_id == dataset_id
        ).scalar()
        
        total_annotations_result = db.query(func.count(models.Annotation.id)).filter(
            models.Annotation.dataset_id == dataset_id
        ).scalar()
        
        # Get annotations per file efficiently
        files_with_counts = db.query(
            models.AnnotationFile.id,
            models.AnnotationFile.name,
            models.AnnotationFile.annotation_count,
            models.AnnotationFile.image_count,
            models.AnnotationFile.processing_status,
            func.count(models.Annotation.id).label("actual_count")
        ).outerjoin(
            models.Annotation, models.AnnotationFile.id == models.Annotation.annotation_file_id
        ).filter(
            models.AnnotationFile.dataset_id == dataset_id
        ).group_by(models.AnnotationFile.id).all()
        
        file_summaries = []
        for file_data in files_with_counts:
            file_summaries.append({
                "id": file_data.id,
                "name": file_data.name,
                "stored_count": file_data.annotation_count or 0,
                "actual_count": file_data.actual_count or 0,
                "image_count": file_data.image_count or 0,
                "processing_status": file_data.processing_status
            })
        
        return {
            "success": True,
            "data": {
                "dataset_id": dataset_id,
                "file_count": file_count_result or 0,
                "total_annotations": total_annotations_result or 0,
                "files": file_summaries
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in get_dataset_annotations_summary: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get annotation summary: {str(e)}")


@router.get("/datasets/{dataset_id}/annotations/list")
async def get_dataset_annotations_list(
    dataset_id: int,
    page: int = 1,
    limit: int = 1000,
    annotation_file_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get individual annotations from annotation files with pagination (database-only)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Build query with optional filtering by annotation file
        query = db.query(models.Annotation).filter(models.Annotation.dataset_id == dataset_id)
        
        if annotation_file_id:
            query = query.filter(models.Annotation.annotation_file_id == annotation_file_id)
        
        # Get total count efficiently
        total_count = query.count()
        
        # Apply pagination
        offset = (page - 1) * limit
        annotations = query.offset(offset).limit(limit).all()
        
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
        
        print(f"Found {len(all_annotations)} annotations (page {page}/{(total_count + limit - 1) // limit}) in dataset {dataset_id}")
        if all_annotations and page == 1:  # Only log sample IDs on first page
            sample_ids = [str(ann['id']) for ann in all_annotations[:5]]
            print(f"Sample annotation IDs: {sample_ids}")
        
        return {
            "success": True,
            "data": all_annotations,
            "pagination": {
                "page": page,
                "limit": limit,
                "total": total_count,
                "pages": (total_count + limit - 1) // limit
            }
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
    include_images: bool = True,
    include_annotations: bool = True,
    db: Session = Depends(get_db),
):
    """Get the content of a specific annotation file with performance optimizations (database-only).

    Uses a fixed max inline size (not a ``limit`` query param) so clients cannot accidentally
    trigger the "large file" branch (e.g. ``?limit=100`` meant for another API).
    Fetches annotations in pages so files with >10k rows still return full COCO JSON.
    """
    # Max annotations we will ever stringify into one JSON payload for this endpoint.
    INLINE_CONTENT_MAX_ANNOTATIONS = 200_000
    FETCH_PAGE_SIZE = 10_000

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

        live_annotation_count = (
            db.query(func.count(models.Annotation.id))
            .filter(models.Annotation.annotation_file_id == annotation_id)
            .scalar()
            or 0
        )

        # Import still running: avoid empty COCO + confusing client errors
        if (
            live_annotation_count == 0
            and annotation_file.processing_status in ("pending", "processing")
        ):
            return {
                "success": True,
                "data": {
                    "content": None,
                    "filename": annotation_file.name,
                    "format": "COCO",
                    "size": 0,
                    "source": "database",
                    "is_processing": True,
                    "processing_status": annotation_file.processing_status,
                    "message": "Annotation import is still processing. Wait until it completes, then open again.",
                },
            }

        # Too large to inline — use paginated /annotations/.../data from the client
        if live_annotation_count > INLINE_CONTENT_MAX_ANNOTATIONS:
            return {
                "success": True,
                "data": {
                    "content": None,
                    "filename": annotation_file.name,
                    "format": "COCO",
                    "size": 0,
                    "source": "database",
                    "is_large": True,
                    "total_annotations": live_annotation_count,
                    "message": (
                        f"This file has about {live_annotation_count:,} annotations — too many to download as one JSON file. "
                        "Open it in the segmentation editor: it loads each image from the database automatically."
                    ),
                },
            }
        
        # Generate COCO format from database with limited queries
        from .annotation_db import get_annotation_data, get_annotation_classes
        
        # Get classes first (usually small)
        classes_response = await get_annotation_classes(dataset_id, annotation_id, db)
        
        # Paginate through all annotations (direct router calls — not HTTP; page size can exceed 1000)
        all_annotation_rows: list = []
        page = 1
        annotations_response = None
        while True:
            annotations_response = await get_annotation_data(
                dataset_id, annotation_id, None, page, FETCH_PAGE_SIZE, None, db
            )
            if not annotations_response["success"]:
                raise HTTPException(status_code=500, detail="Failed to retrieve annotation data")
            chunk = annotations_response["data"]["annotations"]
            all_annotation_rows.extend(chunk)
            pagination = annotations_response["data"].get("pagination") or {}
            total_pages = int(pagination.get("pages") or 1)
            if page >= total_pages or not chunk:
                break
            page += 1
        
        if not classes_response["success"]:
            raise HTTPException(status_code=500, detail="Failed to retrieve annotation data")
        
        project_name = None
        if dataset.project_id:
            project = db.query(models.Project).filter(models.Project.id == dataset.project_id).first()
            project_name = project.name if project else None
        dataset_name = dataset.name or f"Dataset {dataset_id}"
        
        # Build COCO format efficiently
        coco_data = {
            "info": {
                "description": f"Annotations for dataset {dataset_name}",
                "version": "1.0",
                "year": datetime.utcnow().year,
                "contributor": "LAI",
                "date_created": annotation_file.created_at.isoformat() if annotation_file.created_at else None,
                "project_name": project_name,
                "dataset_name": dataset_name
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
        
        # Process images and annotations more efficiently
        image_id_map = {}  # Initialize outside the if block
        if include_images or include_annotations:
            # Get unique image IDs from annotations to minimize image queries
            image_ids = set()
            for ann in all_annotation_rows:
                image_ids.add(ann["imageId"])
            
            # Batch load images
            if include_images and image_ids:
                images = db.query(models.Image).filter(
                    models.Image.id.in_(list(image_ids))
                ).all()
                
                for i, image in enumerate(images):
                    coco_image_id = i + 1
                    image_id_map[image.id] = coco_image_id
                    coco_data["images"].append({
                        "id": coco_image_id,
                        "file_name": image.file_name,
                        "width": image.width or 1,
                        "height": image.height or 1
                    })
            elif image_ids:
                # Load images even if not including in output, for bbox conversion
                images = db.query(models.Image).filter(
                    models.Image.id.in_(list(image_ids))
                ).all()
                
                for i, image in enumerate(images):
                    coco_image_id = i + 1
                    image_id_map[image.id] = coco_image_id
                    if include_images:
                        coco_data["images"].append({
                            "id": coco_image_id,
                            "file_name": image.file_name,
                            "width": image.width or 1,
                            "height": image.height or 1
                        })
            
            # Add annotations
            if include_annotations:
                # Build image dimension map for coordinate conversion
                image_dims = {}
                if image_ids:
                    images_for_dims = db.query(models.Image).filter(
                        models.Image.id.in_(list(image_ids))
                    ).all()
                    for img in images_for_dims:
                        image_dims[img.id] = (img.width or 1, img.height or 1)
                
                for ann in all_annotation_rows:
                    image_id = ann["imageId"]
                    
                    # Get image dimensions for this annotation
                    img_width, img_height = image_dims.get(image_id, (1, 1))
                    
                    # Build base annotation (use primary key when cocoAnnotationId is null)
                    coco_ann = {
                        "id": ann.get("cocoAnnotationId") if ann.get("cocoAnnotationId") is not None else ann["id"],
                        "image_id": image_id_map.get(image_id, 1) if include_images else ann["imageId"],
                        "category_id": category_id_map.get(ann["className"], 1)
                    }

                    # Handle segmentation - coordinates are already stored as pixels.
                    # COCO expects either:
                    #   - polygon list: [[x1,y1,x2,y2,...], ...]
                    #   - RLE dict
                    # Stored data may be flat [x1,y1,...] or nested [[...]].
                    seg_raw = ann.get("segmentation")
                    if seg_raw:
                        if isinstance(seg_raw, dict):
                            # RLE payload
                            coco_ann["segmentation"] = seg_raw
                        elif isinstance(seg_raw, list):
                            first = seg_raw[0] if len(seg_raw) > 0 else None
                            if isinstance(first, (int, float)):
                                # Flat polygon -> wrap once for COCO polygon format
                                if len(seg_raw) >= 6:
                                    coco_ann["segmentation"] = [seg_raw]
                            else:
                                # Already polygon list; keep only valid polygons
                                valid_polys = [
                                    poly
                                    for poly in seg_raw
                                    if isinstance(poly, list) and len(poly) >= 6
                                ]
                                if valid_polys:
                                    coco_ann["segmentation"] = valid_polys

                    # Handle bbox - coordinates are stored as pixels, use directly
                    if ann.get("bbox") and len(ann["bbox"]) == 4:
                        coco_ann["bbox"] = ann["bbox"]
                        coco_ann["area"] = ann.get("area") if ann.get("area") is not None else (coco_ann["bbox"][2] * coco_ann["bbox"][3])
                        coco_ann["iscrowd"] = 0
                    elif coco_ann.get("segmentation"):
                        # Mask-only: ensure area/iscrowd and bbox from polygon bounds
                        coco_ann["area"] = ann.get("area") or 0
                        coco_ann["iscrowd"] = 0
                        if isinstance(coco_ann["segmentation"], list):
                            flat = [x for p in coco_ann["segmentation"] for x in p]
                            if len(flat) >= 4:
                                xs, ys = flat[0::2], flat[1::2]
                                min_x, max_x = min(xs), max(xs)
                                min_y, max_y = min(ys), max(ys)
                                coco_ann["bbox"] = [min_x, min_y, max_x - min_x, max_y - min_y]

                    coco_data["annotations"].append(coco_ann)
        
        content = json.dumps(coco_data, indent=2)
        
        return {
            "success": True,
            "data": {
                "content": content,
                "filename": annotation_file.name,
                "format": "COCO",
                "size": len(content),
                "source": "database",
                "is_large": False,
                "annotation_count": len(coco_data["annotations"]),
                "image_count": len(coco_data["images"]),
                "category_count": len(coco_data["categories"])
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in get_dataset_annotation_content: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get annotation content: {str(e)}")


@router.post("/datasets/{dataset_id}/annotations/{annotation_id}/duplicate")
async def duplicate_annotation_file(
    dataset_id: int,
    annotation_id: str,
    db: Session = Depends(get_db)
):
    """Duplicate an annotation file with all its annotations (database-only)"""
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Find the original annotation file
        original_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if not original_file:
            raise HTTPException(status_code=404, detail="Annotation file not found")
        
        # Generate unique name for the copy
        base_name = original_file.name.rsplit('.', 1)[0] if '.' in original_file.name else original_file.name
        extension = '.' + original_file.name.rsplit('.', 1)[1] if '.' in original_file.name else ''
        
        copy_index = 1
        new_name = f"{base_name}_copy{extension}"
        
        while db.query(models.AnnotationFile).filter(
            models.AnnotationFile.dataset_id == dataset_id,
            models.AnnotationFile.name == new_name
        ).first():
            copy_index += 1
            new_name = f"{base_name}_copy{copy_index}{extension}"
        
        # Create new annotation file entry
        import uuid
        new_file_id = str(uuid.uuid4())
        
        new_file = models.AnnotationFile(
            id=new_file_id,
            dataset_id=dataset_id,
            name=new_name,
            format=original_file.format,
            type=original_file.type,
            annotation_count=original_file.annotation_count,
            image_count=original_file.image_count,
            category_count=original_file.category_count,
            file_size=original_file.file_size,
            statistics=original_file.statistics,
            _tags=original_file.tags[:] if original_file.tags else [],
            processing_status="completed",
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow()
        )
        db.add(new_file)
        db.flush()
        
        # Copy all annotations
        original_annotations = db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == annotation_id
        ).all()
        
        for orig_ann in original_annotations:
            new_annotation = models.Annotation(
                annotation_file_id=new_file_id,
                image_id=orig_ann.image_id,
                dataset_id=dataset_id,
                category_id=orig_ann.category_id,
                category=orig_ann.category,
                segmentation=orig_ann.segmentation[:] if orig_ann.segmentation else None,
                bbox=orig_ann.bbox[:] if orig_ann.bbox else None,
                area=orig_ann.area
            )
            db.add(new_annotation)
        
        # Copy annotation classes
        original_classes = db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_id
        ).all()
        
        for orig_class in original_classes:
            new_class = models.AnnotationClass(
                annotation_file_id=new_file_id,
                class_name=orig_class.class_name,
                category_id=orig_class.category_id,
                count=orig_class.count,
                color=orig_class.color,
                opacity=orig_class.opacity
            )
            db.add(new_class)
        
        # Copy annotation file images mapping
        original_images = db.query(models.AnnotationFileImage).filter(
            models.AnnotationFileImage.annotation_file_id == annotation_id
        ).all()
        
        for orig_img in original_images:
            new_img = models.AnnotationFileImage(
                annotation_file_id=new_file_id,
                coco_image_id=orig_img.coco_image_id,
                file_name=orig_img.file_name,
                dataset_image_id=orig_img.dataset_image_id,
                width=orig_img.width,
                height=orig_img.height
            )
            db.add(new_img)
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Annotation file duplicated successfully",
            "new_file_id": new_file_id,
            "new_file_name": new_name,
            "annotation_count": len(original_annotations)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error in duplicate_annotation_file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to duplicate annotation file: {str(e)}")


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
        
        # Extract statistics if provided in the uploaded content
        statistics = content_json.get('statistics', None)
        
        # Let process_coco_annotation_file clear and re-insert annotations (it uses its own
        # session and commit). Do not delete here or the main session's commit would wipe
        # the data that process_coco_annotation_file just wrote.
        from .annotation_db import process_coco_annotation_file
        await process_coco_annotation_file(
            annotation_id, content_json
        )
        
        # Update annotation file metadata
        annotation_file.annotation_count = annotation_count
        annotation_file.image_count = image_count
        annotation_file.category_count = category_count
        annotation_file.file_size = len(contents)
        annotation_file.statistics = statistics  # Save statistics to database
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


@router.put("/datasets/{dataset_id}/annotations/{annotation_id}/class/rename")
async def rename_annotation_class(
    dataset_id: int,
    annotation_id: str,
    body: dict,
    db: Session = Depends(get_db)
):
    """Rename a class in an annotation file (updates all annotations and class stats). Used by both Dataset annotations view and Edit Dataset."""
    old_class_name = (body.get("old_class_name") or body.get("oldClassName") or "").strip()
    new_class_name = (body.get("new_class_name") or body.get("newClassName") or "").strip()
    if not old_class_name or not new_class_name:
        raise HTTPException(status_code=400, detail="old_class_name and new_class_name required")
    if old_class_name == new_class_name:
        return {"success": True, "message": "No change"}

    try:
        annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        if not annotation_file:
            raise HTTPException(status_code=404, detail="Annotation file not found")

        # Update all annotations: category old -> new
        updated = db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == annotation_id,
            models.Annotation.category == old_class_name
        ).update({"category": new_class_name}, synchronize_session=False)

        # Update or merge AnnotationClass
        old_class = db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_id,
            models.AnnotationClass.class_name == old_class_name
        ).first()
        new_class = db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_id,
            models.AnnotationClass.class_name == new_class_name
        ).first()
        if old_class:
            if new_class:
                new_class.count = (new_class.count or 0) + (old_class.count or 0)
                db.delete(old_class)
            else:
                old_class.class_name = new_class_name
        # if no old_class, nothing to rename

        annotation_file.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(annotation_file)
        # Return updated class list so frontend can show correct counts (avoid 0/NaN%)
        classes = db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_id
        ).all()
        classes_data = [
            {
                "className": c.class_name,
                "count": c.count if c.count is not None else 0,
                "color": c.color or "#ea384c",
                "opacity": c.opacity if c.opacity is not None else 0.25,
                "categoryId": c.category_id,
            }
            for c in classes
        ]
        return {
            "success": True,
            "message": f"Renamed class '{old_class_name}' to '{new_class_name}'",
            "annotations_updated": updated,
            "classes": classes_data,
        }
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error in rename_annotation_class: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/datasets/{dataset_id}/annotations/{annotation_id}/class/{class_name}")
async def delete_annotation_class(
    dataset_id: int,
    annotation_id: str,
    class_name: str,
    db: Session = Depends(get_db)
):
    """Delete all annotations for a specific class from an annotation file"""
    try:
        # Validate annotation file exists
        annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if not annotation_file:
            raise HTTPException(status_code=404, detail="Annotation file not found")

        # Debug: Check what classes exist
        existing_annotations = db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == annotation_id
        ).all()
        unique_categories = set(ann.category for ann in existing_annotations if ann.category)
        print(f"DEBUG: Attempting to delete class '{class_name}' from annotation file '{annotation_id}'")
        print(f"DEBUG: Existing categories in file: {unique_categories}")
        print(f"DEBUG: Total annotations in file: {len(existing_annotations)}")
        
        # Delete annotations with this class/category
        deleted_count = db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == annotation_id,
            models.Annotation.category == class_name
        ).delete(synchronize_session=False)
        
        print(f"DEBUG: Deleted {deleted_count} annotations")
        
        # Delete the class entry itself
        db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_id,
            models.AnnotationClass.class_name == class_name
        ).delete(synchronize_session=False)
        
        # Update annotation file metadata
        remaining_annotation_count = db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == annotation_id
        ).count()
        
        remaining_category_count = db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_id
        ).count()
        
        annotation_file.annotation_count = remaining_annotation_count
        annotation_file.category_count = remaining_category_count
        annotation_file.updated_at = datetime.utcnow()
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Deleted {deleted_count} annotations for class '{class_name}'",
            "deleted_count": deleted_count,
            "remaining_annotations": remaining_annotation_count,
            "remaining_categories": remaining_category_count
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error in delete_annotation_class: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete class: {str(e)}")


@router.patch("/datasets/{dataset_id}/annotations/{annotation_id}/image/{image_name}")
async def update_single_image_annotations(
    dataset_id: int,
    annotation_id: str,
    image_name: str,
    request: dict,
    db: Session = Depends(get_db)
):
    """Update annotations for a single image within an annotation file"""
    try:
        # Validate annotation file exists
        annotation_file = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == annotation_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        
        if not annotation_file:
            raise HTTPException(status_code=404, detail="Annotation file not found")

        request_collection_id_raw = request.get("collection_id")
        request_collection_id = None
        if request_collection_id_raw is not None:
            try:
                request_collection_id = int(request_collection_id_raw)
            except (TypeError, ValueError):
                request_collection_id = None

        # Find the image by filename. Use the shared resolver so save and load
        # paths always agree on which `images` row to target when multiple
        # collections share a filename (see annotation_db.resolve_dataset_image_by_filename).
        from .annotation_db import resolve_dataset_image_by_filename
        image = resolve_dataset_image_by_filename(
            db,
            dataset_id,
            image_name,
            preferred_collection_id=request_collection_id,
        )

        if not image:
            raise HTTPException(status_code=404, detail=f"Image '{image_name}' not found in dataset")

        # Get the annotations for this specific image from request
        image_annotations = request.get('annotations', [])
        image_width = request.get('image_width', 0)
        image_height = request.get('image_height', 0)
        
        # Get existing AnnotationClass entries and build a map for category_id lookup
        existing_classes = db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_id
        ).all()
        class_name_to_category_id = {cls.class_name: cls.category_id for cls in existing_classes}
        
        # Find the max category_id to assign to new classes
        max_category_id = max([cls.category_id or 0 for cls in existing_classes], default=0)
        
        # Delete existing annotations for this image and annotation file
        deleted_count = db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == annotation_id,
            models.Annotation.image_id == image.id
        ).delete()
        
        # Track new classes that need to be added
        new_classes_to_add = {}
        
        # Insert new annotations for this image
        annotation_count = 0
        for ann_data in image_annotations:
            category_name = ann_data.get('category_name', '')
            
            # Determine the correct category_id
            if category_name in class_name_to_category_id:
                # Use existing category_id from database
                category_id = class_name_to_category_id[category_name]
            elif category_name in new_classes_to_add:
                # Use the category_id we assigned for this new class
                category_id = new_classes_to_add[category_name]
            else:
                # This is a new class - assign a new category_id
                max_category_id += 1
                category_id = max_category_id
                new_classes_to_add[category_name] = category_id
                class_name_to_category_id[category_name] = category_id
            
            annotation = models.Annotation(
                annotation_file_id=annotation_id,
                image_id=image.id,
                dataset_id=dataset_id,
                category_id=category_id,
                category=category_name,
                segmentation=ann_data.get('segmentation', []),
                bbox=ann_data.get('bbox', []),
                area=ann_data.get('area', 0.0)
            )
            db.add(annotation)
            annotation_count += 1
        
        # Add new classes to AnnotationClass table
        for class_name, category_id in new_classes_to_add.items():
            new_class = models.AnnotationClass(
                annotation_file_id=annotation_id,
                class_name=class_name,
                category_id=category_id,
                count=0,  # Will be updated below
                color='#ea384c',  # Default color
                opacity=0.25
            )
            db.add(new_class)
        
        # Flush changes to make new annotations and classes visible to subsequent queries
        db.flush()
        
        # Recompute statistics for this annotation file after update
        all_annotations = db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == annotation_id
        ).all()
        
        # Calculate statistics by class
        statistics = {}
        class_areas = {}
        class_counts = {}
        
        for ann in all_annotations:
            class_name = ann.category
            if class_name:
                class_counts[class_name] = class_counts.get(class_name, 0) + 1
                class_areas[class_name] = class_areas.get(class_name, 0) + (ann.area or 0)
        
        # Build statistics dictionary
        for class_name, count in class_counts.items():
            avg_area = class_areas[class_name] / count if count > 0 else 0
            statistics[class_name] = {
                "count": count,
                "avgArea": avg_area
            }
        
        # Update AnnotationClass counts based on actual annotation counts
        all_classes = db.query(models.AnnotationClass).filter(
            models.AnnotationClass.annotation_file_id == annotation_id
        ).all()
        classes_to_remove = []
        for cls in all_classes:
            cls.count = class_counts.get(cls.class_name, 0)
            if cls.count <= 0:
                classes_to_remove.append(cls.class_name)
        for class_name in classes_to_remove:
            db.query(models.AnnotationClass).filter(
                models.AnnotationClass.annotation_file_id == annotation_id,
                models.AnnotationClass.class_name == class_name
            ).delete()
        
        # Update annotation file with new statistics and timestamp
        annotation_file.statistics = statistics
        annotation_file.category_count = len(class_counts)
        annotation_file.updated_at = datetime.utcnow()
        
        db.commit()
        
        return {
            "success": True,
            "message": f"Updated {annotation_count} annotations for image '{image_name}' (deleted {deleted_count} old annotations)",
            "image_name": image_name,
            "annotations_added": annotation_count,
            "annotations_removed": deleted_count,
            "statistics": statistics
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        print(f"Error in update_single_image_annotations: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to update image annotations: {str(e)}")


async def merge_annotation_files_task(
    task_id: int,
    dataset_id: int,
    file_ids: List[str],
    merged_filename: str,
    strategy_cfg: Optional[dict] = None,
):
    """Background task to merge annotation files and create a new merged file"""
    # Use a fresh session inside background task
    db = SessionLocal()
    try:
        def _segmentation_polygons(seg_raw):
            """Return segmentation as list-of-polygons (flat coordinate arrays)."""
            if not isinstance(seg_raw, list) or not seg_raw:
                return []
            first = seg_raw[0]
            if isinstance(first, (int, float)):
                return [seg_raw] if len(seg_raw) >= 6 else []
            polys = []
            for poly in seg_raw:
                if isinstance(poly, list) and len(poly) >= 6:
                    polys.append(poly)
            return polys

        def _bbox_from_polygons(polys):
            if not polys:
                return None
            xs = []
            ys = []
            for poly in polys:
                xs.extend(poly[0::2])
                ys.extend(poly[1::2])
            if not xs or not ys:
                return None
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            return [float(min_x), float(min_y), float(max_x - min_x), float(max_y - min_y)]

        def _polygon_area(poly):
            # Shoelace formula for one polygon [x1, y1, x2, y2, ...]
            if not isinstance(poly, list) or len(poly) < 6:
                return 0.0
            pts = list(zip(poly[0::2], poly[1::2]))
            if len(pts) < 3:
                return 0.0
            area2 = 0.0
            for i in range(len(pts)):
                x1, y1 = pts[i]
                x2, y2 = pts[(i + 1) % len(pts)]
                area2 += (x1 * y2) - (x2 * y1)
            return abs(area2) / 2.0

        def _segmentation_area(polys):
            return float(sum(_polygon_area(p) for p in polys))

        # Update task status
        task = db.query(models.Task).filter(models.Task.id == task_id).first()
        if not task:
            return
            
        task.status = "running"
        task.started_at = datetime.utcnow()
        task.progress = 5
        db.commit()

        # Get all annotation files to merge
        annotation_files = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id.in_(file_ids),
            models.AnnotationFile.dataset_id == dataset_id
        ).all()

        if len(annotation_files) < 2:
            raise Exception("At least 2 annotation files are required for merging")

        # Check if files are too large (over 50k annotations total)
        total_annotations = sum(f.annotation_count or 0 for f in annotation_files)
        if total_annotations > 50000:
            print(f"Warning: Large merge operation with {total_annotations} annotations")
            # Update task metadata to reflect large operation
            task.task_metadata = {
                **task.task_metadata,
                "large_operation": True,
                "total_source_annotations": total_annotations,
                "estimated_duration": "5-15 minutes",
                "optimization_enabled": True
            }
            db.commit()

        task.progress = 10
        db.commit()

        # Get all dataset images for mapping (load once, reuse)
        dataset_images = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
        image_lookup = {img.id: img for img in dataset_images}

        task.progress = 15
        db.commit()

        # Initialize merged data structure
        merged_data = {
            "info": {
                "description": f"Merged annotations from {len(annotation_files)} files: {', '.join([f.name for f in annotation_files])}",
                "version": "1.0",
                "year": datetime.utcnow().year,
                "contributor": "AI Data Creator",
                "date_created": datetime.utcnow().isoformat()
            },
            "licenses": [{
                "id": 1,
                "name": "Unknown License",
                "url": ""
            }],
            "images": [],
            "categories": [],
            "annotations": []
        }

        # Strategy configuration (defaults match legacy behavior: drop exact dupes)
        scfg = strategy_cfg or {}
        s_strategy = (scfg.get("strategy") or "exact").lower()
        s_iou = float(scfg.get("iou_threshold", 0.5))
        s_tie = (scfg.get("tie_breaker") or "largest").lower()
        s_priority = scfg.get("priority_order") or list(file_ids)
        s_cross = (scfg.get("cross_class") or "keep").lower()
        s_cross_iou = float(scfg.get("cross_class_iou", 0.7))
        # Map file_id -> priority rank (0 = highest)
        priority_rank = {fid: i for i, fid in enumerate(s_priority)}
        for fid in file_ids:
            priority_rank.setdefault(fid, len(priority_rank))

        # Use sets for faster duplicate detection
        category_map = {}  # category_name -> category_id
        image_map = {}     # original_image_id -> new_coco_image_id

        category_id_counter = 1
        image_id_counter = 1
        annotation_id_counter = 1

        # Process files in batches to avoid memory issues
        for file_idx, annotation_file in enumerate(annotation_files):
            try:
                print(f"Processing annotation file: {annotation_file.name} ({annotation_file.annotation_count} annotations)")
                
                # Process categories first (usually small number)
                classes = db.query(models.AnnotationClass).filter(
                    models.AnnotationClass.annotation_file_id == annotation_file.id
                ).all()

                for cls in classes:
                    if cls.class_name not in category_map:
                        category_map[cls.class_name] = category_id_counter
                        merged_data["categories"].append({
                            "id": category_id_counter,
                            "name": cls.class_name,
                            "supercategory": ""
                        })
                        category_id_counter += 1

                # Process annotations in batches to avoid memory overload
                batch_size = 1000  # Process 1000 annotations at a time
                annotation_count = annotation_file.annotation_count or 0
                
                for offset in range(0, annotation_count, batch_size):
                    # Load annotations in batches
                    annotations_batch = db.query(models.Annotation).filter(
                        models.Annotation.annotation_file_id == annotation_file.id
                    ).offset(offset).limit(batch_size).all()
                    
                    for annotation in annotations_batch:
                        # Handle image mapping (avoid duplicates)
                        original_image_id = annotation.image_id
                        
                        if original_image_id not in image_map:
                            # Add new image entry
                            image_info = image_lookup.get(original_image_id)
                            if image_info:
                                image_map[original_image_id] = image_id_counter
                                merged_data["images"].append({
                                    "id": image_id_counter,
                                    "width": image_info.width or 640,
                                    "height": image_info.height or 480,
                                    "file_name": image_info.file_name,
                                    "license": 1,
                                    "flickr_url": "",
                                    "coco_url": "",
                                    "date_captured": ""
                                })
                                image_id_counter += 1
                            else:
                                # Skip annotation if image not found
                                continue

                        # Create annotation entry
                        coco_image_id = image_map[original_image_id]
                        category_id = category_map.get(annotation.category, category_map.get("unknown", 1))

                        # Get image dimensions for bbox conversion
                        image_info = image_lookup.get(original_image_id)
                        img_width = image_info.width if image_info else 640
                        img_height = image_info.height if image_info else 480

                        # Convert bbox properly
                        pixel_bbox = [0, 0, 0, 0]
                        if annotation.bbox and len(annotation.bbox) >= 4:
                            bbox = annotation.bbox
                            # Check if bbox is normalized (values between 0 and 1)
                            if all(0 <= coord <= 1 for coord in bbox):
                                # Convert normalized to pixel coordinates
                                pixel_bbox = [
                                    bbox[0] * img_width,   # x
                                    bbox[1] * img_height,  # y
                                    bbox[2] * img_width,   # width
                                    bbox[3] * img_height   # height
                                ]
                            else:
                                # Already in pixel coordinates
                                pixel_bbox = list(bbox[:4])
                        elif (
                            annotation.bbox_x is not None
                            and annotation.bbox_y is not None
                            and annotation.bbox_width is not None
                            and annotation.bbox_height is not None
                        ):
                            # Legacy normalized bbox fields.
                            pixel_bbox = [
                                float(annotation.bbox_x) * img_width,
                                float(annotation.bbox_y) * img_height,
                                float(annotation.bbox_width) * img_width,
                                float(annotation.bbox_height) * img_height,
                            ]

                        seg_raw = annotation.segmentation
                        seg_polys = _segmentation_polygons(seg_raw)
                        # If bbox is missing/empty, derive it from segmentation so merge strategy
                        # and exported COCO have usable geometry.
                        if (not pixel_bbox or pixel_bbox[2] <= 0 or pixel_bbox[3] <= 0) and seg_polys:
                            # Detect normalized segmentation by coordinate range.
                            flat = [v for p in seg_polys for v in p]
                            is_norm = bool(flat) and all(0 <= float(v) <= 1 for v in flat)
                            if is_norm:
                                seg_for_bbox = []
                                for poly in seg_polys:
                                    den = []
                                    for i in range(0, len(poly), 2):
                                        den.append(float(poly[i]) * img_width)
                                        den.append(float(poly[i + 1]) * img_height)
                                    seg_for_bbox.append(den)
                            else:
                                seg_for_bbox = [[float(v) for v in poly] for poly in seg_polys]
                            bbox_from_seg = _bbox_from_polygons(seg_for_bbox)
                            if bbox_from_seg:
                                pixel_bbox = bbox_from_seg

                        bbox_area = float(pixel_bbox[2] * pixel_bbox[3]) if pixel_bbox else 0.0
                        ann_area = float(annotation.area) if annotation.area is not None else 0.0
                        if ann_area <= 0 and seg_polys:
                            flat = [v for p in seg_polys for v in p]
                            is_norm = bool(flat) and all(0 <= float(v) <= 1 for v in flat)
                            if is_norm:
                                denorm_polys = []
                                for poly in seg_polys:
                                    den = []
                                    for i in range(0, len(poly), 2):
                                        den.append(float(poly[i]) * img_width)
                                        den.append(float(poly[i + 1]) * img_height)
                                    denorm_polys.append(den)
                                ann_area = _segmentation_area(denorm_polys)
                            else:
                                ann_area = _segmentation_area(seg_polys)
                        if ann_area <= 0:
                            ann_area = bbox_area

                        merged_annotation = {
                            "id": annotation_id_counter,
                            "image_id": coco_image_id,
                            "category_id": category_id,
                            "bbox": pixel_bbox,
                            "area": ann_area,
                            "iscrowd": 0,
                            # Internal tags used by the strategy resolver below; stripped before write.
                            "_source_file_id": annotation_file.id,
                            "_priority": priority_rank.get(annotation_file.id, 9999),
                            "_order": annotation_id_counter,
                        }

                        # Denormalize segmentation from database (stored as 0-1) to pixel coordinates
                        if annotation.segmentation:
                            if isinstance(annotation.segmentation, list):
                                denormalized_segmentation = []
                                for polygon in annotation.segmentation:
                                    if isinstance(polygon, list) and len(polygon) >= 6:
                                        is_norm_poly = all(0 <= float(v) <= 1 for v in polygon)
                                        denormalized_polygon = []
                                        for i in range(0, len(polygon), 2):
                                            x_val = float(polygon[i])
                                            y_val = float(polygon[i + 1]) if i + 1 < len(polygon) else 0.0
                                            if is_norm_poly:
                                                denormalized_polygon.append(x_val * img_width)
                                                denormalized_polygon.append(y_val * img_height)
                                            else:
                                                # Already in pixel coordinates.
                                                denormalized_polygon.append(x_val)
                                                denormalized_polygon.append(y_val)
                                        denormalized_segmentation.append(denormalized_polygon)
                                merged_annotation["segmentation"] = denormalized_segmentation
                            else:
                                # RLE or other format - keep as-is
                                merged_annotation["segmentation"] = annotation.segmentation

                        merged_data["annotations"].append(merged_annotation)
                        annotation_id_counter += 1

                    # Update progress within file processing
                    file_progress = 20 + (file_idx * 60 // len(annotation_files)) + ((offset + batch_size) * 60 // len(annotation_files) // annotation_count)
                    task.progress = min(file_progress, 80)
                    db.commit()

                print(f"Completed processing {annotation_file.name}: {len([a for a in merged_data['annotations'] if a.get('_source_file') == annotation_file.name])} annotations")

            except Exception as file_error:
                print(f"Error processing file {annotation_file.name}: {file_error}")
                continue

        task.progress = 82
        db.commit()

        # ----- Strategy-aware resolution on bboxes -----
        # Bbox IoU helper (COCO format [x, y, w, h])
        def _bbox_iou(a, b):
            ax1, ay1, aw, ah = a[0], a[1], a[2], a[3]
            bx1, by1, bw, bh = b[0], b[1], b[2], b[3]
            ax2, ay2 = ax1 + aw, ay1 + ah
            bx2, by2 = bx1 + bw, by1 + bh
            ix1 = max(ax1, bx1); iy1 = max(ay1, by1)
            ix2 = min(ax2, bx2); iy2 = min(ay2, by2)
            iw = max(0.0, ix2 - ix1); ih = max(0.0, iy2 - iy1)
            inter = iw * ih
            ua = max(0.0, aw * ah) + max(0.0, bw * bh) - inter
            return (inter / ua) if ua > 0 else 0.0

        def _area(a):
            return max(0.0, a["bbox"][2]) * max(0.0, a["bbox"][3])

        def _better(keep, cand, mode):
            # Return True if cand should replace keep
            if mode == "largest":
                return _area(cand) > _area(keep)
            if mode == "smallest":
                return _area(cand) < _area(keep)
            if mode == "first":
                return cand["_order"] < keep["_order"]
            if mode == "last":
                return cand["_order"] > keep["_order"]
            return False

        removed_exact = 0
        removed_iou = 0
        removed_cross_class = 0

        if s_strategy != "union":
            # Group annotations by image
            by_image: dict = {}
            for ann in merged_data["annotations"]:
                by_image.setdefault(ann["image_id"], []).append(ann)

            resolved: list = []
            for img_id, anns in by_image.items():
                # Same-class dedup
                kept_same: list = []
                # Bucket by category
                by_cat: dict = {}
                for a in anns:
                    by_cat.setdefault(a["category_id"], []).append(a)

                for cat_id, group in by_cat.items():
                    keepers: list = []
                    for cand in group:
                        merged_into = None
                        for idx, k in enumerate(keepers):
                            iou_val = _bbox_iou(cand["bbox"], k["bbox"])
                            if s_strategy == "exact":
                                if iou_val >= 0.95:
                                    merged_into = idx
                                    break
                            elif s_strategy == "iou":
                                if iou_val >= s_iou:
                                    merged_into = idx
                                    break
                            elif s_strategy == "priority":
                                if iou_val >= max(0.01, min(s_iou, 0.99)):
                                    merged_into = idx
                                    break
                        if merged_into is None:
                            keepers.append(cand)
                        else:
                            k = keepers[merged_into]
                            if s_strategy == "priority":
                                if cand["_priority"] < k["_priority"]:
                                    keepers[merged_into] = cand
                                elif cand["_priority"] == k["_priority"] and _better(k, cand, s_tie):
                                    keepers[merged_into] = cand
                            elif s_strategy == "iou":
                                if _better(k, cand, s_tie):
                                    keepers[merged_into] = cand
                            # exact: keep first; drop cand
                            if s_strategy == "exact":
                                removed_exact += 1
                            elif s_strategy == "iou":
                                removed_iou += 1
                            else:
                                removed_iou += 1
                    kept_same.extend(keepers)

                # Cross-class resolution (only if priority mode chosen)
                if s_cross == "priority" and len(kept_same) > 1:
                    final_list: list = []
                    # Sort by priority so higher priority is processed first
                    kept_sorted = sorted(kept_same, key=lambda x: (x["_priority"], x["_order"]))
                    for cand in kept_sorted:
                        drop = False
                        for k in final_list:
                            if k["category_id"] == cand["category_id"]:
                                continue
                            if _bbox_iou(cand["bbox"], k["bbox"]) >= s_cross_iou:
                                if cand["_priority"] > k["_priority"]:
                                    drop = True
                                    removed_cross_class += 1
                                    break
                        if not drop:
                            final_list.append(cand)
                    resolved.extend(final_list)
                else:
                    resolved.extend(kept_same)

            # Reassign sequential ids and strip internal tags
            resolved.sort(key=lambda x: (x["image_id"], x["_order"]))
            for new_id, a in enumerate(resolved, start=1):
                a["id"] = new_id
                a.pop("_source_file_id", None)
                a.pop("_priority", None)
                a.pop("_order", None)
            merged_data["annotations"] = resolved
        else:
            # union: just strip tags
            for a in merged_data["annotations"]:
                a.pop("_source_file_id", None)
                a.pop("_priority", None)
                a.pop("_order", None)

        # Record strategy + counts into COCO info for traceability
        merged_data["info"].update({
            "merge_strategy": s_strategy,
            "merge_iou_threshold": s_iou,
            "merge_tie_breaker": s_tie,
            "merge_cross_class": s_cross,
            "merge_cross_class_iou": s_cross_iou,
            "merge_priority_order": s_priority,
            "merge_removed_exact": removed_exact,
            "merge_removed_iou": removed_iou,
            "merge_removed_cross_class": removed_cross_class,
        })

        task.progress = 85
        db.commit()

        # Create the merged annotation file record
        import uuid
        merged_file_id = str(uuid.uuid4())[:8]
        
        # Calculate final statistics
        final_annotation_count = len(merged_data["annotations"])
        final_image_count = len(merged_data["images"])
        final_category_count = len(merged_data["categories"])
        
        print(f"Merge summary: {final_annotation_count} annotations, {final_image_count} images, {final_category_count} categories")
        
        # Detect type for merged annotation file
        from .annotation_db import detect_annotation_type
        detected_type = detect_annotation_type(merged_data)
        
        merged_annotation_file = models.AnnotationFile(
            id=merged_file_id,
            dataset_id=dataset_id,
            name=merged_filename,
            format='COCO',
            type=detected_type,  # Set type based on detection
            file_size=0,  # Will be updated after processing
            annotation_count=final_annotation_count,
            image_count=final_image_count,
            category_count=final_category_count,
            is_processed=False,
            processing_status="pending"
        )
        
        db.add(merged_annotation_file)
        db.commit()

        task.progress = 90
        db.commit()

        # For very large files, we should process them directly rather than re-parsing
        if final_annotation_count > 10000:
            print(f"Large merge detected ({final_annotation_count} annotations), using direct processing")
            # Process directly without going through COCO parsing again
            await process_merged_data_directly(db, merged_file_id, merged_data)
        else:
            # Use existing processing for smaller files
            from .annotation_db import process_coco_annotation_file
            await process_coco_annotation_file(merged_file_id, merged_data)

        # Mark task as completed
        task.status = "completed"
        task.completed_at = datetime.utcnow()
        task.progress = 100
        task.task_metadata = {
            **task.task_metadata,
            "merged_file_id": merged_file_id,
            "total_images": final_image_count,
            "total_annotations": final_annotation_count,
            "total_categories": final_category_count,
            "source_files": [f.name for f in annotation_files],
            "duplicates_removed": total_annotations - final_annotation_count
        }
        db.commit()

        print(f"Annotation merge completed: {final_annotation_count} annotations, {final_image_count} images, {final_category_count} categories")

    except Exception as e:
        # Mark task as failed
        if 'task' in locals():
            task.status = "failed"
            task.completed_at = datetime.utcnow()
            task.error_message = str(e)
            task.progress = 0
            db.commit()
        
        print(f"Error in merge_annotation_files_task: {e}")
        raise
    finally:
        db.close()


async def process_merged_data_directly(db: Session, merged_file_id: str, merged_data: dict):
    """Process merged data directly for large files to avoid memory issues"""
    try:
        annotation_file = db.query(models.AnnotationFile).filter(models.AnnotationFile.id == merged_file_id).first()
        if not annotation_file:
            return
            
        annotation_file.processing_status = "processing"
        db.commit()

        # Clear any existing data
        db.query(models.Annotation).filter(models.Annotation.annotation_file_id == merged_file_id).delete()
        db.query(models.AnnotationClass).filter(models.AnnotationClass.annotation_file_id == merged_file_id).delete()

        # Process categories
        for category in merged_data["categories"]:
            annotation_class = models.AnnotationClass(
                annotation_file_id=merged_file_id,
                class_name=category["name"],
                category_id=category["id"],
                count=0,  # Will be updated when processing annotations
                color='#ea384c',
                opacity=0.25
            )
            db.add(annotation_class)

        # Process annotations in batches to avoid memory issues
        batch_size = 500
        class_counts = {}
        
        for i in range(0, len(merged_data["annotations"]), batch_size):
            batch = merged_data["annotations"][i:i + batch_size]
            
            for ann_data in batch:
                # Find the category name
                category_id = ann_data["category_id"]
                category_name = next((cat["name"] for cat in merged_data["categories"] if cat["id"] == category_id), "unknown")
                
                # Find the image info
                image_id = ann_data["image_id"]
                image_info = next((img for img in merged_data["images"] if img["id"] == image_id), None)
                
                if not image_info:
                    continue
                
                # Convert bbox back to normalized coordinates
                bbox = ann_data.get("bbox", [0, 0, 0, 0])
                img_width = image_info.get("width", 640)
                img_height = image_info.get("height", 480)
                
                normalized_bbox = [
                    bbox[0] / img_width if img_width > 0 else 0,
                    bbox[1] / img_height if img_height > 0 else 0,
                    bbox[2] / img_width if img_width > 0 else 0,
                    bbox[3] / img_height if img_height > 0 else 0
                ] if bbox else None

                # Validate segmentation coordinates before saving
                segmentation = ann_data.get("segmentation")
                if segmentation:
                    from .annotation_db import validate_and_normalize_segmentation
                    validated_seg = validate_and_normalize_segmentation(
                        segmentation,
                        image_width=img_width,
                        image_height=img_height,
                        normalize=False  # Keep as pixel coordinates (integers)
                    )
                    if validated_seg is not None:
                        segmentation = validated_seg
                    else:
                        segmentation = None
                
                # Create annotation record
                annotation = models.Annotation(
                    annotation_file_id=merged_file_id,
                    image_id=None,  # We'll need to map this to actual dataset image ID
                    dataset_id=annotation_file.dataset_id,
                    coco_image_id=image_id,
                    coco_annotation_id=ann_data.get("id"),
                    category_id=category_id,
                    category=category_name,
                    bbox_x=normalized_bbox[0] if normalized_bbox else None,
                    bbox_y=normalized_bbox[1] if normalized_bbox else None,
                    bbox_width=normalized_bbox[2] if normalized_bbox else None,
                    bbox_height=normalized_bbox[3] if normalized_bbox else None,
                    bbox=bbox,
                    segmentation=segmentation,
                    area=ann_data.get("area"),
                    confidence=1.0
                )
                
                db.add(annotation)
                class_counts[category_name] = class_counts.get(category_name, 0) + 1
            
            # Commit in batches
            db.commit()

        # Update class counts
        for class_name, count in class_counts.items():
            annotation_class = db.query(models.AnnotationClass).filter(
                models.AnnotationClass.annotation_file_id == merged_file_id,
                models.AnnotationClass.class_name == class_name
            ).first()
            if annotation_class:
                annotation_class.count = count

        # Mark as completed
        annotation_file.is_processed = True
        annotation_file.processing_status = "completed"
        db.commit()

    except Exception as e:
        if annotation_file:
            annotation_file.processing_status = "failed"
            annotation_file.error_message = str(e)
            db.commit()
        raise


@router.post("/datasets/{dataset_id}/annotations/merge")
async def merge_annotation_files(
    dataset_id: int,
    request: MergeAnnotationFilesRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """Merge multiple annotation files into a single COCO file"""
    try:
        # Verify dataset exists
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        
        # Verify annotation files exist
        annotation_files = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id.in_(request.annotation_file_ids),
            models.AnnotationFile.dataset_id == dataset_id
        ).all()
        
        if len(annotation_files) != len(request.annotation_file_ids):
            raise HTTPException(status_code=404, detail="One or more annotation files not found")
        
        if len(annotation_files) < 2:
            raise HTTPException(status_code=400, detail="At least 2 annotation files are required for merging")
        
        # Generate merged filename if not provided
        merged_filename = request.merged_filename
        if not merged_filename:
            file_names = [f.name.replace('.json', '').replace('.coco', '') for f in annotation_files]
            merged_filename = f"merged_{'_'.join(file_names)}.json"
        
        # Create task
        task = models.Task(
            name=f"Merge Annotations: {merged_filename}",
            description=f"Merging {len(annotation_files)} annotation files into {merged_filename}",
            task_type="annotation_merge",
            status="pending",
            project_id=dataset.project_id,
            progress=0.0,
            task_metadata={
                "dataset_id": dataset_id,
                "annotation_file_ids": request.annotation_file_ids,
                "merged_filename": merged_filename,
                "source_files": [f.name for f in annotation_files]
            }
        )
        
        db.add(task)
        db.commit()
        db.refresh(task)
        
        # Save the task ID before the task object becomes detached
        task_id = task.id
        
        # Start background task
        def process_merge_task():
            """Run merge processing in a separate thread with its own DB session."""
            import threading
            import asyncio
            
            async def run_merge():
                try:
                    await merge_annotation_files_task(
                        task_id=task_id,
                        dataset_id=dataset_id,
                        file_ids=request.annotation_file_ids,
                        merged_filename=merged_filename,
                        strategy_cfg=(request.strategy.model_dump() if request.strategy else None),
                    )
                except Exception as e:
                    print(f"Error in merge task: {e}")

            # Run the async merge task
            asyncio.run(run_merge())

        # Start background processing thread
        processing_thread = threading.Thread(target=process_merge_task)
        processing_thread.daemon = True
        processing_thread.start()
        
        return {
            "success": True,
            "task_id": task_id,
            "message": f"Annotation merge task started for {len(annotation_files)} files",
            "merged_filename": merged_filename
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error in merge_annotation_files: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start merge task: {str(e)}")


def _sanitize_fiftyone_field_name(name: str) -> str:
    """Sanitize annotation file name for use as FiftyOne field name."""
    base = os.path.splitext(name)[0] if name else "annotations"
    base = re.sub(r"[^a-zA-Z0-9_]", "_", base)
    return f"predictions_{base}" if base else "predictions"


def _depth_like_collection_name(name: Optional[str]) -> bool:
    if not name:
        return False
    n = name.lower()
    return bool(re.search(r"\bdepth\b", n)) or "depth map" in n or "depth-map" in n


def _effective_project_id(dataset: models.Dataset, images: List[models.Image]) -> int:
    if dataset.project_id:
        return int(dataset.project_id)
    for img in images:
        u = (img.url or "").replace("\\", "/")
        m = re.search(r"/projects/(\d+)/", u)
        if m:
            return int(m.group(1))
    return 0


def _pick_default_fiftyone_collection_id(db: Session, dataset_id: int) -> Optional[int]:
    cols = (
        db.query(models.ImageCollection)
        .filter(models.ImageCollection.dataset_id == dataset_id)
        .order_by(models.ImageCollection.is_default.desc(), models.ImageCollection.created_at.asc())
        .all()
    )
    if not cols:
        return None
    for c in cols:
        if c.is_default and not _depth_like_collection_name(c.name):
            return int(c.id)
    for c in cols:
        n = (c.name or "").lower()
        if ("rgb" in n or "color" in n or "visible" in n) and not _depth_like_collection_name(c.name):
            return int(c.id)
    for c in cols:
        if not _depth_like_collection_name(c.name):
            return int(c.id)
    return int(cols[0].id)


def _remap_annotation_image_to_layer(
    src: models.Image,
    target_collection_id: int,
    all_images: List[models.Image],
) -> models.Image:
    if src.collection_id == target_collection_id:
        return src
    if src.group_id:
        for t in all_images:
            if t.collection_id == target_collection_id and t.group_id and t.group_id == src.group_id:
                return t
    base = os.path.splitext(src.file_name or "")[0].lower()
    for t in all_images:
        if t.collection_id != target_collection_id:
            continue
        tb = os.path.splitext(t.file_name or "")[0].lower()
        if tb == base:
            return t
    return src


def _filesystem_path_for_image(img: models.Image, project_id: int, dataset_id: int) -> Optional[Path]:
    u = (img.url or "").replace("\\", "/")
    m = re.search(r"/projects/(\d+)/(\d+)/images/(.+)$", u)
    if m:
        rel = Path("projects") / m.group(1) / m.group(2) / "images" / m.group(3)
        for base in (Path("."), Path("/app")):
            cand = (base / rel).resolve()
            if cand.exists():
                return cand
    for root in (Path("projects"), Path("/app/projects")):
        cand = root / str(project_id) / str(dataset_id) / "images" / (img.file_name or "")
        if cand.exists():
            return cand.resolve()
    legacy = Path("data") / "images" / str(dataset_id) / (img.file_name or "")
    if legacy.exists():
        return legacy.resolve()
    return None


def _can_resolve_fiftyone_image(img: models.Image, project_id: int, dataset_id: int) -> bool:
    if _filesystem_path_for_image(img, project_id, dataset_id) is not None:
        return True
    for root in (Path("projects"), Path("/app/projects")):
        p = root / str(project_id) / str(dataset_id) / "images" / (img.file_name or "")
        if p.exists():
            return True
    legacy = Path("data") / "images" / str(dataset_id) / (img.file_name or "")
    return legacy.exists()


@router.post("/datasets/{dataset_id}/annotations/view-fiftyone")
async def view_annotations_in_fiftyone(
    dataset_id: int,
    body: ViewFiftyOneRequest,
    db: Session = Depends(get_db)
):
    """Open selected annotation files in FiftyOne, shown as predictions (one field per file)."""
    logger = logging.getLogger(__name__)
    if not body.annotation_file_ids:
        raise HTTPException(status_code=400, detail="Select at least one annotation file")

    dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    images = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
    if not images:
        raise HTTPException(status_code=400, detail="No images in dataset")

    eff_project_id = _effective_project_id(dataset, images)
    by_id: dict = {str(img.id): img for img in images}

    target_col_id: Optional[int] = body.image_collection_id
    if target_col_id is not None:
        col = (
            db.query(models.ImageCollection)
            .filter(
                models.ImageCollection.id == target_col_id,
                models.ImageCollection.dataset_id == dataset_id,
            )
            .first()
        )
        if not col:
            raise HTTPException(status_code=400, detail="Invalid image collection for this dataset")
    else:
        target_col_id = _pick_default_fiftyone_collection_id(db, dataset_id)
        if target_col_id is None:
            raise HTTPException(status_code=400, detail="No image collections found for this dataset")

    # Per annotation file: field_name -> { display_image_id -> [ {label, bbox, confidence} ] }
    predictions_by_field = {}

    for af_id in body.annotation_file_ids:
        af = db.query(models.AnnotationFile).filter(
            models.AnnotationFile.id == af_id,
            models.AnnotationFile.dataset_id == dataset_id
        ).first()
        if not af:
            continue
        field_name = _sanitize_fiftyone_field_name(af.name or af_id[:8])
        annotations = db.query(models.Annotation).filter(
            models.Annotation.annotation_file_id == af_id,
            models.Annotation.dataset_id == dataset_id
        ).all()

        by_image = {}
        for ann in annotations:
            src_key = str(ann.image_id)
            src = by_id.get(src_key)
            if not src:
                continue
            disp = _remap_annotation_image_to_layer(src, int(target_col_id), images)
            disp_key = str(disp.id)

            w_src = float(src.width or 1) or 1.0
            h_src = float(src.height or 1) or 1.0
            w_disp = float(disp.width or 1) or 1.0
            h_disp = float(disp.height or 1) or 1.0

            x, y, ww, hh = None, None, None, None
            if ann.bbox_x is not None and ann.bbox_y is not None and ann.bbox_width is not None and ann.bbox_height is not None:
                x, y, ww, hh = ann.bbox_x, ann.bbox_y, ann.bbox_width, ann.bbox_height
            elif ann.bbox and isinstance(ann.bbox, list) and len(ann.bbox) >= 4:
                x, y, ww, hh = ann.bbox[0], ann.bbox[1], ann.bbox[2], ann.bbox[3]
            if x is None:
                continue

            if src.id != disp.id:
                sx = w_disp / w_src
                sy = h_disp / h_src
                x, y, ww, hh = x * sx, y * sy, ww * sx, hh * sy

            label = ann.category or "unknown"
            conf = float(ann.confidence) if ann.confidence is not None else 1.0
            bbox_norm = [x / w_disp, y / h_disp, ww / w_disp, hh / h_disp]
            if disp_key not in by_image:
                by_image[disp_key] = []
            by_image[disp_key].append({"label": label, "bbox": bbox_norm, "confidence": conf})

        predictions_by_field[field_name] = by_image

    if not predictions_by_field:
        raise HTTPException(status_code=400, detail="No valid annotation files or annotations found")

    needed_ids = set()
    for _fn, by_img in predictions_by_field.items():
        needed_ids.update(by_img.keys())

    image_dict = {}
    for iid in needed_ids:
        img = by_id.get(iid)
        if not img:
            continue
        fs = _filesystem_path_for_image(img, eff_project_id, dataset_id)
        entry = {
            "file_name": img.file_name,
            "width": img.width or 1,
            "height": img.height or 1,
        }
        if fs is not None:
            entry["fs_path"] = str(fs)
        image_dict[iid] = entry

    if not any(
        iid in by_id and _can_resolve_fiftyone_image(by_id[iid], eff_project_id, dataset_id)
        for iid in needed_ids
    ):
        raise HTTPException(
            status_code=400,
            detail="Could not find image files on disk for the selected layer. Check dataset paths and URLs.",
        )

    image_dict_b64 = base64.b64encode(json.dumps(image_dict).encode()).decode()
    predictions_b64 = base64.b64encode(json.dumps(predictions_by_field).encode()).decode()

    # Build script: one predictions field per annotation file (inside the image loop)
    field_blocks = []
    for fn in predictions_by_field:
        fn_esc = fn.replace("\\", "\\\\").replace("'", "\\'")
        field_blocks.append(f"    if '{fn_esc}' in predictions_by_field:")
        field_blocks.append(f"        by_img = predictions_by_field['{fn_esc}']")
        field_blocks.append("        if img_id in by_img:")
        field_blocks.append("            detections = []")
        field_blocks.append("            for pred in by_img[img_id]:")
        field_blocks.append("                d = fo.Detection(")
        field_blocks.append("                    label=pred['label'],")
        field_blocks.append("                    bounding_box=pred['bbox'],")
        field_blocks.append("                    confidence=pred['confidence'])")
        field_blocks.append("                detections.append(d)")
        field_blocks.append(f"            sample['{fn_esc}'] = fo.Detections(detections=detections)")

    script_content = f"""
import fiftyone as fo
import json
from pathlib import Path

dataset_name = "annotations_ds_{dataset_id}"
if dataset_name in fo.list_datasets():
    fo.delete_dataset(dataset_name)
dataset = fo.Dataset(dataset_name)
dataset.persistent = False

import base64 as _b64
image_dict = json.loads(_b64.b64decode('''{image_dict_b64}''').decode())
predictions_by_field = json.loads(_b64.b64decode('''{predictions_b64}''').decode())

_projects_root = Path("projects")
if not _projects_root.exists():
    _projects_root = Path("/app/projects")
_data_root = Path("data")

samples = []
for img_id, img_info in image_dict.items():
    img_path = None
    fp = img_info.get('fs_path')
    if fp:
        img_path = Path(fp)
    if not img_path or not img_path.exists():
        img_path = _projects_root / "{eff_project_id}" / "{dataset_id}" / "images" / img_info['file_name']
    if not img_path.exists():
        img_path = _data_root / "images" / "{dataset_id}" / img_info['file_name']
    if not img_path.exists():
        continue
    sample = fo.Sample(filepath=str(img_path))
"""
    script_content += "\n".join(field_blocks)
    script_content += """
    samples.append(sample)

dataset.add_samples(samples)
print(f"Loaded {len(samples)} samples, {len(predictions_by_field)} prediction fields")

import signal, sys
def _h(sig, frame): sys.exit(0)
signal.signal(signal.SIGINT, _h)
signal.signal(signal.SIGTERM, _h)
print('Launching FiftyOne app on port 5151...')
session = fo.launch_app(dataset, port=5151, address="0.0.0.0")
session.wait(-1)
"""

    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
            f.write(script_content)
            script_path = f.name
        process = subprocess.Popen(
            ["python", script_path],
            stdout=open("/tmp/fiftyone_stdout.log", "w"),
            stderr=open("/tmp/fiftyone_stderr.log", "w"),
            env={**os.environ, "FIFTYONE_DEFAULT_APP_PORT": "5151", "FIFTYONE_DEFAULT_APP_ADDRESS": "0.0.0.0"},
            start_new_session=True,
        )
        time.sleep(2)
        if process.poll() is not None:
            try:
                with open("/tmp/fiftyone_stderr.log") as ef:
                    err = ef.read()
                raise HTTPException(status_code=500, detail=f"FiftyOne failed: {err[:500]}")
            except FileNotFoundError:
                raise HTTPException(status_code=500, detail="FiftyOne failed to start")
        return {
            "success": True,
            "data": {
                "message": "FiftyOne is starting. Open http://localhost:5151 to view annotations as predictions.",
                "url": "http://localhost:5151",
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("view_annotations_in_fiftyone")
        raise HTTPException(status_code=500, detail=str(e))
