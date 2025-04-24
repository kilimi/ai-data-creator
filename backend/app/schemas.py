from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class DatasetBase(BaseModel):
    name: str
    description: str
    type: str
    tags: List[str]

class DatasetCreate(DatasetBase):
    project_id: int

class Dataset(DatasetBase):
    id: int
    created_at: datetime
    updated_at: datetime
    image_count: int
    annotation_count: int
    project_id: int

    class Config:
        from_attributes = True

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