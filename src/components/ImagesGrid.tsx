
import { useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Image } from "@/types";
import { AnnotationSample } from "@/utils/annotations";
import { AnnotationVisualizer } from "@/components/AnnotationVisualizer";

interface ImagesGridProps {
  images: Image[];
  imageSize: number;
  onOpenUploadDialog: () => void;
  onDeleteImage: (imageId: string) => Promise<void>;
  onImageClick?: (image: Image) => void;
  annotations?: AnnotationSample[];
  annotationFiles?: any[];
}

// Helper: get annotation file name for an annotation
function getAnnotationFileName(annotation: any, annotationFiles: any[]): string {
  // First try to use the annotationFileName property if it exists
  if (annotation.annotationFileName) {
    return annotation.annotationFileName;
  }
  
  // Fallback: try to find the annotation file by matching samples
  if (!annotationFiles || annotationFiles.length === 0) {
    return 'Unknown';
  }
  
  const found = annotationFiles.find(f => {
    return Array.isArray(f.samples) && f.samples.some(s => {
      // Try multiple ways to match the annotation
      return s.id === annotation.id || 
             (s.imageId === annotation.imageId && s.className === annotation.className);
    });
  });
  
  return found ? (found.name || found.fileName || 'Unknown') : 'Unknown';
}

// Helper: get display name for annotation
function getAnnotationDisplayName(annotation: AnnotationSample): string {
  // Try different properties that could serve as a name
  if (annotation.name) return annotation.name;
  if (annotation.id && annotation.id !== annotation.className) return annotation.id;
  if (annotation.annotationFileName) return annotation.annotationFileName;
  
  // If no unique identifier, just return the class name
  return annotation.className;
}

export function ImagesGrid({
  images,
  imageSize,
  onOpenUploadDialog,
  onDeleteImage,
  onImageClick,
  annotations = [],
  annotationFiles = [],
}: ImagesGridProps) {
  // Only show annotations that are visible (if isVisible is defined, must be true)
  const filteredAnnotations = annotations.filter(a => a.isVisible === undefined || a.isVisible);
  
  console.log('ImagesGrid: Total annotations received:', annotations.length);
  console.log('ImagesGrid: Filtered visible annotations:', filteredAnnotations.length);
  console.log('ImagesGrid: Annotation files received:', annotationFiles.length);

  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [imageDimensions, setImageDimensions] = useState<{ [key: string]: { width: number; height: number } }>({});

  const handleDeleteClick = async (e: React.MouseEvent, imageId: string) => {
    e.stopPropagation();
    try {
      setDeletingImageId(imageId);
      await onDeleteImage(imageId);
    } catch (error) {
      console.error('Error deleting image:', error);
    } finally {
      setDeletingImageId(null);
    }
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>, imageId: string) => {
    const img = e.currentTarget;
    console.log(`ImagesGrid: Image ${imageId} loaded with dimensions:`, {
      natural: { width: img.naturalWidth, height: img.naturalHeight },
      displayed: { width: img.clientWidth, height: img.clientHeight }
    });
    
    setImageDimensions(prev => ({
      ...prev,
      [imageId]: {
        width: img.naturalWidth,
        height: img.naturalHeight
      }
    }));
    setLoadedImages(prev => new Set(prev).add(imageId));
  };

  const getImageAnnotations = (imageId: string) => {
    const imageAnnotations = filteredAnnotations.filter(annotation => annotation.imageId === imageId);
    
    if (imageAnnotations.length > 0) {
      console.log(`ImagesGrid: Found ${imageAnnotations.length} annotations for image ${imageId}:`);
      imageAnnotations.forEach((ann, idx) => {
        console.log(`  ${idx + 1}. Class: ${ann.className}, File: ${ann.annotationFileName || 'NOT SET'}, Color: ${ann.color}`);
      });
    }
    
    return imageAnnotations;
  };

  if (images.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-32 h-32 mx-auto mb-4 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center">
            <Upload className="w-12 h-12 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium mb-2">No images yet</h3>
          <p className="text-gray-500 mb-4">Upload your first images to get started</p>
          <Button onClick={onOpenUploadDialog}>
            <Upload className="w-4 h-4 mr-2" />
            Upload Images
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="grid gap-4 p-2"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${imageSize}px, 1fr))`,
      }}
    >
      {images.map((image) => {
        const imageAnnotations = getImageAnnotations(image.id);
        const imageIsLoaded = loadedImages.has(image.id);
        const dimensions = imageDimensions[image.id];
        
        return (
          <Card 
            key={image.id} 
            className="group cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all duration-200"
            onClick={() => onImageClick?.(image)}
          >
            <CardContent className="p-0 relative">
              <div 
                className="relative overflow-hidden rounded-lg"
                style={{ height: `${imageSize}px` }}
              >
                <img
                  src={image.url}
                  alt={image.fileName}
                  className="w-full h-full object-contain"
                  loading="lazy"
                  onLoad={(e) => handleImageLoad(e, image.id)}
                />
                
                {/* Annotation overlay - only render after image is loaded and we have dimensions */}
                {imageIsLoaded && dimensions && imageAnnotations.length > 0 && (
                  <div className="absolute inset-0">
                    <AnnotationVisualizer
                      annotations={imageAnnotations}
                      imageWidth={dimensions.width}
                      imageHeight={dimensions.height}
                      className="w-full h-full"
                      showFileName={false}
                    />
                  </div>
                )}
                
                {/* Delete button */}
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-2 right-2 w-8 h-8 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  onClick={(e) => handleDeleteClick(e, image.id)}
                  disabled={deletingImageId === image.id}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                
                {/* Enhanced annotation display with individual colors and actual names */}
                {imageAnnotations.length > 0 && (
                  <div className="absolute bottom-2 left-2 bg-black/80 text-white text-xs px-2 py-1 rounded max-w-[90%] break-words flex flex-wrap gap-x-2 gap-y-1">
                    {imageAnnotations.map((annotation, index) => {
                      const displayName = getAnnotationDisplayName(annotation);
                      return (
                        <span key={`${annotation.className}-${index}`} className="inline-flex items-center">
                          <span
                            style={{
                              display: 'inline-block',
                              width: 8,
                              height: 8,
                              backgroundColor: annotation.color || '#ea384c',
                              borderRadius: '50%',
                              marginRight: '4px',
                            }}
                          />
                          {annotation.className}
                          {/* Show actual annotation name if different from class name */}
                          {displayName !== annotation.className && (
                            <span className="ml-1 opacity-75">({displayName})</span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
              
              <div className="p-3">
                <p className="text-sm font-medium truncate" title={image.fileName}>
                  {image.fileName}
                </p>
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs text-gray-500">
                    {dimensions ? `${dimensions.width} × ${dimensions.height}` : `${image.width || 0} × ${image.height || 0}`}
                  </p>
                  {image.fileSize && (
                    <p className="text-xs text-gray-500">
                      {(image.fileSize / 1024 / 1024).toFixed(1)} MB
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
