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
  isVisible?: boolean;        // Optional visibility for toggling in UI
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
  imageMapping?: { [imageId: string]: string }; // Map COCO image IDs to filenames
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
  imageMapping: { [imageId: string]: string }; // Map COCO image IDs to filenames
}>{
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const jsonString = event.target?.result as string;
        const data = JSON.parse(jsonString);

        // Validate COCO format structure
        if (!data.images || !Array.isArray(data.images)) {
          throw new Error('Invalid COCO format: missing or invalid "images" field');
        }

        if (!data.annotations || !Array.isArray(data.annotations)) {
          throw new Error('Invalid COCO format: missing or invalid "annotations" field');
        }

        // Handle missing or invalid categories
        const categories = data.categories && Array.isArray(data.categories) ? data.categories : [];
        
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
        data.images.forEach((img: any) => {
          imageMap[img.id] = img.file_name;
        });

        const classCounts: { [key: string]: number } = {};
        // When mapping annotations, ensure segmentation is valid
        const samples = data.annotations.map((anno: any) => {
          const category = processedCategories.find(cat => cat.id === anno.category_id);
          const className = category ? category.name : `category_${anno.category_id || 'unknown'}`;
          const color = category ? category.color : '#808080'; // Default color

          classCounts[className] = (classCounts[className] || 0) + 1;

          // Handle missing bbox or invalid image dimensions
          let bbox = [0, 0, 0, 0];
          if (anno.bbox && Array.isArray(anno.bbox) && anno.bbox.length === 4) {
            // Find the corresponding image to get dimensions
            const imageInfo = data.images.find((img: any) => img.id === anno.image_id);
            const imageWidth = imageInfo?.width || 1;
            const imageHeight = imageInfo?.height || 1;
            
            bbox = [
              anno.bbox[0] / imageWidth,
              anno.bbox[1] / imageHeight,
              anno.bbox[2] / imageWidth,
              anno.bbox[3] / imageHeight
            ];
          }

          let segmentation: number[][] | undefined = undefined;
          if (anno.segmentation && Array.isArray(anno.segmentation)) {
            // COCO polygons: array of arrays of numbers
            segmentation = anno.segmentation
              .filter((seg: any) => Array.isArray(seg) && seg.length >= 6)
              .map((seg: any) => seg.slice());
            if (segmentation.length === 0) segmentation = undefined;
          }

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

        const matchedImages = Array.from(new Set(samples.map(anno => anno.imageId)));
        const totalImageCount = data.images.length;        resolve({
          stats: stats,
          samples: samples,
          matchedImages: (matchedImages as string[]),
          totalImageCount: totalImageCount,
          matchedImageCount: matchedImages.length,
          classColors: classColors,
          imageMapping: imageMap
        });

      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read the file'));
    };

    reader.readAsText(file);
  });
}
