import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link, useOutletContext } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { EvaluationDetailsModal } from '@/components/EvaluationDetailsModal';
import { EvaluateModelModal } from '@/components/EvaluateModelModal';
import { AlertCircle, Activity, Trash2, Pencil, ChevronDown, Download, Search, SlidersHorizontal } from "lucide-react";
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
import {
  formatEvaluationModelDisplay,
  formatMetricPct,
  getEvaluationRowMetrics,
} from "@/lib/evaluationTableDisplay";

interface OutletContext {
  project: Project | null;
  loading: boolean;
}

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
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">("newest");
  const [renamingTask, setRenamingTask] = useState<{ id: number; name: string } | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [datasets, setDatasets] = useState<any[]>([]);
  const [datasetGroups, setDatasetGroups] = useState<DatasetGroup[]>([]);
  const [modalResourcesLoading, setModalResourcesLoading] = useState(false);

  const evaluationTasksRef = useRef<any[]>([]);
  evaluationTasksRef.current = evaluationTasks;

  /** Only evaluation tasks; metadata_mode=list keeps payloads small (no inline predictions). */
  const fetchEvaluationTasks = useCallback(async () => {
    if (!id) return;

    setLoadingTasks(true);
    try {
      const response = await fetch(
        `http://localhost:9999/tasks/?project_id=${id}&task_type=model_evaluation&metadata_mode=list&limit=200`
      );
      if (response.ok) {
        const data = await response.json();
        setEvaluationTasks(data);
      }
    } catch (error) {
      console.error('Error fetching evaluation tasks:', error);
    } finally {
      setLoadingTasks(false);
    }
  }, [id]);

  /** Loaded when "New Evaluation" opens — avoids blocking the evaluations table. */
  const loadModalResources = useCallback(async () => {
    if (!id) return;
    setModalResourcesLoading(true);
    try {
      const [dsRes, dgRes, trRes] = await Promise.all([
        fetch(`http://localhost:9999/projects/${id}/datasets/list`),
        fetch(`http://localhost:9999/projects/${id}/dataset-groups/`),
        fetch(
          `http://localhost:9999/tasks/?project_id=${id}&task_type=yolo_training&status=completed&metadata_mode=list&limit=150`
        ),
      ]);
      if (dsRes.ok) {
        const result = await dsRes.json();
        if (result.success && result.data) setDatasets(result.data);
      }
      if (dgRes.ok) {
        const result = await dgRes.json();
        if (result.success) setDatasetGroups(result.data);
      }
      if (trRes.ok) {
        setTrainingTasks(await trRes.json());
      }
    } catch (error) {
      console.error('Error loading evaluation modal data:', error);
    } finally {
      setModalResourcesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetchEvaluationTasks();

    const interval = setInterval(() => {
      if (
        evaluationTasksRef.current.some(
          (t) => t.status === 'running' || t.status === 'pending'
        )
      ) {
        fetchEvaluationTasks();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [id, fetchEvaluationTasks]);

  useEffect(() => {
    if (!showEvaluationModal || !id) return;
    loadModalResources();
  }, [showEvaluationModal, id, loadModalResources]);

  // Filter to show only parent tasks and single dataset tasks (not child tasks)
  const parentEvaluations = evaluationTasks.filter(t => !t.task_metadata?.parent_task_id);
  const formatDatasetCollectionLabel = (datasetName?: string, collectionName?: string) => {
    if (!datasetName) return '-';
    if (!collectionName) return datasetName;
    return `${datasetName} (${collectionName})`;
  };

  // Filter and sort
  const visibleEvaluations = (() => {
    let result = parentEvaluations;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t => t.name?.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      switch (sortOrder) {
        case "oldest":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "name":
          return (a.name || "").localeCompare(b.name || "");
        case "newest":
        default:
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
    });
  })();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-2">
        <Activity className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Model Evaluations</h1>
        <Badge variant="secondary" className="ml-2">
          {parentEvaluations.length} evaluations
        </Badge>
      </div>

      {/* Search and Filter Controls (mirrors Models page) */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search evaluations by name..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <SlidersHorizontal className="text-muted-foreground h-4 w-4" />
          <Select value={sortOrder} onValueChange={(v) => setSortOrder(v as any)}>
            <SelectTrigger className="min-w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="default"
            size="sm"
            className="whitespace-nowrap ml-2"
            onClick={() => setShowEvaluationModal(true)}
          >
            <Activity className="w-4 h-4 mr-2" />
            New Evaluation
          </Button>
        </div>
      </div>

      {/* Content */}
      {loadingTasks ? (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-4">Loading evaluation tasks...</p>
        </div>
      ) : isConnected === false ? (
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
      ) : parentEvaluations.length > 0 ? (
        <div className="border border-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full table-fixed">
            <thead className="bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-8"></th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-14">ID</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-40">Name</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-48">Dataset</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-24">Status</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-32">Progress</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-40">Model</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-16">Prec.</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-16">Rec.</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-14">F1</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-28">Images</th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-28">Actions</th>
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
                const metrics = getEvaluationRowMetrics(metadata, {
                  isMultiDataset,
                  aggregateStatus,
                });
                const modelDisplay = formatEvaluationModelDisplay(metadata);
                
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
                      <td className="px-2 py-2 text-xs text-gray-300">#{task.id}</td>
                      <td className="px-2 py-2 text-xs text-gray-200">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate" title={task.name}>{task.name}</span>
                          {isMultiDataset && (
                            <Badge variant="outline" className="text-xs">
                              {childTaskIds.length} datasets
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-400">
                        <span className="block line-clamp-2" title={isMultiDataset
                          ? (childTasks.length > 0
                            ? childTasks
                                .map((ct) => formatDatasetCollectionLabel(
                                  ct.task_metadata?.dataset_name,
                                  ct.task_metadata?.collection_name,
                                ))
                                .join(', ')
                            : `${metadata.dataset_names?.join(', ') || 'Multiple'}`)
                          : formatDatasetCollectionLabel(metadata.dataset_name, metadata.collection_name)}>
                          {isMultiDataset
                            ? (childTasks.length > 0
                              ? childTasks
                                  .map((ct) => formatDatasetCollectionLabel(
                                    ct.task_metadata?.dataset_name,
                                    ct.task_metadata?.collection_name,
                                  ))
                                  .join(', ')
                              : `${metadata.dataset_names?.join(', ') || 'Multiple'}`)
                            : formatDatasetCollectionLabel(metadata.dataset_name, metadata.collection_name)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs">
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
                      <td className="px-2 py-2 text-xs">
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
                      <td className="px-2 py-2 text-xs text-gray-300">
                        <span className="block line-clamp-2" title={modelDisplay}>
                          {modelDisplay}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-400 tabular-nums">
                        {metrics ? formatMetricPct(metrics.precision) : "—"}
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-400 tabular-nums">
                        {metrics ? formatMetricPct(metrics.recall) : "—"}
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-400 tabular-nums">
                        {metrics ? formatMetricPct(metrics.f1) : "—"}
                      </td>
                      <td className="px-2 py-2 text-xs text-gray-400">
                        {isMultiDataset
                          ? (() => {
                              const images = childTasks
                                .filter(ct => ct.status === 'completed')
                                .reduce((sum, ct) => sum + (ct.task_metadata?.results?.images_processed || 0), 0);
                              const preds = childTasks
                                .filter(ct => ct.status === 'completed')
                                .reduce((sum, ct) => sum + (ct.task_metadata?.results?.predictions_count || 0), 0);
                              return images > 0 ? `${images} / ${preds} preds` : '-';
                            })()
                          : (isCompleted && metadata.results?.images_processed
                            ? `${metadata.results.images_processed} / ${metadata.results?.predictions_count || 0} preds`
                            : '-')}
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <div className="flex items-center gap-1.5">
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
                          {!isMultiDataset && isCompleted && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const predCount = metadata.results?.predictions_count || 0;
                                if (predCount <= 0) {
                                  toast({
                                    title: "No Predictions",
                                    description: "This evaluation has no predictions to export.",
                                    variant: "destructive"
                                  });
                                  return;
                                }
                                try {
                                  const response = await fetch(`http://localhost:9999/predictions/export-coco/${task.id}`);
                                  if (!response.ok) {
                                    let message = 'Failed to download';
                                    try {
                                      const errorData = await response.json();
                                      message = errorData.detail || errorData.message || message;
                                    } catch {
                                      const text = await response.text();
                                      if (text) message = text;
                                    }
                                    throw new Error(message);
                                  }
                                  const blob = await response.blob();
                                  const url = window.URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = `evaluation_${task.id}_coco.json`;
                                  document.body.appendChild(a);
                                  a.click();
                                  window.URL.revokeObjectURL(url);
                                  document.body.removeChild(a);
                                  toast({ title: "Download Complete", description: "COCO results downloaded" });
                                } catch (error) {
                                  toast({
                                    title: "Download Failed",
                                    description: error instanceof Error ? error.message : "Failed to download COCO file",
                                    variant: "destructive"
                                  });
                                }
                              }}
                              className="inline-flex items-center p-1.5 rounded text-xs font-medium bg-green-800 text-green-300 border border-green-700 hover:bg-green-700 hover:text-white transition-colors"
                              title="Download COCO predictions"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isMultiDataset && aggregateStatus === 'completed' && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const totalPredictions = childTasks
                                  .filter(ct => ct.status === 'completed')
                                  .reduce((sum, ct) => sum + (ct.task_metadata?.results?.predictions_count || 0), 0);
                                if (totalPredictions <= 0) {
                                  toast({
                                    title: "No Predictions",
                                    description: "No predictions available for this evaluation yet.",
                                    variant: "destructive"
                                  });
                                  return;
                                }
                                try {
                                  const response = await fetch(`http://localhost:9999/predictions/export-coco-all/${task.id}`);
                                  if (!response.ok) {
                                    let message = 'Failed to download';
                                    try {
                                      const errorData = await response.json();
                                      message = errorData.detail || errorData.message || message;
                                    } catch {
                                      const text = await response.text();
                                      if (text) message = text;
                                    }
                                    throw new Error(message);
                                  }
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
                                  toast({
                                    title: "Download Failed",
                                    description: error instanceof Error ? error.message : "Failed to download COCO files",
                                    variant: "destructive"
                                  });
                                }
                              }}
                              className="inline-flex items-center p-1.5 rounded text-xs font-medium bg-green-800 text-green-300 border border-green-700 hover:bg-green-700 hover:text-white transition-colors"
                              title="Download all COCO predictions (ZIP)"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
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
                                  fetchEvaluationTasks();
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
                      const childMetrics = getEvaluationRowMetrics(childMetadata, {
                        isMultiDataset: false,
                        aggregateStatus: childTask.status,
                      });
                      const childModelDisplay = formatEvaluationModelDisplay(childMetadata);
                      
                      return (
                        <tr 
                          key={childTask.id}
                          className="hover:bg-gray-900 transition-colors cursor-pointer bg-gray-900/30"
                          onClick={() => setSelectedTaskId(childTask.id)}
                        >
                          <td className="px-2 py-2"></td>
                          <td className="px-4 py-2 text-sm text-gray-400 pl-8">└ #{childTask.id}</td>
                          <td className="px-4 py-2 text-sm text-gray-300">{childMetadata.dataset_name || 'Unknown'}</td>
                          <td className="px-4 py-2 text-sm text-gray-400">
                            {formatDatasetCollectionLabel(childMetadata.dataset_name, childMetadata.collection_name)}
                          </td>
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
                          <td className="px-4 py-2 text-sm text-gray-300 max-w-[200px]">
                            <span className="line-clamp-2 text-xs" title={childModelDisplay}>
                              {childModelDisplay}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-400 tabular-nums text-xs">
                            {childMetrics ? formatMetricPct(childMetrics.precision) : "—"}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-400 tabular-nums text-xs">
                            {childMetrics ? formatMetricPct(childMetrics.recall) : "—"}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-400 tabular-nums text-xs">
                            {childMetrics ? formatMetricPct(childMetrics.f1) : "—"}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-400">
                            {childIsCompleted && childMetadata.results?.images_processed
                              ? `${childMetadata.results.images_processed} / ${childMetadata.results?.predictions_count || 0} preds`
                              : '-'}
                          </td>
                          <td className="px-4 py-2 text-sm">
                            <div className="flex items-center gap-1">
                              {childIsCompleted && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const predCount = childMetadata.results?.predictions_count || 0;
                                    if (predCount <= 0) {
                                      toast({
                                        title: "No Predictions",
                                        description: "This evaluation has no predictions to export.",
                                        variant: "destructive"
                                      });
                                      return;
                                    }
                                    try {
                                      const response = await fetch(`http://localhost:9999/predictions/export-coco/${childTask.id}`);
                                      if (!response.ok) {
                                        let message = 'Failed to download';
                                        try {
                                          const errorData = await response.json();
                                          message = errorData.detail || errorData.message || message;
                                        } catch {
                                          const text = await response.text();
                                          if (text) message = text;
                                        }
                                        throw new Error(message);
                                      }
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
                                      toast({
                                        title: "Error",
                                        description: error instanceof Error ? error.message : "Failed to download COCO file",
                                        variant: "destructive"
                                      });
                                    }
                                  }}
                                  className="inline-flex items-center p-1 rounded text-xs bg-green-800/50 text-green-400 hover:bg-green-700 transition-colors"
                                  title="Download COCO predictions"
                                >
                                  <Download className="w-3 h-3" />
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
          <Activity className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">No Evaluations Yet</h3>
          <p className="text-muted-foreground mb-6">
            Start evaluating your trained models to analyze their performance.
          </p>
          <Button onClick={() => setShowEvaluationModal(true)}>
            <Activity className="w-4 h-4 mr-2" />
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
                      fetchEvaluationTasks();
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
          onSaved={fetchEvaluationTasks}
        />
      )}

      {/* Evaluate Model Modal */}
      <EvaluateModelModal
        open={showEvaluationModal}
        onOpenChange={setShowEvaluationModal}
        trainingTasks={trainingTasks}
        resourcesLoading={modalResourcesLoading}
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
                collection_id: params.collectionId ? parseInt(params.collectionId, 10) : null,
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
            
            await fetchEvaluationTasks();
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
              datasets: params.datasets.map((d) => ({
                ...d,
                collectionId: d.collectionId ? parseInt(d.collectionId, 10) : null,
              })),
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
            
            await fetchEvaluationTasks();
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
