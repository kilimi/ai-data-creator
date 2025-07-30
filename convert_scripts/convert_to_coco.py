#!/usr/bin/env python3
"""
Convert LabelMe-style annotations to COCO format.

This script converts polygon annotations from LabelMe JSON format to COCO format.
It processes all JSON files in a directory and creates a single COCO annotations file.
"""

import json
import os
import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple, Any
import logging

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def get_image_size(image_path: str) -> Tuple[int, int]:
    """
    Get image dimensions. Falls back to default if image can't be read.
    
    Args:
        image_path: Path to the image file
        
    Returns:
        Tuple of (width, height)
    """
    try:
        from PIL import Image
        with Image.open(image_path) as img:
            return img.size
    except ImportError:
        logger.warning("PIL not available. Install with: pip install Pillow")
        return (3840, 2160)  # Default size based on your data
    except Exception as e:
        logger.warning(f"Could not read image {image_path}: {e}")
        return (3840, 2160)  # Default size


def polygon_to_bbox(points: List[List[float]]) -> List[float]:
    """
    Convert polygon points to bounding box [x, y, width, height].
    
    Args:
        points: List of [x, y] coordinates
        
    Returns:
        Bounding box as [x, y, width, height]
    """
    x_coords = [point[0] for point in points]
    y_coords = [point[1] for point in points]
    
    x_min, x_max = min(x_coords), max(x_coords)
    y_min, y_max = min(y_coords), max(y_coords)
    
    return [x_min, y_min, x_max - x_min, y_max - y_min]


def calculate_polygon_area(points: List[List[float]]) -> float:
    """
    Calculate polygon area using the shoelace formula.
    
    Args:
        points: List of [x, y] coordinates
        
    Returns:
        Area of the polygon
    """
    if len(points) < 3:
        return 0.0
    
    area = 0.0
    n = len(points)
    
    for i in range(n):
        j = (i + 1) % n
        area += points[i][0] * points[j][1]
        area -= points[j][0] * points[i][1]
    
    return abs(area) / 2.0


def flatten_polygon_points(points: List[List[float]]) -> List[float]:
    """
    Flatten polygon points from [[x1, y1], [x2, y2], ...] to [x1, y1, x2, y2, ...].
    
    Args:
        points: List of [x, y] coordinates
        
    Returns:
        Flattened list of coordinates
    """
    return [coord for point in points for coord in point]


def convert_labelme_to_coco(annotations_dir: str, images_dir: str = None, output_file: str = "annotations.json") -> Dict[str, Any]:
    """
    Convert LabelMe annotations to COCO format.
    
    Args:
        annotations_dir: Directory containing LabelMe JSON files
        images_dir: Directory containing images (optional, for getting image dimensions)
        output_file: Output COCO JSON file path
        
    Returns:
        COCO format dictionary
    """
    annotations_dir = Path(annotations_dir)
    if images_dir:
        images_dir = Path(images_dir)
    
    # Initialize COCO structure
    coco_data = {
        "info": {
            "description": "Converted from LabelMe format",
            "url": "",
            "version": "1.0",
            "year": datetime.now().year,
            "contributor": "LabelMe to COCO Converter",
            "date_created": datetime.now().isoformat()
        },
        "licenses": [
            {
                "id": 1,
                "name": "Unknown",
                "url": ""
            }
        ],
        "images": [],
        "annotations": [],
        "categories": []
    }
    
    # Track categories and their IDs
    category_map = {}
    category_id = 1
    
    # Track image IDs
    image_id = 1
    annotation_id = 1
    
    # Process all JSON files
    json_files = list(annotations_dir.glob("*.json"))
    logger.info(f"Found {len(json_files)} JSON files to process")
    
    for json_file in json_files:
        try:
            with open(json_file, 'r', encoding='utf-8') as f:
                labelme_data = json.load(f)
            
            # Get image filename
            image_filename = labelme_data.get("imagePath", json_file.stem + ".jpg")
            
            # Try to get image dimensions
            if images_dir and (images_dir / image_filename).exists():
                width, height = get_image_size(images_dir / image_filename)
            else:
                # Try to find image in the same directory as JSON
                image_path = json_file.parent / image_filename
                if image_path.exists():
                    width, height = get_image_size(str(image_path))
                else:
                    logger.warning(f"Image not found for {json_file.name}, using default dimensions")
                    width, height = get_image_size("")  # Will use default
            
            # Add image info
            image_info = {
                "id": image_id,
                "width": width,
                "height": height,
                "file_name": image_filename,
                "license": 1,
                "flickr_url": "",
                "coco_url": "",
                "date_captured": ""
            }
            coco_data["images"].append(image_info)
            
            # Process shapes (annotations)
            shapes = labelme_data.get("shapes", [])
            logger.info(f"Processing {len(shapes)} annotations in {json_file.name}")
            
            for shape in shapes:
                label = shape.get("label", "unknown")
                points = shape.get("points", [])
                shape_type = shape.get("shape_type", "polygon")
                
                # Add category if not exists
                if label not in category_map:
                    category_map[label] = category_id
                    coco_data["categories"].append({
                        "id": category_id,
                        "name": label,
                        "supercategory": ""
                    })
                    category_id += 1
                
                # Only process polygons for now
                if shape_type == "polygon" and len(points) >= 3:
                    # Calculate bounding box and area
                    bbox = polygon_to_bbox(points)
                    area = calculate_polygon_area(points)
                    segmentation = flatten_polygon_points(points)
                    
                    # Create annotation
                    annotation = {
                        "id": annotation_id,
                        "image_id": image_id,
                        "category_id": category_map[label],
                        "segmentation": [segmentation],
                        "area": area,
                        "bbox": bbox,
                        "iscrowd": 0
                    }
                    
                    coco_data["annotations"].append(annotation)
                    annotation_id += 1
                else:
                    logger.warning(f"Skipping {shape_type} with {len(points)} points in {json_file.name}")
            
            image_id += 1
            
        except Exception as e:
            logger.error(f"Error processing {json_file}: {e}")
            continue
    
    # Save COCO format file
    output_path = Path(output_file)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(coco_data, f, indent=2)
    
    logger.info(f"Conversion complete!")
    logger.info(f"- Processed {len(coco_data['images'])} images")
    logger.info(f"- Created {len(coco_data['annotations'])} annotations")
    logger.info(f"- Found {len(coco_data['categories'])} categories: {list(category_map.keys())}")
    logger.info(f"- Output saved to: {output_path.absolute()}")
    
    return coco_data


def main():
    """Main function to handle command line arguments."""
    parser = argparse.ArgumentParser(description="Convert LabelMe annotations to COCO format")
    parser.add_argument("annotations_dir", help="Directory containing LabelMe JSON files")
    parser.add_argument("--images_dir", help="Directory containing images (optional, for getting dimensions)")
    parser.add_argument("--output", "-o", default="annotations.json", help="Output COCO JSON file (default: annotations.json)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose logging")
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    # Validate input directory
    if not os.path.isdir(args.annotations_dir):
        logger.error(f"Annotations directory does not exist: {args.annotations_dir}")
        return 1
    
    if args.images_dir and not os.path.isdir(args.images_dir):
        logger.error(f"Images directory does not exist: {args.images_dir}")
        return 1
    
    try:
        convert_labelme_to_coco(args.annotations_dir, args.images_dir, args.output)
        return 0
    except Exception as e:
        logger.error(f"Conversion failed: {e}")
        return 1


if __name__ == "__main__":
    exit(main())
