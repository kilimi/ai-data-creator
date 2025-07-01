import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  Activity
} from 'lucide-react';

interface TasksPopoverProps {
  projectId?: number;
}

export const TasksPopover = ({ projectId }: TasksPopoverProps) => {
  const { activeTasks, loading, cancelTask, activeTaskCount } = useTasks(projectId);
  const { toast } = useToast();
  const [cancellingTasks, setCancellingTasks] = useState<Set<number>>(new Set());

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

  if (activeTaskCount === 0) {
    return null; // Don't show the icon if there are no active tasks
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 relative"
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Activity className="h-4 w-4" />
              {activeTaskCount > 0 && (
                <Badge 
                  variant="destructive" 
                  className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
                >
                  {activeTaskCount > 9 ? '9+' : activeTaskCount}
                </Badge>
              )}
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-lg">Active Tasks</h3>
            <Badge variant="secondary" className="text-xs">
              {activeTaskCount} active
            </Badge>
          </div>
        </div>
        
        <ScrollArea className="max-h-96">
          <div className="p-2 space-y-2">
            {activeTasks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No active tasks</p>
              </div>
            ) : (
              activeTasks.map((task) => (
                <Card key={task.id} className="border border-gray-200">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(task.status)}
                        <CardTitle className="text-sm font-medium truncate">
                          {task.name}
                        </CardTitle>
                      </div>
                      
                      {canCancelTask(task.status) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-gray-500 hover:text-red-500"
                          onClick={() => handleCancelTask(task.id, task.name)}
                          disabled={cancellingTasks.has(task.id)}
                        >
                          {cancellingTasks.has(task.id) ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <X className="w-3 h-3" />
                          )}
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <Badge 
                          variant="outline" 
                          className={getStatusColor(task.status)}
                        >
                          {task.status.charAt(0).toUpperCase() + task.status.slice(1)}
                        </Badge>
                        <span className="text-muted-foreground">
                          {Math.round(task.progress)}%
                        </span>
                      </div>
                      
                      <Progress 
                        value={task.progress} 
                        className="h-2"
                      />
                      
                      {task.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {task.description}
                        </p>
                      )}
                      
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Started: {formatTimestamp(task.created_at)}</span>
                        {task.started_at && (
                          <span>Running: {formatTimestamp(task.started_at)}</span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </ScrollArea>
        
        {activeTasks.length > 0 && (
          <div className="p-3 border-t bg-gray-50/50 text-center">
            <p className="text-xs text-muted-foreground">
              Tasks auto-refresh every 5 seconds
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
