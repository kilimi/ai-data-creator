export interface Dataset {
  id: number;
  name: string;
  description: string;
  type: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  image_count: number;
  annotation_count: number;
  project_id: number;
  thumbnailUrl?: string;
  logo_url?: string;
}

export interface Project {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  is_project: boolean;
  datasets: Dataset[];
  thumbnailUrl?: string; // Adding this property as optional
  logo_url?: string;
  tags?: string[];
}

export interface Image {
  id: string;
  datasetId: string;
  fileName: string;
  fileSize: number;
  width: number;
  height: number;
  url: string;
  thumbnailUrl: string;
  uploadedAt: string;
  annotationsCount: number;
  annotations?: Annotation[]; // Optional: array of polygon or bbox annotations for this image
}

export interface Annotation {
  id: string;
  imageId: string;
  datasetId: string;
  category: string;
  bbox?: [number, number, number, number]; // [x, y, width, height]
  segmentation?: number[][]; // COCO format segmentation
  area?: number;
  uploadedAt: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
}

export type StatsTimeframe = 'day' | 'week' | 'month' | 'year';

export interface DatasetFormValues {
  name: string;
  description: string;
  type?: "classification" | "segmentation" | "panomatic";
  tags?: string[];
}

export interface DatasetStats {
  imageCount: number;
  annotationCount: number;
  categoriesCount: number;
  recentActivity: {
    date: string;
    imagesAdded: number;
    annotationsAdded: number;
  }[];
}
