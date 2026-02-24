import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { useTasks, Task } from '@/hooks/use-tasks';
import { 
  Clock, 
  Play, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  X,
  Loader2,
  ListTodo,
  Layers,
  Brain,
  Copy,
  Sparkles,
  ExternalLink
} from 'lucide-react';

interface TasksPopoverProps {
  projectId?: number;
}

export const TasksPopover = ({ projectId }: TasksPopoverProps) => {
  const navigate = useNavigate();
  const { tasks, activeTasks, loading, cancelTask, activeTaskCount, fetchAllTasks } = useTasks(projectId);
  const { toast } = useToast();
  const [cancellingTasks, setCancellingTasks] = useState<Set<number>>(new Set());
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const getTaskTypeIcon = (taskType: string) => {
    switch (taskType) {
      case 'augmentation':
        return <Sparkles className="w-4 h-4 text-purple-500" />;
      case 'training':
        return <Brain className="w-4 h-4 text-indigo-500" />;
      case 'duplication':
        return <Copy className="w-4 h-4 text-cyan-500" />;
      case 'evaluation':
        return <Layers className="w-4 h-4 text-orange-500" />;
      case 'preannotate':
        return <Brain className="w-4 h-4 text-green-500" />;
      default:
        return <ListTodo className="w-4 h-4 text-gray-500" />;
    }
  };

  const getTaskTypeLabel = (taskType: string) => {
    switch (taskType) {
      case 'augmentation':
        return 'Augmentation';
      case 'training':
        return 'Training';
      case 'duplication':
        return 'Duplication';
      case 'evaluation':
        return 'Evaluation';
      case 'preannotate':
        return 'Auto-Annotate';
      default:
        return taskType;
    }
  };

  const getStatusIcon = (status: Task['status']) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'running':
        return <Play className="w-4 h-4 text-blue-500 animate-pulse" />;
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'cancelled':
        return <AlertCircle className="w-4 h-4 text-gray-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'running':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getTaskTypeColor = (taskType: string) => {
    switch (taskType) {
      case 'augmentation':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'training':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'duplication':
        return 'bg-cyan-100 text-cyan-800 border-cyan-200';
      case 'evaluation':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'preannotate':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const handleCancelTask = async (taskId: number, taskName: string) => {
    setCancellingTasks(prev => new Set(prev).add(taskId));
    
    try {
      const success = await cancelTask(taskId);
      
      if (success) {
        toast({
          title: "Task Cancelled",
          description: `Task "${taskName}" has been cancelled successfully.`,
        });
      } else {
        toast({
          title: "Error",
          description: `Failed to cancel task "${taskName}". Please try again.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: `An error occurred while cancelling the task.`,
        variant: "destructive",
      });
    } finally {
      setCancellingTasks(prev => {
        const newSet = new Set(prev);
        newSet.delete(taskId);
        return newSet;
      });
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const canCancelTask = (status: Task['status']) => {
    return status === 'pending' || status === 'running';
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsDetailOpen(true);
  };

  // Filter tasks: only show running/pending tasks OR tasks completed within 1 hour
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const now = Date.now();
  
  const filteredTasks = tasks.filter(task => {
    // Always show active tasks (pending/running)
    if (task.status === 'pending' || task.status === 'running') {
      return true;
    }
    // Show completed/failed/cancelled tasks only if completed within last hour
    if (task.completed_at) {
      const completedTime = new Date(task.completed_at).getTime();
      return (now - completedTime) < ONE_HOUR_MS;
    }
    return false;
  });

  const visibleTasks = filteredTasks;
  const visibleActiveTaskCount = visibleTasks.filter(task => 
    task.status === 'pending' || task.status === 'running'
  ).length;

  // Get navigation URL based on task type and metadata
  const getTaskNavigationUrl = (task: Task): string | null => {
    const metadata = task.task_metadata || task.metadata || {};
    const taskProjectId = metadata.project_id || projectId;
    
    if (!taskProjectId) return null;
    
    switch (task.task_type) {
      case 'training':
        return `/projects/${taskProjectId}/models`;
      case 'evaluation':
        return `/projects/${taskProjectId}/evaluations`;
      case 'augmentation':
      case 'duplication':
        return `/projects/${taskProjectId}/datasets`;
      default:
        return `/projects/${taskProjectId}`;
    }
  };

  const handleGoToTask = (task: Task, e: React.MouseEvent) => {
    e.stopPropagation();
    const url = getTaskNavigationUrl(task);
    if (url) {
      navigate(url);
    }
  };
  
  // Count running and pending tasks
  const runningTaskCount = activeTasks.filter(task => task.status === 'running').length;
  const pendingTaskCount = activeTasks.filter(task => task.status === 'pending').length;
  
  // Debug: Log task counts
  useEffect(() => {
    console.log('TasksPopover - Active tasks:', activeTasks.length, 'Running:', runningTaskCount, 'Pending:', pendingTaskCount);
    if (activeTasks.length > 0) {
      console.log('Active task details:', activeTasks.map(t => ({ id: t.id, name: t.name, status: t.status })));
    }
  }, [activeTasks.length, runningTaskCount, pendingTaskCount]);

  const formatDuration = (startedAt?: string, completedAt?: string) => {
    if (!startedAt) return 'Not started';
    if (!completedAt) return 'Running...';
    
    const start = new Date(startedAt);
    const end = new Date(completedAt);
    const duration = end.getTime() - start.getTime();
    
    const seconds = Math.floor(duration / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`h-9 w-9 relative ${
              runningTaskCount > 0 
                ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10' 
                : pendingTaskCount > 0 
                  ? 'text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10' 
                  : ''
            }`}
            disabled={loading}
            title={
              activeTaskCount > 0 
                ? `${runningTaskCount > 0 ? `${runningTaskCount} running` : ''}${runningTaskCount > 0 && pendingTaskCount > 0 ? ', ' : ''}${pendingTaskCount > 0 ? `${pendingTaskCount} waiting` : ''}` 
                : 'View all tasks'
            }
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {activeTaskCount > 0 ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ListTodo className="h-4 w-4" />
                )}
                {activeTaskCount > 0 && (
                  <span 
                    className={`absolute -top-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${
                      runningTaskCount > 0 ? 'bg-blue-500' : 'bg-yellow-500'
                    }`}
                  >
                    {activeTaskCount > 9 ? '9+' : activeTaskCount}
                  </span>
                )}
              </>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[700px] p-0 max-h-[80vh] flex flex-col" align="end">
          <div className="p-4 border-b flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">Tasks</h3>
                <p className="text-xs text-muted-foreground">Active & recent (last hour)</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {visibleActiveTaskCount} active
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {visibleTasks.length} total
                </Badge>
              </div>
            </div>
          </div>
          
          <ScrollArea className="flex-1 min-h-0">
            {visibleTasks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <ListTodo className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No active or recent tasks</p>
              </div>
            ) : (
              <div className="p-2 pb-4">
                <table className="w-full text-sm">
                  <thead className="border-b sticky top-0 bg-background z-10">
                    <tr className="text-left">
                      <th className="px-3 py-3 font-medium text-muted-foreground">Type</th>
                      <th className="px-3 py-3 font-medium text-muted-foreground">Task Name</th>
                      <th className="px-3 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="px-3 py-3 font-medium text-muted-foreground w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTasks.map((task) => (
                      <tr 
                        key={task.id} 
                        className="border-b hover:bg-muted/50 cursor-pointer transition-colors"
                        onClick={() => handleTaskClick(task)}
                      >
                        <td className="px-3 py-4">
                          <Badge 
                            variant="outline" 
                            className={`${getTaskTypeColor(task.task_type)} text-xs`}
                          >
                            {getTaskTypeLabel(task.task_type)}
                          </Badge>
                        </td>
                        <td className="px-3 py-4">
                          <div className="flex items-center gap-2">
                            {getTaskTypeIcon(task.task_type)}
                            <span className="font-medium truncate max-w-[180px]" title={task.name}>
                              {task.name}
                            </span>
                            {((task.error_message) || 
                              (task.task_metadata?.errors && task.task_metadata.errors.length > 0) ||
                              (task.task_metadata?.errors_count && task.task_metadata.errors_count > 0)) && (
                              <Badge variant="destructive" className="text-xs flex-shrink-0">
                                <AlertCircle className="w-3 h-3 mr-1" />
                                {task.task_metadata?.errors_count || 'Error'}
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-4">
                          <Badge 
                            variant="outline" 
                            className={`${getStatusColor(task.status)} whitespace-nowrap`}
                          >
                            {getStatusIcon(task.status)}
                            <span className="ml-1 capitalize">{task.status}</span>
                          </Badge>
                        </td>
                        <td className="px-3 py-4">
                          {getTaskNavigationUrl(task) && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              onClick={(e) => handleGoToTask(task, e)}
                            >
                              Go to
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {/* Task Detail Modal */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedTask && getTaskTypeIcon(selectedTask.task_type)}
              {selectedTask?.name}
            </DialogTitle>
            <DialogDescription>
              Task details and execution information
            </DialogDescription>
          </DialogHeader>
          
          {selectedTask && (
            <div className="space-y-4">
              {/* Status and Progress */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Status</label>
                  <div className="mt-1">
                    <Badge 
                      variant="outline" 
                      className={getStatusColor(selectedTask.status)}
                    >
                      {getStatusIcon(selectedTask.status)}
                      <span className="ml-1 capitalize">{selectedTask.status}</span>
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Progress</label>
                  <div className="mt-1 flex items-center gap-2">
                    <Progress value={selectedTask.progress} className="h-2 flex-1" />
                    <span className="text-sm font-medium">{Math.round(selectedTask.progress)}%</span>
                  </div>
                </div>
              </div>

              {/* Type and Duration */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Task Type</label>
                  <div className="mt-1">
                    <Badge 
                      variant="outline" 
                      className={getTaskTypeColor(selectedTask.task_type)}
                    >
                      {getTaskTypeLabel(selectedTask.task_type)}
                    </Badge>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Duration</label>
                  <div className="mt-1 text-sm">{formatDuration(selectedTask.started_at, selectedTask.completed_at)}</div>
                </div>
              </div>

              {/* Timestamps */}
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Created</label>
                    <div className="text-sm">{formatTimestamp(selectedTask.created_at)}</div>
                  </div>
                  {selectedTask.started_at && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Started</label>
                      <div className="text-sm">{formatTimestamp(selectedTask.started_at)}</div>
                    </div>
                  )}
                  {selectedTask.completed_at && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Completed</label>
                      <div className="text-sm">{formatTimestamp(selectedTask.completed_at)}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Description */}
              {selectedTask.description && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Description</label>
                  <div className="mt-1 text-sm bg-muted p-3 rounded-md">{selectedTask.description}</div>
                </div>
              )}

              {/* Metadata */}
              {(selectedTask.metadata || selectedTask.task_metadata) && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Task Details</label>
                  <div className="mt-1 bg-muted p-3 rounded-md space-y-2">
                    {Object.entries(selectedTask.metadata || selectedTask.task_metadata || {})
                      .filter(([key]) => {
                        // Filter out internal/technical fields from display
                        const excludedKeys = [
                          'errors', 
                          'errors_count', 
                          'annotation_file_configs',
                          'celery_task_id',
                          'annotation_settings',
                          'stage',
                          'current_operation',
                          'total_operations'
                        ];
                        return !excludedKeys.includes(key);
                      })
                      .map(([key, value]) => {
                      // Skip complex objects and arrays for cleaner display
                      if (value === null || value === undefined) return null;
                      
                      // Format the key to be more readable
                      const formattedKey = key
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, (l) => l.toUpperCase());
                      
                      // Special handling for method_parameters
                      if (key === 'method_parameters' && typeof value === 'object') {
                        return (
                          <div key={key} className="col-span-2 space-y-2">
                            <span className="text-sm font-medium text-muted-foreground">Augmentation Settings:</span>
                            <div className="bg-background p-3 rounded border border-border space-y-2">
                              {Object.entries(value as Record<string, any>).map(([methodName, params]) => (
                                <div key={methodName} className="space-y-1">
                                  <div className="font-medium text-sm capitalize">{methodName.replace(/_/g, ' ')}</div>
                                  {typeof params === 'object' && params !== null ? (
                                    <div className="pl-3 text-xs space-y-0.5">
                                      {Object.entries(params).map(([paramKey, paramValue]) => (
                                        <div key={paramKey} className="text-muted-foreground">
                                          {paramKey.replace(/_/g, ' ')}: <span className="font-mono">{String(paramValue)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="pl-3 text-xs text-muted-foreground">Default settings</div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      
                      // Format the value based on its type
                      let displayValue: string;
                      if (typeof value === 'boolean') {
                        displayValue = value ? 'Yes' : 'No';
                      } else if (typeof value === 'number') {
                        displayValue = value.toLocaleString();
                      } else if (Array.isArray(value)) {
                        if (value.length === 0) return null;
                        if (value.length <= 5) {
                          displayValue = value.join(', ');
                        } else {
                          displayValue = `${value.slice(0, 5).join(', ')} ... (${value.length} total)`;
                        }
                      } else if (typeof value === 'object') {
                        // For nested objects, show a summary
                        const entries = Object.keys(value).length;
                        displayValue = `${entries} item${entries !== 1 ? 's' : ''}`;
                      } else {
                        displayValue = String(value);
                      }
                      
                      return (
                        <div key={key} className="flex justify-between items-start text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
                          <span className="font-medium text-muted-foreground">{formattedKey}:</span>
                          <span className="text-right ml-4 max-w-[60%] break-words">{displayValue}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Error Message */}
              {selectedTask.error_message && (
                <div>
                  <label className="text-sm font-medium text-red-600 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Error
                  </label>
                  <div className="mt-1 text-sm bg-red-50 border border-red-200 text-red-800 p-3 rounded-md">
                    {selectedTask.error_message}
                  </div>
                </div>
              )}

              {/* Additional Errors from Metadata */}
              {(selectedTask.task_metadata?.errors && selectedTask.task_metadata.errors.length > 0) && (
                <div>
                  <label className="text-sm font-medium text-orange-600 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Task Errors ({selectedTask.task_metadata.errors.length})
                  </label>
                  <div className="mt-1 bg-orange-50 border border-orange-200 rounded-md max-h-48 overflow-y-auto">
                    <div className="divide-y divide-orange-200">
                      {selectedTask.task_metadata.errors.map((error: string, idx: number) => (
                        <div key={idx} className="p-3 text-sm text-orange-900">
                          <div className="flex items-start gap-2">
                            <span className="text-xs font-semibold text-orange-600 mt-0.5">#{idx + 1}</span>
                            <span className="flex-1">{error}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {selectedTask.task_metadata.errors_count > selectedTask.task_metadata.errors.length && (
                    <p className="text-xs text-orange-600 mt-1">
                      Showing first {selectedTask.task_metadata.errors.length} of {selectedTask.task_metadata.errors_count} errors
                    </p>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-4 border-t">
                {canCancelTask(selectedTask.status) && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      handleCancelTask(selectedTask.id, selectedTask.name);
                      setIsDetailOpen(false);
                    }}
                    disabled={cancellingTasks.has(selectedTask.id)}
                  >
                    {cancellingTasks.has(selectedTask.id) ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Cancelling...
                      </>
                    ) : (
                      <>
                        <X className="w-4 h-4 mr-2" />
                        Cancel Task
                      </>
                    )}
                  </Button>
                )}
                {getTaskNavigationUrl(selectedTask) && (
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      const url = getTaskNavigationUrl(selectedTask);
                      if (url) {
                        navigate(url);
                        setIsDetailOpen(false);
                      }
                    }}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Go to
                  </Button>
                )}
                <Button variant="outline" onClick={() => setIsDetailOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
