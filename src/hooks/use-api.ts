
import { useState, useEffect } from 'react';
import { ApiClient, createApiClient } from '@/utils/api';
import { ApiConfig } from '@/types/api';

// Default config that can be overridden
const defaultConfig: ApiConfig = {
  baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:8000'
};

/**
 * Hook to use the API client throughout the application
 */
export const useApi = (config?: Partial<ApiConfig>) => {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    // Merge the default config with any provided config
    const mergedConfig: ApiConfig = {
      ...defaultConfig,
      ...config
    };

    // Create the API client with the config
    const client = createApiClient(mergedConfig);
    setApiClient(client);
    setIsConfigured(true);
  }, [config?.baseUrl, config?.apiKey]);

  return {
    api: apiClient,
    isConfigured
  };
};
