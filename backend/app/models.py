from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, LargeBinary, JSON, Float
from sqlalchemy.orm import relationship
from datetime import datetime
import json
from .database import Base

class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(Text, nullable=True)  # Make description nullable
    _tags = Column('tags', JSON, default=list)  # Add tags support
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_project = Column(Boolean, default=True)
    logo = Column(LargeBinary, nullable=True)
    logo_url = Column(String, nullable=True)

    datasets = relationship("Dataset", back_populates="project")

    @property
    def tags(self):
        """Get the tags as a list"""
        if isinstance(self._tags, str):
            try:
                return json.loads(self._tags)
            except json.JSONDecodeError:
                return []
        return self._tags or []

    @tags.setter
    def tags(self, value):
        """Set the tags, ensuring they're stored as JSON"""
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                value = []
        self._tags = value

class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(Text, nullable=True)  # Make description nullable
    type = Column(String)
    _tags = Column('tags', JSON, default=list)  # Renamed to _tags
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    image_count = Column(Integer, default=0)
    annotation_count = Column(Integer, default=0)
    project_id = Column(Integer, ForeignKey("projects.id"))
    logo = Column(LargeBinary, nullable=True)
    logo_url = Column(String, nullable=True)
    thumbnailUrl = Column(String, nullable=True)
    url = Column(String, nullable=True)

    project = relationship("Project", back_populates="datasets")
    # Add relationships with cascade delete
    images = relationship("Image", cascade="all, delete-orphan", back_populates="dataset")
    annotations = relationship("Annotation", cascade="all, delete-orphan", back_populates="dataset")
    annotation_files = relationship("AnnotationFile", cascade="all, delete-orphan", back_populates="dataset")

    @property
    def tags(self):
        """Get the tags as a list"""
        if isinstance(self._tags, str):
            try:
                return json.loads(self._tags)
            except json.JSONDecodeError:
                return []
        return self._tags or []

    @tags.setter
    def tags(self, value):
        """Set the tags, ensuring they're stored as JSON"""
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                value = []
        self._tags = value

class Image(Base):
    __tablename__ = "images"

    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"))
    file_name = Column(String)
    file_size = Column(Integer)
    width = Column(Integer)
    height = Column(Integer)
    url = Column(String)
    thumbnail_url = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    annotations_count = Column(Integer, default=0)

    dataset = relationship("Dataset", back_populates="images")
    annotations = relationship("Annotation", cascade="all, delete-orphan", back_populates="image")

class Annotation(Base):
    __tablename__ = "annotations"

    id = Column(Integer, primary_key=True, index=True)
    image_id = Column(Integer, ForeignKey("images.id"))
    dataset_id = Column(Integer, ForeignKey("datasets.id"))
    category = Column(String)
    bbox = Column(JSON, nullable=True)  # [x, y, width, height]
    segmentation = Column(JSON, nullable=True)  # COCO format segmentation
    area = Column(Float, nullable=True)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    dataset = relationship("Dataset", back_populates="annotations")
    image = relationship("Image", back_populates="annotations")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(Text, nullable=True)
    task_type = Column(String)  # 'augmentation', 'training', 'inference', etc.
    status = Column(String, default='pending')  # 'pending', 'running', 'completed', 'failed'
    project_id = Column(Integer, ForeignKey("projects.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    progress = Column(Float, default=0.0)  # Progress percentage (0-100)
    task_metadata = Column(JSON, nullable=True)  # Additional task-specific data

    project = relationship("Project")
    augmentation = relationship("Augmentation", back_populates="task", uselist=False)


class AnnotationFile(Base):
    __tablename__ = "annotation_files"

    id = Column(String, primary_key=True, index=True)  # Use string ID to match frontend
    dataset_id = Column(Integer, ForeignKey("datasets.id"))
    name = Column(String, index=True)
    file_path = Column(String)  # Physical file path on disk
    format = Column(String, default='COCO')  # COCO, YOLO, etc.
    type = Column(String, nullable=True)  # classification, segmentation, depth
    _tags = Column('tags', JSON, default=list)  # Store tags as JSON
    file_size = Column(Integer, nullable=True)
    annotation_count = Column(Integer, default=0)
    image_count = Column(Integer, default=0)
    category_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    dataset = relationship("Dataset", back_populates="annotation_files")

    @property
    def tags(self):
        """Get the tags as a list"""
        if isinstance(self._tags, str):
            try:
                return json.loads(self._tags)
            except json.JSONDecodeError:
                return []
        return self._tags or []

    @tags.setter
    def tags(self, value):
        """Set the tags, ensuring they're stored as JSON"""
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                value = []
        self._tags = value


class Augmentation(Base):
    __tablename__ = "augmentations"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), unique=True)
    source_dataset_ids = Column(JSON)  # List of source dataset IDs
    target_dataset_id = Column(Integer, ForeignKey("datasets.id"))
    augmentation_methods = Column(JSON)  # List of augmentation method names
    method_parameters = Column(JSON)  # Parameters for each augmentation method
    augmentation_factor = Column(String, default='2')  # How many augmented images per original
    transform_annotations = Column(Boolean, default=True)  # Whether to transform annotations
    annotation_settings = Column(JSON)  # Settings for annotation transformation
    created_at = Column(DateTime, default=datetime.utcnow)

    task = relationship("Task", back_populates="augmentation")
    target_dataset = relationship("Dataset")


class DatasetGroup(Base):
    __tablename__ = "dataset_groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(Text, nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    dataset_ids = Column(JSON, default=list)  # List of dataset IDs in this group
    url = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    project = relationship("Project")

    @property
    def dataset_count(self):
        """Get the number of datasets in this group"""
        if isinstance(self.dataset_ids, str):
            try:
                ids = json.loads(self.dataset_ids)
                return len(ids) if ids else 0
            except json.JSONDecodeError:
                return 0
        return len(self.dataset_ids) if self.dataset_ids else 0

    @property
    def datasets_list(self):
        """Get the dataset IDs as a list"""
        if isinstance(self.dataset_ids, str):
            try:
                return json.loads(self.dataset_ids)
            except json.JSONDecodeError:
                return []
        return self.dataset_ids or []

    @datasets_list.setter
    def datasets_list(self, value):
        """Set the dataset IDs, ensuring they're stored as JSON"""
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                value = []
        self.dataset_ids = value