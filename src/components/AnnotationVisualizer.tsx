
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

  // Calculate scaling and positioning for object-cover behavior
  const calculateImageDimensions = () => {
    if (!containerDimensions.width || !containerDimensions.height || !imageWidth || !imageHeight) {
      return { scale: 1, offsetX: 0, offsetY: 0, displayWidth: 0, displayHeight: 0 };
    }

    // Calculate the scaling factor for object-cover (fill container while maintaining aspect ratio)
    const scaleX = containerDimensions.width / imageWidth;
    const scaleY = containerDimensions.height / imageHeight;
    const scale = Math.max(scaleX, scaleY); // Use max for object-cover behavior

    // Calculate the displayed dimensions
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
          ctx.fillStyle = `${color}40`; // Semi-transparent fill
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, scale * 1.5); // Scale line width appropriately
          
          // Draw polygon with proper scaling
          for (let i = 0; i < segment.length; i += 2) {
            const x = offsetX + segment[i] * scale;
            const y = offsetY + segment[i + 1] * scale;
            
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
      
      // Draw bounding box with proper scaling
      if (annotation.bbox) {
        const [x, y, width, height] = annotation.bbox;
        
        // Convert normalized coordinates to scaled pixel values
        const bboxX = offsetX + x * imageWidth * scale;
        const bboxY = offsetY + y * imageHeight * scale;
        const bboxWidth = width * imageWidth * scale;
        const bboxHeight = height * imageHeight * scale;
        
        // Only draw bounding box if segmentation is not available or very small
        if (!annotation.segmentation || annotation.segmentation.length === 0) {
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, scale * 1.5);
          ctx.strokeRect(bboxX, bboxY, bboxWidth, bboxHeight);
        }
      }
    });
  }, [annotations, containerDimensions, imageWidth, imageHeight]);

  const { scale, offsetX, offsetY } = calculateImageDimensions();

  return (
    <div 
      ref={containerRef} 
      className={cn("relative w-full h-full overflow-hidden", className)}
    >
      <canvas 
        ref={canvasRef}
        className="absolute inset-0 z-10 pointer-events-none"
      />
      
      {/* Display annotation labels with correct scaling and positioning */}
      {annotations.map((anno, index) => {
        if (!anno.bbox || !containerDimensions.width || !containerDimensions.height) return null;
        
        const color = anno.color || "#ea384c";
        
        // Calculate label position based on the bbox with proper scaling
        const labelX = offsetX + anno.bbox[0] * imageWidth * scale;
        const labelY = Math.max(8, offsetY + anno.bbox[1] * imageHeight * scale - 8);
        
        // Convert to percentage for CSS positioning
        const labelXPercent = (labelX / containerDimensions.width) * 100;
        const labelYPercent = (labelY / containerDimensions.height) * 100;
        
        // Show labels if they would be reasonably visible and within bounds
        const bboxWidthScaled = anno.bbox[2] * imageWidth * scale;
        const shouldShowLabel = scale > 0.2 && bboxWidthScaled > 20 && 
                                labelXPercent >= 0 && labelXPercent <= 95 &&
                                labelYPercent >= 0 && labelYPercent <= 95;
        
        if (!shouldShowLabel) return null;
        
        return (
          <div
            key={`label-${index}`}
            className="absolute z-20 pointer-events-auto"
            style={{
              left: `${Math.max(0, Math.min(95, labelXPercent))}%`,
              top: `${Math.max(0, Math.min(95, labelYPercent))}%`,
            }}
          >
            <Popover>
              <PopoverTrigger asChild>
                <Badge
                  className="cursor-pointer text-xs px-1 py-0.5"
                  style={{ 
                    backgroundColor: color, 
                    fontSize: Math.max(8, Math.min(12, scale * 10)),
                    color: 'white'
                  }}
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
