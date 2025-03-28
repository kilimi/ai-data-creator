
import { ApiConfig, ApiResponse, DatasetResponse, DatasetsResponse, ImagesResponse, AnnotationsResponse, ClassStatisticsResponse } from '@/types/api';
import { Dataset, Image, Annotation } from '@/types';
import { AnnotationSample } from '@/utils/annotations';

/**
 * API client for integrating with Laravel or other backend services
 */
export class ApiClient {
  private config: ApiConfig;
  
  constructor(config: ApiConfig) {
    this.config = config;
  }

  /**
   * Helper method to make API requests
   */
  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    try {
      const headers = new Headers({
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        ...(options.headers || {})
      });

      const response = await fetch(`${this.config.baseUrl}${endpoint}`, {
        ...options,
        headers
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      console.error('API Request Error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown API error' 
      };
    }
  }

  // Datasets endpoints
  
  /**
   * Get all datasets
   */
  async getDatasets(): Promise<DatasetsResponse> {
    return this.request<Dataset[]>('/api/datasets');
  }

  /**
   * Get a single dataset by ID
   */
  async getDataset(id: string): Promise<DatasetResponse> {
    return this.request<Dataset>(`/api/datasets/${id}`);
  }

  /**
   * Create a new dataset
   */
  async createDataset(dataset: Partial<Dataset>, logoFile?: File): Promise<DatasetResponse> {
    const formData = new FormData();
    formData.append('data', JSON.stringify(dataset));
    
    if (logoFile) {
      formData.append('logo', logoFile);
    }
    
    return this.request<Dataset>('/api/datasets', {
      method: 'POST',
      body: formData,
      headers: {} // Let browser set correct content-type for FormData
    });
  }

  /**
   * Update an existing dataset
   */
  async updateDataset(id: string, dataset: Partial<Dataset>, logoFile?: File): Promise<DatasetResponse> {
    const formData = new FormData();
    formData.append('data', JSON.stringify(dataset));
    
    if (logoFile) {
      formData.append('logo', logoFile);
    }
    
    return this.request<Dataset>(`/api/datasets/${id}`, {
      method: 'POST', // or 'PUT' depending on Laravel API
      body: formData,
      headers: {} // Let browser set correct content-type for FormData
    });
  }

  /**
   * Delete a dataset
   */
  async deleteDataset(id: string): Promise<ApiResponse<boolean>> {
    return this.request<boolean>(`/api/datasets/${id}`, {
      method: 'DELETE'
    });
  }

  // Images endpoints
  
  /**
   * Get images for a dataset
   */
  async getImages(datasetId: string): Promise<ImagesResponse> {
    return this.request<Image[]>(`/api/datasets/${datasetId}/images`);
  }

  /**
   * Upload images to a dataset
   */
  async uploadImages(datasetId: string, imageFiles: File[]): Promise<ApiResponse<number>> {
    const formData = new FormData();
    
    imageFiles.forEach(file => {
      formData.append('images[]', file);
    });
    
    return this.request<number>(`/api/datasets/${datasetId}/images`, {
      method: 'POST',
      body: formData,
      headers: {} // Let browser set correct content-type for FormData
    });
  }

  // Annotations endpoints
  
  /**
   * Get annotations for an image
   */
  async getAnnotations(datasetId: string, imageId: string): Promise<AnnotationsResponse> {
    return this.request<Annotation[]>(`/api/datasets/${datasetId}/images/${imageId}/annotations`);
  }

  /**
   * Upload COCO annotations
   */
  async uploadCOCOAnnotations(datasetId: string, annotationFile: File): Promise<ApiResponse<{
    stats: { className: string; count: number; color: string }[];
    samples: AnnotationSample[];
  }>> {
    const formData = new FormData();
    formData.append('annotation', annotationFile);
    
    return this.request<{
      stats: { className: string; count: number; color: string }[];
      samples: AnnotationSample[];
    }>(
      `/api/datasets/${datasetId}/annotations/coco`, {
        method: 'POST',
        body: formData,
        headers: {} // Let browser set correct content-type for FormData
      }
    );
  }

  /**
   * Process COCO annotations (client-side fallback)
   */
  async processCOCOAnnotations(file: File): Promise<{
    stats: { className: string; count: number; color: string }[];
    samples: AnnotationSample[];
  }> {
    // Use the existing utility function as a fallback
    try {
      const result = await import('@/utils/annotations').then(module => 
        module.processCOCOAnnotations(file)
      );
      return result;
    } catch (error) {
      console.error('Error processing COCO annotations locally:', error);
      throw error;
    }
  }
}

/**
 * Create a configured API client instance
 */
export const createApiClient = (config: ApiConfig): ApiClient => {
  return new ApiClient(config);
};
