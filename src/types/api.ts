
export interface ApiConfig {
  baseUrl: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface Api {
  getImages: (datasetId: string) => Promise<ApiResponse<any[]>>;
}

