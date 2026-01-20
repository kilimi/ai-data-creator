from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from pathlib import Path
import logging
from datetime import datetime
import shutil
import os
import subprocess
import tempfile
import json
import uuid

from ..database import get_db
from .. import models
from ultralytics import YOLO

router = APIRouter()
logger = logging.getLogger(__name__)

# Check if Celery is available
USE_CELERY = os.environ.get('USE_CELERY', 'true').lower() == 'true'
celery_export_task = None

if USE_CELERY:
    try:
        from app.tasks.export_tasks import export_yolo_model as celery_export_task
        logger.info("Celery task queue enabled for exports")
    except ImportError as e:
        logger.warning(f"Celery not available: {e}. Set USE_CELERY=false to disable.")
        USE_CELERY = False


class ExportRequest(BaseModel):
    """Request model for exporting a model"""
    task_id: int  # Training task ID
    checkpoint: str = "best"  # "best" or "last"
    export_format: str = "onnx"  # Currently only "onnx" supported
    task_name: Optional[str] = None


@router.post("/export/yolo/start")
async def start_yolo_export(
    request: ExportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Start exporting a YOLO model to ONNX format.
    Creates a background task for the export process.
    """
    try:
        # Get the training task
        training_task = db.query(models.Task).filter(
            models.Task.id == request.task_id,
            models.Task.task_type == 'yolo_training'
        ).first()
        
        if not training_task:
            raise HTTPException(status_code=404, detail="Training task not found")
        
        if training_task.status != 'completed':
            raise HTTPException(
                status_code=400, 
                detail=f"Training task must be completed. Current status: {training_task.status}"
            )
        
        # Get model path from task metadata
        task_metadata = training_task.task_metadata or {}
        model_path = None
        
        if request.checkpoint == "best":
            model_path = task_metadata.get('best_model')
        else:
            last_model = task_metadata.get('last_model')
            if last_model:
                model_path = last_model
            elif task_metadata.get('results_dir'):
                model_path = str(Path(task_metadata['results_dir']) / "weights" / "last.pt")
        
        if not model_path or not Path(model_path).exists():
            raise HTTPException(
                status_code=404,
                detail=f"Model checkpoint '{request.checkpoint}' not found at {model_path}"
            )
        
        # Create export task
        task_name = request.task_name or f"Export {training_task.name} - {request.checkpoint} to {request.export_format.upper()}"
        
        export_task = models.Task(
            project_id=training_task.project_id,
            name=task_name,
            task_type="model_export",
            status="pending",
            task_metadata={
                "training_task_id": request.task_id,
                "model_path": model_path,
                "checkpoint": request.checkpoint,
                "export_format": request.export_format,
                "original_task_name": training_task.name
            }
        )
        
        db.add(export_task)
        db.commit()
        db.refresh(export_task)
        
        # Prepare export config
        export_config = {
            "model_path": model_path,
            "checkpoint": request.checkpoint,
            "export_format": request.export_format,
            "training_task_id": request.task_id,
            "output_dir": str(Path(training_task.task_metadata.get('results_dir', '.')) / "exports")
        }
        
        # Start export in background
        if USE_CELERY:
            # Use Celery for proper task queuing
            celery_task = celery_export_task.delay(export_task.id, export_config)
            logger.info(f"Queued export task {export_task.id} in Celery (task_id: {celery_task.id})")
            
            # Store Celery task ID in metadata
            export_task.task_metadata = {
                **export_task.task_metadata,
                "celery_task_id": celery_task.id
            }
            db.commit()
        else:
            # Fallback to FastAPI BackgroundTasks (not recommended for production)
            logger.warning("Using BackgroundTasks instead of Celery - tasks may run concurrently!")
            # Note: Would need to implement background task handler for exports
            raise HTTPException(status_code=500, detail="Export requires Celery. Set USE_CELERY=true.")
        
        return {
            "success": True,
            "task_id": export_task.id,
            "message": "Export started",
            "data": {
                "task_id": export_task.id,
                "name": export_task.name,
                "status": export_task.status
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting export: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error starting export: {str(e)}")


# Background task function removed - now using Celery task in app.tasks.export_tasks


@router.get("/export/download/{task_id}")
async def download_exported_model(
    task_id: int,
    db: Session = Depends(get_db)
):
    """
    Download an exported model file.
    """
    task = db.query(models.Task).filter(
        models.Task.id == task_id,
        models.Task.task_type == 'model_export'
    ).first()
    
    if not task:
        raise HTTPException(status_code=404, detail="Export task not found")
    
    if task.status != 'completed':
        raise HTTPException(
            status_code=400,
            detail=f"Export task is not completed. Current status: {task.status}"
        )
    
    task_metadata = task.task_metadata or {}
    exported_file = task_metadata.get('exported_file')
    
    if not exported_file:
        raise HTTPException(status_code=404, detail="Exported file not found in task metadata")
    
    file_path = Path(exported_file)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Exported file not found at {exported_file}")
    
    # Use task name as filename, sanitize it and preserve .onnx extension
    import re
    task_name = task.name or f"export_{task_id}"
    # Remove invalid filename characters and replace with underscore
    sanitized_name = re.sub(r'[<>:"/\\|?*]', '_', task_name)
    # Remove leading/trailing spaces and dots
    sanitized_name = sanitized_name.strip('. ')
    # Ensure it ends with .onnx extension
    if not sanitized_name.lower().endswith('.onnx'):
        sanitized_name = f"{sanitized_name}.onnx"
    
    return FileResponse(
        path=str(file_path),
        filename=sanitized_name,
        media_type='application/octet-stream'
    )


@router.post("/export/test-inference")
async def test_onnx_inference(
    image: UploadFile = File(...),
    onnx_file_path: str = Form(...),
    task_id: int = Form(...),
    db: Session = Depends(get_db)
):
    """
    Test ONNX model inference on an uploaded image.
    Returns predictions with bounding boxes and confidence scores.
    """
    try:
        # Verify the export task exists
        task = db.query(models.Task).filter(
            models.Task.id == task_id,
            models.Task.task_type == 'model_export'
        ).first()
        
        if not task:
            raise HTTPException(status_code=404, detail="Export task not found")
        
        if task.status != 'completed':
            raise HTTPException(
                status_code=400,
                detail=f"Export task is not completed. Current status: {task.status}"
            )
        
        # Verify ONNX file exists
        onnx_path = Path(onnx_file_path)
        if not onnx_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"ONNX file not found at {onnx_file_path}"
            )
        
        # Get task metadata for class names
        task_metadata = task.task_metadata or {}
        training_task_id = task_metadata.get('training_task_id')
        class_names = []
        
        if training_task_id:
            training_task = db.query(models.Task).filter(
                models.Task.id == training_task_id
            ).first()
            if training_task and training_task.task_metadata:
                class_names = training_task.task_metadata.get('class_names', [])
        
        # Save uploaded image to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp_image:
            tmp_image_path = tmp_image.name
            content = await image.read()
            tmp_image.write(content)
        
        try:
            # Create temporary output directory
            output_dir = Path(tempfile.gettempdir()) / f"inference_{uuid.uuid4().hex[:8]}"
            output_dir.mkdir(exist_ok=True)
            
            # Create Python script for inference
            script_path = output_dir / "run_inference.py"
            result_json_path = output_dir / "results.json"
            annotated_image_path = output_dir / "annotated.jpg"
            
            # Generate the inference script
            inference_script = """import onnxruntime as ort
import numpy as np
from PIL import Image
import cv2
import json
import sys

def preprocess_image(image_path, target_size=(640, 640)):
    '''Preprocess image for YOLO ONNX model'''
    img = cv2.imread(image_path)
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    original_shape = img_rgb.shape[:2]
    
    # Resize maintaining aspect ratio
    scale = min(target_size[0] / original_shape[1], target_size[1] / original_shape[0])
    new_width = int(original_shape[1] * scale)
    new_height = int(original_shape[0] * scale)
    
    img_resized = cv2.resize(img_rgb, (new_width, new_height), interpolation=cv2.INTER_LINEAR)
    
    # Pad to target size
    img_padded = np.zeros((target_size[1], target_size[0], 3), dtype=np.uint8)
    img_padded[:new_height, :new_width] = img_resized
    
    # Normalize to [0, 1] and convert to float32
    img_normalized = img_padded.astype(np.float32) / 255.0
    
    # Convert to NCHW format
    img_input = np.transpose(img_normalized, (2, 0, 1))
    img_input = np.expand_dims(img_input, axis=0)
    
    return img_input, original_shape, scale, img

def postprocess_output(output, original_shape, scale, conf_threshold=0.25, iou_threshold=0.45):
    '''Postprocess YOLO output to get bounding boxes'''
    predictions = []
    
    # YOLO output format: [batch, num_detections, 85] where 85 = [x, y, w, h, conf, class_scores...]
    # Or [batch, 25200, 85] for YOLOv8
    if len(output.shape) == 3:
        output = output[0]  # Remove batch dimension
    
    # Filter by confidence
    if output.shape[1] > 4:
        # Format: [x, y, w, h, conf, class1, class2, ...]
        boxes = output[:, :4]
        confidences = output[:, 4:5]
        class_scores = output[:, 5:]
        
        # Get class with highest score
        class_ids = np.argmax(class_scores, axis=1)
        class_confidences = np.max(class_scores, axis=1)
        
        # Combined confidence
        final_confidences = confidences.flatten() * class_confidences
        
        # Filter by confidence threshold
        valid_indices = final_confidences > conf_threshold
        
        if np.any(valid_indices):
            boxes = boxes[valid_indices]
            final_confidences = final_confidences[valid_indices]
            class_ids = class_ids[valid_indices]
            
            # Convert from center format to xyxy
            x_center = boxes[:, 0]
            y_center = boxes[:, 1]
            width = boxes[:, 2]
            height = boxes[:, 3]
            
            x1 = (x_center - width / 2) / scale
            y1 = (y_center - height / 2) / scale
            x2 = (x_center + width / 2) / scale
            y2 = (y_center + height / 2) / scale
            
            # Clip to image bounds
            x1 = np.clip(x1, 0, original_shape[1])
            y1 = np.clip(y1, 0, original_shape[0])
            x2 = np.clip(x2, 0, original_shape[1])
            y2 = np.clip(y2, 0, original_shape[0])
            
            # Apply NMS
            indices = cv2.dnn.NMSBoxes(
                [(x1[i], y1[i], x2[i] - x1[i], y2[i] - y1[i]) for i in range(len(x1))],
                final_confidences.tolist(),
                conf_threshold,
                iou_threshold
            )
            
            if len(indices) > 0:
                for idx in indices.flatten():
                    predictions.append({
                        'bbox': [float(x1[idx]), float(y1[idx]), float(x2[idx] - x1[idx]), float(y2[idx] - y1[idx])],
                        'confidence': float(final_confidences[idx]),
                        'class_id': int(class_ids[idx])
                    })
    
    return predictions

def draw_predictions(img, predictions, class_names):
    '''Draw bounding boxes on image'''
    img_annotated = img.copy()
    
    for pred in predictions:
        x, y, w, h = pred['bbox']
        x, y, w, h = int(x), int(y), int(w), int(h)
        
        class_id = pred.get('class_id', 0)
        class_name = class_names[class_id] if class_id < len(class_names) else f'Class {class_id}'
        confidence = pred['confidence']
        
        # Draw bounding box
        color = (0, 255, 0)
        cv2.rectangle(img_annotated, (x, y), (x + w, y + h), color, 2)
        
        # Draw label
        label = f'{class_name}: {confidence:.2f}'
        (label_width, label_height), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(img_annotated, (x, y - label_height - 10), (x + label_width, y), color, -1)
        cv2.putText(img_annotated, label, (x, y - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
    
    return img_annotated

# Main inference
onnx_path = sys.argv[1]
image_path = sys.argv[2]
output_json = sys.argv[3]
output_image = sys.argv[4]
class_names_json = sys.argv[5] if len(sys.argv) > 5 else '[]'

class_names = json.loads(class_names_json)

# Load ONNX model
session = ort.InferenceSession(onnx_path)

# Get input shape
input_name = session.get_inputs()[0].name
input_shape = session.get_inputs()[0].shape
target_size = (input_shape[3], input_shape[2]) if len(input_shape) == 4 else (640, 640)

# Preprocess image
img_input, original_shape, scale, original_img = preprocess_image(image_path, target_size)

# Run inference
outputs = session.run(None, {input_name: img_input})
output = outputs[0]

# Postprocess
predictions = postprocess_output(output, original_shape, scale)

# Add class names
for pred in predictions:
    class_id = pred.get('class_id', 0)
    pred['class'] = class_names[class_id] if class_id < len(class_names) else f'Class {class_id}'

# Draw annotations
annotated_img = draw_predictions(original_img, predictions, class_names)
cv2.imwrite(output_image, annotated_img)

# Save results
results = {
    'predictions': predictions,
    'num_predictions': len(predictions)
}

with open(output_json, 'w') as f:
    json.dump(results, f, indent=2)

print(f"Found {len(predictions)} predictions")
"""
            
            with open(script_path, 'w') as f:
                f.write(inference_script)
            
            # Run inference script
            # Try to use the same Python interpreter that's running this script
            import sys
            python_executable = sys.executable
            
            class_names_json = json.dumps(class_names)
            cmd = [
                python_executable,
                str(script_path),
                str(onnx_path),
                tmp_image_path,
                str(result_json_path),
                str(annotated_image_path),
                class_names_json
            ]
            
            logger.info(f"Running inference with command: {' '.join(cmd)}")
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60,
                env=os.environ.copy()  # Use the same environment
            )
            
            if result.returncode != 0:
                error_msg = result.stderr or result.stdout or "Unknown error"
                logger.error(f"Inference script error: {error_msg}")
                raise Exception(f"Inference failed: {error_msg}")
            
            # Read results
            with open(result_json_path, 'r') as f:
                inference_results = json.load(f)
            
            # Copy annotated image to static directory for serving
            static_dir = Path("static/inference_results")
            static_dir.mkdir(parents=True, exist_ok=True)
            annotated_filename = f"annotated_{task_id}_{uuid.uuid4().hex[:8]}.jpg"
            annotated_static_path = static_dir / annotated_filename
            shutil.copy2(str(annotated_image_path), str(annotated_static_path))
            
            # Cleanup temporary files
            os.unlink(tmp_image_path)
            shutil.rmtree(output_dir, ignore_errors=True)
            
            return JSONResponse({
                "success": True,
                "result": {
                    "predictions": inference_results.get('predictions', []),
                    "image_url": f"/static/inference_results/{annotated_filename}"
                }
            })
            
        except Exception as e:
            # Cleanup on error
            if os.path.exists(tmp_image_path):
                os.unlink(tmp_image_path)
            logger.error(f"Error running inference: {str(e)}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Inference error: {str(e)}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in test inference: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
