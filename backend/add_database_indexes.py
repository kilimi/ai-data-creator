#!/usr/bin/env python3
"""
Database performance optimization script
Adds missing indexes for annotation loading performance
"""

from sqlalchemy import text, create_engine
from app.database import SQLALCHEMY_DATABASE_URL, engine
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def add_performance_indexes():
    """Add database indexes to improve annotation loading performance"""
    
    # PostgreSQL indexes (not SQLite)
    indexes_to_create = [
        # Critical indexes for annotation queries
        {
            "name": "idx_annotations_dataset_id",
            "table": "annotations", 
            "columns": ["dataset_id"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_annotations_dataset_id ON annotations(dataset_id)"
        },
        {
            "name": "idx_annotations_annotation_file_id",
            "table": "annotations",
            "columns": ["annotation_file_id"], 
            "sql": "CREATE INDEX IF NOT EXISTS idx_annotations_annotation_file_id ON annotations(annotation_file_id)"
        },
        {
            "name": "idx_annotations_image_id",
            "table": "annotations",
            "columns": ["image_id"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_annotations_image_id ON annotations(image_id)"
        },
        {
            "name": "idx_annotations_category",
            "table": "annotations",
            "columns": ["category"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_annotations_category ON annotations(category)"
        },
        
        # Compound indexes for common query patterns
        {
            "name": "idx_annotations_dataset_file",
            "table": "annotations",
            "columns": ["dataset_id", "annotation_file_id"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_annotations_dataset_file ON annotations(dataset_id, annotation_file_id)"
        },
        {
            "name": "idx_annotations_file_image",
            "table": "annotations", 
            "columns": ["annotation_file_id", "image_id"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_annotations_file_image ON annotations(annotation_file_id, image_id)"
        },
        
        # Annotation file indexes
        {
            "name": "idx_annotation_files_dataset_id",
            "table": "annotation_files",
            "columns": ["dataset_id"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_annotation_files_dataset_id ON annotation_files(dataset_id)"
        },
        
        # Annotation classes indexes
        {
            "name": "idx_annotation_classes_file_id",
            "table": "annotation_classes",
            "columns": ["annotation_file_id"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_annotation_classes_file_id ON annotation_classes(annotation_file_id)"
        },
        {
            "name": "idx_annotation_classes_name",
            "table": "annotation_classes", 
            "columns": ["class_name"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_annotation_classes_name ON annotation_classes(class_name)"
        },
        
        # Images table indexes
        {
            "name": "idx_images_dataset_id",
            "table": "images",
            "columns": ["dataset_id"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_images_dataset_id ON images(dataset_id)"
        },
        {
            "name": "idx_images_filename",
            "table": "images",
            "columns": ["file_name"],
            "sql": "CREATE INDEX IF NOT EXISTS idx_images_filename ON images(file_name)"
        }
    ]
    
    try:
        with engine.connect() as connection:
            logger.info("Starting database index creation...")
            logger.info(f"Database URL: {SQLALCHEMY_DATABASE_URL}")
            
            # Check current indexes (PostgreSQL syntax)
            result = connection.execute(text("""
                SELECT indexname 
                FROM pg_indexes 
                WHERE tablename IN ('annotations', 'annotation_files', 'annotation_classes', 'images')
            """))
            existing_indexes = [row[0] for row in result.fetchall()]
            logger.info(f"Existing indexes: {existing_indexes}")
            
            created_count = 0
            for index_def in indexes_to_create:
                index_name = index_def["name"]
                
                if index_name in existing_indexes:
                    logger.info(f"✓ Index {index_name} already exists")
                    continue
                    
                try:
                    logger.info(f"Creating index {index_name} on {index_def['table']}({', '.join(index_def['columns'])})")
                    connection.execute(text(index_def["sql"]))
                    created_count += 1
                    logger.info(f"✓ Created index {index_name}")
                except Exception as e:
                    logger.error(f"✗ Failed to create index {index_name}: {e}")
            
            connection.commit()
            logger.info(f"Index creation completed. Created {created_count} new indexes.")
            
            # Analyze tables for query optimization (PostgreSQL)
            tables_to_analyze = ['annotations', 'annotation_files', 'annotation_classes', 'images']
            for table in tables_to_analyze:
                try:
                    connection.execute(text(f"ANALYZE {table}"))
                    logger.info(f"✓ Analyzed table {table}")
                except Exception as e:
                    logger.error(f"✗ Failed to analyze table {table}: {e}")
            
            # Show some performance statistics
            result = connection.execute(text("SELECT COUNT(*) FROM annotations"))
            annotation_count = result.fetchone()[0]
            
            result = connection.execute(text("SELECT COUNT(*) FROM annotation_files"))
            file_count = result.fetchone()[0]
            
            logger.info(f"Database statistics:")
            logger.info(f"  - Total annotations: {annotation_count:,}")
            logger.info(f"  - Total annotation files: {file_count:,}")
            
            if annotation_count > 0:
                # Test query performance (PostgreSQL EXPLAIN)
                result = connection.execute(text("EXPLAIN (FORMAT TEXT) SELECT COUNT(*) FROM annotations WHERE dataset_id = 1"))
                logger.info("Query plan for COUNT with dataset_id filter:")
                for row in result.fetchall():
                    logger.info(f"  {row[0]}")
            
    except Exception as e:
        logger.error(f"Database index creation failed: {e}")
        raise

def check_database_performance():
    """Check current database performance metrics"""
    try:
        with engine.connect() as connection:
            logger.info("=== DATABASE PERFORMANCE CHECK ===")
            
            # Check table sizes
            result = connection.execute(text("""
                SELECT 
                    (SELECT COUNT(*) FROM annotations) as annotation_count,
                    (SELECT COUNT(*) FROM annotation_files) as file_count,
                    (SELECT COUNT(*) FROM images) as image_count
            """))
            
            row = result.fetchone()
            if row:
                logger.info(f"Table row counts:")
                logger.info(f"  - Annotations: {row[0]:,}")
                logger.info(f"  - Annotation files: {row[1]:,}")
                logger.info(f"  - Images: {row[2]:,}")
            
            # Check indexes (PostgreSQL syntax)
            result = connection.execute(text("""
                SELECT 
                    schemaname,
                    tablename,
                    indexname,
                    indexdef
                FROM pg_indexes 
                WHERE tablename IN ('annotations', 'annotation_files', 'annotation_classes', 'images')
                AND schemaname = 'public'
                ORDER BY tablename, indexname
            """))
            
            indexes = result.fetchall()
            logger.info(f"\nCurrent indexes ({len(indexes)} total):")
            for idx in indexes:
                logger.info(f"  - {idx[1]}.{idx[2]}")
            
            # Test slow query
            if row and row[0] > 0:  # If we have annotations
                import time
                start_time = time.time()
                result = connection.execute(text("SELECT COUNT(*) FROM annotations WHERE dataset_id = 1"))
                query_time = time.time() - start_time
                
                count = result.fetchone()[0]
                logger.info(f"\nQuery performance test:")
                logger.info(f"  - COUNT query took: {query_time:.3f}s")
                logger.info(f"  - Result: {count} annotations")
                
                if query_time > 0.1:
                    logger.warning("⚠️  Query is slow! Consider adding indexes.")
                else:
                    logger.info("✓ Query performance is good.")
                    
    except Exception as e:
        logger.error(f"Performance check failed: {e}")

if __name__ == "__main__":
    logger.info("Database Performance Optimization Tool")
    logger.info("=====================================")
    
    # First check current performance
    check_database_performance()
    
    print()
    
    # Add missing indexes
    add_performance_indexes()
    
    print()
    
    # Check performance after optimization
    logger.info("=== POST-OPTIMIZATION CHECK ===")
    check_database_performance()
