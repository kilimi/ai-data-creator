# Annotation Handling in Augmented Datasets

This guide explains how annotations are handled when creating augmented datasets in the AI Data Creator application.

## Overview

The annotation handling system allows you to:
- **Visualize annotations** from selected source datasets before augmentation
- **Configure transformation settings** for how annotations should be handled during augmentation
- **Preview annotation statistics** to understand the data distribution
- **Control annotation processing** with granular settings

## Features

### 1. Annotation Preview

When creating an augmented dataset, you can:
- **Toggle annotation preview** with the eye icon button
- **View annotation statistics** by dataset and category
- **See annotation counts** for each selected source dataset

### 2. Annotation Transformation Settings

You can configure how annotations are processed during augmentation:

#### Transform Annotations Toggle
- **Enabled**: Annotations will be transformed according to the applied augmentations
- **Disabled**: Original annotations will be copied without transformation

#### Advanced Settings (when transformation is enabled):

**Minimum Visibility Threshold** (0.0 - 1.0)
- Controls how much of an annotation must remain visible after transformation
- Annotations below this threshold may be removed or clipped
- Default: 0.3 (30% visibility required)

**Out of Bounds Handling**
- **Remove**: Delete annotations that go outside image boundaries
- **Clip**: Trim annotations to fit within image boundaries
- **Keep**: Preserve annotations as-is, even if they extend beyond image bounds
- Default: Remove

**Preserve Invalid Bounds**
- **Enabled**: Keep annotations even if they have invalid dimensions (width ≤ 0, height ≤ 0)
- **Disabled**: Remove annotations with invalid dimensions
- Default: Disabled

### 3. Supported Transformations

The system handles annotation transformation for various augmentation methods:

#### Geometric Transformations
- **Rotation**: Annotation coordinates are rotated accordingly
- **Horizontal/Vertical Flip**: Annotation positions are mirrored
- **Scaling**: Annotation dimensions and positions are scaled proportionally

#### Color Transformations
- **Brightness/Contrast/Saturation/Hue**: Annotations remain unchanged (no coordinate transformation needed)

#### Advanced Transformations
- **Elastic Transform**: Complex coordinate transformation applied
- **Grid Distortion**: Annotation coordinates follow the distortion grid
- **Cutout/Dropout**: Annotations may be partially or fully occluded

## Implementation Details

### Backend Processing

1. **Annotation Settings Storage**
   - Settings are stored in the `augmentations` table
   - `transform_annotations`: Boolean flag to enable/disable transformation
   - `annotation_settings`: JSON object containing transformation parameters

2. **Transformation Pipeline**
   - Annotations are processed after image augmentation
   - Albumentations library provides bounding box transformation support
   - Custom logic handles edge cases and validation

3. **Validation Rules**
   - Minimum visibility checking
   - Boundary validation
   - Invalid dimension handling

### Frontend Features

1. **Real-time Preview**
   - Fetches annotations from selected datasets
   - Displays statistics grouped by dataset and category
   - Auto-refreshes when dataset selection changes

2. **Interactive Controls**
   - Toggle switches for easy enabling/disabling
   - Input fields with validation for numeric parameters
   - Dropdown selectors for enumerated options

## Best Practices

### When to Enable Annotation Transformation

✅ **Enable when:**
- You need annotations to match the transformed images
- Working with object detection or segmentation tasks
- Maintaining spatial relationships is important

❌ **Disable when:**
- Working with image classification (no spatial annotations)
- Annotations are image-level labels rather than bounding boxes
- You want to preserve original annotation coordinates

### Recommended Settings

**Conservative Settings** (preserve more annotations):
- Minimum Visibility: 0.1 (10%)
- Out of Bounds: Clip
- Preserve Invalid: Enabled

**Strict Settings** (higher quality annotations):
- Minimum Visibility: 0.5 (50%)
- Out of Bounds: Remove
- Preserve Invalid: Disabled

**Balanced Settings** (recommended default):
- Minimum Visibility: 0.3 (30%)
- Out of Bounds: Remove
- Preserve Invalid: Disabled

## Troubleshooting

### Common Issues

**No annotations shown in preview:**
- Check if source datasets contain annotations
- Verify API connectivity
- Ensure datasets are properly selected

**Annotations disappearing after augmentation:**
- Lower the minimum visibility threshold
- Change out-of-bounds handling to "Clip" or "Keep"
- Enable "Preserve Invalid Bounds"

**Unexpected annotation positions:**
- Verify that the correct augmentation methods are selected
- Check if annotation format is compatible (COCO format expected)
- Review transformation parameters

### Performance Considerations

- **Large datasets**: Annotation preview may take time to load
- **Complex transformations**: Processing time increases with annotation count
- **Memory usage**: Extensive annotation data may require more resources

## API Reference

### Endpoints

**GET /datasets/{id}/annotations**
- Retrieves annotations for a specific dataset
- Used by the frontend for preview functionality

**POST /augmentations/**
- Creates augmented dataset with annotation handling
- Accepts `transform_annotations` and `annotation_settings` parameters

### Parameters

```json
{
  "transform_annotations": "true",
  "annotation_settings": {
    "minVisibilityThreshold": 0.3,
    "handleOutOfBounds": "remove",
    "preserveInvalidBounds": false
  }
}
```

## Future Enhancements

Potential improvements for the annotation handling system:

1. **Segmentation Support**: Handle polygon and mask annotations
2. **Keypoint Transformation**: Support for pose estimation annotations
3. **Annotation Validation**: Visual feedback for transformation quality
4. **Batch Operations**: Process multiple datasets more efficiently
5. **Export Options**: Different annotation format exports (YOLO, Pascal VOC, etc.)

## Related Documentation

- [Augmentation Guide](AUGMENTATION_GUIDE.md)
- [Debug Guide](DEBUG_GUIDE.md)
- [API Documentation](API_DOCS.md)
