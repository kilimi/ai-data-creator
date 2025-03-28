
import { getRandomColor } from "./utils";

type ClassStat = {
  className: string;
  count: number;
  color: string;
};

export type AnnotationSample = {
  imageId: string;
  bbox: [number, number, number, number]; // [x, y, width, height]
  className: string;
  confidence?: number;
  segmentation?: number[][]; // COCO format segmentation points [[x1,y1,x2,y2,...], [x1,y1,...]]
  area?: number;
};

// Process COCO annotation file
export const processCOCOAnnotations = async (file: File): Promise<{
  stats: ClassStat[];
  samples: AnnotationSample[];
  matchedImages: number;
}> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (event) => {
      try {
        const jsonContent = JSON.parse(event.target?.result as string);
        
        // Extract images from COCO format
        const cocoImages = jsonContent.images || [];
        const imageMap = new Map();
        cocoImages.forEach((img: any) => {
          // Store mapping from COCO image ID to our dataset image ID
          // For mock purposes, we're using the COCO ID as our image ID
          imageMap.set(img.id, img.id.toString());
        });
        
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
          if (anno.bbox || anno.segmentation) {
            const imageId = anno.image_id.toString();
            
            // In real implementation, use the mapping from COCO image ID to our image ID
            // const mappedImageId = imageMap.get(anno.image_id) || imageId;
            
            // For demo purposes, convert COCO bbox [x, y, width, height] to normalized coordinates
            const x = anno.bbox ? anno.bbox[0] / 100 : 0; // Normalized by 100 for demo
            const y = anno.bbox ? anno.bbox[1] / 100 : 0;
            const width = anno.bbox ? anno.bbox[2] / 100 : 0;
            const height = anno.bbox ? anno.bbox[3] / 100 : 0;
            
            samples.push({
              imageId,
              bbox: [x, y, width, height],
              className,
              confidence: Math.random() * 0.3 + 0.7, // Random confidence 0.7-1.0
              segmentation: anno.segmentation || undefined,
              area: anno.area || undefined
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
        
        // Count unique image IDs in our samples
        const uniqueImageCount = new Set(samples.map(s => s.imageId)).size;
        
        resolve({ 
          stats, 
          samples,
          matchedImages: uniqueImageCount
        });
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
