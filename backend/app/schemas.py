from pydantic import BaseModel, validator
from typing import List, Optional
from datetime import datetime
import json

class DatasetBase(BaseModel):
    name: str
    description: str | None = None  # Make description optional with None default
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

class DatasetResponse(Dataset):
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

class Image(BaseModel):
    id: int
    dataset_id: int
    file_name: str
    file_size: int
    width: int
    height: int
    url: str
    thumbnail_url: str
    uploaded_at: datetime
    annotations_count: int = 0

    # Helper function to convert to frontend format
    def to_frontend_format(self, dataset_id: str) -> dict:
        return {
            "id": str(self.id),
            "datasetId": str(dataset_id),
            "fileName": self.file_name,
            "fileSize": self.file_size,
            "width": self.width,
            "height": self.height,
            "url": self.url,
            "thumbnailUrl": self.thumbnail_url,
            "uploadedAt": self.uploaded_at.isoformat(),
            "annotationsCount": self.annotations_count
        }

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class TaskBase(BaseModel):
    name: str
    description: Optional[str] = None
    task_type: str
    project_id: int
    task_metadata: Optional[dict] = None

class TaskCreate(TaskBase):
    pass

class Task(TaskBase):
    id: int
    status: str = 'pending'
    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    progress: float = 0.0

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class AugmentationBase(BaseModel):
    source_dataset_ids: List[int]
    augmentation_methods: List[str]
    method_parameters: dict = {}
    augmentation_factor: str = '2'
    transform_annotations: bool = True
    annotation_settings: dict = {}

class AugmentationCreate(AugmentationBase):
    task_id: int
    target_dataset_id: int

class AnnotationFileBase(BaseModel):
    name: str
    format: str = 'COCO'
    type: Optional[str] = None
    tags: List[str] = []

    @validator('tags', pre=True)
    def validate_tags(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except:
                return []
        return v or []

class AnnotationFileCreate(AnnotationFileBase):
    id: str
    dataset_id: int
    file_path: str
    file_size: Optional[int] = None
    annotation_count: int = 0
    image_count: int = 0
    category_count: int = 0

class AnnotationFile(AnnotationFileBase):
    id: str
    dataset_id: int
    file_path: str
    file_size: Optional[int] = None
    annotation_count: int = 0
    image_count: int = 0
    category_count: int = 0
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class Augmentation(AugmentationBase):
    id: int
    task_id: int
    target_dataset_id: int
    created_at: datetime

    class Config:
        from_attributes = True
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }


class CreateAugmentedDatasetRequest(BaseModel):
    name: str
    description: Optional[str] = None
    project_id: int
    source_datasets: List[int]
    augmentation_methods: List[str]
    method_parameters: dict = {}
    augmentation_factor: str = '2'