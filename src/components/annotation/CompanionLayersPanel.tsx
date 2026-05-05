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
 *  - If the companion image's resolution differs from the primary image,
 *    we surface a short notice so the user understands overlays may not match
 *    visually unless calibration is enabled. We do NOT silently distort coordinates.
 *
 * The user picks which collections appear via a multi-select checkbox menu in
 * the header, and can drag the divider between panels to resize.
 */
import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Layers,
  AlertTriangle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  X,
  Copy,
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

/** Return the calibration entry between two collections, or null if none exists. */
function getCalibrationEntry(
  calibrations: any[],
  aId: string | number,
  bId: string | number,
): any | null {
  const a = String(aId);
  const b = String(bId);
  return (
    calibrations.find((c) => {
      const src = String(c.source_collection_id ?? c.sourceCollectionId ?? "");
      const tgt = String(c.target_collection_id ?? c.targetCollectionId ?? "");
      return (src === a && tgt === b) || (src === b && tgt === a);
    }) ?? null
  );
}

/** Apply a 3×3 homography matrix H (row-major nested array) to a point. */
function applyHomography(
  H: number[][],
  x: number,
  y: number,
): { x: number; y: number } {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return {
    x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
  };
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
  /** Full calibration entry between the primary collection and this companion. */
  calibrationEntry: any | null;
  /** ID of the primary (annotating) collection, used to determine homography direction. */
  primaryCollectionId: string;
  /**
   * COCO image dimensions for the current image in the primary collection.
   * When annotation points were loaded from an API annotation file they are in
   * COCO pixel-space (imageWidth × imageHeight).  We must scale them back to
   * primary-image natural-pixel-space before applying the calibration homography.
   * If null / equal to primary natural dims, no scaling is needed.
   */
  primaryCocoDims: { width: number; height: number } | null;
  projectId?: string | null;
}

function CompanionCanvas({
  collection,
  primaryImage,
  imageName,
  annotations,
  primaryDims,
  hasCalibration,
  calibrationEntry,
  primaryCollectionId,
  primaryCocoDims,
  projectId,
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

  // Draw annotations in image-pixel space, applying homography when calibration is on.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgDims) return;
    canvas.width = imgDims.width;
    canvas.height = imgDims.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Build a point transformer: when calibration is active, project primary-space
    // coordinates into companion-image-space using the stored homography.
    const shouldTransform = calibrationOn && !!calibrationEntry;
    let H: number[][] | null = null;
    if (shouldTransform) {
      // Determine which direction the homography maps.
      // homography       = maps source_collection → target_collection
      // homography_inv   = maps target_collection → source_collection
      // We want:         primary_collection → companion_collection
      const srcId = String(
        calibrationEntry.source_collection_id ??
          calibrationEntry.sourceCollectionId ??
          "",
      );
      H =
        srcId === primaryCollectionId
          ? (calibrationEntry.homography ?? null)      // primary IS source → H maps primary→companion
          : (calibrationEntry.homography_inv ?? null);  // primary IS target → H_inv maps primary→companion

      if (!H) {
        console.warn(
          "[CompanionCanvas] calibrationEntry present but homography matrix missing – falling back to no-transform",
          calibrationEntry,
        );
      } else {
        console.debug(
          "[CompanionCanvas] using",
          srcId === primaryCollectionId ? "homography" : "homography_inv",
          "for primary=", primaryCollectionId, "companion.id=", String(collection.id),
          "calibration src=", srcId, "tgt=", String(calibrationEntry.target_collection_id ?? ""),
        );
      }
    }

    // COCO→natural-pixel scaling for the primary image.
    // Annotations loaded from API are stored in COCO image space (imageWidth × imageHeight).
    // When that differs from the image's natural pixel dimensions (primaryDims), we need
    // to scale the stored coords to natural-pixel space before applying the homography.
    let cocoScaleX = 1;
    let cocoScaleY = 1;
    if (primaryCocoDims && primaryDims) {
      if (
        primaryCocoDims.width > 0 &&
        primaryCocoDims.height > 0 &&
        primaryDims.width > 0 &&
        primaryDims.height > 0 &&
        (primaryCocoDims.width !== primaryDims.width ||
          primaryCocoDims.height !== primaryDims.height)
      ) {
        cocoScaleX = primaryDims.width / primaryCocoDims.width;
        cocoScaleY = primaryDims.height / primaryCocoDims.height;
      }
    }

    /**
     * Transform a point from annotation-storage space (primary collection pixel space,
     * potentially COCO-scaled) to companion-image pixel space.
     * Returns null only if H is present but the computation produces NaN/Infinity.
     */
    const transformPt = (
      pt: { x: number; y: number },
    ): { x: number; y: number } | null => {
      // Step 1: COCO→natural-pixel scaling
      const nx = pt.x * cocoScaleX;
      const ny = pt.y * cocoScaleY;
      // Step 2: homography to companion space (when calibration active)
      if (!H) return { x: nx, y: ny };
      const result = applyHomography(H, nx, ny);
      if (!isFinite(result.x) || !isFinite(result.y)) return null;
      return result;
    };

    /** True if a point is within the companion image boundaries (with a small margin). */
    const MARGIN = 2;
    const inBounds = (pt: { x: number; y: number }): boolean =>
      pt.x >= -MARGIN &&
      pt.y >= -MARGIN &&
      pt.x <= imgDims.width + MARGIN &&
      pt.y <= imgDims.height + MARGIN;

    annotations.forEach((ann) => {
      if (!ann.visible) return;
      ctx.strokeStyle = ann.color || "#22d3ee";
      ctx.fillStyle = (ann.color || "#22d3ee") + "33";
      ctx.lineWidth = Math.max(1.5, imgDims.width / 600);

      if (ann.type === "rectangle" && ann.points.length >= 2) {
        const [a, b] = ann.points;
        // Compute all 4 corners so we can draw a proper quadrilateral after
        // the homography (which won't preserve the rectangle shape).
        const corners = [
          { x: a.x, y: a.y },
          { x: b.x, y: a.y },
          { x: b.x, y: b.y },
          { x: a.x, y: b.y },
        ];
        const tCorners = corners.map(transformPt);
        if (tCorners.some((p) => p === null)) return;
        const pts = tCorners as { x: number; y: number }[];
        // Skip only when ALL transformed corners are outside the image.
        if (!pts.some(inBounds)) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (ann.type === "circle" && ann.points.length >= 2) {
        const [c, edge] = ann.points;
        const tC = transformPt(c);
        const tEdge = transformPt(edge);
        if (!tC || !tEdge) return;
        const r = Math.hypot(tEdge.x - tC.x, tEdge.y - tC.y);
        if (!inBounds(tC)) return; // skip if centre is completely off-screen
        ctx.beginPath();
        ctx.arc(tC.x, tC.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (ann.type === "polygon" && ann.points.length >= 3) {
        const transformed = ann.points.map(transformPt);
        if (transformed.some((p) => p === null)) return;
        const pts = transformed as { x: number; y: number }[];
        // Skip only when every transformed vertex is outside the image.
        if (!pts.some(inBounds)) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    });
  }, [annotations, imgDims, calibrationOn, calibrationEntry, primaryCollectionId, primaryCocoDims, primaryDims, collection.id]);

  const dimsMismatch =
    !!imgDims &&
    !!primaryDims &&
    (imgDims.width !== primaryDims.width || imgDims.height !== primaryDims.height);

  // Empty / missing-image states
  if (!corresponding) {
    return (
      <div className="h-full flex flex-col">
        <CompanionHeader name={collection.name} />
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
              Main image size {primaryDims!.width}×{primaryDims!.height}; this layer is{" "}
              {imgDims!.width}×{imgDims!.height}. Annotation coordinates use the main image pixel
              space, so overlays may not line up exactly when resolutions differ between collections.
              {hasCalibration
                ? " You can enable calibration mapping from the Calibration toggle above when available."
                : null}
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
}: {
  name: string;
  count?: number;
  hasCalibration?: boolean;
  calibrationOn?: boolean;
  onToggleCalibration?: () => void;
}) {
  return (
    <div className="px-3 py-2 border-b bg-card/60 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
        <span className="text-sm font-semibold truncate">{name}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
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
  /**
   * Dataset id used to scope the per-collection annotation storage keys
   * (`annotations_${datasetId}_${collectionId}_${imageName}`). Required for
   * resolving what annotations to render per companion when "duplicate
   * annotations" is OFF (otherwise we'd default to live primary annotations).
   */
  datasetId?: string | number | null;
  /** Shared annotations from the main editor. */
  annotations: AnnotationShape[];
  /** Calibration entries from the backend. */
  calibrations: any[];
  /**
   * COCO image dimensions for the currently-shown image in the primary collection.
   * Annotations loaded from an annotation file are stored in COCO pixel-space;
   * this is needed to scale them back to natural-pixel-space before applying the
   * calibration homography.
   */
  primaryCocoDims?: { width: number; height: number } | null;
  projectId?: string | null;
  /** Called when the user clicks the X to close the entire companion panel. */
  onClose?: () => void;
  /** Navigate the main image — these drive both primary canvas and companions. */
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  /**
   * Notifies the parent which collections should receive a *copy* of every
   * annotation save, so e.g. drawing on RGB also persists annotations under
   * the thermal collection's storage. Toggled per-collection in the picker.
   * The parent handles the actual mirroring (the panel only surfaces the UI
   * + persists the selection).
   */
  onDuplicateChange?: (collectionIds: string[]) => void;
}

const STORAGE_KEY = "annotation-companion-selected-v1";
const DUPLICATE_STORAGE_KEY = "annotation-companion-duplicate-v1";

export function CompanionLayersPanel({
  collections,
  primaryCollectionId,
  primaryImage,
  imageName,
  datasetId,
  annotations,
  calibrations,
  primaryCocoDims,
  projectId,
  onClose,
  onPrev,
  onNext,
  canPrev,
  canNext,
  onDuplicateChange,
}: CompanionLayersPanelProps) {
  // All collections are toggleable in the picker — including the primary,
  // which the user may want to also see in the companion view alongside
  // other layers (e.g. keep RGB visible while editing on RGB).
  const available = useMemo(
    () => collections,
    [collections],
  );

  // Persist selection across navigations within a session
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });

  /**
   * Collections that should receive a mirrored copy of every saved annotation
   * (write-side only — overlays already render via the shared `annotations`
   * prop regardless of this list). Persisted in sessionStorage and pushed up
   * via `onDuplicateChange` so the parent can do the actual mirroring.
   */
  const [duplicateIds, setDuplicateIds] = useState<string[]>(() => {
    try {
      const raw = sessionStorage.getItem(DUPLICATE_STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selectedIds));
    } catch {}
  }, [selectedIds]);

  useEffect(() => {
    try {
      sessionStorage.setItem(DUPLICATE_STORAGE_KEY, JSON.stringify(duplicateIds));
    } catch {}
    onDuplicateChange?.(duplicateIds);
  }, [duplicateIds, onDuplicateChange]);

  // Drop selections that no longer exist
  useEffect(() => {
    setSelectedIds((prev) =>
      prev.filter((id) => available.some((c) => String(c.id) === id)),
    );
    setDuplicateIds((prev) =>
      prev.filter(
        (id) =>
          available.some((c) => String(c.id) === id) &&
          String(primaryCollectionId) !== id,
      ),
    );
  }, [available, primaryCollectionId]);

  const selected = useMemo(
    () => available.filter((c) => selectedIds.includes(String(c.id))),
    [available, selectedIds],
  );

  /**
   * Per-companion annotation resolver.
   *
   * The semantics are:
   *  - The PRIMARY collection (the one being edited) always shows the live
   *    `annotations` from the editor.
   *  - A companion with "duplicate annotations" ON also shows the live
   *    `annotations`, since every save is mirrored into its storage anyway.
   *  - A companion with "duplicate annotations" OFF shows ONLY whatever was
   *    previously persisted for that collection+image. In particular, while
   *    the user annotates on a different primary collection, those edits
   *    must NOT bleed into this companion's overlay.
   *
   * We re-read storage on image / selection / duplicate-toggle changes;
   * within a session the relevant changes either come through the live
   * `annotations` prop (duplicate ON) or are static for this image
   * (duplicate OFF), so we don't need a storage event listener.
   */
  const datasetIdStr =
    datasetId === null || datasetId === undefined ? "" : String(datasetId);
  const companionAnnotationsByCollection = useMemo(() => {
    const result: Record<string, AnnotationShape[]> = {};
    const primaryStr = String(primaryCollectionId);
    for (const c of selected) {
      const cid = String(c.id);
      if (cid === primaryStr || duplicateIds.includes(cid)) {
        result[cid] = annotations;
        continue;
      }
      if (!datasetIdStr || !imageName) {
        result[cid] = [];
        continue;
      }
      try {
        const raw = localStorage.getItem(
          `annotations_${datasetIdStr}_${cid}_${imageName}`,
        );
        result[cid] = raw ? (JSON.parse(raw) as AnnotationShape[]) : [];
      } catch {
        result[cid] = [];
      }
    }
    return result;
  }, [
    selected,
    primaryCollectionId,
    duplicateIds,
    annotations,
    datasetIdStr,
    imageName,
  ]);

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

  const toggleDuplicate = (id: string) => {
    if (String(primaryCollectionId) === id) return; // never mirror onto self
    setDuplicateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <div className="h-full flex flex-col border-l bg-background min-w-[260px]">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b flex items-center justify-between gap-2 bg-card/40">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="h-4 w-4 text-primary" />
          Image collections
        </div>
        <div className="flex items-center gap-1.5">
          {(onPrev || onNext) && (
            <div className="flex items-center gap-0.5 mr-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={onPrev}
                disabled={!onPrev || canPrev === false}
                title="Previous image"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={onNext}
                disabled={!onNext || canNext === false}
                title="Next image"
                aria-label="Next image"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5">
                {selected.length === 0
                  ? "Show layers"
                  : `${selected.length} shown`}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            <div className="text-xs font-medium text-muted-foreground px-2 pb-1">
              Image collections
            </div>
            <div className="text-[10px] text-muted-foreground px-2 pb-2">
              Pick which collections to show alongside the primary canvas. Use the
              copy icon to also save annotations under that collection (e.g. mirror
              RGB drawings onto the thermal collection).
            </div>
            <div className="space-y-1 max-h-72 overflow-auto">
              {collections.map((c) => {
                const id = String(c.id);
                const isPrimary = String(primaryCollectionId) === id;
                const checked = selectedIds.includes(id);
                const isDuplicating = duplicateIds.includes(id);
                return (
                  <div
                    key={id}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded ${
                      isPrimary ? "bg-muted/40" : "hover:bg-accent"
                    }`}
                  >
                    <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(id)}
                      />
                      <span className="text-sm flex-1 truncate">{c.name}</span>
                      {checked ? (
                        <Eye className="h-3.5 w-3.5 text-primary" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5 text-muted-foreground/50" />
                      )}
                    </label>
                    {isPrimary ? (
                      // Duplicate doesn't apply to the collection you're already
                      // annotating in — annotations always save under the primary
                      // collection by definition. Showing a disabled icon here
                      // confused users into thinking they could turn it off.
                      <span
                        className="inline-flex items-center justify-center h-6 px-1.5 rounded text-[10px] font-medium text-primary bg-primary/10 border border-primary/30"
                        title="You are annotating in this collection — saves always go here"
                      >
                        Active
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleDuplicate(id)}
                        className={cn(
                          "inline-flex items-center justify-center h-6 w-6 rounded border transition-colors",
                          isDuplicating &&
                            "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
                          !isDuplicating &&
                            "border-border text-muted-foreground/70 hover:bg-accent hover:text-foreground",
                        )}
                        title={
                          isDuplicating
                            ? "Duplicate ON — annotations are also being saved under this collection. Click to disable."
                            : "Duplicate OFF — annotations are not saved under this collection. Click to mirror saves here."
                        }
                        aria-label="Toggle annotation duplication"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
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
            <div className="font-medium">No image collections shown</div>
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
            const calibEntry = getCalibrationEntry(
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
                    annotations={
                      companionAnnotationsByCollection[String(c.id)] ?? []
                    }
                    primaryDims={primaryDims}
                    hasCalibration={calibrated}
                    calibrationEntry={calibEntry}
                    primaryCollectionId={String(primaryCollectionId)}
                    primaryCocoDims={primaryCocoDims ?? null}
                    projectId={projectId}
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
