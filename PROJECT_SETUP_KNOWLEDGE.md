# Project Setup Knowledge Base

This document contains critical setup information to avoid mistakes when working on this project.

## Architecture Overview

### Backend
- **Location**: `backend/` directory
- **Framework**: FastAPI (Python 3.11)
- **Runtime**: Runs in Docker container
- **Port**: 9999 (host) → 8000 (container)
- **Database**: PostgreSQL 15
- **Task Queue**: Celery with Redis
- **Additional Services**: MongoDB (FiftyOne), SAM Service

### Frontend
- **Location**: Root directory (`src/`)
- **Framework**: React + TypeScript + Vite
- **Runtime**: Runs locally (not in Docker)
- **Port**: 8080 (development)
- **API Endpoint**: `http://localhost:9999` (default, can be overridden via localStorage or env var)

## Docker Setup

### Docker Compose Location
- **Main docker-compose.yml**: `backend/docker-compose.yml`
- **Root docker-compose.yml**: Empty (not used)

### Services in Docker Compose

1. **backend** (Main FastAPI service)
   - Build: `backend/Dockerfile`
   - Ports: `9999:8000` (host:container)
   - Environment:
     - `DATABASE_URL=postgresql://postgres:postgres@db/lai_db`
     - `ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080`
     - `SERVICE_TYPE=main`
     - `TRAINING_SERVICE_URL=http://training:8000`
     - `REDIS_URL=redis://redis:6379/0`
     - `USE_CELERY=true`
     - `FIFTYONE_DATABASE_URI=mongodb://mongodb:27017`
   - Volumes: `.:/app` (entire backend directory mounted)
   - Depends on: db, redis, mongodb

2. **celery_worker** (Training tasks)
   - Build: `backend/Dockerfile.training`
   - GPU support enabled
   - Volumes: `.:/app`, `./projects:/app/projects`, `./data:/app/data`
   - Environment: Same database/redis as backend

3. **flower** (Celery monitoring)
   - Port: `5555:5555`
   - Web UI for monitoring Celery tasks

4. **redis** (Message broker)
   - Port: `6379:6379`
   - Image: `redis:7-alpine`

5. **mongodb** (FiftyOne database)
   - Port: `27017:27017`
   - Image: `mongo:7`

6. **sam_service** (Segment Anything Model)
   - Port: `8081:8081`
   - GPU support enabled
   - Build: `backend/sam_service/Dockerfile`

7. **db** (PostgreSQL)
   - Port: `5432:5432`
   - Image: `postgres:15`
   - Database: `lai_db`
   - User: `postgres`
   - Password: `postgres`

## Important Paths and Directories

### Backend Directories (inside container)
- `/app` - Main application directory (mounted from `backend/`)
- `/app/projects` - Project files (mounted from `backend/projects/`)
- `/app/data` - Data files (mounted from `backend/data/`)

### Frontend Directories
- `src/` - Source code
- `src/components/` - React components
- `src/pages/` - Page components
- `src/config/api.ts` - API configuration
- `dist/` - Build output

## API Configuration

### Frontend API URL
- Default: `http://localhost:9999`
- Can be overridden via:
  1. `localStorage.getItem("apiBaseUrl")`
  2. Environment variable `VITE_API_URL`
  3. Falls back to `http://localhost:9999`

### Backend CORS Configuration
- Allowed origins (hardcoded in `backend/app/main.py`):
  - `http://localhost:3000`
  - `http://localhost:8000`
  - `http://localhost:8080`
  - `http://localhost:8081`
  - `http://localhost:8082`
  - `http://127.0.0.1:3000`
  - `http://127.0.0.1:8000`
  - `http://127.0.0.1:8080`
  - `http://127.0.0.1:8081`
  - `http://127.0.0.1:8082`

## Development Workflow

### Starting Backend
```bash
cd backend
docker-compose up
```

### Starting Frontend
```bash
# From project root
npm run dev
# Runs on http://localhost:8080
```

### Important Notes
1. **Backend runs in Docker** - All backend code changes require container restart or are hot-reloaded if volumes are mounted
2. **Frontend runs locally** - Frontend runs outside Docker, directly on host machine
3. **API calls** - Frontend calls `http://localhost:9999` which maps to backend container port 8000
4. **Database access** - Database runs in Docker, accessible at `localhost:5432` from host

## File Structure Notes

### Backend Structure
```
backend/
├── app/
│   ├── main.py          # FastAPI app entry point
│   ├── config.py        # Service configuration
│   ├── database.py      # Database connection
│   ├── models.py        # SQLAlchemy models
│   ├── schemas.py       # Pydantic schemas
│   ├── routers/         # API route handlers
│   └── tasks/           # Celery tasks
├── Dockerfile           # Main backend Dockerfile
├── Dockerfile.training  # Training service Dockerfile
├── docker-compose.yml   # Docker Compose configuration
├── requirements.txt     # Python dependencies
└── projects/            # Project data (mounted in container)
```

### Frontend Structure
```
src/
├── components/          # React components
├── pages/              # Page components
├── hooks/              # React hooks
├── utils/              # Utility functions
├── config/
│   └── api.ts          # API configuration
└── types/              # TypeScript types
```

## Common Mistakes to Avoid

1. **Don't assume frontend runs in Docker** - It runs locally on port 8080
2. **Backend port mapping** - Backend is accessible at `localhost:9999` (not 8000) from host
3. **CORS origins** - Must match exactly what's in `backend/app/main.py`
4. **Database connection** - Use `postgresql://postgres:postgres@db/lai_db` inside containers, `localhost:5432` from host
5. **Volume mounts** - Backend code is mounted, so changes reflect immediately (with reload)
6. **API base URL** - Frontend defaults to `localhost:9999`, not `localhost:8000`
7. **Docker compose location** - Use `backend/docker-compose.yml`, not root `docker-compose.yml`

## Environment Variables

### Backend (in docker-compose.yml)
- `DATABASE_URL` - PostgreSQL connection string
- `ALLOWED_ORIGINS` - CORS allowed origins (comma-separated)
- `SERVICE_TYPE` - Service type identifier (`main` or `training`)
- `TRAINING_SERVICE_URL` - URL for training service
- `REDIS_URL` - Redis connection string
- `USE_CELERY` - Enable Celery task queue
- `FIFTYONE_DATABASE_URI` - MongoDB connection for FiftyOne

### Frontend
- `VITE_API_URL` - API base URL (optional, defaults to `http://localhost:9999`)

## Port Summary

| Service | Host Port | Container Port | Access URL |
|---------|-----------|----------------|------------|
| Backend API | 9999 | 8000 | http://localhost:9999 |
| Frontend Dev | 8080 | - | http://localhost:8080 |
| PostgreSQL | 5432 | 5432 | localhost:5432 |
| Redis | 6379 | 6379 | localhost:6379 |
| MongoDB | 27017 | 27017 | localhost:27017 |
| Flower | 5555 | 5555 | http://localhost:5555 |
| SAM Service | 8081 | 8081 | http://localhost:8081 |
| FiftyOne UI | 5151 | 5151 | http://localhost:5151 |

## Database Information

- **Type**: PostgreSQL 15
- **Database Name**: `lai_db`
- **Username**: `postgres`
- **Password**: `postgres`
- **Host (from container)**: `db`
- **Host (from host)**: `localhost`
- **Port**: `5432`

## Key Technologies

### Backend
- FastAPI
- SQLAlchemy (ORM)
- Alembic (migrations)
- Celery (task queue)
- Redis (broker)
- FiftyOne (data visualization)
- PyTorch, Ultralytics (ML)

### Frontend
- React 18
- TypeScript
- Vite
- React Router
- TanStack Query
- Radix UI
- Tailwind CSS
