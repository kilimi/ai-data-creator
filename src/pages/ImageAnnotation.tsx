import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
} from 'lucide-react';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { Image, ImageCollection } from '@/types';

// Annotation types
export type AnnotationTool = 'select' | 'rectangle' | 'circle' | 'polygon';

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
  const navigate = useNavigate();
  const { api } = useApi();
  const { toast } = useToast();

  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // State
  const [imageCollections, setImageCollections] = useState<ImageCollection[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [currentImageName, setCurrentImageName] = useState<string>('');
  const [displayLayer, setDisplayLayer] = useState<string>('');
  const [currentImage, setCurrentImage] = useState<Image | null>(null);
  const [displayImage, setDisplayImage] = useState<Image | null>(null);
  const [allImageNames, setAllImageNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTool, setActiveTool] = useState<AnnotationTool>('polygon');
  const [annotations, setAnnotations] = useState<AnnotationShape[]>([]);
  const [classes, setClasses] = useState<AnnotationClass[]>([]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
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
  const [editingClass, setEditingClass] = useState<string | null>(null);
  const [editingClassName, setEditingClassName] = useState('');

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
      foundDisplayImage = displayCollection.images.find(img => img.fileName === imageName) || null;
    }
    
    // If no specific layer selected or image not found in that layer, use current image
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
        
        // Don't reload classes when switching layers/images - they should be persistent
        // Classes are only added when creating new annotations
        
        toast({
          title: 'Annotations loaded',
          description: `Loaded ${parsedAnnotations.length} saved annotations`,
        });
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

    const imageCoords = screenToImageCoords(e.clientX, e.clientY);

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
    e.preventDefault(); // Prevent context menu
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
    if (!canvasRef.current || !imageRef.current || !displayImage) return;

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
  }, [annotations, selectedAnnotation, isDrawing, currentPath, activeTool, selectedClass, classes, imageScale, imageOffset, displayImage, imageToScreenCoords]);

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

  const handleImageLoad = () => {
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
    const scale = Math.min(scaleX, scaleY);

    setImageScale(scale);
    
    // Center image in container
    const scaledWidth = img.naturalWidth * scale;
    const scaledHeight = img.naturalHeight * scale;
    
    setImageOffset({
      x: (containerRect.width - scaledWidth) / 2,
      y: (containerRect.height - scaledHeight) / 2
    });

    redrawCanvas();
  };

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
    if (currentImageName && imageCollections.length > 0) {
      updateCurrentImages(currentImageName, layerId, imageCollections);
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
            <h1 className="text-lg font-semibold">Segmentation Annotation</h1>
            <p className="text-sm text-gray-400">
              Image {currentImageIndex + 1} of {allImageNames.length}: {currentImage?.fileName || currentImageName}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button onClick={saveAnnotations} disabled={annotations.length === 0}>
            <Save className="w-4 h-4 mr-2" />
            Save
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Tools and Classes */}
        <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
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
            </div>
          </div>

          {/* Image Layers */}
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-sm font-medium mb-3 flex items-center">
              <Layers className="w-4 h-4 mr-2" />
              Image Layers
            </h3>
            
            <div className="space-y-2">
              <div>
                <Label htmlFor="display-layer" className="text-xs text-gray-400">
                  Layer:
                </Label>
                <Select value={displayLayer || ''} onValueChange={handleLayerChange}>
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder="Select layer" />
                  </SelectTrigger>
                  <SelectContent>
                    {imageCollections.map((collection) => (
                      <SelectItem key={collection.id} value={collection.id}>
                        {collection.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {!displayImage && currentImageName && displayLayer && (
                <div className="text-xs text-yellow-400 bg-yellow-900/20 p-2 rounded">
                  <div className="font-medium">Image not found</div>
                  <div>Image "{currentImageName}" does not exist in {imageCollections.find(c => c.id === displayLayer)?.name || 'this layer'}</div>
                </div>
              )}
            </div>
          </div>

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
                {classes.map(classObj => (
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
                      <Badge variant="secondary" className="text-xs">
                        {classObj.count}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

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
                  <div className="text-lg font-medium">No Image Available</div>
                  <div className="text-sm">
                    Image "{currentImageName}" does not exist in {imageCollections.find(c => c.id === displayLayer)?.name || 'this layer'}
                  </div>
                  <div className="text-xs mt-2 text-gray-500">
                    Switch to a different layer or navigate to another image
                  </div>
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
                  {!displayImage && currentImageName && (
                    <span className="text-xs text-yellow-400">
                      Image not available in this layer
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Sidebar - Annotations List */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-sm font-medium">Annotations ({annotations.length})</h3>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {annotations.map((annotation, index) => (
                <Card 
                  key={annotation.id}
                  className={`p-3 cursor-pointer transition-colors ${
                    selectedAnnotation === annotation.id 
                      ? 'border-blue-500 bg-blue-500/20' 
                      : 'border-gray-600 hover:border-gray-500'
                  }`}
                  onClick={() => setSelectedAnnotation(annotation.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: annotation.color }}
                      />
                      <div>
                        <p className="text-sm font-medium">{annotation.label}</p>
                        <p className="text-xs text-gray-400 capitalize">{annotation.type}</p>
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
                          deleteAnnotation(annotation.id);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
              
              {annotations.length === 0 && (
                <p className="text-center text-gray-500 py-8">
                  No annotations yet.<br />
                  Select a class and start drawing!
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
};

export default ImageAnnotation;