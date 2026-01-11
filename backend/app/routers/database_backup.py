from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
import json
import io
import zipfile
import os
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List
import logging

from .. import models
from ..database import get_db, engine

logger = logging.getLogger(__name__)

router = APIRouter()

def serialize_model(obj: Any) -> Dict[str, Any]:
    """Convert SQLAlchemy model to dictionary"""
    result = {}
    for column in obj.__table__.columns:
        value = getattr(obj, column.name)
        if isinstance(value, datetime):
            result[column.name] = value.isoformat()
        elif isinstance(value, bytes):
            # Handle binary data (like logos)
            result[column.name] = value.hex() if value else None
        else:
            result[column.name] = value
    return result

def get_all_table_data(db: Session, project_ids: List[int] = None, dataset_ids: List[int] = None) -> Dict[str, List[Dict[str, Any]]]:
    """Export all data from all tables with optional filtering"""
    data = {}
    
    # Define the order of tables to maintain referential integrity during import
    table_order = [
        'projects',
        'datasets', 
        'image_collections',
        'images',
        'annotation_files',
        'annotation_classes',
        'annotations',
        'tasks',
        'augmentations',
        'dataset_groups'
    ]
    
    for table_name in table_order:
        try:
            # Get the model class
            model_class = None
            if table_name == 'projects':
                model_class = models.Project
            elif table_name == 'datasets':
                model_class = models.Dataset
            elif table_name == 'image_collections':
                model_class = models.ImageCollection
            elif table_name == 'images':
                model_class = models.Image
            elif table_name == 'annotation_files':
                model_class = models.AnnotationFile
            elif table_name == 'annotation_classes':
                model_class = models.AnnotationClass
            elif table_name == 'annotations':
                model_class = models.Annotation
            elif table_name == 'tasks':
                model_class = models.Task
            elif table_name == 'augmentations':
                model_class = models.Augmentation
            elif table_name == 'dataset_groups':
                model_class = models.DatasetGroup
            
            if model_class:
                query = db.query(model_class)
                
                # Apply filters
                if project_ids:
                    if table_name == 'projects':
                        query = query.filter(model_class.id.in_(project_ids))
                    elif table_name in ['datasets', 'tasks', 'dataset_groups']:
                        query = query.filter(model_class.project_id.in_(project_ids))
                
                if dataset_ids:
                    if table_name == 'datasets':
                        query = query.filter(model_class.id.in_(dataset_ids))
                    elif table_name in ['images', 'image_collections', 'annotation_files', 'annotation_classes', 'annotations']:
                        query = query.filter(model_class.dataset_id.in_(dataset_ids))
                
                records = query.all()
                data[table_name] = [serialize_model(record) for record in records]
                logger.info(f"Exported {len(records)} records from {table_name}")
            
        except Exception as e:
            logger.error(f"Error exporting table {table_name}: {str(e)}")
            data[table_name] = []
    
    return data

@router.get("/database/export")
async def export_database(
    project_ids: str = None,
    dataset_ids: str = None,
    db: Session = Depends(get_db)
):
    """Export the entire database or filtered subset to a JSON file"""
    try:
        logger.info("Starting database export")
        
        # Parse comma-separated IDs
        project_id_list = [int(x) for x in project_ids.split(',')] if project_ids else None
        dataset_id_list = [int(x) for x in dataset_ids.split(',')] if dataset_ids else None
        
        logger.info(f"Exporting with filters - projects: {project_id_list}, datasets: {dataset_id_list}")
        
        # Get all table data with filters
        data = get_all_table_data(db, project_id_list, dataset_id_list)
        
        # Add metadata
        export_data = {
            "metadata": {
                "export_date": datetime.utcnow().isoformat(),
                "version": "1.0",
                "description": "AI Data Creator Database Backup"
            },
            "data": data
        }
        
        # Create JSON string
        json_str = json.dumps(export_data, indent=2, ensure_ascii=False)
        json_bytes = json_str.encode('utf-8')
        
        # Create response
        filename = f"ai_data_creator_backup_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
        
        return Response(
            content=json_bytes,
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Content-Length": str(len(json_bytes))
            }
        )
        
    except Exception as e:
        logger.error(f"Database export failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

@router.get("/database/export-with-files")
async def export_database_with_files(
    project_ids: str = None,
    dataset_ids: str = None,
    db: Session = Depends(get_db)
):
    """Export the entire database or filtered subset along with all project files as a ZIP"""
    try:
        logger.info("Starting database export with files")
        
        # Parse comma-separated IDs
        project_id_list = [int(x) for x in project_ids.split(',')] if project_ids else None
        dataset_id_list = [int(x) for x in dataset_ids.split(',')] if dataset_ids else None
        
        logger.info(f"Exporting with filters - projects: {project_id_list}, datasets: {dataset_id_list}")
        
        # Create temporary directory
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            
            # Export database data with filters
            data = get_all_table_data(db, project_id_list, dataset_id_list)
            export_data = {
                "metadata": {
                    "export_date": datetime.utcnow().isoformat(),
                    "version": "1.0",
                    "description": "AI Data Creator Database Backup with Files"
                },
                "data": data
            }
            
            # Save database export to temp directory
            db_file = temp_path / "database.json"
            with open(db_file, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, indent=2, ensure_ascii=False)
            
            # Create ZIP file in memory
            # Using compression level 1 for faster exports (vs default level 9)
            zip_buffer = io.BytesIO()
            
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as zip_file:
                # Add database file
                zip_file.write(db_file, "database.json")
                
                # Add project files if they exist (filtered if needed)
                projects_dir = Path("projects")
                if projects_dir.exists():
                    for project_file in projects_dir.rglob("*"):
                        if project_file.is_file():
                            # If filtering by projects, only include those project directories
                            if project_id_list:
                                project_folder = project_file.parts[1] if len(project_file.parts) > 1 else None
                                if project_folder and not project_folder.isdigit():
                                    continue
                                if project_folder and int(project_folder) not in project_id_list:
                                    continue
                            
                            # Use relative path in ZIP
                            arcname = str(project_file.relative_to("."))
                            zip_file.write(project_file, arcname)
                            logger.info(f"Added file to ZIP: {arcname}")
                
                # Add data files if they exist
                data_dir = Path("data")
                if data_dir.exists():
                    for data_file in data_dir.rglob("*"):
                        if data_file.is_file():
                            # Use relative path in ZIP
                            arcname = str(data_file.relative_to("."))
                            zip_file.write(data_file, arcname)
                            logger.info(f"Added file to ZIP: {arcname}")
            
            # IMPORTANT: Get the size AFTER closing the ZipFile
            # to ensure all data is written to the buffer
            zip_buffer.seek(0)
            zip_content = zip_buffer.read()
            zip_size = len(zip_content)
            
            logger.info(f"Created ZIP file with size: {zip_size} bytes")
            
            # Create filename
            filename = f"ai_data_creator_full_backup_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
            
            # Reset buffer for streaming
            zip_buffer = io.BytesIO(zip_content)
            
            return StreamingResponse(
                zip_buffer,
                media_type="application/zip",
                headers={
                    "Content-Disposition": f"attachment; filename={filename}",
                    "Content-Length": str(zip_size)
                }
            )
            
    except Exception as e:
        logger.error(f"Database export with files failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}")

def deserialize_model_data(table_name: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Convert dictionary back to model-compatible format"""
    result = data.copy()
    
    # Handle datetime fields
    datetime_fields = ['created_at', 'updated_at', 'uploaded_at', 'started_at', 'completed_at']
    for field in datetime_fields:
        if field in result and result[field]:
            try:
                result[field] = datetime.fromisoformat(result[field])
            except (ValueError, TypeError):
                result[field] = None
    
    # Handle binary fields (logos)
    if 'logo' in result and result['logo']:
        try:
            result['logo'] = bytes.fromhex(result['logo'])
        except (ValueError, TypeError):
            result['logo'] = None
    
    return result

@router.post("/database/import")
async def import_database(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Import database from JSON file (WARNING: This will clear existing data)"""
    try:
        logger.info("Starting database import")
        
        # Read the uploaded file
        content = await file.read()
        
        # Handle ZIP files
        if file.filename.endswith('.zip'):
            with zipfile.ZipFile(io.BytesIO(content), 'r') as zip_file:
                # Extract database.json
                if 'database.json' not in zip_file.namelist():
                    raise HTTPException(status_code=400, detail="ZIP file must contain database.json")
                
                # Read database.json from ZIP
                with zip_file.open('database.json') as db_file:
                    import_data = json.loads(db_file.read().decode('utf-8'))
                
                # Extract other files
                extract_dir = Path("temp_restore")
                extract_dir.mkdir(exist_ok=True)
                
                try:
                    for member in zip_file.namelist():
                        if member != 'database.json' and not member.endswith('/'):
                            # Extract file
                            zip_file.extract(member, extract_dir)
                            
                            # Move to correct location
                            source_path = extract_dir / member
                            target_path = Path(member)
                            target_path.parent.mkdir(parents=True, exist_ok=True)
                            
                            if source_path.exists():
                                shutil.move(str(source_path), str(target_path))
                                logger.info(f"Restored file: {member}")
                
                finally:
                    # Clean up temp directory
                    if extract_dir.exists():
                        shutil.rmtree(extract_dir)
        
        else:
            # Handle JSON files
            import_data = json.loads(content.decode('utf-8'))
        
        # Validate import data structure
        if 'data' not in import_data:
            raise HTTPException(status_code=400, detail="Invalid backup file format")
        
        data = import_data['data']
        
        # Clear existing data (in reverse order to maintain referential integrity)
        table_order = [
            'dataset_groups',
            'augmentations', 
            'tasks',
            'annotations',
            'annotation_classes',
            'annotation_files',
            'images',
            'image_collections',
            'datasets',
            'projects'
        ]
        
        for table_name in table_order:
            try:
                # Delete all records from table
                if table_name == 'projects':
                    db.query(models.Project).delete()
                elif table_name == 'datasets':
                    db.query(models.Dataset).delete()
                elif table_name == 'image_collections':
                    db.query(models.ImageCollection).delete()
                elif table_name == 'images':
                    db.query(models.Image).delete()
                elif table_name == 'annotation_files':
                    db.query(models.AnnotationFile).delete()
                elif table_name == 'annotation_classes':
                    db.query(models.AnnotationClass).delete()
                elif table_name == 'annotations':
                    db.query(models.Annotation).delete()
                elif table_name == 'tasks':
                    db.query(models.Task).delete()
                elif table_name == 'augmentations':
                    db.query(models.Augmentation).delete()
                elif table_name == 'dataset_groups':
                    db.query(models.DatasetGroup).delete()
                    
                logger.info(f"Cleared table {table_name}")
            except Exception as e:
                logger.error(f"Error clearing table {table_name}: {str(e)}")
        
        db.commit()
        
        # Insert data (in original order to maintain referential integrity)
        insert_order = [
            'projects',
            'datasets', 
            'image_collections',
            'images',
            'annotation_files',
            'annotation_classes',
            'annotations',
            'tasks',
            'augmentations',
            'dataset_groups'
        ]
        
        for table_name in insert_order:
            if table_name in data and data[table_name]:
                try:
                    for record_data in data[table_name]:
                        # Deserialize the data
                        clean_data = deserialize_model_data(table_name, record_data)
                        
                        # Create model instance
                        if table_name == 'projects':
                            record = models.Project(**clean_data)
                        elif table_name == 'datasets':
                            record = models.Dataset(**clean_data)
                        elif table_name == 'image_collections':
                            record = models.ImageCollection(**clean_data)
                        elif table_name == 'images':
                            record = models.Image(**clean_data)
                        elif table_name == 'annotation_files':
                            record = models.AnnotationFile(**clean_data)
                        elif table_name == 'annotation_classes':
                            record = models.AnnotationClass(**clean_data)
                        elif table_name == 'annotations':
                            record = models.Annotation(**clean_data)
                        elif table_name == 'tasks':
                            record = models.Task(**clean_data)
                        elif table_name == 'augmentations':
                            record = models.Augmentation(**clean_data)
                        elif table_name == 'dataset_groups':
                            record = models.DatasetGroup(**clean_data)
                        
                        db.add(record)
                    
                    db.commit()
                    logger.info(f"Imported {len(data[table_name])} records to {table_name}")
                    
                except Exception as e:
                    db.rollback()
                    logger.error(f"Error importing table {table_name}: {str(e)}")
                    raise HTTPException(status_code=500, detail=f"Import failed at table {table_name}: {str(e)}")
        
        logger.info("Database import completed successfully")
        return {
            "message": "Database imported successfully",
            "metadata": import_data.get("metadata", {}),
            "tables_imported": list(data.keys())
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Database import failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Import failed: {str(e)}")

@router.get("/database/connection")
async def get_database_connection_info():
    """Get database connection information"""
    try:
        from ..database import SQLALCHEMY_DATABASE_URL
        
        # Parse database URL to extract connection details
        # Format: postgresql://user:password@host:port/database
        db_url = SQLALCHEMY_DATABASE_URL
        
        # Extract database name from URL
        db_name = "Unknown"
        db_host = "Unknown"
        db_type = "Unknown"
        
        if db_url:
            try:
                # Simple parsing of database URL
                if db_url.startswith('postgresql://'):
                    db_type = "PostgreSQL"
                    # Extract database name (after last /)
                    db_name = db_url.split('/')[-1]
                    # Extract host (between @ and /)
                    host_part = db_url.split('@')[1].split('/')[0]
                    db_host = host_part.split(':')[0] if ':' in host_part else host_part
                elif db_url.startswith('sqlite:///'):
                    db_type = "SQLite"
                    db_name = db_url.split(':///')[-1]
                    db_host = "local"
            except Exception as parse_error:
                logger.warning(f"Error parsing database URL: {str(parse_error)}")
        
        return {
            "database_name": db_name,
            "database_type": db_type,
            "database_host": db_host,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get database connection info: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get database connection info: {str(e)}")

@router.get("/database/info")
async def get_database_info(db: Session = Depends(get_db)):
    """Get database statistics"""
    try:
        info = {}
        
        # Count records in each table
        info['projects'] = db.query(models.Project).count()
        info['datasets'] = db.query(models.Dataset).count()
        info['images'] = db.query(models.Image).count()
        info['annotations'] = db.query(models.Annotation).count()
        info['annotation_files'] = db.query(models.AnnotationFile).count()
        info['annotation_classes'] = db.query(models.AnnotationClass).count()
        info['image_collections'] = db.query(models.ImageCollection).count()
        info['tasks'] = db.query(models.Task).count()
        info['augmentations'] = db.query(models.Augmentation).count()
        info['dataset_groups'] = db.query(models.DatasetGroup).count()
        
        # Calculate total counts
        info['total_records'] = sum(info.values())
        
        return {
            "database_info": info,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to get database info: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get database info: {str(e)}")


@router.delete("/database/clear")
async def clear_database(db: Session = Depends(get_db)):
    """Clear all data from database and remove all physical files (DANGEROUS OPERATION)"""
    try:
        logger.warning("DANGEROUS OPERATION: Starting complete database and file system clear")
        
        # Disable foreign key checks temporarily to avoid constraint issues
        db.execute(text("SET session_replication_role = replica;"))
        
        # Clear database tables in reverse dependency order
        table_order = [
            'dataset_groups',
            'augmentations', 
            'tasks',
            'annotations',
            'annotation_classes',
            'annotation_files',
            'images',
            'image_collections',
            'datasets',
            'projects'
        ]
        
        deleted_counts = {}
        
        for table_name in table_order:
            try:
                # Count records before deletion
                count_before = 0
                if table_name == 'projects':
                    count_before = db.query(models.Project).count()
                    db.query(models.Project).delete(synchronize_session=False)
                elif table_name == 'datasets':
                    count_before = db.query(models.Dataset).count()
                    db.query(models.Dataset).delete(synchronize_session=False)
                elif table_name == 'image_collections':
                    count_before = db.query(models.ImageCollection).count()
                    db.query(models.ImageCollection).delete(synchronize_session=False)
                elif table_name == 'images':
                    count_before = db.query(models.Image).count()
                    db.query(models.Image).delete(synchronize_session=False)
                elif table_name == 'annotation_files':
                    count_before = db.query(models.AnnotationFile).count()
                    db.query(models.AnnotationFile).delete(synchronize_session=False)
                elif table_name == 'annotation_classes':
                    count_before = db.query(models.AnnotationClass).count()
                    db.query(models.AnnotationClass).delete(synchronize_session=False)
                elif table_name == 'annotations':
                    count_before = db.query(models.Annotation).count()
                    db.query(models.Annotation).delete(synchronize_session=False)
                elif table_name == 'tasks':
                    count_before = db.query(models.Task).count()
                    db.query(models.Task).delete(synchronize_session=False)
                elif table_name == 'augmentations':
                    count_before = db.query(models.Augmentation).count()
                    db.query(models.Augmentation).delete(synchronize_session=False)
                elif table_name == 'dataset_groups':
                    count_before = db.query(models.DatasetGroup).count()
                    db.query(models.DatasetGroup).delete(synchronize_session=False)
                
                deleted_counts[table_name] = count_before
                logger.info(f"Cleared {count_before} records from {table_name}")
                
            except Exception as e:
                logger.error(f"Error clearing table {table_name}: {str(e)}")
                deleted_counts[table_name] = 0
        
        # Re-enable foreign key checks
        db.execute(text("SET session_replication_role = origin;"))
        
        # Commit database changes
        db.commit()
        
        # Remove all physical files
        files_removed = 0
        dirs_removed = []
        
        # Remove projects directory
        projects_dir = Path("projects")
        if projects_dir.exists():
            try:
                file_count = sum(1 for f in projects_dir.rglob("*") if f.is_file())
                shutil.rmtree(projects_dir)
                projects_dir.mkdir(exist_ok=True)
                files_removed += file_count
                dirs_removed.append("projects")
                logger.info(f"Removed projects directory with {file_count} files")
            except Exception as e:
                logger.error(f"Error removing projects directory: {str(e)}")
        
        # Remove data directory
        data_dir = Path("data")
        if data_dir.exists():
            try:
                file_count = sum(1 for f in data_dir.rglob("*") if f.is_file())
                shutil.rmtree(data_dir)
                data_dir.mkdir(exist_ok=True)
                files_removed += file_count
                dirs_removed.append("data")
                logger.info(f"Removed data directory with {file_count} files")
            except Exception as e:
                logger.error(f"Error removing data directory: {str(e)}")
        
        total_records_deleted = sum(deleted_counts.values())
        
        logger.warning(f"DANGEROUS OPERATION COMPLETED: Deleted {total_records_deleted} database records and {files_removed} files")
        
        return {
            "message": "Database and files cleared successfully",
            "deleted_records": deleted_counts,
            "total_records_deleted": total_records_deleted,
            "files_removed": files_removed,
            "directories_cleared": dirs_removed,
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Database clear operation failed: {str(e)}")
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Clear operation failed: {str(e)}")
