import { useState, useEffect, useRef } from "react";
import { Slider } from "@/components/ui/slider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { SlidersHorizontal, RotateCcw, X, Save, Check, Download, Database, ExternalLink } from "lucide-react";
import { ConfusionMatrixCellModal, type CmSample } from "@/components/ConfusionMatrixCellModal";
import { evaluationCocoJsonDownloadName } from "@/lib/evaluationTableDisplay";
import { useToast } from "@/hooks/use-toast";
import { getApiBaseUrl } from "@/config/api";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RawPrediction {
  image_id: number;
  class_id: number;
  bbox_xyxy: [number, number, number, number];
  conf: number;
}

export interface RawGTBox {
  image_id: number;
  file_name: string;
  class_id: number;
  bbox: [number, number, number, number]; // xyxy pixel coords
  class_name: string;
}

interface MetricsResult {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
  cm: number[][];
  cmSamples: Record<string, CmSample[]>;
  perClass: Array<{ name: string; tp: number; fp: number; fn: number; precision: number; recall: number; f1: number }>;
}

// ── IoU helper ─────────────────────────────────────────────────────────────

/**
 * Calculate Intersection over Union between two bounding boxes.
 * @param a First bbox in [x1, y1, x2, y2] format
 * @param b Second bbox in [x1, y1, x2, y2] format
 * @returns IoU value between 0 and 1, or 0 if inputs are invalid
 */
export function iou(
  a: [number, number, number, number],
  b: [number, number, number, number]
): number {
  // Validate input arrays
  if (!a || !b || a.length !== 4 || b.length !== 4) return 0;
  
  // Validate all values are finite numbers
  if (!a.every(v => Number.isFinite(v)) || !b.every(v => Number.isFinite(v))) return 0;
  
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter === 0) return 0;
  
  const aW = a[2] - a[0];
  const aH = a[3] - a[1];
  const bW = b[2] - b[0];
  const bH = b[3] - b[1];
  
  // Guard against zero or negative area boxes
  if (aW <= 1e-6 || aH <= 1e-6 || bW <= 1e-6 || bH <= 1e-6) return 0;
  
  const aA = aW * aH;
  const bA = bW * bH;
  const union = aA + bA - inter;
  
  // Guard against division by zero
  if (union <= 0) return 0;
  
  return inter / union;
}

// ── Core matching ──────────────────────────────────────────────────────────

const MAX_SAMPLES = 20;

/**
 * Compute precision, recall, F1, and confusion matrix from predictions and ground truth.
 * @returns MetricsResult with all computed metrics
 */
export function computeMetrics(
  predictions: RawPrediction[],
  groundTruth: RawGTBox[],
  globalConf: number,
  iouThreshold: number,
  numRealClasses: number,
  perClassConf: number[], // -1 means use global
  classNames: string[],   // includes 'background' as last entry
  imageIdToFilename: Record<string, string>
): MetricsResult {
  // Filter by confidence with bounds checking
  const filtered = predictions.filter((p) => {
    // Validate image_id
    if (!Number.isFinite(p.image_id)) {
      console.warn(`Invalid image_id: ${p.image_id}`);
      return false;
    }
    
    // Bounds check for class_id
    if (!Number.isFinite(p.class_id) || p.class_id < 0 || p.class_id >= numRealClasses) {
      console.warn(`Invalid class_id ${p.class_id}, must be between 0 and ${numRealClasses - 1}`);
      return false;
    }
    
    // Safe access to perClassConf with bounds check
    const thr = (p.class_id >= 0 && p.class_id < perClassConf.length && perClassConf[p.class_id] >= 0) 
      ? perClassConf[p.class_id] 
      : globalConf;
    return p.conf >= thr;
  });

  // Group by image
  const predByImg: Record<number, RawPrediction[]> = {};
  for (const p of filtered) {
    if (!predByImg[p.image_id]) predByImg[p.image_id] = [];
    predByImg[p.image_id].push(p);
  }
  const gtByImg: Record<number, RawGTBox[]> = {};
  for (const g of groundTruth) {
    // Validate image_id
    if (!Number.isFinite(g.image_id)) {
      console.warn(`Invalid GT image_id: ${g.image_id}`);
      continue;
    }
    
    // Validate and warn about invalid class_ids
    if (!Number.isFinite(g.class_id) || g.class_id < 0 || g.class_id >= numRealClasses) {
      console.warn(`Invalid GT class_id ${g.class_id} for image ${g.image_id}, must be between 0 and ${numRealClasses - 1}`);
      continue;
    }
    
    if (!gtByImg[g.image_id]) gtByImg[g.image_id] = [];
    gtByImg[g.image_id].push(g);
  }

  const allImgIds = new Set<number>([
    ...Object.keys(predByImg).map(Number),
    ...Object.keys(gtByImg).map(Number),
  ]);

  const n = numRealClasses;
  const cm: number[][] = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(0));
  const cmSamples: Record<string, CmSample[]> = {};

  function addSample(row: number, col: number, s: CmSample) {
    const k = `${row}_${col}`;
    if (!cmSamples[k]) cmSamples[k] = [];
    if (cmSamples[k].length < MAX_SAMPLES) cmSamples[k].push(s);
  }

  let tp = 0, fp = 0, fn = 0;

  for (const imgId of allImgIds) {
    const preds = predByImg[imgId] ?? [];
    const gts = gtByImg[imgId] ?? [];
    const fileName = imageIdToFilename[String(imgId)] ?? "";
    const matchedGt = new Set<number>();

    for (let i = 0; i < preds.length; i++) {
      let bestScore = 0;
      let bestJ = -1;
      for (let j = 0; j < gts.length; j++) {
        if (matchedGt.has(j)) continue;
        const score = iou(preds[i].bbox_xyxy, gts[j].bbox);
        if (score > bestScore) { bestScore = score; bestJ = j; }
      }

      if (bestJ >= 0 && bestScore >= iouThreshold) {
        matchedGt.add(bestJ);
        const pc = preds[i].class_id;
        const gc = gts[bestJ].class_id;
        cm[gc][pc]++;
        addSample(gc, pc, {
          image_id: imgId,
          file_name: fileName,
          pred_bbox: preds[i].bbox_xyxy,
          gt_bbox: gts[bestJ].bbox,
          pred_class_name: classNames[pc] ?? String(pc),
          gt_class_name: gts[bestJ].class_name,
          conf: preds[i].conf,
          iou: bestScore,
        });
        if (gc === pc) tp++;
        else fp++;
      } else {
        fp++;
        cm[n][preds[i].class_id]++;
        addSample(n, preds[i].class_id, {
          image_id: imgId,
          file_name: fileName,
          pred_bbox: preds[i].bbox_xyxy,
          gt_bbox: undefined,
          pred_class_name: classNames[preds[i].class_id] ?? String(preds[i].class_id),
          gt_class_name: "background",
          conf: preds[i].conf,
          iou: bestScore,
        });
      }
    }

    for (let j = 0; j < gts.length; j++) {
      if (!matchedGt.has(j)) {
        fn++;
        cm[gts[j].class_id][n]++;
        addSample(gts[j].class_id, n, {
          image_id: imgId,
          file_name: gts[j].file_name,
          pred_bbox: undefined,
          gt_bbox: gts[j].bbox,
          pred_class_name: "background",
          gt_class_name: gts[j].class_name,
          conf: 0,
          iou: 0,
        });
      }
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Per-class breakdown from the CM
  const perClass = classNames.slice(0, n).map((name, i) => {
    const cTP = cm[i][i];
    const cFP = cm.reduce((s, row, ri) => (ri !== i ? s + row[i] : s), 0);
    const cFN = cm[i].reduce((s, v, ci) => (ci !== i ? s + v : s), 0);
    const cP = cTP + cFP > 0 ? cTP / (cTP + cFP) : 0;
    const cR = cTP + cFN > 0 ? cTP / (cTP + cFN) : 0;
    return {
      name,
      tp: cTP, fp: cFP, fn: cFN,
      precision: cP,
      recall: cR,
      f1: cP + cR > 0 ? (2 * cP * cR) / (cP + cR) : 0,
    };
  });

  return { precision, recall, f1, tp, fp, fn, cm, cmSamples, perClass };
}

// ── Component ──────────────────────────────────────────────────────────────

interface ThresholdExplorerProps {
  predictions: RawPrediction[];
  groundTruth: RawGTBox[];
  classNames: string[];         // includes 'background' as last item
  imageIdToFilename: Record<string, string>;
  projectId: number;
  datasetId: number;
  initialConf: number;
  initialIou: number;
  initialPerClassConf?: Record<string, number>;
  taskId: number;
  onSaved?: () => void;
  evaluationName?: string;
  datasetName?: string;
}

type SaveSelectionMode = "all" | "cm_cells";

// Cell key helpers for the confusion-matrix picker
const cellKey = (row: number, col: number) => `${row}_${col}`;

export function ThresholdExplorer({
  predictions,
  groundTruth,
  classNames,
  imageIdToFilename,
  projectId,
  datasetId,
  initialConf,
  initialIou,
  initialPerClassConf,
  taskId,
  onSaved,
  evaluationName,
  datasetName,
}: ThresholdExplorerProps) {
  const { toast } = useToast();
  const numRealClasses = classNames.length - 1; // last is 'background'

  const [showPerClass, setShowPerClass] = useState(false);
  const [showPerClassTable, setShowPerClassTable] = useState(false);
  const [confThreshold, setConfThreshold] = useState(initialConf);
  const [iouThreshold, setIouThreshold] = useState(initialIou);
  const [perClassConf, setPerClassConf] = useState<number[]>(() => {
    const arr = Array(numRealClasses).fill(-1);
    if (initialPerClassConf) {
      for (let i = 0; i < numRealClasses; i++) {
        // Bounds check: ensure classNames[i] exists before accessing
        if (i < classNames.length) {
          const v = initialPerClassConf[classNames[i]];
          if (v !== undefined && v >= 0) arr[i] = v;
        }
      }
    }
    return arr;
  });
  const [metrics, setMetrics] = useState<MetricsResult | null>(null);
  const [cmCell, setCmCell] = useState<{ row: number; col: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [savingToDataset, setSavingToDataset] = useState(false);
  const [saveSelectionMode, setSaveSelectionMode] = useState<SaveSelectionMode>("all");
  const [selectedSaveClassIds, setSelectedSaveClassIds] = useState<number[]>(() =>
    Array.from({ length: numRealClasses }, (_, i) => i)
  );
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [annotationName, setAnnotationName] = useState(() => {
    const base = (evaluationName || `evaluation_${taskId}`).trim();
    return `${base}_predictions`;
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Track mounted state for cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Debounced recompute whenever any threshold changes
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Only update state if component is still mounted
      if (mountedRef.current) {
        setMetrics(
          computeMetrics(
            predictions, groundTruth, confThreshold, iouThreshold,
            numRealClasses, perClassConf, classNames, imageIdToFilename
          )
        );
      }
      timerRef.current = null;
    }, 120);
    return () => { 
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [confThreshold, iouThreshold, perClassConf, predictions, groundTruth, numRealClasses, classNames, imageIdToFilename]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const per_class_conf: Record<string, number> = {};
      perClassConf.forEach((v, i) => {
        // Bounds check before accessing classNames
        if (v >= 0 && i < classNames.length) {
          per_class_conf[classNames[i]] = v;
        }
      });
      
      const response = await fetch(`${getApiBaseUrl()}/tasks/${taskId}/eval-thresholds`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conf_threshold: confThreshold,
          iou_threshold: iouThreshold,
          per_class_conf: Object.keys(per_class_conf).length > 0 ? per_class_conf : null,
          precision: metrics?.precision ?? null,
          recall: metrics?.recall ?? null,
          f1_score: metrics?.f1 ?? null,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }
      
      if (mountedRef.current) {
        setSaved(true);
        setTimeout(() => {
          if (mountedRef.current) setSaved(false);
        }, 3000);
      }
      onSaved?.();
    } catch (error) {
      console.error('Failed to save thresholds:', error);
      if (mountedRef.current) {
        setSaveError(error instanceof Error ? error.message : 'Failed to save thresholds');
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }

  async function confirmSaveToDataset() {
    setSavingToDataset(true);
    setSaveError(null);
    try {
      const per_class_conf: Record<string, number> = {};
      perClassConf.forEach((v, i) => {
        if (v >= 0 && i < classNames.length) {
          per_class_conf[classNames[i]] = v;
        }
      });

      const response = await fetch(`${getApiBaseUrl()}/predictions/evaluation/${taskId}/save-to-dataset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          annotation_name: annotationName.trim() || undefined,
          conf_threshold: confThreshold,
          iou_threshold: iouThreshold,
          per_class_conf: Object.keys(per_class_conf).length > 0 ? per_class_conf : null,
          save_selection: saveSelectionMode,
          selected_cells:
            saveSelectionMode === "cm_cells"
              ? Array.from(selectedCells).map((k) => k.split("_").map(Number))
              : null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      toast({
        title: "Predictions saved",
        description: "Filtered predictions have been saved as annotations in the dataset.",
      });
      setShowSaveConfirm(false);
    } catch (error) {
      console.error('Failed to save predictions to dataset:', error);
      if (mountedRef.current) {
        setSaveError(error instanceof Error ? error.message : 'Failed to save predictions to dataset');
      }
    } finally {
      if (mountedRef.current) {
        setSavingToDataset(false);
      }
    }
  }

  function handleDownloadCoco() {
    // Use backend API for export to avoid memory issues with large datasets
    const url = new URL(`${getApiBaseUrl()}/predictions/export-coco/${taskId}`);
    
    // Pass current threshold values as query parameters
    url.searchParams.set('conf_threshold', confThreshold.toString());
    url.searchParams.set('iou_threshold', iouThreshold.toString());
    
    // Include per-class confidence overrides if any
    const activePerClass: Record<string, number> = {};
    perClassConf.forEach((v, i) => {
      if (v >= 0 && i < classNames.length) {
        activePerClass[classNames[i]] = v;
      }
    });
    if (Object.keys(activePerClass).length > 0) {
      url.searchParams.set('per_class_conf', JSON.stringify(activePerClass));
    }
    
    // Create a temporary link and trigger download
    const link = document.createElement('a');
    link.href = url.toString();
    link.download = `evaluation_${taskId}_coco.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handleOpenDataset() {
    const path = projectId > 0
      ? `/projects/${projectId}/datasets/${datasetId}`
      : `/datasets/${datasetId}`;
    window.open(path, "_blank", "noopener,noreferrer");
  }

  const resetDefaults = () => {
    setConfThreshold(initialConf);
    setIouThreshold(initialIou);
    setPerClassConf(Array(numRealClasses).fill(-1));
    setSaved(false);
  };

  function setClassConf(i: number, v: number) {
    setPerClassConf((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  }

  function resetClassConf(i: number) {
    setClassConf(i, -1);
  }

  function toggleSaveClass(classId: number) {
    setSelectedSaveClassIds((prev) =>
      prev.includes(classId) ? prev.filter((id) => id !== classId) : [...prev, classId].sort((a, b) => a - b)
    );
  }

  function selectAllSaveClasses() {
    setSelectedSaveClassIds(Array.from({ length: numRealClasses }, (_, i) => i));
  }

  function clearSaveClasses() {
    setSelectedSaveClassIds([]);
  }

  const hasPerClassOverride = perClassConf.some((v) => v >= 0);
  const isModified =
    Math.abs(confThreshold - initialConf) > 0.001 ||
    Math.abs(iouThreshold - initialIou) > 0.001 ||
    hasPerClassOverride;

  return (
    <div className="bg-gray-950 border border-blue-900 rounded-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-white">Threshold Explorer</span>
          {isModified && (
            <span className="text-xs bg-blue-600/30 text-blue-300 border border-blue-700 rounded-full px-2 py-0.5">
              modified
            </span>
          )}
          <span className="text-xs text-gray-500">
            — adjust Confidence &amp; IoU and see live Precision / Recall / Confusion Matrix
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleDownloadCoco}
                  aria-label="Download COCO"
                  className="flex items-center justify-center w-9 h-9 rounded-md transition-colors bg-gray-800 text-gray-200 border border-gray-700 hover:bg-gray-700"
                >
                  <Download className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Export filtered predictions (COCO JSON)</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowSaveConfirm(true)}
                  aria-label="Save predictions to dataset"
                  disabled={savingToDataset}
                  className="flex items-center justify-center w-9 h-9 rounded-md transition-colors bg-amber-700/30 text-amber-300 border border-amber-700 hover:bg-amber-700/50 disabled:opacity-50"
                >
                  <Database className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Save predictions to dataset</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleOpenDataset}
                  aria-label="Open test dataset"
                  className="flex items-center justify-center w-9 h-9 rounded-md transition-colors bg-gray-800 text-gray-200 border border-gray-700 hover:bg-gray-700"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Open test dataset</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <div className="w-px h-6 bg-gray-700" />

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleSave}
                  aria-label={saved ? "Thresholds saved" : saving ? "Saving thresholds" : "Save thresholds"}
                  disabled={saving}
                  className={`flex items-center justify-center w-9 h-9 rounded-md transition-colors ${
                    saved
                      ? "bg-green-700/40 text-green-300 border border-green-700"
                      : "bg-blue-700/40 text-blue-300 border border-blue-700 hover:bg-blue-700/60"
                  } disabled:opacity-50`}
                >
                  {saved ? <Check className="w-4 h-4" /> : saving ? <Save className="w-4 h-4 animate-pulse" /> : <Save className="w-4 h-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{saved ? "Thresholds saved" : saving ? "Saving thresholds…" : "Save thresholds"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* Error Display */}
      {saveError && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/20 border border-red-700 rounded text-sm text-red-300">
          Failed to save: {saveError}
        </div>
      )}

      <div className="px-4 pb-4 space-y-5 pt-4">
          {/* ── Sliders ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-300 font-medium">
                  Confidence Threshold
                </label>
                <span className="text-sm font-mono text-blue-300">{confThreshold.toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                Minimum model confidence required to keep a prediction. Higher values reduce false positives but may miss true objects.
              </p>
              <Slider
                value={[confThreshold]}
                onValueChange={([v]) => setConfThreshold(v)}
                min={0.01}
                max={0.99}
                step={0.01}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>0.01</span><span>0.99</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-300 font-medium">
                  IoU Threshold
                </label>
                <span className="text-sm font-mono text-blue-300">{iouThreshold.toFixed(2)}</span>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                Minimum overlap needed to match a prediction with ground truth. Higher values require tighter box alignment to count as true positives.
              </p>
              <Slider
                value={[iouThreshold]}
                onValueChange={([v]) => setIouThreshold(v)}
                min={0.1}
                max={0.95}
                step={0.05}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>0.10</span><span>0.95</span>
              </div>
            </div>
          </div>

          {/* Per-class confidence */}
          <div>
            <div className="flex items-center gap-3">
              <button
                className="text-xs text-blue-400 underline hover:text-blue-300"
                onClick={() => setShowPerClass((x) => !x)}
              >
                {showPerClass ? "Hide" : "Show"} per-class confidence overrides
              </button>
              {hasPerClassOverride && (
                <span className="text-xs text-orange-400">
                  {perClassConf.filter((v) => v >= 0).length} class(es) overridden
                </span>
              )}
              {isModified && (
                <button
                  className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-white"
                  onClick={resetDefaults}
                >
                  <RotateCcw className="w-3 h-3" /> Reset to evaluation defaults
                </button>
              )}
            </div>

            {showPerClass && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {classNames.slice(0, numRealClasses).map((name, i) => {
                  const effective = perClassConf[i] >= 0 ? perClassConf[i] : confThreshold;
                  const overridden = perClassConf[i] >= 0;
                  return (
                    <div
                      key={i}
                      className={`rounded-md px-3 py-2 border ${overridden ? "border-orange-800 bg-orange-950/30" : "border-gray-800 bg-gray-900"}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-300 truncate max-w-[70%]">{name}</span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-mono text-blue-300">{effective.toFixed(2)}</span>
                          {overridden && (
                            <button
                              className="text-gray-500 hover:text-gray-200"
                              onClick={() => resetClassConf(i)}
                              title="Reset to global"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <Slider
                        value={[effective]}
                        onValueChange={([v]) => setClassConf(i, v)}
                        min={0.01}
                        max={0.99}
                        step={0.01}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Live Metrics ── */}
          {metrics && (
            <>
              <div className="border-t border-gray-800 pt-4">
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                  {[
                    { label: "Precision", value: `${(metrics.precision * 100).toFixed(1)}%`, color: "text-green-400" },
                    { label: "Recall",    value: `${(metrics.recall * 100).toFixed(1)}%`,    color: "text-blue-400" },
                    { label: "F1",        value: `${(metrics.f1 * 100).toFixed(1)}%`,        color: "text-purple-400" },
                    { label: "TP",        value: metrics.tp.toString(),                      color: "text-green-500" },
                    { label: "FP",        value: metrics.fp.toString(),                      color: "text-orange-400" },
                    { label: "FN",        value: metrics.fn.toString(),                      color: "text-yellow-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-gray-900 rounded-lg p-3 text-center border border-gray-800">
                      <div className="text-xs text-gray-500 mb-1">{label}</div>
                      <div className={`text-xl font-bold ${color}`}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-class breakdown table */}
              <div>
                <button
                  className="text-xs text-blue-400 underline hover:text-blue-300"
                  onClick={() => setShowPerClassTable((x) => !x)}
                >
                  {showPerClassTable ? "Hide" : "Show"} per-class breakdown
                </button>
                {showPerClassTable && (
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr>
                          {["Class", "Precision", "Recall", "F1", "TP", "FP", "FN"].map((h) => (
                            <th key={h} className="px-2 py-1 text-left text-gray-400">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.perClass.map((c) => (
                          <tr key={c.name} className="border-t border-gray-800">
                            <td className="px-2 py-1 text-gray-300 font-medium">{c.name}</td>
                            <td className="px-2 py-1 text-green-400">{(c.precision * 100).toFixed(1)}%</td>
                            <td className="px-2 py-1 text-blue-400">{(c.recall * 100).toFixed(1)}%</td>
                            <td className="px-2 py-1 text-purple-400">{(c.f1 * 100).toFixed(1)}%</td>
                            <td className="px-2 py-1 text-green-500">{c.tp}</td>
                            <td className="px-2 py-1 text-orange-400">{c.fp}</td>
                            <td className="px-2 py-1 text-yellow-400">{c.fn}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Confusion Matrix */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-gray-300">Confusion Matrix</h4>
                  <span className="text-xs text-gray-600">Click a cell to see examples</span>
                </div>
                {/* Legend */}
                <div className="flex flex-wrap gap-3 text-xs mb-2">
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-green-700 opacity-80" /> diagonal = correct detection (TP)</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-yellow-700 opacity-80" /> last col = missed / not found (FN)</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-orange-700 opacity-80" /> last row = false positive / spurious detection (FP)</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm bg-red-800 opacity-80" /> off-diag = wrong class</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr>
                        <th className="px-2 py-1 text-left text-gray-400">Actual \ Pred</th>
                        {classNames.map((name, idx) => {
                          const isLast = idx === classNames.length - 1;
                          return (
                            <th key={idx} className={`px-2 py-1 text-center max-w-[60px] truncate ${isLast ? "text-yellow-400 font-semibold" : "text-gray-400"}`}>
                              {isLast ? "Not Found" : name}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.cm.map((row, i) => {
                        const isLastRow = i === classNames.length - 1;
                        return (
                          <tr key={i} className="border-t border-gray-800">
                            <td className={`px-2 py-1 font-medium ${isLastRow ? "text-orange-400" : "text-gray-400"}`}>
                              {isLastRow ? "False Positive" : classNames[i]}
                            </td>
                            {row.map((val, j) => (
                              <td
                                key={j}
                                onClick={() => val > 0 && setCmCell({ row: i, col: j })}
                                className={`px-2 py-1 text-center transition-colors ${
                                  val > 0
                                    ? i === j
                                      ? "text-green-400 font-bold hover:bg-green-900/40 cursor-pointer"
                                      : isLastRow
                                        ? "text-orange-400 hover:bg-orange-900/30 cursor-pointer"
                                        : j === classNames.length - 1
                                          ? "text-yellow-400 hover:bg-yellow-900/30 cursor-pointer"
                                          : "text-red-400 hover:bg-red-900/30 cursor-pointer"
                                    : "text-gray-700"
                                }`}
                              >
                                {val}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

      {/* CM drill-down */}
      {cmCell && metrics && (
        <ConfusionMatrixCellModal
          open={cmCell !== null}
          onOpenChange={(v) => !v && setCmCell(null)}
          samples={metrics.cmSamples[`${cmCell.row}_${cmCell.col}`] ?? []}
          rowClass={classNames[cmCell.row] ?? String(cmCell.row)}
          colClass={classNames[cmCell.col] ?? String(cmCell.col)}
          count={metrics.cm[cmCell.row][cmCell.col]}
          projectId={projectId}
          datasetId={datasetId}
          taskId={taskId}
          imageIdToFilename={imageIdToFilename}
        />
      )}

      {/* Save predictions to dataset confirmation */}
      <AlertDialog open={showSaveConfirm} onOpenChange={setShowSaveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save predictions to dataset?</AlertDialogTitle>
            <AlertDialogDescription>
              This will save the filtered predictions as new annotations in the dataset "{datasetName ?? `Dataset ${datasetId}`}".
              Existing annotations will not be overwritten, but duplicate predictions may be added.
            </AlertDialogDescription>
            <div className="mt-3 space-y-3">
              <div className="text-sm text-foreground">What should be saved?</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSaveSelectionMode("all")}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    saveSelectionMode === "all"
                      ? "border-blue-500 bg-blue-950/40 text-blue-100"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">All filtered predictions</div>
                  <div className="text-xs mt-1">Saves every prediction that passes confidence/per-class filters.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSaveSelectionMode("tp_per_class")}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    saveSelectionMode === "tp_per_class"
                      ? "border-emerald-500 bg-emerald-950/40 text-emerald-100"
                      : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <div className="font-medium">True positives per class</div>
                  <div className="text-xs mt-1">Only saves predictions matched to ground truth in selected classes.</div>
                </button>
              </div>

              {saveSelectionMode === "tp_per_class" && (
                <div className="rounded-md border border-emerald-800/70 bg-emerald-950/20 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-medium text-emerald-100">Select classes from confusion matrix TP diagonal</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={selectAllSaveClasses}
                        className="text-xs text-emerald-300 hover:text-emerald-200"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={clearSaveClasses}
                        className="text-xs text-emerald-300 hover:text-emerald-200"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                    {metrics?.perClass?.map((c, i) => {
                      const selected = selectedSaveClassIds.includes(i);
                      return (
                        <button
                          key={`${c.name}_${i}`}
                          type="button"
                          onClick={() => toggleSaveClass(i)}
                          className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                            selected
                              ? "border-emerald-500 bg-emerald-900/40 text-emerald-100"
                              : "border-emerald-900/60 bg-black/20 text-emerald-300/80 hover:bg-emerald-950/40"
                          }`}
                        >
                          <div className="text-sm font-medium truncate">{c.name}</div>
                          <div className="text-xs opacity-80">TP: {c.tp}</div>
                        </button>
                      );
                    })}
                  </div>
                  {selectedSaveClassIds.length === 0 && (
                    <div className="text-xs text-amber-300 mt-2">Select at least one class to save TP predictions.</div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3">
              <label className="text-sm text-foreground mb-1 block">Annotation name</label>
              <Input
                value={annotationName}
                onChange={(e) => setAnnotationName(e.target.value)}
                placeholder={`${(evaluationName || `evaluation_${taskId}`).trim()}_predictions`}
              />
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowSaveConfirm(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSaveToDataset}
              disabled={savingToDataset || (saveSelectionMode === "tp_per_class" && selectedSaveClassIds.length === 0)}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {savingToDataset ? "Saving…" : "Save predictions"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
