export interface Dataset {
  id: string;
  name: string;
  description: string;
  type?: "classification" | "segmentation" | "panomatic";
  tags?: string[];
  createdAt: string;
  imageCount: number;
  annotationCount: number;
  thumbnailUrl?: string;
  projectId?: string; // Adding projectId to associate with a project
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  datasets: Dataset[];
  thumbnailUrl?: string;
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
