import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  ArrowLeft, 
  Save, 
  Trash2, 
  Square, 
  Circle, 
  MousePointer2, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw,
  Download,
  Upload,
  Eye,
  EyeOff,
  Palette,
  Plus,
  Edit,
  Check,
  X,
  Layers,
  ChevronLeft, 
  ChevronRight,
  BarChart,
  Loader2,
  AlertCircle,
  Hexagon,
  Sun,
  Moon,
  Crosshair
} from 'lucide-react';
import { AnnotationMinimap } from '@/components/AnnotationMinimap';
import { AnnotationStatusBar } from '@/components/AnnotationStatusBar';
import { CompanionLayersPanel } from '@/components/annotation/CompanionLayersPanel';
import { useTheme } from '@/components/ThemeProvider';
import { useQuery } from '@tanstack/react-query';
import { API_CONFIG } from '@/config/api';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { toast as sonnerToast } from 'sonner';
import { Image, ImageCollection } from '@/types';

// Annotation types
export type AnnotationTool = 'select' | 'rectangle' | 'circle' | 'polygon' | 'auto-segment';

export interface Point {
  x: number;
  y: number;
}

export interface AnnotationShape {
  id: string;
  type: 'rectangle' | 'circle' | 'polygon';
  points: Point[];
  label: string;
  color: string;
  visible: boolean;
  confidence?: number;
}

export interface AnnotationClass {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  count: number;
}

const DEFAULT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8C471', '#82E0AA', '#F1948A', '#85C1E9', '#D2B4DE'
];

/** Names that indicate a depth/auxiliary layer — avoid defaulting the display to these. */
function isDepthLikeCollectionName(name: string): boolean {
  const n = name.toLowerCase();
  return /\bdepth\b/.test(n) || n.includes('depth map') || n.includes('depth-map');
}

/** Prefer an RGB/color layer for segmentation; otherwise use backend-default or first ordered layer. */
function pickPreferredRgbCollection(collections: ImageCollection[]): ImageCollection | undefined {
  if (collections.length === 0) return undefined;
  const rgbLike = (n: string) => {
    const s = n.toLowerCase();
    return s.includes('rgb') || s.includes('color') || s.includes('visible') || s.includes('original');
  };
  const byName = collections.find(c => rgbLike(c.name) && !isDepthLikeCollectionName(c.name));
  if (byName) return byName;
  const byDefault = collections.find(c => c.is_default === true && !isDepthLikeCollectionName(c.name));
  if (byDefault) return byDefault;
  // If no RGB-like layer exists, lock to the first layer as ordered by backend.
  return collections[0];
}

function baseNameNoExt(fileName: string): string {
  if (!fileName.includes('.')) return fileName.toLowerCase();
  return fileName.slice(0, fileName.lastIndexOf('.')).toLowerCase();
}

/** Match the same frame across layers: exact name, same basename, then shared groupId. */
function findCorrespondingImageInCollection(
  collection: ImageCollection,
  imageName: string,
  referenceImage: Image | null
): Image | null {
  const exact = collection.images.find(img => img.fileName === imageName);
  if (exact) return exact;
  const targetBase = baseNameNoExt(imageName);
  const byBase = collection.images.find(img => baseNameNoExt(img.fileName ?? '') === targetBase);
  if (byBase) return byBase;
  if (referenceImage?.groupId) {
    const gid = referenceImage.groupId;
    const byGroup = collection.images.find(img => img.groupId && img.groupId === gid);
    if (byGroup) return byGroup;
  }
  return null;
}

// Helper function to calculate polygon area similar to OpenCV's contourArea
// This uses the same mathematical approach as cv2.contourArea() in altitude_plant_resolution.py
// Using the Green's theorem / Shoelace formula which OpenCV also uses internally
const calculatePolygonArea = (points: Point[]): number => {
  if (points.length < 3) return 0;
  
  // OpenCV uses the Shoelace formula (also called surveyor's formula)
  // This is the same as cv2.contourArea() for simple polygons
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  
  // Return absolute value and divide by 2 (standard formula)
  // This matches OpenCV's contourArea calculation for non-oriented contours
  return Math.abs(area / 2);
};

// Helper function to format area display
const formatArea = (area: number): string => {
  if (area < 1000) {
    return `${Math.round(area)} px²`;
  } else if (area < 1000000) {
    return `${(area / 1000).toFixed(1)}K px²`;
  } else {
    return `${(area / 1000000).toFixed(1)}M px²`;
  }
};

/**
 * Match dataset image names (API `fileName`) to COCO `images[].file_name`.
 * Mismatches here cause empty canvas while API statistics still show counts.
 */
function findCocoImageForDatasetName(
  cocoImages: Array<{ id?: unknown; file_name?: string | null; width?: number; height?: number }> | undefined,
  datasetFileName: string
): { id?: unknown; file_name?: string | null; width?: number; height?: number } | undefined {
  if (!cocoImages?.length || !datasetFileName) return undefined;

  const exact = cocoImages.find((img) => img.file_name === datasetFileName);
  if (exact) return exact;

  const lower = datasetFileName.toLowerCase();
  const byLower = cocoImages.find((img) => (img.file_name || '').toLowerCase() === lower);
  if (byLower) return byLower;

  const leaf = (s: string) => s.replace(/^.*[/\\]/, '');

  const dsLeaf = leaf(datasetFileName);
  const byLeaf = cocoImages.find((img) => leaf(img.file_name || '') === dsLeaf);
  if (byLeaf) return byLeaf;

  const byLeafCI = cocoImages.find(
    (img) => leaf(img.file_name || '').toLowerCase() === dsLeaf.toLowerCase()
  );
  if (byLeafCI) return byLeafCI;

  const baseNoExt = (s: string) => {
    const x = leaf(s);
    const d = x.lastIndexOf('.');
    return d > 0 ? x.slice(0, d) : x;
  };
  const dsBase = baseNoExt(datasetFileName).toLowerCase();
  return cocoImages.find((img) => baseNoExt(img.file_name || '').toLowerCase() === dsBase);
}

/**
 * Apply a 3×3 homography matrix H to a 2D point.
 * H is stored row-major as [[h00,h01,h02],[h10,h11,h12],[h20,h21,h22]].
 */
function applyHomography(H: number[][], x: number, y: number): { x: number; y: number } {
  const w = H[2][0] * x + H[2][1] * y + H[2][2];
  return {
    x: (H[0][0] * x + H[0][1] * y + H[0][2]) / w,
    y: (H[1][0] * x + H[1][1] * y + H[1][2]) / w,
  };
}

const ImageAnnotation = () => {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { api } = useApi();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();

  // Get annotation ID from URL params if editing existing annotation
  const annotationId = searchParams.get('annotationId');

  // Redirect legacy /datasets/:id/annotate/segmentation to project-scoped URL
  useEffect(() => {
    if (!id || projectId || !api) return;
    let cancelled = false;
    api.getDataset(id).then((res) => {
      if (cancelled || !res.success || !res.data?.project_id) return;
      const q = annotationId ? `?annotationId=${annotationId}` : '';
      navigate(`/projects/${res.data.project_id}/datasets/${id}/annotate/segmentation${q}`, { replace: true });
    });
    return () => { cancelled = true; };
  }, [id, projectId, api, navigate, annotationId]);

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Help popover visibility for zoom/pan instructions
  const [showHelp, setShowHelp] = useState(false);

  // State
  const [imageCollections, setImageCollections] = useState<ImageCollection[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [currentImageName, setCurrentImageName] = useState<string>('');
  const [displayLayer, setDisplayLayer] = useState<string>('');
  const [currentImage, setCurrentImage] = useState<Image | null>(null);
  const [displayImage, setDisplayImage] = useState<Image | null>(null);
  const [noCorrespondingImage, setNoCorrespondingImage] = useState(false);
  // Explicit annotation coordinate layer: when set to a collection id, annotation
  // coordinates are stored in that layer's pixel space and remapped for display/input.
  // Empty string = off (default — no cross-layer scaling).
  const [annotationLayerId, setAnnotationLayerId] = useState<string>('');
  // true only when the display layer is the *target* of a calibration and annotation coords
  // are being remapped via homography from source (annotation) space → display (target) space.
  const [calibrationIsActive, setCalibrationIsActive] = useState(false);
  // User-controlled toggle to enable/disable calibration transform
  const [calibrationEnabled, setCalibrationEnabled] = useState(true);
  // Calibrations loaded from backend (homography-based collection pairs)
  const [calibrations, setCalibrations] = useState<any[]>([]);
  const [allImageNames, setAllImageNames] = useState<string[]>([]);
  const [currentLayerImageNames, setCurrentLayerImageNames] = useState<string[]>([]);
  const [mainLayer, setMainLayer] = useState<string>(''); // The primary layer that drives navigation
  const [isLayerSwitching, setIsLayerSwitching] = useState(false); // Prevent flicker during layer changes
  const layerSwitchCounterRef = useRef(0); // Increment on every layer switch to force image remount
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Track initial load to prevent flickering
  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [annotations, setAnnotations] = useState<AnnotationShape[]>([]);
  const [classes, setClasses] = useState<AnnotationClass[]>([]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [annotationName, setAnnotationName] = useState<string>("");
  const [datasetName, setDatasetName] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");

  // When an annotation is selected (e.g., by clicking on canvas), scroll only the right list container
  useEffect(() => {
    if (!selectedAnnotation) return;
    // Ensure right panel is open so the item is visible
    setRightCollapsed(false);

    // Small timeout to allow the panel to expand and DOM to render
    setTimeout(() => {
      // Find the annotation element first
      const el = document.querySelector(`[data-annotation-id="${selectedAnnotation}"]`) as HTMLElement | null;
      if (!el) {
        console.warn('Selected annotation element not found:', selectedAnnotation);
        return;
      }

      // Find the closest scrollable div that contains this element
      const scrollContainer = el.closest('.overflow-y-auto') as HTMLElement | null;
      if (!scrollContainer) {
        console.warn('Scroll container not found for annotation');
        return;
      }

      // Calculate position relative to the scroll container's visible area
      const elementRect = el.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();

      // Check if the element is already visible
      if (elementRect.top >= containerRect.top && elementRect.bottom <= containerRect.bottom) {
        // Element is already visible, no need to scroll.
        return;
      }
      
      // Calculate scroll position to center the element within the container
      const elementTopInContainer = el.offsetTop - scrollContainer.offsetTop;
      const desiredScrollTop = elementTopInContainer - (scrollContainer.clientHeight / 2) + (el.clientHeight / 2);

      scrollContainer.scrollTo({
        top: desiredScrollTop,
        behavior: 'smooth'
      });
    }, 120);
  }, [selectedAnnotation]);

  // Right sidebar UI: collapsible and resizable
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [rightWidth, setRightWidth] = useState(320); // px
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  // Left sidebar UI: collapsible and resizable
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(320);
  const leftResizingRef = useRef(false);
  const leftStartXRef = useRef(0);
  const leftStartWidthRef = useRef(0);
  const lastLoadedImageRef = useRef<string>(''); // Use ref instead of state to avoid re-renders
  // Always-current image name ref so stale useCallback closures can still access the latest value
  const currentImageNameRef = useRef<string>('');
  // Always-current load function ref so stale callbacks can call the latest version
  const loadAnnotationsForImageRef = useRef<((name: string) => Promise<void>) | null>(null);
  // COCO image dimensions (file_name -> { width, height }) so we can scale loaded coords to actual image space
  const cocoImageDimensionsRef = useRef<Record<string, { width: number; height: number }>>({});
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isMovingAnnotation, setIsMovingAnnotation] = useState(false);
  const [moveOffset, setMoveOffset] = useState({ x: 0, y: 0 });
  // Cursor position in image coordinates for status bar
  const [cursorImagePosition, setCursorImagePosition] = useState<{ x: number; y: number } | null>(null);
  
  // Image scaling
  const [imageScale, setImageScale] = useState(1);
  const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
  
  // Class management
  const [newClassName, setNewClassName] = useState('');
  const [isAddingClass, setIsAddingClass] = useState(false);
  const [editingClassId, setEditingClassId] = useState<string | null>(null);
  const [editingClassName, setEditingClassName] = useState('');
  // Auto-segment preview state
  const [autoSegmentPreview, setAutoSegmentPreview] = useState<{ polygons: Point[][]; maskDataUrl?: string; imageName?: string } | null>(null);
  const [autoSegmentClassId, setAutoSegmentClassId] = useState<string | null>(null);
  // SAM points for interactive segmentation (ref so second click sees latest points before re-render)
  const [samPoints, setSamPoints] = useState<Array<{ x: number; y: number; label: number }>>([]);
  const samPointsRef = useRef<Array<{ x: number; y: number; label: number }>>([]);
  useEffect(() => {
    samPointsRef.current = samPoints;
  }, [samPoints]);
  const [isSamProcessing, setIsSamProcessing] = useState(false);
  const [segmentModel, setSegmentModel] = useState<'sam2' | 'sam3'>('sam2');
  const [segmentTextPrompt, setSegmentTextPrompt] = useState('');

  const { data: sam3Available = false } = useQuery({
    queryKey: ['sam3-available'],
    queryFn: async () => {
      const r = await fetch(`${API_CONFIG.baseUrl}/segment/ready/sam3`);
      return r.ok;
    },
    staleTime: 60 * 1000,
    retry: false,
  });

  // When SAM 3 becomes unavailable, fall back to SAM 2
  useEffect(() => {
    if (!sam3Available && segmentModel === 'sam3') setSegmentModel('sam2');
  }, [sam3Available, segmentModel]);

  // Panel tab state
  const [activePanelTab, setActivePanelTab] = useState<string>('annotations');

   // Auto-save state
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(Date.now());

  // Leave confirmation dialog state
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const pendingNavigationRef = useRef<string | null>(null);

  // Save annotation file dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveAnnotationName, setSaveAnnotationName] = useState('');
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);
  const navigateAfterSaveRef = useRef(false);
  const justSavedRef = useRef(false); // Track when we just saved to prevent reload

  // Delete all annotations confirmation dialog state
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false);

  // Helper function to safely save to localStorage with quota handling
  const safeLocalStorageSet = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, skipping cache');
      } else {
        console.error('Error saving to localStorage:', e);
      }
      return false;
    }
  };

  // Start auto-segmentation via backend SAM only.
  // label: 1 = add to mask (left-click), 0 = remove from mask (right-click).
  const startAutoSegment = useCallback(async (imgPoint: Point, label: number = 1) => {
    if (!displayImage && !currentImage) return;
    const img = (displayImage || currentImage)!;
    const samPoint = { x: imgPoint.x, y: imgPoint.y, label };
    // Use ref so rapid second click includes first point (avoids stale closure)
    const previousPoints = samPointsRef.current;
    const newPoints = [...previousPoints, samPoint];
    setSamPoints(newPoints);
    samPointsRef.current = newPoints;
    setIsSamProcessing(true);

    const preferredClass = classes.find(c => c.id === selectedClass) || classes[0] || null;
    const setPreview = (polygons: Point[][], maskDataUrl?: string) => {
      setAutoSegmentPreview({
        polygons,
        ...(maskDataUrl && { maskDataUrl }),
        imageName: img.fileName,
      });
      setAutoSegmentClassId(preferredClass ? preferredClass.id : null);
    };

    const MAX_SIDE = 1024;
    const getImageB64AndScale = (): { imageB64: string | null; sendScale: number } => {
      if (!imageRef.current) return { imageB64: null, sendScale: 1 };
      const el = imageRef.current;
      let w = el.naturalWidth;
      let h = el.naturalHeight;
      let sendScale = 1;
      if (Math.max(w, h) > MAX_SIDE) {
        sendScale = MAX_SIDE / Math.max(w, h);
        w = Math.round(w * sendScale);
        h = Math.round(h * sendScale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { imageB64: null, sendScale: 1 };
      ctx.drawImage(el, 0, 0, w, h);
      return { imageB64: canvas.toDataURL('image/png'), sendScale };
    };

    try {
      const { imageB64, sendScale } = getImageB64AndScale();
      const apiBase = API_CONFIG.baseUrl;
      const scalePoint = (p: { x: number; y: number }) =>
        imageB64 ? { x: Math.round(p.x * sendScale), y: Math.round(p.y * sendScale) } : { x: p.x, y: p.y };
      const body: Record<string, unknown> = {
        point: scalePoint(imgPoint),
        points: newPoints.map(p => ({ ...scalePoint(p), label: p.label })),
        model: segmentModel,
      };
      if (imageB64) {
        body.imageB64 = imageB64;
      } else if (img.url) {
        body.imageUrl = img.url;
      }
      if (segmentModel === 'sam3' && segmentTextPrompt.trim()) {
        body.text = segmentTextPrompt.trim();
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 14000);
      const res = await fetch(`${apiBase}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`Segmentation failed: ${res.status}`);
      const json = await res.json();
      const rawPolygons = json.polygons || [];
      const isRectanglePlaceholder =
        (json.source !== 'sam2' && json.source !== 'sam3') &&
        rawPolygons.length === 1 &&
        rawPolygons[0].length >= 4 &&
        rawPolygons[0].length <= 5;
      if (isRectanglePlaceholder) {
        toast({
          title: 'SAM service needs update',
          description: 'Segmentation returned a placeholder. Ensure the SAM service (backend) is running with a valid model.',
          variant: 'destructive',
        });
        return;
      }
      let polygons: Point[][] = rawPolygons.map((poly: number[][]) =>
        poly.map((p: number[]) => ({ x: p[0], y: p[1] }))
      );
      if (imageB64 && sendScale !== 1 && polygons.length > 0) {
        const scaleBack = 1 / sendScale;
        polygons = polygons.map(poly => poly.map(p => ({ x: p.x * scaleBack, y: p.y * scaleBack })));
      }
      if (polygons.length > 0 && polygons[0].length > 0) {
        setPreview(polygons, json.maskBase64);
      } else {
        toast({
          title: 'No segmentation found',
          description: 'Try another point or add a second point on the object',
          variant: 'destructive',
        });
      }
    } catch (err) {
      toast({
        title: 'Segmentation failed',
        description: 'Backend SAM is unavailable or failed. Ensure the SAM service is running.',
        variant: 'destructive',
      });
    } finally {
      setIsSamProcessing(false);
    }
  }, [displayImage, currentImage, classes, selectedClass, toast, samPoints, segmentModel, segmentTextPrompt]);

  const acceptAutoSegment = () => {
    if (!autoSegmentPreview || !autoSegmentPreview.polygons || autoSegmentPreview.polygons.length === 0) return;
    // Require selecting an existing class id for auto-seg — do not auto-create classes here
    if (!autoSegmentClassId) {
      toast({ title: 'No class selected', description: 'Please select a class for auto-segmented annotations', variant: 'destructive' });
      return;
    }
    const classObj = classes.find(c => c.id === autoSegmentClassId) || null;
    if (!classObj) {
      toast({ title: 'Invalid class', description: 'Selected class not found', variant: 'destructive' });
      return;
    }

    const sa = annotScaleToAnnotRef.current;
    const newAnns: AnnotationShape[] = autoSegmentPreview.polygons.map(poly => ({
      id: `annotation_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
      type: 'polygon',
      // SAM polygons arrive in display-image pixel space — convert to annotation space.
      points: calibHDisplayToAnnotRef.current
        ? poly.map(p => applyHomography(calibHDisplayToAnnotRef.current!, p.x, p.y))
        : (sa.x !== 1 || sa.y !== 1)
          ? poly.map(p => ({ x: p.x * sa.x, y: p.y * sa.y }))
          : poly,
      label: classObj.name,
      color: classObj.color,
      visible: true
    }));

    setAnnotations(prev => {
      const updated = [...prev, ...newAnns];
      const storageKey = `annotations_${id}_${currentImageName}`;
      safeLocalStorageSet(storageKey, JSON.stringify(updated));
      // Save annotation-layer dims (same logic as createAnnotation)
      const annotDims = annotLayerDimsRef.current;
      const saveDims = annotDims
        ? { width: annotDims.width, height: annotDims.height }
        : { width: imageRef.current?.naturalWidth || 0, height: imageRef.current?.naturalHeight || 0 };
      if (saveDims.width && saveDims.height) {
        safeLocalStorageSet(`annotations_${id}_${currentImageName}_dims`, JSON.stringify(saveDims));
      }
      return updated;
    });

    // Mark as unsaved
    setHasUnsavedChanges(true);

    // update counts
    setClasses(prev => {
      const updated = prev.map(c => c.id === classObj!.id ? { ...c, count: c.count + autoSegmentPreview.polygons.length } : c);
      saveGlobalClasses(updated);
      return updated;
    });

    setAutoSegmentPreview(null);
    setSamPoints([]); // Clear points so next click starts fresh for a new object
    toast({ title: 'Auto-segment accepted', description: `Created ${newAnns.length} annotations` });
    computeGlobalStatsDebounced();
  };

  const cancelAutoSegment = () => {
    setAutoSegmentPreview(null);
    setSamPoints([]); // Clear SAM points when canceling
  };

  const [isApplyingAllImages, setIsApplyingAllImages] = useState(false);
  const [applyAllProgress, setApplyAllProgress] = useState<{ current: number; total: number } | null>(null);
  const applyAllCancelledRef = useRef(false);

  // Inline editing for individual annotation labels in right sidebar
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [editingAnnotationLabel, setEditingAnnotationLabel] = useState('');

  // Load global classes from localStorage
  const loadGlobalClasses = () => {
    try {
      const globalClassesKey = `classes_${id}`;
      const savedClasses = localStorage.getItem(globalClassesKey);
      if (savedClasses) {
        const parsedClasses = JSON.parse(savedClasses);
        setClasses(parsedClasses);
      }
    } catch (error) {
      console.error('Error loading global classes:', error);
    }
  };

  // Resize handlers for right sidebar
  const onMouseMoveResize = useCallback((e: MouseEvent) => {
    if (!resizingRef.current) return;
    const deltaX = e.clientX - startXRef.current;
    const newWidth = Math.max(200, Math.min(800, startWidthRef.current - deltaX));
    setRightWidth(newWidth);
  }, []);

  const onMouseUpResize = useCallback(() => {
    resizingRef.current = false;
    window.removeEventListener('mousemove', onMouseMoveResize);
    window.removeEventListener('mouseup', onMouseUpResize);
    // Notify that a panel resize/collapse finished so layout can be recomputed
    try {
      window.dispatchEvent(new Event('annotation-panel-resize-end'));
    } catch (err) {
      // ignore
    }
  }, [onMouseMoveResize]);

  const startResize = (e: React.MouseEvent) => {
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = rightWidth;
    window.addEventListener('mousemove', onMouseMoveResize);
    window.addEventListener('mouseup', onMouseUpResize);
  };

  // Left resize handlers
  const onMouseMoveResizeLeft = useCallback((e: MouseEvent) => {
    if (!leftResizingRef.current) return;
    const deltaX = e.clientX - leftStartXRef.current;
    const newWidth = Math.max(200, Math.min(800, leftStartWidthRef.current + deltaX));
    setLeftWidth(newWidth);
  }, []);

  const onMouseUpResizeLeft = useCallback(() => {
    leftResizingRef.current = false;
    window.removeEventListener('mousemove', onMouseMoveResizeLeft);
    window.removeEventListener('mouseup', onMouseUpResizeLeft);
    // Notify that a panel resize/collapse finished so layout can be recomputed
    try {
      window.dispatchEvent(new Event('annotation-panel-resize-end'));
    } catch (err) {
      // ignore
    }
  }, [onMouseMoveResizeLeft]);

  const startResizeLeft = (e: React.MouseEvent) => {
    leftResizingRef.current = true;
    leftStartXRef.current = e.clientX;
    leftStartWidthRef.current = leftWidth;
    window.addEventListener('mousemove', onMouseMoveResizeLeft);
    window.addEventListener('mouseup', onMouseUpResizeLeft);
  };

  // Smooth zoom animation refs and helpers
  const animFrameRef = useRef<number | null>(null);
  const scaleRef = useRef<number>(imageScale);
  const offsetRef = useRef<{ x: number; y: number }>(imageOffset);
  const targetScaleRef = useRef<number | null>(null);

  // Panning refs (middle mouse or Space + drag)
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const spacePressedRef = useRef(false);
  
  // Track right mouse button state for right+left click panning
  const rightMouseDownRef = useRef(false);
  
  // Prevent zoom reset during/after panning
  const preventZoomResetRef = useRef(false);

  useEffect(() => { scaleRef.current = imageScale; }, [imageScale]);
  useEffect(() => { offsetRef.current = imageOffset; }, [imageOffset]);

  // Annotation-layer scale refs — updated by effect so callbacks never have stale values.
  // annotLayerDimsRef  : pixel dimensions of the designated annotation coordinate space.
  // annotScaleToAnnotRef: multiply display-space coords × these to get annotation-space coords.
  const annotLayerDimsRef = useRef<{ width: number; height: number } | null>(null);
  const annotScaleToAnnotRef = useRef({ x: 1, y: 1 });
  // Homography refs — populated when a calibration is active.
  // calibHDisplayToAnnotRef: H maps display-image pixel → annotation-storage pixel (display→annot).
  // calibHAnnotToDisplayRef: H^-1 maps annotation-storage pixel → display-image pixel (annot→display).
  const calibHDisplayToAnnotRef = useRef<number[][] | null>(null);
  const calibHAnnotToDisplayRef = useRef<number[][] | null>(null);

  useEffect(() => {
    if (!annotationLayerId || !displayImage) {
      annotLayerDimsRef.current = null;
      annotScaleToAnnotRef.current = { x: 1, y: 1 };
      return;
    }
    const annotColl = imageCollections.find(c => String(c.id) === annotationLayerId);
    const annotImg = annotColl?.images.find(i => i.fileName === currentImageName);
    if (annotImg && annotImg.width > 0 && annotImg.height > 0 && displayImage.width > 0 && displayImage.height > 0) {
      annotLayerDimsRef.current = { width: annotImg.width, height: annotImg.height };
      annotScaleToAnnotRef.current = {
        x: annotImg.width / displayImage.width,
        y: annotImg.height / displayImage.height,
      };
    } else {
      annotLayerDimsRef.current = null;
      annotScaleToAnnotRef.current = { x: 1, y: 1 };
    }
  }, [annotationLayerId, currentImageName, imageCollections, displayImage]);

  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  const stopAnimation = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    targetScaleRef.current = null;
  };

  const animateToScale = (finalScale: number, focalImagePoint: Point, focalScreenPoint: Point) => {
    stopAnimation();
    targetScaleRef.current = finalScale;
    preserveZoomRef.current = true; // User is actively zooming, preserve this

    const step = () => {
      const cur = scaleRef.current || 1;
      const delta = finalScale - cur;
      // interpolate with easing factor for smoothness
      const next = Math.abs(delta) < 0.0001 ? finalScale : cur + delta * 0.28;

      // compute new offset so the focal image coordinate stays under the focal screen point
      const nextOffsetX = focalScreenPoint.x - focalImagePoint.x * next;
      const nextOffsetY = focalScreenPoint.y - focalImagePoint.y * next;

      // Apply new values
      setImageScale(next);
      setImageOffset({ x: nextOffsetX, y: nextOffsetY });

      // Continue until close enough
      if (Math.abs(finalScale - next) > 0.0005) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        // finalize
        setImageScale(finalScale);
        setImageOffset({ x: focalScreenPoint.x - focalImagePoint.x * finalScale, y: focalScreenPoint.y - focalImagePoint.y * finalScale });
        stopAnimation();
      }
    };

    animFrameRef.current = requestAnimationFrame(step);
  };

  

  // Keyboard shortcuts: press number keys 1..9 to select corresponding class in the list
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < classes.length) {
          setSelectedClass(classes[idx].id);
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [classes]);

  // Listen for Space key down/up to enable Space+drag panning
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressedRef.current = true;
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spacePressedRef.current = false;
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Listen for right mouse button down/up to enable right+left click panning
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 2) { // Right click
        rightMouseDownRef.current = true;
      }
    };
    const handleMouseUp = (e: MouseEvent) => {
      if (e.button === 2) { // Right click
        rightMouseDownRef.current = false;
      }
    };
    const handleContextMenu = (e: MouseEvent) => {
      // Prevent context menu when right-clicking for panning
      if (rightMouseDownRef.current) {
        e.preventDefault();
      }
    };
    
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('contextmenu', handleContextMenu);
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('contextmenu', handleContextMenu);
    };
  }, []);

  // Keyboard shortcut to toggle the right sidebar (']' key)
  useEffect(() => {
    const toggleHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === ']') {
        setRightCollapsed(v => !v);
      }
    };
    window.addEventListener('keydown', toggleHandler);
    return () => window.removeEventListener('keydown', toggleHandler);
  }, []);

  // Save global classes to localStorage
  const saveGlobalClasses = (classesToSave: AnnotationClass[]) => {
    try {
      const globalClassesKey = `classes_${id}`;
      localStorage.setItem(globalClassesKey, JSON.stringify(classesToSave));
    } catch (error) {
      console.error('Error saving global classes:', error);
    }
  };

  // Keep currentImageNameRef always up-to-date so stale callbacks can access the latest image name
  useEffect(() => {
    currentImageNameRef.current = currentImageName;
  }, [currentImageName]);

  // Load images on mount
  useEffect(() => {
    const loadImagesEffect = async () => {
      if (!id || !api) return;
      
      try {
        setIsLoading(true);
        
        // Fetch dataset and project names
        api.getDataset(id).then(res => {
          if (res.success && res.data) {
            setDatasetName(res.data.name);
          }
        });
        if (projectId) {
          api.getProject(projectId).then(res => {
            if (res.success && res.data) {
              setProjectName(res.data.name);
            }
          });
        }

        // Only load global classes if loading an existing annotation file
        // Otherwise start with clean slate (no classes)
        if (annotationId) {
          loadGlobalClasses();
        }
        
        // Try to load image collections first
        const collectionsResponse = await api.getImageCollections(id);
        if (collectionsResponse.success && collectionsResponse.data) {
          setImageCollections(collectionsResponse.data);
          
          // Get ALL unique image names from ALL collections for navigation
          const allNames = new Set<string>();
          collectionsResponse.data.forEach(collection => {
            collection.images.forEach(img => {
              allNames.add(img.fileName);
            });
          });
          const uniqueNames = Array.from(allNames).sort();
          setAllImageNames(uniqueNames);
          
          // Check if a specific collection ID was provided in URL (to restrict navigation).
          const urlCollectionId = annotationId ? null : searchParams.get('collectionId');
          let defaultCollection: ImageCollection | undefined;
          
          if (urlCollectionId) {
            defaultCollection = collectionsResponse.data.find(c => String(c.id) === String(urlCollectionId));
            if (defaultCollection) {
              console.log('Using collection from URL:', defaultCollection.name);
            } else {
              console.warn('Collection from URL not found:', urlCollectionId);
            }
          }

          // Respect the user-chosen collection order persisted in the DB
          // (image_collections.position, set via drag-to-reorder on the Dataset
          // page). The backend already returns collections ordered by position,
          // so the first one is whatever the user put at the top — don't second-guess
          // that with a hard-coded RGB preference here.
          if (!defaultCollection) {
            defaultCollection = collectionsResponse.data[0];
          }
          
          if (defaultCollection) {
            setDisplayLayer(String(defaultCollection.id));
            setMainLayer(String(defaultCollection.id)); // Set main layer (controls which images are available for navigation)
          }
          
          // Start from an image that exists in the preferred (RGB) layer so display + annotations align
          const initialNames =
            defaultCollection && defaultCollection.images.length > 0
              ? defaultCollection.images.map(img => img.fileName).sort()
              : uniqueNames;
          if (initialNames.length > 0) {
            const firstName = initialNames[0];
            setCurrentImageName(firstName);
            updateCurrentImages(firstName, defaultCollection ? String(defaultCollection.id) : '', collectionsResponse.data);
            loadAnnotationsForImage(firstName);
          }
          
          const navCount = urlCollectionId && defaultCollection 
            ? defaultCollection.images.length 
            : uniqueNames.length;
          
          toast({
            title: 'Collections loaded',
            description: urlCollectionId && defaultCollection 
              ? `Loaded ${collectionsResponse.data.length} collections. Navigation restricted to "${defaultCollection.name}" (${navCount} images).`
              : `Loaded ${collectionsResponse.data.length} collections with ${uniqueNames.length} unique images for navigation.`,
          });
        } else {
          // Fallback to old single collection method
          const response = await api.getImages(id);
          if (response.success && response.data) {
            // Create a single collection from images
            const defaultCollection: ImageCollection = {
              id: 'default',
              name: 'RGB Images',
              images: response.data,
              currentPage: 1,
              totalPages: 1,
              paginatedImages: response.data
            };
            
            setImageCollections([defaultCollection]);
            setDisplayLayer('default');
            setMainLayer('default'); // Set main layer for fallback case
            
            const imageNames = response.data.map(img => img.fileName).sort();
            setAllImageNames(imageNames);
            
            if (imageNames.length > 0) {
              setCurrentImageName(imageNames[0]);
              setCurrentImage(response.data[0]);
              setDisplayImage(response.data[0]);
              loadAnnotationsForImage(imageNames[0]);
            }
          }
        }
      } catch (error) {
        console.error('Error loading images:', error);
        toast({
          title: 'Error',
          description: 'Failed to load images',
          variant: 'destructive'
        });
      } finally {
        setIsLoading(false);
        // Mark initial load as complete after a brief delay to ensure all state updates are done
        setTimeout(() => setIsInitialLoad(false), 100);
      }
    };

    loadImagesEffect();
  }, [id, api, toast]);

  // Fetch calibrations for this dataset once api + id are ready
  useEffect(() => {
    if (!id || !api) return;
    api.getCalibrations(id).then(res => {
      if (res.success && res.data) {
        setCalibrations(res.data);
      }
    }).catch(() => { /* non-fatal */ });
  }, [id, api]);

  // Auto-set annotationLayerId + homography refs when displayLayer or calibrations change.
  // Annotations coordinate space tracking: when annotations are created/saved, we store
  // which collection they were created in. When switching display layers, we check if
  // annotations exist for the current image and determine correct transformation.
  useEffect(() => {
    if (!displayLayer || calibrations.length === 0 || !calibrationEnabled) {
      calibHDisplayToAnnotRef.current = null;
      calibHAnnotToDisplayRef.current = null;
      setCalibrationIsActive(false);
      // Don't reset annotationLayerId - it might be set from stored annotations
      return;
    }

    // Check if annotations exist for current image and which collection they're from
    const storageKey = `annotations_${id}_${currentImageName}_collection`;
    const storedAnnotationLayerId = localStorage.getItem(storageKey);
    
    // If we have stored annotation layer and it's different from display layer,
    // we need to apply calibration transform
    const annotCollectionId = storedAnnotationLayerId || annotationLayerId;
    
    if (!annotCollectionId || annotCollectionId === displayLayer) {
      // No calibration needed - viewing same layer as annotations, or no annotations
      calibHDisplayToAnnotRef.current = null;
      calibHAnnotToDisplayRef.current = null;
      setCalibrationIsActive(false);
      if (storedAnnotationLayerId) {
        setAnnotationLayerId(storedAnnotationLayerId);
      }
      return;
    }

    // Find calibration between annotation layer and display layer
    const cal = calibrations.find(
      c => (String(c.source_collection_id) === annotCollectionId && String(c.target_collection_id) === displayLayer) ||
           (String(c.target_collection_id) === annotCollectionId && String(c.source_collection_id) === displayLayer),
    );

    if (!cal) {
      // No calibration exists between these layers
      calibHDisplayToAnnotRef.current = null;
      calibHAnnotToDisplayRef.current = null;
      setCalibrationIsActive(false);
      if (storedAnnotationLayerId) {
        setAnnotationLayerId(storedAnnotationLayerId);
      }
      return;
    }

    // Determine correct homography direction: annotCollection → displayLayer
    const annotIsSource = String(cal.source_collection_id) === annotCollectionId;
    
    if (annotIsSource) {
      // Annotations are in source space, displaying target
      // H maps source(annot) → target(display); H_inv maps target(display) → source(annot)
      calibHAnnotToDisplayRef.current = cal.homography;      // annot(source) → display(target)
      calibHDisplayToAnnotRef.current = cal.homography_inv;  // display(target) → annot(source)
    } else {
      // Annotations are in target space, displaying source
      // Need to use inverse mapping
      calibHAnnotToDisplayRef.current = cal.homography_inv;  // annot(target) → display(source)
      calibHDisplayToAnnotRef.current = cal.homography;      // display(source) → annot(target)
    }
    
    setCalibrationIsActive(true);
    setAnnotationLayerId(annotCollectionId);
  }, [displayLayer, calibrations, id, currentImageName, annotationLayerId, calibrationEnabled]);

  // Update images when index or layer changes (including display layer only — must refresh display bitmap)
  useEffect(() => {
    // Skip during initial load to prevent flickering
    if (isInitialLoad) return;

    const mainLayerCollection = imageCollections.find(c => String(c.id) === String(mainLayer));
    const imageList =
      mainLayerCollection && mainLayerCollection.images.length > 0
        ? mainLayerCollection.images.map(img => img.fileName).sort()
        : allImageNames;
    if (imageList.length > 0 && currentImageIndex < imageList.length) {
      const imageName = imageList[currentImageIndex];

      if (imageName !== currentImageName) {
        setCurrentImageName(imageName);
        loadAnnotationsForImage(imageName);
      }
      updateCurrentImages(imageName, displayLayer, imageCollections);
    }
  }, [currentImageIndex, allImageNames, mainLayer, displayLayer, imageCollections, isInitialLoad]);


  // Update current index when layer changes to maintain the same image if possible
  useEffect(() => {
    // Skip during initial load to prevent flickering
    if (isInitialLoad) return;
    
    if (currentLayerImageNames.length > 0 && currentImageName) {
      const newIndex = currentLayerImageNames.findIndex(name => name === currentImageName);
      if (newIndex !== -1 && newIndex !== currentImageIndex) {
        setCurrentImageIndex(newIndex);
      } else if (newIndex === -1) {
        // Current image not found in main layer, this shouldn't happen but handle gracefully
        setCurrentImageIndex(0);
      }
    }
  }, [currentLayerImageNames, isInitialLoad]);


  const updateCurrentImages = (imageName: string, layerId: string, collections: ImageCollection[]) => {
    const preferredRgb = pickPreferredRgbCollection(collections);
    let foundCurrentImage: Image | null = null;

    if (preferredRgb) {
      foundCurrentImage = preferredRgb.images.find(img => img.fileName === imageName) || null;
    }

    if (!foundCurrentImage) {
      for (const collection of collections) {
        const img = collection.images.find(i => i.fileName === imageName);
        if (img) {
          foundCurrentImage = img;
          break;
        }
      }
    }

    setCurrentImage(foundCurrentImage);

    const mainLayerCollection = collections.find(c => String(c.id) === String(mainLayer));
    if (mainLayerCollection) {
      const mainLayerImageNames = mainLayerCollection.images.map(img => img.fileName).sort();
      setCurrentLayerImageNames(prev => {
        if (
          prev.length === mainLayerImageNames.length &&
          prev.every((n, i) => n === mainLayerImageNames[i])
        ) {
          return prev;
        }
        return mainLayerImageNames;
      });
    } else {
      setCurrentLayerImageNames(prev => (prev.length === 0 ? prev : []));
    }

    const displayCollection = collections.find(c => String(c.id) === String(layerId));
    let matchedInLayer: Image | null = null;
    if (displayCollection) {
      matchedInLayer = findCorrespondingImageInCollection(displayCollection, imageName, foundCurrentImage);
    }

    // When an explicit display layer is selected, the canvas must show that layer's
    // bitmap. If no corresponding image exists in the selected layer, keep displayImage
    // null so the "No corresponding image" UI can surface instead of silently falling
    // back to the RGB/reference image — that fallback made layer switching appear broken
    // because the user saw the same bitmap regardless of which layer was picked.
    const displayPixel: Image | null = displayCollection
      ? (matchedInLayer ?? null)
      : (foundCurrentImage ?? null);

    if (displayCollection) {
      setNoCorrespondingImage(matchedInLayer === null);
    } else {
      setNoCorrespondingImage(false);
    }

    setDisplayImage(displayPixel);
  };

  const loadAnnotationsForImage = async (imageName: string) => {
    console.log('[loadAnnotations] image:', imageName, 'last:', lastLoadedImageRef.current);

    if (imageName === lastLoadedImageRef.current && annotations.length > 0) {
      return;
    }
    lastLoadedImageRef.current = imageName;

    // --- PATH A: Editing an existing annotation file → load from DB API ---
    if (annotationId && api && id) {
      try {
        const storageKey = `annotations_${id}_${imageName}`;
        const cached = localStorage.getItem(storageKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached) as AnnotationShape[];
            if (parsed.length > 0) {
              const classColorMap: { [name: string]: string } = {};
              classes.forEach(c => { classColorMap[c.name] = c.color; });
              setAnnotations(parsed.map(a => classColorMap[a.label] ? { ...a, color: classColorMap[a.label] } : a));
              console.log(`[loadAnnotations] ${parsed.length} from localStorage cache`);
              return;
            }
          } catch { /* fall through */ }
        }

        const resp = await api.getImageAnnotations(id, annotationId, imageName);
        if (resp.success && resp.data) {
          const { annotations: apiAnns, imageWidth, imageHeight } = resp.data;
          cocoImageDimensionsRef.current[imageName] = { width: imageWidth, height: imageHeight };

          const imageAnnotations: AnnotationShape[] = [];
          for (const ann of apiAnns) {
            const seg = ann.segmentation;
            if (!seg || seg.length < 6) continue;
            const points: Point[] = [];
            for (let i = 0; i < seg.length; i += 2) {
              const x = seg[i], y = seg[i + 1];
              if (isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) continue;
              points.push({ x: Math.max(0, Math.min(x, imageWidth - 1)), y: Math.max(0, Math.min(y, imageHeight - 1)) });
            }
            if (points.length >= 3) {
              imageAnnotations.push({
                id: `annotation_${ann.id}`,
                type: 'polygon',
                points,
                label: ann.className,
                color: ann.color || DEFAULT_COLORS[0],
                visible: true,
              });
            }
          }

          setAnnotations(imageAnnotations);
          console.log(`[loadAnnotations] ${imageAnnotations.length} from API for ${imageName}`);

          if (imageAnnotations.length > 0) {
            safeLocalStorageSet(storageKey, JSON.stringify(imageAnnotations));
            safeLocalStorageSet(`annotations_${id}_${imageName}_dims`, JSON.stringify({ width: imageWidth, height: imageHeight }));
          }
          return;
        }
      } catch (err) {
        console.warn('[loadAnnotations] API load failed, falling back:', err);
      }
    }

    // --- PATH B: New annotation session (no annotationId) → localStorage only ---
    try {
      const storageKey = `annotations_${id}_${imageName}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as AnnotationShape[];
        if (parsed.length > 0) {
          const classColorMap: { [name: string]: string } = {};
          classes.forEach(c => { classColorMap[c.name] = c.color; });
          setAnnotations(parsed.map(a => classColorMap[a.label] ? { ...a, color: classColorMap[a.label] } : a));
          const dimsKey = `annotations_${id}_${imageName}_dims`;
          const savedDims = localStorage.getItem(dimsKey);
          if (savedDims) {
            try {
              const dims = JSON.parse(savedDims);
              if (dims.width > 0 && dims.height > 0) cocoImageDimensionsRef.current[imageName] = dims;
            } catch { /* ignore */ }
          }
          return;
        }
      }
      setAnnotations([]);
      if (annotationId) loadGlobalClasses();
    } catch (error) {
      console.error('[loadAnnotations] error:', error);
      setAnnotations([]);
      if (annotationId) loadGlobalClasses();
    }
  };

  // Keep refs in sync so stale useCallback closures always access the latest values
  // eslint-disable-next-line react-hooks/exhaustive-deps
  loadAnnotationsForImageRef.current = loadAnnotationsForImage;

  // Helper: Save annotations to localStorage with collection tracking
  const saveAnnotationsToLocalStorage = useCallback((
    imageName: string,
    annotations: AnnotationShape[],
    dims?: { width: number; height: number }
  ) => {
    if (!id || !imageName) return;
    
    const storageKey = `annotations_${id}_${imageName}`;
    safeLocalStorageSet(storageKey, JSON.stringify(annotations));
    
    // Save which collection these annotations were created in
    const currentCollection = displayLayer || mainLayer;
    if (currentCollection) {
      safeLocalStorageSet(`annotations_${id}_${imageName}_collection`, currentCollection);
    }
    
    // Save dimensions if provided
    if (dims && dims.width > 0 && dims.height > 0) {
      safeLocalStorageSet(`annotations_${id}_${imageName}_dims`, JSON.stringify(dims));
    }
  }, [id, displayLayer, mainLayer]);

  // Global statistics across all saved annotation files (all images)
  const [globalStats, setGlobalStats] = useState<{ [className: string]: number }>({});
  const [globalAvgAreas, setGlobalAvgAreas] = useState<{ [className: string]: number }>({});

  const computeGlobalStats = useCallback(async () => {
    try {
      // Use same source as Dataset Annotations view (GET /classes) so numbers match
      if (annotationId && api) {
        try {
          const response = await api.getAnnotationClasses(id, annotationId);
          if (response.success && response.data?.classes?.length) {
            const counts: { [name: string]: number } = {};
            response.data.classes.forEach((c: { className: string; count?: number }) => {
              counts[c.className] = c.count ?? 0;
            });
            setGlobalStats(counts);
            setGlobalAvgAreas({});
            
            // Sync class counts with API. If classes aren't loaded yet, prev.map would clear the list — rebuild from API instead.
            const apiClasses = response.data.classes;
            setClasses((prev) => {
              if (prev.length === 0) {
                const built = apiClasses.map((c, idx) => ({
                  id: `class_${c.categoryId ?? idx}_${String(c.className).replace(/\W+/g, '_')}`,
                  name: c.className,
                  color: c.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
                  visible: true,
                  count: c.count ?? 0,
                }));
                try {
                  const globalClassesKey = `classes_${id}`;
                  localStorage.setItem(globalClassesKey, JSON.stringify(built));
                } catch {
                  /* ignore */
                }
                return built;
              }
              return prev.map((c) => ({
                ...c,
                count: counts[c.name] ?? 0,
              }));
            });
            
            return;
          }
        } catch (dbError) {
          console.warn('Could not load statistics from database, falling back to computation:', dbError);
        }
      }
      
      const counts: { [name: string]: number } = {};
      const totalAreas: { [name: string]: number } = {};

      // Check if we have COCO data in sessionStorage (from loaded annotation file)
      const annotationFileRef = sessionStorage.getItem(`annotation_file_${id}`);
      
      if (annotationFileRef) {
        // Count from sessionStorage COCO data for accurate totals
        try {
          const fileData = JSON.parse(annotationFileRef);
          const cocoData = fileData.cocoData;
          
          if (cocoData.annotations && cocoData.categories) {
            // Build category ID to name map
            const categoryIdToName: { [id: string]: string } = {};
            cocoData.categories.forEach((cat: any) => {
              if (cat.id != null && cat.name) {
                categoryIdToName[cat.id.toString()] = cat.name;
              }
            });
            
            // Build image ID to dimensions map and image file_name -> image_id
            const imageDimensions: { [id: string]: { width: number, height: number } } = {};
            const imageFileNameToId: { [name: string]: number } = {};
            cocoData.images?.forEach((img: any) => {
              imageDimensions[img.id.toString()] = { width: img.width || 1, height: img.height || 1 };
              if (img.file_name != null) imageFileNameToId[img.file_name] = img.id;
            });
            
            // Per-image COCO counts/areas so we can replace with localStorage when present
            const cocoCountsByImage: { [imageId: string]: { [className: string]: number } } = {};
            const cocoAreasByImage: { [imageId: string]: { [className: string]: number } } = {};
            
            // Count all annotations from COCO data - only count valid ones
            let totalAnnotations = 0;
            let validAnnotations = 0;
            cocoData.annotations.forEach((annotation: any) => {
              totalAnnotations++;
              // Handle null category_id
              if (annotation.category_id == null) {
                console.warn('Annotation has null category_id, skipping:', annotation.id);
                return;
              }
              const className = categoryIdToName[annotation.category_id.toString()];
              if (className) {
                // Calculate area for segmentation annotations and validate
                let isValid = true;
                if (annotation.segmentation && annotation.segmentation.length > 0) {
                  const raw = annotation.segmentation;
                  const segmentation: number[] = Array.isArray(raw[0]) ? (raw[0] as number[]) : (raw as number[]);
                  if (segmentation.length >= 6) {
                    const imageDims = imageDimensions[annotation.image_id.toString()];
                    
                    // Detect if coordinates need scaling
                    const firstX = segmentation[0];
                    const firstY = segmentation[1];
                    const isAbnormallyLarge = firstX > 10000 || firstY > 10000;
                    const scaleFactor = isAbnormallyLarge && imageDims
                      ? { x: imageDims.width, y: imageDims.height }
                      : { x: 1, y: 1 };
                    
                    const points: Point[] = [];
                    for (let i = 0; i < segmentation.length; i += 2) {
                      let x = segmentation[i] / scaleFactor.x;
                      let y = segmentation[i + 1] / scaleFactor.y;
                      
                      // Filter out invalid coordinates (negative or NaN)
                      if (isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) {
                        continue;
                      }
                      
                      // Clamp to image bounds if we have image dimensions
                      if (imageDims) {
                        x = Math.max(0, Math.min(x, imageDims.width - 1));
                        y = Math.max(0, Math.min(y, imageDims.height - 1));
                      }
                      
                      points.push({ x, y });
                    }
                    
                    // Only count annotation if it has at least 3 valid points
                    if (points.length >= 3) {
                      validAnnotations++;
                      const imgIdStr = annotation.image_id.toString();
                      counts[className] = (counts[className] || 0) + 1;
                      if (!cocoCountsByImage[imgIdStr]) cocoCountsByImage[imgIdStr] = {};
                      cocoCountsByImage[imgIdStr][className] = (cocoCountsByImage[imgIdStr][className] || 0) + 1;
                      const area = calculatePolygonArea(points);
                      totalAreas[className] = (totalAreas[className] || 0) + area;
                      if (!cocoAreasByImage[imgIdStr]) cocoAreasByImage[imgIdStr] = {};
                      cocoAreasByImage[imgIdStr][className] = (cocoAreasByImage[imgIdStr][className] || 0) + area;
                    } else {
                      isValid = false;
                    }
                  } else {
                    isValid = false;
                  }
                } else {
                  // No segmentation, but has bbox - count it
                  validAnnotations++;
                  counts[className] = (counts[className] || 0) + 1;
                  const imgIdStr = annotation.image_id.toString();
                  if (!cocoCountsByImage[imgIdStr]) cocoCountsByImage[imgIdStr] = {};
                  cocoCountsByImage[imgIdStr][className] = (cocoCountsByImage[imgIdStr][className] || 0) + 1;
                }
              }
            });
            
            // Overlay localStorage for any image that has been edited (so new/removed annotations are reflected)
            const prefix = `annotations_${id}_`;
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (!key || !key.startsWith(prefix)) continue;
              const imageName = key.substring(prefix.length);
              if (!imageName) continue;
              const cocoImg =
                imageFileNameToId[imageName] != null
                  ? { id: imageFileNameToId[imageName] }
                  : findCocoImageForDatasetName(cocoData.images, imageName);
              if (cocoImg == null || cocoImg.id == null) continue;
              const imgIdStr = cocoImg.id.toString();
              const cocoImgCounts = cocoCountsByImage[imgIdStr] || {};
              const cocoImgAreas = cocoAreasByImage[imgIdStr] || {};
              Object.keys(cocoImgCounts).forEach(cn => {
                counts[cn] = (counts[cn] || 0) - cocoImgCounts[cn];
                if (counts[cn] <= 0) delete counts[cn];
              });
              Object.keys(cocoImgAreas).forEach(cn => {
                totalAreas[cn] = (totalAreas[cn] || 0) - cocoImgAreas[cn];
                if (totalAreas[cn] <= 0) delete totalAreas[cn];
              });
              const saved = localStorage.getItem(key);
              if (!saved) continue;
              try {
                const parsed = JSON.parse(saved) as AnnotationShape[];
                parsed.forEach(a => {
                  counts[a.label] = (counts[a.label] || 0) + 1;
                  if (a.type === 'polygon' && a.points && a.points.length >= 3) {
                    const area = calculatePolygonArea(a.points);
                    totalAreas[a.label] = (totalAreas[a.label] || 0) + area;
                  }
                });
              } catch (err) {
                // ignore parse errors
              }
            }
            
            console.log(`Statistics: ${validAnnotations}/${totalAnnotations} valid annotations counted`);
            console.log('Computed global stats from sessionStorage:', counts);
          }
        } catch (e) {
          console.error('Error computing stats from sessionStorage:', e);
        }
      } else {
        // Fallback: scan localStorage for cached annotations
        // Build a set of image names to check
        const imageNamesToCheck = new Set<string>(allImageNames);

        // Scan localStorage keys for any annotations_{id}_* entries
        const prefix = `annotations_${id}_`;
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key) continue;
          if (key.startsWith(prefix)) {
            const imageName = key.substring(prefix.length);
            if (imageName) imageNamesToCheck.add(imageName);
          }
        }

        // Iterate over all discovered image names and count annotations
        imageNamesToCheck.forEach(name => {
          const key = `annotations_${id}_${name}`;
          const saved = localStorage.getItem(key);
          if (!saved) return;
          try {
            const parsed = JSON.parse(saved) as AnnotationShape[];
            parsed.forEach(a => {
              counts[a.label] = (counts[a.label] || 0) + 1;
              
              // Calculate area for polygon annotations
              if (a.type === 'polygon' && a.points && a.points.length >= 3) {
                const area = calculatePolygonArea(a.points);
                totalAreas[a.label] = (totalAreas[a.label] || 0) + area;
              }
            });
          } catch (err) {
            // ignore parse errors per file
          }
        });
        
        console.log('Computed global stats from localStorage:', counts);
      }

      setGlobalStats(counts);
      
      // Calculate average areas
      const avgAreas: { [name: string]: number } = {};
      Object.keys(totalAreas).forEach(className => {
        const count = counts[className] || 0;
        if (count > 0) {
          avgAreas[className] = totalAreas[className] / count;
        }
      });
      setGlobalAvgAreas(avgAreas);
    } catch (err) {
      console.error('Error computing global stats', err);
      setGlobalStats({});
      setGlobalAvgAreas({});
    }
  }, [allImageNames, id, annotationId, api]);

  // Debounced recompute for user actions (add/delete/edit) so rapid changes trigger one run
  const computeGlobalStatsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const computeGlobalStatsDebounced = useCallback(() => {
    if (computeGlobalStatsTimeoutRef.current) clearTimeout(computeGlobalStatsTimeoutRef.current);
    computeGlobalStatsTimeoutRef.current = setTimeout(() => {
      computeGlobalStatsTimeoutRef.current = null;
      computeGlobalStats();
    }, 150);
  }, [computeGlobalStats]);
  useEffect(() => {
    return () => {
      if (computeGlobalStatsTimeoutRef.current) clearTimeout(computeGlobalStatsTimeoutRef.current);
    };
  }, []);

  const applySam3OnAllImages = useCallback(async () => {
    if (!sam3Available || segmentModel !== 'sam3' || !segmentTextPrompt.trim()) {
      toast({ title: 'SAM 3 required', description: 'Select SAM 3 and enter a text prompt', variant: 'destructive' });
      return;
    }
    if (!selectedClass) {
      toast({ title: 'Select a class', description: 'Choose a class for the applied annotations', variant: 'destructive' });
      return;
    }
    const mainColl = imageCollections.find((c) => String(c.id) === mainLayer);
    if (!mainColl || mainColl.images.length === 0) {
      toast({ title: 'No images', description: 'No images in the current layer', variant: 'destructive' });
      return;
    }
    const classObj = classes.find((c) => c.id === selectedClass);
    if (!classObj) return;

    const apiBase = API_CONFIG.baseUrl;
    const total = mainColl.images.length;
    applyAllCancelledRef.current = false;
    setIsApplyingAllImages(true);
    setApplyAllProgress({ current: 0, total });

    let addedCount = 0;
    let failCount = 0;

    for (let i = 0; i < mainColl.images.length; i++) {
      if (applyAllCancelledRef.current) break;
      setApplyAllProgress({ current: i + 1, total });
      const img = mainColl.images[i];
      const imageUrl = img.url;
      if (!imageUrl) {
        failCount++;
        continue;
      }
      try {
        const res = await fetch(`${apiBase}/segment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'sam3',
            text: segmentTextPrompt.trim(),
            imageUrl,
            point: {},
            points: [],
          }),
        });
        if (!res.ok) {
          failCount++;
          continue;
        }
        const json = await res.json();
        const rawPolygons = json.polygons || [];
        if (rawPolygons.length === 0) continue;

        // Use only the first polygon per image so we create one annotation per image (toast count matches saved count)
        const firstPoly = rawPolygons[0];
        const points: Point[] = firstPoly.map((p: number[]) => ({ x: p[0], y: p[1] }));
        if (points.length < 3) continue;

        const imageName = img.fileName;
        const newAnn: AnnotationShape = {
          id: `annotation_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          type: 'polygon',
          points,
          label: classObj.name,
          color: classObj.color,
          visible: true,
        };

        const storageKey = `annotations_${id}_${imageName}`;
        const raw = localStorage.getItem(storageKey);
        const existing: AnnotationShape[] = raw ? JSON.parse(raw) : [];
        safeLocalStorageSet(storageKey, JSON.stringify([...existing, newAnn]));
        
        // Save image dimensions so they can be used when saving annotation file
        if (img.width && img.height) {
          const dimsKey = `annotations_${id}_${imageName}_dims`;
          safeLocalStorageSet(dimsKey, JSON.stringify({ width: img.width, height: img.height }));
        }
        
        addedCount += 1;
      } catch {
        failCount++;
      }
    }

    const wasCancelled = applyAllCancelledRef.current;
    setIsApplyingAllImages(false);
    setApplyAllProgress(null);

    if (wasCancelled) {
      if (addedCount > 0) {
        setHasUnsavedChanges(true);
        setClasses((prev) =>
          prev.map((c) => (c.id === classObj.id ? { ...c, count: c.count + addedCount } : c))
        );
        saveGlobalClasses(
          classes.map((c) => (c.id === classObj.id ? { ...c, count: c.count + addedCount } : c))
        );
        computeGlobalStatsDebounced();
        if (currentImageName && mainColl.images.some((img) => img.fileName === currentImageName)) {
          loadAnnotationsForImage(currentImageName);
        }
        toast({ title: 'Cancelled', description: `Applied ${addedCount} annotation(s) before cancel.` });
      } else {
        toast({ title: 'Cancelled', description: 'Apply on all images was cancelled.' });
      }
      return;
    }

    setHasUnsavedChanges(true);

    if (currentImageName && mainColl.images.some((img) => img.fileName === currentImageName)) {
      loadAnnotationsForImage(currentImageName);
    }
    setClasses((prev) =>
      prev.map((c) => (c.id === classObj.id ? { ...c, count: c.count + addedCount } : c))
    );
    saveGlobalClasses(
      classes.map((c) => (c.id === classObj.id ? { ...c, count: c.count + addedCount } : c))
    );
    computeGlobalStatsDebounced();

    if (failCount > 0) {
      toast({
        title: 'Apply on all images',
        description: `Added ${addedCount} annotations across images. ${failCount} image(s) failed.`,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Apply on all images',
        description: `Added ${addedCount} annotation(s) across ${total} image(s).`,
      });
    }
  }, [
    sam3Available,
    segmentModel,
    segmentTextPrompt,
    selectedClass,
    mainLayer,
    imageCollections,
    classes,
    id,
    currentImageName,
    toast,
    loadAnnotationsForImage,
    computeGlobalStatsDebounced,
  ]);

  // Recompute global stats whenever we have changes to class list, image list or storage updates
  useEffect(() => {
    computeGlobalStats();

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key.startsWith(`annotations_${id}_`)) {
        computeGlobalStats();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [computeGlobalStats]);

  // Load annotations from annotation file when annotationId is provided
  const loadFromAnnotationFile = useCallback(async (annotationFileId: string) => {
    if (!id) return;
    
    console.log('Loading segmentation annotations from annotation file:', annotationFileId);
    
    // Clear all cached annotations for this dataset to ensure fresh load with correct coordinates
    console.log('Clearing cached annotations from localStorage...');
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`annotations_${id}_`)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log(`Cleared ${keysToRemove.length} cached annotation entries`);
    
    // First try to load from saved_annotations localStorage
    const savedAnnotations = localStorage.getItem(`saved_annotations_${id}`);
    if (savedAnnotations) {
      const annotationsList = JSON.parse(savedAnnotations);
      const targetAnnotation = annotationsList.find((ann: any) => ann.id === annotationFileId);
      
      if (targetAnnotation && targetAnnotation.content) {
        console.log('Found annotation file in localStorage:', targetAnnotation.name);
        
        setAnnotationName(targetAnnotation.name);
        const cocoData = targetAnnotation.content;
        return loadAnnotationsFromCOCO(cocoData, annotationFileId);
      }
    }
    
    // If not found in localStorage, try loading from backend
    if (api) {
      try {
        console.log('Fetching annotation from backend for file ID:', annotationFileId);
        // First get annotation metadata to get the name
        const annotationResponse = await api.getAnnotation(id, annotationFileId);
        const response = await api.getAnnotationContent(id, annotationFileId);
        
        console.log('Backend response:', response);
        
        if (response.success && response.data.content) {
          console.log('Loading segmentation annotations from backend, content length:', response.data.content.length);
          
          // Set annotation name if available
          if (annotationResponse.success && annotationResponse.data?.file_name) {
            setAnnotationName(annotationResponse.data.file_name);
          }
          
          try {
            const cocoData = JSON.parse(response.data.content);
            console.log('Parsed COCO data:', {
              images: cocoData.images?.length,
              annotations: cocoData.annotations?.length,
              categories: cocoData.categories?.length
            });
            
            // Log sample annotation to verify format
            if (cocoData.annotations && cocoData.annotations.length > 0) {
              const sampleAnn = cocoData.annotations[0];
              console.log('Sample annotation from API:', {
                id: sampleAnn.id,
                image_id: sampleAnn.image_id,
                category_id: sampleAnn.category_id,
                has_segmentation: !!sampleAnn.segmentation,
                segmentation_length: sampleAnn.segmentation?.length || 0,
                first_polygon_length: sampleAnn.segmentation?.[0]?.length || 0
              });
            }
            
            return loadAnnotationsFromCOCO(cocoData, annotationFileId);
          } catch (parseError) {
            console.error('Failed to parse COCO JSON:', parseError);
            console.error('Content preview:', response.data.content.substring(0, 500));
            throw new Error('Invalid JSON format in annotation content');
          }
        } else {
          console.error('Invalid response from backend:', response);
          throw new Error('No content in response');
        }
      } catch (error) {
        console.error('Failed to load annotation from backend:', error);
        toast({
          title: "Failed to load annotations",
          description: "Could not load the selected annotation file.",
          variant: "destructive",
        });
        return false;
      }
    }
    
    toast({
      title: "Annotation file not found",
      description: "The selected annotation file could not be found.",
      variant: "destructive",
    });
    return false;
  }, [id, api, toast]);

  // Helper function to load annotations from COCO format
  const loadAnnotationsFromCOCO = useCallback(async (cocoData: any, fileId?: string) => {
    try {
      console.log('Loading COCO data:', {
        hasCategories: !!cocoData.categories,
        categoryCount: cocoData.categories?.length || 0,
        hasImages: !!cocoData.images,
        imageCount: cocoData.images?.length || 0,
        hasAnnotations: !!cocoData.annotations,
        annotationCount: cocoData.annotations?.length || 0,
        cocoDataKeys: Object.keys(cocoData)
      });
      
      // Validate COCO data structure
      if (!cocoData.categories || !Array.isArray(cocoData.categories)) {
        throw new Error('Missing or invalid categories in COCO data');
      }
      if (!cocoData.images || !Array.isArray(cocoData.images)) {
        throw new Error('Missing or invalid images in COCO data');
      }
      if (!cocoData.annotations || !Array.isArray(cocoData.annotations)) {
        throw new Error('Missing or invalid annotations in COCO data');
      }

      // If COCO has no categories (e.g. after rename/save race), load from backend so classes are not lost
      if (cocoData.categories.length === 0 && api && fileId) {
        try {
          const res = await api.getAnnotationClasses(id, fileId);
          if (res?.success && res.data?.classes?.length) {
            cocoData.categories = res.data.classes.map((c: { className: string; categoryId?: number }, idx: number) => ({
              id: c.categoryId ?? idx + 1,
              name: c.className,
              supercategory: ''
            }));
            console.log('Populated categories from backend:', cocoData.categories.length);
          }
        } catch (e) {
          console.warn('Could not load classes from backend for empty COCO:', e);
        }
      }
      
      // Reset the last loaded image ref so annotations can be loaded fresh
      lastLoadedImageRef.current = null;
      
      // Don't load all annotations at once - just prepare the data structure
      // and load on-demand when navigating to images
      const classSet = new Set<string>();
      const classColorMap: { [name: string]: string } = {};
      
      // Extract classes from categories
      if (cocoData.categories) {
        console.log('Processing categories:', cocoData.categories);
        cocoData.categories.forEach((category: any, index: number) => {
          if (category && category.name) {
            classSet.add(category.name);
            // Assign colors from default palette
            classColorMap[category.name] = DEFAULT_COLORS[index % DEFAULT_COLORS.length];
          } else {
            console.warn('Invalid category:', category);
          }
        });
        console.log('Extracted classes:', Array.from(classSet));
      } else {
        console.warn('No categories found in COCO data');
      }
      
      // Store the full COCO data in sessionStorage for lazy loading
      const annotationFileRef = {
        id: fileId || `loaded_${Date.now()}`,
        cocoData: cocoData,
        imageCount: cocoData.images?.length || 0,
        annotationCount: cocoData.annotations?.length || 0
      };
      
      try {
        // Clear old sessionStorage first
        const sessionKey = `annotation_file_${id}`;
        sessionStorage.removeItem(sessionKey);
        // Then store new data
        sessionStorage.setItem(sessionKey, JSON.stringify(annotationFileRef));
        console.log(`Stored fresh COCO data in sessionStorage (${cocoData.images?.length} images, ${cocoData.annotations?.length} annotations)`);
        // Store COCO image dimensions so we can scale loaded coordinates to actual image dimensions when drawing
        cocoImageDimensionsRef.current = {};
        cocoData.images?.forEach((img: any) => {
          if (img.file_name != null) {
            cocoImageDimensionsRef.current[img.file_name] = {
              width: img.width || 1,
              height: img.height || 1
            };
          }
        });
      } catch (e) {
        console.warn('Could not save annotation file reference to sessionStorage:', e);
        return false;
      }
      
      // Clear all localStorage annotation caches for this dataset
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`annotations_${id}_`)) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        console.log(`Cleared ${keysToRemove.length} annotation caches from localStorage`);
      } catch (e) {
        console.warn('Could not clear localStorage annotation caches:', e);
      }
      
      // Update classes
      const newClasses: AnnotationClass[] = Array.from(classSet).map((className, index) => ({
        id: `class_${Date.now()}_${index}`,
        name: className,
        color: classColorMap[className] || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        visible: true,
        count: 0 // Will be updated by computeGlobalStats
      }));
      
      console.log('Setting classes:', newClasses);
      setClasses(newClasses);
      saveGlobalClasses(newClasses);
      
      // Load annotations for the first 2 images to populate the statistics
      const imageNames = cocoData.images?.slice(0, 2).map((img: any) => img.file_name) || [];
      let loadedCount = 0;
      
      imageNames.forEach((imageName: string) => {
        const imageEntry = findCocoImageForDatasetName(cocoData.images, imageName);
        if (!imageEntry) return;
        
        const imageAnnotations: AnnotationShape[] = [];
        const categoryIdToName: { [id: string]: string } = {};
        
        cocoData.categories.forEach((cat: any) => {
          if (cat.id != null) {
            categoryIdToName[cat.id.toString()] = cat.name;
          }
        });
        
        cocoData.annotations.forEach((annotation: any) => {
          if (String(annotation.image_id) === String(imageEntry.id)) {
            // Handle null category_id
            if (annotation.category_id == null) {
              console.warn(`Skipping annotation for ${imageName}: null category_id`);
              return;
            }
            const categoryId = annotation.category_id;
            const className = categoryIdToName[categoryId.toString()];
            
            if (className && annotation.segmentation && annotation.segmentation.length > 0) {
              // COCO: segmentation is [[x1,y1,x2,y2,...]]; some exports use flat [x1,y1,x2,y2,...]
              const raw = annotation.segmentation;
              const segmentation: number[] = Array.isArray(raw[0]) ? (raw[0] as number[]) : (raw as number[]);
              if (segmentation.length >= 6) {
                const points: Point[] = [];
                
                // Detect and fix abnormally large coordinates
                const firstX = segmentation[0];
                const firstY = segmentation[1];
                const isAbnormallyLarge = firstX > 10000 || firstY > 10000;
                const scaleFactor = isAbnormallyLarge && imageEntry.width && imageEntry.height
                  ? { x: imageEntry.width, y: imageEntry.height }
                  : { x: 1, y: 1 };
                
                for (let i = 0; i < segmentation.length; i += 2) {
                  let x = segmentation[i] / scaleFactor.x;
                  let y = segmentation[i + 1] / scaleFactor.y;
                  
                  // Filter out invalid coordinates (negative or NaN)
                  if (isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) {
                    continue;
                  }
                  
                  // Clamp to image bounds if we have image dimensions
                  if (imageEntry.width && imageEntry.height) {
                    x = Math.max(0, Math.min(x, imageEntry.width - 1));
                    y = Math.max(0, Math.min(y, imageEntry.height - 1));
                  }
                  
                  points.push({ x, y });
                }
                
                imageAnnotations.push({
                  id: `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                  type: 'polygon',
                  points,
                  label: className,
                  color: classColorMap[className] || DEFAULT_COLORS[0],
                  visible: true
                });
              }
            }
          }
        });
        
        if (imageAnnotations.length > 0) {
          const storageKey = `annotations_${id}_${imageName}`;
          try {
            safeLocalStorageSet(storageKey, JSON.stringify(imageAnnotations));
            loadedCount++;
          } catch (e) {
            console.warn(`Could not cache annotations for ${imageName}`);
          }
        }
      });
      
      console.log(`Pre-loaded annotations for ${loadedCount} images`);
      
      // Load annotations for current image — use refs so stale closures always see the latest values
      const latestImageName = currentImageNameRef.current || currentImageName;
      if (latestImageName && loadAnnotationsForImageRef.current) {
        loadAnnotationsForImageRef.current(latestImageName);
      }
      
      // Recompute global stats and wait for it to complete
      await computeGlobalStats();
      
      toast({
        title: "Annotations loaded",
        description: `Loaded annotation file with ${cocoData.images?.length || 0} images. Annotations load on-demand as you navigate.`,
      });
      
      return true;
    } catch (error) {
      console.error('Error parsing COCO data:', error);
      toast({
        title: "Failed to parse annotations",
        description: "The annotation file format is invalid.",
        variant: "destructive",
      });
      return false;
    }
  }, [id, api, computeGlobalStats, toast]);

  // Load from annotation file if annotationId is provided
  useEffect(() => {
    if (annotationId && !isLoading) {
      // Skip reload if we just saved - data is already in localStorage
      if (justSavedRef.current) {
        console.log('Skipping reload after save - data already in localStorage');
        justSavedRef.current = false;
        return;
      }
      
      // Wait for images to be loaded before attempting to load annotation file
      console.log('Loading annotation file with ID:', annotationId);
      loadFromAnnotationFile(annotationId).then((success) => {
        if (success) {
          console.log('Annotation file loaded successfully');
        } else {
          console.error('Failed to load annotation file');
        }
      });
    } else if (!annotationId && !isLoading && id) {
      // Starting new annotations - clear any cached data to ensure clean slate
      console.log('Starting new annotations - clearing cached data');
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`annotations_${id}_`)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      
      // Also clear sessionStorage annotation file reference and COCO dimensions
      sessionStorage.removeItem(`annotation_file_${id}`);
      cocoImageDimensionsRef.current = {};
      
      // Clear annotations state and classes for fresh start
      setAnnotations([]);
      setClasses([]);
      localStorage.removeItem(`classes_${id}`);
      setGlobalStats({});
      setGlobalAvgAreas({});
      
      console.log(`Cleared ${keysToRemove.length} cached entries for new annotation session`);
    }
  }, [annotationId, isLoading, loadFromAnnotationFile, id]);

  // Ensure annotations are loaded for current image when editing an existing annotation file.
  // Uses a ref to prevent infinite retries: once we've attempted a load for a given image, don't retry.
  const attemptedLoadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!annotationId || !currentImageName || isLoading) return;
    if (annotations.length > 0 && lastLoadedImageRef.current === currentImageName) return;
    if (attemptedLoadRef.current === currentImageName) return;
    attemptedLoadRef.current = currentImageName;

    const timeoutId = setTimeout(() => {
      console.log('[AnnotationLoader] loading from API for:', currentImageName);
      loadAnnotationsForImageRef.current?.(currentImageName);
    }, 150);
    return () => clearTimeout(timeoutId);
  }, [annotationId, currentImageName, isLoading, id]);
  // Reset the attempted-load guard when image changes so navigating to another image works
  useEffect(() => {
    attemptedLoadRef.current = null;
  }, [currentImageName]);

  const hasAnyAnnotations = Object.values(globalStats).reduce((s, v) => s + v, 0) > 0;
  // If globalStats is empty, check localStorage for any annotations entries as a fallback
  const hasAnyAnnotationsStored = (() => {
    if (hasAnyAnnotations) return true;
    const prefix = `annotations_${id}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(prefix)) return true;
    }
    return false;
  })();

  // Convert screen coordinates to image coordinates
  const screenToImageCoords = useCallback((screenX: number, screenY: number): Point => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // Get coordinates relative to canvas
    const canvasX = screenX - rect.left;
    const canvasY = screenY - rect.top;
    
    // Convert to image coordinates
    const imageX = (canvasX - imageOffset.x) / imageScale;
    const imageY = (canvasY - imageOffset.y) / imageScale;
    
    return { x: imageX, y: imageY };
  }, [imageScale, imageOffset]);

  // Wheel handler for zooming (use Ctrl/Cmd + wheel to zoom) - placed after screenToImageCoords
  useEffect(() => {
    const container = containerRef.current || canvasRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const rect = (container as HTMLElement).getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      // Convert screen point to image coordinates using current scale/offset
      const imagePoint = screenToImageCoords(e.clientX, e.clientY);

      const zoomIntensity = 0.0015;
      const wheel = e.deltaY;
      const factor = Math.exp(-wheel * zoomIntensity);

      const minScale = 0.02;
      const maxScale = 20;
      const desired = clamp((scaleRef.current || imageScale) * factor, minScale, maxScale);

      animateToScale(desired, imagePoint, { x: screenX, y: screenY });
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [screenToImageCoords, imageScale]);

  // Convert image coordinates to screen coordinates
  const imageToScreenCoords = useCallback((imageX: number, imageY: number): Point => {
    const screenX = imageX * imageScale + imageOffset.x;
    const screenY = imageY * imageScale + imageOffset.y;
    return { x: screenX, y: screenY };
  }, [imageScale, imageOffset]);

  // Point-in-polygon algorithm for hit detection
  const isPointInPolygon = useCallback((point: Point, polygon: Point[]): boolean => {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      if (((polygon[i].y > point.y) !== (polygon[j].y > point.y)) &&
          (point.x < (polygon[j].x - polygon[i].x) * (point.y - polygon[i].y) / (polygon[j].y - polygon[i].y) + polygon[i].x)) {
        inside = !inside;
      }
    }
    return inside;
  }, []);

  // Find annotation at given point (x,y are in natural image space)
  const findAnnotationAtPoint = useCallback((x: number, y: number): AnnotationShape | null => {
    // Convert click coords from display space to annotation storage space
    let qx = x, qy = y;
    const sa = annotScaleToAnnotRef.current;
    if (calibHDisplayToAnnotRef.current) {
      const pt = applyHomography(calibHDisplayToAnnotRef.current, x, y);
      qx = pt.x;
      qy = pt.y;
    } else if (sa.x !== 1 || sa.y !== 1) {
      // Annotation layer is set — use its scale factor
      qx = x * sa.x;
      qy = y * sa.y;
    } else if (currentImage?.fileName && imageRef.current) {
      // COCO fallback: remap if annotation dims differ from display dims
      const cocoDims = cocoImageDimensionsRef.current[currentImage.fileName];
      const nw = imageRef.current.naturalWidth;
      const nh = imageRef.current.naturalHeight;
      if (cocoDims && nw > 0 && nh > 0 && (cocoDims.width !== nw || cocoDims.height !== nh)) {
        qx = x * (cocoDims.width / nw);
        qy = y * (cocoDims.height / nh);
      }
    }
    for (const annotation of annotations) {
      if (!annotation.visible) continue;

      if (annotation.type === 'polygon') {
        if (isPointInPolygon({ x: qx, y: qy }, annotation.points)) {
          return annotation;
        }
      }
    }
    return null;
  }, [annotations, isPointInPolygon, currentImage]);

  // Create new annotation
  const createAnnotation = useCallback((type: 'rectangle' | 'circle' | 'polygon', points: Point[]) => {
    if (!selectedClass || !currentImage) return;

    const classObj = classes.find(c => c.id === selectedClass);
    if (!classObj) return;

    // Convert display-space points to annotation-storage space.
    // Prefer homography when calibration is active, fall back to uniform scale.
    const sa = annotScaleToAnnotRef.current;
    const finalPoints = calibHDisplayToAnnotRef.current
      ? points.map(p => applyHomography(calibHDisplayToAnnotRef.current!, p.x, p.y))
      : (sa.x !== 1 || sa.y !== 1)
        ? points.map(p => ({ x: p.x * sa.x, y: p.y * sa.y }))
        : points;

    const newAnnotation: AnnotationShape = {
      id: `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      points: finalPoints,
      label: classObj.name,
      color: classObj.color,
      visible: true
    };

    setAnnotations(prev => {
      const updated = [...prev, newAnnotation];
      // Auto-save to localStorage with collection tracking
      const annotDims = annotLayerDimsRef.current;
      const saveDims = annotDims
        ? { width: annotDims.width, height: annotDims.height }
        : { width: imageRef.current?.naturalWidth || 0, height: imageRef.current?.naturalHeight || 0 };
      saveAnnotationsToLocalStorage(currentImageName, updated, saveDims);
      return updated;
    });
    
    // Mark as unsaved
    setHasUnsavedChanges(true);
    
    // Update class count and save globally
    setClasses(prev => {
      const updated = prev.map(c => 
        c.id === selectedClass 
          ? { ...c, count: c.count + 1 }
          : c
      );
      saveGlobalClasses(updated);
      return updated;
    });

    toast({
      title: 'Annotation created',
      description: `${type} annotation added for class "${classObj.name}"`,
    });
    computeGlobalStatsDebounced();
  }, [selectedClass, classes, toast, currentImage, id, computeGlobalStatsDebounced]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current || !currentImage) return;

    // If middle button, space, Ctrl + left/right mouse, or right+left mouse is pressed, start panning
    if (e.button === 1 || spacePressedRef.current || ((e.button === 0 || e.button === 2) && e.ctrlKey) || (e.button === 0 && rightMouseDownRef.current)) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      // Preserve zoom when user starts panning
      preserveZoomRef.current = true;
      preventZoomResetRef.current = true;
      return;
    }

    const imageCoords = screenToImageCoords(e.clientX, e.clientY);

    // If Auto tool is active, trigger backend segmentation for the clicked image point
    if (activeTool === 'auto-segment') {
      if (classes.length === 0) {
        toast({
          title: 'No classes',
          description: 'Add at least one class before using SAM.',
          variant: 'destructive',
        });
        return;
      }
      // don't start auto-seg while drawing or while panning
      if (!isDrawing && !isPanningRef.current) {
        // Left-click = positive point (1), right-click = negative point (0 = remove from mask)
        const label = e.button === 2 ? 0 : 1;
        if (e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
        }
        startAutoSegment(imageCoords, label);
      }
      return;
    }

    if (activeTool === 'select') {
      // Check if clicking on existing annotation
      const clickedAnnotation = findAnnotationAtPoint(imageCoords.x, imageCoords.y);
      setSelectedAnnotation(clickedAnnotation?.id || null);
      
      if (clickedAnnotation) {
        setIsMovingAnnotation(true);
        setMoveOffset({
          x: imageCoords.x,
          y: imageCoords.y
        });
      } else {
        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
      }
    } else if (activeTool === 'polygon') {
      if (!selectedClass) {
        toast({
          title: 'No class selected',
          description: 'Please select a class before drawing annotations',
          variant: 'destructive'
        });
        return;
      }
      
      if (!isDrawing) {
        setIsDrawing(true);
        setCurrentPath([imageCoords]);
      } else {
        setCurrentPath(prev => [...prev, imageCoords]);
      }
    }
  }, [activeTool, selectedClass, classes.length, isDrawing, screenToImageCoords, findAnnotationAtPoint, startAutoSegment, toast]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current || !currentImage) return;

    // Track cursor position in image coordinates for status bar
    const imageCoords = screenToImageCoords(e.clientX, e.clientY);
    setCursorImagePosition(imageCoords);

    // Handle panning (middle button or space+drag)
    if (isPanningRef.current) {
      const deltaX = e.clientX - panStartRef.current.x;
      const deltaY = e.clientY - panStartRef.current.y;
      setImageOffset(prev => ({ x: prev.x + deltaX, y: prev.y + deltaY }));
      panStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (isDragging) {
      const deltaX = e.clientX - dragStart.x;
      const deltaY = e.clientY - dragStart.y;
      
      setImageOffset(prev => ({
        x: prev.x + deltaX,
        y: prev.y + deltaY
      }));
      
      setDragStart({ x: e.clientX, y: e.clientY });
    } else if (isMovingAnnotation && selectedAnnotation) {
      const imageCoords = screenToImageCoords(e.clientX, e.clientY);
      let deltaX = imageCoords.x - moveOffset.x;
      let deltaY = imageCoords.y - moveOffset.y;
      // Scale delta to annotation storage space.
      // When calibration is active, approximate using the local scale at image centre.
      const sa = annotScaleToAnnotRef.current;
      if (calibHDisplayToAnnotRef.current) {
        const H = calibHDisplayToAnnotRef.current;
        const nw = imageRef.current?.naturalWidth ?? 500;
        const nh = imageRef.current?.naturalHeight ?? 400;
        const cx = nw / 2, cy = nh / 2;
        const p1 = applyHomography(H, cx, cy);
        const p2 = applyHomography(H, cx + 1, cy);
        const p3 = applyHomography(H, cx, cy + 1);
        deltaX *= (p2.x - p1.x);
        deltaY *= (p3.y - p1.y);
      } else if (sa.x !== 1 || sa.y !== 1) {
        // Annotation layer set — use its scale factor
        deltaX *= sa.x;
        deltaY *= sa.y;
      } else if (currentImage?.fileName && imageRef.current) {
        // COCO fallback
        const cocoDims = cocoImageDimensionsRef.current[currentImage.fileName];
        const nw = imageRef.current.naturalWidth;
        const nh = imageRef.current.naturalHeight;
        if (cocoDims && nw > 0 && nh > 0 && (cocoDims.width !== nw || cocoDims.height !== nh)) {
          deltaX *= cocoDims.width / nw;
          deltaY *= cocoDims.height / nh;
        }
      }
      
      setAnnotations(prev => prev.map(ann => {
        if (ann.id === selectedAnnotation) {
          return {
            ...ann,
            points: ann.points.map(point => ({
              x: point.x + deltaX,
              y: point.y + deltaY
            }))
          };
        }
        return ann;
      }));
      
      // Auto-save after moving (use same scaled delta when reading from localStorage)
      const deltaXFinal = deltaX;
      const deltaYFinal = deltaY;
      setTimeout(() => {
        if (currentImageName) {
          const storageKey = `annotations_${id}_${currentImageName}`;
          const currentAnnotations = JSON.parse(localStorage.getItem(storageKey) || '[]');
          const updatedAnnotations = currentAnnotations.map((ann: AnnotationShape) => {
            if (ann.id === selectedAnnotation) {
              return {
                ...ann,
                points: ann.points.map((point: Point) => ({
                  x: point.x + deltaXFinal,
                  y: point.y + deltaYFinal
                }))
              };
            }
            return ann;
          });
          const saveDims = imageRef.current?.naturalWidth && imageRef.current?.naturalHeight
            ? { width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight }
            : undefined;
          saveAnnotationsToLocalStorage(currentImageName, updatedAnnotations, saveDims);
          setHasUnsavedChanges(true);
        }
      }, 100);
      
      setMoveOffset(imageCoords);
    }
  }, [isDragging, dragStart, isMovingAnnotation, selectedAnnotation, moveOffset, screenToImageCoords, currentImage]);

  const handleCanvasMouseUp = useCallback(() => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      // Clear the prevent zoom reset flag after a short delay to allow any pending events to settle
      setTimeout(() => {
        preventZoomResetRef.current = false;
      }, 100);
      return;
    }

    if (isDragging) {
      setIsDragging(false);
    } else if (isMovingAnnotation) {
      setIsMovingAnnotation(false);
    }
  }, [isDragging, isMovingAnnotation]);

  const handleCanvasDoubleClick = useCallback(() => {
    if (isDrawing && activeTool === 'polygon' && currentPath.length >= 3) {
      // Complete polygon
      createAnnotation('polygon', currentPath);
      setIsDrawing(false);
      setCurrentPath([]);
    }
  }, [isDrawing, activeTool, currentPath, createAnnotation]);

  const handleCanvasRightClick = useCallback((e: React.MouseEvent) => {
    // If Ctrl+right was used for panning, don't show context menu or complete polygon
    if ((e as unknown as MouseEvent).ctrlKey) {
      e.preventDefault();
      return;
    }

    // Right-click for SAM is handled in handleCanvasMouseDown (e.button === 2); prevent context menu when SAM is active
    if (activeTool === 'auto-segment') {
      e.preventDefault();
      return;
    }

    e.preventDefault(); // Prevent context menu for polygon complete below
    if (isDrawing && activeTool === 'polygon' && currentPath.length >= 3) {
      // Complete polygon on right-click
      createAnnotation('polygon', currentPath);
      setIsDrawing(false);
      setCurrentPath([]);
    }
  }, [isDrawing, activeTool, currentPath, createAnnotation]);

  // Reset zoom and pan to default view (fit image to container and center)
  const resetZoomAndPan = useCallback(() => {
    if (!imageRef.current || !canvasRef.current || !containerRef.current) return;

    const img = imageRef.current;
    const container = containerRef.current;
    const containerRect = container.getBoundingClientRect();

    // Calculate scale to fit image in container
    const scaleX = containerRect.width / img.naturalWidth;
    const scaleY = containerRect.height / img.naturalHeight;
    const fitToContainerScale = Math.min(scaleX, scaleY);

    // Reset to fit-to-container scale
    setImageScale(fitToContainerScale);
    
    // Center image in container
    const scaledWidth = img.naturalWidth * fitToContainerScale;
    const scaledHeight = img.naturalHeight * fitToContainerScale;
    
    setImageOffset({
      x: (containerRect.width - scaledWidth) / 2,
      y: (containerRect.height - scaledHeight) / 2
    });

    // Update refs for smooth zoom
    scaleRef.current = fitToContainerScale;
    offsetRef.current = {
      x: (containerRect.width - scaledWidth) / 2,
      y: (containerRect.height - scaledHeight) / 2
    };

    toast({
      title: 'View reset',
      description: 'Zoom and pan reset to default view',
    });
  }, [toast]);

  /** Polygon and AI Segment need at least one class so annotations have a label */
  const ensureClassForDrawingTools = useCallback((): boolean => {
    if (classes.length === 0) {
      // Use Sonner (not Radix useToast): same z-index as App Toaster, stays above annotation canvas/overlays (z-100)
      sonnerToast.error('Add a class first', {
        description:
          'Create at least one class in the Classes section before using Polygon or AI Segment.',
        duration: 6000,
      });
      return false;
    }
    return true;
  }, [classes.length]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isInputFocused = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

    if (e.key === 'Escape' && isDrawing) {
      setIsDrawing(false);
      setCurrentPath([]);
      toast({
        title: 'Drawing cancelled',
        description: 'Polygon drawing has been cancelled',
      });
    } else if (e.key === 'Enter' && !isInputFocused) {
      if (autoSegmentPreview && autoSegmentPreview.polygons?.length > 0) {
        acceptAutoSegment();
      } else if (isDrawing && activeTool === 'polygon' && currentPath.length >= 3) {
        createAnnotation('polygon', currentPath);
        setIsDrawing(false);
        setCurrentPath([]);
      }
    } else if (!isInputFocused) {
      // Tool shortcuts
      if (e.key === 'v' || e.key === 'V') {
        setActiveTool('select');
      } else if (e.key === 'p' || e.key === 'P') {
        if (!isDrawing && ensureClassForDrawingTools()) setActiveTool('polygon');
      } else if (e.key === 'a' || e.key === 'A') {
        if (ensureClassForDrawingTools()) setActiveTool('auto-segment');
      } else if ((e.key === 'r' || e.key === 'R') && !isDrawing) {
        resetZoomAndPan();
      }
    }
  }, [isDrawing, activeTool, currentPath, createAnnotation, toast, resetZoomAndPan, autoSegmentPreview, acceptAutoSegment, ensureClassForDrawingTools]);

  // Add keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const redrawCanvas = useCallback(() => {
    // Require canvas and an image to draw: either the displayImage (selected layer) or the currentImage (annotations source)
    if (!canvasRef.current || !imageRef.current || (!displayImage && !currentImage)) {
      return;
    }

    // CRITICAL: Check if image is actually loaded before attempting to draw
    // This prevents black screens when switching layers - the image element is remounted and starts loading,
    // We must wait for it to actually load before drawing
    if (!imageRef.current.complete || !imageRef.current.naturalWidth) {
      return; // Wait for image to load before drawing
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get canvas display size (the context is already scaled by dpr in handleImageResize)
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    // Clear canvas (use display dimensions since context is scaled by dpr)
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // Save context
    ctx.save();

    // Draw image with proper scaling and offset
    if (imageRef.current && imageRef.current.complete && imageRef.current.naturalWidth > 0) {
      ctx.drawImage(
        imageRef.current,
        imageOffset.x,
        imageOffset.y,
        imageRef.current.naturalWidth * imageScale,
        imageRef.current.naturalHeight * imageScale
      );
    }

    // Annotation coordinate transform: when calibration is active, annotation points are in
    // the annotation-storage collection space and must be mapped back to display image space
    // via the inverse homography before being projected to screen coordinates.
    // Without calibration, fall back to uniform scale or COCO dimension remapping.
    const naturalW = imageRef.current?.naturalWidth ?? 0;
    const naturalH = imageRef.current?.naturalHeight ?? 0;

    // annot-storage pixel → display image pixel
    const annotToDisplayPx = (px: number, py: number): { x: number; y: number } => {
      if (calibHAnnotToDisplayRef.current) {
        return applyHomography(calibHAnnotToDisplayRef.current, px, py);
      }
      if (annotationLayerId && naturalW > 0 && naturalH > 0) {
        const annotColl = imageCollections.find(c => String(c.id) === annotationLayerId);
        const annotImg = annotColl?.images.find(i => i.fileName === currentImage?.fileName);
        if (annotImg && annotImg.width > 0 && annotImg.height > 0) {
          return { x: px * naturalW / annotImg.width, y: py * naturalH / annotImg.height };
        }
      }
      const cocoDims = currentImage?.fileName ? cocoImageDimensionsRef.current[currentImage.fileName] : undefined;
      if (cocoDims && naturalW > 0 && naturalH > 0 && cocoDims.width > 0 && cocoDims.height > 0 &&
          (cocoDims.width !== naturalW || cocoDims.height !== naturalH)) {
        return { x: px * naturalW / cocoDims.width, y: py * naturalH / cocoDims.height };
      }
      return { x: px, y: py };
    };

    const annotationToScreen = (px: number, py: number) => {
      const disp = annotToDisplayPx(px, py);
      return imageToScreenCoords(disp.x, disp.y);
    };

    // Debug: log all annotations and their visibility
    const visibleCount = annotations.filter(a => a.visible).length;
    const invisibleCount = annotations.filter(a => !a.visible).length;
    if (annotations.length > 0) {
      console.log('[Canvas Draw] Annotations:', { total: annotations.length, visible: visibleCount, invisible: invisibleCount });
    }

    // Draw annotations
    annotations.forEach((annotation, idx) => {
      if (!annotation.visible) {
        console.log('[Canvas Draw] Skipping invisible annotation:', { id: annotation.id, label: annotation.label, visible: annotation.visible });
        return;
      }

      ctx.strokeStyle = annotation.color;
      ctx.fillStyle = annotation.color + '30'; // Semi-transparent fill
      ctx.lineWidth = 2;

      if (annotation.type === 'polygon' && annotation.points.length > 2) {
        ctx.beginPath();
        
        const firstPoint = annotationToScreen(annotation.points[0].x, annotation.points[0].y);
        ctx.moveTo(firstPoint.x, firstPoint.y);
        
        for (let i = 1; i < annotation.points.length; i++) {
          const point = annotationToScreen(annotation.points[i].x, annotation.points[i].y);
          ctx.lineTo(point.x, point.y);
        }
        
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        // Draw label
        ctx.fillStyle = annotation.color;
        ctx.font = '12px Arial';
        const centerX = annotation.points.reduce((sum, p) => sum + p.x, 0) / annotation.points.length;
        const centerY = annotation.points.reduce((sum, p) => sum + p.y, 0) / annotation.points.length;
        const centerScreen = annotationToScreen(centerX, centerY);
        ctx.fillText(annotation.label, centerScreen.x, centerScreen.y);
      }

      // Highlight selected annotation
      if (annotation.id === selectedAnnotation) {
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3;
        
        if (annotation.type === 'polygon') {
          ctx.beginPath();
          const firstPoint = annotationToScreen(annotation.points[0].x, annotation.points[0].y);
          ctx.moveTo(firstPoint.x, firstPoint.y);
          for (let i = 1; i < annotation.points.length; i++) {
            const point = annotationToScreen(annotation.points[i].x, annotation.points[i].y);
            ctx.lineTo(point.x, point.y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
    });

    // Draw current path while drawing
    if (isDrawing && currentPath.length > 0) {
      const classObj = classes.find(c => c.id === selectedClass);
      const color = classObj?.color || '#FF0000';
      
      ctx.strokeStyle = color;
      ctx.fillStyle = color + '30';
      ctx.lineWidth = 2;

      if (activeTool === 'polygon' && currentPath.length > 0) {
        ctx.beginPath();
        
        const firstPoint = imageToScreenCoords(currentPath[0].x, currentPath[0].y);
        ctx.moveTo(firstPoint.x, firstPoint.y);
        
        for (let i = 1; i < currentPath.length; i++) {
          const point = imageToScreenCoords(currentPath[i].x, currentPath[i].y);
          ctx.lineTo(point.x, point.y);
        }
        
        if (currentPath.length > 2) {
          ctx.fill();
        }
        ctx.stroke();
        
        // Draw points
        currentPath.forEach((point) => {
          const screenPoint = imageToScreenCoords(point.x, point.y);
          ctx.beginPath();
          ctx.arc(screenPoint.x, screenPoint.y, 3, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = 1;
          ctx.stroke();
        });
      }
    }

    // SAM points (positive = green, negative = red) when auto-segment tool is active
    if (activeTool === 'auto-segment' && samPoints.length > 0) {
      samPoints.forEach((p) => {
        const screenPoint = imageToScreenCoords(p.x, p.y);
        ctx.beginPath();
        ctx.arc(screenPoint.x, screenPoint.y, 6, 0, 2 * Math.PI);
        ctx.fillStyle = p.label === 1 ? 'rgba(0, 255, 100, 0.9)' : 'rgba(255, 80, 80, 0.9)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    // Restore context
    ctx.restore();
  }, [annotations, selectedAnnotation, isDrawing, currentPath, activeTool, selectedClass, classes, samPoints, imageScale, imageOffset, displayImage, currentImage, imageToScreenCoords, annotationLayerId, imageCollections]);

  // Redraw canvas when dependencies change
  useEffect(() => {
    redrawCanvas();
  }, [annotations, selectedAnnotation, isDrawing, currentPath, samPoints, activeTool, imageScale, imageOffset, displayImage, currentImage, redrawCanvas]);

  // Redraw canvas for image scaling and offset changes
  useEffect(() => {
    redrawCanvas();
  }, [imageScale, imageOffset, redrawCanvas]);

  // Redraw canvas when drawing state changes (for real-time feedback)
  useEffect(() => {
    if (isDrawing && currentPath.length > 0) {
      redrawCanvas();
    }
  }, [currentPath, isDrawing, redrawCanvas]);

  const addClass = () => {
    if (!newClassName.trim()) return;

    const newClass: AnnotationClass = {
      id: `class_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: newClassName.trim(),
      color: DEFAULT_COLORS[classes.length % DEFAULT_COLORS.length],
      visible: true,
      count: 0
    };

    setClasses(prev => {
      const updated = [...prev, newClass];
      saveGlobalClasses(updated);
      return updated;
    });
    setNewClassName('');
    setIsAddingClass(false);
    setSelectedClass(newClass.id);

    toast({
      title: 'Class added',
      description: `Class "${newClass.name}" has been created`,
    });
  };

  const deleteClass = (classId: string) => {
    const classToDelete = classes.find(c => c.id === classId);
    if (!classToDelete) return;

    // Check if there are annotations using this class
    const annotationsWithClass = annotations.filter(a => a.label === classToDelete.name);
    if (annotationsWithClass.length > 0) {
      const confirmed = window.confirm(
        `This class has ${annotationsWithClass.length} annotation(s). Deleting it will also remove all annotations using this class. Continue?`
      );
      if (!confirmed) return;

      // Delete all annotations using this class
      setAnnotations(prev => {
        const updated = prev.filter(a => a.label !== classToDelete.name);
        if (currentImageName) {
          saveAnnotationsToLocalStorage(currentImageName, updated);
        }
        return updated;
      });
    }

    // Remove the class
    setClasses(prev => {
      const updated = prev.filter(c => c.id !== classId);
      saveGlobalClasses(updated);
      return updated;
    });

    // Clear selection if deleted class was selected
    if (selectedClass === classId) {
      setSelectedClass(null);
    }

    setHasUnsavedChanges(true);

    toast({
      title: 'Class deleted',
      description: `Class "${classToDelete.name}" has been removed`,
    });
    computeGlobalStatsDebounced();
  };

  const startEditingClass = (classId: string, currentName: string) => {
    setEditingClassId(classId);
    setEditingClassName(currentName);
  };

  const saveEditingClass = async () => {
    if (!editingClassId || !editingClassName.trim()) {
      setEditingClassId(null);
      setEditingClassName('');
      return;
    }

    const oldClass = classes.find(c => c.id === editingClassId);
    if (!oldClass) return;

    const oldName = oldClass.name;
    const newName = editingClassName.trim();

    if (oldName === newName) {
      setEditingClassId(null);
      setEditingClassName('');
      return;
    }

    // Check if new name already exists
    if (classes.some(c => c.name === newName && c.id !== editingClassId)) {
      toast({
        variant: 'destructive',
        title: 'Name already exists',
        description: `A class named "${newName}" already exists`,
      });
      return;
    }

    // Persist rename to backend so Annotations view shows correct counts
    if (api && annotationId) {
      try {
        const res = await api.renameAnnotationClass(id, annotationId, oldName, newName);
        if (!res.success) throw new Error(res.error || 'Failed to rename class');
      } catch (e) {
        console.error('Rename class on server:', e);
        toast({
          variant: 'destructive',
          title: 'Could not rename on server',
          description: e instanceof Error ? e.message : 'Statistics in Annotations view may be stale until you save.',
        });
        return;
      }
    }

    // Update class name locally
    setClasses(prev => {
      const updated = prev.map(c => 
        c.id === editingClassId ? { ...c, name: newName } : c
      );
      saveGlobalClasses(updated);
      return updated;
    });

    // Update all annotations with the old class name
    setAnnotations(prev => {
      const updated = prev.map(a => 
        a.label === oldName ? { ...a, label: newName } : a
      );
      if (currentImageName) {
        const saveDims = imageRef.current?.naturalWidth && imageRef.current?.naturalHeight
          ? { width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight }
          : undefined;
        saveAnnotationsToLocalStorage(currentImageName, updated, saveDims);
      }
      return updated;
    });

    setEditingClassId(null);
    setEditingClassName('');
    setHasUnsavedChanges(true);

    toast({
      title: 'Class renamed',
      description: `"${oldName}" has been renamed to "${newName}"`,
    });
    computeGlobalStatsDebounced();
  };

  const cancelEditingClass = () => {
    setEditingClassId(null);
    setEditingClassName('');
  };

  const deleteAnnotation = (annotationId: string) => {
    const annotation = annotations.find(a => a.id === annotationId);
    if (!annotation || !currentImageName) return;

    setAnnotations(prev => {
      const updated = prev.filter(a => a.id !== annotationId);
      // Auto-save to localStorage using image name
      const storageKey = `annotations_${id}_${currentImageName}`;
      safeLocalStorageSet(storageKey, JSON.stringify(updated));
      return updated;
    });
    
    // Mark as unsaved
    setHasUnsavedChanges(true);
    
    // Update class count and save globally
    const classObj = classes.find(c => c.name === annotation.label);
    if (classObj) {
      setClasses(prev => {
        const updated = prev.map(c => 
          c.id === classObj.id 
            ? { ...c, count: Math.max(0, c.count - 1) }
            : c
        );
        saveGlobalClasses(updated);
        return updated;
      });
    }
    computeGlobalStatsDebounced();

    if (selectedAnnotation === annotationId) {
      setSelectedAnnotation(null);
    }

    toast({
      title: 'Annotation deleted',
      description: `Deleted ${annotation.type} annotation`,
    });
  };

  // Keyboard shortcut for deleting selected annotation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only handle Delete key if we have a selected annotation and not editing text
      if (event.key === 'Delete' && selectedAnnotation && 
          !(event.target as HTMLElement)?.tagName.match(/INPUT|TEXTAREA|SELECT/)) {
        event.preventDefault();
        const confirmed = window.confirm('Delete this annotation? This cannot be undone.');
        if (confirmed) {
          deleteAnnotation(selectedAnnotation);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotation]);

  // Track if we should preserve zoom on resize vs reset to fit-to-screen
  const preserveZoomRef = useRef(false);
  
  const handleImageLoad = () => {
    // Reset preserve flag for new image loads
    preserveZoomRef.current = false;
    
    // Use requestAnimationFrame to ensure DOM has settled before calculating sizes
    // This prevents "weird" initial rendering where container dimensions might still be stabilizing
    requestAnimationFrame(() => {
      // Always force a refit when a new image source has loaded, regardless of any
      // resize-listener timers that may have re-set preserveZoomRef in the meantime.
      handleImageResize(true);
    });
  };

  const handleImageResize = (forceRefit = false) => {
    if (!imageRef.current || !canvasRef.current || !containerRef.current) return;

    const img = imageRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;

    // Set canvas size to match container
    const containerRect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas internal size with device pixel ratio
    canvas.width = containerRect.width * dpr;
    canvas.height = containerRect.height * dpr;
    
    // Set canvas display size
    canvas.style.width = `${containerRect.width}px`;
    canvas.style.height = `${containerRect.height}px`;
    
    // Scale canvas context to match device pixel ratio
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
    }

    // Calculate scale to fit image in container
    const scaleX = containerRect.width / img.naturalWidth;
    const scaleY = containerRect.height / img.naturalHeight;
    const fitToContainerScale = Math.min(scaleX, scaleY);

    // Only reset zoom if this is initial load, we're explicitly not preserving zoom, AND we're not preventing reset due to panning
    if (forceRefit || (!preserveZoomRef.current && !preventZoomResetRef.current)) {
      setImageScale(fitToContainerScale);
      // Center image in container for new images
      const scaledWidth = img.naturalWidth * fitToContainerScale;
      const scaledHeight = img.naturalHeight * fitToContainerScale;
      
      setImageOffset({
        x: (containerRect.width - scaledWidth) / 2,
        y: (containerRect.height - scaledHeight) / 2
      });
      // Don't call redrawCanvas here - let the useEffect handle it when state updates
      // This prevents race conditions where we draw before imageScale/imageOffset are updated
      // Clear layer switching state - useEffect will handle redraw when scale/offset update
      requestAnimationFrame(() => {
        setIsLayerSwitching(false);
        // For layer switching, force one more redraw after overlay is gone to ensure visibility
        if (isLayerSwitching) {
          requestAnimationFrame(() => redrawCanvas());
        }
      });
    } else {
      // When preserving zoom, keep the current offset - don't recenter
      // Just update the canvas size, redraw will happen via useEffect when needed
      // Force a redraw since we're not changing scale/offset (so useEffect won't trigger)
      requestAnimationFrame(() => {
        redrawCanvas();
        setIsLayerSwitching(false);
        // Force another redraw after overlay is removed to ensure image is visible
        requestAnimationFrame(() => {
          redrawCanvas();
        });
      });
    }
  };

    // Recompute canvas and image scale when panels change or image changes so aspect ratio stays correct
    useEffect(() => {
      // If image already loaded, recompute layout to maintain aspect ratio when side panels are hidden/resized
      // Also check that image is complete to avoid resizing before image is loaded
      if (imageRef.current && imageRef.current.complete && imageRef.current.naturalWidth > 0) {
        // Preserve zoom when just resizing panels
        preserveZoomRef.current = true;
        
        // small timeout to let layout settle after panel resize/collapse
        const t = setTimeout(() => {
          handleImageResize();
        }, 50);
        return () => clearTimeout(t);
      }
      return undefined;
      }, [leftCollapsed, rightCollapsed, leftWidth, rightWidth]);

    // Listen for explicit resize-end notifications from resize handlers and toggles
    useEffect(() => {
      const onResizeEnd = () => {
        // small timeout to allow DOM to settle
        setTimeout(() => {
          // Preserve zoom during panel resizes - don't reset zoom just because panels changed
          preserveZoomRef.current = true;
          handleImageResize();
        }, 10);
      };
      window.addEventListener('annotation-panel-resize-end', onResizeEnd as EventListener);
      return () => window.removeEventListener('annotation-panel-resize-end', onResizeEnd as EventListener);
    }, []);

  const saveAnnotations = async () => {
    if (!currentImage || annotations.length === 0) return;

    try {
      const naturalW = imageRef.current?.naturalWidth || 1920;
      const naturalH = imageRef.current?.naturalHeight || 1080;
      const cocoDims = currentImage?.fileName ? cocoImageDimensionsRef.current[currentImage.fileName] : undefined;
      const toNatural = cocoDims && (cocoDims.width !== naturalW || cocoDims.height !== naturalH) && cocoDims.width > 0 && cocoDims.height > 0
        ? (p: Point) => ({ x: p.x * (naturalW / cocoDims!.width), y: p.y * (naturalH / cocoDims!.height) })
        : (p: Point) => p;

      // Create COCO format export (always in natural image pixel coordinates)
      const cocoData = {
        info: {
          description: `Annotations for ${currentImage.fileName}`,
          version: "1.0",
          year: new Date().getFullYear(),
          contributor: "AI Data Creator",
          date_created: new Date().toISOString()
        },
        images: [{
          id: 1,
          file_name: currentImage.fileName,
          width: naturalW,
          height: naturalH
        }],
        categories: classes.map((cls, index) => ({
          id: index + 1,
          name: cls.name,
          supercategory: "object"
        })),
        annotations: annotations.map((ann, index) => {
          const categoryId = classes.findIndex(c => c.name === ann.label) + 1;
          
          if (ann.type === 'polygon') {
            const pointsNatural = ann.points.map(toNatural);
            const segmentation = pointsNatural.flatMap(p => [p.x, p.y]);
            const xs = pointsNatural.map(p => p.x);
            const ys = pointsNatural.map(p => p.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);
            const polygonArea = calculatePolygonArea(pointsNatural);
            
            return {
              id: index + 1,
              image_id: 1,
              category_id: categoryId,
              segmentation: [segmentation],
              area: polygonArea,
              bbox: [minX, minY, maxX - minX, maxY - minY],
              iscrowd: 0
            };
          }
          return null;
        }).filter(Boolean)
      };

      // Save to localStorage using image name (and reference dimensions so edit uses correct scale when image size differs)
      const storageKey = `annotations_${id}_${currentImageName}`;
      safeLocalStorageSet(storageKey, JSON.stringify(annotations));
      const dimsKey = `annotations_${id}_${currentImageName}_dims`;
      safeLocalStorageSet(dimsKey, JSON.stringify({ width: naturalW, height: naturalH }));
      
      // Export as downloadable file
      const dataStr = JSON.stringify(cocoData, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      
      const exportFileDefaultName = `annotations_${currentImageName.split('.')[0]}.json`;
      
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();

      toast({
        title: 'Annotations saved',
        description: `Saved ${annotations.length} annotations and exported COCO file`,
      });
    } catch (error) {
      console.error('Error saving annotations:', error);
      toast({
        title: 'Save failed',
        description: 'Failed to save annotations',
        variant: 'destructive'
      });
    }
  };

  // Update an annotation's class by selecting an existing class id
  const saveAnnotationLabel = (annotationId: string, targetClassId: string | null) => {
    if (!annotationId || !currentImageName || !targetClassId) return;
    const ann = annotations.find(a => a.id === annotationId);
    if (!ann) return;

    console.log('[saveAnnotationLabel] Before update:', { annotationId, oldLabel: ann.label, oldVisible: ann.visible, targetClassId });

    const oldLabel = ann.label;
    const targetClass = classes.find(c => c.id === targetClassId);
    if (!targetClass) return; // no changes if class not found

    // Update annotation label
    setAnnotations(prev => {
      const updated = prev.map(a => a.id === annotationId ? { ...a, label: targetClass!.name, color: targetClass!.color } : a);
      
      // Log the updated annotation to verify visible property is preserved
      const updatedAnn = updated.find(a => a.id === annotationId);
      console.log('[saveAnnotationLabel] After update:', { 
        annotationId, 
        newLabel: updatedAnn?.label, 
        newVisible: updatedAnn?.visible, 
        hasPoints: !!updatedAnn?.points?.length 
      });
      
      // persist (and keep reference dimensions in sync)
      const saveDims = imageRef.current?.naturalWidth && imageRef.current?.naturalHeight
        ? { width: imageRef.current.naturalWidth, height: imageRef.current.naturalHeight }
        : undefined;
      saveAnnotationsToLocalStorage(currentImageName!, updated, saveDims);
      return updated;
    });

    // Mark as unsaved
    setHasUnsavedChanges(true);

    // Adjust class counts: decrement old, increment new
    setClasses(prev => {
      const updated = prev.map(c => {
        if (c.name === oldLabel) return { ...c, count: Math.max(0, c.count - 1) };
        if (c.id === targetClass.id) return { ...c, count: c.count + 1 };
        return c;
      });
      saveGlobalClasses(updated);
      return updated;
    });
    computeGlobalStatsDebounced();
  };

  // Download annotations as COCO JSON file
  const downloadAnnotationsJSON = async () => {
    try {
      // Build images array and annotations array by reading per-image localStorage
      const imagesArr: any[] = [];
      const annotationsArr: any[] = [];
      const categoryMap = classes.map((cls, idx) => ({ id: idx + 1, name: cls.name }));

      let annId = 1;
      let imageId = 1;

      for (const name of allImageNames) {
        const storageKey = `annotations_${id}_${name}`;
        const saved = localStorage.getItem(storageKey);
        
        // Get stored dimensions for this specific image (not current image!)
        const dimsKey = `annotations_${id}_${name}_dims`;
        const savedDims = localStorage.getItem(dimsKey);
        let imgWidth = 0;
        let imgHeight = 0;
        
        if (savedDims) {
          try {
            const dims = JSON.parse(savedDims) as { width: number; height: number };
            imgWidth = dims.width || 0;
            imgHeight = dims.height || 0;
          } catch (e) {
            console.warn(`Failed to parse dimensions for ${name}, using fallback`);
            imgWidth = imageRef.current?.naturalWidth || 0;
            imgHeight = imageRef.current?.naturalHeight || 0;
          }
        } else {
          // Fallback to current image dimensions (may be incorrect if different image)
          imgWidth = imageRef.current?.naturalWidth || 0;
          imgHeight = imageRef.current?.naturalHeight || 0;
        }
        
        if (!saved) {
          // still add image entry to keep indexing consistent
          imagesArr.push({ id: imageId, file_name: name, width: imgWidth, height: imgHeight });
          imageId++;
          continue;
        }

        let parsed: AnnotationShape[] = [];
        try { parsed = JSON.parse(saved); } catch (err) { parsed = []; }

        imagesArr.push({ id: imageId, file_name: name, width: imgWidth, height: imgHeight });

        parsed.forEach((ann) => {
          if (ann.type === 'polygon') {
            const segmentation = ann.points.flatMap(p => [p.x, p.y]);
            const xs = ann.points.map(p => p.x);
            const ys = ann.points.map(p => p.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);
            const categoryId = (classes.findIndex(c => c.name === ann.label) + 1) || 1;

            // Calculate actual polygon area using the same method as altitude script
            const polygonArea = calculatePolygonArea(ann.points);

            annotationsArr.push({
              id: annId++,
              image_id: imageId,
              category_id: categoryId,
              segmentation: [segmentation],
              area: polygonArea,
              bbox: [minX, minY, maxX - minX, maxY - minY],
              iscrowd: 0
            });
          }
        });

        imageId++;
      }

      const coco = {
        info: {
          description: `${projectName ? `Project: ${projectName} | ` : ''}Dataset: ${datasetName || id}${annotationName ? ` | Annotation: ${annotationName}` : ''}`,
          version: '1.0',
          year: new Date().getFullYear(),
          contributor: 'LAI',
          date_created: new Date().toISOString()
        },
        images: imagesArr,
        categories: categoryMap,
        annotations: annotationsArr
      };

      const dataStr = JSON.stringify(coco, null, 2);

      // Download the JSON file
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const fileName = `annotations_all_${id}.json`;

      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', fileName);
      link.click();

      toast({ 
        title: 'Downloaded', 
        description: `Downloaded ${annotationsArr.length} annotations from ${imagesArr.length} images as JSON file` 
      });
    } catch (err) {
      console.error('Error downloading annotations', err);
      toast({ title: 'Download failed', description: 'Failed to download annotations', variant: 'destructive' });
    }
  };

  // Save new annotation file with name prompt
  const saveNewAnnotationFile = async (name: string) => {
    if (!id || !api) {
      toast({ 
        title: 'Cannot save', 
        description: 'Dataset ID or API not available',
        variant: 'destructive'
      });
      return false;
    }

    if (!name.trim()) {
      toast({ 
        title: 'Invalid name', 
        description: 'Please provide a name for the annotation file',
        variant: 'destructive'
      });
      return false;
    }

    try {
      setIsSavingAnnotation(true);

      // Build minimal annotation data (no full COCO building)
      const imagesArr: any[] = [];
      const annotationsArr: any[] = [];
      const categoryMap = classes.map((cls, idx) => ({ id: idx + 1, name: cls.name, supercategory: 'object' }));

      let annId = 1;
      let imageId = 1;

      for (const imageName of allImageNames) {
        const storageKey = `annotations_${id}_${imageName}`;
        const saved = localStorage.getItem(storageKey);
        
        // Get stored dimensions for this specific image
        const dimsKey = `annotations_${id}_${imageName}_dims`;
        const savedDims = localStorage.getItem(dimsKey);
        let imgWidth = 0;
        let imgHeight = 0;
        
        if (savedDims) {
          try {
            const dims = JSON.parse(savedDims) as { width: number; height: number };
            imgWidth = dims.width || 0;
            imgHeight = dims.height || 0;
          } catch (e) {
            console.warn(`Failed to parse dimensions for ${imageName}`);
          }
        }
        
        // If no dimensions found, try to get from current image or COCO data
        if ((imgWidth === 0 || imgHeight === 0) && cocoImageDimensionsRef.current[imageName]) {
          const cocoDims = cocoImageDimensionsRef.current[imageName];
          imgWidth = cocoDims.width || 0;
          imgHeight = cocoDims.height || 0;
        }
        
        // Final fallback: if this is the current image, use its dimensions
        if ((imgWidth === 0 || imgHeight === 0) && imageName === currentImageName) {
          const img = displayImage || currentImage;
          if (img) {
            imgWidth = (img as any)?.naturalWidth || 0;
            imgHeight = (img as any)?.naturalHeight || 0;
          }
        }
        
        if (!saved) {
          // Add image entry even if no annotations (if we have dimensions)
          if (imgWidth > 0 && imgHeight > 0) {
            imagesArr.push({ 
              id: imageId, 
              file_name: imageName, 
              width: imgWidth, 
              height: imgHeight 
            });
          }
          imageId++;
          continue;
        }

        let parsed: AnnotationShape[] = [];
        try { 
          parsed = JSON.parse(saved); 
        } catch (err) { 
          parsed = []; 
        }

        // Only add image if we have dimensions
        if (imgWidth > 0 && imgHeight > 0) {
          imagesArr.push({ 
            id: imageId, 
            file_name: imageName, 
            width: imgWidth, 
            height: imgHeight 
          });
        } else {
          // If we have annotations but no dimensions, that's a problem
          if (parsed.length > 0) {
            console.warn(`Skipping ${parsed.length} annotations for ${imageName}: no image dimensions available`);
          }
          // Skip this image if no dimensions
          imageId++;
          continue;
        }

        parsed.forEach((ann) => {
          if (ann.type === 'polygon') {
            const segmentation = ann.points.flatMap(p => [p.x, p.y]);
            const xs = ann.points.map(p => p.x);
            const ys = ann.points.map(p => p.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);
            const categoryId = (classes.findIndex(c => c.name === ann.label) + 1) || 1;
            const polygonArea = calculatePolygonArea(ann.points);

            annotationsArr.push({
              id: annId++,
              image_id: imageId,
              category_id: categoryId,
              segmentation: [segmentation],
              area: polygonArea,
              bbox: [minX, minY, maxX - minX, maxY - minY],
              iscrowd: 0
            });
          }
        });

        imageId++;
      }

      // Save directly to backend without building full COCO file
      const response = await fetch(`${API_CONFIG.baseUrl}/datasets/${id}/annotations/save-direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          categories: categoryMap,
          images: imagesArr,
          annotations: annotationsArr
        })
      });
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(error.detail || 'Failed to save annotations');
      }
      
      const result = await response.json();
      
      if (result.success) {
        const fileName = name.endsWith('.json') ? name : `${name}.json`;
        const newAnnotationFileId = result.annotation_file_id;
        
        // Update the URL to include the annotation ID so subsequent edits work correctly
        if (newAnnotationFileId) {
          // Mark that we just saved so we don't reload and clear localStorage
          justSavedRef.current = true;
          
          // Update URL params to include the new annotation file ID
          const currentParams = new URLSearchParams(window.location.search);
          currentParams.set('annotationId', newAnnotationFileId);
          navigate(`${window.location.pathname}?${currentParams.toString()}`, { replace: true });
          
          // Reload annotation data from database to get fresh statistics
          if (api) {
            try {
              const annotationResponse = await api.getAnnotation(id, newAnnotationFileId);
              const contentResponse = await api.getAnnotationContent(id, newAnnotationFileId);
              
              if (contentResponse.success && contentResponse.data) {
                // Store in sessionStorage for future reference
                sessionStorage.setItem(`annotation_file_${id}`, JSON.stringify({
                  fileId: newAnnotationFileId,
                  fileName: fileName,
                  cocoData: contentResponse.data
                }));
                
                // Refresh statistics from the database
                await computeGlobalStats();
              }
            } catch (error) {
              console.warn('Could not reload annotation data after save:', error);
            }
          }
        }
        
        toast({ 
          title: 'Saved successfully', 
          description: `Annotation file "${fileName}" has been created with ${annotationsArr.length} annotations from ${imagesArr.length} images` 
        });
        return true;
      } else {
        throw new Error(result.message || 'Failed to save annotation file');
      }
    } catch (error) {
      console.error('Error saving annotation file:', error);
      toast({ 
        title: 'Save failed', 
        description: 'An error occurred while saving the annotation file',
        variant: 'destructive'
      });
      return false;
    } finally {
      setIsSavingAnnotation(false);
    }
  };

  // Handler for save button in dialog
  const handleSaveAnnotationFile = async () => {
    const success = await saveNewAnnotationFile(saveAnnotationName);
    if (success) {
      setHasUnsavedChanges(false);
      setShowSaveDialog(false);
      setSaveAnnotationName('');
      // Navigate away if this save was triggered by "Save & Leave"
      if (navigateAfterSaveRef.current && pendingNavigationRef.current) {
        navigateAfterSaveRef.current = false;
        navigate(pendingNavigationRef.current);
        pendingNavigationRef.current = null;
      }
    }
  };

  // Update database with current annotations: sync each image via PATCH (no full COCO replace).
  // This avoids ever running process_coco_annotation_file from here, so classes are never wiped.
  const updateDatabaseAnnotations = async () => {
    if (!annotationId || !api) {
      toast({
        title: 'Cannot update',
        description: 'No annotation selected for editing or API not available',
        variant: 'destructive'
      });
      return;
    }

    const apiBase = API_CONFIG?.baseUrl ?? '';
    let totalAnnotations = 0;
    let imagesUpdated = 0;
    let lastError: string | null = null;

    try {
      for (const imageName of allImageNames) {
        const storageKey = `annotations_${id}_${imageName}`;
        const saved = localStorage.getItem(storageKey);
        if (!saved) continue;

        let parsed: AnnotationShape[] = [];
        try {
          parsed = JSON.parse(saved);
        } catch {
          continue;
        }

        const annotationsData = parsed
          .filter((ann): ann is AnnotationShape & { type: 'polygon'; points: Point[] } => ann.type === 'polygon' && !!ann.points?.length)
          .map((ann) => {
            const segmentation = ann.points.flatMap((p: Point) => [p.x, p.y]);
            const xs = ann.points.map((p: Point) => p.x);
            const ys = ann.points.map((p: Point) => p.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);
            const polygonArea = calculatePolygonArea(ann.points);
            return {
              category_name: ann.label,
              segmentation: [segmentation],
              bbox: [minX, minY, maxX - minX, maxY - minY],
              area: polygonArea
            };
          });

        const url = `${apiBase}/datasets/${id}/annotations/${annotationId}/image/${encodeURIComponent(imageName)}`;
        const response = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annotations: annotationsData,
            image_width: 0,
            image_height: 0
          })
        });
        const data = await response.json();

        if (response.ok && data.success) {
          imagesUpdated += 1;
          totalAnnotations += annotationsData.length;
        } else {
          lastError = data.detail || data.error || response.statusText;
        }
      }

      if (imagesUpdated > 0) {
        toast({
          title: 'Database updated',
          description: `Synced ${totalAnnotations} annotations from ${imagesUpdated} images (incremental update, no full replace).`
        });
        computeGlobalStats();
      }
      if (lastError && imagesUpdated === 0) {
        toast({
          title: 'Update failed',
          description: lastError,
          variant: 'destructive'
        });
      } else if (lastError && imagesUpdated < allImageNames.length) {
        toast({
          title: 'Partially updated',
          description: `Updated ${imagesUpdated} images. Some failed: ${lastError}`,
          variant: 'destructive'
        });
      }
    } catch (err) {
      console.error('Error updating annotation in database:', err);
      toast({
        title: 'Update failed',
        description: err instanceof Error ? err.message : 'Could not sync annotations',
        variant: 'destructive'
      });
    }
  };

  // Save current image annotations to database (single image only)
  const saveCurrentImageToDatabase = useCallback(async (): Promise<boolean> => {
    if (!annotationId || !api || !currentImageName) {
      return false;
    }

    try {
      // Get current image dimensions
      const img = displayImage || currentImage;
      const imageWidth = (img as any)?.naturalWidth || 0;
      const imageHeight = (img as any)?.naturalHeight || 0;

      // Convert annotations to COCO format for this image
      const annotationsData = annotations.map((ann, idx) => {
        if (ann.type === 'polygon') {
          const segmentation = ann.points.flatMap(p => [p.x, p.y]);
          const xs = ann.points.map(p => p.x);
          const ys = ann.points.map(p => p.y);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const maxX = Math.max(...xs);
          const maxY = Math.max(...ys);
          const categoryId = (classes.findIndex(c => c.name === ann.label) + 1) || 1;
          const polygonArea = calculatePolygonArea(ann.points);

          return {
            id: idx + 1,
            image_id: 1,
            category_id: categoryId,
            category_name: ann.label,
            segmentation: [segmentation],
            bbox: [minX, minY, maxX - minX, maxY - minY],
            area: polygonArea,
            iscrowd: 0
          };
        }
        return null;
      }).filter(Boolean);

      // Send to backend using fetch with PATCH method
      const url = `${api ? 'http://localhost:9999' : ''}/datasets/${id}/annotations/${annotationId}/image/${encodeURIComponent(currentImageName)}`;
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          annotations: annotationsData,
          image_width: imageWidth,
          image_height: imageHeight
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        console.log('Image annotations saved:', data);
        
        // Update sessionStorage COCO data to reflect the saved changes
        try {
          const annotationFileRef = sessionStorage.getItem(`annotation_file_${id}`);
          if (annotationFileRef) {
            const fileData = JSON.parse(annotationFileRef);
            const cocoData = fileData.cocoData;
            
            if (cocoData && cocoData.annotations && cocoData.images) {
              // Find the image ID for this image name
              const imageEntry = findCocoImageForDatasetName(cocoData.images, currentImageName);
              if (imageEntry) {
                // Update categories to include all current classes
                const existingCategoryNames = new Set(cocoData.categories?.map((c: any) => c.name) || []);
                classes.forEach((cls, idx) => {
                  if (!existingCategoryNames.has(cls.name)) {
                    // Add new category with next available ID
                    const maxCategoryId = Math.max(0, ...(cocoData.categories?.map((c: any) => c.id) || [0]));
                    cocoData.categories = cocoData.categories || [];
                    cocoData.categories.push({
                      id: maxCategoryId + 1,
                      name: cls.name,
                      supercategory: ""
                    });
                    console.log(`Added new category to sessionStorage: ${cls.name} with id ${maxCategoryId + 1}`);
                  }
                });
                
                // Build a category name to ID map for annotation category_id lookup
                const categoryNameToId: { [name: string]: number } = {};
                cocoData.categories?.forEach((cat: any) => {
                  categoryNameToId[cat.name] = cat.id;
                });
                
                // Remove old annotations for this image
                cocoData.annotations = cocoData.annotations.filter((ann: any) => ann.image_id !== imageEntry.id);
                
                // Add new annotations with proper COCO format
                let nextAnnId = Math.max(0, ...cocoData.annotations.map((a: any) => a.id || 0)) + 1;
                annotations.forEach((ann) => {
                  if (ann.type === 'polygon') {
                    const segmentation = ann.points.flatMap(p => [p.x, p.y]);
                    const xs = ann.points.map(p => p.x);
                    const ys = ann.points.map(p => p.y);
                    const minX = Math.min(...xs);
                    const minY = Math.min(...ys);
                    const maxX = Math.max(...xs);
                    const maxY = Math.max(...ys);
                    // Use category ID from the COCO categories, not from frontend index
                    const categoryId = categoryNameToId[ann.label] || 1;
                    const polygonArea = calculatePolygonArea(ann.points);
                    
                    cocoData.annotations.push({
                      id: nextAnnId++,
                      image_id: imageEntry.id,
                      category_id: categoryId,
                      segmentation: [segmentation],
                      bbox: [minX, minY, maxX - minX, maxY - minY],
                      area: polygonArea,
                      iscrowd: 0
                    });
                  }
                });
                
                // Save back to sessionStorage
                fileData.cocoData = cocoData;
                sessionStorage.setItem(`annotation_file_${id}`, JSON.stringify(fileData));
                console.log(`Updated sessionStorage with ${annotations.length} annotations for ${currentImageName}`);
                
                // Recompute global statistics to reflect the changes
                await computeGlobalStats();
              }
            }
          }
        } catch (e) {
          console.warn('Could not update sessionStorage:', e);
        }
        
        return true;
      } else {
        console.error('Failed to save image annotations:', data.error || data.detail);
        return false;
      }
    } catch (error) {
      console.error('Error saving image annotations:', error);
      return false;
    }
  }, [annotationId, api, currentImageName, annotations, displayImage, currentImage, classes, id]);

  // Auto-save function with debouncing
  const autoSaveToDatabase = useCallback(async () => {
    // Only auto-save if in edit mode and there are unsaved changes
    if (!annotationId || !hasUnsavedChanges || isAutoSaving) {
      return;
    }

    // Debounce: only save if at least 60 seconds have passed since last save
    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;
    if (timeSinceLastSave < 60000) {
      return;
    }

    try {
      setIsAutoSaving(true);
      const success = await saveCurrentImageToDatabase();
      if (success) {
        setHasUnsavedChanges(false);
        lastSaveTimeRef.current = Date.now();
      }
    } catch (error) {
      console.error('Auto-save failed:', error);
      // Don't show toast for auto-save failures to avoid interrupting user
    } finally {
      setIsAutoSaving(false);
    }
  }, [annotationId, hasUnsavedChanges, isAutoSaving, saveCurrentImageToDatabase]);

  // Save all annotations from all images into a single COCO file
  const saveAllAnnotations = async () => {
    try {
      // Build images array and annotations array by reading per-image localStorage
      const imagesArr: any[] = [];
      const annotationsArr: any[] = [];
      const categoryMap = classes.map((cls, idx) => ({ id: idx + 1, name: cls.name }));

      let annId = 1;
      let imageId = 1;

      for (const name of allImageNames) {
        const storageKey = `annotations_${id}_${name}`;
        const saved = localStorage.getItem(storageKey);
        
        // Get stored dimensions for this specific image (not current image!)
        const dimsKey = `annotations_${id}_${name}_dims`;
        const savedDims = localStorage.getItem(dimsKey);
        let imgWidth = 0;
        let imgHeight = 0;
        
        if (savedDims) {
          try {
            const dims = JSON.parse(savedDims) as { width: number; height: number };
            imgWidth = dims.width || 0;
            imgHeight = dims.height || 0;
          } catch (e) {
            console.warn(`Failed to parse dimensions for ${name}, using fallback`);
            imgWidth = imageRef.current?.naturalWidth || 0;
            imgHeight = imageRef.current?.naturalHeight || 0;
          }
        } else {
          // Fallback to current image dimensions (may be incorrect if different image)
          imgWidth = imageRef.current?.naturalWidth || 0;
          imgHeight = imageRef.current?.naturalHeight || 0;
        }
        
        if (!saved) {
          // still add image entry to keep indexing consistent
          imagesArr.push({ id: imageId, file_name: name, width: imgWidth, height: imgHeight });
          imageId++;
          continue;
        }

        let parsed: AnnotationShape[] = [];
        try { parsed = JSON.parse(saved); } catch (err) { parsed = []; }

        imagesArr.push({ id: imageId, file_name: name, width: imgWidth, height: imgHeight });

        parsed.forEach((ann) => {
          if (ann.type === 'polygon') {
            const segmentation = ann.points.flatMap(p => [p.x, p.y]);
            const xs = ann.points.map(p => p.x);
            const ys = ann.points.map(p => p.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);
            const categoryId = (classes.findIndex(c => c.name === ann.label) + 1) || 1;

            // Calculate actual polygon area using the same method as altitude script
            const polygonArea = calculatePolygonArea(ann.points);

            annotationsArr.push({
              id: annId++,
              image_id: imageId,
              category_id: categoryId,
              segmentation: [segmentation],
              area: polygonArea,
              bbox: [minX, minY, maxX - minX, maxY - minY],
              iscrowd: 0
            });
          }
        });

        imageId++;
      }

      const coco = {
        info: {
          description: `${projectName ? `Project: ${projectName} | ` : ''}Dataset: ${datasetName || id}${annotationName ? ` | Annotation: ${annotationName}` : ''}`,
          version: '1.0',
          year: new Date().getFullYear(),
          contributor: 'LAI',
          date_created: new Date().toISOString()
        },
        images: imagesArr,
        categories: categoryMap,
        annotations: annotationsArr
      };

      const dataStr = JSON.stringify(coco, null, 2);

      // Always download the JSON file
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const fileName = `annotations_all_${id}.json`;

      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', fileName);
      link.click();

      // If in edit mode (annotationId exists), also update the database
      if (annotationId && api) {
        try {
          const file = new File([dataStr], annotationName || fileName, { type: 'application/json' });
          const response = await api.updateAnnotationContent(parseInt(id), annotationId, file);
          
          if (response.success) {
            toast({ 
              title: 'Saved & Updated', 
              description: `Exported ${annotationsArr.length} annotations from ${imagesArr.length} images and updated database annotation "${annotationName}"` 
            });
          } else {
            toast({ 
              title: 'Partially saved', 
              description: `Exported JSON file but failed to update database: ${response.error}`,
              variant: 'destructive'
            });
          }
        } catch (updateError) {
          console.error('Error updating annotation in database:', updateError);
          toast({ 
            title: 'Partially saved', 
            description: `Exported JSON file but failed to update database annotation`,
            variant: 'destructive'
          });
        }
      } else {
        // Not in edit mode, just show standard export message
        toast({ title: 'Saved', description: `Exported ${annotationsArr.length} annotations from ${imagesArr.length} images` });
      }
    } catch (err) {
      console.error('Error exporting all annotations', err);
      toast({ title: 'Export failed', description: 'Failed to export all annotations', variant: 'destructive' });
    }
  };

  // Clear all saved annotations from localStorage for this dataset
  const clearAllAnnotations = () => {
    if (!id) return;
    const confirmed = window.confirm('Delete ALL annotations for this dataset from localStorage? This cannot be undone.');
    if (!confirmed) return;

    const prefix = `annotations_${id}_`;
    let removed = 0;
    // Iterate backwards to safely remove keys while iterating
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (key.startsWith(prefix)) {
        localStorage.removeItem(key);
        removed++;
      }
    }

    // Reset in-memory annotations and class counts
    setAnnotations([]);
      setClasses([]); // Clear classes for fresh start
      localStorage.removeItem(`classes_${id}`); // Also clear persisted classes
    setClasses(prev => prev.map(c => ({ ...c, count: 0 })));
    setGlobalStats({});

    toast({ title: 'Annotations cleared', description: `Removed ${removed} saved annotation file(s) from localStorage` });
  };

  // Delete annotations for current image only
  const deleteCurrentImageAnnotations = async () => {
    if (!currentImageName || !id) return;

    setShowDeleteAllDialog(false); // Close the dialog

    const deletedCount = annotations.length;
    
    // Compute class counts BEFORE clearing annotations
    const countsByName: { [name: string]: number } = {};
    annotations.forEach((a: any) => {
      countsByName[a.label] = (countsByName[a.label] || 0) + 1;
    });

    // Clear in-memory annotations
    setAnnotations([]);
    
    // Save empty array to localStorage (don't remove the key, so overlay logic works)
    const storageKey = `annotations_${id}_${currentImageName}`;
    localStorage.setItem(storageKey, JSON.stringify([]));

    // Also update sessionStorage COCO data to remove annotations for this image
    try {
      const annotationFileRef = sessionStorage.getItem(`annotation_file_${id}`);
      if (annotationFileRef) {
        const fileData = JSON.parse(annotationFileRef);
        const cocoData = fileData.cocoData;
        
        if (cocoData && cocoData.annotations && cocoData.images) {
          // Find the image ID for this image name
          const imageEntry = findCocoImageForDatasetName(cocoData.images, currentImageName);
          if (imageEntry) {
            // Remove all annotations for this image from COCO data
            cocoData.annotations = cocoData.annotations.filter((ann: any) => ann.image_id !== imageEntry.id);
            
            // Save back to sessionStorage
            fileData.cocoData = cocoData;
            sessionStorage.setItem(`annotation_file_${id}`, JSON.stringify(fileData));
            console.log(`Removed annotations for ${currentImageName} from sessionStorage COCO data`);
          }
        }
      }
    } catch (e) {
      console.warn('Could not update sessionStorage:', e);
    }

    // Update global class counts by reducing the deleted annotation counts
    // Don't clear classes - they should persist across images
    setClasses(prev => {
      const updated = prev.map(c => ({
        ...c,
        count: Math.max(0, c.count - (countsByName[c.name] || 0))
      }));
      saveGlobalClasses(updated);
      return updated;
    });

    // Save deletion to database if in edit mode
    if (annotationId) {
      const saveSuccess = await saveCurrentImageToDatabase();
      if (saveSuccess) {
        // Set unsaved changes to false BEFORE recomputing stats
        setHasUnsavedChanges(false);
        lastSaveTimeRef.current = Date.now();
        
        // Recompute global stats after successful database save
        // Use a small delay to ensure backend has processed the update
        await new Promise(resolve => setTimeout(resolve, 500));
        await computeGlobalStats();
        
        toast({ 
          title: 'Annotations deleted', 
          description: `Removed ${deletedCount} annotation(s) from "${currentImageName}" and saved to database` 
        });
      } else {
        toast({ 
          title: 'Deletion saved locally', 
          description: `Removed ${deletedCount} annotation(s) but failed to save to database. Please try saving manually.`,
          variant: 'destructive'
        });
      }
    } else {
      // Recompute global stats even if not in edit mode
      await computeGlobalStats();
      toast({ 
        title: 'Annotations deleted', 
        description: `Removed ${deletedCount} annotation(s) from "${currentImageName}"` 
      });
    }
  };

  const handleBack = () => {
    const backUrl = projectId 
      ? `/projects/${projectId}/datasets/${id}` 
      : `/datasets/${id}`;
    
    // For new annotations (no annotationId), check if any annotations exist in localStorage
    // that haven't been saved to the database as an annotation file
    const hasUnsavedWork = annotationId 
      ? hasUnsavedChanges 
      : (hasUnsavedChanges || allImageNames.some(imageName => {
          const storageKey = `annotations_${id}_${imageName}`;
          const saved = localStorage.getItem(storageKey);
          return saved && saved !== '[]';
        }));

    if (hasUnsavedWork) {
      pendingNavigationRef.current = backUrl;
      setShowLeaveDialog(true);
    } else {
      navigate(backUrl);
    }
  };

  const handleLeaveConfirm = async (shouldSave: boolean) => {
    if (shouldSave) {
      if (annotationId) {
        // Edit mode: save directly to database
        await saveCurrentImageToDatabase();
        setHasUnsavedChanges(false);
        setShowLeaveDialog(false);
        if (pendingNavigationRef.current) {
          navigate(pendingNavigationRef.current);
          pendingNavigationRef.current = null;
        }
      } else {
        // New mode: need to ask for annotation file name first
        setShowLeaveDialog(false);
        navigateAfterSaveRef.current = true;
        setShowSaveDialog(true);
      }
    } else {
      setShowLeaveDialog(false);
      if (pendingNavigationRef.current) {
        navigate(pendingNavigationRef.current);
        pendingNavigationRef.current = null;
      }
    }
  };

  const navigateImage = useCallback(async (direction: 'prev' | 'next') => {
    const imageList = currentLayerImageNames.length > 0 ? currentLayerImageNames : allImageNames;
    if (imageList.length === 0) return;
    
    // Save current image annotations to localStorage and database before navigating
    if (currentImageName) {
      const storageKey = `annotations_${id}_${currentImageName}`;
      // Try to update localStorage - but don't fail if quota exceeded
      try {
        if (annotations.length > 0) {
          safeLocalStorageSet(storageKey, JSON.stringify(annotations));
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          console.warn('localStorage quota exceeded, relying on database save');
        } else {
          console.error('Error saving to localStorage:', e);
        }
      }
      // Save to database if in edit mode and has changes
      if (annotationId && hasUnsavedChanges) {
        await saveCurrentImageToDatabase();
        setHasUnsavedChanges(false);
        lastSaveTimeRef.current = Date.now();
        // Refresh statistics after saving
        await computeGlobalStats();
      }
    }
    
    const newIndex = direction === 'next' 
      ? Math.min(currentImageIndex + 1, imageList.length - 1)
      : Math.max(currentImageIndex - 1, 0);
    
    // Clean up localStorage - remove cached annotations for images that are far away (more than 5 images)
    try {
      for (let i = 0; i < imageList.length; i++) {
        if (Math.abs(i - newIndex) > 5) {
          const oldStorageKey = `annotations_${id}_${imageList[i]}`;
          if (localStorage.getItem(oldStorageKey)) {
            localStorage.removeItem(oldStorageKey);
          }
        }
      }
    } catch (e) {
      // Ignore cleanup errors
    }
      
    setCurrentImageIndex(newIndex);
    const newImageName = imageList[newIndex];
    setCurrentImageName(newImageName);
    
    // Load global classes when editing an existing annotation file (not when starting new segmentation)
    if (annotationId) loadGlobalClasses();
    
    // Update the currentImage object as well
    updateCurrentImages(newImageName, displayLayer, imageCollections);
    
    // Load annotations for the new image
    loadAnnotationsForImage(newImageName);
  }, [currentImageIndex, currentLayerImageNames, allImageNames, displayLayer, imageCollections, loadAnnotationsForImage, currentImageName, annotations, id, annotationId, hasUnsavedChanges, saveCurrentImageToDatabase]);

  // Keyboard shortcuts: Arrow keys or A/D for previous/next image navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      // Left arrow or A key for previous image
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        e.preventDefault();
        navigateImage('prev');
      }
      // Right arrow or D key for next image
      else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        e.preventDefault();
        navigateImage('next');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigateImage]);

  // Auto-save timer: check every 60 seconds if auto-save is needed
  useEffect(() => {
    if (!annotationId) return;

    const interval = setInterval(() => {
      autoSaveToDatabase();
    }, 60000); // Check every 60 seconds

    return () => clearInterval(interval);
  }, [annotationId, autoSaveToDatabase]);

  // Notify user when there are unsaved changes
  const prevHasUnsavedRef = useRef(false);
  useEffect(() => {
    if (hasUnsavedChanges && !prevHasUnsavedRef.current && annotationId) {
      toast({
        title: 'Unsaved changes',
        description: 'You have unsaved annotation changes. Click "Save Changes" to persist them.',
      });
    }
    prevHasUnsavedRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges, annotationId]);

  // Auto-save before navigating away from the page
  useEffect(() => {
    const handleBeforeUnload = async (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges && annotationId) {
        // Try to save immediately
        autoSaveToDatabase();
        
        // Show browser warning if there are unsaved changes
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, annotationId, autoSaveToDatabase]);

  const goToImage = async (index: number) => {
    const imageList = currentLayerImageNames.length > 0 ? currentLayerImageNames : allImageNames;
    if (index >= 0 && index < imageList.length) {
      // Save current image annotations to localStorage and database before navigating
      if (currentImageName) {
        const storageKey = `annotations_${id}_${currentImageName}`;
        // Try to update localStorage - but don't fail if quota exceeded
        try {
          if (annotations.length > 0) {
            safeLocalStorageSet(storageKey, JSON.stringify(annotations));
          } else {
            localStorage.removeItem(storageKey);
          }
        } catch (e) {
          if (e instanceof DOMException && e.name === 'QuotaExceededError') {
            console.warn('localStorage quota exceeded, relying on database save');
          } else {
            console.error('Error saving to localStorage:', e);
          }
        }
        // Save to database if in edit mode and has changes
        if (annotationId && hasUnsavedChanges) {
          await saveCurrentImageToDatabase();
          setHasUnsavedChanges(false);
          lastSaveTimeRef.current = Date.now();
        }
      }

      // Clean up localStorage - remove cached annotations for images that are far away (more than 5 images)
      try {
        for (let i = 0; i < imageList.length; i++) {
          if (Math.abs(i - index) > 5) {
            const oldStorageKey = `annotations_${id}_${imageList[i]}`;
            if (localStorage.getItem(oldStorageKey)) {
              localStorage.removeItem(oldStorageKey);
            }
          }
        }
      } catch (e) {
        // Ignore cleanup errors
      }

      setCurrentImageIndex(index);
      const newImageName = imageList[index];
      setCurrentImageName(newImageName);
      
      // Update the currentImage object as well
      updateCurrentImages(newImageName, displayLayer, imageCollections);
      
      // Load annotations for the new image
      loadAnnotationsForImage(newImageName);
      
      // Pre-load annotations for next 2 images in the background
      setTimeout(() => {
        for (let i = 1; i <= 2; i++) {
          const nextIndex = index + i;
          if (nextIndex < imageList.length) {
            const nextImageName = imageList[nextIndex];
            const storageKey = `annotations_${id}_${nextImageName}`;
            
            // Only pre-load if not already in localStorage
            if (!localStorage.getItem(storageKey)) {
              try {
                const annotationFileRef = sessionStorage.getItem(`annotation_file_${id}`);
                if (annotationFileRef) {
                  const fileData = JSON.parse(annotationFileRef);
                  const cocoData = fileData.cocoData;
                  
                  // Find and cache annotations for this image
                  const imageEntry = cocoData.images?.find((img: any) => img.file_name === nextImageName);
                  if (imageEntry) {
                    const imageAnnotations: any[] = [];
                    const categoryIdToName: { [id: string]: string } = {};
                    const categoryIdToColor: { [id: string]: string } = {};
                    
                    cocoData.categories?.forEach((cat: any, idx: number) => {
                      if (cat.id != null && cat.name) {
                        categoryIdToName[cat.id.toString()] = cat.name;
                        categoryIdToColor[cat.id.toString()] = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
                      }
                    });
                    
                    cocoData.annotations?.forEach((annotation: any) => {
                      if (annotation.image_id === imageEntry.id && annotation.segmentation && annotation.segmentation.length > 0) {
                        // Handle null category_id
                        if (annotation.category_id == null) {
                          return;
                        }
                        const raw = annotation.segmentation;
                        const segmentation: number[] = Array.isArray(raw[0]) ? (raw[0] as number[]) : (raw as number[]);
                        if (segmentation.length >= 6) {
                          const points = [];
                          
                          // Detect and fix abnormally large coordinates
                          const firstX = segmentation[0];
                          const firstY = segmentation[1];
                          const isAbnormallyLarge = firstX > 10000 || firstY > 10000;
                          const scaleFactor = isAbnormallyLarge && imageEntry.width && imageEntry.height
                            ? { x: imageEntry.width, y: imageEntry.height }
                            : { x: 1, y: 1 };
                          
                          for (let j = 0; j < segmentation.length; j += 2) {
                            let x = segmentation[j] / scaleFactor.x;
                            let y = segmentation[j + 1] / scaleFactor.y;
                            
                            // Filter out invalid coordinates
                            if (isNaN(x) || isNaN(y) || !isFinite(x) || !isFinite(y)) {
                              continue;
                            }
                            
                            // Clamp to image bounds
                            if (imageEntry.width && imageEntry.height) {
                              x = Math.max(0, Math.min(x, imageEntry.width - 1));
                              y = Math.max(0, Math.min(y, imageEntry.height - 1));
                            }
                            
                            points.push({ x, y });
                          }
                          
                          // Only add if we have at least 3 valid points
                          if (points.length >= 3) {
                            const className = categoryIdToName[annotation.category_id.toString()];
                            if (className) {
                              imageAnnotations.push({
                                id: `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                type: 'polygon',
                                points,
                                label: className,
                                color: categoryIdToColor[annotation.category_id.toString()] || DEFAULT_COLORS[0],
                                visible: true
                              });
                            }
                          }
                        }
                      }
                    });
                    
                    if (imageAnnotations.length > 0) {
                      safeLocalStorageSet(storageKey, JSON.stringify(imageAnnotations));
                      console.log(`Pre-loaded ${imageAnnotations.length} annotations for ${nextImageName}`);
                    }
                  }
                }
              } catch (e) {
                // Silently fail pre-loading
                console.warn(`Could not pre-load annotations for ${nextImageName}:`, e);
              }
            }
          }
        }
      }, 100);
    }
  };

  const handleLayerChange = (layerId: string) => {
    setIsLayerSwitching(true);
    layerSwitchCounterRef.current += 1;
    preserveZoomRef.current = false;
    preventZoomResetRef.current = false;
    setDisplayLayer(layerId);
    // Display bitmap + noCorrespondingImage are synced in the effect that calls updateCurrentImages when displayLayer changes
    // Force a refit after layer switch to ensure proper image sizing
    setTimeout(() => {
      // Ensure zoom isn't preserved from previous layer
      preserveZoomRef.current = false;
      preventZoomResetRef.current = false;
      // Force refit to fit new layer's image dimensions
      if (imageRef.current && imageRef.current.complete && imageRef.current.naturalWidth > 0) {
        handleImageResize(true);
      }
    }, 50);
  };

  // If layer switch leaves nothing to load (no img onLoad), clear the switching overlay.
  // Covers two cases: (1) no image at all, and (2) an explicit display layer was picked
  // but the current image doesn't exist in that layer — in both cases the <img> element
  // is unmounted, so handleImageLoad never fires and the overlay would otherwise be stuck.
  useEffect(() => {
    if (!isLayerSwitching) return;
    const hasBitmap = displayLayer ? !!displayImage : !!(displayImage || currentImage);
    if (!hasBitmap) {
      setIsLayerSwitching(false);
    }
  }, [isLayerSwitching, displayImage, currentImage, displayLayer]);

  const handleMainLayerChange = (layerId: string) => {
    setMainLayer(layerId);
    
    // Update the navigation list to use the new main layer
    const mainLayerCollection = imageCollections.find(c => String(c.id) === String(layerId));
    if (mainLayerCollection) {
      const mainLayerImageNames = mainLayerCollection.images.map(img => img.fileName).sort();
      setCurrentLayerImageNames(mainLayerImageNames);
      
      // Reset to the first image in the new main layer
      if (mainLayerImageNames.length > 0) {
        setCurrentImageIndex(0);
        const firstImageName = mainLayerImageNames[0];
        setCurrentImageName(firstImageName);
        updateCurrentImages(firstImageName, displayLayer, imageCollections);
        loadAnnotationsForImage(firstImageName);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading images...</p>
        </div>
      </div>
    );
  }

  if (!currentImage && !displayImage) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <p className="text-muted-foreground">No images found in this dataset</p>
          <Button onClick={handleBack} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dataset
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-card border-b border-border">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">Segmentation Annotation</h1>
              {annotationId && annotationName && (
                <Badge variant="outline" className="text-xs border-primary/40 text-primary">
                  Editing {annotationName}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Image {currentImageIndex + 1} of {allImageNames.length}: {currentImage?.fileName || currentImageName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 relative">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          {/* Save button - unified for both new and edit modes */}
          {!annotationId ? (
            <Button 
              onClick={() => {
                const hasAnnotations = allImageNames.some(imageName => {
                  const storageKey = `annotations_${id}_${imageName}`;
                  const saved = localStorage.getItem(storageKey);
                  return saved && saved !== '[]';
                });
                
                if (!hasAnnotations) {
                  toast({ 
                    title: 'No annotations', 
                    description: 'Please create some annotations before saving',
                    variant: 'destructive'
                  });
                  return;
                }
                
                setShowSaveDialog(true);
              }}
              disabled={!id || isSavingAnnotation || !allImageNames.some(imageName => {
                const storageKey = `annotations_${id}_${imageName}`;
                const saved = localStorage.getItem(storageKey);
                return saved && saved !== '[]';
              })}
              title="Save annotations as new annotation file"
            >
              {isSavingAnnotation ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          ) : (
            <Button 
              onClick={async () => {
                const success = await saveCurrentImageToDatabase();
                if (success) {
                  setHasUnsavedChanges(false);
                  lastSaveTimeRef.current = Date.now();
                  toast({ 
                    title: 'Saved', 
                    description: `Changes for "${currentImageName}" saved to database` 
                  });
                } else {
                  toast({ 
                    title: 'Save failed', 
                    description: 'Failed to save changes to database',
                    variant: 'destructive'
                  });
                }
              }}
              disabled={!currentImageName || annotations.length === 0}
              title="Save current image annotations to database"
            >
              <Save className="w-4 h-4 mr-2" />
              Save Changes
            </Button>
          )}

          {/* Status badges - shown in both modes */}
          {isAutoSaving && (
            <Badge variant="outline" className="gap-1.5 border-muted-foreground/30 text-muted-foreground animate-pulse">
              <Loader2 className="w-3 h-3 animate-spin" />
              Saving…
            </Badge>
          )}
          
          {!isAutoSaving && hasUnsavedChanges && (
            <Badge variant="outline" className="gap-1.5 border-yellow-500/40 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              <AlertCircle className="w-3 h-3" />
              Unsaved
            </Badge>
          )}
          
          {!isAutoSaving && !hasUnsavedChanges && (annotations.length > 0 || annotationId) && (
            <Badge variant="outline" className="gap-1.5 border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400">
              <Check className="w-3 h-3" />
              Saved
            </Badge>
          )}

          <Button 
            onClick={downloadAnnotationsJSON} 
            disabled={!hasAnyAnnotationsStored}
            title="Download COCO JSON file with all annotations"
            variant="outline"
          >
            <Download className="w-4 h-4 mr-2" />
            Download JSON
          </Button>

          <Button
            variant="destructive"
            size="sm"
            onClick={clearAllAnnotations}
            disabled={!hasAnyAnnotationsStored}
            title="Delete all saved annotations from localStorage"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete All
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={resetZoomAndPan}
            aria-label="Reset zoom and pan to default view"
            title="Reset zoom and pan to default view"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowHelp(v => !v)}
            aria-label="Zoom & Pan help"
            title="Zoom & Pan help"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>

          {showHelp && (
            <div className="absolute right-0 top-full mt-2 z-50 w-[280px]">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-sm">Zoom & Pan</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  <div className="mb-1"><strong>Zoom</strong>: Hold <kbd className="px-1 bg-muted rounded">Ctrl</kbd> (or <kbd className="px-1 bg-muted rounded">⌘</kbd>) + scroll</div>
                  <div className="mb-1"><strong>Pan</strong>: Middle-button drag, hold <kbd className="px-1 bg-muted rounded">Space</kbd> + drag, <strong>Ctrl</strong> + left/right drag, or <strong>Right + Left</strong> click drag</div>
                  <div className="mb-1"><strong>Reset View</strong>: Press <kbd className="px-1 bg-muted rounded">R</kbd> or click the reset button</div>
                  <div className="mb-1"><strong>Select</strong>: Press <kbd className="px-1 bg-muted rounded">V</kbd> | <strong>Polygon</strong>: <kbd className="px-1 bg-muted rounded">P</kbd> | <strong>SAM</strong>: <kbd className="px-1 bg-muted rounded">A</kbd></div>
                  <div className="text-xs text-muted-foreground/70 mt-1">Tip: scroll over area you want to zoom into</div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </header>

  <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar - Tools and Classes (collapsible & resizable) */}
        <div
           className="bg-card border-r border-border flex flex-col overflow-hidden"
          style={{ width: leftCollapsed ? 0 : leftWidth, minWidth: leftCollapsed ? 0 : undefined }}
        >
          <div className="p-2 border-b border-border flex items-center justify-between">
            <div className="text-sm font-medium">Tools</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setLeftCollapsed(v => !v)}>
                {leftCollapsed ? <ChevronRight className="w-4 h-4"/> : <ChevronLeft className="w-4 h-4"/>}
              </Button>
            </div>
          </div>
          {/* Tools section moved inside content below */}
          {/* Tools */}
          <div className="p-4 border-b border-border">
            <h3 className="text-sm font-medium mb-3">Tools</h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={activeTool === 'select' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setActiveTool('select')}
              >
                <MousePointer2 className="w-4 h-4 mr-1" />
                Select
              </Button>
              <Button
                variant={activeTool === 'polygon' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (!ensureClassForDrawingTools()) return;
                  setActiveTool('polygon');
                }}
              >
                <Square className="w-4 h-4 mr-1" />
                Polygon
              </Button>
              <Button
                variant={activeTool === 'auto-segment' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (!ensureClassForDrawingTools()) return;
                  setActiveTool('auto-segment');
                  setSamPoints([]);
                }}
                disabled={isSamProcessing}
                title={
                  isSamProcessing
                    ? 'Processing segmentation...'
                    : 'Click on image to segment (backend SAM)'
                }
              >
                {isSamProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Hexagon className="w-4 h-4 mr-1" />
                    AI Segment
                  </>
                )}
              </Button>
              {activeTool === 'auto-segment' && samPoints.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-white"
                  onClick={() => setSamPoints([])}
                  title="Clear SAM points"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="mt-2">
              <Label className="text-xs text-muted-foreground">Segment with</Label>
              <Select
                value={segmentModel}
                onValueChange={(v: 'sam2' | 'sam3') => setSegmentModel(v)}
                disabled={classes.length === 0}
              >
                <SelectTrigger
                  className="h-8 text-xs bg-muted border-border mt-1"
                  title={classes.length === 0 ? 'Add at least one class first' : undefined}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sam2">SAM 2 (point)</SelectItem>
                  <SelectItem
                    value="sam3"
                    disabled={!sam3Available}
                    title={
                      !sam3Available
                        ? 'SAM 3: set SAM3_MODELS_HOST_PATH + SAM3_CHECKPOINT_FILENAME in .env (run lai install), or SAM3_ALLOW_HF_DOWNLOAD=true + HF_TOKEN'
                        : undefined
                    }
                  >
                    SAM 3 (point / text){!sam3Available ? ' — not available' : ''}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {segmentModel === 'sam3' && (
              <>
                <div className="mt-2">
                  <Label className="text-xs text-muted-foreground">Text prompt (optional)</Label>
                  <Input
                    className="h-8 text-xs bg-muted border-border mt-1 placeholder:text-muted-foreground focus-visible:ring-ring"
                    placeholder="e.g. dog, person, red car"
                    value={segmentTextPrompt}
                    onChange={(e) => setSegmentTextPrompt(e.target.value)}
                    title="Describe what to segment. Leave empty to use point/box only (segment under click)."
                  />
                </div>
                <div className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs"
                    disabled={
                      isApplyingAllImages ||
                      !segmentTextPrompt.trim() ||
                      !selectedClass ||
                      imageCollections.find((c) => String(c.id) === mainLayer)?.images.length === 0
                    }
                    onClick={applySam3OnAllImages}
                    title="Run SAM 3 text segmentation on every image in the current layer and add annotations for the selected class"
                  >
                    {isApplyingAllImages && applyAllProgress ? (
                      <>
                        <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                        Applying {applyAllProgress.current}/{applyAllProgress.total}
                      </>
                    ) : (
                      <>
                        <Layers className="w-3 h-3 mr-1.5" />
                        Apply on all images
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Left: tools and classes only (Image Layers moved to bottom) */}

          {/* Classes */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">Classes</h3>
                <Button 
                  size="sm" 
                  variant="outline"
                  aria-label="Add new class"
                  onClick={() => setIsAddingClass(true)}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {isAddingClass && (
                <div className="flex gap-2 mb-3">
                  <Input
                    placeholder="Class name"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addClass();
                      if (e.key === 'Escape') {
                        setIsAddingClass(false);
                        setNewClassName('');
                      }
                    }}
                    className="h-8"
                    autoFocus
                  />
                  <Button size="sm" onClick={addClass}>
                    <Check className="w-4 h-4" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => {
                      setIsAddingClass(false);
                      setNewClassName('');
                    }}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              )}
            </div>

            <ScrollArea className="flex-1 scrollbar-thin">
              <div className="p-4 space-y-2">
                  {classes.map((classObj, idx) => (
                    <div
                      key={classObj.id}
                      className={`p-2 rounded border cursor-pointer transition-colors ${
                        selectedClass === classObj.id 
                          ? 'border-primary bg-primary/20' 
                          : 'border-border hover:border-muted-foreground/50'
                      }`}
                      onClick={() => {
                        if (editingClassId !== classObj.id) {
                          setSelectedClass(classObj.id);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                className="w-4 h-4 rounded flex-shrink-0 ring-offset-background transition-all hover:ring-2 hover:ring-ring hover:ring-offset-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                style={{ backgroundColor: classObj.color }}
                                onClick={(e) => e.stopPropagation()}
                                title="Change class color"
                              />
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-3" align="start" side="right">
                              <div className="grid grid-cols-5 gap-1.5">
                                {DEFAULT_COLORS.map((color) => (
                                  <button
                                    key={color}
                                    className={`w-6 h-6 rounded-md border-2 transition-all hover:scale-110 ${
                                      classObj.color === color ? 'border-foreground ring-1 ring-ring' : 'border-transparent'
                                    }`}
                                    style={{ backgroundColor: color }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setClasses(prev => {
                                        const updated = prev.map(c => c.id === classObj.id ? { ...c, color } : c);
                                        saveGlobalClasses(updated);
                                        return updated;
                                      });
                                      setAnnotations(prev => prev.map(a => a.label === classObj.name ? { ...a, color } : a));
                                      setHasUnsavedChanges(true);
                                    }}
                                  />
                                ))}
                              </div>
                              <Separator className="my-2" />
                              <div className="flex items-center gap-2">
                                <label className="text-xs text-muted-foreground">Custom:</label>
                                <input
                                  type="color"
                                  value={classObj.color}
                                  onChange={(e) => {
                                    const color = e.target.value;
                                    setClasses(prev => {
                                      const updated = prev.map(c => c.id === classObj.id ? { ...c, color } : c);
                                      saveGlobalClasses(updated);
                                      return updated;
                                    });
                                    setAnnotations(prev => prev.map(a => a.label === classObj.name ? { ...a, color } : a));
                                    setHasUnsavedChanges(true);
                                  }}
                                  className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            </PopoverContent>
                          </Popover>
                          {editingClassId === classObj.id ? (
                            <div className="flex items-center gap-1 flex-1">
                              <Input
                                value={editingClassName}
                                onChange={(e) => setEditingClassName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveEditingClass();
                                  if (e.key === 'Escape') cancelEditingClass();
                                }}
                                className="h-6 text-sm py-0 px-1"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  saveEditingClass();
                                }}
                              >
                                <Check className="w-3 h-3 text-green-500" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cancelEditingClass();
                                }}
                              >
                                <X className="w-3 h-3 text-gray-400" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-sm truncate">{classObj.name}</span>
                          )}
                        </div>

                        {editingClassId !== classObj.id && (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                               className="h-6 w-6 p-0 hover:bg-muted"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditingClass(classObj.id, classObj.name);
                              }}
                              title="Rename class"
                            >
                              <Edit className="w-3 h-3 text-primary" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 hover:bg-muted"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteClass(classObj.id);
                              }}
                              title="Delete class"
                            >
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </Button>
                            {/* Shortcut hint */}
                            <div className="text-xs text-muted-foreground px-1.5 py-0.5 rounded border border-border ml-1">
                              {idx + 1}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </ScrollArea>
          </div>
          {/* Resize handle at the right edge of left sidebar */}
          {!leftCollapsed && (
            <div
              className="absolute left-[--dummy] top-0 bottom-0 w-2 cursor-col-resize"
              style={{ left: `calc(${leftWidth}px - 2px)` }}
              onMouseDown={startResizeLeft}
            />
          )}
        </div>

        {/* Floating expand button when left sidebar is collapsed */}
        {leftCollapsed && (
          <div className="absolute left-2 top-1/2 -translate-y-1/2 z-50">
            <Button
              size="sm"
              onClick={() => {
                setLeftCollapsed(false);
                setTimeout(() => { try { window.dispatchEvent(new Event('annotation-panel-resize-end')); } catch (err) {} }, 20);
              }}
              aria-label="Expand left panel"
              className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg rounded-full p-1"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Main Canvas Area */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 flex min-h-0">
          <div 
            ref={containerRef}
            className="flex-1 relative overflow-hidden bg-muted/30 min-w-0"
          >
            {/**
             * The canvas must render the bitmap for the *selected display layer*. When a
             * display layer is active we only show `displayImage` (which was looked up in
             * that specific layer); falling back to `currentImage` would mean switching
             * from e.g. "RGB Images" to "Depth" kept showing the RGB bitmap. When no
             * display layer is set (initial state), we still allow `currentImage` as a
             * fallback so the canvas isn't blank during bootstrap.
             */}
            {(() => {
              const bitmap = displayLayer ? displayImage : (displayImage || currentImage);
              return bitmap ? (
              <>
                <img
                  key={`layer-${layerSwitchCounterRef.current}-${displayLayer}`}
                  ref={imageRef}
                  src={bitmap.url || ''}
                  alt={bitmap.fileName || 'Current image'}
                  className="absolute opacity-0"
                  onLoad={handleImageLoad}
                  onError={(e) => {
                    console.error('Image failed to load:', e);
                    console.error('Image src:', bitmap.url);
                  }}
                  crossOrigin="anonymous"
                />
                <canvas
                  ref={canvasRef}
                  className={`absolute w-full h-full ${activeTool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onDoubleClick={handleCanvasDoubleClick}
                  onContextMenu={handleCanvasRightClick}
                />
                {/* Show loading overlay during layer switching */}
                {isLayerSwitching && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-10">
                    <div className="text-center text-white">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                      <div className="text-sm">Switching layer...</div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <div className="text-2xl mb-2">📷</div>
                  {noCorrespondingImage && displayLayer ? (
                    <>
                      <div className="text-lg font-medium">No corresponding image found</div>
                      <div className="text-sm">
                        Image "{currentImageName}" not found in {imageCollections.find(c => String(c.id) === String(displayLayer))?.name || 'this layer'}
                      </div>
                      <div className="text-xs mt-2 text-muted-foreground/70">Switch to a different layer or choose another image</div>
                    </>
                  ) : (
                    <>
                      <div className="text-lg font-medium">No Image Available</div>
                      <div className="text-sm">
                        Image "{currentImageName}" does not exist in {imageCollections.find(c => String(c.id) === String(displayLayer))?.name || 'this layer'}
                      </div>
                      <div className="text-xs mt-2 text-muted-foreground/70">Switch to a different layer or navigate to another image</div>
                    </>
                  )}
                </div>
              </div>
            );
            })()}

            {/* Drawing Instructions */}
            {isDrawing && activeTool === 'polygon' && (
              <div className="absolute top-4 left-4 bg-background/90 backdrop-blur-sm border border-border text-foreground px-4 py-2 rounded-lg text-sm z-10">
                <div className="flex flex-col gap-1">
                  <div className="font-semibold">Drawing Polygon ({currentPath.length} points)</div>
                  <div className="text-xs text-muted-foreground">
                    • Click to add points
                    • <strong>Double-click</strong> to finish
                    • <strong>Right-click</strong> to finish  
                    • <strong>Enter</strong> to finish
                    • <strong>Esc</strong> to cancel
                  </div>
                  {currentPath.length < 3 && (
                    <div className="text-xs text-yellow-500">
                      Need at least 3 points to finish
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Auto-segment preview overlay with accept/cancel controls */}
            {autoSegmentPreview && (
              <div className="absolute inset-0 pointer-events-none">
                {/* show mask image if available */}
                {autoSegmentPreview.maskDataUrl && (
                  <img src={autoSegmentPreview.maskDataUrl} alt="mask preview" className="absolute inset-0 w-full h-full object-contain opacity-60 pointer-events-none" />
                )}

                {/* draw polygon outlines on top using an SVG overlay */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none">
                  {autoSegmentPreview.polygons.map((poly, i) => (
                    <polyline
                      key={i}
                      points={poly.map(p => `${(p.x * imageScale + imageOffset.x).toFixed(2)},${(p.y * imageScale + imageOffset.y).toFixed(2)}`).join(' ')}
                      fill="none"
                      stroke="#00FFAA"
                      strokeWidth={2}
                    />
                  ))}
                </svg>

                {/* Controls - accept/cancel */}
                <div className="absolute right-6 bottom-6 z-40 pointer-events-auto flex flex-col gap-2 w-64 bg-card/90 backdrop-blur-sm border border-border p-3 rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    Left-click: add to mask. Right-click: remove from mask. Add more points to refine. Press Enter to accept.
                  </p>
                  <div className="flex gap-2">
                    <Select value={autoSegmentClassId || ''} onValueChange={(v) => {
                      const idVal = v || null;
                      setAutoSegmentClassId(idVal);
                    }}>
                      <SelectTrigger className="w-36"><SelectValue placeholder="Class" /></SelectTrigger>
                      <SelectContent>
                        {classes.map(c => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-end gap-2 mt-2">
                    <Button size="sm" onClick={acceptAutoSegment}>Accept</Button>
                    <Button size="sm" variant="outline" onClick={cancelAutoSegment}>Cancel</Button>
                  </div>
                </div>
              </div>
            )}

            {/* Minimap */}
            <AnnotationMinimap
              imageRef={imageRef}
              containerRef={containerRef}
              imageScale={imageScale}
              imageOffset={imageOffset}
              onNavigate={(offset) => setImageOffset(offset)}
            />
          </div>

          {/* Image Navigation */}
          <div className="p-3 bg-card border-t border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToImage(currentImageIndex - 1)}
                  disabled={currentImageIndex === 0}
                >
                  Previous
                </Button>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {currentImageIndex + 1} / {currentLayerImageNames.length > 0 ? currentLayerImageNames.length : allImageNames.length}
                  </span>
                  {currentLayerImageNames.length > 0 && (
                    <span className="text-xs text-primary">
                      ({imageCollections.find(c => String(c.id) === mainLayer)?.name || 'layer'})
                    </span>
                  )}
                  {currentImageName && (
                    <span className="text-xs text-muted-foreground/70">
                      {currentImageName}
                    </span>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToImage(currentImageIndex + 1)}
                  disabled={currentImageIndex === (currentLayerImageNames.length > 0 ? currentLayerImageNames.length : allImageNames.length) - 1}
                >
                  Next
                </Button>
              </div>

              {/* Display Layer Selector — always show when at least one collection exists so the current layer is visible and can be switched */}
              {imageCollections.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Layer:</span>
                  <Select value={displayLayer} onValueChange={handleLayerChange}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {imageCollections.map(collection => (
                        <SelectItem key={collection.id} value={String(collection.id)}>
                          {collection.name} ({collection.images.length} images)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Warning for missing image */}
                  {!displayImage && currentImageName && displayLayer && (
                    <span className="text-xs text-yellow-500">
                      Image "{currentImageName}" not available in {imageCollections.find(c => String(c.id) === String(displayLayer))?.name || 'this layer'}
                    </span>
                  )}

                  {/* Calibration enable/disable toggle — shown whenever a calibration exists between collections */}
                  {calibrations.length > 0 && displayLayer && (
                    <button
                      onClick={() => setCalibrationEnabled(prev => !prev)}
                      className={`inline-flex items-center gap-1 text-xs font-medium rounded-md px-2 py-0.5 whitespace-nowrap border transition-colors ${
                        calibrationIsActive && calibrationEnabled
                          ? 'text-primary bg-primary/10 border-primary/30 hover:bg-primary/20'
                          : 'text-muted-foreground bg-muted border-border hover:bg-muted/80'
                      }`}
                      title={calibrationEnabled ? 'Calibration is ON — click to disable coordinate mapping' : 'Calibration is OFF — click to enable coordinate mapping'}
                    >
                      <Crosshair className="h-3 w-3" />
                      {calibrationEnabled ? 'Calibration ON' : 'Calibration OFF'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
            {/* Companion layers — read-only side-by-side view of the same image
                from other collections, with shared annotations overlaid. */}
            <CompanionLayersPanel
              collections={imageCollections}
              primaryCollectionId={mainLayer || (displayLayer ?? '')}
              primaryImage={displayImage || currentImage}
              imageName={currentImageName}
              annotations={annotations}
              calibrations={calibrations}
              projectId={projectId ?? null}
            />
          </div>

          {/* Status Bar */}
          <AnnotationStatusBar
            cursorPosition={cursorImagePosition}
            zoom={imageScale}
            imageWidth={imageRef.current?.naturalWidth || 0}
            imageHeight={imageRef.current?.naturalHeight || 0}
            annotationCount={annotations.length}
            currentImageIndex={currentImageIndex}
            totalImages={currentLayerImageNames.length > 0 ? currentLayerImageNames.length : allImageNames.length}
            hasUnsavedChanges={hasUnsavedChanges}
            isAutoSaving={isAutoSaving}
            activeTool={activeTool}
          />
        </div>

  {/* Right Sidebar - Annotations Panel (redesigned container) */}
        <div
           className="bg-card border-l border-border flex flex-col overflow-hidden"
          style={{ width: rightCollapsed ? 0 : rightWidth, minWidth: rightCollapsed ? 0 : undefined }}
        >
          {/* Panel Header */}
          <div className="bg-card border-b border-border p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-primary rounded-full"></div>
                <h2 className="text-sm font-semibold">Annotations Panel</h2>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setRightCollapsed(v => !v)}>
                {rightCollapsed ? <ChevronLeft className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
              </Button>
            </div>
            
            {/* Navigation Layer Selector — shown whenever collections exist so the current layer is always visible */}
            {imageCollections.length > 0 && !rightCollapsed && (
              <div className="mt-3 p-2 bg-muted rounded border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted-foreground">Navigation Layer:</span>
                </div>
                <Select value={mainLayer} onValueChange={handleMainLayerChange}>
                  <SelectTrigger className="w-full h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {imageCollections.map(collection => (
                      <SelectItem key={collection.id} value={String(collection.id)}>
                        {collection.name} ({collection.images.length} images)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-xs text-primary mt-1">
                  Controls which images are available for browsing
                </div>
              </div>
            )}
          </div>

          {/* Panel Content */}
          <div className="flex-1 flex flex-col min-h-0 bg-card">
            <Tabs value={activePanelTab} onValueChange={setActivePanelTab} className="h-full flex flex-col">
              {/* Tab Navigation */}
              <div className="border-b border-border">
                <TabsList className="grid grid-cols-2 w-full bg-transparent border-0 p-1">
                  <TabsTrigger 
                    value="annotations" 
                    className="data-[state=active]:bg-accent data-[state=active]:text-foreground text-muted-foreground text-xs"
                  >
                    Annotations ({annotations.length})
                  </TabsTrigger>
                  <TabsTrigger 
                    value="statistics" 
                    className="data-[state=active]:bg-accent data-[state=active]:text-foreground text-muted-foreground text-xs"
                  >
                    Statistics
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Annotations Tab */}
              <TabsContent value="annotations" className="flex-1 flex flex-col min-h-0 overflow-hidden m-0 p-0">
                <div className="p-3 border-b border-border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Current Image Annotations</span>
                      <span className="bg-muted px-2 py-1 rounded">{annotations.length}</span>
                    </div>
                    {annotations.length > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setShowDeleteAllDialog(true)}
                        title="Delete all annotations for this image"
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Delete All
                      </Button>
                    )}
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 scrollbar-thin" style={{ scrollbarWidth: 'thin' }}>
                  {annotations.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-center">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                        <Square className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">No annotations yet</p>
                      <p className="text-xs text-muted-foreground/70">Select a class and start drawing!</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {annotations.map((annotation, index) => {
                        return (
                        <div 
                          key={annotation.id}
                          data-annotation-id={annotation.id}
                          className={`group border rounded-lg p-3 cursor-pointer transition-all duration-200 ${
                            selectedAnnotation === annotation.id 
                              ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20' 
                              : 'border-border bg-muted/50 hover:border-muted-foreground/30 hover:bg-muted'
                          }`}
                          onClick={() => {
                            console.log('Card clicked, setting selectedAnnotation to:', annotation.id);
                            setSelectedAnnotation(annotation.id);
                          }}
                        >
                          <div className="flex items-start justify-between">
                            {/* Left side - Color indicator and content */}
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <div 
                                className="w-4 h-4 rounded-md border border-border flex-shrink-0 mt-0.5"
                                style={{ backgroundColor: annotation.color }}
                              />
                              <div className="flex-1 min-w-0">
                                {editingAnnotationId === annotation.id ? (
                                  <div className="space-y-2">
                                    <Select value={editingAnnotationLabel || ''} onValueChange={(v) => setEditingAnnotationLabel(v)}>
                                      <SelectTrigger className="w-full h-8 text-sm bg-muted border-border">
                                        <SelectValue placeholder="Select class" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {classes.map(c => (
                                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <div className="flex justify-end gap-1">
                                      <Button 
                                        size="sm" 
                                        className="h-7 px-2 text-xs"
                                        onClick={() => { 
                                          saveAnnotationLabel(annotation.id, editingAnnotationLabel); 
                                          setEditingAnnotationId(null); 
                                        }}
                                      >
                                        Save
                                      </Button>
                                      <Button 
                                        size="sm" 
                                        variant="outline" 
                                        className="h-7 px-2 text-xs"
                                        onClick={() => setEditingAnnotationId(null)}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <p 
                                      className="text-sm font-medium cursor-pointer hover:text-foreground transition-colors truncate"
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        setEditingAnnotationId(annotation.id); 
                                        const cls = classes.find(c => c.name === annotation.label); 
                                        setEditingAnnotationLabel(cls ? cls.id : ''); 
                                      }}
                                    >
                                      #{index + 1} {annotation.label}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1">
                                      {annotation.type === 'polygon' && annotation.points && annotation.points.length >= 3 && (
                                        <span className="text-xs text-primary" title="Area in image coordinates">
                                          Area: {formatArea(calculatePolygonArea(annotation.points))}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Right side - Action buttons */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-7 h-7 p-0 hover:bg-muted"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAnnotations(prev => prev.map(a => 
                                    a.id === annotation.id 
                                      ? { ...a, visible: !a.visible }
                                      : a
                                  ));
                                  setHasUnsavedChanges(true);
                                }}
                                title={annotation.visible ? "Hide annotation" : "Show annotation"}
                              >
                                {annotation.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-7 h-7 p-0 hover:bg-muted"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingAnnotationId(annotation.id);
                                  const cls = classes.find(c => c.name === annotation.label);
                                  setEditingAnnotationLabel(cls ? cls.id : '');
                                }}
                                title="Edit annotation"
                              >
                                <Edit className="w-3 h-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-7 h-7 p-0 hover:bg-red-600/20 hover:text-red-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteAnnotation(annotation.id);
                                }}
                                title="Delete annotation"
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Statistics Tab */}
              <TabsContent value="statistics" className="flex-1 flex flex-col min-h-0 overflow-hidden m-0 p-0">
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin">
                  <div className="p-3">
                  {(() => {
                    // Merge saved globalStats with unsaved current-image annotations
                    const mergedStats: { [name: string]: number } = { ...globalStats };
                    const unsavedCounts: { [name: string]: number } = {};
                    if (hasUnsavedChanges && annotations.length > 0) {
                      annotations.forEach(a => {
                        if (a.label) {
                          unsavedCounts[a.label] = (unsavedCounts[a.label] || 0) + 1;
                        }
                      });
                      // Add unsaved counts on top of saved stats
                      Object.entries(unsavedCounts).forEach(([name, count]) => {
                        mergedStats[name] = (mergedStats[name] || 0) + count;
                      });
                    }

                    const total = Object.values(mergedStats).reduce((s, v) => s + v, 0);
                    const sortedClasses = [...classes].sort((a, b) => (mergedStats[b.name] || 0) - (mergedStats[a.name] || 0));
                    const maxCount = sortedClasses.length > 0 ? (mergedStats[sortedClasses[0]?.name] || 0) : 0;

                    if (classes.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center h-32 text-center">
                          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                            <BarChart className="w-6 h-6 text-muted-foreground" />
                          </div>
                          <p className="text-sm text-muted-foreground">No classes defined yet</p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3">
                        {/* Summary row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <BarChart className="h-3.5 w-3.5" />
                            <span>{sortedClasses.length} {sortedClasses.length === 1 ? 'class' : 'classes'}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-lg font-bold text-foreground">{total.toLocaleString()}</span>
                            <span className="text-xs text-muted-foreground">annotations</span>
                          </div>
                        </div>

                        {/* Unsaved indicator */}
                        {hasUnsavedChanges && annotations.length > 0 && (
                          <div className="flex items-center gap-1.5 text-[11px] text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Includes {annotations.length} unsaved annotation{annotations.length !== 1 ? 's' : ''} from current image
                          </div>
                        )}

                        {/* Distribution bar */}
                        <div className="h-2.5 w-full flex rounded-full overflow-hidden bg-muted/50">
                          {sortedClasses.map((c) => {
                            const count = mergedStats[c.name] || 0;
                            const pct = total > 0 ? (count / total) * 100 : 0;
                            return (
                              <div
                                key={c.id}
                                className="transition-all duration-300 hover:opacity-80 first:rounded-l-full last:rounded-r-full"
                                style={{
                                  backgroundColor: c.color,
                                  width: `${pct}%`,
                                  minWidth: pct > 0 ? '3px' : '0',
                                }}
                                title={`${c.name}: ${count} (${Math.round(pct)}%)`}
                              />
                            );
                          })}
                        </div>

                        {/* Class rows */}
                        <div className="space-y-1">
                          {sortedClasses.map((c) => {
                            const count = mergedStats[c.name] || 0;
                            const pct = total > 0 ? (count / total) * 100 : 0;
                            const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;
                            const avgArea = globalAvgAreas[c.name] || 0;
                            const hasUnsaved = (unsavedCounts[c.name] || 0) > 0;

                            return (
                              <div
                                key={c.id}
                                className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/40 transition-all duration-150"
                              >
                                {/* Color dot */}
                                <span
                                  className="w-3 h-3 rounded-sm flex-shrink-0 ring-1 ring-black/10"
                                  style={{ backgroundColor: c.color }}
                                />

                                {/* Name + bar */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-0.5">
                                    <span className="text-xs font-medium text-foreground truncate pr-2">
                                      {c.name}
                                    </span>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <span className="text-[11px] tabular-nums text-muted-foreground">
                                        {count.toLocaleString()}
                                        {hasUnsaved && (
                                          <span className="text-amber-500 ml-0.5" title={`+${unsavedCounts[c.name]} unsaved`}>*</span>
                                        )}
                                      </span>
                                      <span className="text-[10px] tabular-nums text-muted-foreground/70 w-8 text-right">
                                        {Math.round(pct)}%
                                      </span>
                                    </div>
                                  </div>
                                  <div className="h-1 w-full rounded-full bg-muted/50 overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-all duration-500"
                                      style={{
                                        backgroundColor: c.color,
                                        width: `${barWidth}%`,
                                        opacity: 0.8,
                                      }}
                                    />
                                  </div>
                                  {avgArea > 0 && (
                                    <div className="text-[10px] text-muted-foreground mt-0.5">
                                      Avg area: {formatArea(avgArea)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Divider / handle for resizing */}
          {!rightCollapsed && (
            <div
              className="absolute right-[--dummy] top-0 bottom-0 w-2 cursor-col-resize"
              style={{ right: `calc(-2px)` }}
              onMouseDown={startResize}
            />
          )}
        </div>

        {/* Floating expand button when sidebar is collapsed */}
        {rightCollapsed && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 z-50">
              <Button
                size="sm"
                onClick={() => {
                  setRightCollapsed(false);
                  setTimeout(() => { try { window.dispatchEvent(new Event('annotation-panel-resize-end')); } catch (err) {} }, 20);
                }}
                aria-label="Expand right panel"
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg rounded-full p-1"
              >
                <ChevronLeft className="w-4 h-4 rotate-180" />
              </Button>
          </div>
        )}
      </div>

      {/* Apply on all images: full-screen overlay so user cannot click elsewhere; cancel stays active */}
      {isApplyingAllImages && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
          aria-modal="true"
          role="dialog"
          aria-label="Apply SAM 3 on all images in progress"
        >
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl px-6 py-4 flex flex-col items-center gap-4 min-w-[280px]">
            <Loader2 className="w-8 h-8 animate-spin text-white" />
            {applyAllProgress && (
              <p className="text-sm text-white">
                Applying {applyAllProgress.current} / {applyAllProgress.total} images
              </p>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                applyAllCancelledRef.current = true;
              }}
            >
              <X className="w-4 h-4 mr-2" />
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Save Annotation File Dialog */}
      <Dialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save Annotation File</DialogTitle>
            <DialogDescription>
              Enter a name for your annotation file. All annotations from all images will be saved.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="annotation-name">Annotation File Name</Label>
              <Input
                id="annotation-name"
                placeholder="e.g., my_segmentation_annotations"
                value={saveAnnotationName}
                onChange={(e) => setSaveAnnotationName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && saveAnnotationName.trim()) {
                    handleSaveAnnotationFile();
                  }
                }}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                .json extension will be added automatically if not provided
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowSaveDialog(false);
                setSaveAnnotationName('');
                navigateAfterSaveRef.current = false;
                pendingNavigationRef.current = null;
              }}
              disabled={isSavingAnnotation}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAnnotationFile}
              disabled={!saveAnnotationName.trim() || isSavingAnnotation}
            >
              {isSavingAnnotation ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Save
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave confirmation dialog */}
      <AlertDialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved annotation changes. Would you like to save before leaving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowLeaveDialog(false);
              pendingNavigationRef.current = null;
            }}>
              Cancel
            </AlertDialogCancel>
            <Button variant="destructive" onClick={() => handleLeaveConfirm(false)}>
              Discard
            </Button>
            <AlertDialogAction onClick={() => handleLeaveConfirm(true)}>
              <Save className="w-4 h-4 mr-2" />
              Save & Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete All Annotations Confirmation Dialog */}
      <AlertDialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Annotations?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all {annotations.length} annotation{annotations.length !== 1 ? 's' : ''} for image "{currentImageName}"?
              <br />
              <span className="text-destructive font-medium">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>
            <Button variant="destructive" onClick={deleteCurrentImageAnnotations}>
              Delete All
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

export default ImageAnnotation;
