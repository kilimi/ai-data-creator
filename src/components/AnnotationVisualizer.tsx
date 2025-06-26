
import React, { useRef, useEffect, useState } from "react";
import { AnnotationSample } from "@/utils/annotations";
import { cn } from "@/lib/utils";

interface AnnotationVisualizerProps {
  annotations: AnnotationSample[];
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
  useEffect(() => {
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

  // Draw annotations on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || annotations.length === 0 || !containerDimensions.width || !containerDimensions.height) {
      console.log('AnnotationVisualizer: Skipping render due to missing requirements:', {
        hasCanvas: !!canvas,
        annotationsCount: annotations.length,
        containerDimensions
      });
      return;
    }

    console.log('AnnotationVisualizer: Starting render with:', {
      annotationsCount: annotations.length,
      imageSize: { width: imageWidth, height: imageHeight },
      containerSize: containerDimensions
    });

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      console.error('AnnotationVisualizer: Could not get canvas context');
      return;
    }

    // Set canvas size to match container
    canvas.width = containerDimensions.width;
    canvas.height = containerDimensions.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { scale, offsetX, offsetY } = calculateImageScaling();

    console.log('AnnotationVisualizer: Scaling info:', { scale, offsetX, offsetY });

    // Draw each annotation
    annotations.forEach((annotation, index) => {
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
            fillStyle: ctx.fillStyle
          });
          
          // Draw polygon with correct scaling
          let firstPoint = true;
          for (let i = 0; i < segment.length; i += 2) {
            if (i + 1 >= segment.length) break;
            
            // Transform image coordinates to canvas coordinates
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
          
          console.log(`AnnotationVisualizer: Completed drawing segment ${segIndex}`);
        });
      }
    });
    
    console.log('AnnotationVisualizer: Finished rendering all annotations');
  }, [annotations, containerDimensions, imageWidth, imageHeight]);

  return (
    <div ref={containerRef} className={cn("relative w-full h-full", className)}>
      <canvas ref={canvasRef} className="absolute top-0 left-0 pointer-events-none" />
    </div>
  );
};
