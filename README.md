### Frontend: 
install npm, vite: npm create vite@latest LAI -- --template react

Project name: LAI 
Framework: React
Variant: TypeScript

npm install 
npm run dev

### Database Setup

**If database doesn't exist:**
```bash
# Connect to PostgreSQL as the postgres superuser
docker-compose exec db psql -U postgres

# Create the database
CREATE DATABASE lai_db;

# Grant permissions (optional but recommended)
GRANT ALL PRIVILEGES ON DATABASE lai_db TO postgres;

# Exit PostgreSQL
\q
```

**Fresh database setup:**
```bash
# Option 1: Use reset script
docker-compose exec backend python reset_database.py
# Choose option 3 for fresh Alembic reset

# Option 2: Manual fresh setup (if migration conflicts occur)
# Remove migration files and clear database
Remove-Item "backend\migrations\versions\*.py" -Force
docker-compose exec db psql -U postgres lai_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker-compose exec backend alembic revision --autogenerate -m "Initial migration"
docker-compose exec backend alembic upgrade head
```

### Backend
```bash
# Navigate to backend directory
cd backend

# Start containers (builds automatically)
docker-compose up -d --build

# Stop containers
docker-compose down

# Stop containers and remove volumes (clears database)
docker-compose down -v

# Run database migrations
docker-compose exec backend alembic upgrade head

# Backend will be available at:
http://localhost:9999
```

### Frontend Access
http://localhost:5173

### Backend Scripts

Run backend scripts inside the Docker container:

```bash
# Database operations
docker-compose exec backend python reset_database.py
docker-compose exec backend python fix_alembic.py

# File structure migration
docker-compose exec backend python migrate_file_structure.py

# Install/setup augmentation library
docker-compose exec backend python install_albumentations.py

# Database migrations
docker-compose exec backend alembic upgrade head
docker-compose exec backend alembic revision --autogenerate -m "Description"
```

### Troubleshooting

**Database Connection Issues:**
The docker-compose.yml includes health checks to ensure the database is ready before starting the backend. If you see connection errors:

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs backend
docker-compose logs db

# Restart with fresh database
docker-compose down -v
docker-compose up -d --build
docker-compose exec backend alembic upgrade head
```

**Alembic Migration Issues:**

*"Target database is not up to date" error with empty database:*
```bash
# Complete fresh setup (removes migration conflicts)
Remove-Item "backend\migrations\versions\*.py" -Force
docker-compose exec db psql -U postgres lai_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker-compose exec backend alembic revision --autogenerate -m "Initial migration"
docker-compose exec backend alembic upgrade head
```

*"Relation does not exist" errors during migrations:*
```bash
# This usually means migration files are out of sync with database state
# Solution: Fresh migration setup
Remove-Item "backend\migrations\versions\*.py" -Force
docker-compose exec db psql -U postgres lai_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
docker-compose exec backend alembic revision --autogenerate -m "Fresh migration"
docker-compose exec backend alembic upgrade head
```

### Database

The database is automatically created when running `docker-compose up`. 

To reset the database completely:
```bash
docker-compose down -v  # Removes volumes
docker-compose up -d --build
docker-compose exec backend alembic upgrade head
```