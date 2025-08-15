# Albumentations Integration

This document describes the integration of [Albumentations](https://albumentations.ai/) library for powerful image augmentation in the LAI project.

## Installation

### Option 1: Automatic Installation
Run the installation script:
```bash
cd backend
python install_albumentations.py
```

### Option 2: Manual Installation
Install the required packages manually:
```bash
pip install albumentations>=1.3.0 opencv-python>=4.8.0 pillow>=9.0.0 numpy>=1.21.0
```

### Option 3: Docker Installation
If using Docker, the packages will be installed automatically when building the container with the updated requirements.txt.

## Features

### Supported Augmentation Methods

#### Geometric Transformations
- **Rotation**: Random rotation with configurable angle range
- **Horizontal Flip**: Flip images horizontally
- **Vertical Flip**: Flip images vertically  
- **Random Scale**: Scale images up or down

#### Color Transformations
- **Random Brightness**: Adjust image brightness
- **Random Contrast**: Adjust image contrast
- **Color Jitter (Saturation)**: Adjust color saturation
- **Hue Saturation Value**: Shift color hues

#### Noise & Effects
- **Gaussian Noise**: Add random Gaussian noise
- **Gaussian Blur**: Apply blur effect

#### Advanced Transformations
- **Coarse Dropout**: Randomly mask rectangular regions (Cutout)
- **Elastic Transform**: Apply elastic deformation
- **Grid Distortion**: Apply grid-based distortion

## API Endpoints

### Test Installation
```http
GET /augmentations/setup/test
```
Tests if Albumentations is properly installed and working.

### Get Available Methods
```http
GET /augmentations/methods/available
```
Returns all available augmentation methods with their parameters and Albumentations class information.

### Create Augmented Dataset
```http
POST /augmentations/
```
Creates an augmented dataset using the selected methods and parameters.

## Example Usage

### Frontend (CreateAugmentedDatasetModal)
The frontend modal now uses real Albumentations augmentation methods. When you select augmentation methods and configure their parameters, they are applied using the actual Albumentations library.

### Backend Processing
1. **Transform Creation**: Selected methods are converted to an Albumentations `Compose` pipeline
2. **Image Processing**: Images are loaded, augmented, and saved with proper error handling
3. **Annotation Transformation**: Bounding boxes and annotations are transformed to match the augmented images
4. **Asynchronous Processing**: Large datasets are processed in the background with progress tracking

## Configuration Examples

### Rotation with Custom Angles
```json
{
  "rotation": {
    "min_angle": -45,
    "max_angle": 45
  }
}
```

### Complex Pipeline
```json
{
  "rotation": {"min_angle": -30, "max_angle": 30},
  "brightness": {"factor": 0.3},
  "gaussian_blur": {"kernel_size": 5},
  "flip_horizontal": {}
}
```

## Technical Details

### Image Loading and Saving
- **Loading**: Supports various formats through PIL and OpenCV
- **Processing**: Images are converted to RGB numpy arrays for Albumentations
- **Saving**: Augmented images are saved with optimized quality settings

### Annotation Handling
- **Bounding Boxes**: Automatically transformed to match augmented images
- **Format**: Supports COCO format ([x, y, width, height])
- **Validation**: Minimum visibility threshold ensures valid annotations

### Error Handling
- **Missing Files**: Graceful handling of missing source images
- **Transform Errors**: Fallback to original data on augmentation failures
- **Memory Management**: Efficient processing for large datasets

## File Structure

```
backend/
├── app/routers/augmentations.py    # Main augmentation logic
├── requirements.txt                # Updated with Albumentations
├── install_albumentations.py       # Installation script
└── data/images/augmented/          # Augmented images storage
```

## Performance Considerations

- **Batch Processing**: Images are processed individually with progress tracking
- **Memory Usage**: Images are processed one at a time to manage memory
- **Storage**: Augmented images are stored in organized directory structure
- **Cancellation**: Background tasks can be cancelled safely

## Troubleshooting

### Import Errors
If you see import errors for numpy, cv2, or PIL:
```bash
pip install albumentations opencv-python pillow numpy
```

### Transform Errors
Check the test endpoint to verify your setup:
```bash
curl http://localhost:9999/augmentations/setup/test
```

### Memory Issues
For large datasets, monitor memory usage and consider processing smaller batches.

## Future Enhancements

- **Additional Transforms**: More Albumentations methods can be easily added
- **Custom Pipelines**: Support for user-defined augmentation pipelines
- **GPU Acceleration**: Potential integration with GPU-accelerated transforms
- **Mixup/CutMix**: Advanced augmentation techniques requiring multiple images
