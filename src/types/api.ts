
import { Dataset, Image, Annotation, Category } from './index';

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface DatasetResponse extends ApiResponse<Dataset> {}
export interface DatasetsResponse extends ApiResponse<Dataset[]> {}
export interface ImagesResponse extends ApiResponse<Image[]> {}
export interface AnnotationsResponse extends ApiResponse<Annotation[]> {}
export interface ClassStatisticsResponse extends ApiResponse<{ className: string; count: number; color: string }[]> {}

export interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
}
