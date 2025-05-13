
import React from "react";
import { Trash2, Upload, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Image } from "@/types";
import { useImageLoad } from "@/utils/animations";
import { AnnotationSample } from "@/utils/annotations";
import { Card } from "@/components/ui/card";

interface ImagesGridProps {
  images: Image[];
  imageSize?: number;
  onOpenUploadDialog: () => void;
  onDeleteImage: (imageId: string) => Promise<void>;
  maxHeight?: string;
  onImageClick?: (image: Image) => void;
  annotations?: AnnotationSample[];
}

export function ImagesGrid({
  images,
  imageSize = 160,
  onOpenUploadDialog,
  onDeleteImage,
  maxHeight = "none",
  onImageClick,
  annotations = [],
}: ImagesGridProps) {
  const { getImageFadeProps } = useImageLoad();

  // Filter annotations to get only those for the current images
  const getAnnotationsForImage = (imageId: string) => {
    return annotations.filter(anno => anno.imageId === imageId);
  };

  if (!images.length) {
    return (
      <div className="flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-gray-900/30 border-gray-800">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="p-3 rounded-full bg-gray-900">
            <Upload className="h-6 w-6 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium">No images</h3>
          <p className="text-sm text-gray-400">
            Upload images to get started with your dataset
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={onOpenUploadDialog}
          >
            Upload Images
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 overflow-y-auto p-1"
      style={{ maxHeight }}
    >
      {images.map((image) => {
        const imageAnnotations = getAnnotationsForImage(image.id);
        return (
          <Card
            key={image.id}
            className="group relative overflow-hidden border-gray-800 hover:border-blue-500/80 transition-colors bg-gray-900/50"
          >
            <div
              className="aspect-square overflow-hidden relative cursor-pointer"
              onClick={() => onImageClick && onImageClick(image)}
              style={{ height: imageSize, width: imageSize }}
            >
              <img
                src={image.thumbnailUrl}
                alt={image.fileName}
                className="object-cover w-full h-full"
                {...getImageFadeProps()}
              />
              {imageAnnotations.length > 0 && (
                <div className="absolute top-2 right-2">
                  <Badge variant="secondary" className="bg-blue-600/70 backdrop-blur-sm">
                    <Tag className="h-3 w-3 mr-1" />
                    {imageAnnotations.length}
                  </Badge>
                </div>
              )}
            </div>
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Button
                variant="destructive"
                size="icon"
                className="h-9 w-9"
                onClick={() => onDeleteImage(image.id)}
              >
                <Trash2 className="h-5 w-5" />
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
