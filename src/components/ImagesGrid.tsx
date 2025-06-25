
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
}

export function ImagesGrid({
  images,
  imageSize,
  onOpenUploadDialog,
  onDeleteImage,
  onImageClick,
  annotations = [],
}: ImagesGridProps) {
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);

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

  const getImageAnnotations = (imageId: string) => {
    return annotations.filter(annotation => annotation.imageId === imageId);
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
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                
                {/* Annotation overlay */}
                {imageAnnotations.length > 0 && (
                  <div className="absolute inset-0">
                    <AnnotationVisualizer
                      annotations={imageAnnotations}
                      imageWidth={image.width || 1}
                      imageHeight={image.height || 1}
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
                
                {/* Annotation count badge */}
                {imageAnnotations.length > 0 && (
                  <div className="absolute bottom-2 left-2 bg-blue-600/90 text-white text-xs px-2 py-1 rounded">
                    {imageAnnotations.length} annotation{imageAnnotations.length !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
              
              <div className="p-3">
                <p className="text-sm font-medium truncate" title={image.fileName}>
                  {image.fileName}
                </p>
                <div className="flex justify-between items-center mt-1">
                  <p className="text-xs text-gray-500">
                    {image.width} × {image.height}
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
