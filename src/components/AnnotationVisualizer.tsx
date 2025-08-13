
import React, { useRef, useLayoutEffect, useState } from "react";
import { AnnotationSample } from "@/utils/annotations";
import { cn } from "@/lib/utils";

interface AnnotationVisualizerProps {
  annotations: (AnnotationSample & { annotationFileName?: string })[];
  imageWidth: number;
  imageHeight: number;
  className?: string;
  showFileName?: boolean;
  zoom?: number;
  pan?: { x: number; y: number };
  globalShowMasks?: boolean;
}

export const AnnotationVisualizer = ({ 
  annotations, 
  imageWidth, 
  imageHeight,
  className,
  showFileName = true,
  zoom = 1,
  pan = { x: 0, y: 0 },
  globalShowMasks = true
}: AnnotationVisualizerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerDimensions, setContainerDimensions] = useState({ width: 0, height: 0 });

  // Update container dimensions when container size changes
  useLayoutEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerDimensions({ width: rect.width, height: rect.height });
      }
    };

    updateDimensions();
    
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Calculate scaling for object-contain behavior (image fits entirely within container)
  const calculateImageScaling = () => {
    if (!containerDimensions.width || !containerDimensions.height || !imageWidth || !imageHeight) {
      return { scale: 1, offsetX: 0, offsetY: 0, displayWidth: 0, displayHeight: 0 };
    }

    // Calculate base scale to fit image entirely within container (object-contain)
    const scaleX = containerDimensions.width / imageWidth;
    const scaleY = containerDimensions.height / imageHeight;
    const baseScale = Math.min(scaleX, scaleY); // Use min for object-contain

    // Apply additional zoom factor
    const finalScale = baseScale * zoom;

    // Calculate the actual displayed dimensions
    const displayWidth = imageWidth * baseScale;
    const displayHeight = imageHeight * baseScale;

    // Calculate base offsets to center the scaled image (before zoom and pan)
    const baseOffsetX = (containerDimensions.width - displayWidth) / 2;
    const baseOffsetY = (containerDimensions.height - displayHeight) / 2;

    // Apply pan offset
    const offsetX = baseOffsetX + pan.x;
    const offsetY = baseOffsetY + pan.y;

    return { scale: finalScale, offsetX, offsetY, displayWidth, displayHeight, baseScale };
  };

  // Filter out hidden annotations before drawing
  const visibleAnnotations = annotations.filter(a => a.isVisible === undefined || a.isVisible);

  // Draw annotations on canvas
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    
    // Wait for both image and container to be ready before drawing
    if (!canvas || visibleAnnotations.length === 0 || !containerDimensions.width || !containerDimensions.height || !imageWidth || !imageHeight) {
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error('AnnotationVisualizer: Could not get canvas context');
      return;
    }

    // Set canvas size to match container exactly
    const dpr = window.devicePixelRatio || 1;
    canvas.width = containerDimensions.width * dpr;
    canvas.height = containerDimensions.height * dpr;
    canvas.style.width = `${containerDimensions.width}px`;
    canvas.style.height = `${containerDimensions.height}px`;
    ctx.scale(dpr, dpr);
    
    // Clear canvas
    ctx.clearRect(0, 0, containerDimensions.width, containerDimensions.height);

    const { scale, offsetX, offsetY } = calculateImageScaling();
    
    // Draw each annotation
    visibleAnnotations.forEach((annotation, index) => {
      const color = annotation.color || "#ea384c";
      
      // Draw segmentation mask if available and masks are enabled
      if (globalShowMasks && annotation.segmentation && annotation.segmentation.length > 0) {
        annotation.segmentation.forEach((segment, segIndex) => {
          if (!Array.isArray(segment) || segment.length < 6) { 
            return; 
          }
          
          ctx.beginPath();
          
          // Set fill style with transparency for the mask
          const hexColor = color.startsWith('#') ? color : `#${color}`;
          const opacity = (annotation as any).opacity || 0.25;
          
          // Convert hex to rgba
          const r = parseInt(hexColor.slice(1, 3), 16);
          const g = parseInt(hexColor.slice(3, 5), 16);
          const b = parseInt(hexColor.slice(5, 7), 16);
          
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
          ctx.strokeStyle = hexColor;
          ctx.lineWidth = Math.max(1, scale * 2);
          
          // Draw polygon with correct scaling and offset
          let firstPoint = true;
          for (let i = 0; i < segment.length; i += 2) {
            if (i + 1 >= segment.length) break;
            
            // Transform image coordinates to canvas coordinates with zoom and pan
            const x = offsetX + (segment[i] * scale);
            const y = offsetY + (segment[i + 1] * scale);
            
            if (firstPoint) {
              ctx.moveTo(x, y);
              firstPoint = false;
            } else {
              ctx.lineTo(x, y);
            }
          }
          
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
      }
      
      // Draw bounding box if available and individual bbox is enabled
      if (annotation.showBboxes && annotation.bbox && annotation.bbox.length === 4) {
        const [x, y, width, height] = annotation.bbox;
        
        // Transform to canvas coordinates
        const canvasX = offsetX + (x * scale);
        const canvasY = offsetY + (y * scale);
        const canvasWidth = width * scale;
        const canvasHeight = height * scale;
        
        const hexColor = color.startsWith('#') ? color : `#${color}`;
        
        ctx.strokeStyle = hexColor;
        ctx.lineWidth = Math.max(3, scale * 4); // Make it thicker
        ctx.setLineDash([]);
        
        // Draw the rectangle
        ctx.strokeRect(canvasX, canvasY, canvasWidth, canvasHeight);
        
        // Draw corner markers to make bbox more visible
        ctx.fillStyle = hexColor;
        const markerSize = 8;
        // Top-left
        ctx.fillRect(canvasX - markerSize/2, canvasY - markerSize/2, markerSize, markerSize);
        // Top-right  
        ctx.fillRect(canvasX + canvasWidth - markerSize/2, canvasY - markerSize/2, markerSize, markerSize);
        // Bottom-left
        ctx.fillRect(canvasX - markerSize/2, canvasY + canvasHeight - markerSize/2, markerSize, markerSize);
        // Bottom-right
        ctx.fillRect(canvasX + canvasWidth - markerSize/2, canvasY + canvasHeight - markerSize/2, markerSize, markerSize);
      }
    });
  }, [visibleAnnotations, containerDimensions, imageWidth, imageHeight, zoom, pan, globalShowMasks]);

  return (
    <div ref={containerRef} className={cn("relative w-full h-full", className)}>
      <canvas ref={canvasRef} className="absolute top-0 left-0 pointer-events-none" />
      {/* Show annotation file names as a badge in the top-left corner if present */}
      {showFileName && visibleAnnotations.length > 0 && (
        <div className="absolute top-1 left-1 z-10 bg-black/70 text-white text-xs rounded px-2 py-0.5 pointer-events-auto select-none max-w-[90%] overflow-hidden whitespace-nowrap text-ellipsis">
          {Array.from(new Set(visibleAnnotations.map(a => a.annotationFileName).filter(Boolean))).join(", ")}
        </div>
      )}
    </div>
  );
};
