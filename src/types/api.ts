
import { Dataset, Image, Annotation, Project } from './index';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ProjectResponse extends ApiResponse<Project> {}
export interface ProjectsResponse extends ApiResponse<Project[]> {}
export interface DatasetResponse extends ApiResponse<Dataset> {}
export interface DatasetsResponse extends ApiResponse<Dataset[]> {}
export interface ImagesResponse extends ApiResponse<Image[]> {}
export interface AnnotationsResponse extends ApiResponse<Annotation[]> {}

export interface ApiConfig {
  baseUrl: string;
  isAccessible?: () => Promise<boolean>;
}
