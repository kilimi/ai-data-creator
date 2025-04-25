
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
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        };
      }
      
      // Don't set Content-Type header for FormData
      if (options.body instanceof FormData) {
        delete (options.headers as any)['Content-Type'];
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);

      // Handle common HTTP status codes
      if (!response.ok) {
        let errorMessage = `API Error: ${response.status} ${response.statusText}`;
        
        try {
          // Try to get a more detailed error message from the response
          const errorData = await response.json();
          if (errorData.detail) {
            errorMessage = errorData.detail;
          }
        } catch (e) {
          // If we can't parse the error response, just use the status text
        }
        
        throw new Error(errorMessage);
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
