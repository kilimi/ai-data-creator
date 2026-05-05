import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, Activity, Download, Eye, ChevronDown, Database, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
      has_ground_truth?: boolean;
      avg_confidence?: number;
      predictions_per_image?: number;
      class_prediction_counts?: Record<string, number>;
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

type PredWithBBox = RawPrediction & { bbox?: number[] };

function getPredictionBboxXyxy(pred: PredWithBBox): [number, number, number, number] | null {
  const xyxy = pred.bbox_xyxy;
  if (Array.isArray(xyxy) && xyxy.length >= 4) {
    return [Number(xyxy[0]), Number(xyxy[1]), Number(xyxy[2]), Number(xyxy[3])];
  }
  const bb = pred.bbox;
  if (Array.isArray(bb) && bb.length >= 4) {
    const x = Number(bb[0]);
    const y = Number(bb[1]);
    const w = Number(bb[2]);
    const h = Number(bb[3]);
    return [x, y, x + w, y + h];
  }
  return null;
}

/** Expand bbox by padFrac of box size for context; clamp to image bounds. */
function paddedCropRegion(
  [x1, y1, x2, y2]: [number, number, number, number],
  nw: number,
  nh: number,
  padFrac = 0.22
): { sx: number; sy: number; sw: number; sh: number } {
  const bw = Math.max(1e-6, x2 - x1);
  const bh = Math.max(1e-6, y2 - y1);
  const padX = bw * padFrac;
  const padY = bh * padFrac;
  let sx = x1 - padX;
  let sy = y1 - padY;
  let sw = bw + 2 * padX;
  let sh = bh + 2 * padY;
  if (sx < 0) {
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    sh += sy;
    sy = 0;
  }
  if (sx + sw > nw) sw = nw - sx;
  if (sy + sh > nh) sh = nh - sy;
  sw = Math.max(1, sw);
  sh = Math.max(1, sh);
  return { sx, sy, sw, sh };
}

/** Draw cropped region around bbox (natural pixels) scaled to cw×ch like object-contain, then bbox + label. */
function drawPredictionSnapshotCrop(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  bbox: [number, number, number, number],
  label: string,
  cw: number,
  ch: number
) {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh || !cw || !ch) return;

  const { sx, sy, sw, sh } = paddedCropRegion(bbox, nw, nh);
  const scale = Math.min(cw / sw, ch / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;

  const [x1, y1, x2, y2] = bbox;
  const mapX = (x: number) => ox + (x - sx) * scale;
  const mapY = (y: number) => oy + (y - sy) * scale;
  let px1 = mapX(x1);
  let py1 = mapY(y1);
  let px2 = mapX(x2);
  let py2 = mapY(y2);
  const rx1 = Math.min(px1, px2);
  const ry1 = Math.min(py1, py2);
  const rx2 = Math.max(px1, px2);
  const ry2 = Math.max(py1, py2);
  px1 = rx1;
  py1 = ry1;
  px2 = rx2;
  py2 = ry2;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  canvas.style.width = `${cw}px`;
  canvas.style.height = `${ch}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, ox, oy, dw, dh);

  const lineW = Math.max(2, Math.round(Math.min(cw, ch) / 90));
  ctx.strokeStyle = "#22c55e";
  ctx.lineWidth = lineW;
  ctx.strokeRect(px1, py1, px2 - px1, py2 - py1);

  const fontPx = Math.max(11, Math.round(Math.min(cw, ch) / 28));
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  const pad = 4;
  const textW = ctx.measureText(label).width;
  const labelH = fontPx + pad;
  let ly = py1 - labelH - 2;
  if (ly < oy + 2) ly = py1 + lineW + 2;
  ly = Math.max(oy + 2, Math.min(oy + dh - labelH - 2, ly));
  const lx = Math.max(ox + 2, Math.min(ox + dw - textW - pad * 2 - 2, px1));

  ctx.fillStyle = "rgba(34, 197, 94, 0.95)";
  ctx.fillRect(lx, ly, textW + pad * 2, labelH);
  ctx.fillStyle = "#0a0a0a";
  ctx.fillText(label, lx + pad, ly + fontPx - 1);
}

function PredictionSnapshotCard({
  imageUrls,
  fileName,
  className,
  conf,
  bbox,
}: {
  imageUrls: string[];
  fileName: string;
  className: string;
  conf: number;
  bbox: [number, number, number, number] | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const label = `${className} · ${(conf * 100).toFixed(1)}%`;
  const [srcIndex, setSrcIndex] = useState(0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const activeSrc = imageUrls[Math.min(srcIndex, Math.max(0, imageUrls.length - 1))] || "";

  useEffect(() => {
    setSrcIndex(0);
    setImageLoaded(false);
  }, [imageUrls, fileName]);

  const redraw = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    const box = containerRef.current;
    if (!img || !canvas || !box || !bbox || img.naturalWidth === 0) return;
    const cw = box.clientWidth;
    const ch = box.clientHeight;
    if (!cw || !ch) return;
    drawPredictionSnapshotCrop(canvas, img, bbox, label, cw, ch);
  }, [bbox, label]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const img = imgRef.current;
      if (img && img.naturalWidth > 0) redraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [redraw]);

  useEffect(() => {
    redraw();
  }, [activeSrc, bbox, redraw]);

  return (
    <div className="border border-border rounded overflow-hidden bg-muted/30">
      <div ref={containerRef} className="relative w-full h-44 bg-black">
        <img
          ref={imgRef}
          src={activeSrc}
          alt={fileName}
          className={`absolute inset-0 w-full h-full object-contain ${bbox && imageLoaded ? "opacity-0" : ""}`}
          loading="lazy"
          onLoad={() => {
            setImageLoaded(true);
            redraw();
          }}
          onError={() => {
            setImageLoaded(false);
            setSrcIndex((prev) => (prev + 1 < imageUrls.length ? prev + 1 : prev));
          }}
        />
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 pointer-events-none ${bbox ? "" : "hidden"}`}
          aria-hidden
        />
      </div>
      <div className="p-2 border-t border-border">
        <div className="text-xs text-foreground/80 truncate" title={fileName}>
          {fileName}
        </div>
        <div className="text-xs text-muted-foreground">
          {bbox ? `Crop around top detection · ${label}` : "Bounding box unavailable for crop"}
        </div>
      </div>
    </div>
  );
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

  const topPredictedClasses = useMemo(() => {
    if (!mergedResults?.class_prediction_counts) return [];
    return Object.entries(mergedResults.class_prediction_counts)
      .map(([className, count]) => ({ className, count: Number(count || 0) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [mergedResults]);

  const predictionSnapshots = useMemo(() => {
    if (!mergedResults?.predictions || !mergedResults?.image_id_to_filename) return [];
    const projectId = mergedResults.project_id;
    const datasetId = mergedResults.dataset_id;
    if (!projectId || !datasetId) return [];

    const bestByImage = new Map<number, RawPrediction>();
    for (const pred of mergedResults.predictions) {
      const existing = bestByImage.get(pred.image_id);
      if (!existing || pred.conf > existing.conf) {
        bestByImage.set(pred.image_id, pred);
      }
    }

    const encodeFilePath = (name: string) =>
      String(name || "")
        .replace(/\\/g, "/")
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");

    return Array.from(bestByImage.values())
      .sort((a, b) => b.conf - a.conf)
      .slice(0, 6)
      .map((pred) => {
        const fileName = mergedResults.image_id_to_filename?.[String(pred.image_id)] || "";
        const className = mergedResults.class_names?.[pred.class_id] || `Class ${pred.class_id}`;
        const encodedName = encodeFilePath(fileName);
        const imageUrls = [
          `http://localhost:9999/predictions/evaluation-image/${taskId}/${pred.image_id}`,
          `http://localhost:9999/static/projects/${projectId}/${datasetId}/images/${encodedName}`,
          `http://localhost:9999/static/data/images/${datasetId}/${encodedName}`,
        ];
        const bbox = getPredictionBboxXyxy(pred as PredWithBBox);
        return {
          imageId: pred.image_id,
          fileName,
          className,
          conf: pred.conf,
          imageUrls,
          bbox,
        };
      })
      .filter((item) => !!item.fileName);
  }, [mergedResults]);

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
      running: { color: 'bg-blue-500/20 text-primary border-blue-500/30', label: 'Running' },
      completed: { color: 'bg-green-500/20 text-green-400 border-green-500/30', label: 'Completed' },
      failed: { color: 'bg-red-500/20 text-destructive border-red-500/30', label: 'Failed' },
      pending: { color: 'bg-gray-500/20 text-muted-foreground border-gray-500/30', label: 'Pending' },
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
    const isChild = !!taskIdToDownload;
    const sourceTask = isChild
      ? childTasks.find((ct) => ct.id === downloadTaskId)
      : task;
    const predCount = sourceTask?.task_metadata?.results?.predictions_count || 0;
    if (predCount <= 0) {
      toast({
        title: "No Predictions",
        description: "There are no predictions for this evaluation, so COCO download is unavailable.",
        variant: "destructive"
      });
      return;
    }
    
    setDownloading(true);
    try {
      const response = await fetch(`http://localhost:9999/predictions/export-coco/${downloadTaskId}`);
      
      if (!response.ok) {
        let message = 'Failed to download results';
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
        description: err instanceof Error ? err.message : "Failed to download evaluation results",
        variant: "destructive"
      });
    } finally {
      setDownloading(false);
    }
  };

  const downloadAllCocoResults = async () => {
    if (!task?.task_metadata?.is_multi_dataset) return;
    const totalPredictions = childTasks.reduce(
      (sum, ct) => sum + (ct.task_metadata?.results?.predictions_count || 0),
      0
    );
    if (totalPredictions <= 0) {
      toast({
        title: "No Predictions",
        description: "No child evaluations contain predictions yet, so ZIP export is unavailable.",
        variant: "destructive"
      });
      return;
    }
    
    setDownloadingAll(true);
    try {
      const response = await fetch(`http://localhost:9999/predictions/export-coco-all/${taskId}`);
      
      if (!response.ok) {
        let message = 'Failed to download results';
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
        description: err instanceof Error ? err.message : "Failed to download evaluation results",
        variant: "destructive"
      });
    } finally {
      setDownloadingAll(false);
    }
  };

  const viewInFiftyOne = async () => {
    if (!task || task.status !== 'completed') return;
    const predCount = task.task_metadata?.results?.predictions_count || 0;
    if (predCount <= 0) {
      toast({
        title: "No Predictions",
        description: "There are no predictions for this evaluation, so FiftyOne cannot be opened.",
        variant: "destructive"
      });
      return;
    }
    
    setLaunchingFiftyOne(true);
    toast({
      title: "Starting FiftyOne",
      description: "Please wait 10-60 seconds while FiftyOne initializes. Keep this page open.",
    });
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
          <div className="text-center p-8 text-destructive">
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
              <DialogTitle className="text-xl font-semibold flex items-center gap-2">
                <Brain className="w-6 h-6 text-primary" />
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
                <Database className="w-5 h-5 text-primary" />
                Multi-Dataset Evaluation
                <Badge variant="secondary">{childTasks.length} datasets</Badge>
              </h3>
              <p className="text-sm text-muted-foreground">
                This evaluation runs across multiple datasets. Click on each dataset below to see individual results.
              </p>
            </div>
          )}

          {/* Configuration Info */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Configuration
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Training Model:</span>
                <span className="ml-2 text-foreground font-medium">{metadata.training_task_name || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Test Dataset:</span>
                <span className="ml-2 text-foreground font-medium">
                  {metadata.is_multi_dataset 
                    ? `${metadata.dataset_names?.join(', ') || 'Multiple'}` 
                    : metadata.dataset_name || '-'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Checkpoint:</span>
                <span className="ml-2 text-foreground font-medium">{metadata.checkpoint || 'best'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Confidence Threshold:</span>
                <span className="ml-2 text-foreground font-medium">{metadata.conf_threshold || 0.25}</span>
              </div>
              <div>
                <span className="text-muted-foreground">IoU Threshold:</span>
                <span className="ml-2 text-foreground font-medium">{metadata.iou_threshold || 0.45}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Ground Truth:</span>
                <span className="ml-2 text-foreground font-medium">
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
                    <span className="text-muted-foreground">Grid Inference:</span>
                    <span className="ml-2 text-foreground font-medium">Enabled</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Grid Tile Size:</span>
                    <span className="ml-2 text-foreground font-medium">{metadata.grid_size}px</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Grid Overlap:</span>
                    <span className="ml-2 text-foreground font-medium">{((metadata.grid_overlap || 0) * 100).toFixed(0)}%</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Error Message for Failed Evaluations */}
          {task.status === 'failed' && (
            <div className="border border-destructive/40 bg-destructive/10 rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-2 flex items-center gap-2 text-destructive">
                <AlertCircle className="w-5 h-5" />
                Evaluation Failed
              </h3>
              <p className="text-sm text-destructive font-mono whitespace-pre-wrap break-words">
                {task.error_message || 'An unknown error occurred during evaluation. Please check the backend logs for more details.'}
              </p>
            </div>
          )}

          {/* Results */}
          {results && task.status === 'completed' && (
            <>
              {launchingFiftyOne && (
                <div className="rounded border border-blue-900/60 bg-blue-950/30 px-3 py-2 text-sm text-blue-200">
                  FiftyOne is starting. Please wait; first launch may take up to a minute.
                </div>
              )}
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-primary" />
                  Evaluation Statistics
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="bg-muted/30/60 border border-border rounded p-3">
                    <div className="text-xs text-muted-foreground">Images</div>
                    <div className="text-lg font-semibold text-foreground">{results.images_processed ?? 0}</div>
                  </div>
                  <div className="bg-muted/30/60 border border-border rounded p-3">
                    <div className="text-xs text-muted-foreground">Predictions</div>
                    <div className="text-lg font-semibold text-foreground">{results.predictions_count ?? 0}</div>
                  </div>
                  <div className="bg-muted/30/60 border border-border rounded p-3">
                    <div className="text-xs text-muted-foreground">Predictions / Image</div>
                    <div className="text-lg font-semibold text-foreground">
                      {Number(results.predictions_per_image ?? 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-muted/30/60 border border-border rounded p-3">
                    <div className="text-xs text-muted-foreground">Avg Confidence</div>
                    <div className="text-lg font-semibold text-foreground">
                      {`${(Number(results.avg_confidence ?? 0) * 100).toFixed(1)}%`}
                    </div>
                  </div>
                  <div className="bg-muted/30/60 border border-border rounded p-3">
                    <div className="text-xs text-muted-foreground">Precision</div>
                    <div className="text-lg font-semibold text-foreground">
                      {results.has_ground_truth ? `${(results.precision * 100).toFixed(1)}%` : 'N/A'}
                    </div>
                  </div>
                  <div className="bg-muted/30/60 border border-border rounded p-3">
                    <div className="text-xs text-muted-foreground">F1 Score</div>
                    <div className="text-lg font-semibold text-foreground">
                      {results.has_ground_truth ? `${(results.f1_score * 100).toFixed(1)}%` : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3">Top Predicted Classes</h3>
                {topPredictedClasses.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    {topPredictedClasses.map((item) => (
                      <div
                        key={item.className}
                        className="bg-muted/30/60 border border-border rounded p-3"
                      >
                        <div className="text-sm text-foreground truncate" title={item.className}>
                          {item.className}
                        </div>
                        <div className="text-lg font-semibold text-foreground">{item.count}</div>
                        <div className="text-xs text-muted-foreground">predictions</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No predictions available yet.</div>
                )}
              </div>
              <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3">Prediction Snapshot Examples</h3>
                {predictionSnapshots.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {predictionSnapshots.map((snap) => (
                      <PredictionSnapshotCard
                        key={snap.imageId}
                        imageUrls={snap.imageUrls}
                        fileName={snap.fileName}
                        className={snap.className}
                        conf={snap.conf}
                        bbox={snap.bbox}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Snapshot examples become available after prediction blobs are loaded.
                  </div>
                )}
              </div>
              {evalBlobsLoading &&
                metadata.results?.artifacts?.blobs &&
                metadata.results.predictions === undefined && (
                  <div className="text-sm text-muted-foreground py-2">
                    Loading interactive evaluation data…
                  </div>
                )}
              {evalBlobsError && (
                <div className="text-sm text-destructive py-2 rounded border border-destructive/40 px-3 bg-destructive/10">
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
            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Database className="w-5 h-5 text-primary" />
                Per-Dataset Results
              </h3>
              <div className="space-y-3">
                {childTasks.map((childTask) => {
                  const childMetadata = childTask.task_metadata || {};
                  const childResults = childMetadata.results;
                  const isExpanded = expandedChildId === childTask.id;
                  
                  return (
                    <div key={childTask.id} className="border border-border rounded-lg overflow-hidden">
                      {/* Child Task Header */}
                      <button
                        onClick={() => setExpandedChildId(isExpanded ? null : childTask.id)}
                        className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                          <span className="font-medium">{childMetadata.dataset_name || `Dataset ${childTask.id}`}</span>
                          {getStatusBadge(childTask.status)}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          {childTask.status === 'completed' && childResults && (
                            <>
                              <span>
                                F1: {childResults.has_ground_truth ? `${(childResults.f1_score * 100).toFixed(1)}%` : 'N/A'}
                              </span>
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
                        <div className="p-4 border-t border-border bg-muted/30">
                          {/* Metrics Grid */}
                          <div className="grid grid-cols-5 gap-3 mb-4">
                            <div className="bg-muted/50 rounded p-3 text-center">
                              <div className="text-xs text-muted-foreground mb-1">Precision</div>
                              <div className="text-lg font-semibold text-foreground">
                                {childResults.has_ground_truth ? `${(childResults.precision * 100).toFixed(1)}%` : 'N/A'}
                              </div>
                            </div>
                            <div className="bg-muted/50 rounded p-3 text-center">
                              <div className="text-xs text-muted-foreground mb-1">Recall</div>
                              <div className="text-lg font-semibold text-foreground">
                                {childResults.has_ground_truth ? `${(childResults.recall * 100).toFixed(1)}%` : 'N/A'}
                              </div>
                            </div>
                            <div className="bg-muted/50 rounded p-3 text-center">
                              <div className="text-xs text-muted-foreground mb-1">F1 Score</div>
                              <div className="text-lg font-semibold text-foreground">
                                {childResults.has_ground_truth ? `${(childResults.f1_score * 100).toFixed(1)}%` : 'N/A'}
                              </div>
                            </div>
                            <div className="bg-muted/50 rounded p-3 text-center">
                              <div className="text-xs text-muted-foreground mb-1">Predictions</div>
                              <div className="text-lg font-semibold text-foreground">
                                {childResults.predictions_count}
                              </div>
                            </div>
                            <div className="bg-muted/50 rounded p-3 text-center">
                              <div className="text-xs text-muted-foreground mb-1">Images</div>
                              <div className="text-lg font-semibold text-foreground">
                                {childResults.images_processed}
                              </div>
                            </div>
                          </div>
                          
                          {/* Inference Time */}
                          <div className="text-sm text-muted-foreground">
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
                        <div className="p-4 border-t border-border bg-muted/30">
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <div className="w-full bg-muted rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full transition-all"
                                  style={{ width: `${childTask.progress}%` }}
                                />
                              </div>
                            </div>
                            <span className="text-sm text-muted-foreground">{childTask.progress}%</span>
                          </div>
                        </div>
                      )}

                      {/* Failed Error Message */}
                      {isExpanded && childTask.status === 'failed' && (
                        <div className="p-4 border-t border-border bg-destructive/10">
                          <div className="flex items-start gap-2">
                            <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-destructive font-mono whitespace-pre-wrap break-words">
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
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Progress</span>
                <span className="text-sm text-muted-foreground">{task.progress}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
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
