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

// Helper: get annotation file name for an annotation
function getAnnotationFileName(annotation, annotationFiles) {
  if (!annotationFiles) return '?';
  const found = annotationFiles.find(f => Array.isArray(f.samples) && f.samples.some(s => s.id === annotation.id));
  return found ? found.fileName : '?';
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
  imageCount = undefined,
  annotationFiles = [], // <-- add this prop for file name lookup
}: ImageDetailModalProps & { annotationFiles?: any[] }) {
  const [imageDimensions, setImageDimensions] = useState({ width: 800, height: 600 });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset image loaded state when image changes
  useEffect(() => {
    setImageLoaded(false);
    setImageDimensions({ width: 800, height: 600 }); // Reset dimensions to avoid stale state
  }, [image?.id]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const dimensions = {
      width: img.naturalWidth,
      height: img.naturalHeight
    };
    
    console.log('ImageDetailModal: Image loaded with dimensions:', dimensions);
    setImageDimensions(dimensions);
    setImageLoaded(true);
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

  // Add annotationFileName to each annotation for display
  const annotationsWithFileName = annotations.map(ann => ({
    ...ann,
    annotationFileName: getAnnotationFileName(ann, annotationFiles)
  }));

  console.log('ImageDetailModal: Rendering with annotations:', {
    imageId: image.id,
    annotationsCount: annotations.length,
    imageLoaded,
    imageDimensions
  });

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
            {imageDimensions.width} × {imageDimensions.height} • {((image.fileSize || 0) / (1024 * 1024)).toFixed(2)} MB
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
              key={image?.id}
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
            {/* Only render annotations after image is loaded */}
            {imageLoaded && annotationsWithFileName && annotationsWithFileName.length > 0 && (
              <AnnotationVisualizer
                annotations={annotationsWithFileName}
                imageWidth={imageDimensions.width}
                imageHeight={imageDimensions.height}
                className="absolute inset-0"
              />
            )}
          </div>
          <div className="flex justify-between items-center pt-2">
            <div className="text-sm text-gray-400">
              {annotationsWithFileName && annotationsWithFileName.length > 0 ? (
                <div className="text-left">
                  {Object.entries(
                    annotationsWithFileName.reduce((acc, ann) => {
                      if (!acc[ann.className]) acc[ann.className] = { count: 0, names: [], color: ann.color };
                      acc[ann.className].count += 1;
                      acc[ann.className].names.push(ann.annotationFileName || '?');
                      acc[ann.className].color = ann.color;
                      return acc;
                    }, {} as Record<string, { count: number; names: string[]; color?: string }>))
                    .map(([className, { count, names, color }], idx, arr) => (
                      <span key={className} className="flex items-center gap-1">
                        <span style={{ display: 'inline-block', width: 10, height: 10, background: color || '#ea384c', borderRadius: '50%' }} />
                        {className} ({count})<br />
                        <span className="text-[10px] text-blue-200">[{[...new Set(names)].join(', ')}]</span>{idx < arr.length - 1 ? <>, </> : null}
                      </span>
                    ))}
                </div>
              ) : "No annotations to display"}
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
