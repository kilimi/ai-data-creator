import { ApiConfig, ApiResponse, DatasetResponse, DatasetsResponse, ImagesResponse, AnnotationsResponse, ClassStatisticsResponse, ProjectResponse, ProjectsResponse } from '@/types/api';
import { Dataset, Image, Annotation, Project } from '@/types';
import { AnnotationSample } from '@/utils/annotations';

/**
 * API client for integrating with FastAPI backend
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
        'Accept': 'application/json',
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        ...(options.headers || {})
      });

      // Ensure endpoint starts with slash and trim any /api prefix
      const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
      const finalEndpoint = cleanEndpoint.replace('/api/', '/');

      // Don't set Content-Type for FormData requests
      if (!(options.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(`${this.config.baseUrl}${finalEndpoint}`, {
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

  // Projects endpoints
  
  /**
   * Get all projects
   */
  async getProjects(): Promise<ProjectsResponse> {
    return this.request<Project[]>('/projects/');
  }

  /**
   * Get a single project by ID
   */
  async getProject(id: string): Promise<ProjectResponse> {
    return this.request<Project>(`/projects/${id}`);
  }

  /**
   * Create a new project
   */
  async createProject(project: Partial<Project>, logoFile?: File): Promise<ProjectResponse> {
    const formData = new FormData();
    
    // FastAPI expects direct form fields, not JSON
    if (project.name) formData.append('name', project.name);
    if (project.description) formData.append('description', project.description);
    
    if (logoFile) {
      formData.append('logo', logoFile);
    }
    
    return this.request<Project>('/projects/', {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Update an existing project
   */
  async updateProject(id: string, project: Partial<Project>, logoFile?: File): Promise<ProjectResponse> {
    const formData = new FormData();
    
    // FastAPI expects direct form fields, not JSON
    if (project.name) formData.append('name', project.name);
    if (project.description) formData.append('description', project.description);
    
    if (logoFile) {
      formData.append('logo', logoFile);
    }
    
    return this.request<Project>(`/projects/${id}/`, {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Delete a project
   */
  async deleteProject(id: string): Promise<ApiResponse<boolean>> {
    return this.request<boolean>(`/projects/${id}`, {
      method: 'DELETE'
    });
  }
  
  /**
   * Get datasets for a specific project
   */
  async getProjectDatasets(projectId: string): Promise<DatasetsResponse> {
    return this.request<Dataset[]>(`/projects/${projectId}/datasets`);
  }

  // Datasets endpoints
  
  /**
   * Get all datasets
   */
  async getDatasets(): Promise<DatasetsResponse> {
    return this.request<Dataset[]>('/datasets');
  }

  /**
   * Get a single dataset by ID
   */
  async getDataset(id: string): Promise<DatasetResponse> {
    return this.request<Dataset>(`/datasets/${id}`);
  }

  /**
   * Create a new dataset
   */
  async createDataset(dataset: Partial<Dataset>, logoFile?: File): Promise<DatasetResponse> {
    const formData = new FormData();
    
    // FastAPI expects direct form fields, not JSON
    if (dataset.name) formData.append('name', dataset.name);
    if (dataset.description) formData.append('description', dataset.description);
    
    if (logoFile) {
      formData.append('logo', logoFile);
    }
    
    return this.request<Dataset>('/datasets/', {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Update an existing dataset
   */
  async updateDataset(id: string, dataset: Partial<Dataset>, logoFile?: File): Promise<DatasetResponse> {
    const formData = new FormData();
    
    // FastAPI expects direct form fields, not JSON
    if (dataset.name) formData.append('name', dataset.name);
    if (dataset.description) formData.append('description', dataset.description);
    
    if (logoFile) {
      formData.append('logo', logoFile);
    }
    
    return this.request<Dataset>(`/datasets/${id}/`, {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Delete a dataset
   */
  async deleteDataset(id: string): Promise<ApiResponse<boolean>> {
    return this.request<boolean>(`/datasets/${id}`, {
      method: 'DELETE'
    });
  }

  // Images endpoints
  
  /**
   * Get images for a dataset
   */
  async getImages(datasetId: string): Promise<ImagesResponse> {
    return this.request<Image[]>(`/datasets/${datasetId}/images`);
  }

  /**
   * Upload images to a dataset
   */
  async uploadImages(datasetId: string, imageFiles: File[]): Promise<ApiResponse<number>> {
    const formData = new FormData();
    
    imageFiles.forEach(file => {
      formData.append('images[]', file);
    });
    
    return this.request<number>(`/datasets/${datasetId}/images`, {
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
    return this.request<Annotation[]>(`/datasets/${datasetId}/images/${imageId}/annotations`);
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
      `/datasets/${datasetId}/annotations/coco`, {
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
