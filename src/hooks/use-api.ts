
import { useState, useEffect } from 'react';
import { ApiClient, createApiClient } from '@/utils/api';
import { ApiConfig } from '@/types/api';
import { API_CONFIG } from '@/config/api';
import { useToast } from '@/components/ui/use-toast';

/**
 * Hook to use the API client throughout the application
 */
export const useApi = (config?: Partial<ApiConfig>) => {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const { toast } = useToast();

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

    // Test connection
    const checkConnection = async () => {
      try {
        const result = await client.testConnection();
        setIsConnected(result.success);
        
        if (!result.success) {
          console.warn('API connection failed:', result.error);
          toast({
            title: "API Connection Issue",
            description: "Could not connect to the FastAPI server. Check API settings.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error('Error checking API connection:', error);
        setIsConnected(false);
      }
    };
    
    checkConnection();
  }, [config?.baseUrl, toast]);

  return {
    api: apiClient,
    isConfigured,
    isConnected
  };
};
