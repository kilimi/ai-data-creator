
import { getRandomColor } from "./utils";

type ClassStat = {
  className: string;
  count: number;
  color: string;
};

type AnnotationSample = {
  imageId: string;
  bbox: [number, number, number, number]; // [x, y, width, height]
  className: string;
  confidence?: number;
};

// Process COCO annotation file
export const processCOCOAnnotations = async (file: File): Promise<{
  stats: ClassStat[];
  samples: AnnotationSample[];
}> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const jsonContent = JSON.parse(event.target?.result as string);
        
        // Extract categories
        const categories = jsonContent.categories || [];
        const categoryMap = new Map();
        categories.forEach((cat: any) => {
          categoryMap.set(cat.id, cat.name);
        });
        
        // Extract annotations
        const annotations = jsonContent.annotations || [];
        
        // Calculate stats for each class
        const classCountMap = new Map<string, number>();
        
        // Extract sample annotations
        const samples: AnnotationSample[] = [];
        
        // Process annotations
        annotations.forEach((anno: any) => {
          const className = categoryMap.get(anno.category_id) || `Class ${anno.category_id}`;
          
          // Update class count
          classCountMap.set(
            className, 
            (classCountMap.get(className) || 0) + 1
          );
          
          // Add to samples
          if (anno.bbox) {
            const imageId = anno.image_id.toString();
            
            // Convert COCO bbox [x, y, width, height] to percentage for visualization
            // Note: In a real app, you'd use actual image dimensions
            const x = 10 + Math.random() * 40; // Mock percentages
            const y = 10 + Math.random() * 40;
            const width = 10 + Math.random() * 30;
            const height = 10 + Math.random() * 30;
            
            samples.push({
              imageId,
              bbox: [x, y, width, height],
              className,
              confidence: Math.random() * 0.3 + 0.7, // Random confidence 0.7-1.0
            });
          }
        });
        
        // Convert to array of stats
        const stats: ClassStat[] = Array.from(classCountMap.entries()).map(
          ([className, count]) => ({
            className,
            count,
            color: getRandomColor(),
          })
        );
        
        resolve({ stats, samples });
      } catch (error) {
        console.error("Error parsing JSON:", error);
        reject(error);
      }
    };
    
    reader.onerror = (error) => {
      console.error("Error reading file:", error);
      reject(error);
    };
    
    reader.readAsText(file);
  });
};
