@echo off
echo Starting services...
docker-compose up -d

echo Waiting for database to be ready...
timeout /t 10 /nobreak

echo Initializing database migrations...
docker-compose exec backend alembic init migrations
docker-compose exec backend alembic revision --autogenerate -m "Initial migration"
docker-compose exec backend alembic upgrade head

echo Setup complete! Services are running:
echo - Frontend: http://localhost:3000
echo - Backend API: http://localhost:8000
echo - API Documentation: http://localhost:8000/docs 