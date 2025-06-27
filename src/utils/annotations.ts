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

// Generate distinct random colors for classes
export function generateClassColors(classNames: string[]): { [className: string]: string } {
  const colors: { [className: string]: string } = {};
  const usedColors = new Set<string>();
  
  const predefinedColors = [
    "#ea384c", "#F97316", "#1EAEDB", "#8B5CF6", "#2ecc71", 
    "#f39c12", "#9b59b6", "#e74c3c", "#3498db", "#e67e22",
    "#95a5a6", "#34495e", "#1abc9c", "#16a085", "#27ae60",
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FECA57",
    "#FF9FF3", "#54A0FF", "#5F27CD", "#00D2D3", "#FF9F43",
    "#C44569", "#F8B500", "#6C5CE7", "#A29BFE", "#FD79A8"
  ];
  
  // Helper function to generate a random color
  const generateRandomColor = (): string => {
    const hue = Math.floor(Math.random() * 360);
    const saturation = 60 + Math.floor(Math.random() * 40); // 60-100%
    const lightness = 45 + Math.floor(Math.random() * 20);  // 45-65%
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  };
  
  // Helper function to convert HSL to hex for consistency
  const hslToHex = (hsl: string): string => {
    const hslMatch = hsl.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
    if (!hslMatch) return hsl;
    
    const h = parseInt(hslMatch[1]) / 360;
    const s = parseInt(hslMatch[2]) / 100;
    const l = parseInt(hslMatch[3]) / 100;
    
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1/3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1/3) * 255);
    
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  };
  
  classNames.forEach((className, index) => {
    let color: string;
    
    // First try to use predefined colors
    if (index < predefinedColors.length) {
      color = predefinedColors[index];
    } else {
      // Generate random colors for additional classes
      let attempts = 0;
      do {
        const hslColor = generateRandomColor();
        color = hslToHex(hslColor);
        attempts++;
      } while (usedColors.has(color) && attempts < 50); // Prevent infinite loop
    }
    
    colors[className] = color;
    usedColors.add(color);
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
