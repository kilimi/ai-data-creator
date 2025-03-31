
import { useState, useEffect } from 'react';
import { useApi } from './use-api';
import { Project } from '@/types';

/**
 * Hook to fetch projects with their datasets
 */
export const useProjects = () => {
  const { api, isConfigured } = useApi();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !api) return;

    const fetchProjects = async () => {
      setLoading(true);
      try {
        const response = await api.getProjects();
        
        if (response.success && response.data) {
          setProjects(response.data);
        } else {
          setError(response.error || 'Failed to fetch projects');
        }
      } catch (err) {
        setError('An error occurred while fetching projects');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [api, isConfigured]);

  return { projects, loading, error };
};

/**
 * Hook to fetch a single project with its datasets
 */
export const useProject = (projectId: string) => {
  const { api, isConfigured } = useApi();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured || !api || !projectId) return;

    const fetchProject = async () => {
      setLoading(true);
      try {
        const response = await api.getProject(projectId);
        
        if (response.success && response.data) {
          setProject(response.data);
        } else {
          setError(response.error || 'Failed to fetch project');
        }
      } catch (err) {
        setError('An error occurred while fetching the project');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProject();
  }, [api, isConfigured, projectId]);

  return { project, loading, error };
};
