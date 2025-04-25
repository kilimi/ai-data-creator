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
                return [str(tag) for tag in json.loads(v)]
            except:
                return []
        elif isinstance(v, list):
            return [str(tag) for tag in v]
        return []

class DatasetCreate(DatasetBase):
    project_id: int

class Dataset(DatasetBase):
    id: int
    created_at: datetime
    updated_at: datetime
    image_count: int = 0
    annotation_count: int = 0
    project_id: int

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class ProjectBase(BaseModel):
    name: str
    description: str
    is_project: bool = True

class ProjectCreate(ProjectBase):
    logo: Optional[bytes] = None

class Project(ProjectBase):
    id: int
    created_at: datetime
    updated_at: datetime
    datasets: List[Dataset] = []
    logo_url: Optional[str] = None

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }