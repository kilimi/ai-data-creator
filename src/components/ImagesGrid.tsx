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
      className="grid gap-4"
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
                
                {/* Annotation class names and counts badge */}
                {imageAnnotations.length > 0 && (
                  <div className="absolute bottom-2 left-2 bg-blue-600/90 text-white text-xs px-2 py-1 rounded max-w-[90%] break-words">
                    {(() => {
                      // Group annotations by file name first, then by class within each file
                      const annotationsByFile = imageAnnotations.reduce((acc, ann) => {
                        // Use annotationFileName if available, otherwise try to derive it, fallback to 'Unknown'
                        let fileName = ann.annotationFileName;
                        if (!fileName) {
                          fileName = getAnnotationFileName(ann, annotationFiles);
                        }
                        if (!fileName || fileName === 'Unknown') {
                          fileName = 'Annotation File'; // Better fallback
                        }
                        
                        if (!acc[fileName]) acc[fileName] = {};
                        
                        // Create a unique key for each class in each file
                        const classKey = ann.className;
                        if (!acc[fileName][classKey]) {
                          acc[fileName][classKey] = { count: 0, color: ann.color };
                        }
                        acc[fileName][classKey].count += 1;
                        // Always update color in case it changed
                        acc[fileName][classKey].color = ann.color;
                        return acc;
                      }, {} as Record<string, Record<string, { count: number; color?: string }>>);

                      // Create display elements for each file and its classes
                      const fileEntries = Object.entries(annotationsByFile);
                      
                      return fileEntries.map(([fileName, classes], fileIdx) => (
                        <div key={`${fileName}-${fileIdx}`} className="mb-1 last:mb-0">
                          {/* Always show file name when there are multiple files, or when explicitly requested */}
                          {fileEntries.length > 1 && (
                            <div className="text-[10px] text-blue-200 mb-0.5 truncate" title={fileName}>
                              {fileName}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(classes).map(([className, { count, color }], classIdx) => (
                              <span key={`${fileName}-${className}-${classIdx}`} className="flex items-center gap-1">
                                <span 
                                  style={{ 
                                    display: 'inline-block', 
                                    width: 8, 
                                    height: 8, 
                                    backgroundColor: color || '#ea384c', 
                                    borderRadius: '50%' 
                                  }} 
                                />
                                <span className="text-[10px]">
                                  {className} ({count})
                                  {fileEntries.length > 1 && (
                                    <span className="text-blue-200 ml-1">
                                      [{fileName}]
                                    </span>
                                  )}
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
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
