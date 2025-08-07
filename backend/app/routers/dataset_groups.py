from fastapi import APIRouter, Depends, HTTPException, Form
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
import json

from .. import models, schemas
from ..database import get_db

router = APIRouter()


@router.post("/projects/{project_id}/dataset-groups/")
async def create_dataset_group(
    project_id: int,
    name: str = Form(...),
    description: str = Form(""),
    dataset_ids: str = Form(...),  # Receive as comma-separated string
    url: str = Form(""),
    db: Session = Depends(get_db)
):
    """Create a new dataset group within a project"""
    
    # Verify project exists
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    # Parse dataset IDs from comma-separated string
    try:
        if dataset_ids.strip():
            dataset_id_list = [int(id.strip()) for id in dataset_ids.split(',') if id.strip()]
        else:
            dataset_id_list = []
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid dataset ID format")
    
    if not dataset_id_list:
        raise HTTPException(status_code=400, detail="At least one dataset must be selected")
    
    # Verify all datasets exist and belong to the project
    datasets = db.query(models.Dataset).filter(
        models.Dataset.id.in_(dataset_id_list),
        models.Dataset.project_id == project_id
    ).all()
    
    if len(datasets) != len(dataset_id_list):
        raise HTTPException(status_code=400, detail="Some datasets not found or don't belong to this project")
    
    # Create the group
    group = models.DatasetGroup(
        name=name,
        description=description,
        project_id=project_id,
        dataset_ids=dataset_id_list,
        url=url
    )
    
    db.add(group)
    db.commit()
    db.refresh(group)
    
    # Return the group with dataset details
    group_data = {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "project_id": group.project_id,
        "dataset_ids": group.datasets_list,
        "dataset_count": group.dataset_count,
        "url": group.url,
        "datasets": [
            {
                "id": d.id,
                "name": d.name,
                "thumbnailUrl": d.thumbnailUrl,
                "image_count": d.image_count,
                "annotation_count": d.annotation_count,
                "url": d.url
            }
            for d in datasets
        ],
        "created_at": group.created_at.isoformat(),
        "updated_at": group.updated_at.isoformat()
    }
    
    return {"success": True, "data": group_data}


@router.get("/projects/{project_id}/dataset-groups/")
async def get_dataset_groups(
    project_id: int,
    db: Session = Depends(get_db)
):
    """Get all dataset groups for a project"""
    
    # Verify project exists
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    groups = db.query(models.DatasetGroup).filter(
        models.DatasetGroup.project_id == project_id
    ).all()
    
    result = []
    for group in groups:
        # Get datasets for this group
        datasets = []
        if group.datasets_list:
            datasets = db.query(models.Dataset).filter(
                models.Dataset.id.in_(group.datasets_list)
            ).all()
        
        group_data = {
            "id": group.id,
            "name": group.name,
            "description": group.description,
            "project_id": group.project_id,
            "dataset_ids": group.datasets_list,
            "dataset_count": group.dataset_count,
            "url": group.url,
            "datasets": [
                {
                    "id": d.id,
                    "name": d.name,
                    "thumbnailUrl": d.thumbnailUrl,
                    "image_count": d.image_count,
                    "annotation_count": d.annotation_count,
                    "tags": d.tags,
                    "url": d.url
                }
                for d in datasets
            ],
            "created_at": group.created_at.isoformat(),
            "updated_at": group.updated_at.isoformat()
        }
        result.append(group_data)
    
    return {"success": True, "data": result}


@router.get("/dataset-groups/{group_id}")
async def get_dataset_group(
    group_id: int,
    db: Session = Depends(get_db)
):
    """Get a specific dataset group"""
    
    group = db.query(models.DatasetGroup).filter(
        models.DatasetGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(status_code=404, detail="Dataset group not found")
    
    # Get datasets for this group
    datasets = []
    if group.datasets_list:
        datasets = db.query(models.Dataset).filter(
            models.Dataset.id.in_(group.datasets_list)
        ).all()
    
    group_data = {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "project_id": group.project_id,
        "dataset_ids": group.datasets_list,
        "dataset_count": group.dataset_count,
        "url": group.url,
        "datasets": [
            {
                "id": d.id,
                "name": d.name,
                "description": d.description,
                "thumbnailUrl": d.thumbnailUrl,
                "image_count": d.image_count,
                "annotation_count": d.annotation_count,
                "tags": d.tags,
                "url": d.url,
                "created_at": d.created_at.isoformat()
            }
            for d in datasets
        ],
        "created_at": group.created_at.isoformat(),
        "updated_at": group.updated_at.isoformat()
    }
    
    return {"success": True, "data": group_data}


@router.put("/dataset-groups/{group_id}")
async def update_dataset_group(
    group_id: int,
    name: str = Form(None),
    description: str = Form(None),
    dataset_ids: str = Form(None),  # Receive as comma-separated string
    url: str = Form(None),
    db: Session = Depends(get_db)
):
    """Update a dataset group"""
    
    group = db.query(models.DatasetGroup).filter(
        models.DatasetGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(status_code=404, detail="Dataset group not found")
    
    # Update fields if provided
    if name is not None:
        group.name = name
    if description is not None:
        group.description = description
    if url is not None:
        group.url = url
    if dataset_ids is not None:
        # Parse dataset IDs from comma-separated string
        try:
            if dataset_ids.strip():
                dataset_id_list = [int(id.strip()) for id in dataset_ids.split(',') if id.strip()]
            else:
                dataset_id_list = []
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid dataset ID format")
        
        if not dataset_id_list:
            raise HTTPException(status_code=400, detail="At least one dataset must be selected")
        
        # Verify all datasets exist and belong to the same project
        datasets = db.query(models.Dataset).filter(
            models.Dataset.id.in_(dataset_id_list),
            models.Dataset.project_id == group.project_id
        ).all()
        
        if len(datasets) != len(dataset_id_list):
            raise HTTPException(status_code=400, detail="Some datasets not found or don't belong to this project")
        
        group.datasets_list = dataset_id_list
    
    db.commit()
    db.refresh(group)
    
    # Return updated group
    datasets = []
    if group.datasets_list:
        datasets = db.query(models.Dataset).filter(
            models.Dataset.id.in_(group.datasets_list)
        ).all()
    
    group_data = {
        "id": group.id,
        "name": group.name,
        "description": group.description,
        "project_id": group.project_id,
        "dataset_ids": group.datasets_list,
        "dataset_count": group.dataset_count,
        "url": group.url,
        "datasets": [
            {
                "id": d.id,
                "name": d.name,
                "thumbnailUrl": d.thumbnailUrl,
                "image_count": d.image_count,
                "annotation_count": d.annotation_count,
                "url": d.url
            }
            for d in datasets
        ],
        "created_at": group.created_at.isoformat(),
        "updated_at": group.updated_at.isoformat()
    }
    
    return {"success": True, "data": group_data}


@router.delete("/dataset-groups/{group_id}")
async def delete_dataset_group(
    group_id: int,
    db: Session = Depends(get_db)
):
    """Delete a dataset group"""
    
    group = db.query(models.DatasetGroup).filter(
        models.DatasetGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(status_code=404, detail="Dataset group not found")
    
    db.delete(group)
    db.commit()
    
    return {"success": True, "message": "Dataset group deleted successfully"}


@router.get("/projects/{project_id}/search")
async def search_datasets_and_groups(
    project_id: int,
    q: str = "",
    tag: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Search datasets and groups within a project"""
    
    # Verify project exists
    project = db.query(models.Project).filter(models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    results = {
        "datasets": [],
        "groups": [],
        "expanded_groups": []  # Groups that contain matching datasets
    }
    
    # Search datasets
    dataset_query = db.query(models.Dataset).filter(
        models.Dataset.project_id == project_id
    )
    
    if q:
        dataset_query = dataset_query.filter(
            models.Dataset.name.ilike(f"%{q}%") |
            models.Dataset.description.ilike(f"%{q}%")
        )
    
    datasets = dataset_query.all()
    
    # Filter by tag if specified
    if tag:
        datasets = [d for d in datasets if tag in (d.tags or [])]
    
    # Also filter by search query in tags
    if q:
        tag_filtered = [d for d in datasets if any(q.lower() in (tag_item or "").lower() for tag_item in (d.tags or []))]
        # Combine name/description matches with tag matches
        all_dataset_ids = set([d.id for d in datasets] + [d.id for d in tag_filtered])
        datasets = db.query(models.Dataset).filter(
            models.Dataset.id.in_(all_dataset_ids)
        ).all()
    
    results["datasets"] = [
        {
            "id": d.id,
            "name": d.name,
            "description": d.description,
            "thumbnailUrl": d.thumbnailUrl,
            "image_count": d.image_count,
            "annotation_count": d.annotation_count,
            "tags": d.tags,
            "url": d.url,
            "created_at": d.created_at.isoformat()
        }
        for d in datasets
    ]
    
    # Search groups
    groups = db.query(models.DatasetGroup).filter(
        models.DatasetGroup.project_id == project_id
    ).all()
    
    for group in groups:
        group_matches = False
        expanded = False
        
        # Check if group name or description matches
        if q:
            if (q.lower() in group.name.lower() or 
                (group.description and q.lower() in group.description.lower())):
                group_matches = True
        else:
            group_matches = True  # Include all groups if no search query
        
        # Check if any datasets in the group match
        group_datasets = []
        if group.datasets_list:
            group_datasets = db.query(models.Dataset).filter(
                models.Dataset.id.in_(group.datasets_list)
            ).all()
            
            # Check if any dataset in group matches search criteria
            for dataset in group_datasets:
                dataset_matches = False
                
                if q:
                    if (q.lower() in dataset.name.lower() or
                        (dataset.description and q.lower() in dataset.description.lower()) or
                        any(q.lower() in (tag_item or "").lower() for tag_item in (dataset.tags or []))):
                        dataset_matches = True
                
                if tag and tag in (dataset.tags or []):
                    dataset_matches = True
                
                if dataset_matches:
                    expanded = True
                    break
        
        if group_matches or expanded:
            group_data = {
                "id": group.id,
                "name": group.name,
                "description": group.description,
                "project_id": group.project_id,
                "dataset_ids": group.datasets_list,
                "dataset_count": group.dataset_count,
                "url": group.url,
                "datasets": [
                    {
                        "id": d.id,
                        "name": d.name,
                        "thumbnailUrl": d.thumbnailUrl,
                        "image_count": d.image_count,
                        "annotation_count": d.annotation_count,
                        "tags": d.tags,
                        "url": d.url
                    }
                    for d in group_datasets
                ],
                "created_at": group.created_at.isoformat(),
                "updated_at": group.updated_at.isoformat()
            }
            
            results["groups"].append(group_data)
            
            if expanded:
                results["expanded_groups"].append(group.id)
    
    return {"success": True, "data": results}
