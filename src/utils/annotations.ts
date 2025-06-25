
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
  opacity?: number;           // Optional opacity for display
}

export interface AnnotationFile {
  id: string;
  name: string;
  date: string;
  format: string;
  classCount: number;
  imageCount: number;
  matchedImageCount: number;
  datasetId: string;
  classStats?: { className: string; count: number; color: string; opacity?: number }[];
  samples?: AnnotationSample[];
  isVisible?: boolean;
  classColors?: { [className: string]: string }; // Add class color mapping
}

// Generate distinct colors for classes
export function generateClassColors(classNames: string[]): { [className: string]: string } {
  const colors: { [className: string]: string } = {};
  const predefinedColors = [
    "#ea384c", "#F97316", "#1EAEDB", "#8B5CF6", "#2ecc71", 
    "#f39c12", "#9b59b6", "#e74c3c", "#3498db", "#e67e22",
    "#95a5a6", "#34495e", "#1abc9c", "#16a085", "#27ae60"
  ];
  
  classNames.forEach((className, index) => {
    colors[className] = predefinedColors[index % predefinedColors.length];
  });
  
  return colors;
}

// Process COCO annotations
export async function processCOCOAnnotations(file: File, datasetId?: string): Promise<{
  stats: { className: string; count: number; color: string }[];
  samples: AnnotationSample[];
  matchedImages: string[];
  totalImageCount: number;   // Added field for total images in annotation file
  matchedImageCount: number; // Added field for matched images
  classColors: { [className: string]: string }; // Add class colors
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
        
        // Get all class names for color generation
        const classNames = categories.map((cat: any) => cat.name || `category_${cat.id || 'unknown'}`);
        const classColors = generateClassColors(classNames);
        
        const categoryColors: { [key: string]: string } = {};
        const processedCategories = categories.map((cat: any) => {
          const className = cat.name || `category_${cat.id || 'unknown'}`;
          const color = classColors[className];
          categoryColors[cat.id] = color;
          return { id: cat.id, name: className, color: color };
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
          matchedImageCount: matchedImages.length,
          classColors: classColors
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
