
export interface AnnotationSample {
  id?: string;
  imageId: string;
  className: string;
  bbox: [number, number, number, number]; // [x, y, width, height] normalized 0-1
  segmentation?: number[][];  // Optional polygon points
  area?: number;              // Optional area
  confidence?: number;        // Optional confidence score
  color?: string;             // Optional color for display
}

// Process COCO annotations
export async function processCOCOAnnotations(file: File): Promise<{
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

        const categoryColors: { [key: string]: string } = {};
        const categories = coco.categories.map((cat: any, index: number) => {
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
          const category = categories.find(cat => cat.id === anno.category_id);
          const className = category ? category.name : 'unknown';
          const color = category ? category.color : '#808080'; // Default color

          classCounts[className] = (classCounts[className] || 0) + 1;

          const bbox = anno.bbox ? [
            anno.bbox[0] / coco.images[0].width,
            anno.bbox[1] / coco.images[0].height,
            anno.bbox[2] / coco.images[0].width,
            anno.bbox[3] / coco.images[0].height
          ] : [0, 0, 0, 0];

          const segmentation = anno.segmentation ? [anno.segmentation] : undefined;

          return {
            imageId: anno.image_id.toString(),
            className: className,
            bbox: bbox as [number, number, number, number],
            segmentation: segmentation,
            area: anno.area,
            color: color
          };
        });

        const stats = Object.keys(classCounts).map(className => {
          const category = categories.find(cat => cat.name === className);
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
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error('Failed to read the file'));
    };

    reader.readAsText(file);
  });
}
