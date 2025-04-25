from pydantic import BaseModel, validator
from typing import List, Optional
from datetime import datetime
import json

class DatasetBase(BaseModel):
    name: str
    description: str
    type: str
    tags: List[str] = []

    @validator('tags', pre=True)
    def validate_tags(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except:
                return []
        return v or []

class DatasetCreate(DatasetBase):
    project_id: int

class Dataset(DatasetBase):
    id: int
    created_at: datetime
    updated_at: datetime
    image_count: int = 0
    annotation_count: int = 0
    project_id: int
    thumbnailUrl: Optional[str] = None

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class ProjectBase(BaseModel):
    name: str
    description: str | None = None  # Make description optional with None default
    is_project: bool = True
    tags: List[str] = []

    @validator('tags', pre=True)
    def validate_tags(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except:
                return []
        return v or []

class ProjectCreate(ProjectBase):
    logo: Optional[bytes] = None

class Project(ProjectBase):
    id: int
    created_at: datetime
    updated_at: datetime
    datasets: List[Dataset] = []
    logo_url: Optional[str] = None
    thumbnailUrl: Optional[str] = None  # Added for backward compatibility

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }