
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Image } from "@/types";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { AnnotationSample } from "@/utils/annotations";
import { useState, useEffect } from "react";
import { ImageZoomControls } from "@/components/ImageZoomControls";
import { ImageNavigation } from "@/components/ImageNavigation";
import { ImageViewport } from "@/components/ImageViewport";
import { ImageAnnotationDisplay } from "@/components/ImageAnnotationDisplay";

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
  return found ? found.name : '?';
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
  annotationFiles = [],
}: ImageDetailModalProps & { annotationFiles?: any[] }) {
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [imageLoaded, setImageLoaded] = useState(false);
  const [annotationKey, setAnnotationKey] = useState(0); // Force re-render key
  
  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Reset zoom and pan when image changes
  useEffect(() => {
    setImageLoaded(false);
    setImageDimensions({ width: 0, height: 0 });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
    setAnnotationKey(prev => prev + 1); // Force annotations to re-render when image changes
  }, [image?.id]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const dimensions = {
      width: img.naturalWidth,
      height: img.naturalHeight
    };
    
    console.log('ImageDetailModal: Image loaded with dimensions:', dimensions);
    setImageDimensions(dimensions);
    
    // Small delay to ensure the layout has settled before showing annotations
    setTimeout(() => {
      setImageLoaded(true);
      setAnnotationKey(prev => prev + 1); // Force annotations to re-render after image loads
    }, 100);
  };

  // Zoom functions
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newZoom = Math.max(0.1, Math.min(5, zoom + delta));
    setZoom(newZoom);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setPanStart({ x: pan.x, y: pan.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      
      setPan({
        x: panStart.x + deltaX,
        y: panStart.y + deltaY
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleDoubleClick = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const zoomIn = () => {
    const newZoom = Math.min(5, zoom + 0.25);
    setZoom(newZoom);
  };

  const zoomOut = () => {
    const newZoom = Math.max(0.1, zoom - 0.25);
    setZoom(newZoom);
    
    // If zooming out to 1 or less, reset pan
    if (newZoom <= 1) {
      setPan({ x: 0, y: 0 });
    }
  };

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Keyboard navigation and mouse events
  useEffect(() => {
    if (!isOpen) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && hasPrev && onPrev && !isDragging) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowRight" && hasNext && onNext && !isDragging) {
        e.preventDefault();
        onNext();
      } else if (e.key === "Escape") {
        onClose();
      }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (isDragging && zoom > 1) {
        const deltaX = e.clientX - dragStart.x;
        const deltaY = e.clientY - dragStart.y;
        
        setPan({
          x: panStart.x + deltaX,
          y: panStart.y + deltaY
        });
      }
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    
    if (isDragging) {
      window.addEventListener("mousemove", handleGlobalMouseMove);
      window.addEventListener("mouseup", handleGlobalMouseUp);
    }
    
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousemove", handleGlobalMouseMove);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [isOpen, hasPrev, hasNext, onPrev, onNext, isDragging, dragStart, panStart, zoom, onClose]);

  if (!image) return null;

  // Add annotationFileName to each annotation for display
  const annotationsWithFileName = annotations.map(ann => ({
    ...ann,
    annotationFileName: getAnnotationFileName(ann, annotationFiles)
  }));

  const handleImageClick = (e: React.MouseEvent) => {
    // Only refresh annotations if we're not dragging and have annotations
    if (!isDragging && annotationsWithFileName.length > 0) {
      console.log('ImageDetailModal: Refreshing annotations on click');
      setAnnotationKey(prev => prev + 1); // Force re-render of annotations
    }
  };

  console.log('ImageDetailModal: Rendering with annotations:', {
    imageId: image.id,
    annotationsCount: annotations.length,
    imageLoaded,
    imageDimensions,
    zoom,
    pan
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] bg-gray-900 text-white border-gray-700">
        <div className="flex items-center justify-between">
          <DialogTitle>{image.fileName}</DialogTitle>
          <div className="flex items-center gap-4">
            <ImageZoomControls
              zoom={zoom}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onResetZoom={resetZoom}
            />
            {imageIndex !== null && imageCount !== undefined && (
              <span className="text-sm text-gray-400">{imageIndex} of {imageCount}</span>
            )}
          </div>
        </div>
        <div className="flex flex-col space-y-2">
          <div className="text-sm text-gray-400">
            {imageDimensions.width} × {imageDimensions.height} • {((image.fileSize || 0) / (1024 * 1024)).toFixed(2)} MB
            {zoom > 1 && (
              <span className="ml-4 text-blue-400">
                🔍 Scroll to zoom • Drag to pan • Double-click to reset
              </span>
            )}
          </div>
          <div className="relative">
            <ImageViewport
              image={image}
              imageDimensions={imageDimensions}
              imageLoaded={imageLoaded}
              zoom={zoom}
              pan={pan}
              isDragging={isDragging}
              annotations={annotationsWithFileName}
              annotationKey={annotationKey}
              onImageLoad={handleImageLoad}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onDoubleClick={handleDoubleClick}
              onImageClick={handleImageClick}
            />
            
            <ImageNavigation
              hasPrev={hasPrev}
              hasNext={hasNext}
              onPrev={onPrev}
              onNext={onNext}
            />
          </div>
          <div className="flex justify-between items-center pt-2">
            <ImageAnnotationDisplay annotations={annotationsWithFileName} />
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
