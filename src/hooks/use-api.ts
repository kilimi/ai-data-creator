import { useState, useEffect } from 'react';
import { ApiClient, createApiClient } from '@/utils/api';
import { ApiConfig } from '@/types/api';

// Force localhost configuration
const defaultConfig: ApiConfig = {
  baseUrl: 'http://localhost:8000'
};

/**
 * Hook to use the API client throughout the application
 */
export const useApi = (config?: Partial<ApiConfig>) => {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    // Always use localhost in development
    const mergedConfig: ApiConfig = {
      ...defaultConfig,
      baseUrl: 'http://localhost:8000' // Force localhost
    };

    const client = createApiClient(mergedConfig);
    setApiClient(client);
    setIsConfigured(true);
  }, []);  // Remove config dependencies to prevent override

  return {
    api: apiClient,
    isConfigured
  };
};
