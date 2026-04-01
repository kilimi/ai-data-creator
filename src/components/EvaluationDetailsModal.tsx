import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, Activity, Download, Eye, ChevronDown, Database, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { type CmSample } from "@/components/ConfusionMatrixCellModal";
import { ThresholdExplorer, type RawPrediction, type RawGTBox } from "@/components/ThresholdExplorer";

interface EvaluationDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
  onSaved?: () => void;
}

interface TaskDetails {
  id: number;
  name: string;
  status: string;
  progress: number;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  task_metadata?: {
    training_task_name?: string;
    dataset_name?: string;
    checkpoint?: string;
    conf_threshold?: number;
    iou_threshold?: number;
    has_ground_truth?: boolean;
    use_grid?: boolean;
    grid_size?: number;
    grid_overlap?: number;
    is_multi_dataset?: boolean;
    dataset_count?: number;
    dataset_names?: string[];
    child_task_ids?: number[];
    results?: {
      precision: number;
      recall: number;
      f1_score: number;
      map50: number;
      map50_95: number;
      confusion_matrix: number[][];
      class_names: string[];
      confusion_matrix_samples?: Record<string, CmSample[]>;
      project_id?: number;
      dataset_id?: number;
      predictions_count: number;
      images_processed: number;
      inference_time_ms: number;
      all_ground_truth?: RawGTBox[];
      image_id_to_filename?: Record<string, string>;
      predictions?: RawPrediction[];
      conf_threshold?: number;
      iou_threshold?: number;
      per_class_conf?: Record<string, number>;
      artifacts?: { blobs?: string; format_version?: number };
    };
  };
}

interface EvalBlobPayload {
  predictions: RawPrediction[];
  all_ground_truth: RawGTBox[];
  confusion_matrix_samples?: Record<string, CmSample[]>;
}

export function EvaluationDetailsModal({ open, onOpenChange, taskId, onSaved }: EvaluationDetailsModalProps) {
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [childTasks, setChildTasks] = useState<TaskDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [launchingFiftyOne, setLaunchingFiftyOne] = useState(false);
  const [expandedChildId, setExpandedChildId] = useState<number | null>(null);
  const [evalBlobPayload, setEvalBlobPayload] = useState<EvalBlobPayload | null>(null);
  const [evalBlobsLoading, setEvalBlobsLoading] = useState(false);
  const [evalBlobsError, setEvalBlobsError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open && taskId) {
      fetchTaskDetails();
    }
  }, [open, taskId]);

  /** Large predictions/GT live in gzip JSON on disk; fetch after task row loads. */
  useEffect(() => {
    if (!open || !taskId || !task || task.id !== taskId || task.status !== "completed") {
      setEvalBlobPayload(null);
      setEvalBlobsLoading(false);
      setEvalBlobsError(null);
      return;
    }
    const r = task.task_metadata?.results;
    if (!r?.artifacts?.blobs || r.predictions !== undefined) {
      setEvalBlobPayload(null);
      setEvalBlobsLoading(false);
      setEvalBlobsError(null);
      return;
    }
    let cancelled = false;
    setEvalBlobsLoading(true);
    setEvalBlobsError(null);
    fetch(`http://localhost:9999/predictions/evaluation-blobs/${taskId}`)
      .then(async (res) => {
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: EvalBlobPayload) => {
        if (!cancelled) {
          setEvalBlobPayload({
            predictions: data.predictions ?? [],
            all_ground_truth: data.all_ground_truth ?? [],
            confusion_matrix_samples: data.confusion_matrix_samples,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEvalBlobPayload(null);
          setEvalBlobsError(err instanceof Error ? err.message : "Failed to load evaluation blobs");
        }
      })
      .finally(() => {
        if (!cancelled) setEvalBlobsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, taskId, task?.id, task?.status, task?.task_metadata?.results?.artifacts?.blobs, task?.task_metadata?.results?.predictions]);

  const mergedResults = useMemo(() => {
    if (!task) return undefined;
    const md = task.task_metadata || {};
    const raw = md.results;
    if (!raw) return undefined;
    if (evalBlobPayload) return { ...raw, ...evalBlobPayload };
    return raw;
  }, [task, evalBlobPayload]);

  useEffect(() => {
    if (!open || !taskId) return;
    
    // Poll for updates if task is running
    const interval = setInterval(() => {
      if (task?.status === 'running' || childTasks.some(ct => ct.status === 'running')) {
        fetchTaskDetails();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [open, taskId, task?.status, childTasks]);

  const fetchTaskDetails = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`http://localhost:9999/tasks/${taskId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch evaluation details: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Evaluation task details:', data);
      setTask(data);
      
      // Fetch child tasks if this is a multi-dataset evaluation
      if (data.task_metadata?.is_multi_dataset && data.task_metadata?.child_task_ids?.length > 0) {
        const childPromises = data.task_metadata.child_task_ids.map((id: number) =>
          fetch(`http://localhost:9999/tasks/${id}`).then(r => r.json())
        );
        const children = await Promise.all(childPromises);
        setChildTasks(children);
      } else {
        setChildTasks([]);
      }
    } catch (err) {
      console.error('Error fetching evaluation details:', err);
      setError(err instanceof Error ? err.message : 'Failed to load evaluation details');
    } finally {
      setLoading(false);
    }
  };

  const refreshTaskMetadata = useCallback(async () => {
    try {
      const response = await fetch(`http://localhost:9999/tasks/${taskId}`);
      if (!response.ok) return;
      const data = await response.json();
      setTask(data);
    } catch { /* silent */ }
    onSaved?.();
  }, [taskId, onSaved]);

  const formatDuration = (start: string, end?: string) => {
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date();
    const duration = endDate.getTime() - startDate.getTime();
    
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((duration % (1000 * 60)) / 1000);
    
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, any> = {
      running: { color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', label: 'Running' },
      completed: { color: 'bg-green-500/20 text-green-400 border-green-500/30', label: 'Completed' },
      failed: { color: 'bg-red-500/20 text-red-400 border-red-500/30', label: 'Failed' },
      pending: { color: 'bg-gray-500/20 text-gray-400 border-gray-500/30', label: 'Pending' },
      stopped: { color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', label: 'Stopped' },
    };
    
    const variant = variants[status] || variants.pending;
    return (
      <Badge className={`${variant.color} border`}>
        {variant.label}
      </Badge>
    );
  };

  const downloadCocoResults = async (taskIdToDownload?: number) => {
    const downloadTaskId = taskIdToDownload || taskId;
    
    setDownloading(true);
    try {
      const response = await fetch(`http://localhost:9999/predictions/export-coco/${downloadTaskId}`);
      
      if (!response.ok) {
        throw new Error('Failed to download results');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evaluation_${downloadTaskId}_coco.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Download Complete",
        description: "COCO format results have been downloaded"
      });
    } catch (err) {
      console.error('Error downloading COCO results:', err);
      toast({
        title: "Download Failed",
        description: "Failed to download evaluation results",
        variant: "destructive"
      });
    } finally {
      setDownloading(false);
    }
  };

  const downloadAllCocoResults = async () => {
    if (!task?.task_metadata?.is_multi_dataset) return;
    
    setDownloadingAll(true);
    try {
      const response = await fetch(`http://localhost:9999/predictions/export-coco-all/${taskId}`);
      
      if (!response.ok) {
        throw new Error('Failed to download results');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evaluation_${taskId}_all_coco.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Download Complete",
        description: "All COCO format results have been downloaded as a ZIP file"
      });
    } catch (err) {
      console.error('Error downloading all COCO results:', err);
      toast({
        title: "Download Failed",
        description: "Failed to download evaluation results",
        variant: "destructive"
      });
    } finally {
      setDownloadingAll(false);
    }
  };

  const viewInFiftyOne = async () => {
    if (!task || task.status !== 'completed') return;
    
    setLaunchingFiftyOne(true);
    try {
      const response = await fetch(`http://localhost:9999/predictions/view-fiftyone/${taskId}`, {
        method: 'POST'
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Failed to launch FiftyOne' }));
        throw new Error(errorData.detail || 'Failed to launch FiftyOne');
      }
      
      const data = await response.json();
      
      toast({
        title: "FiftyOne Launched",
        description: data.message || "FiftyOne is starting. Check http://localhost:5151"
      });
      
      // Open FiftyOne in new tab after a short delay
      setTimeout(() => {
        window.open('http://localhost:5151', '_blank');
      }, 2000);
      
    } catch (err) {
      console.error('Error launching FiftyOne:', err);
      toast({
        title: "Launch Failed",
        description: err instanceof Error ? err.message : "Failed to launch FiftyOne",
        variant: "destructive"
      });
    } finally {
      setLaunchingFiftyOne(false);
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-background">
          <DialogTitle className="sr-only">Loading evaluation details</DialogTitle>
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (error || !task) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl bg-background">
          <DialogTitle className="sr-only">Evaluation error</DialogTitle>
          <div className="text-center p-8 text-red-500">
            {error || 'Evaluation not found'}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const metadata = task.task_metadata || {};
  const results = mergedResults;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-background">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                <Brain className="w-6 h-6 text-blue-500" />
                {task.name}
              </DialogTitle>
              <div className="text-sm text-muted-foreground mt-2">
                Task #{task.id} • Started {new Date(task.created_at).toLocaleString()}
                {task.completed_at && ` • Completed in ${formatDuration(task.created_at, task.completed_at)}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(task.status)}
              {task.status === 'completed' && results && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={viewInFiftyOne}
                    disabled={launchingFiftyOne}
                    className="ml-2"
                  >
                    {launchingFiftyOne ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current mr-2" />
                        Launching...
                      </>
                    ) : (
                      <>
                        <Eye className="w-4 h-4 mr-2" />
                        View in FiftyOne
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadCocoResults()}
                    disabled={downloading}
                  >
                    {downloading ? (
                      <>
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current mr-2" />
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-2" />
                        Download COCO
                      </>
                    )}
                  </Button>
                </>
              )}
              {/* Download All for multi-dataset evaluations */}
              {metadata.is_multi_dataset && childTasks.some(ct => ct.status === 'completed') && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={downloadAllCocoResults}
                  disabled={downloadingAll}
                  className="ml-2"
                >
                  {downloadingAll ? (
                    <>
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current mr-2" />
                      Downloading...
                    </>
                  ) : (
                    <>
                      <Database className="w-4 h-4 mr-2" />
                      Download All COCO
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-6">
          {/* Multi-dataset indicator */}
          {metadata.is_multi_dataset && (
            <div className="bg-blue-950/50 border border-blue-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-400" />
                Multi-Dataset Evaluation
                <Badge variant="secondary">{childTasks.length} datasets</Badge>
              </h3>
              <p className="text-sm text-gray-400">
                This evaluation runs across multiple datasets. Click on each dataset below to see individual results.
              </p>
            </div>
          )}

          {/* Configuration Info */}
          <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              Configuration
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-400">Training Model:</span>
                <span className="ml-2 text-white font-medium">{metadata.training_task_name || '-'}</span>
              </div>
              <div>
                <span className="text-gray-400">Test Dataset:</span>
                <span className="ml-2 text-white font-medium">
                  {metadata.is_multi_dataset 
                    ? `${metadata.dataset_names?.join(', ') || 'Multiple'}` 
                    : metadata.dataset_name || '-'}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Checkpoint:</span>
                <span className="ml-2 text-white font-medium">{metadata.checkpoint || 'best'}</span>
              </div>
              <div>
                <span className="text-gray-400">Confidence Threshold:</span>
                <span className="ml-2 text-white font-medium">{metadata.conf_threshold || 0.25}</span>
              </div>
              <div>
                <span className="text-gray-400">IoU Threshold:</span>
                <span className="ml-2 text-white font-medium">{metadata.iou_threshold || 0.45}</span>
              </div>
              <div>
                <span className="text-gray-400">Ground Truth:</span>
                <span className="ml-2 text-white font-medium">
                  {metadata.has_ground_truth ? (
                    (metadata as any).annotation_file_name ? (
                      <span title={(metadata as any).annotation_file_name}>
                        Yes ({(metadata as any).annotation_file_name})
                      </span>
                    ) : 'Yes'
                  ) : 'No'}
                </span>
              </div>
              {metadata.use_grid && (
                <>
                  <div>
                    <span className="text-gray-400">Grid Inference:</span>
                    <span className="ml-2 text-white font-medium">Enabled</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Grid Tile Size:</span>
                    <span className="ml-2 text-white font-medium">{metadata.grid_size}px</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Grid Overlap:</span>
                    <span className="ml-2 text-white font-medium">{((metadata.grid_overlap || 0) * 100).toFixed(0)}%</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Error Message for Failed Evaluations */}
          {task.status === 'failed' && (
            <div className="bg-red-950/50 border border-red-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-red-400">
                <AlertCircle className="w-5 h-5" />
                Evaluation Failed
              </h3>
              <p className="text-sm text-red-300 font-mono whitespace-pre-wrap break-words">
                {task.error_message || 'An unknown error occurred during evaluation. Please check the backend logs for more details.'}
              </p>
            </div>
          )}

          {/* Results */}
          {results && task.status === 'completed' && (
            <>
              {evalBlobsLoading &&
                metadata.results?.artifacts?.blobs &&
                metadata.results.predictions === undefined && (
                  <div className="text-sm text-gray-400 py-2">
                    Loading interactive evaluation data…
                  </div>
                )}
              {evalBlobsError && (
                <div className="text-sm text-red-400 py-2 rounded border border-red-900/50 px-3 bg-red-950/30">
                  {evalBlobsError}
                </div>
              )}
              {/* Threshold Explorer — adjust conf/IoU and see live metrics */}
              {results.all_ground_truth &&
                results.predictions !== undefined &&
                (results.predictions.length > 0 || results.all_ground_truth.length > 0) && (
                <ThresholdExplorer
                  predictions={results.predictions}
                  groundTruth={results.all_ground_truth}
                  classNames={results.class_names}
                  imageIdToFilename={results.image_id_to_filename ?? {}}
                  projectId={results.project_id ?? 0}
                  datasetId={results.dataset_id ?? 0}
                  initialConf={results.conf_threshold ?? metadata.conf_threshold ?? 0.25}
                  initialIou={results.iou_threshold ?? metadata.iou_threshold ?? 0.45}
                  initialPerClassConf={results.per_class_conf}
                  taskId={taskId}
                  onSaved={refreshTaskMetadata}
                />
              )}
            </>
          )}

          {/* Child Tasks for Multi-Dataset Evaluations */}
          {metadata.is_multi_dataset && childTasks.length > 0 && (
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-blue-500" />
                Per-Dataset Results
              </h3>
              <div className="space-y-3">
                {childTasks.map((childTask) => {
                  const childMetadata = childTask.task_metadata || {};
                  const childResults = childMetadata.results;
                  const isExpanded = expandedChildId === childTask.id;
                  
                  return (
                    <div key={childTask.id} className="border border-gray-700 rounded-lg overflow-hidden">
                      {/* Child Task Header */}
                      <button
                        onClick={() => setExpandedChildId(isExpanded ? null : childTask.id)}
                        className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                          <span className="font-medium">{childMetadata.dataset_name || `Dataset ${childTask.id}`}</span>
                          {getStatusBadge(childTask.status)}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-gray-400">
                          {childTask.status === 'completed' && childResults && (
                            <>
                              <span>F1: {(childResults.f1_score * 100).toFixed(1)}%</span>
                              <span>{childResults.images_processed} images</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  downloadCocoResults(childTask.id);
                                }}
                                className="h-7 px-2"
                              >
                                <Download className="w-3 h-3 mr-1" />
                                COCO
                              </Button>
                            </>
                          )}
                          {childTask.status === 'running' && (
                            <span>{childTask.progress}%</span>
                          )}
                        </div>
                      </button>
                      
                      {/* Child Task Expanded Content */}
                      {isExpanded && childTask.status === 'completed' && childResults && (
                        <div className="p-4 border-t border-gray-700 bg-gray-900/50">
                          {/* Metrics Grid */}
                          <div className="grid grid-cols-5 gap-3 mb-4">
                            <div className="bg-gray-800/50 rounded p-3 text-center">
                              <div className="text-xs text-gray-400 mb-1">Precision</div>
                              <div className="text-lg font-bold text-white">
                                {(childResults.precision * 100).toFixed(1)}%
                              </div>
                            </div>
                            <div className="bg-gray-800/50 rounded p-3 text-center">
                              <div className="text-xs text-gray-400 mb-1">Recall</div>
                              <div className="text-lg font-bold text-white">
                                {(childResults.recall * 100).toFixed(1)}%
                              </div>
                            </div>
                            <div className="bg-gray-800/50 rounded p-3 text-center">
                              <div className="text-xs text-gray-400 mb-1">F1 Score</div>
                              <div className="text-lg font-bold text-white">
                                {(childResults.f1_score * 100).toFixed(1)}%
                              </div>
                            </div>
                            <div className="bg-gray-800/50 rounded p-3 text-center">
                              <div className="text-xs text-gray-400 mb-1">Predictions</div>
                              <div className="text-lg font-bold text-white">
                                {childResults.predictions_count}
                              </div>
                            </div>
                            <div className="bg-gray-800/50 rounded p-3 text-center">
                              <div className="text-xs text-gray-400 mb-1">Images</div>
                              <div className="text-lg font-bold text-white">
                                {childResults.images_processed}
                              </div>
                            </div>
                          </div>
                          
                          {/* Inference Time */}
                          <div className="text-sm text-gray-400">
                            <span>Inference Time: {childResults.inference_time_ms?.toFixed(0) || 0}ms</span>
                            <span className="ml-4">
                              Avg: {childResults.images_processed > 0 
                                ? (childResults.inference_time_ms / childResults.images_processed).toFixed(1) 
                                : 0}ms/image
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {/* Running Progress */}
                      {isExpanded && childTask.status === 'running' && (
                        <div className="p-4 border-t border-gray-700 bg-gray-900/50">
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <div className="w-full bg-gray-800 rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full transition-all"
                                  style={{ width: `${childTask.progress}%` }}
                                />
                              </div>
                            </div>
                            <span className="text-sm text-gray-400">{childTask.progress}%</span>
                          </div>
                        </div>
                      )}

                      {/* Failed Error Message */}
                      {isExpanded && childTask.status === 'failed' && (
                        <div className="p-4 border-t border-gray-700 bg-red-950/30">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-red-300 font-mono whitespace-pre-wrap break-words">
                              {childTask.error_message || 'An unknown error occurred during evaluation.'}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Progress for running tasks */}
          {task.status === 'running' && (
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Progress</span>
                <span className="text-sm text-gray-400">{task.progress}%</span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
