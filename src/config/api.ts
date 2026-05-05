// Get API URL from localStorage if available, otherwise use default (exported for components that need to call the API directly)
export const getApiBaseUrl = () => {
  // Check localStorage first
  const savedUrl = localStorage.getItem("apiBaseUrl");
  
  // Use environment variable if available
  const envUrl = import.meta.env.VITE_API_URL;
  
  // Return the first available URL in order of priority
  const url = savedUrl || envUrl || 'http://localhost:9999';
  console.log("Using API URL:", url);
  return url;
};

/**
 * Turn backend-relative media paths into absolute URLs the browser can load.
 * Dataset thumbnails and image URLs are often stored as `/static/projects/...`
 * while the SPA runs on another origin (e.g. Vite :8080 vs API :9999).
 */
export function resolveBackendMediaUrl(
  href: string | undefined | null
): string | undefined {
  if (href == null) return undefined;
  const h = String(href).trim();
  if (!h) return undefined;
  if (
    h.startsWith("data:") ||
    h.startsWith("http://") ||
    h.startsWith("https://") ||
    h.startsWith("blob:")
  ) {
    return h;
  }
  if (h.startsWith("/")) {
    const base = getApiBaseUrl().replace(/\/+$/, "");
    return `${base}${h}`;
  }
  return h;
}

// Check if a URL is accessible
const isUrlAccessible = async (url: string): Promise<boolean> => {
  try {
    // Use fetch with a timeout to check if the URL responds
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${url}/health-check`, {
      method: 'GET',
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
