import { ApiConfig, ApiResponse } from '@/types/api';
import { Dataset, Project, Image } from '@/types';

/**
 * Simple API client for interacting with FastAPI backend
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
      const url = `${this.config.baseUrl}${endpoint}`;
      console.log(`Making request to: ${url}`);
      
      // Set default headers if not provided
      if (!options.headers) {
        options.headers = {
          'Accept': 'application/json',
        };
      }
      
      // Don't set Content-Type header for FormData
      if (!(options.body instanceof FormData)) {
        (options.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        credentials: 'include', // Add this to handle cookies if needed
      });
      
      clearTimeout(timeoutId);

      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error(`Failed to parse response: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }

      if (!response.ok) {
        const errorMessage = data.detail || `${response.status} ${response.statusText}`;
        console.error("API error:", data);
        return {
          success: false,
          error: errorMessage
        };
      }

      // If the response has a success field, use it directly
      if (typeof data.success === 'boolean') {
        return data as ApiResponse<T>;
      }

      // Otherwise wrap the data in a success response
      return { 
        success: true, 
        data: data 
      };
    } catch (error) {
      console.error('API Request Error:', error);
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: 'Request timed out. Please check your connection and try again.'
        };
      }
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown API error'
      };
    }
  }

  // Test connection to the API
  async testConnection(): Promise<ApiResponse<{ status: string }>> {
    try {
      const url = `${this.config.baseUrl}/health-check`;
      console.log(`Testing connection to: ${url}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return { success: true, data: { status: 'connected' } };
      } else {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      console.error('API Connection Test Error:', error);
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: 'Connection test timed out. Please check your server and try again.'
        };
      }
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown API error' 
      };
    }
  }

  // Projects endpoints
  
  async getProjects(): Promise<ApiResponse<Project[]>> {
    return this.request<Project[]>('/projects/');
  }

  async getProject(id: string): Promise<ApiResponse<Project>> {
    return this.request<Project>(`/projects/${id}`);
  }

  async createProject(formData: FormData): Promise<ApiResponse<Project>> {
    console.log("Creating project with FormData:", formData);
    // Log formData contents for debugging
    for (const pair of formData.entries()) {
      console.log(`${pair[0]}: ${pair[1] instanceof File ? `File: ${pair[1].name}` : pair[1]}`);
    }
    
    return this.request<Project>('/projects/', {
      method: 'POST',
      body: formData,
    });
  }

  async updateProject(id: string | number, formData: FormData): Promise<ApiResponse<Project>> {
    console.log(`Updating project ${id} with FormData:`, formData);
    // Log formData contents for debugging
    for (const pair of formData.entries()) {
      console.log(`${pair[0]}: ${pair[1] instanceof File ? `File: ${pair[1].name}` : pair[1]}`);
    }
    
    return this.request<Project>(`/projects/${id}`, {
      method: 'PUT',
      body: formData,
    });
  }

  async deleteProject(id: number | string): Promise<ApiResponse<{success: boolean; message: string}>> {
    return this.request(`/projects/${id}`, {
      method: 'DELETE'
    });
  }

  async duplicateProject(id: string | number): Promise<ApiResponse<Project>> {
    return this.request<Project>(`/projects/${id}/duplicate`, {
      method: 'POST'
    });
  }

  // Datasets endpoints
  
  async getDatasets(): Promise<ApiResponse<Dataset[]>> {
    return this.request<Dataset[]>('/datasets/');
  }

  async getDataset(id: string): Promise<ApiResponse<Dataset>> {
    return this.request<Dataset>(`/datasets/${id}`);
  }

  async createDataset(formData: FormData): Promise<ApiResponse<Dataset>> {
    return this.request<Dataset>('/datasets/', {
      method: 'POST',
      body: formData,
    });
  }

  // Removed old createAugmentedDataset method - replaced with async version below

  async updateDataset(id: string | number, formData: FormData): Promise<ApiResponse<Dataset>> {
    return this.request<Dataset>(`/datasets/${id}`, {
      method: 'PUT',
      body: formData,
    });
  }

  async deleteDataset(id: number | string): Promise<ApiResponse<{success: boolean; message: string}>> {
    return this.request(`/datasets/${id}`, {
      method: 'DELETE'
    });
  }

  async duplicateDataset(datasetId: number): Promise<ApiResponse<Dataset>> {
    try {
      const response = await fetch(`${this.config.baseUrl}/datasets/${datasetId}/duplicate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to duplicate dataset',
      };
    }
  }

  async uploadImages(datasetId: string | number, formData: FormData): Promise<ApiResponse<any>> {
    return this.request(`/datasets/${datasetId}/images`, {
      method: 'POST',
      body: formData
    });
  }

  async getImages(datasetId: string | number): Promise<ApiResponse<Image[]>> {
    return this.request<Image[]>(`/datasets/${datasetId}/images`);
  }

  async deleteImage(datasetId: string | number, imageId: string): Promise<ApiResponse<any>> {
    return this.request(`/datasets/${datasetId}/images/${imageId}`, {
      method: 'DELETE'
    });
  }

  // Annotations endpoints
  async getAnnotations(datasetId: string | number): Promise<ApiResponse<any[]>> {
    return this.request<any[]>(`/datasets/${datasetId}/annotations`);
  }

  async getAnnotation(datasetId: string | number, annotationId: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/datasets/${datasetId}/annotations/${annotationId}`);
  }

  async deleteAnnotation(datasetId: string | number, annotationId: string): Promise<ApiResponse<any>> {
    return this.request(`/datasets/${datasetId}/annotations/${annotationId}`, {
      method: 'DELETE'
    });
  }

  async renameAnnotation(datasetId: string | number, annotationId: string, newName: string): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('new_name', newName);
    return this.request(`/datasets/${datasetId}/annotations/${annotationId}/rename`, {
      method: 'PUT',
      body: formData
    });
  }

  async updateAnnotationTags(datasetId: string | number, annotationId: string, tags: string[]): Promise<ApiResponse<any>> {
    const formData = new FormData();
    tags.forEach(tag => formData.append('tags', tag));
    return this.request(`/datasets/${datasetId}/annotations/${annotationId}/tags`, {
      method: 'PUT',
      body: formData
    });
  }

  async importAnnotations(datasetId: string | number, file: File, annotationType?: string): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('file', file);
    if (annotationType && annotationType !== 'any') {
      formData.append('annotation_type', annotationType);
    }
    return this.request(`/datasets/${datasetId}/import-annotations`, {
      method: 'POST',
      body: formData
    });
  }

  /**
   * Create an augmented dataset asynchronously
   */
  async createAugmentedDataset(formData: FormData): Promise<ApiResponse<{
    success: boolean;
    message: string;
    task_id: number;
    dataset_id: number;
    status: string;
  }>> {
    return this.request('/augmentations/', {
      method: 'POST',
      body: formData
    });
  }

  /**
   * Get task status and progress
   */
  async getTask(taskId: number): Promise<ApiResponse<{
    id: number;
    name: string;
    description: string;
    task_type: string;
    status: string;
    progress: number;
    created_at: string;
    started_at?: string;
    completed_at?: string;
    error_message?: string;
    project_id: number;
    task_metadata?: any;
  }>> {
    return this.request(`/tasks/${taskId}`);
  }

  /**
   * Get tasks with optional filtering
   */
  async getTasks(params?: {
    project_id?: number;
    task_type?: string;
    status?: string;
    skip?: number;
    limit?: number;
  }): Promise<ApiResponse<Array<{
    id: number;
    name: string;
    description: string;
    task_type: string;
    status: string;
    progress: number;
    created_at: string;
    started_at?: string;
    completed_at?: string;
    error_message?: string;
    project_id: number;
    task_metadata?: any;
  }>>> {
    const searchParams = new URLSearchParams();
    if (params?.project_id) searchParams.append('project_id', params.project_id.toString());
    if (params?.task_type) searchParams.append('task_type', params.task_type);
    if (params?.status) searchParams.append('status', params.status);
    if (params?.skip) searchParams.append('skip', params.skip.toString());
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    
    const queryString = searchParams.toString();
    const endpoint = queryString ? `/tasks/?${queryString}` : '/tasks/';
    
    return this.request(endpoint);
  }

  /**
   * Get active tasks (pending, running)
   */
  async getActiveTasks(projectId?: number): Promise<ApiResponse<Array<{
    id: number;
    name: string;
    description: string;
    task_type: string;
    status: string;
    progress: number;
    created_at: string;
    started_at?: string;
    completed_at?: string;
    error_message?: string;
    project_id: number;
    metadata?: any;
  }>>> {
    const searchParams = new URLSearchParams();
    if (projectId) searchParams.append('project_id', projectId.toString());
    
    // Get tasks that are pending or running
    const pendingTasks = await this.getTasks({
      project_id: projectId,
      status: 'pending'
    });
    
    const runningTasks = await this.getTasks({
      project_id: projectId,
      status: 'running'
    });
    
    // Combine and return active tasks
    const activeTasks = [
      ...(pendingTasks.success ? pendingTasks.data : []),
      ...(runningTasks.success ? runningTasks.data : [])
    ];
    
    return {
      success: true,
      data: activeTasks
    };
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: number): Promise<ApiResponse<{
    success: boolean;
    message: string;
    task_id: number;
  }>> {
    return this.request(`/tasks/${taskId}/cancel`, {
      method: 'PATCH'
    });
  }

  async getAnnotationContent(datasetId: string | number, annotationId: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/datasets/${datasetId}/annotations/${annotationId}/content`);
  }

  async updateAnnotationContent(datasetId: string | number, annotationId: string, file: File): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request(`/datasets/${datasetId}/annotations/${annotationId}/content`, {
      method: 'PUT',
      body: formData
    });
  }
}

/**
 * Create a configured API client instance
 */
export const createApiClient = (config: ApiConfig): ApiClient => {
  return new ApiClient(config);
};
