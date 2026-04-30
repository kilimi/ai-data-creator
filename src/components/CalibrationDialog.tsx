/**
 * CalibrationDialog â€” two-tab tool for calibrating and testing image collection alignment.
 *
 * Tab 1 â€“ Calibrate: click point pairs on both images (free side), compute homography, hover to project.
 * Tab 2 â€“ Test: draw freehand strokes on either image, see live projection on the other side.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/hooks/use-api";
import { ImageCollection } from "@/types";
import { Crosshair, RefreshCw, Trash2, Pencil, Check, ChevronRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Stepper — shows the 5-step calibration flow with the current step highlighted
// ---------------------------------------------------------------------------

interface StepDef {
  id: number;
  label: string;
  hint: string;
}

function StepsBar({
  steps,
  current,
  completed,
}: {
  steps: StepDef[];
  current: number;
  completed: Set<number>;
}) {
  const active = steps.find((s) => s.id === current);
  return (
    <div className="shrink-0 rounded-md border bg-card">
      <div className="flex items-stretch overflow-x-auto">
        {steps.map((step, i) => {
          const isDone = completed.has(step.id);
          const isCurrent = step.id === current;
          return (
            <React.Fragment key={step.id}>
              <div
                className={`flex items-center gap-2 px-3 py-2 text-xs whitespace-nowrap ${
                  isCurrent
                    ? "text-foreground font-semibold"
                    : isDone
                    ? "text-muted-foreground"
                    : "text-muted-foreground/60"
                }`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                    isCurrent
                      ? "bg-primary text-primary-foreground ring-2 ring-primary/30"
                      : isDone
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {isDone ? <Check className="h-3 w-3" /> : step.id}
                </span>
                <span>{step.label}</span>
              </div>
              {i < steps.length - 1 && (
                <ChevronRight className="h-3 w-3 self-center text-muted-foreground/40" />
              )}
            </React.Fragment>
          );
        })}
      </div>
      {active && (
        <div className="border-t px-3 py-1.5 text-xs text-muted-foreground bg-muted/40">
          <span className="font-medium text-foreground">Step {active.id}:</span>{" "}
          {active.hint}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PointPair {
  src_x: number;
  src_y: number;
  tgt_x: number;
  tgt_y: number;
}

interface CalibrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: string;
  collections: ImageCollection[];
  onCalibrationSaved: () => void;
}

// Colours for point markers (cycles)
const PAIR_COLOURS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f97316", "#a855f7",
  "#06b6d4", "#eab308", "#ec4899", "#14b8a6", "#8b5cf6",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

/** Apply a 3Ã—3 homography (row-major nested array) to a point. */
function applyHomography(H: number[][], x: number, y: number): { x: number; y: number } {
  const [r0, r1, r2] = H;
  const w = r2[0] * x + r2[1] * y + r2[2];
  return {
    x: (r0[0] * x + r0[1] * y + r0[2]) / w,
    y: (r1[0] * x + r1[1] * y + r1[2]) / w,
  };
}

// ---------------------------------------------------------------------------
// ImagePanel â€” renders one image, handles point clicking + hover projection
// ---------------------------------------------------------------------------

interface ImagePanelProps {
  imageUrl: string | null;
  side: "src" | "tgt";
  /** Points already committed as full pairs â€” shown as coloured circles */
  committedPoints: Array<{ x: number; y: number; colorIdx: number }>;
  /** If there's a pending point for this side, show it as a dashed circle */
  pendingPoint: { x: number; y: number } | null;
  /** Probe crosshair projected FROM the other side. Natural-image pixel coords. */
  probePoint: { x: number; y: number } | null;
  /** Called with natural-image pixel coords when user clicks */
  onClick: (side: "src" | "tgt", x: number, y: number) => void;
  /** Called on mouse move with natural-image pixel coords â€” used for live projection */
  onMouseMove?: (side: "src" | "tgt", x: number, y: number) => void;
  /** Highlight border when it's this side's turn */
  isActive: boolean;
}

function ImagePanel({
  imageUrl, side, committedPoints, pendingPoint, probePoint, onClick, onMouseMove, isActive,
}: ImagePanelProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const handleImageLoad = useCallback(() => {
    setImgLoaded(true);
  }, []);

  /**
   * Convert container-relative mouse event to natural image pixel coords.
   * Correctly accounts for object-contain letterbox gaps.
   */
  const toNatural = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !imgLoaded) return null;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return null;
    const scale = Math.min(cw / nw, ch / nh);
    const rw = nw * scale;
    const rh = nh * scale;
    const left = (cw - rw) / 2;
    const top = (ch - rh) / 2;
    const containerRect = container.getBoundingClientRect();
    const rx = e.clientX - containerRect.left - left;
    const ry = e.clientY - containerRect.top - top;
    if (rx < 0 || ry < 0 || rx > rw || ry > rh) return null;
    return {
      x: (rx / rw) * nw,
      y: (ry / rh) * nh,
    };
  }, [imgLoaded]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const pt = toNatural(e);
      if (!pt) return;
      onClick(side, pt.x, pt.y);
    },
    [side, onClick, toNatural],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onMouseMove) return;
      const pt = toNatural(e);
      if (!pt) return;
      onMouseMove(side, pt.x, pt.y);
    },
    [side, onMouseMove, toNatural],
  );

  /** Convert natural image pixel coords to container-local CSS pixels for the SVG overlay. */
  const toDisplay = useCallback((nx: number, ny: number) => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !imgLoaded) return null;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) return null;
    const scale = Math.min(cw / nw, ch / nh);
    const rw = nw * scale;
    const rh = nh * scale;
    return {
      x: (cw - rw) / 2 + (nx / nw) * rw,
      y: (ch - rh) / 2 + (ny / nh) * rh,
    };
  }, [imgLoaded]);

  if (!imageUrl) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center bg-muted rounded-md text-sm text-muted-foreground h-60">
        No image available
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex-1 min-w-0 relative rounded-md border-2 cursor-crosshair select-none ${
        isActive ? "border-primary" : "border-border"
      }`}
      style={{ minHeight: 480, overflow: "hidden" }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
    >
      <img
        ref={imgRef}
        src={imageUrl}
        alt="calibration image"
        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        draggable={false}
        onLoad={handleImageLoad}
      />
      {/* Single full-size SVG overlay — markers placed at correct letterbox-aware coords */}
      {imgLoaded && (
        <svg
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {committedPoints.map((pt, i) => {
            const dp = toDisplay(pt.x, pt.y);
            if (!dp) return null;
            const color = PAIR_COLOURS[pt.colorIdx % PAIR_COLOURS.length];
            return (
              <g key={i}>
                <circle cx={dp.x} cy={dp.y} r={10} fill={color + "55"} stroke={color} strokeWidth={3} />
                <text x={dp.x} y={dp.y - 13} textAnchor="middle" fill={color} fontSize={11} fontWeight="bold">
                  {pt.colorIdx + 1}
                </text>
              </g>
            );
          })}
          {pendingPoint && (() => {
            const dp = toDisplay(pendingPoint.x, pendingPoint.y);
            if (!dp) return null;
            return (
              <circle
                cx={dp.x} cy={dp.y} r={8}
                fill="rgba(255,255,255,0.25)"
                stroke="white" strokeWidth={2} strokeDasharray="4 3"
              />
            );
          })()}
          {probePoint && (() => {
            const dp = toDisplay(probePoint.x, probePoint.y);
            if (!dp) return null;
            const S = 14;
            return (
              <g>
                <line x1={dp.x - S} y1={dp.y} x2={dp.x + S} y2={dp.y} stroke="#22d3ee" strokeWidth={2} />
                <line x1={dp.x} y1={dp.y - S} x2={dp.x} y2={dp.y + S} stroke="#22d3ee" strokeWidth={2} />
                <circle cx={dp.x} cy={dp.y} r={4} fill="none" stroke="#22d3ee" strokeWidth={2} />
              </g>
            );
          })()}
        </svg>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
// TestPanel â€” canvas-based stroke drawing with live projection
// ---------------------------------------------------------------------------

interface TestPanelProps {
  imageUrl: string | null;
  side: "src" | "tgt";
  label: string;
  /** Strokes drawn ON this panel (natural px) */
  ownStrokes: number[][][];
  /** Strokes projected FROM the other panel (natural px) */
  projectedStrokes: number[][][];
  onStrokeComplete: (side: "src" | "tgt", stroke: number[][]) => void;
}

function TestPanel({ imageUrl, side, label, ownStrokes, projectedStrokes, onStrokeComplete }: TestPanelProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const currentStroke = useRef<number[][]>([]);
  const [, forceUpdate] = useState(0);

  const getScale = () => {
    if (!imgRef.current || !imgRef.current.complete || !imgRef.current.naturalWidth) return 1;
    return imgRef.current.getBoundingClientRect().width / imgRef.current.naturalWidth;
  };

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !img.complete || !img.naturalWidth) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scale = getScale();
    const dpr = window.devicePixelRatio || 1;
    const dispW = img.getBoundingClientRect().width;
    const dispH = img.getBoundingClientRect().height;
    canvas.style.width = `${dispW}px`;
    canvas.style.height = `${dispH}px`;
    canvas.width = dispW * dpr;
    canvas.height = dispH * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, dispW, dispH);

    const drawPolyline = (stroke: number[][], color: string, dash: number[]) => {
      if (stroke.length < 2) return;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash(dash);
      ctx.moveTo(stroke[0][0] * scale, stroke[0][1] * scale);
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(stroke[i][0] * scale, stroke[i][1] * scale);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    // Own strokes â€” coral solid
    for (const s of ownStrokes) drawPolyline(s, "#f38ba8", []);
    if (currentStroke.current.length > 1) drawPolyline(currentStroke.current, "#f38ba8", []);
    // Projected strokes â€” blue dashed
    for (const s of projectedStrokes) drawPolyline(s, "#89b4fa", [6, 4]);
  }, [ownStrokes, projectedStrokes]);

  useEffect(() => { redraw(); }, [redraw]);

  const toNatural = (e: React.MouseEvent) => {
    const img = imgRef.current;
    if (!img || !img.complete) return null;
    const rect = img.getBoundingClientRect();
    const rx = e.clientX - rect.left;
    const ry = e.clientY - rect.top;
    if (rx < 0 || ry < 0 || rx > rect.width || ry > rect.height) return null;
    return [rx / rect.width * img.naturalWidth, ry / rect.height * img.naturalHeight];
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const pt = toNatural(e);
    if (!pt) return;
    drawing.current = true;
    currentStroke.current = [pt];
    redraw();
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drawing.current) return;
    const pt = toNatural(e);
    if (!pt) return;
    currentStroke.current.push(pt);
    redraw();
  };
  const onMouseUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (currentStroke.current.length > 1) {
      onStrokeComplete(side, [...currentStroke.current]);
    }
    currentStroke.current = [];
    redraw();
  };

  if (!imageUrl) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center bg-muted rounded-md text-sm text-muted-foreground h-60">
        No image loaded
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1 flex-1 min-w-0 min-h-0">
      <span className="text-xs font-medium text-muted-foreground shrink-0">{label}</span>
      <div
        ref={containerRef}
        className="flex-1 min-h-0 relative overflow-hidden rounded-md border border-border select-none"
        style={{ cursor: "crosshair", minHeight: 480 }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          alt={label}
          className="w-full h-full object-contain"
          draggable={false}
          onLoad={() => { forceUpdate(n => n + 1); redraw(); }}
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 pointer-events-none"
          style={{ objectFit: "contain" }}
        />
        <div className="absolute bottom-1 left-2 text-[10px] text-white/60 pointer-events-none">
          <span style={{ color: "#f38ba8" }}>â”</span> drawn &nbsp;
          <span style={{ color: "#89b4fa" }}>â•Œ</span> projected
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CalibrationDialog
// ---------------------------------------------------------------------------

export function CalibrationDialog({
  open,
  onOpenChange,
  datasetId,
  collections,
  onCalibrationSaved,
}: CalibrationDialogProps) {
  const { api } = useApi();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"calibrate" | "test">("calibrate");

  // â”€â”€ Collection selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [srcCollId, setSrcCollId] = useState<string>("");
  const [tgtCollId, setTgtCollId] = useState<string>("");

  // â”€â”€ Images for both tabs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [srcImageUrl, setSrcImageUrl] = useState<string | null>(null);
  const [tgtImageUrl, setTgtImageUrl] = useState<string | null>(null);
  const [currentImageName, setCurrentImageName] = useState<string | null>(null);

  // â”€â”€ Calibrate tab state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [confirmedPairs, setConfirmedPairs] = useState<PointPair[]>([]);
  const [pendingSrc, setPendingSrc] = useState<{ x: number; y: number } | null>(null);
  const [pendingTgt, setPendingTgt] = useState<{ x: number; y: number } | null>(null);
  // Probe: projected crosshair shown on each side after calibration is computed
  const [probeSrc, setProbeSrc] = useState<{ x: number; y: number } | null>(null);
  const [probeTgt, setProbeTgt] = useState<{ x: number; y: number } | null>(null);
  // Computed homography (before/after save) â€” enables live hover projection
  const [computedH, setComputedH] = useState<number[][] | null>(null);
  const [computedHInv, setComputedHInv] = useState<number[][] | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [isComputing, setIsComputing] = useState(false);
  const [validation, setValidation] = useState<{
    mean_error: number;
    max_error: number;
    quality: string;
    recommendation: string;
    inliers: number;
    outliers: number;
  } | null>(null);

  // â”€â”€ Test tab state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [strokesSrc, setStrokesSrc] = useState<number[][][]>([]);
  const [strokesTgt, setStrokesTgt] = useState<number[][][]>([]);

  // â”€â”€ Derived â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const srcCollection = collections.find((c) => String(c.id) === srcCollId);
  const tgtCollection = collections.find((c) => String(c.id) === tgtCollId);
  const collectionsWithImages = collections.filter((c) => c.images.length > 0);
  const canPickImages = srcCollId && tgtCollId && srcCollId !== tgtCollId;

  // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const loadRandomImages = useCallback(() => {
    if (!srcCollection || !tgtCollection) return;
    setIsLoadingImages(true);
    const tgtFileNames = new Set(tgtCollection.images.map((img) => img.fileName));
    const shared = srcCollection.images.filter((img) => tgtFileNames.has(img.fileName));
    if (shared.length > 0) {
      const chosen = pickRandom(shared, 1)[0];
      const tgtImg = tgtCollection.images.find((img) => img.fileName === chosen.fileName)!;
      setSrcImageUrl(chosen.url);
      setTgtImageUrl(tgtImg.url);
      setCurrentImageName(chosen.fileName);
    } else {
      const srcImg = pickRandom(srcCollection.images, 1)[0];
      const tgtImg = pickRandom(tgtCollection.images, 1)[0];
      setSrcImageUrl(srcImg?.url ?? null);
      setTgtImageUrl(tgtImg?.url ?? null);
      setCurrentImageName(null);
    }
    setPendingSrc(null);
    setPendingTgt(null);
    setProbeSrc(null);
    setProbeTgt(null);
    setIsLoadingImages(false);
  }, [srcCollection, tgtCollection]);

  useEffect(() => {
    if (srcCollId && tgtCollId && srcCollId !== tgtCollId) loadRandomImages();
  }, [srcCollId, tgtCollId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) {
      setConfirmedPairs([]);
      setPendingSrc(null);
      setPendingTgt(null);
      setProbeSrc(null);
      setProbeTgt(null);
      setComputedH(null);
      setComputedHInv(null);
      setValidation(null);
      setSrcCollId("");
      setTgtCollId("");
      setSrcImageUrl(null);
      setTgtImageUrl(null);
      setCurrentImageName(null);
      setStrokesSrc([]);
      setStrokesTgt([]);
      setActiveTab("calibrate");
    }
  }, [open]);

  // â”€â”€ Point click handler (free-side pairing) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handlePointClick = useCallback(
    (side: "src" | "tgt", x: number, y: number) => {
      // If calibration is already computed, clicks just probe; don't add new pairs
      if (computedH) return;

      if (side === "src") {
        if (pendingTgt) {
          // Complete the pair: tgt was pending, now src arrives
          setConfirmedPairs((prev) => [
            ...prev,
            { src_x: x, src_y: y, tgt_x: pendingTgt.x, tgt_y: pendingTgt.y },
          ]);
          setPendingTgt(null);
          setValidation(null);
        } else {
          setPendingSrc({ x, y });
        }
      } else {
        if (pendingSrc) {
          // Complete pair: src was pending, now tgt arrives
          setConfirmedPairs((prev) => [
            ...prev,
            { src_x: pendingSrc.x, src_y: pendingSrc.y, tgt_x: x, tgt_y: y },
          ]);
          setPendingSrc(null);
          setValidation(null);
        } else {
          setPendingTgt({ x, y });
        }
      }
    },
    [pendingSrc, pendingTgt, computedH],
  );

  // â”€â”€ Hover projection handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handlePanelMouseMove = useCallback(
    (side: "src" | "tgt", x: number, y: number) => {
      if (!computedH || !computedHInv) return;
      if (side === "src") {
        const proj = applyHomography(computedH, x, y);
        setProbeSrc({ x, y });
        setProbeTgt(proj);
      } else {
        const proj = applyHomography(computedHInv, x, y);
        setProbeTgt({ x, y });
        setProbeSrc(proj);
      }
    },
    [computedH, computedHInv],
  );

  // â”€â”€ Compute calibration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handleComputeCalibration = async () => {
    if (!api) return;
    if (confirmedPairs.length < 4) {
      toast({
        title: "Not enough points",
        description: `Need at least 4 pairs. Currently have ${confirmedPairs.length}.`,
        variant: "destructive",
      });
      return;
    }
    if (!srcCollId || !tgtCollId) return;
    setIsComputing(true);
    setValidation(null);
    try {
      const response = await api.saveCalibration(
        datasetId, parseInt(srcCollId), parseInt(tgtCollId), confirmedPairs,
      );
      if (!response.success) throw new Error((response as any).error || "Failed");
      const val = (response.data as any)?.validation || {};
      const h = (response.data as any)?.homography as number[][] | undefined;
      const hInv = (response.data as any)?.homography_inv as number[][] | undefined;
      if (h) setComputedH(h);
      if (hInv) setComputedHInv(hInv);

      const meanError = val.mean_reprojection_error_px || 0;
      const maxError = val.max_reprojection_error_px || 0;
      const inliers = val.inliers || confirmedPairs.length;
      const outliers = val.outliers || 0;
      let quality = "unknown", recommendation = "";
      if (meanError < 5) { quality = "excellent"; recommendation = "Highly accurate. Safe for precise alignment."; }
      else if (meanError < 15) { quality = "good"; recommendation = "Acceptable for most use cases."; }
      else if (meanError < 30) { quality = "fair"; recommendation = "Add more points from different image pairs for better accuracy."; }
      else { quality = "poor"; recommendation = "High error. Check points or add 10â€“15 more from varied scenes."; }
      setValidation({ mean_error: meanError, max_error: maxError, quality, recommendation, inliers, outliers });
      toast({ title: "Calibration computed", description: `Quality: ${quality}. Mean error: ${meanError.toFixed(1)}px â€” hover over images to test projection.` });
    } catch (err: any) {
      toast({ title: "Calibration failed", description: err.message || "Unknown error", variant: "destructive" });
    } finally {
      setIsComputing(false);
    }
  };

  // â”€â”€ Save calibration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handleSave = async () => {
    if (!api) return;
    if (confirmedPairs.length < 4) {
      toast({ title: "Not enough points", description: `Need at least 4 pairs.`, variant: "destructive" });
      return;
    }
    if (!srcCollId || !tgtCollId) return;
    setIsSaving(true);
    try {
      const response = await api.saveCalibration(
        datasetId, parseInt(srcCollId), parseInt(tgtCollId), confirmedPairs,
      );
      if (!response.success) throw new Error((response as any).error || "Failed");
      const val = (response.data as any)?.validation || {};
      const meanError = val.mean_reprojection_error_px;
      const inliers = val.inliers || confirmedPairs.length;
      const outliers = val.outliers || 0;
      let desc = `Saved with ${inliers}/${confirmedPairs.length} inlier points.`;
      if (meanError !== undefined) desc += ` Mean error: ${meanError}px.`;
      if (outliers > 0) desc += ` (${outliers} outlier${outliers > 1 ? "s" : ""} removed)`;
      toast({ title: "Calibration saved", description: desc });
      onCalibrationSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message || "Unknown error", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  // â”€â”€ Test tab stroke handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handleStrokeComplete = useCallback((side: "src" | "tgt", stroke: number[][]) => {
    if (side === "src") setStrokesSrc((prev) => [...prev, stroke]);
    else setStrokesTgt((prev) => [...prev, stroke]);
  }, []);

  // Project strokes from src â†’ tgt and tgt â†’ src for the Test tab
  const projectedOnTgt = computedH
    ? strokesSrc.map((stroke) => stroke.map(([x, y]) => { const p = applyHomography(computedH, x, y); return [p.x, p.y]; }))
    : [];
  const projectedOnSrc = computedHInv
    ? strokesTgt.map((stroke) => stroke.map(([x, y]) => { const p = applyHomography(computedHInv, x, y); return [p.x, p.y]; }))
    : [];

  // â”€â”€ Display-point structures for Calibrate tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const srcCommitted = confirmedPairs.map((p, idx) => ({ x: p.src_x, y: p.src_y, colorIdx: idx }));
  const tgtCommitted = confirmedPairs.map((p, idx) => ({ x: p.tgt_x, y: p.tgt_y, colorIdx: idx }));

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-screen h-screen max-w-none max-h-none m-0 rounded-none flex flex-col p-4 gap-0">
        <DialogHeader className="shrink-0 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-primary" />
            Collection Calibration
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-hidden">
          {/* Collection selectors â€” shared between tabs */}
          <div className="flex flex-wrap gap-4 items-end shrink-0">
            <div className="space-y-1 min-w-40">
              <Label className="text-xs">Source collection (left)</Label>
              <Select value={srcCollId} onValueChange={setSrcCollId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selectâ€¦" /></SelectTrigger>
                <SelectContent>
                  {collectionsWithImages.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 min-w-40">
              <Label className="text-xs">Target collection (right)</Label>
              <Select value={tgtCollId} onValueChange={setTgtCollId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selectâ€¦" /></SelectTrigger>
                <SelectContent>
                  {collectionsWithImages.filter((c) => String(c.id) !== srcCollId).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!canPickImages || isLoadingImages}
              onClick={loadRandomImages}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {srcImageUrl ? "Next images" : "Load images"}
            </Button>
            {currentImageName && (
              <Badge variant="outline" className="text-xs font-mono max-w-[260px] truncate self-end">
                {currentImageName}
              </Badge>
            )}
          </div>

          {/* Tabs */}
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "calibrate" | "test")}
            className="flex-1 min-h-0 flex flex-col"
          >
            <TabsList className="shrink-0 mb-2">
              <TabsTrigger value="calibrate" className="gap-1.5">
                <Crosshair className="h-3.5 w-3.5" />
                Calibrate
              </TabsTrigger>
              <TabsTrigger value="test" className="gap-1.5" disabled={!computedH}>
                <Pencil className="h-3.5 w-3.5" />
                Test
              </TabsTrigger>
            </TabsList>

            {/* â”€â”€ Calibrate tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <TabsContent value="calibrate" className="flex-1 min-h-0 flex flex-col gap-3 mt-0">
              {/* Validation metrics */}
              {validation && (
                <div className="border rounded-md p-3 bg-muted/50 text-xs space-y-1.5 shrink-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant={
                        validation.quality === "excellent" ? "default" :
                        validation.quality === "good" ? "secondary" :
                        validation.quality === "fair" ? "outline" : "destructive"
                      }
                    >
                      {validation.quality}
                    </Badge>
                    <span>Mean error: {validation.mean_error.toFixed(1)}px</span>
                    <span>Max: {validation.max_error.toFixed(1)}px</span>
                    <span>{validation.inliers} inliers</span>
                    {validation.outliers > 0 && (
                      <span className="text-amber-500">
                        {validation.outliers} outlier{validation.outliers > 1 ? "s" : ""} removed
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground">{validation.recommendation}</p>
                </div>
              )}

              {/* Step-by-step guide */}
              {(() => {
                const hasCollections = !!canPickImages;
                const hasImages = !!srcImageUrl;
                const enoughPairs = confirmedPairs.length >= 4;
                const hasComputed = !!computedH;

                let current = 1;
                if (activeTab === "test") current = 5;
                else if (hasComputed) current = 5;
                else if (enoughPairs) current = 4;
                else if (hasImages) current = 3;
                else if (hasCollections) current = 2;
                else current = 1;

                const completed = new Set<number>();
                if (hasCollections) completed.add(1);
                if (hasImages) completed.add(2);
                if (enoughPairs) completed.add(3);
                if (hasComputed) completed.add(4);

                const pairsLabel = `${confirmedPairs.length}/4 pairs`;
                const steps: StepDef[] = [
                  {
                    id: 1,
                    label: "Pick collections",
                    hint: "Choose two different collections above to align (e.g. RGB ↔ Thermal).",
                  },
                  {
                    id: 2,
                    label: "Load images",
                    hint: 'Click "Load images" to pull a matching pair. Use "Next images" any time to swap them.',
                  },
                  {
                    id: 3,
                    label: `Mark point pairs (${pairsLabel})`,
                    hint: pendingSrc
                      ? "Now click the matching spot on the RIGHT image to complete the pair."
                      : pendingTgt
                      ? "Now click the matching spot on the LEFT image to complete the pair."
                      : "Click a recognizable spot on one image, then the same spot on the other. Repeat for at least 4 pairs (8–15 from varied scenes is best).",
                  },
                  {
                    id: 4,
                    label: "Compute calibration",
                    hint: enoughPairs
                      ? 'Click "Compute" to fit the alignment. You can keep adding pairs to improve it.'
                      : `Add ${Math.max(0, 4 - confirmedPairs.length)} more pair${4 - confirmedPairs.length === 1 ? "" : "s"} to enable Compute.`,
                  },
                  {
                    id: 5,
                    label: "Verify & save",
                    hint: hasComputed
                      ? "Hover either image to see the projected crosshair. Open the Test tab to draw strokes, then Save when satisfied."
                      : "Once computed, hover the images to verify alignment and use the Test tab before saving.",
                  },
                ];

                return <StepsBar steps={steps} current={current} completed={completed} />;
              })()}

              {/* Image panels */}
              <div className="flex gap-3 flex-1 min-h-0">
                {canPickImages && srcImageUrl ? (
                  <>
                    <div className="flex flex-col items-stretch gap-1 flex-1 min-w-0 min-h-0">
                      <span className="text-xs font-medium text-muted-foreground shrink-0">
                        {srcCollection?.name}
                      </span>
                      <ImagePanel
                        imageUrl={srcImageUrl}
                        side="src"
                        committedPoints={srcCommitted}
                        pendingPoint={pendingSrc}
                        probePoint={probeSrc}
                        onClick={handlePointClick}
                        onMouseMove={handlePanelMouseMove}
                        isActive={computedH ? true : pendingTgt !== null || pendingSrc === null}
                      />
                    </div>
                    <div className="flex flex-col items-stretch gap-1 flex-1 min-w-0 min-h-0">
                      <span className="text-xs font-medium text-muted-foreground shrink-0">
                        {tgtCollection?.name}
                      </span>
                      <ImagePanel
                        imageUrl={tgtImageUrl}
                        side="tgt"
                        committedPoints={tgtCommitted}
                        pendingPoint={pendingTgt}
                        probePoint={probeTgt}
                        onClick={handlePointClick}
                        onMouseMove={handlePanelMouseMove}
                        isActive={computedH ? true : pendingSrc !== null || pendingTgt === null}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground bg-muted rounded-md h-40">
                    {canPickImages
                      ? 'Click "Load images" to begin'
                      : "Select two different collections above"}
                  </div>
                )}
              </div>

              {/* Confirmed pairs list */}
              {confirmedPairs.length > 0 && (
                <div className="border rounded-md p-2 max-h-28 overflow-y-auto shrink-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium">
                      Confirmed pairs ({confirmedPairs.length})
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        setConfirmedPairs([]);
                        setPendingSrc(null);
                        setPendingTgt(null);
                        setValidation(null);
                        setComputedH(null);
                        setComputedHInv(null);
                        setProbeSrc(null);
                        setProbeTgt(null);
                      }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Clear all
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 text-xs text-muted-foreground">
                    <span className="font-medium">Source (px)</span>
                    <span className="font-medium">Target (px)</span>
                    {confirmedPairs.map((p, i) => (
                      <React.Fragment key={i}>
                        <span style={{ color: PAIR_COLOURS[i % PAIR_COLOURS.length] }}>
                          #{i + 1} ({Math.round(p.src_x)}, {Math.round(p.src_y)})
                        </span>
                        <span style={{ color: PAIR_COLOURS[i % PAIR_COLOURS.length] }}>
                          ({Math.round(p.tgt_x)}, {Math.round(p.tgt_y)})
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            {/* â”€â”€ Test tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
            <TabsContent value="test" className="flex-1 min-h-0 flex flex-col gap-3 mt-0">
              {!computedH ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground bg-muted/50 rounded-md">
                  Compute a calibration first in the Calibrate tab.
                </div>
              ) : (
                <div className="flex gap-3 flex-1 min-h-0">
                  <TestPanel
                    imageUrl={srcImageUrl}
                    side="src"
                    label={srcCollection?.name ?? "Source"}
                    ownStrokes={strokesSrc}
                    projectedStrokes={projectedOnSrc}
                    onStrokeComplete={handleStrokeComplete}
                  />
                  <TestPanel
                    imageUrl={tgtImageUrl}
                    side="tgt"
                    label={tgtCollection?.name ?? "Target"}
                    ownStrokes={strokesTgt}
                    projectedStrokes={projectedOnTgt}
                    onStrokeComplete={handleStrokeComplete}
                  />
                </div>
              )}
              {(strokesSrc.length > 0 || strokesTgt.length > 0) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 self-start gap-1.5"
                  onClick={() => { setStrokesSrc([]); setStrokesTgt([]); }}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Clear strokes
                </Button>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter className="gap-2 shrink-0 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="secondary"
            onClick={handleComputeCalibration}
            disabled={isComputing || confirmedPairs.length < 4 || !srcCollId || !tgtCollId}
          >
            {isComputing ? "Computingâ€¦" : "Compute Calibration"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || confirmedPairs.length < 4 || !srcCollId || !tgtCollId}
          >
            {isSaving ? "Savingâ€¦" : "Save Calibration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
