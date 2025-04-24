
// Get API URL from localStorage if available, otherwise use default
const getApiBaseUrl = () => {
  const savedUrl = localStorage.getItem("apiBaseUrl");
  return savedUrl || import.meta.env.VITE_API_URL || 'http://localhost:8000';
};

export const API_CONFIG = {
  baseUrl: getApiBaseUrl(),
}; 
