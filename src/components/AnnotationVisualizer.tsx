
import React, { useRef, useEffect, useState } from "react";
import { AnnotationSample } from "@/utils/annotations";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";

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
  const [scale, setScale] = useState<{ x: number, y: number }>({ x: 1, y: 1 });

  // Colors for segmentation masks
  const colors = [
    "#ea384c", // Red
    "#F97316", // Bright Orange
    "#1EAEDB", // Bright Blue
    "#8B5CF6", // Vivid Purple
    "#2ecc71", // Green
    "#f39c12", // Yellow
    "#9b59b6", // Purple
    "#e74c3c", // Red
  ];

  // Calculate scaling factor based on container size vs original image size
  useEffect(() => {
    const calculateScale = () => {
      if (containerRef.current && imageWidth && imageHeight) {
        const containerWidth = containerRef.current.clientWidth;
        const containerHeight = containerRef.current.clientHeight;
        
        // Calculate the scaling factor to fit the image in the container
        // while maintaining aspect ratio
        const widthScale = containerWidth / imageWidth;
        const heightScale = containerHeight / imageHeight;
        
        // Use the smaller scale to ensure the image fits completely
        const minScale = Math.min(widthScale, heightScale);
        
        // Calculate the displayed dimensions
        const displayWidth = imageWidth * minScale;
        const displayHeight = imageHeight * minScale;
        
        setScale({
          x: displayWidth / imageWidth,
          y: displayHeight / imageHeight
        });
      }
    };

    calculateScale();
    // Add resize listener to recalculate on window resize
    window.addEventListener('resize', calculateScale);
    return () => window.removeEventListener('resize', calculateScale);
  }, [imageWidth, imageHeight]);

  // Draw annotations on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || annotations.length === 0 || !imageWidth || !imageHeight) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match container dimensions
    if (containerRef.current) {
      canvas.width = containerRef.current.clientWidth;
      canvas.height = containerRef.current.clientHeight;
    }
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate the centered position of the image
    const scaledWidth = imageWidth * scale.x;
    const scaledHeight = imageHeight * scale.y;
    const offsetX = (canvas.width - scaledWidth) / 2;
    const offsetY = (canvas.height - scaledHeight) / 2;

    // Draw each annotation
    annotations.forEach((annotation, index) => {
      const colorIndex = index % colors.length;
      const color = colors[colorIndex];
      
      // Draw segmentation mask if available
      if (annotation.segmentation && annotation.segmentation.length > 0) {
        annotation.segmentation.forEach(segment => {
          if (segment.length < 6) return; // Need at least 3 points (6 coordinates)
          
          ctx.beginPath();
          // Set mask style
          ctx.fillStyle = `${color}33`; // Add transparency
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          
          // Draw polygon
          for (let i = 0; i < segment.length; i += 2) {
            // Convert normalized coordinates to actual pixel values with proper scaling
            const x = offsetX + segment[i] * imageWidth * scale.x;
            const y = offsetY + segment[i + 1] * imageHeight * scale.y;
            
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
        
        // Convert normalized coordinates to actual pixel values with proper scaling
        const bboxX = offsetX + x * imageWidth * scale.x;
        const bboxY = offsetY + y * imageHeight * scale.y;
        const bboxWidth = width * imageWidth * scale.x;
        const bboxHeight = height * imageHeight * scale.y;
        
        // Draw rectangle
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(bboxX, bboxY, bboxWidth, bboxHeight);
      }
    });
  }, [annotations, imageWidth, imageHeight, scale]);

  return (
    <div 
      ref={containerRef} 
      className={cn("relative w-full h-full", className)}
    >
      <canvas 
        ref={canvasRef}
        className="absolute inset-0 z-10 pointer-events-none"
      />
      
      {/* Display annotation labels with correct scaling */}
      {annotations.map((anno, index) => {
        const colorIndex = index % colors.length;
        const color = colors[colorIndex];
        
        if (!anno.bbox) return null;
        
        // Calculate the centered position of the image
        const scaledWidth = imageWidth * scale.x;
        const scaledHeight = imageHeight * scale.y;
        const offsetX = (containerRef.current ? (containerRef.current.clientWidth - scaledWidth) / 2 : 0) / containerRef.current?.clientWidth || 0;
        const offsetY = (containerRef.current ? (containerRef.current.clientHeight - scaledHeight) / 2 : 0) / containerRef.current?.clientHeight || 0;
        
        // Position for the label based on the bbox with proper scaling
        // Convert normalized coordinates to percentage for CSS positioning
        const labelX = offsetX * 100 + anno.bbox[0] * 100 * (scaledWidth / containerRef.current?.clientWidth || 1);
        const labelY = offsetY * 100 + Math.max(0, anno.bbox[1] * 100 * (scaledHeight / containerRef.current?.clientHeight || 1) - 6);
        
        return (
          <div
            key={`label-${index}`}
            className="absolute z-20"
            style={{
              left: `${labelX}%`,
              top: `${labelY}%`,
            }}
          >
            <Popover>
              <PopoverTrigger asChild>
                <Badge
                  className="cursor-pointer"
                  style={{ backgroundColor: color }}
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
