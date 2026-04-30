/**
 * CompanionLayersPanel
 *
 * Read-only side-by-side companion view for the segmentation annotation page.
 *
 * Concept:
 *  - User annotates ONCE on the main canvas (the "primary" collection).
 *  - This panel shows the SAME logical image (matched by filename / groupId)
 *    from one or more OTHER collections, with the same annotations overlaid.
 *  - Annotations are drawn directly in image-pixel space; the canvas is sized
 *    to the companion image's natural dimensions and scaled with `object-contain`.
 *  - If the companion image's resolution differs from the primary image and
 *    no calibration exists between the two collections, we surface a warning
 *    inviting the user to calibrate. We do NOT silently distort coordinates.
 *
 * The user picks which collections appear via a multi-select checkbox menu in
 * the header, and can drag the divider between panels to resize.
 */
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Layers,
  AlertTriangle,
  Eye,
  EyeOff,
  ChevronDown,
  Crosshair,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { Image, ImageCollection } from "@/types";
import type { AnnotationShape } from "@/pages/ImageAnnotation";

// ---------------------------------------------------------------------------
// Helpers — duplicated locally so the panel stays self-contained. They mirror
// the same logic used in ImageAnnotation.tsx so matching behaves identically.
// ---------------------------------------------------------------------------

function baseNameNoExt(fileName: string): string {
  if (!fileName.includes(".")) return fileName.toLowerCase();
  return fileName.slice(0, fileName.lastIndexOf(".")).toLowerCase();
}

function findCorrespondingImage(
  collection: ImageCollection,
  imageName: string,
  reference: Image | null,
): Image | null {
  const exact = collection.images.find((img) => img.fileName === imageName);
  if (exact) return exact;
  const target = baseNameNoExt(imageName);
  const byBase = collection.images.find(
    (img) => baseNameNoExt(img.fileName ?? "") === target,
  );
  if (byBase) return byBase;
  if (reference?.groupId) {
    const gid = reference.groupId;
    const byGroup = collection.images.find(
      (img) => img.groupId && img.groupId === gid,
    );
    if (byGroup) return byGroup;
  }
  return null;
}

function hasCalibrationBetween(
  calibrations: any[],
  aId: string | number,
  bId: string | number,
): boolean {
  const a = String(aId);
  const b = String(bId);
  return calibrations.some((c) => {
    const src = String(c.source_collection_id ?? c.sourceCollectionId ?? "");
    const tgt = String(c.target_collection_id ?? c.targetCollectionId ?? "");
    return (src === a && tgt === b) || (src === b && tgt === a);
  });
}

// ---------------------------------------------------------------------------
// Single companion canvas — renders one image + annotation overlay
// ---------------------------------------------------------------------------

interface CompanionCanvasProps {
  collection: ImageCollection;
  primaryImage: Image | null;
  imageName: string;
  annotations: AnnotationShape[];
  /** Primary image's natural dimensions, used to detect resolution mismatch. */
  primaryDims: { width: number; height: number } | null;
  hasCalibration: boolean;
  projectId?: string | null;
  onMakePrimary?: () => void;
}

function CompanionCanvas({
  collection,
  primaryImage,
  imageName,
  annotations,
  primaryDims,
  hasCalibration,
  projectId,
  onMakePrimary,
}: CompanionCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imgDims, setImgDims] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [imgLoadError, setImgLoadError] = useState(false);
  // User-toggleable calibration state for this companion. Defaults to ON
  // whenever a calibration entry exists between the two collections.
  const [calibrationOn, setCalibrationOn] = useState<boolean>(hasCalibration);
  // Re-sync if the underlying calibration availability changes.
  useEffect(() => {
    setCalibrationOn(hasCalibration);
  }, [hasCalibration]);

  const corresponding = useMemo(
    () => findCorrespondingImage(collection, imageName, primaryImage),
    [collection, imageName, primaryImage],
  );

  // Reset on image change
  useEffect(() => {
    setImgDims(null);
    setImgLoadError(false);
  }, [corresponding?.url]);

  // Draw annotations in image-pixel space
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgDims) return;
    canvas.width = imgDims.width;
    canvas.height = imgDims.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    annotations.forEach((ann) => {
      if (!ann.visible) return;
      ctx.strokeStyle = ann.color || "#22d3ee";
      ctx.fillStyle = (ann.color || "#22d3ee") + "33";
      ctx.lineWidth = Math.max(1.5, imgDims.width / 600);

      if (ann.type === "rectangle" && ann.points.length >= 2) {
        const [a, b] = ann.points;
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const w = Math.abs(b.x - a.x);
        const h = Math.abs(b.y - a.y);
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.stroke();
      } else if (ann.type === "circle" && ann.points.length >= 2) {
        const [c, edge] = ann.points;
        const r = Math.hypot(edge.x - c.x, edge.y - c.y);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (ann.type === "polygon" && ann.points.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(ann.points[0].x, ann.points[0].y);
        for (let i = 1; i < ann.points.length; i++) {
          ctx.lineTo(ann.points[i].x, ann.points[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    });
  }, [annotations, imgDims]);

  const dimsMismatch =
    !!imgDims &&
    !!primaryDims &&
    (imgDims.width !== primaryDims.width || imgDims.height !== primaryDims.height);

  // Empty / missing-image states
  if (!corresponding) {
    return (
      <div className="h-full flex flex-col">
        <CompanionHeader name={collection.name} onMakePrimary={onMakePrimary} />
        <div className="flex-1 flex items-center justify-center text-center text-sm text-muted-foreground p-4">
          <div>
            <div className="text-2xl mb-2">📷</div>
            <div className="font-medium">No matching image</div>
            <div className="text-xs mt-1">
              "{imageName}" is not present in {collection.name}.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-muted/20">
      <CompanionHeader
        name={collection.name}
        count={collection.images.length}
        hasCalibration={hasCalibration}
        calibrationOn={calibrationOn}
        onToggleCalibration={
          hasCalibration ? () => setCalibrationOn((v) => !v) : undefined
        }
        onMakePrimary={onMakePrimary}
      />

      {/* Resolution-mismatch warning — shown whenever dims differ AND calibration
          is not actively compensating (either no calibration available, or user
          toggled it off via the header chip). */}
      {dimsMismatch && !(hasCalibration && calibrationOn) && (
        <div className="m-2 p-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 text-xs flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-yellow-600 dark:text-yellow-400 shrink-0" />
          <div className="space-y-1">
            <div className="font-medium text-foreground">
              Resolution differs from main image
            </div>
            <div className="text-muted-foreground">
              {primaryDims!.width}×{primaryDims!.height} vs {imgDims!.width}×
              {imgDims!.height}.{" "}
              {hasCalibration ? (
                <>Calibration is available — turn it on in the header to align overlays.</>
              ) : (
                <>
                  Annotations are drawn in pixel space — to align them across
                  collections you need to{" "}
                  <Link
                    to="/help/collection-calibration"
                    className="text-primary hover:underline font-medium"
                  >
                    calibrate
                  </Link>{" "}
                  the two collections.
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 relative overflow-hidden">
        {imgLoadError ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Failed to load {corresponding.fileName}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-2">
            <div className="relative max-w-full max-h-full">
              <img
                ref={imgRef}
                src={corresponding.url}
                alt={corresponding.fileName || "companion"}
                crossOrigin="anonymous"
                className="block max-w-full max-h-full object-contain"
                onLoad={(e) => {
                  const el = e.currentTarget;
                  setImgDims({
                    width: el.naturalWidth,
                    height: el.naturalHeight,
                  });
                }}
                onError={() => setImgLoadError(true)}
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompanionHeader({
  name,
  count,
  hasCalibration,
  calibrationOn,
  onToggleCalibration,
  onMakePrimary,
}: {
  name: string;
  count?: number;
  hasCalibration?: boolean;
  calibrationOn?: boolean;
  onToggleCalibration?: () => void;
  onMakePrimary?: () => void;
}) {
  return (
    <div className="px-3 py-2 border-b bg-card/60 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
        <span className="text-sm font-semibold truncate">{name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onMakePrimary && (
          <button
            type="button"
            onClick={onMakePrimary}
            className="inline-flex items-center gap-1 text-[10px] font-medium rounded-md px-2 py-0.5 whitespace-nowrap border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Make this the primary (editable) layer"
          >
            Make primary
          </button>
        )}
        {hasCalibration && onToggleCalibration && (
          <button
            type="button"
            onClick={onToggleCalibration}
            className={`inline-flex items-center gap-1 text-[10px] font-medium rounded-md px-2 py-0.5 whitespace-nowrap border transition-colors ${
              calibrationOn
                ? "text-primary bg-primary/10 border-primary/30 hover:bg-primary/20"
                : "text-muted-foreground bg-muted border-border hover:bg-muted/80"
            }`}
            title={
              calibrationOn
                ? "Calibration is ON — click to disable"
                : "Calibration is OFF — click to enable"
            }
          >
            <Crosshair className="h-3 w-3" />
            {calibrationOn ? "Calibration ON" : "Calibration OFF"}
          </button>
        )}
        {typeof count === "number" && (
          <span className="text-[10px] text-muted-foreground">
            {count} {count === 1 ? "image" : "images"}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public panel — toolbar + resizable companion canvases
// ---------------------------------------------------------------------------

interface CompanionLayersPanelProps {
  /** All collections in the dataset. */
  collections: ImageCollection[];
  /** The collection the user is annotating in (excluded from companions). */
  primaryCollectionId: string;
  /** The image currently open in the main editor. */
  primaryImage: Image | null;
  /** Logical image name driving navigation (e.g. "0001.jpg"). */
  imageName: string;
  /** Shared annotations from the main editor. */
  annotations: AnnotationShape[];
  /** Calibration entries from the backend. */
  calibrations: any[];
  projectId?: string | null;
  /** Promote a collection to primary (drives the main canvas). */
  onSetPrimary?: (collectionId: string) => void;
  /** Called when the user clicks the X to close the entire companion panel. */
  onClose?: () => void;
  /** Navigate the main image — these drive both primary canvas and companions. */
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
}

const STORAGE_KEY = "annotation-companion-selected-v1";

export function CompanionLayersPanel({
  collections,
  primaryCollectionId,
  primaryImage,
  imageName,
  annotations,
  calibrations,
  projectId,
  onSetPrimary,
  onClose,
}: CompanionLayersPanelProps) {
  // Available companions = every collection except the one being annotated
  const available = useMemo(
    () =>
      collections.filter((c) => String(c.id) !== String(primaryCollectionId)),
    [collections, primaryCollectionId],
  );

  // Persist selection across navigations within a session
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
    } catch {}
  }, [selectedIds]);

  // Drop selections that no longer exist
  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) => available.some((c) => String(c.id) === id)),
    );
  }, [available]);

  const selected = useMemo(
    () => available.filter((c) => selectedIds.includes(String(c.id))),
    [available, selectedIds],
  );

  // Hide entirely when there's nothing to compare against
  if (available.length === 0) return null;

  const primaryDims =
    primaryImage && primaryImage.width && primaryImage.height
      ? { width: primaryImage.width, height: primaryImage.height }
      : null;

  const toggle = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="h-full flex flex-col border-l bg-background min-w-[260px]">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2 bg-card/40">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-primary" />
          Companion layers
        </div>
        <div className="flex items-center gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                {selected.length === 0
                  ? "Show layers"
                  : `${selected.length} shown`}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
            <div className="text-xs font-medium text-muted-foreground px-2 pb-1">
              Choose primary & companion layers
            </div>
            <div className="text-[10px] text-muted-foreground px-2 pb-2">
              Radio = primary (editable). Checkbox = shown alongside.
            </div>
            <div className="space-y-1 max-h-72 overflow-auto">
              {collections.map((c) => {
                const id = String(c.id);
                const isPrimary = String(primaryCollectionId) === id;
                const checked = selectedIds.includes(id);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent"
                  >
                    <input
                      type="radio"
                      name="primary-layer"
                      checked={isPrimary}
                      disabled={!onSetPrimary}
                      onChange={() => onSetPrimary?.(id)}
                      className="h-3.5 w-3.5 accent-primary cursor-pointer"
                      title="Set as primary (editable) layer"
                    />
                    <span className="text-sm flex-1 truncate">
                      {c.name}
                      {isPrimary && (
                        <span className="ml-1.5 text-[10px] text-primary font-medium">
                          primary
                        </span>
                      )}
                    </span>
                    {isPrimary ? (
                      <span className="text-[10px] text-muted-foreground/60 px-1">
                        editing
                      </span>
                    ) : (
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(id)}
                        />
                        {checked ? (
                          <Eye className="h-3.5 w-3.5 text-primary" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5 text-muted-foreground/50" />
                        )}
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            {available.length > 0 && (
              <div className="border-t mt-2 pt-2 flex justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setSelectedIds([])}
                >
                  Hide all
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    setSelectedIds(available.map((c) => String(c.id)))
                  }
                >
                  Show all
                </Button>
              </div>
            )}
          </PopoverContent>
          </Popover>
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={onClose}
              title="Close companion panel"
              aria-label="Close companion panel"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Body */}
      {selected.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-center p-4 text-sm text-muted-foreground">
          <div>
            <Layers className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <div className="font-medium">No companion layers shown</div>
            <div className="text-xs mt-1">
              Pick collections above to view them side-by-side with shared
              annotations.
            </div>
          </div>
        </div>
      ) : (
        <ResizablePanelGroup
          direction={selected.length > 1 ? "vertical" : "horizontal"}
          className="flex-1"
        >
          {selected.map((c, i) => {
            const calibrated = hasCalibrationBetween(
              calibrations,
              primaryCollectionId,
              c.id,
            );
            return (
              <React.Fragment key={String(c.id)}>
                {i > 0 && <ResizableHandle withHandle />}
                <ResizablePanel defaultSize={100 / selected.length} minSize={15}>
                  <CompanionCanvas
                    collection={c}
                    primaryImage={primaryImage}
                    imageName={imageName}
                    annotations={annotations}
                    primaryDims={primaryDims}
                    hasCalibration={calibrated}
                    projectId={projectId}
                    onMakePrimary={
                      onSetPrimary
                        ? () => onSetPrimary(String(c.id))
                        : undefined
                    }
                  />
                </ResizablePanel>
              </React.Fragment>
            );
          })}
        </ResizablePanelGroup>
      )}
    </div>
  );
}
