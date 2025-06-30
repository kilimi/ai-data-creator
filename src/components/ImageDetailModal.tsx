import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Image } from "@/types";
import { Button } from "@/components/ui/button";
import { Trash2, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { AnnotationSample } from "@/utils/annotations";
import { AnnotationVisualizer } from "@/components/AnnotationVisualizer";
import { useState, useEffect, useRef } from "react";
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
  annotationFiles = [], // <-- add this prop for file name lookup
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
  
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

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
    
    if (containerRef.current && imageRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate the point in image coordinates
      const imageX = (mouseX - pan.x) / zoom;
      const imageY = (mouseY - pan.y) / zoom;
      
      // Calculate new pan to keep the mouse point fixed
      const newPanX = mouseX - imageX * newZoom;
      const newPanY = mouseY - imageY * newZoom;
      
      setZoom(newZoom);
      setPan({ x: newPanX, y: newPanY });
    }
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
    imageDimensions
  });

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] bg-gray-900 text-white border-gray-700">
        <div className="flex items-center justify-between">
          <DialogTitle>{image.fileName}</DialogTitle>
          <div className="flex items-center gap-4">
            {/* Zoom controls */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={zoomOut}
                disabled={zoom <= 0.1}
                className="border-gray-600 hover:bg-gray-800"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-sm text-gray-400 min-w-[4rem] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={zoomIn}
                disabled={zoom >= 5}
                className="border-gray-600 hover:bg-gray-800"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={resetZoom}
                className="border-gray-600 hover:bg-gray-800"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
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
          <div 
            ref={containerRef}
            className="relative bg-gray-950 rounded-lg overflow-hidden flex items-center justify-center"
            style={{ 
              height: '60vh',
              cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default'
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onDoubleClick={handleDoubleClick}
          >
            {/* Left arrow */}
            {hasPrev && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-20 bg-gray-800/70 hover:bg-gray-700"
                onClick={onPrev}
                aria-label="Previous image"
              >
                <ChevronLeft className="h-6 w-6" />
              </Button>
            )}
            
            {/* Image and annotations container */}
            <div
              className="relative flex items-center justify-center"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: '0 0',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                maxHeight: '60vh',
                maxWidth: '100%'
              }}
              onClick={handleImageClick}
            >
              {/* Image container with natural dimensions */}
              <div className="relative">
                <img
                  ref={imageRef}
                  key={image?.id}
                  src={image.url}
                  alt={image.fileName}
                  className="max-h-full max-w-full object-contain"
                  onLoad={handleImageLoad}
                  draggable={false}
                  style={{ 
                    maxHeight: '60vh',
                    maxWidth: '100%',
                    userSelect: 'none'
                  }}
                />
                
                {/* Annotations overlay - only at 100% zoom for now */}
                {imageLoaded && annotationsWithFileName && annotationsWithFileName.length > 0 && zoom === 1 && pan.x === 0 && pan.y === 0 && (
                  <AnnotationVisualizer
                    key={`${image?.id}-${annotationKey}`} // Force re-render when image or annotation key changes
                    annotations={annotationsWithFileName}
                    imageWidth={imageDimensions.width}
                    imageHeight={imageDimensions.height}
                    className="absolute inset-0 pointer-events-none"
                    showFileName={false}
                  />
                )}
              </div>
            </div>
            
            {/* Right arrow */}
            {hasNext && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-20 bg-gray-800/70 hover:bg-gray-700"
                onClick={onNext}
                aria-label="Next image"
              >
                <ChevronRight className="h-6 w-6" />
              </Button>
            )}
          </div>
          <div className="flex justify-between items-center pt-2">
            <div className="text-sm text-gray-400">
              {annotationsWithFileName && annotationsWithFileName.length > 0 ? (
                <div className="text-left">
                  {Object.entries(
                    annotationsWithFileName.reduce((acc, ann) => {
                      const key = `${ann.className}|${ann.annotationFileName || '?'}`;
                      if (!acc[key]) acc[key] = { className: ann.className, annotationFileName: ann.annotationFileName || '?', count: 0, color: ann.color };
                      acc[key].count += 1;
                      acc[key].color = ann.color;
                      return acc;
                    }, {} as Record<string, { className: string; annotationFileName: string; count: number; color?: string }>))
                    .map(([key, { className, annotationFileName, count, color }], idx, arr) => (
                      <span key={key} className="flex items-center gap-1">
                        <span style={{ display: 'inline-block', width: 10, height: 10, background: color || '#ea384c', borderRadius: '50%' }} />
                        {className} ({annotationFileName}) [{count}]{idx < arr.length - 1 ? ', ' : ''}
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
