import React, { useRef, useLayoutEffect, useState } from "react";
import { AnnotationSample } from "@/utils/annotations";
import { cn } from "@/lib/utils";

interface AnnotationVisualizerProps {
  annotations: (AnnotationSample & { annotationFileName?: string })[];
  imageWidth: number;
  imageHeight: number;
  className?: string;
}

export const AnnotationVisualizer = ({ 
  annotations, 
  imageWidth, 
  imageHeight,
  className 
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
        console.log('AnnotationVisualizer: Container dimensions updated:', { width: rect.width, height: rect.height });
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

    // Calculate scale to fit image entirely within container (object-contain)
    const scaleX = containerDimensions.width / imageWidth;
    const scaleY = containerDimensions.height / imageHeight;
    const scale = Math.min(scaleX, scaleY); // Use min for object-contain

    // Calculate the actual displayed dimensions
    const displayWidth = imageWidth * scale;
    const displayHeight = imageHeight * scale;

    // Calculate offsets to center the scaled image
    const offsetX = (containerDimensions.width - displayWidth) / 2;
    const offsetY = (containerDimensions.height - displayHeight) / 2;

    return { scale, offsetX, offsetY, displayWidth, displayHeight };
  };

  // Filter out hidden annotations before drawing
  const visibleAnnotations = annotations.filter(a => a.isVisible === undefined || a.isVisible);

  // Draw annotations on canvas
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    
    // Wait for both image and container to be ready before drawing
    if (!canvas || visibleAnnotations.length === 0 || !containerDimensions.width || !containerDimensions.height || !imageWidth || !imageHeight) {
      console.log('AnnotationVisualizer: Skipping render due to missing requirements:', {
        hasCanvas: !!canvas,
        annotationsCount: visibleAnnotations.length,
        containerDimensions,
        imageWidth,
        imageHeight
      });
      return;
    }

    console.log('AnnotationVisualizer: Starting render with:', {
      annotationsCount: visibleAnnotations.length,
      imageSize: { width: imageWidth, height: imageHeight },
      containerSize: containerDimensions
    });

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

    console.log('AnnotationVisualizer: Scaling info:', { 
      scale, 
      offsetX, 
      offsetY,
      imageSize: { width: imageWidth, height: imageHeight },
      containerSize: containerDimensions
    });

    // Draw each annotation
    visibleAnnotations.forEach((annotation, index) => {
      const color = annotation.color || "#ea384c";
      
      console.log(`AnnotationVisualizer: Processing annotation ${index}:`, {
        className: annotation.className,
        color,
        hasSegmentation: !!(annotation.segmentation && annotation.segmentation.length > 0)
      });
      
      // Draw segmentation mask if available
      if (annotation.segmentation && annotation.segmentation.length > 0) {
        annotation.segmentation.forEach((segment, segIndex) => {
          if (!Array.isArray(segment) || segment.length < 6) { 
            console.log('AnnotationVisualizer: Skipping invalid segment', segment);
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
          
          console.log(`AnnotationVisualizer: Drawing segment ${segIndex} with ${segment.length / 2} points`, {
            color: hexColor,
            opacity,
            fillStyle: ctx.fillStyle,
            lineWidth: ctx.lineWidth
          });
          
          // Draw polygon with correct scaling
          let firstPoint = true;
          for (let i = 0; i < segment.length; i += 2) {
            if (i + 1 >= segment.length) break;
            
            // Transform image coordinates to canvas coordinates
            // Note: segment coordinates are in absolute pixel values from the original image
            const x = offsetX + (segment[i] * scale);
            const y = offsetY + (segment[i + 1] * scale);
            
            console.log(`AnnotationVisualizer: Point ${i/2}:`, {
              original: [segment[i], segment[i + 1]],
              scaled: [x, y],
              scale,
              offset: [offsetX, offsetY]
            });
            
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
          
          console.log(`AnnotationVisualizer: Completed drawing segment ${segIndex}`);
        });
      }
    });
    
    console.log('AnnotationVisualizer: Finished rendering all annotations');
  }, [visibleAnnotations, containerDimensions, imageWidth, imageHeight]);

  return (
    <div ref={containerRef} className={cn("relative w-full h-full", className)}>
      <canvas ref={canvasRef} className="absolute top-0 left-0 pointer-events-none" />
      {/* Show annotation file names as a badge in the top-left corner if present */}
      {visibleAnnotations.length > 0 && (
        <div className="absolute top-1 left-1 z-10 bg-black/70 text-white text-xs rounded px-2 py-0.5 pointer-events-auto select-none max-w-[90%] overflow-hidden whitespace-nowrap text-ellipsis">
          {Array.from(new Set(visibleAnnotations.map(a => a.annotationFileName).filter(Boolean))).join(", ")}
        </div>
      )}
    </div>
  );
};
