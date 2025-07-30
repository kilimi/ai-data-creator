# Database Reset Guide

This guide shows different ways to clear your LAI database and start fresh.

## Quick Commands

### Option 1: Complete Reset (Recommended)
```bash
# Navigate to backend directory
cd backend

# Run the reset script
python reset_database.py

# Choose option 1 for complete reset
# Then run migrations
alembic upgrade head
```

### Option 2: Manual Database Reset

#### If using PostgreSQL (Docker):
```bash
# Stop the backend
# Then reset the database container
docker-compose down
docker volume rm lai_postgres_data  # Remove database volume
docker-compose up -d db  # Start just the database
alembic upgrade head  # Run migrations
```

#### If using PostgreSQL (local):
```bash
# Connect to PostgreSQL
psql -U postgres -h localhost

# Drop and recreate the database
DROP DATABASE lai_db;
CREATE DATABASE lai_db;
\q

# Run migrations
alembic upgrade head
```

### Option 3: Reset via Python Script
```python
# In Python console or script
from app.database import engine
from app import models

# Drop all tables
models.Base.metadata.drop_all(bind=engine)

# Recreate all tables
models.Base.metadata.create_all(bind=engine)
```

### Option 4: Clear Data Only (Keep Schema)
```sql
-- Connect to your database and run these commands
-- Order matters due to foreign key constraints

DELETE FROM augmentations;
DELETE FROM annotations;
DELETE FROM images;
DELETE FROM tasks;
DELETE FROM datasets;
DELETE FROM projects;
DELETE FROM alembic_version;  -- Optional: reset migration tracking
```

## File Storage Cleanup

Don't forget to also clear uploaded files:

```bash
# Remove uploaded files (Windows)
rmdir /s data
rmdir /s projects
mkdir data
mkdir projects

# Remove uploaded files (Linux/Mac)
rm -rf data projects
mkdir -p data projects
```

## After Reset

1. **Run migrations** (if you did a complete reset):
   ```bash
   alembic upgrade head
   ```

2. **Start the backend server**:
   ```bash
   python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

3. **Verify the reset**:
   - Check that tables are empty: `http://localhost:8000/projects/`
   - Should return empty list: `{"success": true, "data": []}`

## Environment-Specific Instructions

### Development Environment
- Use Option 1 (reset script) or Option 2 (Docker reset)
- Safe to reset frequently during development

### Docker Environment
```bash
# Complete reset with Docker
docker-compose down -v  # Remove volumes
docker-compose up -d --build
```

### Production Environment
⚠️ **WARNING**: Never use these reset methods in production!

For production:
1. Create backups first
2. Use proper migration scripts
3. Consider data export/import instead of reset

## Troubleshooting

### "Permission Denied" on file deletion
```bash
# Windows - run as administrator
# Linux/Mac - check file permissions
sudo rm -rf data projects
```

### "Database does not exist"
```bash
# Create the database first
createdb lai_db
# or via psql:
CREATE DATABASE lai_db;
```

### Alembic errors after reset
```bash
# Reset alembic version tracking
alembic stamp head
# or start fresh:
rm -rf migrations/versions/*.py
alembic revision --autogenerate -m "initial"
alembic upgrade head
```

### Foreign key constraint errors
- Always delete in the correct order (shown in SQL commands above)
- Or use CASCADE DELETE if supported

## Quick Development Reset

For rapid development cycles:

```bash
# One-liner for complete reset
python reset_database.py && alembic upgrade head
```

## What Gets Reset

✅ **Cleared**:
- All projects
- All datasets  
- All images and annotations
- All augmentation tasks
- All uploaded files
- Database schema (if complete reset)

🔄 **Preserved**:
- Application code
- Configuration files
- Docker containers (unless using -v flag)
- Migration files
