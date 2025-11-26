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
    _tags = Column('tags', JSON, default=list)  # Renamed to _tags
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    image_count = Column(Integer, default=0)
    # annotation_count is computed on demand from related annotations; remove persistent column
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
    image_collections = relationship("ImageCollection", cascade="all, delete-orphan", back_populates="dataset")

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

    @property
    def actual_annotation_count(self):
        """Get the actual annotation count, calculating it if the stored count is 0"""
        # Compute directly from related annotations when possible
        if hasattr(self, 'annotations') and self.annotations is not None:
            return len(self.annotations)
        return 0

    @property
    def actual_annotation_file_count(self):
        """Compute annotation file count from related annotation_files table."""
        # If relationship is loaded, return its length
        if hasattr(self, 'annotation_files') and self.annotation_files is not None:
            return len(self.annotation_files)
        # Fallback to 0 when relationship isn't available
        return 0

    @property
    def annotation_file_count(self):
        """Compatibility alias so code can read dataset.annotation_file_count as a computed value."""
        return self.actual_annotation_file_count


class Image(Base):
    __tablename__ = "images"

    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), index=True)
    file_name = Column(String, index=True)
    file_size = Column(Integer)
    width = Column(Integer)
    height = Column(Integer)
    url = Column(String)
    thumbnail_url = Column(String)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    annotations_count = Column(Integer, default=0)
    collection_id = Column(Integer, ForeignKey("image_collections.id"), nullable=True, index=True)  # Optional: which collection this image belongs to

    dataset = relationship("Dataset", back_populates="images")
    annotations = relationship("Annotation", cascade="all, delete-orphan", back_populates="image")
    collection = relationship("ImageCollection", back_populates="images")


class ImageCollection(Base):
    __tablename__ = "image_collections"

    id = Column(Integer, primary_key=True, index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), index=True)
    name = Column(String, index=True)
    description = Column(Text, nullable=True)
    is_default = Column(Boolean, default=False)  # True for the main "RGB Images" collection
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    dataset = relationship("Dataset", back_populates="image_collections")
    images = relationship("Image", back_populates="collection")

    @property
    def image_count(self):
        """Get the number of images in this collection"""
        return len(self.images) if self.images else 0


class Annotation(Base):
    __tablename__ = "annotations"

    id = Column(Integer, primary_key=True, index=True)
    annotation_file_id = Column(String, ForeignKey("annotation_files.id"), nullable=True, index=True)  # Link to annotation file
    image_id = Column(Integer, ForeignKey("images.id"), index=True)
    dataset_id = Column(Integer, ForeignKey("datasets.id"), index=True)
    coco_image_id = Column(Integer, nullable=True, index=True)  # Original COCO image ID
    coco_annotation_id = Column(Integer, nullable=True, index=True)  # Original COCO annotation ID
    category_id = Column(Integer, nullable=True, index=True)  # COCO category ID
    category = Column(String, index=True)  # Class name
    bbox_x = Column(Float, nullable=True)  # Normalized bbox coordinates
    bbox_y = Column(Float, nullable=True)
    bbox_width = Column(Float, nullable=True) 
    bbox_height = Column(Float, nullable=True)
    bbox = Column(JSON, nullable=True)  # [x, y, width, height] - keep for backward compatibility
    segmentation = Column(JSON, nullable=True)  # COCO format segmentation
    area = Column(Float, nullable=True)
    confidence = Column(Float, default=1.0)
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    dataset = relationship("Dataset", back_populates="annotations")
    image = relationship("Image", back_populates="annotations")
    annotation_file = relationship("AnnotationFile", back_populates="annotations")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(Text, nullable=True)
    task_type = Column(String, index=True)  # 'augmentation', 'training', 'inference', etc.
    status = Column(String, default='pending', index=True)  # 'pending', 'running', 'completed', 'failed'
    project_id = Column(Integer, ForeignKey("projects.id"), index=True)
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
    dataset_id = Column(Integer, ForeignKey("datasets.id"), index=True)
    name = Column(String, index=True)
    format = Column(String, default='COCO', index=True)  # COCO, YOLO, etc.
    type = Column(String, nullable=True, index=True)  # classification, segmentation, depthation, depth
    _tags = Column('tags', JSON, default=list)  # Store tags as JSON
    file_size = Column(Integer, nullable=True)
    annotation_count = Column(Integer, default=0)
    image_count = Column(Integer, default=0)
    category_count = Column(Integer, default=0)
    statistics = Column(JSON, nullable=True)  # Per-class annotation counts and average areas
    is_processed = Column(Boolean, default=False, index=True)  # Whether file has been processed into DB
    processing_status = Column(String, default='pending', index=True)  # pending, processing, completed, failed
    error_message = Column(Text, nullable=True)  # Error message if processing failed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    dataset = relationship("Dataset", back_populates="annotation_files")
    annotations = relationship("Annotation", back_populates="annotation_file", cascade="all, delete-orphan")
    annotation_classes = relationship("AnnotationClass", back_populates="annotation_file", cascade="all, delete-orphan")
    # Keep per-file list of images that were present in the original file (COCO images list)
    annotation_images = relationship("AnnotationFileImage", back_populates="annotation_file", cascade="all, delete-orphan")

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


class AnnotationClass(Base):
    __tablename__ = "annotation_classes"

    id = Column(Integer, primary_key=True, index=True)
    annotation_file_id = Column(String, ForeignKey("annotation_files.id"), index=True)
    class_name = Column(String, index=True)
    category_id = Column(Integer, nullable=True)  # COCO category ID
    count = Column(Integer, default=0)
    color = Column(String, default='#ea384c')  # Hex color
    opacity = Column(Float, default=0.25)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    annotation_file = relationship("AnnotationFile", back_populates="annotation_classes")


class AnnotationFileImage(Base):
    __tablename__ = "annotation_file_images"

    id = Column(Integer, primary_key=True, index=True)
    annotation_file_id = Column(String, ForeignKey("annotation_files.id"), index=True)
    coco_image_id = Column(Integer, nullable=True, index=True)
    file_name = Column(String, nullable=True)
    dataset_image_id = Column(Integer, ForeignKey("images.id"), nullable=True, index=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    annotation_file = relationship("AnnotationFile", back_populates="annotation_images")


class Augmentation(Base):
    __tablename__ = "augmentations"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), unique=True, index=True)
    source_dataset_ids = Column(JSON)  # List of source dataset IDs
    target_dataset_id = Column(Integer, ForeignKey("datasets.id"), index=True)
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
    project_id = Column(Integer, ForeignKey("projects.id"), index=True)
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