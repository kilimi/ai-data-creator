### Frontend: 
install npm, vite: npm create vite@latest LAI -- --template react

Project name: LAI 
Framework: React
Variant: TypeScript

npm install 
npm run dev

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
http://localhost:8000
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

### Database

The database is automatically created when running `docker-compose up`. 

To reset the database completely:
```bash
docker-compose down -v  # Removes volumes
docker-compose up -d --build
docker-compose exec backend alembic upgrade head
```