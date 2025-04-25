from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, Boolean, LargeBinary, JSON
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
    description = Column(Text)
    type = Column(String)
    _tags = Column('tags', JSON, default=list)  # Renamed to _tags
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    image_count = Column(Integer, default=0)
    annotation_count = Column(Integer, default=0)
    project_id = Column(Integer, ForeignKey("projects.id"))

    project = relationship("Project", back_populates="datasets")

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