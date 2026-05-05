import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, TrendingUp, Activity, Zap, Target, Gauge, Settings, ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { useApi } from "@/hooks/use-api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface TrainingDetailsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
}

interface TrainingMetrics {
  epoch: number;
  box_loss?: number;
  cls_loss?: number;
  dfl_loss?: number;
  seg_loss?: number;
  precision?: number;
  recall?: number;
  mAP50?: number;
  mAP50_95?: number;
  lr0?: number;
  lr1?: number;
  lr2?: number;
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
    current_epoch?: number;
    epochs?: number;
    latest_metrics?: TrainingMetrics;
    metrics_history?: TrainingMetrics[];
    training_params?: any;
    model_config?: any;
    stage?: string;
    best_model?: string;
    results_dir?: string;
    class_names?: string[];
    image_counts?: { train: number; val: number; test: number };
    dataset_count?: number;
    dataset_ids?: number[];
    dataset_configs?: Array<{
      dataset_id: number;
      dataset_name?: string;
      annotation_file_id: string;
      annotation_file_name?: string;
      image_collection?: string;
      split?: { train: number; val: number; test: number };
    }>;
  };
}

export function TrainingDetailsModal({ open, onOpenChange, taskId }: TrainingDetailsModalProps) {
  const { api } = useApi();
  const [task, setTask] = useState<TaskDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSettings, setShowAllSettings] = useState(false);
  const [showStatusReason, setShowStatusReason] = useState(false);

  useEffect(() => {
    if (open && taskId) {
      fetchTaskDetails();
    }
  }, [open, taskId, api]);

  useEffect(() => {
    if (!open) {
      setShowStatusReason(false);
    }
  }, [open, taskId]);

  useEffect(() => {
    if (!open || !taskId) return;
    
    // Poll for updates if task is running
    const interval = setInterval(() => {
      if (task?.status === 'running') {
        fetchTaskDetails();
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [open, taskId, task?.status]);

  const fetchTaskDetails = async () => {
    if (!api) {
      setLoading(false);
      setError('API not available');
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`http://localhost:9999/tasks/${taskId}`);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch task details: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('Task metadata structure:', data.task_metadata);
      console.log('Training params:', data.task_metadata?.training_params);
      setTask(data);
    } catch (err) {
      console.error('Error fetching task details:', err);
      setError(err instanceof Error ? err.message : 'Failed to load training details');
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
    const variants: Record<string, { className: string; label: string }> = {
      running: { className: 'bg-primary/15 text-primary border-primary/30', label: 'Running' },
      completed: { className: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30', label: 'Completed' },
      failed: { className: 'bg-destructive/15 text-destructive border-destructive/30', label: 'Failed' },
      pending: { className: 'bg-muted text-muted-foreground border-border', label: 'Pending' },
    };
    const variant = variants[status] || variants.pending;
    return <Badge className={`${variant.className} border`}>{variant.label}</Badge>;
  };

  const renderMetricCard = (title: string, value: number | string | undefined, icon: React.ReactNode, format?: 'percent' | 'decimal') => {
    if (value === undefined) return null;
    
    const formattedValue = format === 'percent' 
      ? `${(typeof value === 'number' ? value * 100 : 0).toFixed(2)}%`
      : format === 'decimal'
      ? typeof value === 'number' ? value.toFixed(4) : value
      : value;

    return (
      <div className="bg-muted/30 border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-primary">{icon}</div>
          <span className="text-sm text-muted-foreground">{title}</span>
        </div>
        <div className="text-2xl font-semibold text-foreground">{formattedValue}</div>
      </div>
    );
  };

  const metadata = task?.task_metadata;
  const latestMetrics = metadata?.latest_metrics;
  const metricsHistory = metadata?.metrics_history || [];
  const statusReason =
    task?.error_message
    || (metadata as any)?.error
    || (metadata as any)?.failure_reason
    || (metadata as any)?.failureReason
    || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Brain className="w-6 h-6 text-primary" />
              Training Details - Task #{taskId}
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAllSettings(!showAllSettings)}
              className="flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              {showAllSettings ? 'Hide' : 'Show'} All Settings
              {showAllSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </DialogHeader>

        {loading && !task ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          </div>
        ) : error ? (
          <div className="text-center py-12 text-destructive">{error}</div>
        ) : task ? (
          <div className="space-y-6">
            {/* Status Overview */}
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Status</div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(task.status)}
                    {(task.status === 'failed' || task.status === 'stopped') && statusReason && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setShowStatusReason(prev => !prev)}
                      >
                        {showStatusReason ? 'Hide why' : 'Why?'}
                      </Button>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Progress</div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-muted rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          task.status === 'failed' ? 'bg-destructive' : task.status === 'completed' ? 'bg-emerald-500' : 'bg-primary'
                        }`}
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-foreground">{task.progress}%</span>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Epoch</div>
                  <div className="text-lg font-medium text-foreground">
                    {metadata?.current_epoch || 0} / {metadata?.epochs || metadata?.training_params?.epochs || '-'}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Duration</div>
                  <div className="text-lg font-medium text-foreground">
                    {formatDuration(task.created_at, task.completed_at)}
                  </div>
                </div>
              </div>
              {(task.status === 'failed' || task.status === 'stopped') && showStatusReason && (
                <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                  <div className="mb-1 text-xs uppercase tracking-wide text-destructive">Failure reason</div>
                  <div className="whitespace-pre-wrap text-sm text-destructive-foreground">
                    {statusReason || 'No detailed error message was provided by the backend.'}
                  </div>
                </div>
              )}
            </div>

            {/* Training Configuration */}
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                Training Configuration
              </h3>
              
              {!showAllSettings ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Model:</span>
                      <span className="ml-2 text-foreground font-medium">
                        {metadata?.model_config?.model || metadata?.training_params?.model || (metadata as any)?.model_type || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Epochs:</span>
                      <span className="ml-2 text-foreground font-medium">
                        {metadata?.training_params?.epochs || metadata?.epochs || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Batch Size:</span>
                      <span className="ml-2 text-foreground font-medium">
                        {metadata?.training_params?.batch_size || (metadata as any)?.batch_size || metadata?.training_params?.batch || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Image Size:</span>
                      <span className="ml-2 text-foreground font-medium">
                        {metadata?.training_params?.image_size || metadata?.training_params?.imgsz || (metadata as any)?.image_size || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Optimizer:</span>
                      <span className="ml-2 text-foreground font-medium">
                        {metadata?.training_params?.optimizer || 'auto'}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Learning Rate:</span>
                      <span className="ml-2 text-foreground font-medium">
                        {metadata?.training_params?.lr0 || 0.01}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Patience:</span>
                      <span className="ml-2 text-foreground font-medium">
                        {metadata?.training_params?.patience || 50}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Device:</span>
                      <span className="ml-2 text-foreground font-medium">
                        {metadata?.training_params?.device || '0'}
                      </span>
                    </div>
                  </div>
                  
                  {/* Augmentations Summary */}
                  {metadata?.model_config?.augmentations && Object.keys(metadata.model_config.augmentations).length > 0 && (
                    <div className="border-t border-border pt-3">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Augmentations:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {(() => {
                            const augs = metadata.model_config.augmentations;
                            const enabledAugs: string[] = [];
                            if (augs.enable_color) enabledAugs.push('Color');
                            if (augs.enable_geometric) enabledAugs.push('Geometric');
                            if (augs.enable_advanced) enabledAugs.push('Advanced');
                            if (augs.mosaic) enabledAugs.push('Mosaic');
                            if (augs.mixup) enabledAugs.push('MixUp');
                            if (augs.fliplr) enabledAugs.push('Flip LR');
                            if (augs.flipud) enabledAugs.push('Flip UD');
                            return enabledAugs.length > 0 ? enabledAugs.join(', ') : 'Default';
                          })()}
                        </span>
                      </div>
                    </div>
                  )}
                  
                  {metadata?.class_names && (
                    <div className="border-t border-border pt-3">
                      <div className="text-sm">
                        <span className="text-muted-foreground">Classes ({metadata.class_names.length}):</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata.class_names.join(', ')}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Basic Training Parameters */}
                  <div>
                    <h4 className="text-sm font-semibold text-foreground/80 mb-3 uppercase tracking-wide">Basic Parameters</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Model:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.model_config?.model || metadata?.training_params?.model || '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Epochs:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.epochs || metadata?.epochs || '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Batch Size:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.batch_size || (metadata as any)?.batch_size || metadata?.training_params?.batch || '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Image Size:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.image_size || metadata?.training_params?.imgsz || (metadata as any)?.image_size || '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Device:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.device || '0'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Workers:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.workers || 8}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Save Period:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.save_period ?? metadata?.model_config?.save_period ?? '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Patience:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.patience || 100}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cache:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {String(metadata?.training_params?.cache || false)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Optimizer Settings */}
                  <div>
                    <h4 className="text-sm font-semibold text-foreground/80 mb-3 uppercase tracking-wide">Optimizer Settings</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Optimizer:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.optimizer || 'auto'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Learning Rate (lr0):</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.lr0 || 0.01}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Final LR (lrf):</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.lrf || 0.01}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Momentum:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.momentum || 0.937}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Weight Decay:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.weight_decay || 0.0005}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Warmup Epochs:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.warmup_epochs || 3}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Warmup Momentum:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.warmup_momentum || 0.8}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Warmup Bias LR:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.warmup_bias_lr || 0.1}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Augmentation Settings */}
                  {metadata?.model_config?.augmentations && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground/80 mb-3 uppercase tracking-wide">Data Augmentation</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        {Object.entries(metadata.model_config.augmentations).map(([key, value]) => (
                          <div key={key}>
                            <span className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}:</span>
                            <span className="ml-2 text-foreground font-medium">
                              {typeof value === 'boolean' ? String(value) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Loss & Advanced Settings */}
                  <div>
                    <h4 className="text-sm font-semibold text-foreground/80 mb-3 uppercase tracking-wide">Loss & Advanced</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Box Loss Gain:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.box || 7.5}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Cls Loss Gain:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.cls || 0.5}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">DFL Loss Gain:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.dfl || 1.5}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Label Smoothing:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.label_smoothing || 0.0}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Dropout:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {metadata?.training_params?.dropout || 0.0}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Val:</span>
                        <span className="ml-2 text-foreground font-medium">
                          {String(metadata?.training_params?.val ?? true)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Classes */}
                  {metadata?.class_names && (
                    <div>
                      <h4 className="text-sm font-semibold text-foreground/80 mb-3 uppercase tracking-wide">Classes</h4>
                      <div className="flex flex-wrap gap-2">
                        {metadata.class_names.map((className, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">
                            {className}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Datasets & Annotations */}
            {metadata?.dataset_configs && metadata.dataset_configs.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3">Training Datasets</h3>
                <div className="space-y-3">
                  {metadata.dataset_configs.map((config, idx) => (
                    <div key={idx} className="bg-muted/30 border border-border rounded-lg p-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Dataset ID:</span>
                          <span className="ml-2 text-foreground font-medium">#{config.dataset_id}</span>
                          {config.dataset_name && (
                            <span className="ml-1 text-foreground/80">({config.dataset_name})</span>
                          )}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Annotation File:</span>
                          <span className="ml-2 text-primary font-mono text-xs">
                            {config.annotation_file_name || config.annotation_file_id}
                          </span>
                        </div>
                        {config.image_collection && (
                          <div>
                            <span className="text-muted-foreground">Image Collection:</span>
                            <span className="ml-2 text-foreground font-medium">{config.image_collection}</span>
                          </div>
                        )}
                        {config.split && (
                          <div>
                            <span className="text-muted-foreground">Split:</span>
                            <span className="ml-2 text-foreground font-medium">
                              Train: {config.split.train}% / Val: {config.split.val}% / Test: {config.split.test}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Dataset Info */}
            {metadata?.image_counts && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3">Dataset Split</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-semibold text-foreground tabular-nums">{metadata.image_counts.train}</div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Train</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-semibold text-foreground tabular-nums">{metadata.image_counts.val}</div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Validation</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-semibold text-foreground tabular-nums">{metadata.image_counts.test || 0}</div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mt-1">Test</div>
                  </div>
                </div>
              </div>
            )}

            {/* Latest Metrics */}
            {latestMetrics && (
              <>
                <div>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-green-500" />
                    Latest Metrics (Epoch {latestMetrics.epoch})
                  </h3>
                  
                  {/* Losses */}
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Training Losses</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {renderMetricCard('Box Loss', latestMetrics.box_loss, <Target className="w-4 h-4" />, 'decimal')}
                      {renderMetricCard('Class Loss', latestMetrics.cls_loss, <Activity className="w-4 h-4" />, 'decimal')}
                      {renderMetricCard('DFL Loss', latestMetrics.dfl_loss, <Zap className="w-4 h-4" />, 'decimal')}
                      {latestMetrics.seg_loss && renderMetricCard('Seg Loss', latestMetrics.seg_loss, <Brain className="w-4 h-4" />, 'decimal')}
                    </div>
                  </div>

                  {/* Performance Metrics */}
                  <div className="mb-4">
                    <h4 className="text-sm font-medium text-muted-foreground mb-2">Performance Metrics</h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {renderMetricCard('Precision', latestMetrics.precision, <Target className="w-4 h-4" />, 'percent')}
                      {renderMetricCard('Recall', latestMetrics.recall, <Activity className="w-4 h-4" />, 'percent')}
                      {renderMetricCard('mAP@50', latestMetrics.mAP50, <TrendingUp className="w-4 h-4" />, 'percent')}
                      {renderMetricCard('mAP@50-95', latestMetrics.mAP50_95, <TrendingUp className="w-4 h-4" />, 'percent')}
                    </div>
                  </div>

                  {/* Learning Rates */}
                  {(latestMetrics.lr0 || latestMetrics.lr1 || latestMetrics.lr2) && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">Learning Rates</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {latestMetrics.lr0 && renderMetricCard('LR (pg0)', latestMetrics.lr0, <Gauge className="w-4 h-4" />, 'decimal')}
                        {latestMetrics.lr1 && renderMetricCard('LR (pg1)', latestMetrics.lr1, <Gauge className="w-4 h-4" />, 'decimal')}
                        {latestMetrics.lr2 && renderMetricCard('LR (pg2)', latestMetrics.lr2, <Gauge className="w-4 h-4" />, 'decimal')}
                      </div>
                    </div>
                  )}
                </div>

                {/* Metrics History Charts */}
                {metricsHistory.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold mb-3">Training Progress</h3>
                    <div className="space-y-6">
                      {/* Training Losses Chart */}
                      <div className="bg-card border border-border rounded-lg p-4">
                        <h4 className="text-sm font-medium text-muted-foreground mb-4">Training Losses</h4>
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={[...metricsHistory]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis 
                              dataKey="epoch" 
                              stroke="#9CA3AF"
                              tick={{ fill: '#9CA3AF', fontSize: 12 }}
                              label={{ value: 'Epoch', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                              domain={[0, 'dataMax']}
                            />
                            <YAxis 
                              stroke="#9CA3AF"
                              tick={{ fill: '#9CA3AF', fontSize: 12 }}
                              domain={[0, 'auto']}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px' }}
                              labelStyle={{ color: '#F3F4F6' }}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line type="monotone" dataKey="box_loss" stroke="#EF4444" name="Box Loss" strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey="cls_loss" stroke="#F59E0B" name="Class Loss" strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey="dfl_loss" stroke="#10B981" name="DFL Loss" strokeWidth={2} dot={{ r: 3 }} />
                            {metricsHistory.some(m => m.seg_loss) && (
                              <Line type="monotone" dataKey="seg_loss" stroke="#8B5CF6" name="Seg Loss" strokeWidth={2} dot={{ r: 3 }} />
                            )}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* mAP Metrics Chart */}
                      <div className="bg-card border border-border rounded-lg p-4">
                        <h4 className="text-sm font-medium text-muted-foreground mb-4">mAP Metrics</h4>
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={[...metricsHistory]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis 
                              dataKey="epoch" 
                              stroke="#9CA3AF"
                              tick={{ fill: '#9CA3AF', fontSize: 12 }}
                              label={{ value: 'Epoch', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                              domain={[0, 'dataMax']}
                            />
                            <YAxis 
                              stroke="#9CA3AF"
                              tick={{ fill: '#9CA3AF', fontSize: 12 }}
                              domain={[0, 1]}
                              tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px' }}
                              labelStyle={{ color: '#F3F4F6' }}
                              formatter={(value: any) => `${(value * 100).toFixed(2)}%`}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line type="monotone" dataKey="mAP50" stroke="#10B981" name="mAP@50" strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey="mAP50_95" stroke="#3B82F6" name="mAP@50-95" strokeWidth={2} dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Precision & Recall Chart */}
                      <div className="bg-card border border-border rounded-lg p-4">
                        <h4 className="text-sm font-medium text-muted-foreground mb-4">Precision & Recall</h4>
                        <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={[...metricsHistory]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                            <XAxis 
                              dataKey="epoch" 
                              stroke="#9CA3AF"
                              tick={{ fill: '#9CA3AF', fontSize: 12 }}
                              label={{ value: 'Epoch', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                              domain={[0, 'dataMax']}
                            />
                            <YAxis 
                              stroke="#9CA3AF"
                              tick={{ fill: '#9CA3AF', fontSize: 12 }}
                              domain={[0, 1]}
                              tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                            />
                            <Tooltip 
                              contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px' }}
                              labelStyle={{ color: '#F3F4F6' }}
                              formatter={(value: any) => `${(value * 100).toFixed(2)}%`}
                            />
                            <Legend wrapperStyle={{ fontSize: '12px' }} />
                            <Line type="monotone" dataKey="precision" stroke="#8B5CF6" name="Precision" strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey="recall" stroke="#EC4899" name="Recall" strokeWidth={2} dot={{ r: 3 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Learning Rates Chart */}
                      {metricsHistory.some(m => m.lr0 || m.lr1 || m.lr2) && (
                        <div className="bg-card border border-border rounded-lg p-4">
                          <h4 className="text-sm font-medium text-muted-foreground mb-4">Learning Rates</h4>
                          <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={[...metricsHistory]}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                              <XAxis 
                                dataKey="epoch" 
                                stroke="#9CA3AF"
                                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                                label={{ value: 'Epoch', position: 'insideBottom', offset: -5, fill: '#9CA3AF' }}
                                domain={[0, 'dataMax']}
                              />
                              <YAxis 
                                stroke="#9CA3AF"
                                tick={{ fill: '#9CA3AF', fontSize: 12 }}
                                tickFormatter={(value) => value.toExponential(1)}
                              />
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: '6px' }}
                                labelStyle={{ color: '#F3F4F6' }}
                                formatter={(value: any) => value.toFixed(6)}
                              />
                              <Legend wrapperStyle={{ fontSize: '12px' }} />
                              {metricsHistory.some(m => m.lr0) && (
                                <Line type="monotone" dataKey="lr0" stroke="#3B82F6" name="LR (pg0)" strokeWidth={2} dot={{ r: 3 }} />
                              )}
                              {metricsHistory.some(m => m.lr1) && (
                                <Line type="monotone" dataKey="lr1" stroke="#10B981" name="LR (pg1)" strokeWidth={2} dot={{ r: 3 }} />
                              )}
                              {metricsHistory.some(m => m.lr2) && (
                                <Line type="monotone" dataKey="lr2" stroke="#F59E0B" name="LR (pg2)" strokeWidth={2} dot={{ r: 3 }} />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Output Paths */}
            {(metadata?.best_model || metadata?.results_dir) && (
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3">Output Files</h3>
                <div className="space-y-2 text-sm">
                  {metadata.best_model && (
                    <div>
                      <span className="text-muted-foreground">Best Model:</span>
                      <code className="ml-2 text-primary bg-muted/30 px-2 py-1 rounded text-xs">
                        {metadata.best_model}
                      </code>
                    </div>
                  )}
                  {metadata.results_dir && (
                    <div>
                      <span className="text-muted-foreground">Results Directory:</span>
                      <code className="ml-2 text-primary bg-muted/30 px-2 py-1 rounded text-xs">
                        {metadata.results_dir}
                      </code>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
