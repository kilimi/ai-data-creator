import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Image } from "@/types";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { AnnotationSample } from "@/utils/annotations";
import { AnnotationVisualizer } from "@/components/AnnotationVisualizer";
import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface ImageDetailModalProps {
  image: Image | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: (imageId: string) => Promise<void>;
  annotations?: AnnotationSample[];
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  imageIndex?: number | null;
  imageCount?: number;
}

export function ImageDetailModal({ 
  image, 
  isOpen, 
  onClose, 
  onDelete,
  annotations = [],
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  imageIndex = null,
  imageCount = undefined
}: ImageDetailModalProps) {
  const [imageDimensions, setImageDimensions] = useState({ width: 800, height: 600 });

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight
    });
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasPrev && onPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" && hasNext && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, hasPrev, hasNext, onPrev, onNext]);

  if (!image) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl bg-gray-900 text-white border-gray-700">
        <div className="flex items-center justify-between">
          <DialogTitle>{image.fileName}</DialogTitle>
          {imageIndex !== null && imageCount !== undefined && (
            <span className="text-sm text-gray-400">{imageIndex} of {imageCount}</span>
          )}
        </div>
        <div className="flex flex-col space-y-2">
          <div className="text-sm text-gray-400">
            {imageDimensions.width} × {imageDimensions.height} • {(image.fileSize / (1024 * 1024)).toFixed(2)} MB
          </div>
          <div className="relative aspect-video bg-gray-950 rounded-lg overflow-hidden flex items-center justify-center">
            {/* Left arrow */}
            {hasPrev && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-gray-800/70 hover:bg-gray-700"
                onClick={onPrev}
                aria-label="Previous image"
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
            )}
            <img
              src={image.url}
              alt={image.fileName}
              className="max-h-full max-w-full object-contain"
              onLoad={handleImageLoad}
            />
            {/* Right arrow */}
            {hasNext && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-gray-800/70 hover:bg-gray-700"
                onClick={onNext}
                aria-label="Next image"
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            )}
            {annotations && annotations.length > 0 && (
              <AnnotationVisualizer
                annotations={annotations}
                imageWidth={imageDimensions.width}
                imageHeight={imageDimensions.height}
                className="absolute inset-0"
              />
            )}
          </div>
          <div className="flex justify-between items-center pt-2">
            <div className="text-sm text-gray-400">
              {annotations && annotations.length > 0 
                ? `${annotations.length} annotations displayed` 
                : "No annotations to display"}
            </div>
            {onDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDelete(image.id);
                  onClose();
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Image
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
