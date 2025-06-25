
import React, { useRef, useEffect, useState } from "react";
import { AnnotationSample } from "@/utils/annotations";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
      }
    };

    updateDimensions();
    
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  // Calculate scaling and positioning
  const calculateImageDimensions = () => {
    if (!containerDimensions.width || !containerDimensions.height || !imageWidth || !imageHeight) {
      return { scale: 1, offsetX: 0, offsetY: 0, displayWidth: 0, displayHeight: 0 };
    }

    // Calculate the scaling factor to fit the image in the container while maintaining aspect ratio
    const scaleX = containerDimensions.width / imageWidth;
    const scaleY = containerDimensions.height / imageHeight;
    const scale = Math.min(scaleX, scaleY);

    // Calculate the displayed dimensions
    const displayWidth = imageWidth * scale;
    const displayHeight = imageHeight * scale;

    // Calculate offsets to center the image
    const offsetX = (containerDimensions.width - displayWidth) / 2;
    const offsetY = (containerDimensions.height - displayHeight) / 2;

    return { scale, offsetX, offsetY, displayWidth, displayHeight };
  };

  // Draw annotations on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || annotations.length === 0 || !containerDimensions.width || !containerDimensions.height) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match container
    canvas.width = containerDimensions.width;
    canvas.height = containerDimensions.height;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { scale, offsetX, offsetY } = calculateImageDimensions();

    // Draw each annotation
    annotations.forEach((annotation) => {
      const color = annotation.color || "#ea384c";
      
      // Draw segmentation mask if available
      if (annotation.segmentation && annotation.segmentation.length > 0) {
        annotation.segmentation.forEach(segment => {
          if (segment.length < 6) return; // Need at least 3 points (6 coordinates)
          
          ctx.beginPath();
          ctx.fillStyle = `${color}33`; // Add transparency
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, scale * 2); // Scale line width but ensure minimum visibility
          
          // Draw polygon
          for (let i = 0; i < segment.length; i += 2) {
            const x = offsetX + (segment[i] / imageWidth) * (imageWidth * scale);
            const y = offsetY + (segment[i + 1] / imageHeight) * (imageHeight * scale);
            
            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        });
      }
      
      // Draw bounding box
      if (annotation.bbox) {
        const [x, y, width, height] = annotation.bbox;
        
        // Convert normalized coordinates to actual pixel values
        const bboxX = offsetX + x * imageWidth * scale;
        const bboxY = offsetY + y * imageHeight * scale;
        const bboxWidth = width * imageWidth * scale;
        const bboxHeight = height * imageHeight * scale;
        
        // Draw rectangle
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, scale * 2); // Scale line width but ensure minimum visibility
        ctx.strokeRect(bboxX, bboxY, bboxWidth, bboxHeight);
      }
    });
  }, [annotations, containerDimensions, imageWidth, imageHeight]);

  const { scale, offsetX, offsetY } = calculateImageDimensions();

  return (
    <div 
      ref={containerRef} 
      className={cn("relative w-full h-full", className)}
    >
      <canvas 
        ref={canvasRef}
        className="absolute inset-0 z-10 pointer-events-none"
      />
      
      {/* Display annotation labels with correct scaling and positioning */}
      {annotations.map((anno, index) => {
        if (!anno.bbox || !containerDimensions.width || !containerDimensions.height) return null;
        
        const color = anno.color || "#ea384c";
        
        // Calculate label position based on the bbox
        const labelX = offsetX + anno.bbox[0] * imageWidth * scale;
        const labelY = Math.max(8, offsetY + anno.bbox[1] * imageHeight * scale - 8);
        
        // Convert to percentage for CSS positioning
        const labelXPercent = (labelX / containerDimensions.width) * 100;
        const labelYPercent = (labelY / containerDimensions.height) * 100;
        
        // Only show labels if they would be reasonably visible
        const shouldShowLabel = scale > 0.3 && anno.bbox[2] * imageWidth * scale > 30;
        
        if (!shouldShowLabel) return null;
        
        return (
          <div
            key={`label-${index}`}
            className="absolute z-20 pointer-events-auto"
            style={{
              left: `${labelXPercent}%`,
              top: `${labelYPercent}%`,
            }}
          >
            <Popover>
              <PopoverTrigger asChild>
                <Badge
                  className="cursor-pointer text-xs px-1 py-0.5"
                  style={{ backgroundColor: color, fontSize: Math.max(10, scale * 12) }}
                >
                  {anno.className}
                </Badge>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2">
                <div className="grid gap-1 text-xs">
                  <div className="font-semibold">{anno.className}</div>
                  {anno.confidence && (
                    <div>Confidence: {Math.round(anno.confidence * 100)}%</div>
                  )}
                  {anno.area && (
                    <div>Area: {anno.area.toFixed(1)} px²</div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        );
      })}
    </div>
  );
};
