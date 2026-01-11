import { ApiConfig, ApiResponse } from '@/types/api';
import { Dataset, Project, Image, ImageCollection } from '@/types';

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
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout
      
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
    // Don't include images in list view for better performance
    // Thumbnails will be loaded on-demand via logo_url if available
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

  async duplicateDataset(datasetId: number): Promise<ApiResponse<any>> {
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

  async mergeDatasets(projectId: string | number, name: string, datasetIds: number[]): Promise<ApiResponse<{
    id: number;
    name: string;
    description: string;
    total_images: number;
    total_annotations: number;
    source_datasets: string[];
  }>> {
    try {
      const response = await fetch(`${this.config.baseUrl}/projects/${projectId}/datasets/merge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          dataset_ids: datasetIds
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      return { success: true, data: result.data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to merge datasets',
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

  async getImageCollections(datasetId: string | number): Promise<ApiResponse<ImageCollection[]>> {
    return this.request<ImageCollection[]>(`/datasets/${datasetId}/image-collections`);
  }

  async deleteImage(datasetId: string | number, imageId: string): Promise<ApiResponse<any>> {
    return this.request(`/datasets/${datasetId}/images/${imageId}`, {
      method: 'DELETE'
    });
  }

  // Annotations endpoints
  async getAnnotations(datasetId: string | number): Promise<ApiResponse<any[]>> {
    console.log('🔗 Making getAnnotations request for dataset:', datasetId);
    console.log('🔗 Request URL will be:', `/datasets/${datasetId}/annotations`);
    const result = await this.request<any[]>(`/datasets/${datasetId}/annotations`);
    console.log('🔗 getAnnotations response:', result);
    return result;
  }

  async getAnnotationsSummary(datasetId: string | number): Promise<ApiResponse<{
    dataset_id: number;
    file_count: number;
    total_annotations: number;
    files: Array<{
      id: string;
      name: string;
      stored_count: number;
      actual_count: number;
      image_count: number;
      processing_status: string;
    }>;
  }>> {
    return this.request<any>(`/datasets/${datasetId}/annotations/summary`);
  }

  async getAnnotation(datasetId: string | number, annotationId: string): Promise<ApiResponse<any>> {
    return this.request<any>(`/datasets/${datasetId}/annotations/${annotationId}`);
  }

  async getAnnotationsList(
    datasetId: string | number,
    params?: {
      page?: number;
      limit?: number;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
    }
  ): Promise<ApiResponse<{
    annotations: Array<{
      id: string;
      name: string;
      format: string;
      stored_count: number;
      actual_count: number;
      processing_status: string;
      created_at: string;
      updated_at: string;
    }>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }>> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.append('page', params.page.toString());
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.sort_by) searchParams.append('sort_by', params.sort_by);
    if (params?.sort_order) searchParams.append('sort_order', params.sort_order);
    
    const queryString = searchParams.toString();
    const endpoint = `/datasets/${datasetId}/annotations/list${queryString ? `?${queryString}` : ''}`;
    
    return this.request(endpoint);
  }

  async deleteAnnotation(datasetId: string | number, annotationId: string): Promise<ApiResponse<any>> {
    return this.request(`/datasets/${datasetId}/annotations/${annotationId}`, {
      method: 'DELETE'
    });
  }

  // Coverage endpoints
  async getAnnotationFileCoverage(datasetId: string | number, annotationFileId: string): Promise<ApiResponse<{
    annotation_file_id: string;
    total_referenced_images: number;
    present_count: number;
    missing_count: number;
    present: Array<{ image_id: number; file_name: string }>;
    missing: Array<{ coco_image_id: number; file_name: string }>;
  }>> {
    return this.request(`/datasets/${datasetId}/annotations/${annotationFileId}/coverage`);
  }

  async getDatasetAnnotationsCoverage(datasetId: string | number): Promise<ApiResponse<Array<{
    annotation_file_id: string;
    name: string;
    total_referenced_images: number;
    present_count: number;
    missing_count: number;
  }>>> {
    return this.request(`/datasets/${datasetId}/annotations/coverage`);
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
   * Create an annotation processing task (async processing)
   */
  async createAnnotationProcessingTask(
    datasetId: string | number, 
    file: File, 
    annotationType?: string,
    taskName?: string
  ): Promise<ApiResponse<{
    task_id: number;
    file_id: string;
    status: string;
    message: string;
  }>> {
    const formData = new FormData();
    formData.append('file', file);
    if (annotationType && annotationType !== 'any') {
      formData.append('annotation_type', annotationType);
    }
    if (taskName) {
      formData.append('task_name', taskName);
    }
    
    return this.request(`/datasets/${datasetId}/create-annotation-task`, {
      method: 'POST',
      body: formData
    });
  }

  // Database-based annotation methods
  async getAnnotationData(
    datasetId: string | number, 
    annotationFileId: string, 
    params?: {
      imageIds?: string[];
      page?: number;
      limit?: number;
      className?: string;
    }
  ): Promise<ApiResponse<{
    annotations: any[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
    };
  }>> {
    const searchParams = new URLSearchParams();
    if (params?.imageIds?.length) {
      searchParams.append('image_ids', params.imageIds.join(','));
    }
    if (params?.page) searchParams.append('page', params.page.toString());
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.className) searchParams.append('class_name', params.className);
    
    const queryString = searchParams.toString();
    const endpoint = `/datasets/${datasetId}/annotations/${annotationFileId}/data${queryString ? `?${queryString}` : ''}`;
    
    return this.request(endpoint);
  }

  async getAnnotationClasses(
    datasetId: string | number, 
    annotationFileId: string
  ): Promise<ApiResponse<{
    classes: Array<{
      className: string;
      count: number;
      color: string;
      opacity: number;
      categoryId?: number;
    }>;
    totalClasses: number;
    totalAnnotations: number;
  }>> {
    return this.request(`/datasets/${datasetId}/annotations/${annotationFileId}/classes`);
  }

  async getAnnotationProcessingStatus(
    datasetId: string | number, 
    annotationFileId: string
  ): Promise<ApiResponse<{
    status: string;
    isProcessed: boolean;
    errorMessage?: string;
    annotationCount: number;
    imageCount: number;
    categoryCount: number;
  }>> {
    return this.request(`/datasets/${datasetId}/annotations/${annotationFileId}/status`);
  }

  async updateAnnotation(
    datasetId: string | number,
    annotationFileId: string,
    annotationId: number,
    updateData: {
      className?: string;
      confidence?: number;
    }
  ): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return this.request(`/datasets/${datasetId}/annotations/${annotationFileId}/annotation/${annotationId}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
  }

  async deleteClassAnnotations(
    datasetId: string | number,
    annotationFileId: string,
    className: string
  ): Promise<ApiResponse<{ 
    success: boolean; 
    message: string; 
    deleted_count: number;
    remaining_annotations: number;
    remaining_classes: number;
  }>> {
    return this.request(`/datasets/${datasetId}/annotations/${annotationFileId}/class/${encodeURIComponent(className)}`, {
      method: 'DELETE'
    });
  }

  async uploadCocoAnnotationFile(
    datasetId: string | number,
    file: File
  ): Promise<ApiResponse<{
    success: boolean;
    annotation_file_id: string;
    message: string;
  }>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request(`/datasets/${datasetId}/annotations/upload-coco`, {
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
    task_metadata?: any;
  }>>> {
    try {
      const searchParams = new URLSearchParams();
      if (projectId) searchParams.append('project_id', projectId.toString());
      
      // Use the /tasks/active endpoint to get both pending and running in one request
      const response = await fetch(`${this.config.baseUrl}/tasks/active?${searchParams.toString()}`, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP error! status: ${response.status}`
        };
      }
      
      const data = await response.json();
      
      return {
        success: true,
        data: data
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
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

  /**
   * Delete all failed tasks for a project
   */
  async deleteFailedTasks(projectId: number): Promise<ApiResponse<{
    success: boolean;
    message: string;
    deleted_count: number;
  }>> {
    return this.request(`/projects/${projectId}/tasks/failed`, {
      method: 'DELETE'
    });
  }

  async getAnnotationContent(
    datasetId: string | number, 
    annotationId: string,
    options?: {
      limit?: number;
      include_images?: boolean;
      include_annotations?: boolean;
    }
  ): Promise<ApiResponse<{
    content: string | null;
    filename: string;
    format: string;
    size: number;
    source: string;
    is_large?: boolean;
    total_annotations?: number;
    annotation_count?: number;
    image_count?: number;
    category_count?: number;
    message?: string;
  }>> {
    const searchParams = new URLSearchParams();
    if (options?.limit) searchParams.append('limit', options.limit.toString());
    if (options?.include_images !== undefined) searchParams.append('include_images', options.include_images.toString());
    if (options?.include_annotations !== undefined) searchParams.append('include_annotations', options.include_annotations.toString());
    
    const queryString = searchParams.toString();
    const endpoint = `/datasets/${datasetId}/annotations/${annotationId}/content${queryString ? `?${queryString}` : ''}`;
    
    return this.request<any>(endpoint);
  }

  async updateAnnotationContent(datasetId: string | number, annotationId: string, file: File): Promise<ApiResponse<any>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.request(`/datasets/${datasetId}/annotations/${annotationId}/content`, {
      method: 'PUT',
      body: formData
    });
  }

  async deleteAnnotationClass(datasetId: string | number, annotationId: string, className: string): Promise<ApiResponse<{
    deleted_count: number;
    remaining_annotations: number;
    remaining_categories: number;
  }>> {
    return this.request(`/datasets/${datasetId}/annotations/${annotationId}/class/${encodeURIComponent(className)}`, {
      method: 'DELETE'
    });
  }

  async duplicateAnnotationFile(datasetId: string | number, annotationId: string): Promise<ApiResponse<{
    new_file_id: string;
    new_file_name: string;
    annotation_count: number;
  }>> {
    return this.request(`/datasets/${datasetId}/annotations/${annotationId}/duplicate`, {
      method: 'POST'
    });
  }

  async mergeAnnotationFiles(
    datasetId: string | number, 
    annotationFileIds: string[], 
    mergedFilename?: string
  ): Promise<ApiResponse<{
    task_id: number;
    message: string;
    merged_filename: string;
    source_files?: string[];
  }>> {
    return this.request(`/datasets/${datasetId}/annotations/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        annotation_file_ids: annotationFileIds,
        merged_filename: mergedFilename
      })
    });
  }

  // Database backup and restore methods
  async getDatabaseConnectionInfo(): Promise<ApiResponse<{
    database_name: string;
    database_type: string;
    database_host: string;
    timestamp: string;
  }>> {
    return this.request('/database/connection');
  }

  async getDatabaseInfo(): Promise<ApiResponse<{
    database_info: {
      projects: number;
      datasets: number;
      images: number;
      annotations: number;
      annotation_files: number;
      annotation_classes: number;
      image_collections: number;
      tasks: number;
      augmentations: number;
      dataset_groups: number;
      total_records: number;
    };
    timestamp: string;
  }>> {
    return this.request('/database/info');
  }

  async exportDatabase(onProgress?: (progress: number) => void, projectIds?: number[], datasetIds?: number[]): Promise<void> {
    try {
      // Build URL with query parameters
      const params = new URLSearchParams();
      if (projectIds && projectIds.length > 0) {
        params.append('project_ids', projectIds.join(','));
      }
      if (datasetIds && datasetIds.length > 0) {
        params.append('dataset_ids', datasetIds.join(','));
      }
      
      const queryString = params.toString();
      const url = `${this.config.baseUrl}/database/export${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status} ${response.statusText}`);
      }

      // Track progress while reading the response
      const reader = response.body?.getReader();
      const contentLength = response.headers.get('Content-Length');
      
      if (!reader) {
        throw new Error('Failed to read response');
      }

      let receivedLength = 0;
      const totalLength = contentLength ? parseInt(contentLength, 10) : 0;
      const chunks: Uint8Array[] = [];

      // For smooth progress updates
      let lastProgressUpdate = 0;

      // Show initial progress immediately
      if (onProgress) {
        onProgress(1);
        lastProgressUpdate = 1;
      }

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        if (onProgress && totalLength > 0) {
          const progress = Math.min(95, Math.round((receivedLength / totalLength) * 100));
          // Update whenever progress increases
          if (progress > lastProgressUpdate) {
            onProgress(progress);
            lastProgressUpdate = progress;
          }
        } else if (onProgress && totalLength === 0) {
          // If no content length, show indeterminate progress
          // Show a pulsing progress between 10-90% to indicate activity
          const estimatedProgress = Math.min(90, 10 + Math.floor((receivedLength / 10000) % 80));
          onProgress(estimatedProgress);
        }
      }

      // Processing stage - show progress
      if (onProgress) onProgress(96);

      // Create blob directly from chunks (more efficient than combining into one array)
      const blob = new Blob(chunks, { type: 'application/json' });
      
      if (onProgress) onProgress(97);

      // Get filename from response headers or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] || 
                     `ai_data_creator_backup_${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.json`;
      
      if (onProgress) onProgress(98);

      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      
      if (onProgress) onProgress(100);
    } catch (error) {
      throw new Error(`Database export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Start YOLO model training
   */
  async startYoloTraining(request: {
    project_id: number;
    dataset_configs: Array<{
      dataset_id: number;
      annotation_file_id: string;
      image_collection?: string;
      split?: {
        train: number;
        val: number;
        test: number;
      };
    }>;
    model_type?: string;
    epochs?: number;
    batch_size?: number;
    image_size?: number;
    device?: string;
    task_name?: string;
    patience?: number;
    optimizer?: string;
    learning_rate?: number;
    momentum?: number;
    weight_decay?: number;
    use_wandb?: boolean;
    wandb_project?: string;
    wandb_entity?: string;
  }): Promise<ApiResponse<{
    success: boolean;
    task_id: number;
    message: string;
    task: {
      id: number;
      name: string;
      status: string;
      progress: number;
    };
  }>> {
    return this.request('/training/yolo/start', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  /**
   * Start RT-DETR model training
   */
  async startRTDETRTraining(request: {
    project_id: number;
    dataset_configs: Array<{
      dataset_id: number;
      annotation_file_id: string;
      image_collection?: string;
      split?: {
        train: number;
        val: number;
        test: number;
      };
    }>;
    model_type?: string;
    epochs?: number;
    batch_size?: number;
    image_size?: number;
    device?: string;
    task_name?: string;
    patience?: number;
    optimizer?: string;
    learning_rate?: number;
    weight_decay?: number;
    use_wandb?: boolean;
    wandb_project?: string;
    wandb_entity?: string;
  }): Promise<ApiResponse<{
    success: boolean;
    task_id: number;
    message: string;
    task: {
      id: number;
      name: string;
      status: string;
      progress: number;
    };
  }>> {
    return this.request('/training/rtdetr', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  /**
   * Get training task status
   */
  async getTrainingStatus(taskId: number): Promise<ApiResponse<{
    success: boolean;
    task: {
      id: number;
      name: string;
      status: string;
      progress: number;
      created_at?: string;
      started_at?: string;
      completed_at?: string;
      error_message?: string;
      metadata?: any;
    };
  }>> {
    return this.request(`/training/task/${taskId}/status`);
  }

  async exportDatabaseWithFiles(onProgress?: (progress: number) => void, projectIds?: number[], datasetIds?: number[]): Promise<void> {
    try {
      // Build URL with query parameters
      const params = new URLSearchParams();
      if (projectIds && projectIds.length > 0) {
        params.append('project_ids', projectIds.join(','));
      }
      if (datasetIds && datasetIds.length > 0) {
        params.append('dataset_ids', datasetIds.join(','));
      }
      
      const queryString = params.toString();
      const url = `${this.config.baseUrl}/database/export-with-files${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/zip',
        },
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.status} ${response.statusText}`);
      }

      // Track progress while reading the response
      const reader = response.body?.getReader();
      const contentLength = response.headers.get('Content-Length');
      
      if (!reader) {
        throw new Error('Failed to read response');
      }

      let receivedLength = 0;
      const totalLength = contentLength ? parseInt(contentLength, 10) : 0;
      const chunks: Uint8Array[] = [];

      // For smooth progress updates
      let lastProgressUpdate = 0;

      // Show initial progress immediately
      if (onProgress) {
        onProgress(1);
        lastProgressUpdate = 1;
      }

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        
        if (onProgress && totalLength > 0) {
          const progress = Math.min(95, Math.round((receivedLength / totalLength) * 100));
          // Update whenever progress increases
          if (progress > lastProgressUpdate) {
            onProgress(progress);
            lastProgressUpdate = progress;
          }
        } else if (onProgress && totalLength === 0) {
          // If no content length, show indeterminate progress
          // Show a pulsing progress between 10-90% to indicate activity
          const estimatedProgress = Math.min(90, 10 + Math.floor((receivedLength / 10000) % 80));
          onProgress(estimatedProgress);
        }
      }

      // Processing stage - show progress
      if (onProgress) onProgress(96);

      // Create blob directly from chunks (more efficient than combining into one array)
      const blob = new Blob(chunks, { type: 'application/zip' });
      
      if (onProgress) onProgress(97);

      // Get filename from response headers or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      const filename = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1] || 
                     `ai_data_creator_full_backup_${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.zip`;
      
      if (onProgress) onProgress(98);

      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
      
      if (onProgress) onProgress(100);
    } catch (error) {
      throw new Error(`Database export with files failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async importDatabase(file: File): Promise<ApiResponse<{
    message: string;
    metadata: any;
    tables_imported: string[];
  }>> {
    const formData = new FormData();
    formData.append('file', file);
    
    return this.request('/database/import', {
      method: 'POST',
      body: formData
    });
  }

  async clearDatabase(): Promise<ApiResponse<{
    message: string;
    deleted_records: Record<string, number>;
    total_records_deleted: number;
    files_removed: number;
    directories_cleared: string[];
    timestamp: string;
  }>> {
    return this.request('/database/clear', {
      method: 'DELETE'
    });
  }
}

/**
 * Create a configured API client instance
 */
export const createApiClient = (config: ApiConfig): ApiClient => {
  return new ApiClient(config);
};
