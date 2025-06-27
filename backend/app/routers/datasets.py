from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from sqlalchemy.orm import Session
from typing import Optional, List
import json
import base64
from pathlib import Path
import os

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
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        db.delete(dataset)
        db.commit()
        return {"message": "Dataset and all associated data deleted successfully"}
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
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")
        base_url = str(request.base_url).rstrip('/')
        dataset_dir = Path("data/images") / str(dataset_id)
        dataset_dir.mkdir(parents=True, exist_ok=True)
        uploaded_images = []
        for file in files:
            if not file.content_type.startswith('image/'):
                continue
            file_path = dataset_dir / file.filename
            try:
                contents = await file.read()
                with open(file_path, 'wb') as f:
                    f.write(contents)
                relative_url = f"/data/images/{dataset_id}/{file.filename}"
                db_image = models.Image(
                    dataset_id=dataset_id,
                    file_name=file.filename,
                    file_size=len(contents),
                    width=0,
                    height=0,
                    url=relative_url,
                    thumbnail_url=relative_url,
                    annotations_count=0
                )
                db.add(db_image)
                uploaded_images.append(db_image)
            except Exception:
                continue
        current_image_count = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).count()
        dataset.image_count = current_image_count + len(uploaded_images)
        db.commit()
        response_images = []
        for img in uploaded_images:
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
                "height": img.height,                "url": url,
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
        
        # Try to delete the physical file
        try:
            dataset_dir = Path("data/images") / str(dataset_id)
            file_path = dataset_dir / image.file_name
            if file_path.exists():
                os.remove(file_path)
                print(f"Deleted physical file: {file_path}")
            else:
                print(f"Physical file not found: {file_path}")
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
    """
    Import COCO-format annotations for a dataset.
    - Links annotations to dataset and corresponding image by file_name.
    - Only images present in both the DB and the annotation file will get annotations imported.
    """
    try:
        dataset = db.query(models.Dataset).filter(models.Dataset.id == dataset_id).first()
        if not dataset:
            raise HTTPException(status_code=404, detail="Dataset not found")

        # Read the file and parse COCO
        content = await file.read()
        coco = json.loads(content.decode('utf-8'))

        images_in_db = db.query(models.Image).filter(models.Image.dataset_id == dataset_id).all()
        file_name_to_image = {img.file_name: img for img in images_in_db}
        image_id_to_dbid = {}

        # Build mapping from COCO image id to database image id
        for coco_image in coco.get("images", []):
            file_name = coco_image.get("file_name")
            db_img = file_name_to_image.get(file_name)
            if db_img:
                image_id_to_dbid[coco_image["id"]] = db_img.id

        imported_count = 0
        skipped_count = 0

        for anno in coco.get("annotations", []):
            coco_image_id = anno["image_id"]
            db_image_id = image_id_to_dbid.get(coco_image_id)
            if db_image_id is None:
                skipped_count += 1
                continue

            bbox = anno.get("bbox")    # [x, y, width, height]
            segmentation = anno.get("segmentation")
            area = anno.get("area")
            category = None

            # Category name
            if "category_id" in anno and "categories" in coco:
                category_obj = next((c for c in coco["categories"] if c["id"] == anno["category_id"]), None)
                if category_obj:
                    category = category_obj.get("name")
            if not category:
                category = str(anno.get("category_id", "unknown"))

            db_anno = models.Annotation(
                image_id=db_image_id,
                dataset_id=dataset_id,
                category=category,
                bbox=bbox,
                segmentation=segmentation if isinstance(segmentation, list) else None,
                area=area,
            )
            db.add(db_anno)
            imported_count += 1

        db.commit()
        # Optionally update annotation_count on dataset/images
        dataset.annotation_count += imported_count
        db.commit()
        return {
            "success": True,
            "imported": imported_count,
            "skipped": skipped_count,
            "message": f"Imported {imported_count} annotations. Skipped {skipped_count} (images not found)."
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to import annotations: {str(e)}")


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
        
        # Try to delete the physical file
        try:
            dataset_dir = Path("data/images") / str(dataset_id)
            file_path = dataset_dir / image.file_name
            if file_path.exists():
                os.remove(file_path)
                print(f"Deleted physical file: {file_path}")
            else:
                print(f"Physical file not found: {file_path}")
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
