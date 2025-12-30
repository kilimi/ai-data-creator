import { useState, useEffect } from 'react';
import { useApi } from './use-api';

export interface Task {
  id: number;
  name: string;
  description: string;
  task_type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  project_id: number;
  metadata?: any;
}

export function useTasks(projectId?: number) {
  const { api, isConfigured } = useApi();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveTasks = async () => {
    if (!api || !isConfigured) return;

    try {
      setLoading(true);
      setError(null);
      
      const response = await api.getActiveTasks(projectId);
      
      if (response.success) {
        setActiveTasks(response.data as Task[]);
      } else {
        setError(response.error || 'Failed to fetch active tasks');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const fetchAllTasks = async () => {
    if (!api || !isConfigured) return;

    try {
      setLoading(true);
      setError(null);
      
      const response = await api.getTasks({
        project_id: projectId,
        limit: 100
      });
      
      if (response.success) {
        setTasks(response.data as Task[]);
      } else {
        setError(response.error || 'Failed to fetch tasks');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const cancelTask = async (taskId: number) => {
    if (!api || !isConfigured) return false;

    try {
      const response = await api.cancelTask(taskId);
      
      if (response.success) {
        // Refresh active tasks after cancellation
        await fetchActiveTasks();
        return true;
      } else {
        setError(response.error || 'Failed to cancel task');
        return false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      return false;
    }
  };

  const getTaskById = async (taskId: number) => {
    if (!api || !isConfigured) return null;

    try {
      const response = await api.getTask(taskId);
      
      if (response.success) {
        return response.data;
      } else {
        setError(response.error || 'Failed to fetch task');
        return null;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      return null;
    }
  };

  // Auto-refresh active tasks - optimized polling
  useEffect(() => {
    if (!isConfigured) return;

    fetchActiveTasks();
    
    const interval = setInterval(() => {
      fetchActiveTasks();
    }, 15000); // Refresh every 15 seconds (reduced from 5s)

    return () => clearInterval(interval);
  }, [api, isConfigured, projectId]);

  return {
    tasks,
    activeTasks,
    loading,
    error,
    fetchActiveTasks,
    fetchAllTasks,
    cancelTask,
    getTaskById,
    activeTaskCount: activeTasks.length
  };
}
