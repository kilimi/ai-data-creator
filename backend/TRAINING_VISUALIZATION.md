# Training Data Visualization

## Overview

During model training, the system automatically creates visualization examples of your training data with annotations. This helps verify that:
- Images are loaded correctly
- Annotations are properly formatted
- Class labels are correct
- Data augmentation is working as expected

## How It Works

After the dataset is prepared and before training begins, the system:

1. **Samples images** from each split (train/val/test)
2. **Draws annotations** on the images:
   - **Detection models**: Bounding boxes with class labels
   - **Segmentation models**: Polygons with transparency overlay + class labels
3. **Creates visualizations**:
   - Grid view: 4×4 mosaic showing 16 examples
   - Individual examples: First 4 samples saved separately
4. **Saves to `examples/` directory** in your training output folder

## Output Structure

```
/app/projects/{project_id}/training/task_{task_id}/
└── examples/
    ├── train_batch.jpg          # Grid view of train split samples
    ├── val_batch.jpg            # Grid view of val split samples
    ├── test_batch.jpg           # Grid view of test split samples (if exists)
    ├── train/
    │   ├── example_1.jpg        # Individual annotated images
    │   ├── example_2.jpg
    │   ├── example_3.jpg
    │   └── example_4.jpg
    ├── val/
    │   └── ...
    └── test/
        └── ...
```

## Visual Format

### Grid View (train_batch.jpg, val_batch.jpg, test_batch.jpg)
- **Title bar**: Shows split name and number of samples
- **4×4 grid**: Up to 16 example images with annotations
- **Legend bar**: Shows all classes with their colors

### Detection Models
- Bounding boxes drawn with class-specific colors
- Class labels displayed at top of each box
- Box thickness: 2 pixels

### Segmentation Models
- Filled polygons with 30% transparency
- Polygon outlines with class-specific colors
- Class labels at first polygon point

## Color Scheme

Classes are assigned distinct colors using HSV color space for maximum visual separation:
- Colors are evenly distributed across the hue spectrum
- Each class consistently uses the same color across all examples

## Configuration

The visualization is created automatically with these defaults:
- **Number of examples per split**: 16
- **Grid layout**: 4×4
- **Image size in grid**: 640×640 pixels
- **Individual examples saved**: First 4 per split

These settings ensure quick generation while providing comprehensive coverage of your training data.

## Troubleshooting

### No examples created
- Check that your dataset has images in the expected format (JPG/PNG)
- Verify that labels exist in the YOLO format
- Check task logs for visualization errors

### Images look wrong
- If bounding boxes are in wrong positions: Check coordinate format in source data
- If segmentation masks are incorrect: Verify polygon points are in correct order
- If colors are inconsistent: This is expected - colors are assigned based on class order

### Missing splits
- If `test_batch.jpg` is missing: Your dataset may not include a test split
- If `val_batch.jpg` is missing: Check that validation split percentage is > 0

## Performance

Visualization generation typically takes **5-15 seconds** depending on:
- Number of images in dataset
- Image resolution
- Number of annotations per image
- Whether it's detection or segmentation

This does not significantly impact overall training time.

## Similar Tools

This feature is inspired by Ultralytics YOLO's `train_batch*.jpg` files, which show:
- Mosaic-augmented training batches
- Real-time training data with augmentations applied

Our implementation focuses on verifying **source data quality** before augmentation, ensuring your annotations are correct from the start.
