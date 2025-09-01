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
  Layers
  ,ChevronLeft, ChevronRight
} from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
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

const ImageAnnotation = () => {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { api } = useApi();
  const { toast } = useToast();

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
  const [isLoading, setIsLoading] = useState(true);
  const [activeTool, setActiveTool] = useState<AnnotationTool>('polygon');
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

      // Get element position relative to viewport using offsetTop
      const elementTop = el.offsetTop;
      const viewportHeight = scrollContainer.clientHeight;
      const scrollHeight = scrollContainer.scrollHeight;
      const elementHeight = el.clientHeight;
      const currentScrollTop = scrollContainer.scrollTop;
      
      // Only scroll if the element is not currently visible or if we need to center it
      const elementBottom = elementTop + elementHeight;
      const visibleTop = currentScrollTop;
      const visibleBottom = currentScrollTop + viewportHeight;
      
      // Check if element is already fully visible
      const isFullyVisible = elementTop >= visibleTop && elementBottom <= visibleBottom;
      
      if (!isFullyVisible || scrollHeight > viewportHeight) {
        // Calculate scroll position to center the element, but only if there's actually scrollable content
        const targetScroll = Math.max(0, Math.min(
          elementTop - (viewportHeight / 2) + (elementHeight / 2),
          scrollHeight - viewportHeight
        ));
        
        console.log('Scrolling to annotation:', selectedAnnotation, 'elementTop:', elementTop, 'viewportHeight:', viewportHeight, 'scrollHeight:', scrollHeight, 'currentScroll:', currentScrollTop, 'targetScroll:', targetScroll);
        scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
      } else {
        console.log('Element already visible, no scroll needed');
      }
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
  // Auto-segment preview state
  const [autoSegmentPreview, setAutoSegmentPreview] = useState<{ polygons: Point[][]; maskDataUrl?: string; imageName?: string } | null>(null);
  // Allow editing label for auto-segmented annotations before accepting
  const [autoSegmentLabel, setAutoSegmentLabel] = useState<string>('');
  const [autoSegmentClassId, setAutoSegmentClassId] = useState<string | null>(null);

  // Start auto-segmentation by calling backend /segment
  const startAutoSegment = useCallback(async (imgPoint: Point) => {
    if (!displayImage && !currentImage) return;
    const img = (displayImage || currentImage)!;

    try {
      // Build payload. Prefer sending imageUrl when available so backend can fetch directly.
      // Creating a data URL by drawing the image into a canvas will fail if the image
      // is cross-origin without CORS headers (tainted canvas). Only produce imageB64
      // when there is no image URL or when imageRef is present and likely same-origin.
      let dataUrl: string | null = null;

      const hasImageUrl = Boolean(img.url);
      if (!hasImageUrl && imageRef.current) {
        // No accessible URL — create a data URL from the in-memory image (may still fail if cross-origin)
        try {
          const tmp = document.createElement('canvas');
          tmp.width = imageRef.current.naturalWidth;
          tmp.height = imageRef.current.naturalHeight;
          const ctx = tmp.getContext('2d');
          if (ctx) ctx.drawImage(imageRef.current, 0, 0);
          dataUrl = tmp.toDataURL('image/png');
        } catch (e) {
          console.warn('Could not create data URL from canvas (possibly tainted):', e);
          dataUrl = null;
        }
      }

      const body: any = {
        imageUrl: img.url || undefined,
        imageB64: dataUrl || undefined,
        point: { x: imgPoint.x, y: imgPoint.y },
        prompt: classes.find(c => c.id === selectedClass)?.name || undefined,
        model: 'sam_v2'
      };

  // Use configured API base URL so calls go to the backend proxy (not the dev server)
  const apiBase = (await import('@/config/api')).API_CONFIG.baseUrl;
  const res = await fetch(`${apiBase}/segment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) throw new Error('Segmentation failed');
      const json = await res.json();
      const polygons: Point[][] = (json.polygons || []).map((poly: number[][]) => poly.map((p: number[]) => ({ x: p[0], y: p[1] })));

  // initialize editable label/class for preview: prefer selected class
  const preferredClass = classes.find(c => c.id === selectedClass) || classes[0] || null;
  setAutoSegmentPreview({ polygons, maskDataUrl: json.maskBase64, imageName: img.fileName });
  setAutoSegmentLabel(preferredClass ? preferredClass.name : '');
  setAutoSegmentClassId(preferredClass ? preferredClass.id : null);
    } catch (err) {
      console.error('Auto-segment failed', err);
      toast({ title: 'Auto-segment failed', description: String(err), variant: 'destructive' });
    }
  }, [displayImage, currentImage, classes, selectedClass, toast]);

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
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });

    // update counts
    setClasses(prev => {
      const updated = prev.map(c => c.id === classObj!.id ? { ...c, count: c.count + autoSegmentPreview.polygons.length } : c);
      saveGlobalClasses(updated);
      return updated;
    });

    setAutoSegmentPreview(null);
    toast({ title: 'Auto-segment accepted', description: `Created ${newAnns.length} annotations` });
  };

  const cancelAutoSegment = () => setAutoSegmentPreview(null);
  const [editingClass, setEditingClass] = useState<string | null>(null);
  const [editingClassName, setEditingClassName] = useState('');
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
        
        // Load global classes first
        loadGlobalClasses();
        
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
      }
    };

    loadImagesEffect();
  }, [id, api, toast]);

  // Update images when index or layer changes
  useEffect(() => {
    if (allImageNames.length > 0 && currentImageIndex < allImageNames.length) {
      const imageName = allImageNames[currentImageIndex];
      setCurrentImageName(imageName);
      updateCurrentImages(imageName, displayLayer, imageCollections);
      loadAnnotationsForImage(imageName);
    }
  }, [currentImageIndex, allImageNames, displayLayer, imageCollections]);

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
    try {
      // Try to load from localStorage first using image name (so annotations are shared across layers)
      const storageKey = `annotations_${id}_${imageName}`;
      const savedAnnotations = localStorage.getItem(storageKey);
      
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

        // Start from existing classes and add any missing ones
        const existing = (JSON.parse(localStorage.getItem(`classes_${id}`) || 'null') as any[]) || [];
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

        // Update counts for merged classes
        const updatedClasses = merged.map(c => ({ ...c, count: countsByName[c.name] || 0 }));
        setClasses(updatedClasses);
        saveGlobalClasses(updatedClasses);

      } else {
        // No saved annotations, clear current ones
        setAnnotations([]);
      }
      
      setSelectedAnnotation(null);
    } catch (error) {
      console.error('Error loading annotations:', error);
      setAnnotations([]);
      setSelectedAnnotation(null);
    }
  };

  // Global statistics across all saved annotation files (all images)
  const [globalStats, setGlobalStats] = useState<{ [className: string]: number }>({});

  const computeGlobalStats = useCallback(() => {
    try {
      const counts: { [name: string]: number } = {};

      // Build a set of image names to check. Start with known image names, then
      // include any image names that have saved annotations in localStorage under the
      // annotations_{id}_{imageName} key pattern. This handles cases where annotations
      // exist but the image list (allImageNames) is incomplete or different across layers.
      const imageNamesToCheck = new Set<string>(allImageNames);

      // Scan localStorage keys for any annotations_{id}_* entries and include their image names
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
          });
        } catch (err) {
          // ignore parse errors per file
        }
      });

      setGlobalStats(counts);
    } catch (err) {
      console.error('Error computing global stats', err);
      setGlobalStats({});
    }
  }, [allImageNames, id]);

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
    
    // First try to load from saved_annotations localStorage
    const savedAnnotations = localStorage.getItem(`saved_annotations_${id}`);
    if (savedAnnotations) {
      const annotationsList = JSON.parse(savedAnnotations);
      const targetAnnotation = annotationsList.find((ann: any) => ann.id === annotationFileId);
      
      if (targetAnnotation && targetAnnotation.content) {
        console.log('Found annotation file in localStorage:', targetAnnotation.name);
        
        setAnnotationName(targetAnnotation.name);
        const cocoData = targetAnnotation.content;
        return loadAnnotationsFromCOCO(cocoData);
      }
    }
    
    // If not found in localStorage, try loading from backend
    if (api) {
      try {
        // First get annotation metadata to get the name
        const annotationResponse = await api.getAnnotation(id, annotationFileId);
        const response = await api.getAnnotationContent(id, annotationFileId);
        if (response.success && response.data.content) {
          console.log('Loading segmentation annotations from backend');
          
          // Set annotation name if available
          if (annotationResponse.success && annotationResponse.data?.file_name) {
            setAnnotationName(annotationResponse.data.file_name);
          }
          
          const cocoData = JSON.parse(response.data.content);
          return loadAnnotationsFromCOCO(cocoData);
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
  const loadAnnotationsFromCOCO = useCallback((cocoData: any) => {
    try {
      const newAnnotations: { [imageName: string]: AnnotationShape[] } = {};
      const classSet = new Set<string>();
      const classColorMap: { [name: string]: string } = {};
      
      // Extract classes from categories
      if (cocoData.categories) {
        cocoData.categories.forEach((category: any, index: number) => {
          classSet.add(category.name);
          // Assign colors from default palette
          classColorMap[category.name] = DEFAULT_COLORS[index % DEFAULT_COLORS.length];
        });
      }
      
      // Create image ID to filename mapping
      const imageIdToFilename: { [id: string]: string } = {};
      if (cocoData.images) {
        cocoData.images.forEach((img: any) => {
          imageIdToFilename[img.id.toString()] = img.file_name;
        });
      }
      
      // Create category ID to name mapping
      const categoryIdToName: { [id: string]: string } = {};
      if (cocoData.categories) {
        cocoData.categories.forEach((cat: any) => {
          categoryIdToName[cat.id.toString()] = cat.name;
        });
      }
      
      // Process annotations
      if (cocoData.annotations) {
        cocoData.annotations.forEach((annotation: any) => {
          const imageId = annotation.image_id.toString();
          const imageName = imageIdToFilename[imageId];
          const className = categoryIdToName[annotation.category_id.toString()];
          
          if (imageName && className && annotation.segmentation && annotation.segmentation.length > 0) {
            const segmentation = annotation.segmentation[0]; // Take first polygon
            
            if (segmentation && segmentation.length >= 6) { // At least 3 points (x,y pairs)
              const points: Point[] = [];
              for (let i = 0; i < segmentation.length; i += 2) {
                points.push({
                  x: segmentation[i],
                  y: segmentation[i + 1]
                });
              }
              
              const annotationShape: AnnotationShape = {
                id: `annotation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                type: 'polygon',
                points,
                label: className,
                color: classColorMap[className] || DEFAULT_COLORS[0],
                visible: true
              };
              
              if (!newAnnotations[imageName]) {
                newAnnotations[imageName] = [];
              }
              newAnnotations[imageName].push(annotationShape);
            }
          }
        });
      }
      
      // Save annotations to localStorage for each image
      Object.entries(newAnnotations).forEach(([imageName, annotations]) => {
        const storageKey = `annotations_${id}_${imageName}`;
        localStorage.setItem(storageKey, JSON.stringify(annotations));
      });
      
      // Update classes
      const newClasses: AnnotationClass[] = Array.from(classSet).map((className, index) => ({
        id: `class_${Date.now()}_${index}`,
        name: className,
        color: classColorMap[className] || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        visible: true,
        count: 0 // Will be updated by computeGlobalStats
      }));
      
      setClasses(newClasses);
      saveGlobalClasses(newClasses);
      
      // Load annotations for current image if it exists in the loaded data
      // Try multiple ways to match the current image
      let annotationsLoaded = false;
      if (currentImageName) {
        // Try exact match first
        if (newAnnotations[currentImageName]) {
          setAnnotations(newAnnotations[currentImageName]);
          annotationsLoaded = true;
        } else {
          // Try to find a match by checking different name variations
          const imageNames = Object.keys(newAnnotations);
          const matchedImageName = imageNames.find(name => 
            name === currentImageName || 
            name.includes(currentImageName) || 
            currentImageName.includes(name) ||
            name.replace(/\.[^/.]+$/, '') === currentImageName.replace(/\.[^/.]+$/, '') // Remove extensions and compare
          );
          
          if (matchedImageName) {
            setAnnotations(newAnnotations[matchedImageName]);
            annotationsLoaded = true;
          }
        }
      }
      
      // If no current image name or no match found, try to load from the first available image
      if (!annotationsLoaded && Object.keys(newAnnotations).length > 0) {
        const firstImageName = Object.keys(newAnnotations)[0];
        setAnnotations(newAnnotations[firstImageName]);
        // Also update the current image name if it wasn't set
        if (!currentImageName) {
          setCurrentImageName(firstImageName);
        }
        annotationsLoaded = true;
      }
      
      // Recompute global stats
      computeGlobalStats();
      
      // Force a canvas redraw after a short delay to ensure all state updates have been processed
      setTimeout(() => {
        if (canvasRef.current) {
          // Trigger a manual redraw by updating a dependency
          setAnnotations(prev => [...prev]);
        }
      }, 100);
      
      toast({
        title: "Annotations loaded",
        description: `Loaded segmentation annotations for ${Object.keys(newAnnotations).length} images`,
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
      loadFromAnnotationFile(annotationId);
    }
  }, [annotationId, isLoading, loadFromAnnotationFile]);

  // Load annotations when current image name changes
  useEffect(() => {
    if (currentImageName && id) {
      const storageKey = `annotations_${id}_${currentImageName}`;
      const stored = localStorage.getItem(storageKey);
      
      if (stored) {
        try {
          const parsedAnnotations = JSON.parse(stored);
          setAnnotations(parsedAnnotations);
          console.log(`Loaded annotations for ${currentImageName}:`, parsedAnnotations.length);
        } catch (error) {
          console.error('Error parsing stored annotations:', error);
          setAnnotations([]);
        }
      } else {
        // No annotations for this image
        setAnnotations([]);
      }
    }
  }, [currentImageName, id]);

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

  // Find annotation at given point
  const findAnnotationAtPoint = useCallback((x: number, y: number): AnnotationShape | null => {
    for (const annotation of annotations) {
      if (!annotation.visible) continue;

      if (annotation.type === 'polygon') {
        // Point-in-polygon algorithm
        if (isPointInPolygon({ x, y }, annotation.points)) {
          return annotation;
        }
      }
    }
    return null;
  }, [annotations, isPointInPolygon]);

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
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
    
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
  }, [selectedClass, classes, toast, currentImage, id]);

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
      // don't start auto-seg while drawing or while panning
      if (!isDrawing && !isPanningRef.current) {
        startAutoSegment(imageCoords);
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
  }, [activeTool, selectedClass, isDrawing, screenToImageCoords, findAnnotationAtPoint]);

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
      const deltaX = imageCoords.x - moveOffset.x;
      const deltaY = imageCoords.y - moveOffset.y;
      
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
      
      // Auto-save after moving
      setTimeout(() => {
        if (currentImageName) {
          const storageKey = `annotations_${id}_${currentImageName}`;
          const currentAnnotations = JSON.parse(localStorage.getItem(storageKey) || '[]');
          const updatedAnnotations = currentAnnotations.map((ann: AnnotationShape) => {
            if (ann.id === selectedAnnotation) {
              return {
                ...ann,
                points: ann.points.map((point: Point) => ({
                  x: point.x + deltaX,
                  y: point.y + deltaY
                }))
              };
            }
            return ann;
          });
          localStorage.setItem(storageKey, JSON.stringify(updatedAnnotations));
        }
      }, 100);
      
      setMoveOffset(imageCoords);
    }
  }, [isDragging, dragStart, isMovingAnnotation, selectedAnnotation, moveOffset, screenToImageCoords]);

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

    e.preventDefault(); // Prevent context menu for normal right-click handling
    if (isDrawing && activeTool === 'polygon' && currentPath.length >= 3) {
      // Complete polygon on right-click
      createAnnotation('polygon', currentPath);
      setIsDrawing(false);
      setCurrentPath([]);
    }
  }, [isDrawing, activeTool, currentPath, createAnnotation]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && isDrawing) {
      // Cancel current drawing
      setIsDrawing(false);
      setCurrentPath([]);
      toast({
        title: 'Drawing cancelled',
        description: 'Polygon drawing has been cancelled',
      });
    } else if (e.key === 'Enter' && isDrawing && activeTool === 'polygon' && currentPath.length >= 3) {
      // Complete polygon on Enter key
      createAnnotation('polygon', currentPath);
      setIsDrawing(false);
      setCurrentPath([]);
    }
  }, [isDrawing, activeTool, currentPath, createAnnotation, toast]);

  // Add keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const redrawCanvas = useCallback(() => {
    // Require canvas and an image to draw: either the displayImage (selected layer) or the currentImage (annotations source)
    if (!canvasRef.current || !imageRef.current || (!displayImage && !currentImage)) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Save context
    ctx.save();

    // Draw image with proper scaling and offset
    if (imageRef.current.complete) {
      ctx.drawImage(
        imageRef.current,
        imageOffset.x,
        imageOffset.y,
        imageRef.current.naturalWidth * imageScale,
        imageRef.current.naturalHeight * imageScale
      );
    }

    // Draw annotations
    annotations.forEach(annotation => {
      if (!annotation.visible) return;

      ctx.strokeStyle = annotation.color;
      ctx.fillStyle = annotation.color + '30'; // Semi-transparent fill
      ctx.lineWidth = 2;

      if (annotation.type === 'polygon' && annotation.points.length > 2) {
        ctx.beginPath();
        
        // Convert first point to screen coordinates
        const firstPoint = imageToScreenCoords(annotation.points[0].x, annotation.points[0].y);
        ctx.moveTo(firstPoint.x, firstPoint.y);
        
        // Convert and draw remaining points
        for (let i = 1; i < annotation.points.length; i++) {
          const point = imageToScreenCoords(annotation.points[i].x, annotation.points[i].y);
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
        const centerScreen = imageToScreenCoords(centerX, centerY);
        ctx.fillText(annotation.label, centerScreen.x, centerScreen.y);
      }

      // Highlight selected annotation
      if (annotation.id === selectedAnnotation) {
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 3;
        
        if (annotation.type === 'polygon') {
          ctx.beginPath();
          const firstPoint = imageToScreenCoords(annotation.points[0].x, annotation.points[0].y);
          ctx.moveTo(firstPoint.x, firstPoint.y);
          for (let i = 1; i < annotation.points.length; i++) {
            const point = imageToScreenCoords(annotation.points[i].x, annotation.points[i].y);
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

    // Restore context
    ctx.restore();
  }, [annotations, selectedAnnotation, isDrawing, currentPath, activeTool, selectedClass, classes, imageScale, imageOffset, displayImage, currentImage, imageToScreenCoords]);

  // Redraw canvas when dependencies change
  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

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

  const deleteAnnotation = (annotationId: string) => {
    const annotation = annotations.find(a => a.id === annotationId);
    if (!annotation || !currentImageName) return;

    setAnnotations(prev => {
      const updated = prev.filter(a => a.id !== annotationId);
      // Auto-save to localStorage using image name
      const storageKey = `annotations_${id}_${currentImageName}`;
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });
    
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
    canvas.width = containerRect.width;
    canvas.height = containerRect.height;

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
      // Create COCO format export
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
          width: imageRef.current?.naturalWidth || 1920,
          height: imageRef.current?.naturalHeight || 1080
        }],
        categories: classes.map((cls, index) => ({
          id: index + 1,
          name: cls.name,
          supercategory: "object"
        })),
        annotations: annotations.map((ann, index) => {
          const categoryId = classes.findIndex(c => c.name === ann.label) + 1;
          
          if (ann.type === 'polygon') {
            // Convert points to COCO polygon format [x1,y1,x2,y2,...]
            const segmentation = ann.points.flatMap(p => [p.x, p.y]);
            
            // Calculate bounding box
            const xs = ann.points.map(p => p.x);
            const ys = ann.points.map(p => p.y);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            const maxX = Math.max(...xs);
            const maxY = Math.max(...ys);
            
            return {
              id: index + 1,
              image_id: 1,
              category_id: categoryId,
              segmentation: [segmentation],
              area: (maxX - minX) * (maxY - minY),
              bbox: [minX, minY, maxX - minX, maxY - minY],
              iscrowd: 0
            };
          }
          return null;
        }).filter(Boolean)
      };

      // Save to localStorage using image name
      const storageKey = `annotations_${id}_${currentImageName}`;
      localStorage.setItem(storageKey, JSON.stringify(annotations));
      
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
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });

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
  };

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

            annotationsArr.push({
              id: annId++,
              image_id: imageId,
              category_id: categoryId,
              segmentation: [segmentation],
              area: (maxX - minX) * (maxY - minY),
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
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const fileName = `annotations_all_${id}.json`;

      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', fileName);
      link.click();

      toast({ title: 'Saved', description: `Exported ${annotationsArr.length} annotations from ${imagesArr.length} images` });
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
    setClasses(prev => prev.map(c => ({ ...c, count: 0 })));
    setGlobalStats({});

    toast({ title: 'Annotations cleared', description: `Removed ${removed} saved annotation file(s) from localStorage` });
  };

  const handleBack = () => {
    const backUrl = projectId 
      ? `/projects/${projectId}/datasets/${id}` 
      : `/datasets/${id}`;
    navigate(backUrl);
  };

  const navigateImage = useCallback((direction: 'prev' | 'next') => {
    if (allImageNames.length === 0) return;
    
    const newIndex = direction === 'next' 
      ? Math.min(currentImageIndex + 1, allImageNames.length - 1)
      : Math.max(currentImageIndex - 1, 0);
      
    setCurrentImageIndex(newIndex);
  }, [currentImageIndex, allImageNames.length]);

  const goToImage = (index: number) => {
    if (index >= 0 && index < allImageNames.length) {
      setCurrentImageIndex(index);
    }
  };

  const handleLayerChange = (layerId: string) => {
    setDisplayLayer(layerId);
    // When layer changes, update the display image to show the current image name in the new layer
    if (imageCollections.length === 0) return;

    const displayCollection = imageCollections.find(c => c.id === layerId);

    if (!displayCollection) return;

    // Try to find same filename in the new layer
    let newDisplayImage = displayCollection.images.find(img => img.fileName === currentImageName) || null;

    // If same filename not found, fall back to first image in the layer and update currentImageName/index
    if (!newDisplayImage) {
      if (displayCollection.images.length > 0) {
        newDisplayImage = displayCollection.images[0];
        // Update currentImageName and currentImageIndex to reflect the new displayed image
        const newName = newDisplayImage.fileName;
        setCurrentImageName(newName);
        const idx = allImageNames.indexOf(newName);
        if (idx >= 0) setCurrentImageIndex(idx);
        // Load annotations for the newly selected image
        loadAnnotationsForImage(newName);
      }
    } else {
      // If we found the same filename in this layer, ensure annotations for that name are loaded
      loadAnnotationsForImage(currentImageName);
    }

    // Update images (this will set currentImage/displayImage appropriately)
    updateCurrentImages(newDisplayImage ? newDisplayImage.fileName : currentImageName, layerId, imageCollections);

    // Force a redraw/layout recompute shortly after changing layer
    try { window.dispatchEvent(new Event('annotation-panel-resize-end')); } catch (err) {}
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
          <Button onClick={saveAllAnnotations} disabled={!hasAnyAnnotationsStored}>
            <Save className="w-4 h-4 mr-2" />
            Save All
          </Button>
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
                onClick={() => setActiveTool('auto-segment')}
              >
                <Download className="w-4 h-4 mr-1" />
                Auto
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

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-2">
                  {classes.map((classObj, idx) => (
                    <div
                      key={classObj.id}
                      className={`p-2 rounded border cursor-pointer transition-colors ${
                        selectedClass === classObj.id 
                          ? 'border-blue-500 bg-blue-500/20' 
                          : 'border-gray-600 hover:border-gray-500'
                      }`}
                      onClick={() => setSelectedClass(classObj.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-4 h-4 rounded"
                            style={{ backgroundColor: classObj.color }}
                          />
                          <span className="text-sm">{classObj.name}</span>
                        </div>

                        {/* Show a small numeric shortcut hint (1..9) instead of per-class annotation counts */}
                        {idx < 9 ? (
                          <div className="text-xs text-gray-400 px-2 py-0.5 rounded border border-gray-700">
                            {idx + 1}
                          </div>
                        ) : (
                          <div className="text-xs text-gray-400 px-2 py-0.5 rounded border border-gray-700">
                            {idx + 1}
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
            {(displayImage || currentImage) ? (
              <>
                <img
                  ref={imageRef}
                  src={(displayImage || currentImage)?.url || ''}
                  alt={(displayImage || currentImage)?.fileName || 'Current image'}
                  className="absolute opacity-0"
                  onLoad={handleImageLoad}
                  crossOrigin="anonymous"
                />
                <canvas
                  ref={canvasRef}
                  className="absolute cursor-crosshair w-full h-full"
                  onMouseDown={handleCanvasMouseDown}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={handleCanvasMouseUp}
                  onDoubleClick={handleCanvasDoubleClick}
                  onContextMenu={handleCanvasRightClick}
                />
              </>
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
                    {currentImageIndex + 1} / {allImageNames.length}
                  </span>
                  {currentImageName && (
                    <span className="text-xs text-gray-500">
                      ({currentImageName})
                    </span>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToImage(currentImageIndex + 1)}
                  disabled={currentImageIndex === allImageNames.length - 1}
                >
                  Next
                </Button>
              </div>

              {/* Layer Selector */}
              {imageCollections.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Layer:</span>
                  <Select value={displayLayer} onValueChange={handleLayerChange}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {imageCollections.map(collection => (
                        <SelectItem key={collection.id} value={collection.id}>
                          {collection.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* If image not found in the selected layer show a small warning (moved from left panel) */}
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

  {/* Right Sidebar - Annotations (tabs: Annotations | Statistics) - collapsible & resizable */}
        <div
          className="bg-gray-800 border-l border-gray-700 flex flex-col transition-all"
          style={{ width: rightCollapsed ? 0 : rightWidth }}
        >
          <Tabs value={undefined} className="h-full" defaultValue="annotations">
            <div className="p-2 border-b border-gray-700 flex items-center justify-between">
              <TabsList className="grid grid-cols-2 flex-1">
                <TabsTrigger value="annotations">Annotations ({annotations.length})</TabsTrigger>
                <TabsTrigger value="statistics">Statistics</TabsTrigger>
              </TabsList>
              <div className="flex items-center gap-2 ml-2">
                <Button size="sm" variant="ghost" onClick={() => setRightCollapsed(v => !v)}>
                  {rightCollapsed ? <ChevronLeft className="w-4 h-4"/> : <ChevronRight className="w-4 h-4"/>}
                </Button>
              </div>
            </div>

            <TabsContent value="annotations" className="flex-1 flex flex-col min-h-0 overflow-hidden">
              <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ scrollbarWidth: 'thin' }}>
                <div className="p-4 space-y-2">
                  {annotations.map((annotation) => {
                    // Debug logging
                    if (annotation.id === selectedAnnotation) {
                      console.log('Rendering selected annotation:', annotation.id, 'selectedAnnotation:', selectedAnnotation);
                    }
                    return (
                    <Card 
                      key={annotation.id}
                      data-annotation-id={annotation.id}
                      className={`p-3 cursor-pointer transition-colors ${
                        selectedAnnotation === annotation.id 
                          ? 'border-blue-500 bg-blue-500/20' 
                          : 'border-gray-600 hover:border-gray-500'
                      }`}
                      onClick={() => {
                        console.log('Card clicked, setting selectedAnnotation to:', annotation.id);
                        setSelectedAnnotation(annotation.id);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded"
                            style={{ backgroundColor: annotation.color }}
                          />
                          <div>
                            {editingAnnotationId === annotation.id ? (
                              <div className="flex flex-col">
                                <Select value={editingAnnotationLabel || ''} onValueChange={(v) => setEditingAnnotationLabel(v)}>
                                  <SelectTrigger className="w-44"><SelectValue placeholder="Select class" /></SelectTrigger>
                                  <SelectContent>
                                    {classes.map(c => (
                                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <div className="flex justify-end gap-2 mt-1">
                                  <Button size="sm" onClick={() => { saveAnnotationLabel(annotation.id, editingAnnotationLabel); setEditingAnnotationId(null); }}>Save</Button>
                                  <Button size="sm" variant="outline" onClick={() => setEditingAnnotationId(null)}>Cancel</Button>
                                </div>
                                <p className="text-xs text-gray-400 capitalize">{annotation.type}</p>
                              </div>
                            ) : (
                              <div>
                                <p className="text-sm font-medium" onClick={(e) => { e.stopPropagation(); setEditingAnnotationId(annotation.id); const cls = classes.find(c => c.name === annotation.label); setEditingAnnotationLabel(cls ? cls.id : ''); }}>{annotation.label}</p>
                                <p className="text-xs text-gray-400 capitalize">{annotation.type}</p>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAnnotations(prev => prev.map(a => 
                                a.id === annotation.id 
                                  ? { ...a, visible: !a.visible }
                                  : a
                              ));
                            }}
                          >
                            {annotation.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingAnnotationId(annotation.id);
                              const cls = classes.find(c => c.name === annotation.label);
                              setEditingAnnotationLabel(cls ? cls.id : '');
                            }}
                          >
                            <Edit className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteAnnotation(annotation.id);
                            }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                    );
                  })}

                  {annotations.length === 0 && (
                    <p className="text-center text-gray-500 py-8">
                      No annotations yet.<br />
                      Select a class and start drawing!
                    </p>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="statistics" className="flex-1 overflow-auto p-4">
              <h4 className="text-sm font-medium mb-3">Class statistics (all images)</h4>
              <div className="space-y-2">
                {(() => {
                  const total = Object.values(globalStats).reduce((s, v) => s + v, 0);
                  if (classes.length === 0) {
                    return <p className="text-xs text-gray-500">No classes defined yet</p>;
                  }

                  return (
                    <div className="space-y-2">
                      <div className="text-xs text-gray-400 mb-2">Total annotations across all images: <span className="text-sm text-gray-100 font-medium">{total}</span></div>
                      {classes.map(c => {
                        const count = globalStats[c.name] || 0;
                        const pct = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
                        return (
                          <div key={c.id} className="flex items-center justify-between p-2 border rounded border-gray-700">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded" style={{ backgroundColor: c.color }} />
                              <div>
                                <div className="text-sm font-medium">{c.name}</div>
                                <div className="text-xs text-gray-400">{c.visible ? 'Visible' : 'Hidden'}</div>
                              </div>
                            </div>
                            <div className="text-sm text-gray-200">{count} <span className="text-xs text-gray-400">({pct}%)</span></div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </TabsContent>
          </Tabs>

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
    </div>
  );
};

export default ImageAnnotation;