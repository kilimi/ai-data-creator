
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from sqlalchemy.orm import Session
from typing import Optional
import json
import base64

from .. import models, schemas
from ..database import get_db

router = APIRouter()


@router.post("/projects/")
async def create_project(
    name: str = Form(...),
    description: str = Form(""),
    tags: Optional[str] = Form(None),
    logo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    try:
        parsed_tags = json.loads(tags) if tags else []
        project_data = {
            "name": name,
            "description": description,
            "tags": json.dumps(parsed_tags)
        }
        db_project = models.Project(**project_data)
        if logo:
            logo_data = await logo.read()
            db_project.logo = logo_data
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


@router.get("/projects/", response_model=list[schemas.Project])
def read_projects(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    try:
        projects = db.query(models.Project).offset(skip).limit(limit).all()
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
                "thumbnailUrl": p.logo_url,
                "tags": p.tags
            }
            for p in projects
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@router.get("/projects/{project_id}", response_model=schemas.Project)
def read_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.put("/projects/{project_id}", response_model=schemas.Project)
async def update_project(
    project_id: int,
    name: str = Form(...),
    description: str = Form(""),
    tags: Optional[str] = Form(None),
    logo: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db)
):
    try:
        project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        if tags:
            project.tags = json.loads(tags)
        project.name = name
        project.description = description
        if logo:
            logo_data = await logo.read()
            project.logo = logo_data
            mime_type = logo.content_type or "image/png"
            logo_base64 = base64.b64encode(logo_data).decode()
            project.logo_url = f"data:{mime_type};base64,{logo_base64}"
        db.commit()
        db.refresh(project)
        return project
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/projects/{project_id}")
async def delete_project(project_id: int, db: Session = Depends(get_db)):
    try:
        db.query(models.Dataset).filter(models.Dataset.project_id == project_id).delete()
        result = db.query(models.Project).filter(models.Project.id == project_id).delete()
        if result == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        db.commit()
        return {"success": True, "message": "Project and all its datasets have been deleted"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/projects/{project_id}/duplicate")
async def duplicate_project(project_id: int, db: Session = Depends(get_db)):
    try:
        original_project = db.query(models.Project).filter(models.Project.id == project_id).first()
        if original_project is None:
            raise HTTPException(status_code=404, detail="Project not found")
        new_project = models.Project(
            name=f"{original_project.name} (Copy)",
            description=original_project.description,
            tags=original_project.tags,
            logo=original_project.logo,
            logo_url=original_project.logo_url
        )
        db.add(new_project)
        db.flush()
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

@router.get("/test-project-tags")
async def test_project_tags(db: Session = Depends(get_db)):
    project = models.Project(
        name="Test Project with Tags",
        description="Testing tags functionality",
        tags=["test", "tags", "feature"]
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return {
        "success": True,
        "data": {
            "id": project.id,
            "name": project.name,
            "description": project.description,
            "tags": project.tags
        }
    }
