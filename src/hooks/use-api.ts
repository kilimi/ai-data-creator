
import { useState, useEffect } from 'react';
import { ApiClient, createApiClient } from '@/utils/api';
import { ApiConfig } from '@/types/api';
import { API_CONFIG } from '@/config/api';

/**
 * Hook to use the API client throughout the application
 */
export const useApi = (config?: Partial<ApiConfig>) => {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    // Merge the default config with any provided config
    const mergedConfig: ApiConfig = {
      ...API_CONFIG,
      ...config
    };

    // Create the API client with the config
    const client = createApiClient(mergedConfig);
    setApiClient(client);
    setIsConfigured(true);
  }, [config?.baseUrl]);

  return {
    api: apiClient,
    isConfigured
  };
};
