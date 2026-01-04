import React, { useState, useEffect } from 'react';
import { useParams, Link, useOutletContext } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { EvaluationDetailsModal } from '@/components/EvaluationDetailsModal';
import { EvaluateModelModal } from '@/components/EvaluateModelModal';
import { AlertCircle, Activity, Brain, Trash2, Pencil, ChevronDown, Database } from "lucide-react";
import { Project, DatasetGroup } from '@/types';
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

export default function ProjectEvaluations() {
  const { id } = useParams<{ id: string }>();
  const { project } = useOutletContext<OutletContext>();
  const { isConnected } = useApi();
  const { toast } = useToast();
  
  const [trainingTasks, setTrainingTasks] = useState<any[]>([]);
  const [evaluationTasks, setEvaluationTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [expandedEvaluations, setExpandedEvaluations] = useState<Set<number>>(new Set());
  const [renamingTask, setRenamingTask] = useState<{ id: number; name: string } | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [datasets, setDatasets] = useState<any[]>([]);
  const [datasetGroups, setDatasetGroups] = useState<DatasetGroup[]>([]);

  // Fetch all tasks
  const fetchTasks = async () => {
    if (!id) return;
    
    setLoadingTasks(true);
    try {
      const response = await fetch(`http://localhost:9999/tasks/?project_id=${id}`);
      if (response.ok) {
        const data = await response.json();
        // Separate training and evaluation tasks
        setTrainingTasks(data.filter((t: any) => t.task_type !== 'model_evaluation'));
        setEvaluationTasks(data.filter((t: any) => t.task_type === 'model_evaluation'));
      }
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoadingTasks(false);
    }
  };

  // Fetch datasets for evaluation modal
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
    fetchTasks();
    fetchDatasets();
    fetchDatasetGroups();
    
    // Polling for running tasks
    const interval = setInterval(() => {
      if (evaluationTasks.some(t => t.status === 'running' || t.status === 'pending')) {
        fetchTasks();
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [id]);

  // Filter to show only parent tasks and single dataset tasks (not child tasks)
  const parentEvaluations = evaluationTasks.filter(t => !t.task_metadata?.parent_task_id);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Model Evaluations</h1>
          <Badge variant="secondary" className="ml-2">
            {parentEvaluations.length} evaluations
          </Badge>
        </div>
        
        <Button 
          variant="default" 
          size="sm" 
          className="whitespace-nowrap"
          onClick={() => setShowEvaluationModal(true)}
        >
          <Brain className="w-4 h-4 mr-2" />
          New Evaluation
        </Button>
      </div>

      {/* Content */}
      {loadingTasks ? (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-4">Loading evaluation tasks...</p>
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
              <Link to="/api-settings">Check Settings</Link>
            </Button>
          </div>
        </div>
      ) : parentEvaluations.length > 0 ? (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-8"></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Dataset</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Progress</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Model</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Images</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-gray-950 divide-y divide-gray-800">
              {parentEvaluations.map((task) => {
                const metadata = task.task_metadata || {};
                const isRunning = task.status === 'running';
                const isFailed = task.status === 'failed';
                const isCompleted = task.status === 'completed';
                const isMultiDataset = metadata.is_multi_dataset;
                const childTaskIds = metadata.child_task_ids || [];
                const isExpanded = expandedEvaluations.has(task.id);
                
                // Get child tasks for multi-dataset evaluations
                const childTasks = isMultiDataset 
                  ? evaluationTasks.filter(t => childTaskIds.includes(t.id))
                  : [];
                
                // Calculate aggregate progress for multi-dataset
                const aggregateProgress = isMultiDataset && childTasks.length > 0
                  ? Math.round(childTasks.reduce((sum, ct) => sum + (ct.progress || 0), 0) / childTasks.length)
                  : task.progress;
                
                // Calculate aggregate status for multi-dataset
                const getAggregateStatus = () => {
                  if (!isMultiDataset) return task.status;
                  if (childTasks.every(ct => ct.status === 'completed')) return 'completed';
                  if (childTasks.some(ct => ct.status === 'failed')) return 'partial_failed';
                  if (childTasks.some(ct => ct.status === 'running')) return 'running';
                  return task.status;
                };
                const aggregateStatus = getAggregateStatus();
                
                return (
                  <React.Fragment key={task.id}>
                    <tr 
                      className={`hover:bg-gray-900 transition-colors cursor-pointer ${isMultiDataset ? 'bg-gray-900/50' : ''}`}
                      onClick={() => {
                        if (isMultiDataset) {
                          setExpandedEvaluations(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(task.id)) {
                              newSet.delete(task.id);
                            } else {
                              newSet.add(task.id);
                            }
                            return newSet;
                          });
                        } else {
                          setSelectedTaskId(task.id);
                        }
                      }}
                    >
                      {/* Expand/Collapse button for multi-dataset */}
                      <td className="px-2 py-3 text-sm text-gray-400">
                        {isMultiDataset && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedEvaluations(prev => {
                                const newSet = new Set(prev);
                                if (newSet.has(task.id)) {
                                  newSet.delete(task.id);
                                } else {
                                  newSet.add(task.id);
                                }
                                return newSet;
                              });
                            }}
                            className="p-0.5 hover:bg-gray-800 rounded"
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 -rotate-90" />}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-300">#{task.id}</td>
                      <td className="px-4 py-3 text-sm text-gray-200">
                        <div className="flex items-center gap-2">
                          {task.name}
                          {isMultiDataset && (
                            <Badge variant="outline" className="text-xs">
                              {childTaskIds.length} datasets
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {isMultiDataset 
                          ? `${metadata.dataset_names?.join(', ') || 'Multiple'}` 
                          : metadata.dataset_name || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {aggregateStatus === 'running' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                            Running
                          </span>
                        )}
                        {aggregateStatus === 'failed' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                            Failed
                          </span>
                        )}
                        {aggregateStatus === 'partial_failed' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
                            Partial
                          </span>
                        )}
                        {aggregateStatus === 'completed' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                            Completed
                          </span>
                        )}
                        {aggregateStatus === 'pending' && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 max-w-[120px]">
                            <div className="w-full bg-gray-800 rounded-full h-2">
                              <div
                                className={`h-2 rounded-full transition-all ${
                                  aggregateStatus === 'failed' || aggregateStatus === 'partial_failed' ? 'bg-red-500' : 
                                  aggregateStatus === 'completed' ? 'bg-green-500' : 
                                  'bg-blue-500'
                                }`}
                                style={{ width: `${aggregateProgress}%` }}
                              />
                            </div>
                          </div>
                          <span className="text-xs text-gray-400 min-w-[35px]">{aggregateProgress}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {(() => {
                          const modelName = metadata.model_config?.model || metadata.model_type || '';
                          const family = getModelFamily(modelName);
                          if (family.includes('YOLO')) return 'YOLO';
                          if (family.includes('DETR')) return 'RT-DETR';
                          return family || 'Evaluation';
                        })()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400">
                        {isMultiDataset 
                          ? childTasks.filter(ct => ct.status === 'completed').reduce((sum, ct) => sum + (ct.task_metadata?.results?.images_processed || 0), 0)
                          : (isCompleted && metadata.results?.images_processed ? `${metadata.results.images_processed}` : '-')}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex items-center gap-2">
                          {isMultiDataset && aggregateStatus === 'completed' && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const response = await fetch(`http://localhost:9999/predictions/export-coco-all/${task.id}`);
                                  if (!response.ok) throw new Error('Failed to download');
                                  const blob = await response.blob();
                                  const url = window.URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `evaluation_${task.id}_all_coco.zip`;
                                  document.body.appendChild(a);
                                  a.click();
                                  window.URL.revokeObjectURL(url);
                                  document.body.removeChild(a);
                                  toast({ title: "Download Complete", description: "All COCO files downloaded" });
                                } catch (error) {
                                  toast({ title: "Download Failed", description: "Failed to download COCO files", variant: "destructive" });
                                }
                              }}
                              className="inline-flex items-center p-1.5 rounded text-xs font-medium bg-green-800 text-green-300 border border-green-700 hover:bg-green-700 hover:text-white transition-colors"
                              title="Download All COCO predictions"
                            >
                              <Database className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenamingTask({ id: task.id, name: task.name });
                              setNewTaskName(task.name);
                            }}
                            className="inline-flex items-center p-1.5 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                            title="Rename task"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm(`Are you sure you want to delete evaluation task "${task.name}"${isMultiDataset ? ' and all its child evaluations' : ''}?`)) {
                                return;
                              }
                              try {
                                const response = await fetch(`http://localhost:9999/tasks/${task.id}`, {
                                  method: 'DELETE'
                                });
                                if (response.ok) {
                                  toast({
                                    title: "Task Deleted",
                                    description: `Evaluation task "${task.name}" has been deleted.`
                                  });
                                  fetchTasks();
                                } else {
                                  throw new Error('Failed to delete task');
                                }
                              } catch (error) {
                                toast({
                                  title: "Error",
                                  description: "Failed to delete evaluation task",
                                  variant: "destructive"
                                });
                              }
                            }}
                            className="inline-flex items-center p-1.5 rounded text-xs font-medium bg-red-800 text-red-300 border border-red-700 hover:bg-red-700 hover:text-white transition-colors"
                            title="Delete task"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    
                    {/* Child tasks for multi-dataset evaluations */}
                    {isMultiDataset && isExpanded && childTasks.map((childTask) => {
                      const childMetadata = childTask.task_metadata || {};
                      const childIsRunning = childTask.status === 'running';
                      const childIsFailed = childTask.status === 'failed';
                      const childIsCompleted = childTask.status === 'completed';
                      
                      return (
                        <tr 
                          key={childTask.id}
                          className="hover:bg-gray-900 transition-colors cursor-pointer bg-gray-900/30"
                          onClick={() => setSelectedTaskId(childTask.id)}
                        >
                          <td className="px-2 py-2"></td>
                          <td className="px-4 py-2 text-sm text-gray-400 pl-8">└ #{childTask.id}</td>
                          <td className="px-4 py-2 text-sm text-gray-300">{childMetadata.dataset_name || 'Unknown'}</td>
                          <td className="px-4 py-2 text-sm text-gray-400">{childMetadata.dataset_name || '-'}</td>
                          <td className="px-4 py-2 text-sm">
                            {childIsRunning && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                Running
                              </span>
                            )}
                            {childIsFailed && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30">
                                Failed
                              </span>
                            )}
                            {childIsCompleted && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                                Completed
                              </span>
                            )}
                            {childTask.status === 'pending' && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
                                Pending
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 max-w-[100px]">
                                <div className="w-full bg-gray-800 rounded-full h-1.5">
                                  <div
                                    className={`h-1.5 rounded-full transition-all ${
                                      childIsFailed ? 'bg-red-500' : 
                                      childIsCompleted ? 'bg-green-500' : 
                                      'bg-blue-500'
                                    }`}
                                    style={{ width: `${childTask.progress}%` }}
                                  />
                                </div>
                              </div>
                              <span className="text-xs text-gray-500">{childTask.progress}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-500">-</td>
                          <td className="px-4 py-2 text-sm text-gray-400">
                            {childIsCompleted && childMetadata.results?.images_processed 
                              ? childMetadata.results.images_processed 
                              : '-'}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            <div className="flex items-center gap-1">
                              {childIsCompleted && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      const response = await fetch(`http://localhost:9999/predictions/export-coco/${childTask.id}`);
                                      if (!response.ok) throw new Error('Failed to download');
                                      const blob = await response.blob();
                                      const url = window.URL.createObjectURL(blob);
                                      const a = document.createElement('a');
                                      a.href = url;
                                      a.download = `evaluation_${childTask.id}_coco.json`;
                                      document.body.appendChild(a);
                                      a.click();
                                      window.URL.revokeObjectURL(url);
                                      document.body.removeChild(a);
                                    } catch (error) {
                                      toast({ title: "Error", description: "Failed to download COCO file", variant: "destructive" });
                                    }
                                  }}
                                  className="inline-flex items-center p-1 rounded text-xs bg-green-800/50 text-green-400 hover:bg-green-700 transition-colors"
                                  title="Download COCO predictions"
                                >
                                  <Database className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-center py-16">
          <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">No Evaluations Yet</h3>
          <p className="text-muted-foreground mb-6">
            Start evaluating your trained models to analyze their performance.
          </p>
          <Button onClick={() => setShowEvaluationModal(true)}>
            <Brain className="w-4 h-4 mr-2" />
            New Evaluation
          </Button>
        </div>
      )}
      
      {/* Modals */}
      {/* Rename Task Modal */}
      <Dialog open={!!renamingTask} onOpenChange={() => setRenamingTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-5 h-5" />
              Rename Evaluation Task
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
                      fetchTasks();
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

      {/* Evaluation Details Modal */}
      {selectedTaskId && (
        <EvaluationDetailsModal
          open={true}
          onOpenChange={(open) => !open && setSelectedTaskId(null)}
          taskId={selectedTaskId}
        />
      )}

      {/* Evaluate Model Modal */}
      <EvaluateModelModal
        open={showEvaluationModal}
        onOpenChange={setShowEvaluationModal}
        trainingTasks={trainingTasks}
        projectId={id || ''}
        datasets={datasets}
        datasetGroups={datasetGroups}
        onEvaluate={async (params) => {
          try {
            const response = await fetch('http://localhost:9999/predictions/evaluate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                task_id: params.taskId,
                dataset_id: params.datasetId,
                annotation_file_id: params.annotationFileId,
                checkpoint: params.checkpoint,
                conf_threshold: params.confThreshold,
                iou_threshold: params.iouThreshold,
                evaluation_name: params.evaluationName || null,
                use_grid: params.useGrid,
                grid_size: params.gridSize,
                grid_overlap: params.gridOverlap,
                ignored_classes: params.ignoredClasses || []
              })
            });

            if (!response.ok) {
              let errorMessage = 'Evaluation failed';
              try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.message || errorMessage;
              } catch (e) {
                const errorText = await response.text();
                if (errorText) errorMessage = errorText;
              }
              throw new Error(errorMessage);
            }

            const data = await response.json();
            
            toast({
              title: "Evaluation Started",
              description: `Task "${data.task_name}" has been created.`
            });
            
            await fetchTasks();
            setShowEvaluationModal(false);
          } catch (error) {
            console.error('Error evaluating model:', error);
            toast({
              title: "Evaluation Failed",
              description: error instanceof Error ? error.message : "An error occurred",
              variant: "destructive"
            });
            throw error;
          }
        }}
        onEvaluateMultiple={async (params) => {
          try {
            const requestBody = {
              task_id: params.taskId,
              datasets: params.datasets,
              checkpoint: params.checkpoint,
              conf_threshold: params.confThreshold,
              iou_threshold: params.iouThreshold,
              evaluation_name: params.evaluationName || null,
              use_grid: params.useGrid,
              grid_size: params.gridSize,
              grid_overlap: params.gridOverlap,
              ignored_classes: params.ignoredClasses || []
            };
            
            const response = await fetch('http://localhost:9999/predictions/evaluate-multiple', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
              let errorMessage = 'Multi-dataset evaluation failed';
              try {
                const errorData = await response.json();
                errorMessage = errorData.detail || errorData.message || errorMessage;
              } catch (e) {
                const errorText = await response.text();
                if (errorText) errorMessage = errorText;
              }
              throw new Error(errorMessage);
            }

            const data = await response.json();
            
            toast({
              title: "Multi-Dataset Evaluation Started",
              description: `Task "${data.task_name}" has been created with ${data.child_task_ids?.length || 0} dataset evaluations.`
            });
            
            await fetchTasks();
            setShowEvaluationModal(false);
          } catch (error) {
            console.error('Error evaluating model on multiple datasets:', error);
            toast({
              title: "Evaluation Failed",
              description: error instanceof Error ? error.message : "An error occurred",
              variant: "destructive"
            });
            throw error;
          }
        }}
      />
    </div>
  );
}
