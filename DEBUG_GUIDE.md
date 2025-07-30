# Debug Guide for LAI Backend

## Ways to See Debug Messages

### 1. Terminal Output (Real-time)
When you run the backend server, you'll see all log messages in the terminal:

```bash
cd backend
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The terminal will show:
- INFO messages with timestamps
- ERROR messages 
- DEBUG messages
- Print statements

### 2. Log File (Persistent)
All messages are also saved to `backend_debug.log` file in the backend directory:

```bash
# View the log file in real-time
tail -f backend_debug.log

# View recent log entries
tail -20 backend_debug.log

# Search for specific task
grep "Task 123" backend_debug.log
```

### 3. Using Docker Logs
If running with Docker:

```bash
# View logs from Docker container
docker logs lai-backend

# Follow logs in real-time
docker logs -f lai-backend

# View last 50 lines
docker logs --tail 50 lai-backend
```

### 4. Enhanced Debugging

#### Enable Debug Level Logging
In `app/main.py`, change the logging level:

```python
logging.basicConfig(
    level=logging.DEBUG,  # Change from INFO to DEBUG
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('backend_debug.log')
    ]
)
```

#### Add More Debug Points
Add debug statements in your code:

```python
logger.debug("Detailed variable info")
logger.info("General information")
logger.warning("Warning message")
logger.error("Error occurred")
logger.critical("Critical error")
```

### 5. Current Debug Messages Added

The following debug messages have been added to the augmentation process:

1. **Task Start**: When augmentation task begins
2. **Configuration**: Augmentation methods and parameters
3. **Dataset Validation**: Source and target dataset validation
4. **Image Processing**: Count of images found and processed
5. **Progress Updates**: Progress percentage updates
6. **Error Handling**: Detailed error messages

### 6. Testing Debug Output

Start the backend and create an augmented dataset. You should see output like:

```
2025-06-30 10:15:23,456 - app.routers.augmentations - INFO - Creating augmented dataset: MyAugmentedDataset from ["1", "2"]
2025-06-30 10:15:23,458 - app.routers.augmentations - INFO - Parsed inputs - source datasets: [1, 2], methods: ['rotation', 'flip_horizontal'], parameters: {'rotation': {'max_angle': 30}}
2025-06-30 10:15:23,460 - app.routers.augmentations - INFO - Validated 2 source datasets
2025-06-30 10:15:23,462 - app.routers.augmentations - INFO - Validated project: My Project
2025-06-30 10:15:23,465 - app.routers.augmentations - INFO - Starting augmentation task 15
2025-06-30 10:15:23,467 - app.routers.augmentations - INFO - Task 15: Found task, current status: pending
2025-06-30 10:15:23,470 - app.routers.augmentations - INFO - Task 15: Updated status to running
```

### 7. Debugging API Endpoints

Test the debug endpoint:

```bash
curl http://localhost:8000/augmentations/setup/test
```

This will show if Albumentations is properly installed and working.

### 8. Common Issues and Solutions

#### No Log Output
- Check if the backend server is running
- Verify logging configuration in main.py
- Check file permissions for backend_debug.log

#### Missing Dependencies
- Install required packages: `pip install albumentations opencv-python pillow numpy`
- Check the setup test endpoint

#### Task Not Starting
- Check database connection
- Verify task creation in the logs
- Check background task execution

### 9. Production Debugging

For production environments:
- Use structured logging (JSON format)
- Set up log rotation
- Monitor log files with tools like ELK stack
- Use application monitoring tools

### 10. Quick Debug Commands

```bash
# Start backend with verbose output
cd backend && python -m uvicorn app.main:app --reload --log-level debug

# Monitor log file
tail -f backend_debug.log | grep "Task"

# Check recent errors
tail -100 backend_debug.log | grep ERROR

# Search for specific augmentation
grep "augmentation" backend_debug.log | tail -10
```
