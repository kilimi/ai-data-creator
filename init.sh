#!/bin/bash

# Start all services
echo "Starting services..."
docker-compose up -d

# Wait for the database to be ready
echo "Waiting for database to be ready..."
sleep 10

# Initialize and run migrations
echo "Initializing database migrations..."
docker-compose exec backend alembic init migrations
docker-compose exec backend alembic revision --autogenerate -m "Initial migration"
docker-compose exec backend alembic upgrade head

echo "Setup complete! Services are running:"
echo "- Frontend: http://localhost:3000"
echo "- Backend API: http://localhost:8000"
echo "- API Documentation: http://localhost:8000/docs" 