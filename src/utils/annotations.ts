
export interface AnnotationSample {
  id?: string;
  imageId: string;
  datasetId?: string;  // Add datasetId field
  className: string;
  bbox: [number, number, number, number]; // [x, y, width, height] normalized 0-1
  segmentation?: number[][];  // Optional polygon points
  area?: number;              // Optional area
  confidence?: number;        // Optional confidence score
  color?: string;             // Optional color for display
}

// Process COCO annotations
export async function processCOCOAnnotations(file: File, datasetId?: string): Promise<{
  stats: { className: string; count: number; color: string }[];
  samples: AnnotationSample[];
  matchedImages: string[];
  totalImageCount: number;   // Added field for total images in annotation file
  matchedImageCount: number; // Added field for matched images
}> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const jsonString = event.target?.result as string;
        const coco = JSON.parse(jsonString);

        // Validate COCO format structure
        if (!coco.images || !Array.isArray(coco.images)) {
          throw new Error('Invalid COCO format: missing or invalid "images" field');
        }

        if (!coco.annotations || !Array.isArray(coco.annotations)) {
          throw new Error('Invalid COCO format: missing or invalid "annotations" field');
        }

        // Handle missing or invalid categories
        const categories = coco.categories && Array.isArray(coco.categories) ? coco.categories : [];
        
        const categoryColors: { [key: string]: string } = {};
        const processedCategories = categories.map((cat: any, index: number) => {
          const color = `#${((index + 1) * 5592405).toString(16).slice(0, 6)}`; // Generate distinct colors
          categoryColors[cat.id] = color;
          return { id: cat.id, name: cat.name, color: color };
        });

        const imageMap: { [key: number]: string } = {};
        coco.images.forEach((img: any) => {
          imageMap[img.id] = img.file_name;
        });

        const classCounts: { [key: string]: number } = {};
        const annotationSamples: AnnotationSample[] = coco.annotations.map((anno: any) => {
          const category = processedCategories.find(cat => cat.id === anno.category_id);
          const className = category ? category.name : `category_${anno.category_id || 'unknown'}`;
          const color = category ? category.color : '#808080'; // Default color

          classCounts[className] = (classCounts[className] || 0) + 1;

          // Handle missing bbox or invalid image dimensions
          let bbox = [0, 0, 0, 0];
          if (anno.bbox && Array.isArray(anno.bbox) && anno.bbox.length === 4) {
            // Find the corresponding image to get dimensions
            const imageInfo = coco.images.find((img: any) => img.id === anno.image_id);
            const imageWidth = imageInfo?.width || 1;
            const imageHeight = imageInfo?.height || 1;
            
            bbox = [
              anno.bbox[0] / imageWidth,
              anno.bbox[1] / imageHeight,
              anno.bbox[2] / imageWidth,
              anno.bbox[3] / imageHeight
            ];
          }

          const segmentation = anno.segmentation ? [anno.segmentation] : undefined;

          return {
            imageId: anno.image_id.toString(),
            datasetId: datasetId, // Add datasetId to each annotation
            className: className,
            bbox: bbox as [number, number, number, number],
            segmentation: segmentation,
            area: anno.area,
            color: color
          };
        });

        const stats = Object.keys(classCounts).map(className => {
          const category = processedCategories.find(cat => cat.name === className);
          return {
            className: className,
            count: classCounts[className],
            color: category ? category.color : '#808080' // Default color
          };
        });

        const matchedImages = Array.from(new Set(annotationSamples.map(anno => anno.imageId)));
        const totalImageCount = coco.images.length;

        resolve({
          stats: stats,
          samples: annotationSamples,
          matchedImages: matchedImages,
          totalImageCount: totalImageCount,
          matchedImageCount: matchedImages.length
        });

      } catch (error) {
        reject(new Error(`Failed to process COCO file: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read the file'));
    };

    reader.readAsText(file);
  });
}
