import { useState, useEffect } from 'react';
import { useApi } from './use-api';
import { useExport } from '@/contexts/ExportContext';

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
  metadata?: any;  // Frontend field
  task_metadata?: any;  // Backend field
}

export function useTasks(projectId?: number) {
  const { api, isConfigured } = useApi();
  const { isExporting } = useExport();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTasks, setActiveTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchActiveTasks = async () => {
    if (!api || !isConfigured) return;

    try {
      setLoading(true);
      setError(null);
      
      console.log('Fetching active tasks for projectId:', projectId);
      const response = await api.getActiveTasks(projectId);
      console.log('Active tasks response:', response);
      
      if (response.success) {
        console.log('Setting active tasks:', response.data);
        setActiveTasks(response.data as Task[]);
      } else {
        // Don't set error for timeout/abort errors during polling - they're expected
        const isTimeoutError = response.error?.includes('timed out') || 
                               response.error?.includes('aborted') ||
                               response.error?.includes('busy');
        if (!isTimeoutError) {
          console.error('Failed to fetch active tasks:', response.error);
          setError(response.error || 'Failed to fetch active tasks');
        }
      }
    } catch (err) {
      // Silently handle timeout errors during polling
      const isTimeoutError = err instanceof Error && 
                           (err.name === 'AbortError' || err.message.includes('timeout'));
      if (!isTimeoutError) {
        console.error('Error fetching active tasks:', err);
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      }
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
        // Don't set error for timeout/abort errors during polling - they're expected
        const isTimeoutError = response.error?.includes('timed out') || 
                               response.error?.includes('aborted');
        if (!isTimeoutError) {
          setError(response.error || 'Failed to fetch tasks');
        }
      }
    } catch (err) {
      // Silently handle timeout errors during polling
      const isTimeoutError = err instanceof Error && 
                           (err.name === 'AbortError' || err.message.includes('timeout'));
      if (!isTimeoutError) {
        setError(err instanceof Error ? err.message : 'Unknown error occurred');
      }
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
  // Pause polling during database export to avoid conflicts
  useEffect(() => {
    if (!isConfigured || isExporting) return;

    // Fetch both active tasks and all tasks on mount and interval
    fetchActiveTasks();
    fetchAllTasks();
    
    const interval = setInterval(() => {
      // Don't poll if export is in progress
      if (!isExporting) {
        fetchActiveTasks();
        fetchAllTasks();
      }
    }, 15000); // Refresh every 15 seconds (reduced from 5s)

    return () => clearInterval(interval);
  }, [api, isConfigured, projectId, isExporting]);

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
