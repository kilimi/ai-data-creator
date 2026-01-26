import React, { useState, useEffect } from 'react';
import { useParams, Link, useOutletContext, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { TrainModelModal } from '@/components/TrainModelModal';
import { TrainingDetailsModal } from '@/components/TrainingDetailsModal';
import { DownloadModelModal } from '@/components/DownloadModelModal';
import { TestTrainingInferenceModal } from '@/components/TestTrainingInferenceModal';
import { AlertCircle, Search, SlidersHorizontal, Brain, Trash2, Pencil, Download, TestTube, RotateCw } from "lucide-react";
import { Project, DatasetGroup } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface OutletContext {
  project: Project | null;
  loading: boolean;
}

// Helper functions
const getModelFamily = (modelName: string) => {
  if (!modelName) return '-';
  if (modelName.includes('yolo') || modelName.includes('YOLO')) return 'YOLO';
  if (modelName.includes('rtdetr') || modelName.includes('RT-DETR')) return 'RT-DETR';
  return modelName;
};

const getModelSize = (modelName: string) => {
  if (!modelName) return '-';
  const sizes = ['n', 's', 'm', 'l', 'x'];
  for (const size of sizes) {
    if (modelName.endsWith(size) || modelName.includes(`${size}.pt`)) {
      return size.toUpperCase();
    }
  }
  return '-';
};

export default function ProjectModels() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project } = useOutletContext<OutletContext>();
  const { isConnected } = useApi();
  const { toast } = useToast();
  
  const [trainingTasks, setTrainingTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [modelsSearchQuery, setModelsSearchQuery] = useState("");
  const [modelsSortOrder, setModelsSortOrder] = useState<"newest" | "oldest" | "name" | "accuracy" | "performance">("newest");
  const [showTrainModelModal, setShowTrainModelModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [selectedTaskError, setSelectedTaskError] = useState<{ name: string; error: string; id: number } | null>(null);
  const [selectedTaskCommand, setSelectedTaskCommand] = useState<{ name: string; command: string; id: number } | null>(null);
  const [deletingFailedTasks, setDeletingFailedTasks] = useState(false);
  const [renamingTask, setRenamingTask] = useState<{ id: number; name: string } | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [datasets, setDatasets] = useState<any[]>([]);
  const [datasetGroups, setDatasetGroups] = useState<DatasetGroup[]>([]);
  const [downloadModel, setDownloadModel] = useState<{ id: number; name: string } | null>(null);
  const [testInference, setTestInference] = useState<{ id: number; name: string } | null>(null);

  // Fetch training tasks
  const fetchTrainingTasks = async () => {
    if (!id) return;
    
    setLoadingTasks(true);
    try {
      const response = await fetch(`http://localhost:9999/tasks/?project_id=${id}`);
      if (response.ok) {
        const data = await response.json();
        // Filter to only training tasks (yolo_training or training, exclude evaluations and exports)
        setTrainingTasks(data.filter((t: any) => 
          (t.task_type === 'yolo_training' || t.task_type === 'training') && 
          t.task_type !== 'model_evaluation' &&
          t.task_type !== 'model_export'
        ));
      }
    } catch (error) {
      console.error('Error fetching training tasks:', error);
    } finally {
      setLoadingTasks(false);
    }
  };

  // Fetch datasets and groups for training modal
  const fetchDatasets = async () => {
    if (!id) return;
    try {
      const response = await fetch(`http://localhost:9999/projects/${id}/datasets/list`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          setDatasets(result.data);
        }
      }
    } catch (error) {
      console.error('Error fetching datasets:', error);
    }
  };

  const fetchDatasetGroups = async () => {
    if (!id) return;
    try {
      const response = await fetch(`http://localhost:9999/projects/${id}/dataset-groups/`);
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setDatasetGroups(result.data);
        }
      }
    } catch (error) {
      console.error('Error fetching dataset groups:', error);
    }
  };

  useEffect(() => {
    fetchTrainingTasks();
    fetchDatasets();
    fetchDatasetGroups();
    
    // Polling for running tasks
    const interval = setInterval(() => {
      if (trainingTasks.some(t => t.status === 'running' || t.status === 'pending')) {
        fetchTrainingTasks();
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [id]);

  const handleDeleteFailedTasks = async () => {
    const failedTasks = trainingTasks.filter(t => t.status === 'failed');
    if (failedTasks.length === 0) return;
    
    if (!confirm(`Are you sure you want to delete ${failedTasks.length} failed training task(s)?`)) {
      return;
    }
    
    setDeletingFailedTasks(true);
    try {
      for (const task of failedTasks) {
        await fetch(`http://localhost:9999/tasks/${task.id}`, { method: 'DELETE' });
      }
      toast({
        title: "Tasks Deleted",
        description: `${failedTasks.length} failed task(s) have been deleted.`
      });
      fetchTrainingTasks();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete some tasks",
        variant: "destructive"
      });
    } finally {
      setDeletingFailedTasks(false);
    }
  };

  const generateTrainingCommand = (task: any) => {
    const metadata = task.task_metadata || {};
    const modelConfig = metadata.model_config || {};
    
    let command = `# Training command for task: ${task.name}\n`;
    command += `cd backend\n`;
    command += `python -m yolo train \\\n`;
    command += `  model=${modelConfig.model || 'yolo11n.pt'} \\\n`;
    command += `  data=${metadata.dataset_path || 'data.yaml'} \\\n`;
    command += `  epochs=${metadata.training_params?.epochs || 100} \\\n`;
    command += `  imgsz=${metadata.training_params?.imgsz || 640} \\\n`;
    command += `  batch=${metadata.training_params?.batch || 16} \\\n`;
    command += `  project=runs/train \\\n`;
    command += `  name=${task.name.replace(/\s+/g, '_')}`;
    
    return command;
  };

  // Filter tasks based on search
  const filteredTasks = trainingTasks.filter(task => {
    if (!modelsSearchQuery) return true;
    const query = modelsSearchQuery.toLowerCase();
    return task.name.toLowerCase().includes(query);
  });

  // Sort tasks
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    switch (modelsSortOrder) {
      case "newest":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case "oldest":
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case "name":
        return a.name.localeCompare(b.name);
      default:
        return 0;
    }
  });

  const failedTasksCount = trainingTasks.filter(t => t.status === 'failed').length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-2">
        <Brain className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Train Model</h1>
        <Badge variant="secondary" className="ml-2">
          {trainingTasks.length} training tasks
        </Badge>
      </div>
      
      {/* Search and Filter Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search training tasks by name, type or performance..."
            className="pl-9"
            value={modelsSearchQuery}
            onChange={(e) => setModelsSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="text-muted-foreground h-4 w-4" />
          <Select value={modelsSortOrder} onValueChange={(value) => setModelsSortOrder(value as any)}>
            <SelectTrigger className="min-w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
              <SelectItem value="accuracy">Best accuracy</SelectItem>
              <SelectItem value="performance">Best performance</SelectItem>
            </SelectContent>
          </Select>
          
          <Button 
            variant="default" 
            size="sm" 
            className="whitespace-nowrap ml-2"
            onClick={() => setShowTrainModelModal(true)}
          >
            <Brain className="w-4 h-4 mr-2" />
            Train Model
          </Button>
          
          {failedTasksCount > 0 && (
            <Button 
              variant="destructive" 
              size="sm" 
              className="whitespace-nowrap ml-2"
              onClick={handleDeleteFailedTasks}
              disabled={deletingFailedTasks}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {deletingFailedTasks ? 'Deleting...' : `Delete Failed (${failedTasksCount})`}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {loadingTasks ? (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-4">Loading training tasks...</p>
        </div>
      ) : !isConnected ? (
        <div className="text-center py-16">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
          <h3 className="text-lg font-medium mb-2">API Connection Error</h3>
          <p className="text-muted-foreground mb-6">
            Unable to connect to the backend server. Please check your API settings.
          </p>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Retry
            </Button>
            <Button variant="outline" asChild>
              <Link to="/settings">Check Settings</Link>
            </Button>
          </div>
        </div>
      ) : sortedTasks.length > 0 ? (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Started</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Progress</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Model</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Size</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Epochs</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-gray-950 divide-y divide-gray-800">
              {sortedTasks.map((task) => {
                const metadata = task.task_metadata || {};
                const isRunning = task.status === 'running';
                const isFailed = task.status === 'failed';
                const isCompleted = task.status === 'completed';
                
                return (
                  <tr 
                    key={task.id} 
                    className="hover:bg-gray-900 transition-colors cursor-pointer"
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <td className="px-4 py-3 text-sm text-gray-300">#{task.id}</td>
                    <td className="px-4 py-3 text-sm text-gray-200">{task.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {new Date(task.created_at).toLocaleString('en-GB', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {isRunning && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          Running
                        </span>
                      )}
                      {isFailed && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTaskError({ name: task.name, error: task.error_message || 'Unknown error', id: task.id });
                          }}
                          className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 cursor-pointer transition-colors"
                        >
                          Failed
                        </button>
                      )}
                      {isCompleted && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                          Completed
                        </span>
                      )}
                      {task.status === 'pending' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
                          Pending
                        </span>
                      )}
                      {task.status === 'stopped' && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
                          Stopped
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 max-w-[120px]">
                          <div className="w-full bg-gray-800 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all ${
                                isFailed ? 'bg-red-500' : 
                                isCompleted ? 'bg-green-500' : 
                                task.status === 'stopped' ? 'bg-orange-500' : 
                                'bg-blue-500'
                              }`}
                              style={{ width: `${task.progress}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-xs text-gray-400 min-w-[35px]">{task.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {(() => {
                        const modelName = metadata.model_config?.model || metadata.model_type || '';
                        const family = getModelFamily(modelName);
                        if (family.includes('YOLO')) return 'YOLO';
                        if (family.includes('DETR')) return 'RT-DETR';
                        return family;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {(() => {
                        const modelName = metadata.model_config?.model || metadata.model_variant || metadata.model_type || '';
                        const family = getModelFamily(modelName);
                        const size = getModelSize(modelName);
                        return size !== '-' ? size : family;
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {(() => {
                        if (isRunning && metadata.current_epoch && metadata.epochs) {
                          return `${metadata.current_epoch}/${metadata.epochs}`;
                        } else if ((isCompleted || isFailed || task.status === 'stopped') && metadata.current_epoch) {
                          return metadata.current_epoch;
                        } else if (metadata.training_params?.epochs || metadata.epochs) {
                          return metadata.training_params?.epochs || metadata.epochs;
                        }
                        return '-';
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        {(isCompleted || isFailed || task.status === 'stopped') && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                const response = await fetch(`http://localhost:9999/training/${task.id}/rerun`, {
                                  method: 'POST'
                                });
                                if (response.ok) {
                                  const data = await response.json();
                                  toast({
                                    title: "Training Rerun Started",
                                    description: `New training task "${data.task.name}" has been created and started.`
                                  });
                                  fetchTrainingTasks();
                                } else {
                                  const errorData = await response.json();
                                  throw new Error(errorData.detail || 'Failed to rerun training task');
                                }
                              } catch (error) {
                                toast({
                                  title: "Error",
                                  description: error instanceof Error ? error.message : "Failed to rerun training task",
                                  variant: "destructive"
                                });
                              }
                            }}
                            className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-purple-800 text-purple-300 border border-purple-700 hover:bg-purple-700 hover:text-white transition-colors"
                            title="Rerun training with same settings"
                          >
                            <RotateCw className="w-4 h-4" />
                          </button>
                        )}
                        {isCompleted && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setTestInference({ id: task.id, name: task.name });
                              }}
                              className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-green-800 text-green-300 border border-green-700 hover:bg-green-700 hover:text-white transition-colors"
                              title="Test inference"
                            >
                              <TestTube className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setDownloadModel({ id: task.id, name: task.name });
                              }}
                              className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-blue-800 text-blue-300 border border-blue-700 hover:bg-blue-700 hover:text-white transition-colors"
                              title="Download model"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTaskCommand({ name: task.name, command: generateTrainingCommand(task), id: task.id });
                          }}
                          className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                          title="View CLI command"
                        >
                          <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          CLI
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingTask({ id: task.id, name: task.name });
                            setNewTaskName(task.name);
                          }}
                          className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                          title="Rename task"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Are you sure you want to delete training task "${task.name}"? This will also delete all model files.`)) {
                              return;
                            }
                            try {
                              const response = await fetch(`http://localhost:9999/tasks/${task.id}`, {
                                method: 'DELETE'
                              });
                              if (response.ok) {
                                toast({
                                  title: "Task Deleted",
                                  description: `Training task "${task.name}" has been deleted.`
                                });
                                fetchTrainingTasks();
                              } else {
                                const data = await response.json();
                                throw new Error(data.detail || 'Failed to delete task');
                              }
                            } catch (error) {
                              toast({
                                title: "Error",
                                description: error instanceof Error ? error.message : "Failed to delete training task",
                                variant: "destructive"
                              });
                            }
                          }}
                          className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-red-800 text-red-300 border border-red-700 hover:bg-red-700 hover:text-white transition-colors"
                          title="Delete training task"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        {(isRunning || task.status === 'pending') && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm(`Are you sure you want to stop training task "${task.name}"?`)) {
                                return;
                              }
                              try {
                                const response = await fetch(`http://localhost:9999/tasks/${task.id}/cancel`, {
                                  method: 'PATCH'
                                });
                                if (response.ok) {
                                  toast({
                                    title: "Training Stopped",
                                    description: `Task "${task.name}" has been cancelled.`
                                  });
                                  fetchTrainingTasks();
                                } else {
                                  throw new Error('Failed to cancel task');
                                }
                              } catch (error) {
                                toast({
                                  title: "Error",
                                  description: "Failed to stop training task",
                                  variant: "destructive"
                                });
                              }
                            }}
                            className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-red-800 text-red-300 border border-red-700 hover:bg-red-700 hover:text-white transition-colors"
                            title="Stop training"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-16">
          <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">No training tasks found</h3>
          <p className="text-muted-foreground mb-6">
            This project doesn't have any training tasks yet. Train your first model to get started.
          </p>
          <Button variant="outline" onClick={() => setShowTrainModelModal(true)}>
            <Brain className="w-4 h-4 mr-2" />
            Train Model
          </Button>
        </div>
      )}
      
      {/* Modals */}
      <TrainModelModal
        open={showTrainModelModal}
        onOpenChange={(open) => {
          setShowTrainModelModal(open);
          if (!open) {
            setTimeout(() => fetchTrainingTasks(), 1000);
          }
        }}
        datasets={datasets}
        datasetGroups={datasetGroups}
        projectId={id || ''}
      />

      {/* Error Details Modal */}
      <Dialog open={!!selectedTaskError} onOpenChange={() => setSelectedTaskError(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              Training Failed - Task #{selectedTaskError?.id}
            </DialogTitle>
            <DialogDescription>
              {selectedTaskError?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <h4 className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">Error Details:</h4>
              <pre className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono">
                {selectedTaskError?.error}
              </pre>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* CLI Command Modal */}
      <Dialog open={!!selectedTaskCommand} onOpenChange={() => setSelectedTaskCommand(null)}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              CLI Commands - Task #{selectedTaskCommand?.id}
            </DialogTitle>
            <DialogDescription>
              {selectedTaskCommand?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Copy and paste these commands in your terminal to run training without the GUI:
            </p>
            <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono overflow-x-auto">
                {selectedTaskCommand?.command}
              </pre>
            </div>
            <Button
              onClick={() => {
                if (selectedTaskCommand?.command) {
                  navigator.clipboard.writeText(selectedTaskCommand.command);
                  toast({ title: "Copied!", description: "Command copied to clipboard" });
                }
              }}
              className="w-full"
            >
              Copy All Commands
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Task Modal */}
      <Dialog open={!!renamingTask} onOpenChange={() => setRenamingTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5" />
              Rename Training Task
            </DialogTitle>
            <DialogDescription>
              Task #{renamingTask?.id}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="taskName">Task Name</Label>
              <Input
                id="taskName"
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                placeholder="Enter new task name"
                className="mt-2"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setRenamingTask(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!renamingTask || !newTaskName.trim()) return;
                  
                  try {
                    const response = await fetch(`http://localhost:9999/tasks/${renamingTask.id}`, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({
                        name: newTaskName.trim()
                      })
                    });
                    
                    if (response.ok) {
                      toast({
                        title: "Task Renamed",
                        description: `Task renamed to "${newTaskName.trim()}"`
                      });
                      setRenamingTask(null);
                      fetchTrainingTasks();
                    } else {
                      throw new Error('Failed to rename task');
                    }
                  } catch (error) {
                    toast({
                      title: "Error",
                      description: "Failed to rename task",
                      variant: "destructive"
                    });
                  }
                }}
                disabled={!newTaskName.trim() || newTaskName.trim() === renamingTask?.name}
              >
                Rename
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Training Details Modal */}
      {selectedTaskId && (
        <TrainingDetailsModal
          open={true}
          onOpenChange={(open) => !open && setSelectedTaskId(null)}
          taskId={selectedTaskId}
        />
      )}

      {/* Download Model Modal */}
      {downloadModel && (
        <DownloadModelModal
          open={true}
          onOpenChange={(open) => !open && setDownloadModel(null)}
          taskId={downloadModel.id}
          taskName={downloadModel.name}
        />
      )}

      {/* Test Inference Modal */}
      {testInference && (
        <TestTrainingInferenceModal
          open={true}
          onOpenChange={(open) => !open && setTestInference(null)}
          taskId={testInference.id}
          taskName={testInference.name}
        />
      )}
    </div>
  );
}
