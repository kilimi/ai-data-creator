import { useState, useEffect, useRef } from 'react';
import { ApiClient, createApiClient } from '@/utils/api';
import { ApiConfig } from '@/types/api';
import { API_CONFIG } from '@/config/api';

/**
 * Shared, deduplicated health-check so 30+ components that call useApi()
 * don't each fire their own (15 s × 3 retries) connection test.
 */
let _sharedHealthPromise: Promise<boolean> | null = null;
let _sharedHealthBaseUrl: string | null = null;

function getSharedHealthCheck(client: ApiClient, baseUrl: string): Promise<boolean> {
  if (_sharedHealthPromise && _sharedHealthBaseUrl === baseUrl) {
    return _sharedHealthPromise;
  }
  _sharedHealthBaseUrl = baseUrl;
  _sharedHealthPromise = client
    .testConnection(1)
    .then((r) => r.success)
    .catch(() => false);
  // Allow a re-check after 30 s (backend restart, etc.)
  _sharedHealthPromise.finally(() => {
    setTimeout(() => {
      _sharedHealthPromise = null;
    }, 30_000);
  });
  return _sharedHealthPromise;
}

export const useApi = (config?: Partial<ApiConfig>) => {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null);
  const [isConfigured, setIsConfigured] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const mergedConfig: ApiConfig = {
      ...API_CONFIG,
      ...config,
    };

    const client = createApiClient(mergedConfig);
    setApiClient(client);
    setIsConfigured(true);

    getSharedHealthCheck(client, mergedConfig.baseUrl).then((ok) => {
      if (mounted.current) setIsConnected(ok);
    });

    return () => {
      mounted.current = false;
    };
  }, [config?.baseUrl]);

  return {
    api: apiClient,
    isConfigured,
    isConnected,
  };
};