
/**
 * Process COCO annotation file and extract class statistics and samples
 * @param file COCO format annotation JSON file
 * @returns Statistics about classes in the dataset and sample annotations
 */
export const processCOCOAnnotations = async (file: File): Promise<{ 
  stats: { className: string; count: number; color: string }[];
  samples: { imageId: string; bbox: [number, number, number, number]; className: string; confidence?: number }[];
}> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        if (!e.target?.result) {
          throw new Error("Failed to read file");
        }
        
        const content = e.target.result as string;
        const data = JSON.parse(content);
        
        // Validate COCO format
        if (!data.categories || !Array.isArray(data.categories) || !data.annotations || !Array.isArray(data.annotations)) {
          throw new Error("Invalid COCO format: missing categories or annotations");
        }
        
        // Generate statistics by counting annotations per category
        const categoryMap = new Map<number, { name: string; color: string }>();
        
        // Map category IDs to names and generate colors
        data.categories.forEach((category: { id: number; name: string }) => {
          // Generate a random color for the category for visualization
          const hue = Math.floor(Math.random() * 360);
          const color = `hsl(${hue}, 70%, 50%)`;
          
          categoryMap.set(category.id, { 
            name: category.name,
            color 
          });
        });
        
        // Count annotations per category
        const countMap = new Map<number, number>();
        
        data.annotations.forEach((annotation: { category_id: number }) => {
          const categoryId = annotation.category_id;
          countMap.set(categoryId, (countMap.get(categoryId) || 0) + 1);
        });
        
        // Format statistics for display
        const statistics = Array.from(countMap.entries()).map(([categoryId, count]) => {
          const category = categoryMap.get(categoryId);
          return {
            className: category?.name || `Unknown (${categoryId})`,
            count,
            color: category?.color || '#cccccc'
          };
        });
        
        // Sort by count (descending)
        statistics.sort((a, b) => b.count - a.count);
        
        // Extract sample annotations for visualization
        const samples: { imageId: string; bbox: [number, number, number, number]; className: string; confidence?: number }[] = [];
        
        data.annotations.slice(0, 50).forEach((annotation: { 
          image_id: string; 
          category_id: number; 
          bbox: number[]; 
          score?: number 
        }) => {
          const category = categoryMap.get(annotation.category_id);
          
          if (category) {
            // Convert from absolute to percentage coordinates for easier rendering
            // Assuming the image is 100x100%
            const bbox: [number, number, number, number] = [
              annotation.bbox[0], 
              annotation.bbox[1], 
              annotation.bbox[2], 
              annotation.bbox[3]
            ];
            
            samples.push({
              imageId: annotation.image_id.toString(),
              bbox,
              className: category.name,
              confidence: annotation.score
            });
          }
        });
        
        resolve({ stats: statistics, samples });
      } catch (error) {
        console.error("Error processing COCO annotations:", error);
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error("Failed to read the file"));
    };
    
    reader.readAsText(file);
  });
};
