
import { ApiConfig, ApiResponse } from '@/types/api';
import { Dataset, Project } from '@/types';

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

      return { 
        success: true, 
        data: data 
      };
    } catch (error) {
      console.error('API Request Error:', error);
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
}

/**
 * Create a configured API client instance
 */
export const createApiClient = (config: ApiConfig): ApiClient => {
  return new ApiClient(config);
};
