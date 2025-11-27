import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, TrendingUp, Activity, Target, Gauge, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface EvaluationDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
}

interface TaskDetails {
  id: number;
  name: string;
  status: string;
  progress: number;
  created_at: string;
  completed_at?: string;
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
    results?: {
      precision: number;
      recall: number;
      f1_score: number;
      map50: number;
      map50_95: number;
      confusion_matrix: number[][];
      class_names: string[];
      predictions_count: number;
      images_processed: number;
      inference_time_ms: number;
    };
  };
}

export function EvaluationDetailsModal({ open, onOpenChange, taskId }: EvaluationDetailsModalProps) {
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open && taskId) {
      fetchTaskDetails();
      // Poll for updates if task is running
      const interval = setInterval(() => {
        if (task?.status === 'running') {
          fetchTaskDetails();
        }
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [open, taskId, task?.status]);

  const fetchTaskDetails = async () => {
    try {
      setLoading(true);
      const response = await fetch(`http://localhost:9999/tasks/${taskId}`);
      const data = await response.json();
      console.log('Evaluation task details:', data);
      setTask(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching evaluation details:', err);
      setError('Failed to load evaluation details');
    } finally {
      setLoading(false);
    }
  };

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

  const downloadCocoResults = async () => {
    if (!task || task.status !== 'completed') return;
    
    setDownloading(true);
    try {
      const response = await fetch(`http://localhost:9999/predictions/export-coco/${taskId}`);
      
      if (!response.ok) {
        throw new Error('Failed to download results');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evaluation_${taskId}_coco.json`;
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

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto bg-background">
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
          <div className="text-center p-8 text-red-500">
            {error || 'Evaluation not found'}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const metadata = task.task_metadata || {};
  const results = metadata.results;

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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadCocoResults}
                  disabled={downloading}
                  className="ml-2"
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
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-6">
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
                <span className="ml-2 text-white font-medium">{metadata.dataset_name || '-'}</span>
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
                    metadata.annotation_file_name ? (
                      <span title={metadata.annotation_file_name}>
                        Yes ({metadata.annotation_file_name})
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

          {/* Results */}
          {results && task.status === 'completed' && (
            <>
              {/* Metrics Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Target className="w-4 h-4 text-green-500" />
                    <span className="text-sm text-gray-400">Precision</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {(results.precision * 100).toFixed(1)}%
                  </div>
                </div>

                <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                    <span className="text-sm text-gray-400">Recall</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {(results.recall * 100).toFixed(1)}%
                  </div>
                </div>

                <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Gauge className="w-4 h-4 text-purple-500" />
                    <span className="text-sm text-gray-400">F1 Score</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {(results.f1_score * 100).toFixed(1)}%
                  </div>
                </div>

                <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Activity className="w-4 h-4 text-orange-500" />
                    <span className="text-sm text-gray-400">Predictions</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {results.predictions_count}
                  </div>
                </div>

                <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Brain className="w-4 h-4 text-cyan-500" />
                    <span className="text-sm text-gray-400">Images</span>
                  </div>
                  <div className="text-2xl font-bold text-white">
                    {results.images_processed}
                  </div>
                </div>
              </div>

              {/* Inference Time */}
              <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                <h3 className="text-sm font-semibold mb-2 text-gray-400">Performance</h3>
                <div className="text-sm">
                  <span className="text-gray-400">Total Inference Time:</span>
                  <span className="ml-2 text-white font-medium">
                    {results.inference_time_ms.toFixed(0)}ms
                  </span>
                  <span className="ml-4 text-gray-400">Avg per image:</span>
                  <span className="ml-2 text-white font-medium">
                    {(results.inference_time_ms / results.images_processed).toFixed(1)}ms
                  </span>
                </div>
              </div>

              {/* Confusion Matrix (if available and has ground truth) */}
              {metadata.has_ground_truth && results.confusion_matrix && results.class_names && (
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                  <h3 className="text-lg font-semibold mb-3">Confusion Matrix</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr>
                          <th className="px-2 py-1 text-left text-gray-400">Actual \ Predicted</th>
                          {results.class_names.map((name, idx) => (
                            <th key={idx} className="px-2 py-1 text-center text-gray-400">{name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {results.confusion_matrix.map((row, i) => (
                          <tr key={i} className="border-t border-gray-800">
                            <td className="px-2 py-1 text-gray-400 font-medium">{results.class_names[i]}</td>
                            {row.map((val, j) => (
                              <td key={j} className={`px-2 py-1 text-center ${val > 0 ? (i === j ? 'text-green-400 font-bold' : 'text-red-400') : 'text-gray-600'}`}>
                                {val}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
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
