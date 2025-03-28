
import React, { useRef, useEffect } from "react";
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

  // Draw annotations on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || annotations.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match image dimensions
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
            const x = (segment[i] / 100) * canvas.width;
            const y = (segment[i + 1] / 100) * canvas.height;
            
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
        
        // Convert percentage to actual pixel coordinates
        const bboxX = (x / 100) * canvas.width;
        const bboxY = (y / 100) * canvas.height;
        const bboxWidth = (width / 100) * canvas.width;
        const bboxHeight = (height / 100) * canvas.height;
        
        // Draw rectangle
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(bboxX, bboxY, bboxWidth, bboxHeight);
      }
    });
  }, [annotations, imageWidth, imageHeight]);

  return (
    <div className={cn("relative", className)}>
      <canvas 
        ref={canvasRef}
        className="absolute inset-0 z-10 pointer-events-none"
      />
      
      {/* Display annotation labels */}
      {annotations.map((anno, index) => {
        const colorIndex = index % colors.length;
        const color = colors[colorIndex];
        
        // Position for the label based on the bbox
        const labelX = anno.bbox ? anno.bbox[0] : 10;
        const labelY = anno.bbox ? Math.max(0, anno.bbox[1] - 6) : 10;
        
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
