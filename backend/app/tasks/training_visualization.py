"""
Training data visualization utilities.
Creates example images with annotations to verify training data quality,
similar to Ultralytics YOLO's train_batch*.jpg files.
"""
import logging
from pathlib import Path
from typing import Dict, List, Tuple
import random

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def generate_color_palette(num_classes: int) -> List[Tuple[int, int, int]]:
    """Generate distinct colors for each class"""
    colors = []
    for i in range(num_classes):
        # Generate colors using HSV for better distribution
        hue = int((i * 180) / max(num_classes, 1))
        color_hsv = np.uint8([[[hue, 255, 255]]])
        color_bgr = cv2.cvtColor(color_hsv, cv2.COLOR_HSV2BGR)[0][0]
        colors.append((int(color_bgr[0]), int(color_bgr[1]), int(color_bgr[2])))
    return colors


def parse_yolo_label(label_path: Path, img_width: int, img_height: int, is_segmentation: bool = False):
    """
    Parse YOLO format label file.
    
    Format for detection: class_id x_center y_center width height (normalized)
    Format for segmentation: class_id x1 y1 x2 y2 ... (normalized polygon points)
    
    Returns:
        List of annotations as (class_id, coords) where coords format depends on task type
    """
    if not label_path.exists():
        return []
    
    annotations = []
    with open(label_path, 'r') as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 2:
                continue
                
            try:
                class_id = int(float(parts[0]))
            except (TypeError, ValueError):
                continue
            
            try:
                values = [float(x) for x in parts[1:]]
            except (TypeError, ValueError):
                continue
            
            if is_segmentation:
                # Ultralytics segmentation labels store polygon points after class id.
                # Be tolerant to both normalized [0..1] and pixel-coordinate inputs.
                if len(values) < 6 or (len(values) % 2) != 0:
                    continue

                needs_normalization = max((abs(v) for v in values), default=0.0) <= 1.5
                pixel_coords = []
                for i in range(0, len(values), 2):
                    if needs_normalization:
                        x = int(round(values[i] * img_width))
                        y = int(round(values[i + 1] * img_height))
                    else:
                        x = int(round(values[i]))
                        y = int(round(values[i + 1]))

                    x = max(0, min(img_width - 1, x))
                    y = max(0, min(img_height - 1, y))
                    pixel_coords.extend([x, y])

                if len(pixel_coords) < 6:
                    continue
                annotations.append(('segmentation', class_id, pixel_coords))
            else:
                # Detection: class_id x_center y_center width height
                if len(values) != 4:
                    continue
                x_center, y_center, width, height = values
                
                # Convert normalized YOLO format to pixel coordinates (xyxy)
                x1 = int((x_center - width/2) * img_width)
                y1 = int((y_center - height/2) * img_height)
                x2 = int((x_center + width/2) * img_width)
                y2 = int((y_center + height/2) * img_height)

                # Clamp so slightly-invalid labels still render a visible box.
                x1 = max(0, min(img_width - 1, x1))
                y1 = max(0, min(img_height - 1, y1))
                x2 = max(0, min(img_width - 1, x2))
                y2 = max(0, min(img_height - 1, y2))
                if x2 <= x1:
                    x2 = min(img_width - 1, x1 + 1)
                if y2 <= y1:
                    y2 = min(img_height - 1, y1 + 1)
                
                annotations.append(('bbox', class_id, [x1, y1, x2, y2]))
    
    return annotations


def draw_annotations_on_image(img: np.ndarray, annotations: List, 
                              class_names: List[str], colors: List[Tuple[int, int, int]],
                              is_segmentation: bool = False) -> np.ndarray:
    """
    Draw bounding boxes or segmentation masks on image.
    
    Args:
        img: Image array (BGR format)
        annotations: List of (type, class_id, coords)
        class_names: List of class names
        colors: List of BGR colors for each class
        is_segmentation: Whether this is a segmentation task
    """
    img_annotated = img.copy()
    
    for annotation in annotations:
        ann_type, class_id, coords = annotation

        # Be tolerant to class-index mismatches so annotations are still visible.
        if class_id < len(class_names):
            class_name = class_names[class_id]
        else:
            class_name = f"Class {class_id}"

        if colors:
            color = colors[class_id % len(colors)]
        else:
            color = (0, 255, 0)
        
        if ann_type == 'segmentation' and is_segmentation:
            # Draw segmentation polygon
            if len(coords) >= 6:  # Need at least 3 points
                # Reshape to (N, 2) for cv2.polylines
                points = np.array(coords).reshape(-1, 2).astype(np.int32)
                
                # Draw filled polygon with transparency
                overlay = img_annotated.copy()
                cv2.fillPoly(overlay, [points], color)
                cv2.addWeighted(overlay, 0.3, img_annotated, 0.7, 0, img_annotated)
                
                # Draw polygon outline
                cv2.polylines(img_annotated, [points], True, color, 2)
                
                # Draw label at first point
                if len(points) > 0:
                    label_pos = tuple(points[0])
                    # Draw label background
                    (label_w, label_h), _ = cv2.getTextSize(class_name, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
                    cv2.rectangle(img_annotated, 
                                (label_pos[0], label_pos[1] - label_h - 4),
                                (label_pos[0] + label_w, label_pos[1]), 
                                color, -1)
                    cv2.putText(img_annotated, class_name, label_pos,
                              cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        elif ann_type == 'bbox':
            # Draw bounding box
            x1, y1, x2, y2 = coords
            cv2.rectangle(img_annotated, (x1, y1), (x2, y2), color, 2)
            
            # Draw label
            label = f"{class_name}"
            (label_w, label_h), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            cv2.rectangle(img_annotated, (x1, y1 - label_h - 4), (x1 + label_w, y1), color, -1)
            cv2.putText(img_annotated, label, (x1, y1 - 2),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    
    return img_annotated


def letterbox_image(img: np.ndarray, target_size: Tuple[int, int], pad_color: Tuple[int, int, int] = (114, 114, 114)) -> np.ndarray:
    """Resize while preserving aspect ratio, then pad to target size (Ultralytics-style letterbox)."""
    target_w, target_h = target_size
    src_h, src_w = img.shape[:2]
    if src_h <= 0 or src_w <= 0:
        return np.full((target_h, target_w, 3), pad_color, dtype=np.uint8)

    scale = min(target_w / src_w, target_h / src_h)
    new_w = max(1, int(round(src_w * scale)))
    new_h = max(1, int(round(src_h * scale)))
    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_LINEAR)

    canvas = np.full((target_h, target_w, 3), pad_color, dtype=np.uint8)
    x = (target_w - new_w) // 2
    y = (target_h - new_h) // 2
    canvas[y:y + new_h, x:x + new_w] = resized
    return canvas


def create_training_examples(
    dataset_dir: Path,
    output_dir: Path,
    class_names: List[str],
    num_examples: int = 16,
    is_segmentation: bool = False,
    grid_size: Tuple[int, int] = (4, 4)
) -> None:
    """
    Create example images with annotations from training dataset.
    Similar to Ultralytics YOLO's train_batch*.jpg visualization.
    
    Args:
        dataset_dir: Path to YOLO dataset directory (contains images/ and labels/)
        output_dir: Path to save example visualizations
        class_names: List of class names
        num_examples: Number of examples to create per split
        is_segmentation: Whether this is a segmentation model
        grid_size: Grid layout (rows, cols) for mosaic view
    """
    logger.info(f"Creating training examples in {output_dir}")
    logger.info(f"Dataset directory: {dataset_dir}")
    logger.info(f"Task type: {'segmentation' if is_segmentation else 'detection'}")
    logger.info(f"Classes: {class_names}")
    
    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Generate color palette
    colors = generate_color_palette(len(class_names))
    
    # Process each split
    for split in ['train', 'val', 'test']:
        images_dir = dataset_dir / 'images' / split
        labels_dir = dataset_dir / 'labels' / split
        
        if not images_dir.exists():
            logger.warning(f"Images directory not found: {images_dir}")
            continue
        
        # Get all image files (case-insensitive extensions)
        image_files = [
            p for p in images_dir.iterdir()
            if p.is_file() and p.suffix.lower() in {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
        ]
        if not image_files:
            logger.warning(f"No images found in {images_dir}")
            continue
        
        logger.info(f"Found {len(image_files)} images in {split} split")
        
        # Prefer labeled images so previews reliably show boxes/masks.
        labeled_images = []
        unlabeled_images = []
        for img_path in image_files:
            label_path = labels_dir / f"{img_path.stem}.txt"
            if label_path.exists() and label_path.stat().st_size > 0:
                labeled_images.append(img_path)
            else:
                unlabeled_images.append(img_path)

        num_to_sample = min(num_examples, len(image_files))
        sample_labeled = min(num_to_sample, len(labeled_images))
        sampled_images = random.sample(labeled_images, sample_labeled) if sample_labeled > 0 else []
        remaining = num_to_sample - len(sampled_images)
        if remaining > 0 and unlabeled_images:
            sampled_images.extend(random.sample(unlabeled_images, min(remaining, len(unlabeled_images))))

        random.shuffle(sampled_images)
        logger.info(
            f"{split}: sampled {len(sampled_images)} images "
            f"({len([p for p in sampled_images if p in labeled_images])} labeled, "
            f"{len([p for p in sampled_images if p in unlabeled_images])} unlabeled)"
        )
        
        # Create individual annotated images
        annotated_images = []
        total_annotations = 0
        for img_path in sampled_images:
            # Read image
            img = cv2.imread(str(img_path))
            if img is None:
                logger.warning(f"Could not read image: {img_path}")
                continue
            
            img_height, img_width = img.shape[:2]
            
            # Get corresponding label file
            label_path = labels_dir / (img_path.stem + '.txt')
            
            # Parse annotations
            annotations = parse_yolo_label(label_path, img_width, img_height, is_segmentation)
            total_annotations += len(annotations)
            
            # Draw annotations
            img_annotated = draw_annotations_on_image(
                img, annotations, class_names, colors, is_segmentation
            )
            
            annotated_images.append(img_annotated)
        
        if not annotated_images:
            logger.warning(f"No valid annotated images for {split} split")
            continue

        logger.info(f"{split}: rendered {total_annotations} annotations across {len(annotated_images)} sampled images")
        
        # Create mosaic grid
        rows, cols = grid_size
        num_images = min(len(annotated_images), rows * cols)
        
        if num_images == 0:
            continue
        
        # Letterbox to same size for grid while preserving aspect ratio
        target_size = (640, 640)  # Standard size
        resized_images = []
        for img in annotated_images[:num_images]:
            resized = letterbox_image(img, target_size)
            resized_images.append(resized)
        
        # Pad with black images if needed
        while len(resized_images) < rows * cols:
            resized_images.append(np.zeros((target_size[1], target_size[0], 3), dtype=np.uint8))
        
        # Create grid
        grid_rows = []
        for i in range(rows):
            row_images = resized_images[i*cols:(i+1)*cols]
            if row_images:
                grid_row = np.hstack(row_images)
                grid_rows.append(grid_row)
        
        if grid_rows:
            grid = np.vstack(grid_rows)
            
            # Add title
            title_height = 60
            title_img = np.ones((title_height, grid.shape[1], 3), dtype=np.uint8) * 255
            title_text = f"{split.upper()} Batch - {len(annotated_images)} samples"
            cv2.putText(title_img, title_text, (20, 40),
                       cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 2)
            
            # Add class legend
            legend_height = 30 + (len(class_names) // 4 + 1) * 25
            legend_img = np.ones((legend_height, grid.shape[1], 3), dtype=np.uint8) * 240
            cv2.putText(legend_img, "Classes:", (10, 20),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
            
            for idx, class_name in enumerate(class_names):
                x = 10 + (idx % 4) * (grid.shape[1] // 4)
                y = 40 + (idx // 4) * 25
                color = colors[idx]
                cv2.rectangle(legend_img, (x, y-10), (x+15, y+5), color, -1)
                cv2.putText(legend_img, class_name, (x+20, y),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
            
            # Combine title, grid, and legend
            final_img = np.vstack([title_img, grid, legend_img])
            
            # Save
            output_path = output_dir / f"{split}_batch.jpg"
            cv2.imwrite(str(output_path), final_img)
            logger.info(f"Saved {split} batch examples to {output_path}")
        
        # Also save individual examples
        individual_dir = output_dir / split
        individual_dir.mkdir(exist_ok=True)
        for idx, img in enumerate(annotated_images[:min(4, len(annotated_images))]):
            individual_path = individual_dir / f"example_{idx+1}.jpg"
            cv2.imwrite(str(individual_path), img)
        
        logger.info(f"Saved {min(4, len(annotated_images))} individual examples to {individual_dir}")
    
    logger.info(f"Training examples created successfully in {output_dir}")
