
import React from "react";
import { Trash2, Upload, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Image } from "@/types";
import { useImageLoad } from "@/utils/animations";
import { AnnotationSample } from "@/utils/annotations";
import { Card } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";

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
  const getAnnotationsForImage = (imageId: string) => {
    return annotations.filter(anno => anno.imageId === imageId);
  };

  const getGridColumns = (size: number) => {
    if (size <= 120) return "grid-cols-8 sm:grid-cols-10 md:grid-cols-12 lg:grid-cols-16";
    if (size <= 160) return "grid-cols-6 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12";
    if (size <= 200) return "grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10";
    if (size <= 240) return "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8";
    return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6";
  };

  const handleImageClick = (image: Image) => {
    console.log('Image clicked:', image.fileName, 'onImageClick handler:', !!onImageClick);
    if (onImageClick) {
      onImageClick(image);
    }
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
      className={`grid ${getGridColumns(imageSize)} gap-4 overflow-y-auto p-1`}
      style={{ maxHeight }}
    >
      <AnimatePresence mode="wait">
        {images.map((image) => {
          const { isLoaded, getImageFadeProps } = useImageLoad(image.thumbnailUrl);
          const imageAnnotations = getAnnotationsForImage(image.id);
          
          return (
            <motion.div
              key={image.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2, layout: { duration: 0.3 } }}
            >
              <Card
                className="group relative overflow-hidden border-gray-800 hover:border-blue-500/80 transition-colors bg-gray-900/50 cursor-pointer"
                onClick={() => handleImageClick(image)}
              >
                <motion.div
                  className="aspect-square overflow-hidden relative"
                  style={{ height: imageSize, width: imageSize }}
                  {...getImageFadeProps()}
                >
                  <img
                    src={image.thumbnailUrl}
                    alt={image.fileName}
                    className="object-cover w-full h-full"
                  />
                  {imageAnnotations.length > 0 && (
                    <div className="absolute top-2 right-2">
                      <Badge variant="secondary" className="bg-blue-600/70 backdrop-blur-sm">
                        <Tag className="h-3 w-3 mr-1" />
                        {imageAnnotations.length}
                      </Badge>
                    </div>
                  )}
                </motion.div>
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-9 w-9"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteImage(image.id);
                    }}
                  >
                    <Trash2 className="h-5 w-5" />
                  </Button>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
