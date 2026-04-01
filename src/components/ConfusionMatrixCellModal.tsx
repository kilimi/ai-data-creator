import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Grid3X3, ZoomIn } from "lucide-react";

export interface CmSample {
  file_name: string;
  pred_bbox?: [number, number, number, number] | null;
  gt_bbox?: [number, number, number, number] | null;
  pred_class_name?: string;
  gt_class_name?: string;
  conf?: number;
  iou?: number;
}

interface ConfusionMatrixCellModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  samples: CmSample[];
  rowClass: string;
  colClass: string;
  count: number;
  projectId: number;
  datasetId: number;
}

function buildImageUrl(projectId: number, datasetId: number, fileName: string) {
  return `http://localhost:9999/static/projects/${projectId}/${datasetId}/images/${encodeURIComponent(fileName)}`;
}

/**
 * Draw annotation boxes on a canvas that is sized to exactly match the
 * *rendered* image dimensions. The canvas pixel size equals the displayed
 * size, and we scale coordinates from natural → displayed.
 */
function drawAnnotations(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
  sample: CmSample,
) {
  const dw = img.clientWidth;
  const dh = img.clientHeight;
  if (dw === 0 || dh === 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = dw * dpr;
  canvas.height = dh * dpr;
  canvas.style.width = `${dw}px`;
  canvas.style.height = `${dh}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, dw, dh);

  const sx = dw / img.naturalWidth;
  const sy = dh / img.naturalHeight;

  const lineW = Math.max(1.5, Math.round(dw / 300));
  const fontSize = Math.max(10, Math.round(dw / 45));

  function drawBox(
    bbox: [number, number, number, number],
    color: string,
    label: string,
    labelAbove: boolean,
  ) {
    if (!ctx) return;
    const x1 = bbox[0] * sx;
    const y1 = bbox[1] * sy;
    const x2 = bbox[2] * sx;
    const y2 = bbox[3] * sy;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    if (label) {
      ctx.font = `bold ${fontSize}px sans-serif`;
      const tw = ctx.measureText(label).width + 6;
      const th = fontSize + 4;
      const ly = labelAbove
        ? (y1 > th + 2 ? y1 - 2 : y1 + (y2 - y1) + th)
        : (y2 + th + 2 < dh ? y2 + th : y1 - 2);
      ctx.fillStyle = color;
      ctx.fillRect(x1, ly - th, tw, th);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x1 + 3, ly - 3);
    }
  }

  if (sample.gt_bbox)
    drawBox(sample.gt_bbox, "#22c55e", sample.gt_class_name || "GT", true);
  if (sample.pred_bbox) {
    const conf = sample.conf != null ? ` ${(sample.conf * 100).toFixed(0)}%` : "";
    drawBox(sample.pred_bbox, "#ef4444", (sample.pred_class_name || "Pred") + conf, false);
  }
}

// ── Thumbnail card for grid view ────────────────────────────────────────────

function ImageCard({
  sample,
  imageUrl,
  onClick,
}: {
  sample: CmSample;
  imageUrl: string;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const redraw = useCallback(() => {
    if (canvasRef.current && imgRef.current)
      drawAnnotations(canvasRef.current, imgRef.current, sample);
  }, [sample]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className="group rounded-lg overflow-hidden border border-gray-700 bg-gray-900 cursor-pointer
                 hover:border-gray-400 hover:ring-1 hover:ring-gray-400 transition-all"
    >
      <div className="relative">
        <img
          ref={imgRef}
          src={imageUrl}
          alt={sample.file_name}
          className="w-full block"
          onLoad={redraw}
          onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0.3"; }}
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0"
          style={{ pointerEvents: "none" }}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
          <ZoomIn className="text-white opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 drop-shadow" />
        </div>
      </div>
      <div className="px-2 py-1 text-xs text-gray-400 truncate">
        {sample.file_name}
        {sample.iou != null && sample.iou > 0 && (
          <span className="ml-2 text-gray-500">IoU {sample.iou.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
}

// ── Detail view (replaces grid inside the same dialog) ─────────────────────

function DetailView({
  samples,
  index,
  imageUrl,
  onBack,
  onPrev,
  onNext,
}: {
  samples: CmSample[];
  index: number;
  imageUrl: string;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const sample = samples[index];

  const redraw = useCallback(() => {
    if (canvasRef.current && imgRef.current)
      drawAnnotations(canvasRef.current, imgRef.current, sample);
  }, [sample]);

  // Redraw on index change (cached images may not fire onLoad again)
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) redraw();
  }, [index, redraw]);

  // Keyboard navigation
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onBack(); }
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onBack, onPrev, onNext]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors"
        >
          <Grid3X3 className="w-4 h-4" />
          Back to grid
        </button>
        <span className="text-sm text-gray-400 truncate max-w-[50%] text-center">
          {sample.file_name}
          {sample.conf != null && sample.conf > 0 && (
            <span className="ml-2 text-gray-600">conf {(sample.conf * 100).toFixed(0)}%</span>
          )}
          {sample.iou != null && sample.iou > 0 && (
            <span className="ml-2 text-gray-600">IoU {sample.iou.toFixed(2)}</span>
          )}
        </span>
        <span className="text-sm text-gray-500 tabular-nums">
          {index + 1} / {samples.length}
        </span>
      </div>

      {/* Image area with arrows */}
      <div className="flex items-center gap-2 flex-1 min-h-0 px-2 py-3">
        {/* Prev */}
        <button
          onClick={onPrev}
          disabled={samples.length <= 1}
          className="flex-shrink-0 p-2 rounded-full bg-gray-800 hover:bg-gray-700
                     text-gray-300 hover:text-white transition-colors disabled:opacity-20"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>

        {/* Image + canvas wrapper — inline-block so it shrinks to image size */}
        <div className="flex-1 min-w-0 flex items-center justify-center min-h-0">
          <div className="relative inline-block max-w-full max-h-full">
            <img
              ref={imgRef}
              key={imageUrl}
              src={imageUrl}
              alt={sample.file_name}
              className="block max-w-full max-h-[60vh] object-contain rounded"
              onLoad={redraw}
            />
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0"
              style={{ pointerEvents: "none" }}
            />
          </div>
        </div>

        {/* Next */}
        <button
          onClick={onNext}
          disabled={samples.length <= 1}
          className="flex-shrink-0 p-2 rounded-full bg-gray-800 hover:bg-gray-700
                     text-gray-300 hover:text-white transition-colors disabled:opacity-20"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-5 pb-3 text-xs text-gray-500 flex-shrink-0">
        {sample.gt_bbox && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-green-500" />
            GT: {sample.gt_class_name}
          </span>
        )}
        {sample.pred_bbox && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-500" />
            Pred: {sample.pred_class_name}
          </span>
        )}
        <span className="text-gray-600">← → navigate · Esc back to grid</span>
      </div>
    </div>
  );
}

// ── Main modal ──────────────────────────────────────────────────────────────

export function ConfusionMatrixCellModal({
  open,
  onOpenChange,
  samples,
  rowClass,
  colClass,
  count,
  projectId,
  datasetId,
}: ConfusionMatrixCellModalProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const isTP = rowClass === colClass;
  const isFP = rowClass === "background";
  const isFN = colClass === "background";

  let title: string;
  let description: string;
  let headerBg: string;
  let borderColor: string;

  if (isTP) {
    title = `True Positives — ${rowClass}`;
    description = `Correctly detected. Showing ${samples.length} of ${count}.`;
    headerBg = "bg-green-950/60";
    borderColor = "border-green-700";
  } else if (isFP) {
    title = `False Positives — predicted "${colClass}"`;
    description = `Model predicted "${colClass}" but no matching GT. Showing ${samples.length} of ${count}.`;
    headerBg = "bg-orange-950/60";
    borderColor = "border-orange-700";
  } else if (isFN) {
    title = `False Negatives — missed "${rowClass}"`;
    description = `GT "${rowClass}" exists but model missed it. Showing ${samples.length} of ${count}.`;
    headerBg = "bg-yellow-950/60";
    borderColor = "border-yellow-700";
  } else {
    title = `Confusion — "${rowClass}" predicted as "${colClass}"`;
    description = `Actual: "${rowClass}", predicted: "${colClass}". Showing ${samples.length} of ${count}.`;
    headerBg = "bg-red-950/60";
    borderColor = "border-red-700";
  }

  function imageUrl(s: CmSample) {
    return buildImageUrl(projectId, datasetId, s.file_name);
  }

  const goBack = useCallback(() => setSelectedIndex(null), []);
  const goPrev = useCallback(
    () => setSelectedIndex((i) => (i != null ? (i - 1 + samples.length) % samples.length : null)),
    [samples.length],
  );
  const goNext = useCallback(
    () => setSelectedIndex((i) => (i != null ? (i + 1) % samples.length : null)),
    [samples.length],
  );

  // Reset to grid when dialog closes
  useEffect(() => {
    if (!open) setSelectedIndex(null);
  }, [open]);

  const showDetail = selectedIndex != null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`max-w-5xl flex flex-col bg-gray-950 border ${borderColor} p-0 gap-0`}
        style={{ maxHeight: "88vh" }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>

        {/* Header — always visible */}
        <div className={`${headerBg} border-b ${borderColor} px-5 pt-5 pb-3 rounded-t-lg flex-shrink-0`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white">{title}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{description}</p>
            </div>
          </div>
          {!showDetail && (
            <div className="flex gap-5 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-green-500" /> GT box
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-3 rounded-sm bg-red-500" /> Prediction
              </span>
              <span className="text-gray-600">Click an image to enlarge</span>
            </div>
          )}
        </div>

        {/* Body — switches between grid and detail */}
        {samples.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-16 text-gray-500">
            No samples available
          </div>
        ) : showDetail ? (
          <DetailView
            samples={samples}
            index={selectedIndex}
            imageUrl={imageUrl(samples[selectedIndex])}
            onBack={goBack}
            onPrev={goPrev}
            onNext={goNext}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {samples.map((sample, i) => (
                <ImageCard
                  key={i}
                  sample={sample}
                  imageUrl={imageUrl(sample)}
                  onClick={() => setSelectedIndex(i)}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
