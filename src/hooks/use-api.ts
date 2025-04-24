import { useState, useEffect } from 'react';
import { ApiClient, createApiClient } from '@/utils/api';
import { ApiConfig } from '@/types/api';
<<<<<<< HEAD

// Force localhost configuration
const defaultConfig: ApiConfig = {
  baseUrl: 'http://localhost:8000'
};
=======
import { API_CONFIG } from '@/config/api';
>>>>>>> 4b9d6a7755a0af7a22b6fe994bd48525a5971df0

/**
 * Hook to use the API client throughout the application
 */
export const useApi = (config?: Partial<ApiConfig>) => {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);

  useEffect(() => {
    // Always use localhost in development
    const mergedConfig: ApiConfig = {
<<<<<<< HEAD
      ...defaultConfig,
      baseUrl: 'http://localhost:8000' // Force localhost
=======
      ...API_CONFIG,
      ...config
>>>>>>> 4b9d6a7755a0af7a22b6fe994bd48525a5971df0
    };

    const client = createApiClient(mergedConfig);
    setApiClient(client);
    setIsConfigured(true);
<<<<<<< HEAD
  }, []);  // Remove config dependencies to prevent override
=======
  }, [config?.baseUrl]);
>>>>>>> 4b9d6a7755a0af7a22b6fe994bd48525a5971df0

  return {
    api: apiClient,
    isConfigured
  };
};
