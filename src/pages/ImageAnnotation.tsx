import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  AlertCircle
} from 'lucide-react';
import { API_CONFIG } from '@/config/api';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { Image, ImageCollection } from '@/types';
import { useSAM } from '@/hooks/use-sam';
import { Point as SAMPoint } from '@/utils/sam/types';

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

const ImageAnnotation = () => {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { api } = useApi();
  const { toast } = useToast();

  // Start loading SAM models immediately when component mounts
  // This happens when user navigates to "Annotate -> Segmentation annotations"
  // Models will load in the background while user is working
  const [samModelsLoading, setSamModelsLoading] = useState(false);
  
  useEffect(() => {
    // Trigger SAM model loading on mount
    console.log('[SAM] ImageAnnotation component mounted - starting SAM model preload');
    setSamModelsLoading(true);
  }, []);

  // Get annotation ID from URL params if editing existing annotation
  const annotationId = searchParams.get('annotationId');

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
  const [allImageNames, setAllImageNames] = useState<string[]>([]);
  const [currentLayerImageNames, setCurrentLayerImageNames] = useState<string[]>([]);
  const [mainLayer, setMainLayer] = useState<string>(''); // The primary layer that drives navigation
  const [isLayerSwitching, setIsLayerSwitching] = useState(false); // Prevent flicker during layer changes
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true); // Track initial load to prevent flickering
  const [activeTool, setActiveTool] = useState<AnnotationTool>('auto-segment');
  const [annotations, setAnnotations] = useState<AnnotationShape[]>([]);
  const [classes, setClasses] = useState<AnnotationClass[]>([]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [annotationName, setAnnotationName] = useState<string>("");

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
  // COCO image dimensions (file_name -> { width, height }) so we can scale loaded coords to actual image space
  const cocoImageDimensionsRef = useRef<Record<string, { width: number; height: number }>>({});
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [isMovingAnnotation, setIsMovingAnnotation] = useState(false);
  const [moveOffset, setMoveOffset] = useState({ x: 0, y: 0 });
  
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
  // Allow editing label for auto-segmented annotations before accepting
  const [autoSegmentLabel, setAutoSegmentLabel] = useState<string>('');
  const [autoSegmentClassId, setAutoSegmentClassId] = useState<string | null>(null);
  // SAM points for interactive segmentation (ref so second click sees latest points before re-render)
  const [samPoints, setSamPoints] = useState<Array<{ x: number; y: number; label: number }>>([]);
  const samPointsRef = useRef<Array<{ x: number; y: number; label: number }>>([]);
  useEffect(() => {
    samPointsRef.current = samPoints;
  }, [samPoints]);
  const [isSamProcessing, setIsSamProcessing] = useState(false);
  const [showSamLoadingDialog, setShowSamLoadingDialog] = useState(false);
  const [samInitCancelled, setSamInitCancelled] = useState(false);

  // Panel tab state
  const [activePanelTab, setActivePanelTab] = useState<string>('annotations');

  // Auto-save state
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(Date.now());

  // Save annotation file dialog state
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveAnnotationName, setSaveAnnotationName] = useState('');
  const [isSavingAnnotation, setIsSavingAnnotation] = useState(false);

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

  // SAM integration - get image URL for SAM
  // IMPORTANT: Only pass URL strings, not HTMLImageElement - Comlink cannot serialize DOM elements
  const samImage = displayImage?.url || currentImage?.url || null;
  const samImageId = displayImage?.fileName || currentImage?.fileName || 'current-image';
  
  // Enable SAM - start loading models immediately when component mounts
  // This allows models to load in the background while user is working
  // Image encoding will start once an image is available
  const { encoding, decode, runFallbackSegment, isLoading: isSamModelLoading, isReady: isSamReady, isWorkerReady } = useSAM({
    image: samImage,
    imageId: samImageId,
    enabled: !!samImage && !samInitCancelled, // Encode image when available and not cancelled
    preloadModels: true, // Start loading encoder/decoder models immediately
  });
  
  // Close SAM loading dialog when SAM becomes ready (if it was shown)
  useEffect(() => {
    if (isSamReady && showSamLoadingDialog) {
      setShowSamLoadingDialog(false);
      // Automatically activate SAM tool once ready
      if (!samInitCancelled) {
        setActiveTool('auto-segment');
        setSamPoints([]);
      }
    }
  }, [isSamReady, showSamLoadingDialog, samInitCancelled]);

  // Start auto-segmentation: try backend first (fast), then browser SAM if backend fails.
  // label: 1 = add to mask (left-click), 0 = remove from mask (right-click).
  const startAutoSegment = useCallback(async (imgPoint: Point, label: number = 1) => {
    if (!displayImage && !currentImage) return;
    const img = (displayImage || currentImage)!;
    const samPoint: SAMPoint = { x: imgPoint.x, y: imgPoint.y, label };
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
      setAutoSegmentLabel(preferredClass ? preferredClass.name : '');
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
      const apiBase = API_CONFIG.baseUrl;
      const { imageB64, sendScale } = getImageB64AndScale();
      // When sending resized imageB64, points must be in resized image coordinates
      const scalePoint = (p: { x: number; y: number }) =>
        imageB64 ? { x: Math.round(p.x * sendScale), y: Math.round(p.y * sendScale) } : { x: p.x, y: p.y };
      const body: Record<string, unknown> = {
        point: scalePoint(imgPoint),
        points: newPoints.map(p => ({ ...scalePoint(p), label: p.label })),
      };
      if (imageB64) {
        body.imageB64 = imageB64;
      } else if (img.url) {
        body.imageUrl = img.url;
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
      // Reject old SAM service rectangle fallback (single 4–5 point polygon = placeholder)
      const rawPolygons = json.polygons || [];
      const isRectangleFallback =
        json.source !== 'sam2' &&
        rawPolygons.length === 1 &&
        rawPolygons[0].length >= 4 &&
        rawPolygons[0].length <= 5;
      if (isRectangleFallback) {
        if (isWorkerReady && imageB64 && runFallbackSegment) {
          try {
            const scaledPoints = newPoints.map(p => ({ ...p, x: p.x * sendScale, y: p.y * sendScale }));
            const result = await runFallbackSegment(imageB64, scaledPoints);
            if (result?.polygons?.length > 0 && result.polygons[0].length > 0) {
              let fallbackPolygons: Point[][] = result.polygons.map(poly => poly.map((p: Point) => ({ x: p.x, y: p.y })));
              if (sendScale !== 1) {
                const scaleBack = 1 / sendScale;
                fallbackPolygons = fallbackPolygons.map(poly => poly.map(p => ({ x: p.x * scaleBack, y: p.y * scaleBack })));
              }
              setPreview(fallbackPolygons);
              return;
            }
          } catch (e) {
            console.warn('[SAM] Browser fallback failed:', e);
          }
        }
        toast({
          title: 'SAM service needs update',
          description: isWorkerReady ? 'Using browser SAM. If you see this again, try another point.' : 'Segmentation returned a placeholder. Rebuild the SAM 2 service (backend/sam_service) or wait for browser model to load.',
          variant: 'destructive',
        });
        return;
      }
      let polygons: Point[][] = rawPolygons.map((poly: number[][]) =>
        poly.map((p: number[]) => ({ x: p[0], y: p[1] }))
      );
      // Scale polygons back to natural image coords when we sent resized image
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
    } catch (backendErr) {
      if (isWorkerReady && runFallbackSegment) {
        const { imageB64: fallbackB64, sendScale: fallbackScale } = getImageB64AndScale();
        if (fallbackB64) {
          try {
            const scaledPoints = newPoints.map(p => ({ ...p, x: p.x * fallbackScale, y: p.y * fallbackScale }));
            const result = await runFallbackSegment(fallbackB64, scaledPoints);
            if (result?.polygons?.length > 0 && result.polygons[0].length > 0) {
              let polygons: Point[][] = result.polygons.map(poly => poly.map((p: Point) => ({ x: p.x, y: p.y })));
              if (fallbackScale !== 1) {
                const scaleBack = 1 / fallbackScale;
                polygons = polygons.map(poly => poly.map(p => ({ x: p.x * scaleBack, y: p.y * scaleBack })));
              }
              setPreview(polygons);
              return;
            }
          } catch (workerErr) {
            console.warn('[SAM] Browser fallback failed:', workerErr);
          }
        }
      }
      toast({
        title: 'Segmentation failed',
        description: isWorkerReady ? 'Backend and browser SAM could not produce a mask. Try another point.' : 'Backend SAM failed and browser model is still loading. Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setIsSamProcessing(false);
    }
  }, [displayImage, currentImage, classes, selectedClass, toast, isSamReady, isWorkerReady, encoding, decode, runFallbackSegment, samPoints]);

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

    const newAnns: AnnotationShape[] = autoSegmentPreview.polygons.map(poly => ({
      id: `annotation_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
      type: 'polygon',
      points: poly,
      label: classObj.name,
      color: classObj.color,
      visible: true
    }));

    setAnnotations(prev => {
      const updated = [...prev, ...newAnns];
      const storageKey = `annotations_${id}_${currentImageName}`;
      safeLocalStorageSet(storageKey, JSON.stringify(updated));
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

  // Load images on mount
  useEffect(() => {
    const loadImagesEffect = async () => {
      if (!id || !api) return;
      
      try {
        setIsLoading(true);
        
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
          
          // Set default display layer (prefer RGB Images or first collection)
          const defaultCollection = collectionsResponse.data.find(c => c.name.toLowerCase().includes('rgb')) ||
                                   collectionsResponse.data[0];
          
          if (defaultCollection) {
            setDisplayLayer(defaultCollection.id);
            setMainLayer(defaultCollection.id); // Set main layer (usually RGB)
          }
          
          if (uniqueNames.length > 0) {
            setCurrentImageName(uniqueNames[0]);
            updateCurrentImages(uniqueNames[0], defaultCollection?.id || '', collectionsResponse.data);
            loadAnnotationsForImage(uniqueNames[0]);
          }
          
          toast({
            title: 'Collections loaded',
            description: `Loaded ${collectionsResponse.data.length} collections with ${uniqueNames.length} unique images for navigation`,
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

  // Update images when index or layer changes
  useEffect(() => {
    // Skip during initial load to prevent flickering
    if (isInitialLoad) return;
    
    const imageList = currentLayerImageNames.length > 0 ? currentLayerImageNames : allImageNames;
    if (imageList.length > 0 && currentImageIndex < imageList.length) {
      const imageName = imageList[currentImageIndex];
      
      // Only update if the image name actually changed
      if (imageName !== currentImageName) {
        setCurrentImageName(imageName);
        updateCurrentImages(imageName, displayLayer, imageCollections);
        loadAnnotationsForImage(imageName);
      }
    }
  }, [currentImageIndex, allImageNames, currentLayerImageNames, displayLayer, imageCollections, isInitialLoad]);


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
    // Find RGB collection for annotations priority
    const rgbCollection = collections.find(c => c.name.toLowerCase().includes('rgb'));
    let foundCurrentImage: Image | null = null;
    
    // Priority 1: Try to find in RGB collection for annotations
    if (rgbCollection) {
      foundCurrentImage = rgbCollection.images.find(img => img.fileName === imageName) || null;
    }
    
    // Priority 2: If not in RGB, find in any collection for annotations
    if (!foundCurrentImage) {
      for (const collection of collections) {
        const img = collection.images.find(img => img.fileName === imageName);
        if (img) {
          foundCurrentImage = img;
          break;
        }
      }
    }
    
    setCurrentImage(foundCurrentImage);
    
    // Set navigation based on main layer (usually RGB)
    const mainLayerCollection = collections.find(c => c.id === mainLayer);
    if (mainLayerCollection) {
      const mainLayerImageNames = mainLayerCollection.images.map(img => img.fileName).sort();
      setCurrentLayerImageNames(mainLayerImageNames);
    } else {
      setCurrentLayerImageNames([]);
    }
    
    // Find the image with this name in the display layer
    const displayCollection = collections.find(c => c.id === layerId);
    let foundDisplayImage: Image | null = null;

    if (displayCollection) {
      // If a specific layer is selected, only use images from that layer.
      foundDisplayImage = displayCollection.images.find(img => img.fileName === imageName) || null;
      if (!foundDisplayImage) {
        // No corresponding image in the selected layer — clear display image and set flag
        setDisplayImage(null);
        setNoCorrespondingImage(true);
        return;
      } else {
        setNoCorrespondingImage(false);
      }
    }

    // If no specific layer selected, or displayCollection undefined, fall back to current image
    if (!foundDisplayImage) {
      foundDisplayImage = foundCurrentImage;
    }

    setDisplayImage(foundDisplayImage);
  };

  const loadAnnotationsForImage = async (imageName: string) => {
    console.log('Loading annotations for image:', imageName, '(last loaded:', lastLoadedImageRef.current, ')');
    
    // Only skip if it's the same image AND we already have annotations loaded
    if (imageName === lastLoadedImageRef.current && annotations.length > 0) {
      console.log('Annotations already loaded for:', imageName);
      return;
    }
    
    lastLoadedImageRef.current = imageName;
    
    try {
      // Try to load from localStorage first using image name (so annotations are shared across layers)
      const storageKey = `annotations_${id}_${imageName}`;
      let savedAnnotations = localStorage.getItem(storageKey);
      
      // If found in localStorage, validate the coordinates aren't corrupted
      if (savedAnnotations) {
        try {
          const parsedAnnotations = JSON.parse(savedAnnotations);
          
          // Check if coordinates are abnormally large (corrupted data)
          let hasCorruptedData = false;
          if (parsedAnnotations.length > 0 && parsedAnnotations[0].points && parsedAnnotations[0].points.length > 0) {
            const firstPoint = parsedAnnotations[0].points[0];
            if (firstPoint.x > 10000 || firstPoint.y > 10000) {
              console.warn(`Detected corrupted data in localStorage for ${imageName}, clearing and reloading from sessionStorage`);
              hasCorruptedData = true;
              localStorage.removeItem(storageKey);
              savedAnnotations = null;
            }
          }
        } catch (e) {
          console.error('Error validating cached annotations:', e);
          localStorage.removeItem(storageKey);
          savedAnnotations = null;
        }
      }
      
      // If not in localStorage, try to load from sessionStorage COCO data
      if (!savedAnnotations) {
        try {
          const annotationFileRef = sessionStorage.getItem(`annotation_file_${id}`);
          if (annotationFileRef) {
            const fileData = JSON.parse(annotationFileRef);
            const cocoData = fileData.cocoData;
            
            // Find annotations for this specific image from COCO data
            if (cocoData.images && cocoData.annotations && cocoData.categories) {
              const imageIdToFilename: { [id: string]: string } = {};
              cocoData.images.forEach((img: any) => {
                imageIdToFilename[img.id.toString()] = img.file_name;
              });
              
              const categoryIdToName: { [id: string]: string } = {};
              const categoryIdToColor: { [id: string]: string } = {};
              
              // Load or create classes first
              const existingClasses = classes.length > 0 ? classes : (JSON.parse(localStorage.getItem(`classes_${id}`) || '[]') as AnnotationClass[]);
              const classColorMap: { [name: string]: string } = {};
              existingClasses.forEach(c => {
                classColorMap[c.name] = c.color;
              });
              
              cocoData.categories.forEach((cat: any, idx: number) => {
                if (cat.id != null && cat.name) {
                  categoryIdToName[cat.id.toString()] = cat.name;
                  // Use existing class color if available, otherwise use default color
                  categoryIdToColor[cat.id.toString()] = classColorMap[cat.name] || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
                }
              });
              
              // Find image ID for this image name
              const imageEntry = cocoData.images.find((img: any) => img.file_name === imageName);
              if (imageEntry) {
                const imageAnnotations: AnnotationShape[] = [];
                
                cocoData.annotations.forEach((annotation: any) => {
                  if (annotation.image_id === imageEntry.id) {
                    // Handle null category_id
                    if (annotation.category_id == null) {
                      console.warn(`Skipping annotation for ${imageName}: null category_id`);
                      return;
                    }
                    const className = categoryIdToName[annotation.category_id.toString()];
                    
                    if (className && annotation.segmentation && annotation.segmentation.length > 0) {
                      const segmentation = annotation.segmentation[0];
                      
                      if (segmentation && segmentation.length >= 6) {
                        const points: Point[] = [];
                        
                        // Detect if coordinates are abnormally large (backend conversion error)
                        // Normal image coords should be < 10000 pixels
                        const firstX = segmentation[0];
                        const firstY = segmentation[1];
                        const isAbnormallyLarge = firstX > 10000 || firstY > 10000;
                        
                        // If abnormally large, they were likely already pixel coords that got
                        // multiplied by width/height again. Divide by image dimensions to fix.
                        const scaleFactor = isAbnormallyLarge && imageEntry.width && imageEntry.height
                          ? { x: imageEntry.width, y: imageEntry.height }
                          : { x: 1, y: 1 };
                        
                        if (isAbnormallyLarge) {
                          console.warn(`Detected abnormally large coordinates for ${imageName}, applying correction factor:`, scaleFactor);
                        }
                        
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
                        
                        // Only add annotation if we have at least 3 valid points
                        if (points.length >= 3) {
                          const color = categoryIdToColor[annotation.category_id.toString()] || DEFAULT_COLORS[0];
                          imageAnnotations.push({
                            id: `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            type: 'polygon',
                            points,
                            label: className,
                            color: color,
                            visible: true
                          });
                        } else {
                          console.warn(`Skipping annotation for ${imageName}: insufficient valid points (${points.length} < 3)`);
                        }
                      }
                    }
                  }
                });
                
                if (imageAnnotations.length > 0) {
                  setAnnotations(imageAnnotations);
                  
                  // When editing existing file (annotationId) use localStorage; new session only uses current state/loaded data
                  const existingFromStorage = annotationId ? (JSON.parse(localStorage.getItem(`classes_${id}`) || 'null') as any[]) || [] : [];
                  const baseClasses = classes.length > 0 ? classes : (existingClasses.length > 0 ? existingClasses : existingFromStorage);
                  const classNames = new Set(baseClasses.map(c => c.name));
                  const newClasses = [...baseClasses];
                  
                  imageAnnotations.forEach((ann) => {
                    if (!classNames.has(ann.label)) {
                      classNames.add(ann.label);
                      newClasses.push({
                        id: `class_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        name: ann.label,
                        color: ann.color,
                        visible: true,
                        count: 0
                      });
                    }
                  });
                  
                  // Update class counts (only for current image)
                  const countsByName: { [name: string]: number } = {};
                  imageAnnotations.forEach((a: any) => {
                    countsByName[a.label] = (countsByName[a.label] || 0) + 1;
                  });
                  
                  const updatedClasses = newClasses.map(c => ({ ...c, count: countsByName[c.name] || 0 }));
                  setClasses(updatedClasses);
                  saveGlobalClasses(updatedClasses);
                  
                  console.log(`Loaded ${imageAnnotations.length} annotations for ${imageName} from sessionStorage`);
                  return;
                }
              }
            }
          }
        } catch (sessionError) {
          console.warn('Could not load from sessionStorage:', sessionError);
        }
      }
      
      if (savedAnnotations) {
        const parsedAnnotations = JSON.parse(savedAnnotations);
        setAnnotations(parsedAnnotations);

        // Recompute class counts from loaded annotations so the left classes
        // reflect the actual annotations currently loaded in the image.
        // Build updated classes list deterministically so we can persist it immediately
        const countsByName: { [name: string]: number } = {};
        parsedAnnotations.forEach((a: any) => {
          countsByName[a.label] = (countsByName[a.label] || 0) + 1;
        });

        // When editing an existing file (annotationId), merge with localStorage classes; new session stays class-scoped to current annotations
        const existingFromStorage = annotationId ? (JSON.parse(localStorage.getItem(`classes_${id}`) || 'null') as any[]) || [] : [];
        const existing = classes.length > 0 ? classes : existingFromStorage;
        const merged: AnnotationClass[] = [...existing];
        Object.keys(countsByName).forEach(name => {
          if (!merged.find(c => c.name === name)) {
            merged.push({
              id: `class_${Date.now()}_${Math.random().toString(36).substr(2,9)}`,
              name,
              color: DEFAULT_COLORS[merged.length % DEFAULT_COLORS.length],
              visible: true,
              count: countsByName[name] || 0
            });
          }
        });

        // Update counts for merged classes (only for current image)
        // Keep all classes but update counts based on current image annotations
        const updatedClasses = merged.map(c => ({ 
          ...c, 
          count: countsByName[c.name] || 0  // Count only for current image
        }));
        setClasses(updatedClasses);
        saveGlobalClasses(updatedClasses);

      } else {
        // No saved annotations for this image, clear current ones
        setAnnotations([]);
        // Only load global classes when editing an existing annotation file; new session stays empty
        if (annotationId) loadGlobalClasses();
        setSelectedAnnotation(null);
      }
      
      // Don't clear selection if we just loaded annotations - let the user keep their selection
      // Only clear if there was an error or no annotations
    } catch (error) {
      console.error('Error loading annotations:', error);
      setAnnotations([]);
      if (annotationId) loadGlobalClasses();
      setSelectedAnnotation(null);
    }
  };

  // Global statistics across all saved annotation files (all images)
  const [globalStats, setGlobalStats] = useState<{ [className: string]: number }>({});
  const [globalAvgAreas, setGlobalAvgAreas] = useState<{ [className: string]: number }>({});

  const computeGlobalStats = useCallback(async () => {
    try {
      // If we have an annotation file loaded, try to fetch statistics from the database
      if (annotationId && api) {
        try {
          const response = await api.getAnnotation(parseInt(id), annotationId);
          if (response.success && response.data?.statistics) {
            console.log('Loaded statistics from database:', response.data.statistics);
            
            // Convert database statistics format to our format
            const counts: { [name: string]: number } = {};
            const avgAreas: { [name: string]: number } = {};
            
            Object.keys(response.data.statistics).forEach(className => {
              const stats = response.data.statistics[className];
              counts[className] = stats.count;
              avgAreas[className] = stats.avgArea;
            });
            
            setGlobalStats(counts);
            setGlobalAvgAreas(avgAreas);
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
                if (annotation.segmentation && annotation.segmentation[0]) {
                  const segmentation = annotation.segmentation[0];
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
              const imageId = imageFileNameToId[imageName];
              if (imageId == null) continue;
              const imgIdStr = imageId.toString();
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
        const imageEntry = cocoData.images.find((img: any) => img.file_name === imageName);
        if (!imageEntry) return;
        
        const imageAnnotations: AnnotationShape[] = [];
        const categoryIdToName: { [id: string]: string } = {};
        
        cocoData.categories.forEach((cat: any) => {
          if (cat.id != null) {
            categoryIdToName[cat.id.toString()] = cat.name;
          }
        });
        
        cocoData.annotations.forEach((annotation: any) => {
          if (annotation.image_id === imageEntry.id) {
            // Handle null category_id
            if (annotation.category_id == null) {
              console.warn(`Skipping annotation for ${imageName}: null category_id`);
              return;
            }
            const categoryId = annotation.category_id;
            const className = categoryIdToName[categoryId.toString()];
            
            if (className && annotation.segmentation && annotation.segmentation.length > 0) {
              const segmentation = annotation.segmentation[0];
              
              if (segmentation && segmentation.length >= 6) {
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
      
      // Load annotations for current image if it exists in the data
      if (currentImageName) {
        loadAnnotationsForImage(currentImageName);
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
  }, [id, currentImageName, computeGlobalStats, toast]);

  // Load from annotation file if annotationId is provided
  useEffect(() => {
    if (annotationId && !isLoading) {
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

  // Fix: Load annotations for current image when both annotation file is loaded AND currentImageName is set
  // This handles the case where annotation file loads before currentImageName is set
  useEffect(() => {
    if (!annotationId || !currentImageName || isLoading) {
      console.log('[Fix] Skipping - conditions not met:', { annotationId: !!annotationId, currentImageName: !!currentImageName, isLoading });
      return;
    }

    // Check if annotation file is loaded in sessionStorage
    const annotationFileRef = sessionStorage.getItem(`annotation_file_${id}`);
    if (!annotationFileRef) {
      console.log('[Fix] Annotation file not in sessionStorage yet');
      return; // Annotation file not loaded yet
    }

    // Check if annotations are already loaded for this image
    if (lastLoadedImageRef.current === currentImageName && annotations.length > 0) {
      console.log('[Fix] Annotations already loaded for:', currentImageName);
      return; // Already loaded
    }

    // Load annotations for the current image
    console.log('[Fix] Loading annotations for current image after annotation file loaded:', {
      currentImageName,
      hasAnnotationFile: !!annotationFileRef,
      lastLoaded: lastLoadedImageRef.current,
      currentAnnotationsCount: annotations.length
    });
    
    // Use a small timeout to ensure all state is settled
    const timeoutId = setTimeout(() => {
      loadAnnotationsForImage(currentImageName);
    }, 300);
    
    return () => clearTimeout(timeoutId);
  }, [annotationId, currentImageName, isLoading, id, annotations.length, loadAnnotationsForImage]);

  // Second fix: When currentImageName is set (even during initial load) and annotation file exists, load annotations
  // This handles the case where currentImageName is set after annotation file loads
  useEffect(() => {
    if (!currentImageName || !annotationId) {
      return;
    }

    // Check if annotation file is loaded
    const annotationFileRef = sessionStorage.getItem(`annotation_file_${id}`);
    if (!annotationFileRef) {
      return;
    }

    // Check if annotations are already loaded
    if (lastLoadedImageRef.current === currentImageName && annotations.length > 0) {
      return;
    }

    // Load annotations with a delay to ensure state is settled
    const timeoutId = setTimeout(() => {
      console.log('[Fix2] Loading annotations when currentImageName set:', {
        currentImageName,
        isLoading,
        isInitialLoad,
        hasAnnotationFile: !!annotationFileRef
      });
      loadAnnotationsForImage(currentImageName);
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [currentImageName, annotationId, id, annotations.length, loadAnnotationsForImage]);

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
    // Convert to annotation space when loaded from COCO with different dimensions
    let qx = x, qy = y;
    if (currentImage?.fileName && imageRef.current) {
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

    const newAnnotation: AnnotationShape = {
      id: `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      points,
      label: classObj.name,
      color: classObj.color,
      visible: true
    };

    setAnnotations(prev => {
      const updated = [...prev, newAnnotation];
      // Auto-save to localStorage using image name
      const storageKey = `annotations_${id}_${currentImageName}`;
      safeLocalStorageSet(storageKey, JSON.stringify(updated));
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
      // When annotation points are in COCO space, scale delta to COCO space
      if (currentImage?.fileName && imageRef.current) {
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
          safeLocalStorageSet(storageKey, JSON.stringify(updatedAnnotations));
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

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const isInputFocused = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

    if (e.key === 'Escape' && isDrawing) {
      // Cancel current drawing
      setIsDrawing(false);
      setCurrentPath([]);
      toast({
        title: 'Drawing cancelled',
        description: 'Polygon drawing has been cancelled',
      });
    } else if (e.key === 'Enter' && !isInputFocused) {
      if (autoSegmentPreview && autoSegmentPreview.polygons?.length > 0) {
        // Accept SAM mask on Enter
        acceptAutoSegment();
      } else if (isDrawing && activeTool === 'polygon' && currentPath.length >= 3) {
        // Complete polygon on Enter key
        createAnnotation('polygon', currentPath);
        setIsDrawing(false);
        setCurrentPath([]);
      }
    } else if (e.key === 'r' || e.key === 'R') {
      // Reset zoom and pan to default view
      if (!isDrawing) { // Only allow reset when not drawing
        resetZoomAndPan();
      }
    }
  }, [isDrawing, activeTool, currentPath, createAnnotation, toast, resetZoomAndPan, autoSegmentPreview, acceptAutoSegment]);

  // Add keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const redrawCanvas = useCallback(() => {
    // Require canvas and an image to draw: either the displayImage (selected layer) or the currentImage (annotations source)
    // Skip drawing during layer transitions to prevent flickering
    if (!canvasRef.current || !imageRef.current || (!displayImage && !currentImage) || isLayerSwitching) return;

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

    // Scale annotation coords from COCO image dimensions to actual image dimensions when they differ
    const naturalW = imageRef.current?.naturalWidth ?? 0;
    const naturalH = imageRef.current?.naturalHeight ?? 0;
    const cocoDims = currentImage?.fileName ? cocoImageDimensionsRef.current[currentImage.fileName] : undefined;
    const needScale = cocoDims && naturalW > 0 && naturalH > 0 && cocoDims.width > 0 && cocoDims.height > 0 &&
      (cocoDims.width !== naturalW || cocoDims.height !== naturalH);
    const scaleX = needScale ? naturalW / cocoDims!.width : 1;
    const scaleY = needScale ? naturalH / cocoDims!.height : 1;
    const annotationToScreen = (px: number, py: number) =>
      imageToScreenCoords(px * scaleX, py * scaleY);

    // Draw annotations
    annotations.forEach((annotation, idx) => {
      if (!annotation.visible) return;

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
  }, [annotations, selectedAnnotation, isDrawing, currentPath, activeTool, selectedClass, classes, samPoints, imageScale, imageOffset, displayImage, currentImage, imageToScreenCoords, isLayerSwitching]);

  // Redraw canvas when dependencies change
  useEffect(() => {
    redrawCanvas();
  }, [annotations, selectedAnnotation, isDrawing, currentPath, samPoints, activeTool, imageScale, imageOffset, displayImage, currentImage, isLayerSwitching, redrawCanvas]);

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
          const storageKey = `annotations_${id}_${currentImageName}`;
          safeLocalStorageSet(storageKey, JSON.stringify(updated));
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

  const saveEditingClass = () => {
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

    // Update class name
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
        const storageKey = `annotations_${id}_${currentImageName}`;
        safeLocalStorageSet(storageKey, JSON.stringify(updated));
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
    handleImageResize();
  };

  const handleImageResize = () => {
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
    if (!preserveZoomRef.current && !preventZoomResetRef.current) {
      setImageScale(fitToContainerScale);
      // Center image in container for new images
      const scaledWidth = img.naturalWidth * fitToContainerScale;
      const scaledHeight = img.naturalHeight * fitToContainerScale;
      
      setImageOffset({
        x: (containerRect.width - scaledWidth) / 2,
        y: (containerRect.height - scaledHeight) / 2
      });
    } else {
      // When preserving zoom, keep the current offset - don't recenter
      // Just update the canvas size, the scale and offset should remain unchanged
    }

    redrawCanvas();
  };

    // Recompute canvas and image scale when panels change or image changes so aspect ratio stays correct
    useEffect(() => {
      // If image already loaded, recompute layout to maintain aspect ratio when side panels are hidden/resized
      if (imageRef.current) {
        // Preserve zoom when just resizing panels
        preserveZoomRef.current = true;
        
        // small timeout to let layout settle after panel resize/collapse
        const t = setTimeout(() => {
          handleImageResize();
        }, 10);
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

      // Save to localStorage using image name
      const storageKey = `annotations_${id}_${currentImageName}`;
      safeLocalStorageSet(storageKey, JSON.stringify(annotations));
      
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

    const oldLabel = ann.label;
    const targetClass = classes.find(c => c.id === targetClassId);
    if (!targetClass) return; // no changes if class not found

    // Update annotation label
    setAnnotations(prev => {
  const updated = prev.map(a => a.id === annotationId ? { ...a, label: targetClass!.name, color: targetClass!.color } : a);
      // persist
      const storageKey = `annotations_${id}_${currentImageName}`;
      safeLocalStorageSet(storageKey, JSON.stringify(updated));
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
        if (!saved) {
          // still add image entry to keep indexing consistent
          imagesArr.push({ id: imageId, file_name: name, width: imageRef.current?.naturalWidth || 0, height: imageRef.current?.naturalHeight || 0 });
          imageId++;
          continue;
        }

        let parsed: AnnotationShape[] = [];
        try { parsed = JSON.parse(saved); } catch (err) { parsed = []; }

        imagesArr.push({ id: imageId, file_name: name, width: imageRef.current?.naturalWidth || 0, height: imageRef.current?.naturalHeight || 0 });

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
          description: `All annotations for dataset ${id}`,
          version: '1.0',
          year: new Date().getFullYear(),
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

      // Build COCO format with all annotations
      const imagesArr: any[] = [];
      const annotationsArr: any[] = [];
      const categoryMap = classes.map((cls, idx) => ({ id: idx + 1, name: cls.name, supercategory: 'object' }));

      let annId = 1;
      let imageId = 1;

      for (const imageName of allImageNames) {
        const storageKey = `annotations_${id}_${imageName}`;
        const saved = localStorage.getItem(storageKey);
        
        if (!saved) {
          // Add image entry even if no annotations
          imagesArr.push({ 
            id: imageId, 
            file_name: imageName, 
            width: imageRef.current?.naturalWidth || 0, 
            height: imageRef.current?.naturalHeight || 0 
          });
          imageId++;
          continue;
        }

        let parsed: AnnotationShape[] = [];
        try { 
          parsed = JSON.parse(saved); 
        } catch (err) { 
          parsed = []; 
        }

        imagesArr.push({ 
          id: imageId, 
          file_name: imageName, 
          width: imageRef.current?.naturalWidth || 0, 
          height: imageRef.current?.naturalHeight || 0 
        });

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

      const coco = {
        info: {
          description: `Segmentation annotations for dataset ${id}`,
          version: '1.0',
          year: new Date().getFullYear(),
          contributor: 'AI Data Creator',
          date_created: new Date().toISOString()
        },
        images: imagesArr,
        categories: categoryMap,
        annotations: annotationsArr
      };

      // Create JSON file
      const dataStr = JSON.stringify(coco, null, 2);
      const fileName = name.endsWith('.json') ? name : `${name}.json`;
      const file = new File([dataStr], fileName, { type: 'application/json' });

      // Upload to backend
      const response = await api.uploadCocoAnnotationFile(parseInt(id), file);
      
      if (response.success) {
        toast({ 
          title: 'Saved successfully', 
          description: `Annotation file "${fileName}" has been created with ${annotationsArr.length} annotations from ${imagesArr.length} images` 
        });
        return true;
      } else {
        toast({ 
          title: 'Save failed', 
          description: response.error || 'Failed to save annotation file',
          variant: 'destructive'
        });
        return false;
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
      setShowSaveDialog(false);
      setSaveAnnotationName('');
    }
  };

  // Update database with current annotations
  const updateDatabaseAnnotations = async () => {
    if (!annotationId || !api) {
      toast({ 
        title: 'Cannot update', 
        description: 'No annotation selected for editing or API not available',
        variant: 'destructive'
      });
      return;
    }

    try {
      // Build the same COCO structure as download function
      const imagesArr: any[] = [];
      const annotationsArr: any[] = [];
      const categoryMap = classes.map((cls, idx) => ({ id: idx + 1, name: cls.name }));

      // Calculate statistics per class
      const classCounts: { [className: string]: number } = {};
      const classAreas: { [className: string]: number } = {};

      let annId = 1;
      let imageId = 1;

      for (const name of allImageNames) {
        const storageKey = `annotations_${id}_${name}`;
        const saved = localStorage.getItem(storageKey);
        if (!saved) {
          imagesArr.push({ id: imageId, file_name: name, width: imageRef.current?.naturalWidth || 0, height: imageRef.current?.naturalHeight || 0 });
          imageId++;
          continue;
        }

        let parsed: AnnotationShape[] = [];
        try { parsed = JSON.parse(saved); } catch (err) { parsed = []; }

        imagesArr.push({ id: imageId, file_name: name, width: imageRef.current?.naturalWidth || 0, height: imageRef.current?.naturalHeight || 0 });

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
            
            // Update statistics
            classCounts[ann.label] = (classCounts[ann.label] || 0) + 1;
            classAreas[ann.label] = (classAreas[ann.label] || 0) + polygonArea;

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
      
      // Calculate average areas per class
      const statistics: { [className: string]: { count: number, avgArea: number } } = {};
      Object.keys(classCounts).forEach(className => {
        statistics[className] = {
          count: classCounts[className],
          avgArea: classAreas[className] / classCounts[className]
        };
      });

      const coco = {
        info: {
          description: `All annotations for dataset ${id}`,
          version: '1.0',
          year: new Date().getFullYear(),
          date_created: new Date().toISOString()
        },
        images: imagesArr,
        categories: categoryMap,
        annotations: annotationsArr,
        statistics: statistics  // Add statistics to COCO data
      };

      const dataStr = JSON.stringify(coco, null, 2);
      const fileName = annotationName || `annotations_all_${id}.json`;
      const file = new File([dataStr], fileName, { type: 'application/json' });
      
      const response = await api.updateAnnotationContent(parseInt(id), annotationId, file);
      
      console.log('Update database response:', response);
      
      if (response.success) {
        toast({ 
          title: 'Database Updated', 
          description: `Updated database annotation "${annotationName}" with ${annotationsArr.length} annotations from ${imagesArr.length} images` 
        });
        
        // Refresh statistics from database
        computeGlobalStats();
      } else {
        toast({ 
          title: 'Update failed', 
          description: `Failed to update database: ${response.error || 'Unknown error'}`,
          variant: 'destructive'
        });
      }
    } catch (updateError) {
      console.error('Error updating annotation in database:', updateError);
      toast({ 
        title: 'Update failed', 
        description: updateError instanceof Error ? updateError.message : 'Cannot connect to API backend or failed to update database annotation',
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
              const imageEntry = cocoData.images.find((img: any) => img.file_name === currentImageName);
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
        if (!saved) {
          // still add image entry to keep indexing consistent
          imagesArr.push({ id: imageId, file_name: name, width: imageRef.current?.naturalWidth || 0, height: imageRef.current?.naturalHeight || 0 });
          imageId++;
          continue;
        }

        let parsed: AnnotationShape[] = [];
        try { parsed = JSON.parse(saved); } catch (err) { parsed = []; }

        imagesArr.push({ id: imageId, file_name: name, width: imageRef.current?.naturalWidth || 0, height: imageRef.current?.naturalHeight || 0 });

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
          description: `All annotations for dataset ${id}`,
          version: '1.0',
          year: new Date().getFullYear(),
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
    
    const confirmed = window.confirm(`Delete all annotations for "${currentImageName}"? This cannot be undone.`);
    if (!confirmed) return;

    const deletedCount = annotations.length;

    // Remove from localStorage
    const storageKey = `annotations_${id}_${currentImageName}`;
    localStorage.removeItem(storageKey);

    // Also update sessionStorage COCO data to remove annotations for this image
    try {
      const annotationFileRef = sessionStorage.getItem(`annotation_file_${id}`);
      if (annotationFileRef) {
        const fileData = JSON.parse(annotationFileRef);
        const cocoData = fileData.cocoData;
        
        if (cocoData && cocoData.annotations && cocoData.images) {
          // Find the image ID for this image name
          const imageEntry = cocoData.images.find((img: any) => img.file_name === currentImageName);
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

    // Clear in-memory annotations
    setAnnotations([]);
      setClasses([]); // Clear classes for fresh start
      localStorage.removeItem(`classes_${id}`); // Also clear persisted classes
    
    // Update class counts
    const countsByName: { [name: string]: number } = {};
    annotations.forEach((a: any) => {
      countsByName[a.label] = (countsByName[a.label] || 0) + 1;
    });
    
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
        // Recompute global stats after successful database save
        await computeGlobalStats();
        setHasUnsavedChanges(false);
        lastSaveTimeRef.current = Date.now();
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
    navigate(backUrl);
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
                      if (annotation.image_id === imageEntry.id && annotation.segmentation && annotation.segmentation[0]) {
                        // Handle null category_id
                        if (annotation.category_id == null) {
                          return;
                        }
                        const segmentation = annotation.segmentation[0];
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
    setDisplayLayer(layerId);
    
    // When layer changes, update the display image to show the current image name in the new layer
    if (imageCollections.length === 0) {
      setIsLayerSwitching(false);
      return;
    }

    const displayCollection = imageCollections.find(c => c.id === layerId);

    if (!displayCollection) {
      setIsLayerSwitching(false);
      return;
    }

    // Try to find same filename in the new layer
    let newDisplayImage = displayCollection.images.find(img => img.fileName === currentImageName) || null;

    // Use setTimeout to batch the state updates and reduce flickering
    setTimeout(() => {
      if (!newDisplayImage) {
        // Image doesn't exist in this layer - set both states atomically to prevent flickering
        setDisplayImage(null);
        setNoCorrespondingImage(true);
        // Don't change currentImageName or currentImageIndex - maintain navigation position
      } else {
        // Image exists in this layer - set both states atomically
        setDisplayImage(newDisplayImage);
        setNoCorrespondingImage(false);
        // Ensure annotations for that name are loaded
        loadAnnotationsForImage(currentImageName);
      }
      
      setIsLayerSwitching(false);
      
      // Debounce the redraw to prevent multiple rapid calls during state updates
      setTimeout(() => {
        try { window.dispatchEvent(new Event('annotation-panel-resize-end')); } catch (err) {}
      }, 10);
    }, 50); // Small delay to batch updates
  };

  const handleMainLayerChange = (layerId: string) => {
    setMainLayer(layerId);
    
    // Update the navigation list to use the new main layer
    const mainLayerCollection = imageCollections.find(c => c.id === layerId);
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
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading images...</p>
        </div>
      </div>
    );
  }

  if (!currentImage && !displayImage) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-gray-600">No images found in this dataset</p>
          <Button onClick={handleBack} className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dataset
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={handleBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">Segmentation Annotation</h1>
              {annotationId && annotationName && (
                <Badge className="bg-yellow-500/20 text-yellow-300 border-yellow-500/40 text-xs">
                  Editing {annotationName}
                </Badge>
              )}
            </div>
            <p className="text-sm text-gray-400">
              Image {currentImageIndex + 1} of {allImageNames.length}: {currentImage?.fileName || currentImageName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 relative">
          {!annotationId && (
            <Button 
              onClick={() => {
                // Check if there are any annotations to save
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
              className="bg-blue-600 hover:bg-blue-700"
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
          )}
          
          <Button 
            onClick={downloadAnnotationsJSON} 
            disabled={!hasAnyAnnotationsStored}
            title="Download COCO JSON file with all annotations"
          >
            <Download className="w-4 h-4 mr-2" />
            Download JSON
          </Button>
          
          {annotationId && (
            <>
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
                variant="secondary"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Changes
              </Button>
              
              {isAutoSaving && (
                <span className="text-sm text-muted-foreground animate-pulse">
                  Auto-saving...
                </span>
              )}
              
              {!isAutoSaving && hasUnsavedChanges && (
                <span className="text-sm text-yellow-600">
                  Unsaved changes
                </span>
              )}
              
              {!isAutoSaving && !hasUnsavedChanges && annotationId && (
                <span className="text-sm text-green-600">
                  All saved
                </span>
              )}
            </>
          )}
          
          <Button
            variant="destructive"
            onClick={clearAllAnnotations}
            disabled={!hasAnyAnnotationsStored}
            className="ml-2"
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
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Zoom & Pan</CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-gray-200">
                  <div className="mb-1"><strong>Zoom</strong>: Hold <kbd className="px-1 bg-black/20 rounded">Ctrl</kbd> (or <kbd className="px-1 bg-black/20 rounded">⌘</kbd>) + scroll</div>
                  <div className="mb-1"><strong>Pan</strong>: Middle-button drag, hold <kbd className="px-1 bg-black/20 rounded">Space</kbd> + drag, <strong>Ctrl</strong> + left/right drag, or <strong>Right + Left</strong> click drag</div>
                  <div className="mb-1"><strong>Reset View</strong>: Press <kbd className="px-1 bg-black/20 rounded">R</kbd> or click the reset button</div>
                  <div className="text-xs text-gray-400 mt-1">Tip: scroll over area you want to zoom into</div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </header>

  <div className="flex flex-1 overflow-hidden relative">
        {/* Left Sidebar - Tools and Classes (collapsible & resizable) */}
        <div
          className="bg-gray-800 border-r border-gray-700 flex flex-col"
          style={{ width: leftCollapsed ? 0 : leftWidth }}
        >
          <div className="p-2 border-b border-gray-700 flex items-center justify-between">
            <div className="text-sm font-medium">Tools</div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setLeftCollapsed(v => !v)}>
                {leftCollapsed ? <ChevronRight className="w-4 h-4"/> : <ChevronLeft className="w-4 h-4"/>}
              </Button>
            </div>
          </div>
          {/* Tools section moved inside content below */}
          {/* Tools */}
          <div className="p-4 border-b border-gray-700">
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
                onClick={() => setActiveTool('polygon')}
              >
                <Square className="w-4 h-4 mr-1" />
                Polygon
              </Button>
              <Button
                variant={activeTool === 'auto-segment' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  setActiveTool('auto-segment');
                  setSamPoints([]);
                  // Don't show loading dialog – segmentation uses backend first; no wait for browser encode
                }}
                disabled={isSamProcessing || samInitCancelled || classes.length === 0}
                title={
                  classes.length === 0
                    ? 'Add at least one class first'
                    : samInitCancelled
                    ? 'SAM initialization cancelled'
                    : isSamProcessing
                    ? 'Processing segmentation...'
                    : 'Click on image to segment (backend first, then browser SAM)'
                }
              >
                {isSamProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Processing...
                  </>
                ) : samInitCancelled ? (
                  <>
                    <AlertCircle className="w-4 h-4 mr-1" />
                    SAM
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 mr-1" />
                    SAM
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Left: tools and classes only (Image Layers moved to bottom) */}

          {/* Classes */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className="p-4 border-b border-gray-700">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium">Classes</h3>
                <Button 
                  size="sm" 
                  variant="outline"
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
                          ? 'border-blue-500 bg-blue-500/20' 
                          : 'border-gray-600 hover:border-gray-500'
                      }`}
                      onClick={() => {
                        if (editingClassId !== classObj.id) {
                          setSelectedClass(classObj.id);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div 
                            className="w-4 h-4 rounded flex-shrink-0"
                            style={{ backgroundColor: classObj.color }}
                          />
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
                              className="h-6 w-6 p-0 hover:bg-gray-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditingClass(classObj.id, classObj.name);
                              }}
                              title="Rename class"
                            >
                              <Edit className="w-3 h-3 text-blue-400" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0 hover:bg-gray-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteClass(classObj.id);
                              }}
                              title="Delete class"
                            >
                              <Trash2 className="w-3 h-3 text-red-400" />
                            </Button>
                            {/* Shortcut hint */}
                            <div className="text-xs text-gray-400 px-1.5 py-0.5 rounded border border-gray-700 ml-1">
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
              className="bg-blue-600 text-white hover:bg-blue-700 shadow-lg rounded-full p-1"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Main Canvas Area */}
        <div className="flex-1 flex flex-col">
          <div 
            ref={containerRef}
            className="flex-1 relative overflow-hidden bg-gray-900"
          >
            {(displayImage || currentImage) && !isLayerSwitching ? (
              <>
                <img
                  ref={imageRef}
                  src={(displayImage || currentImage)?.url || ''}
                  alt={(displayImage || currentImage)?.fileName || 'Current image'}
                  className="absolute opacity-0"
                  onLoad={handleImageLoad}
                  onError={(e) => {
                    console.error('Image failed to load:', e);
                    console.error('Image src:', (displayImage || currentImage)?.url);
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
              </>
            ) : isLayerSwitching ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                  <div className="text-sm">Switching layer...</div>
                </div>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-gray-400">
                  <div className="text-2xl mb-2">📷</div>
                  {noCorrespondingImage && displayLayer ? (
                    <>
                      <div className="text-lg font-medium">No corresponding image found</div>
                      <div className="text-sm">
                        Image "{currentImageName}" not found in {imageCollections.find(c => c.id === displayLayer)?.name || 'this layer'}
                      </div>
                      <div className="text-xs mt-2 text-gray-500">Switch to a different layer or choose another image</div>
                    </>
                  ) : (
                    <>
                      <div className="text-lg font-medium">No Image Available</div>
                      <div className="text-sm">
                        Image "{currentImageName}" does not exist in {imageCollections.find(c => c.id === displayLayer)?.name || 'this layer'}
                      </div>
                      <div className="text-xs mt-2 text-gray-500">Switch to a different layer or navigate to another image</div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Drawing Instructions */}
            {isDrawing && activeTool === 'polygon' && (
              <div className="absolute top-4 left-4 bg-black/80 text-white px-4 py-2 rounded-lg text-sm z-10">
                <div className="flex flex-col gap-1">
                  <div className="font-semibold">Drawing Polygon ({currentPath.length} points)</div>
                  <div className="text-xs text-gray-300">
                    • Click to add points
                    • <strong>Double-click</strong> to finish
                    • <strong>Right-click</strong> to finish  
                    • <strong>Enter</strong> to finish
                    • <strong>Esc</strong> to cancel
                  </div>
                  {currentPath.length < 3 && (
                    <div className="text-xs text-yellow-400">
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
                <div className="absolute right-6 bottom-6 z-40 pointer-events-auto flex flex-col gap-2 w-64 bg-black/60 p-3 rounded">
                  <p className="text-xs text-gray-300">
                    Left-click: add to mask. Right-click: remove from mask. Add more points to refine. Press Enter to accept.
                  </p>
                  <div className="flex gap-2">
                    <Select value={autoSegmentClassId || ''} onValueChange={(v) => {
                      const idVal = v || null;
                      setAutoSegmentClassId(idVal);
                      const c = classes.find(x => x.id === idVal);
                      if (c) setAutoSegmentLabel(c.name);
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
          </div>

          {/* Image Navigation */}
          <div className="p-4 bg-gray-800 border-t border-gray-700">
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
                  <span className="text-sm text-gray-400">
                    {currentImageIndex + 1} / {currentLayerImageNames.length > 0 ? currentLayerImageNames.length : allImageNames.length}
                  </span>
                  {currentLayerImageNames.length > 0 && (
                    <span className="text-xs text-blue-400">
                      ({imageCollections.find(c => c.id === displayLayer)?.name || 'layer'})
                    </span>
                  )}
                  {currentImageName && (
                    <span className="text-xs text-gray-500">
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

              {/* Display Layer Selector */}
              {imageCollections.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Layer:</span>
                  <Select value={displayLayer} onValueChange={handleLayerChange}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {imageCollections.map(collection => (
                        <SelectItem key={collection.id} value={collection.id}>
                          {collection.name} ({collection.images.length} images)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Warning for missing image */}
                  {!displayImage && currentImageName && displayLayer && (
                    <span className="text-xs text-yellow-400">
                      Image "{currentImageName}" not available in {imageCollections.find(c => c.id === displayLayer)?.name || 'this layer'}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

  {/* Right Sidebar - Annotations Panel (redesigned container) */}
        <div
          className="bg-gray-900 border-l border-gray-700 flex flex-col transition-all"
          style={{ width: rightCollapsed ? 0 : rightWidth }}
        >
          {/* Panel Header */}
          <div className="bg-gray-800 border-b border-gray-600 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <h2 className="text-sm font-semibold text-gray-100">Annotations Panel</h2>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setRightCollapsed(v => !v)}>
                {rightCollapsed ? <ChevronLeft className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
              </Button>
            </div>
            
            {/* Navigation Layer Selector */}
            {imageCollections.length > 1 && !rightCollapsed && (
              <div className="mt-3 p-2 bg-gray-750 rounded border border-gray-600">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-gray-400">Navigation Layer:</span>
                </div>
                <Select value={mainLayer} onValueChange={handleMainLayerChange}>
                  <SelectTrigger className="w-full h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {imageCollections.map(collection => (
                      <SelectItem key={collection.id} value={collection.id}>
                        {collection.name} ({collection.images.length} images)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="text-xs text-blue-400 mt-1">
                  Controls which images are available for browsing
                </div>
              </div>
            )}
          </div>

          {/* Panel Content */}
          <div className="flex-1 flex flex-col min-h-0 bg-gray-900">
            <Tabs value={activePanelTab} onValueChange={setActivePanelTab} className="h-full flex flex-col">
              {/* Tab Navigation */}
              <div className="border-b border-gray-700 bg-gray-850">
                <TabsList className="grid grid-cols-2 w-full bg-transparent border-0 p-1">
                  <TabsTrigger 
                    value="annotations" 
                    className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-400 text-xs"
                  >
                    Annotations ({annotations.length})
                  </TabsTrigger>
                  <TabsTrigger 
                    value="statistics" 
                    className="data-[state=active]:bg-gray-700 data-[state=active]:text-white text-gray-400 text-xs"
                  >
                    Statistics
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Annotations Tab */}
              <TabsContent value="annotations" className="flex-1 flex flex-col min-h-0 overflow-hidden m-0 p-0">
                <div className="p-3 border-b border-gray-700 bg-gray-850">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>Current Image Annotations</span>
                      <span className="bg-gray-700 px-2 py-1 rounded text-gray-300">{annotations.length}</span>
                    </div>
                    {annotations.length > 0 && (
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={deleteCurrentImageAnnotations}
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
                      <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-3">
                        <Square className="w-6 h-6 text-gray-500" />
                      </div>
                      <p className="text-sm text-gray-500 mb-1">No annotations yet</p>
                      <p className="text-xs text-gray-600">Select a class and start drawing!</p>
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
                              ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/20' 
                              : 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800'
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
                                className="w-4 h-4 rounded-md border border-gray-600 flex-shrink-0 mt-0.5"
                                style={{ backgroundColor: annotation.color }}
                              />
                              <div className="flex-1 min-w-0">
                                {editingAnnotationId === annotation.id ? (
                                  <div className="space-y-2">
                                    <Select value={editingAnnotationLabel || ''} onValueChange={(v) => setEditingAnnotationLabel(v)}>
                                      <SelectTrigger className="w-full h-8 text-sm bg-gray-700 border-gray-600">
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
                                      className="text-sm font-medium text-gray-200 cursor-pointer hover:text-white transition-colors truncate"
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
                                        <span className="text-xs text-blue-400" title="Area in image coordinates">
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
                                className="w-7 h-7 p-0 hover:bg-gray-700"
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
                                className="w-7 h-7 p-0 hover:bg-gray-700"
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
              <TabsContent value="statistics" className="flex-1 overflow-hidden m-0 p-0">
                <div className="p-3 border-b border-gray-700 bg-gray-850">
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>Global Statistics</span>
                    <span className="bg-gray-700 px-2 py-1 rounded text-gray-300">All Images</span>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
                  <div className="space-y-3">
                    {(() => {
                      const total = Object.values(globalStats).reduce((s, v) => s + v, 0);
                      if (classes.length === 0) {
                        return (
                          <div className="flex flex-col items-center justify-center h-32 text-center">
                            <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-3">
                              <BarChart className="w-6 h-6 text-gray-500" />
                            </div>
                            <p className="text-sm text-gray-500">No classes defined yet</p>
                          </div>
                        );
                      }

                      return (
                        <>
                          {/* Summary Card */}
                          <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                            <div className="text-center">
                              <div className="text-2xl font-bold text-blue-400">{total}</div>
                              <div className="text-xs text-gray-400">Total Annotations</div>
                              <div className="text-xs text-gray-500 mt-1">Across all images</div>
                            </div>
                          </div>

                          {/* Class Breakdown */}
                          <div className="space-y-2">
                            <h5 className="text-xs font-medium text-gray-400 uppercase tracking-wide">Class Breakdown</h5>
                            {classes.map(c => {
                              const count = globalStats[c.name] || 0;
                              const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
                              const avgArea = globalAvgAreas[c.name] || 0;
                              return (
                                <div key={c.id} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <div 
                                        className="w-3 h-3 rounded border border-gray-600" 
                                        style={{ backgroundColor: c.color }} 
                                      />
                                      <span className="text-sm font-medium text-gray-200">{c.name}</span>
                                    </div>
                                    <div className="text-sm text-gray-300 font-medium">{count}</div>
                                  </div>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="text-gray-500">{c.visible ? 'Visible' : 'Hidden'}</span>
                                    <span className="text-gray-500">{pct}% of total</span>
                                  </div>
                                  {avgArea > 0 && (
                                    <div className="text-xs text-blue-400 mb-1" title="Average area of annotations">
                                      Avg area: {formatArea(avgArea)}
                                    </div>
                                  )}
                                  {/* Progress bar */}
                                  <div className="mt-2 h-1 bg-gray-700 rounded-full overflow-hidden">
                                    <div 
                                      className="h-full transition-all duration-300" 
                                      style={{ 
                                        width: `${pct}%`, 
                                        backgroundColor: c.color,
                                        opacity: 0.8
                                      }} 
                                    />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
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
                className="bg-blue-600 text-white hover:bg-blue-700 shadow-lg rounded-full p-1"
              >
                <ChevronLeft className="w-4 h-4 rotate-180" />
              </Button>
          </div>
        )}
      </div>

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

      {/* SAM Loading Dialog */}
      <Dialog open={showSamLoadingDialog} onOpenChange={(open) => {
        if (!open && !isSamReady) {
          // User cancelled - mark as cancelled
          setSamInitCancelled(true);
        }
        setShowSamLoadingDialog(open);
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Initializing SAM
            </DialogTitle>
            <DialogDescription>
              Loading Segment Anything Model. This may take a moment...
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Loading encoder model...</span>
                {!isSamModelLoading && <Check className="h-4 w-4 text-green-500" />}
                {isSamModelLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Loading decoder model...</span>
                {!isSamModelLoading && <Check className="h-4 w-4 text-green-500" />}
                {isSamModelLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Encoding image...</span>
                {isSamReady && encoding && <Check className="h-4 w-4 text-green-500" />}
                {!isSamReady && !isSamModelLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {isSamModelLoading && <span className="text-xs text-muted-foreground">Waiting...</span>}
              </div>
            </div>
            
            {samImage && (
              <div className="text-xs text-muted-foreground">
                Image: {samImageId}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSamInitCancelled(true);
                setShowSamLoadingDialog(false);
              }}
              disabled={isSamReady}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ImageAnnotation;
