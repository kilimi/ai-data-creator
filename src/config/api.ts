// Get API URL from localStorage if available, otherwise use default
const getApiBaseUrl = () => {
  // Check localStorage first
  const savedUrl = localStorage.getItem("apiBaseUrl");
  
  // Use environment variable if available
  const envUrl = import.meta.env.VITE_API_URL;
  
  // Return the first available URL in order of priority
  return savedUrl || envUrl || 'http://localhost:8000';
};

// Check if a URL is accessible
const isUrlAccessible = async (url: string): Promise<boolean> => {
  try {
    // Use fetch with a timeout to check if the URL responds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${url}/health-check`, {
      method: 'HEAD',
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    console.warn(`API endpoint ${url} is not accessible:`, error);
    return false;
  }
};

export const API_CONFIG = {
  baseUrl: getApiBaseUrl(),
  isAccessible: async (): Promise<boolean> => {
    return await isUrlAccessible(getApiBaseUrl());
  }
};
