#!/bin/bash
# Script to manage YOLO training service

ACTION=$1

case $ACTION in
  start)
    echo "Starting YOLO training service..."
    docker-compose up -d training
    echo "Training service started on port 9998"
    echo "Check logs with: docker-compose logs -f training"
    ;;
  stop)
    echo "Stopping YOLO training service..."
    docker-compose stop training
    ;;
  restart)
    echo "Restarting YOLO training service..."
    docker-compose restart training
    ;;
  logs)
    docker-compose logs -f training
    ;;
  build)
    echo "Building YOLO training service..."
    docker-compose build training
    ;;
  rebuild)
    echo "Rebuilding YOLO training service (no cache)..."
    docker-compose build --no-cache training
    ;;
  shell)
    echo "Opening shell in training container..."
    docker-compose exec training /bin/bash
    ;;
  status)
    docker-compose ps training
    ;;
  *)
    echo "YOLO Training Service Manager"
    echo ""
    echo "Usage: ./manage_training.sh [command]"
    echo ""
    echo "Commands:"
    echo "  start    - Start the training service"
    echo "  stop     - Stop the training service"
    echo "  restart  - Restart the training service"
    echo "  logs     - View training service logs"
    echo "  build    - Build the training service image"
    echo "  rebuild  - Rebuild without cache"
    echo "  shell    - Open bash shell in training container"
    echo "  status   - Show training service status"
    ;;
esac
