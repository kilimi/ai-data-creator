import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Upload, Tag, Edit, Trash2, Eye, EyeOff, Download, Square, Loader, Brush, Merge, CheckSquare, X, ImageDown } from "lucide-react";
import { ClassStatistics } from "@/components/ClassStatistics";
import { Switch } from "@/components/ui/switch";
import { AnnotationSample, processCOCOAnnotations, AnnotationFile, generateClassColors } from "@/utils/annotations";
import { AnnotationsUploadDialog } from "@/components/AnnotationsUploadDialog";
import { AnnotationChoiceModal } from "@/components/AnnotationChoiceModal";
import { ClassColorPicker } from "@/components/ClassColorPicker";
import { ClassColorOpacityPicker } from "@/components/ClassColorOpacityPicker";
import { RenameClassDialog } from "./RenameClassDialog";
import { AnnotationTagsDialog } from "./AnnotationTagsDialog";
import { AnnotationFilters } from "./AnnotationFilters";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Image } from "@/types";
import { useRef } from "react";
import { MergeClassesDialog } from "./MergeClassesDialog";

interface AnnotationsContentProps {
  id: string;
  projectId?: string;
  className?: string;
  onShowAnnotationsChange?: (show: boolean, annotations: AnnotationSample[], annotationFiles?: AnnotationFile[]) => void;
  onImportAnnotations?: (files: File[]) => void;
  showAllAnnotationsOnGrid?: boolean;
  images?: Image[];
  
  currentPageImageIds?: string[]; // NEW: Current page image IDs
}

// Normalize segmentation: backend may store as flat array [x,y,x,y,...] instead of [[x,y,x,y,...]]
function normalizeSegmentation(seg: any): number[][] | undefined {
  if (!seg || !Array.isArray(seg) || seg.length === 0) return undefined;
  // If first element is a number, it's a flat array — wrap it
  if (typeof seg[0] === 'number') return [seg];
  // Already array of arrays
  return seg;
}

// Helper to convert AnnotationFile to COCO format
function toCOCOFormat(file: AnnotationFile) {
  // Extract unique categories from samples
  const categoryMap = new Map<string, number>();
  let categoryId = 1;
  (file.samples || []).forEach(sample => {
    if (!categoryMap.has(sample.className)) {
      categoryMap.set(sample.className, categoryId++);
    }
  });
  const categories = Array.from(categoryMap.entries()).map(([name, id]) => ({
    id,
    name,
    supercategory: ""
  }));

  // Helper to get image info by id from imageDetails
  function getImageInfo(imageId: string) {
    if (file.imageDetails && file.imageDetails[imageId]) {
      return {
        width: file.imageDetails[imageId].width,
        height: file.imageDetails[imageId].height
      };
    }
    // Fallback to default dimensions if not found
    return { width: 640, height: 480 };
  }

  return {
    info: {
      description: `Annotations for ${file.name}`,
      version: "1.0",
      year: new Date().getFullYear(),
      contributor: "LAI",
      date_created: new Date().toISOString()
    },
    licenses: [{
      id: 1,
      name: "Unknown License",
      url: ""
    }],
    images: Object.entries(file.imageMapping || {}).map(([imageId, fileName]) => {
      const { width, height } = getImageInfo(imageId);
      return {
        id: parseInt(imageId),
        width,
        height,
        file_name: fileName,
        license: 1,
        flickr_url: "",
        coco_url: "",
        date_captured: ""
      };
    }),
    categories,
    annotations: (file.samples || []).map((sample, index) => {
      const { width, height } = getImageInfo(sample.imageId);
      const bbox = sample.bbox ? [
        sample.bbox[0] * width,
        sample.bbox[1] * height,
        sample.bbox[2] * width,
        sample.bbox[3] * height
      ] : [0, 0, 0, 0];
      const area = sample.area || (sample.bbox ? sample.bbox[2] * sample.bbox[3] * width * height : 0);
      let segmentation = [];
      if (Array.isArray(sample.segmentation) && sample.segmentation.length > 0) {
        segmentation = sample.segmentation.map(poly => {
          if (!Array.isArray(poly) || poly.length < 6) return poly;
          const maxAbs = Math.max(...poly.map(v => Math.abs(v)));
          if (maxAbs <= 1.5) {
            // Normalized: scale to pixel coords
            return poly.map((v, i) => (i % 2 === 0 ? v * width : v * height));
          } else {
            // Already pixel coords: export as-is
            return poly;
          }
        });
      }
      return {
        id: index + 1,
        image_id: parseInt(sample.imageId),
        category_id: categoryMap.get(sample.className) || 1,
        bbox,
        area,
        iscrowd: 0,
        segmentation
      };
    })
  };
}

// Generate a random bright color for class annotations
function generateRandomColor(): string {
  const colors = [
    '#FF6B6B', // Red
    '#4ECDC4', // Teal
    '#45B7D1', // Blue
    '#96CEB4', // Green
    '#FECA57', // Yellow
    '#FF9FF3', // Pink
    '#54A0FF', // Light Blue
    '#5F27CD', // Purple
    '#00D2D3', // Cyan
    '#FF9F43', // Orange
    '#10AC84', // Emerald
    '#EE5A24', // Dark Orange
    '#0984E3', // Blue
    '#6C5CE7', // Purple
    '#A29BFE', // Light Purple
    '#FD79A8', // Pink
    '#FDCB6E', // Yellow
    '#6C5CE7', // Indigo
    '#00B894', // Mint
    '#E17055'  // Coral
  ];
  
  return colors[Math.floor(Math.random() * colors.length)];
}

// Get color for a class, generating a unique one if not already assigned
function getOrAssignClassColor(className: string, existingColors: { [className: string]: string }, usedColors: Set<string> = new Set()): string {
  if (existingColors[className]) {
    return existingColors[className];
  }
  
  // Generate a color that hasn't been used yet
  const availableColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57', '#FF9FF3', 
    '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43', '#10AC84', '#EE5A24', 
    '#0984E3', '#6C5CE7', '#A29BFE', '#FD79A8', '#FDCB6E', '#00B894', '#E17055'
  ];
  
  // Add already used colors to the set
  Object.values(existingColors).forEach(color => usedColors.add(color));
  
  // Find an unused color
  let newColor = availableColors.find(color => !usedColors.has(color));
  
  // If all colors are used, just pick a random one
  if (!newColor) {
    newColor = availableColors[Math.floor(Math.random() * availableColors.length)];
  }
  
  return newColor;
}

export function AnnotationsContent({ 
  id, 
  projectId,
  className = "", 
  onShowAnnotationsChange,
  onImportAnnotations,
  showAllAnnotationsOnGrid = false, // NEW PROP
  images = [], // NEW PROP
  
  currentPageImageIds = [] // NEW
}: AnnotationsContentProps) {
  const navigate = useNavigate();
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [visibleAnnotations, setVisibleAnnotations] = useState<Set<string>>(new Set());
  
  const [annotationFiles, setAnnotationFiles] = useState<AnnotationFile[]>([]);
  const [filteredAnnotationFiles, setFilteredAnnotationFiles] = useState<AnnotationFile[]>([]);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showAnnotationChoiceModal, setShowAnnotationChoiceModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingFromBackend, setIsLoadingFromBackend] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [renameClassDialog, setRenameClassDialog] = useState<{ isOpen: boolean; className: string; annotationId: string }>({ isOpen: false, className: '', annotationId: '' });
  const [deleteClassDialog, setDeleteClassDialog] = useState<{ isOpen: boolean; className: string; annotationId: string }>({ isOpen: false, className: '', annotationId: '' });
  const [dirtyAnnotationIds, setDirtyAnnotationIds] = useState<Set<string>>(new Set());
  
  // Merge functionality state
  const [mergeMode, setMergeMode] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());
  const [tagsDialog, setTagsDialog] = useState<{ isOpen: boolean; annotationId: string; annotationName: string; currentTags: string[] }>({ isOpen: false, annotationId: '', annotationName: '', currentTags: [] });
  const [editingName, setEditingName] = useState<{ annotationId: string; newName: string } | null>(null);
  const [downloadImagesDialog, setDownloadImagesDialog] = useState<{ isOpen: boolean; annotationId: string; categories: Array<{ id: number; name: string }> }>({ isOpen: false, annotationId: '', categories: [] });
  
  // New state for smart annotation loading
  const [loadingAnnotations, setLoadingAnnotations] = useState<Set<string>>(new Set());
  const [currentPageAnnotations, setCurrentPageAnnotations] = useState<{ [fileId: string]: AnnotationSample[] }>({});
  const [lastLoadedPageIds, setLastLoadedPageIds] = useState<string[]>([]);
  
  // State for tracking import processing and background tasks
  const [importingFiles, setImportingFiles] = useState<Set<string>>(new Set());
  const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());
  const [activeTasks, setActiveTasks] = useState<Map<number, {
    id: number;
    name: string;
    description: string;
    task_type: string;
    status: string;
    progress: number;
    created_at: string;
    started_at?: string;
    completed_at?: string;
    error_message?: string;
    file_id?: string;
    fileName?: string;
  }>>(new Map());
  // Handler for renaming a class in an annotation file
  const markDirty = (annotationId: string) => {
    setDirtyAnnotationIds(prev => new Set(prev).add(annotationId));
  };
  const clearDirty = (annotationId: string) => {
    setDirtyAnnotationIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(annotationId);
      return newSet;
    });
  };

  const { api } = useApi();
  const { toast } = useToast();
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  // Smart annotation loading for current page
  const loadAnnotationsForCurrentPage = async (fileId: string, force = false, currentBboxState?: boolean) => {
    const file = annotationFiles.find(f => f.id === fileId);
    if (!file || !api) return null;

    // Prevent loading if already processing this file
    if ((file as any).isLoadingCurrentPage && !force) {
      console.log(`Skipping load for ${file.name} - already loading`);
      return null;
    }

    // Check if we need to load annotations for current page
    const currentPageString = currentPageImageIds.join(',');
    const lastPageString = lastLoadedPageIds.join(',');
    
    // Skip if already loaded for this page (unless forced)
    if (!force && currentPageString === lastPageString && currentPageAnnotations[fileId]) {
      return currentPageAnnotations[fileId];
    }

    try {
      // Mark file as loading to prevent duplicate requests
      setAnnotationFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, isLoadingCurrentPage: true } : f
      ));
      
      setLoadingAnnotations(prev => new Set(prev).add(fileId));
      
      console.log(`Loading annotations for file ${file.name} for current page with ${currentPageImageIds.length} images`);
      
      // Determine the bbox state to use
      const bboxState = currentBboxState !== undefined ? currentBboxState : file.showBboxes;
      
      // Try to use the new annotation data API first (better for large files)
      try {
        const annotationDataResponse = await api.getAnnotationData(id, fileId, {
          imageIds: currentPageImageIds,
          limit: 1000 // Get up to 1000 annotations for current page
        });
        
        if (annotationDataResponse?.success && annotationDataResponse.data?.annotations) {
          console.log(`Loaded ${annotationDataResponse.data.annotations.length} annotations using annotation data API`);
          console.log('Raw annotation data:', annotationDataResponse.data.annotations.slice(0, 2)); // Debug first 2 annotations
          
          // Track used colors to ensure uniqueness
          const usedColors = new Set(Object.values(file.classColors || {}));
          
          // Convert to our format
          const currentPageAnnotations = annotationDataResponse.data.annotations.map((anno: any): AnnotationSample => {
            const color = getOrAssignClassColor(anno.className, file.classColors || {}, usedColors);
            usedColors.add(color); // Track this color as used
            const annotationSample = {
              id: anno.id || `annotation_${anno.cocoAnnotationId || Math.random()}`,
              imageId: anno.imageId,
              className: anno.className,
              bbox: anno.bbox || [0, 0, 0, 0],
              segmentation: normalizeSegmentation(anno.segmentation),
              area: anno.area || 0,
              confidence: anno.confidence || 1.0,
              color: color,
              isVisible: true, // This controls mask visibility
              showBboxes: bboxState !== false,
              annotationFileName: file.name,
              referenceImageWidth: anno.imageWidth || undefined,
              referenceImageHeight: anno.imageHeight || undefined,
            };
            console.log(`Converted annotation for image ${anno.imageId}:`, annotationSample);
            return annotationSample;
          });
          
          console.log(`Converted ${currentPageAnnotations.length} annotations for current page`);
          
          // Update classColors with any new colors that were generated
          const updatedClassColors = { ...file.classColors };
          currentPageAnnotations.forEach(annotation => {
            if (!updatedClassColors[annotation.className]) {
              updatedClassColors[annotation.className] = annotation.color;
            }
          });
          
          // Cache the loaded annotations
          setCurrentPageAnnotations(prev => ({
            ...prev,
            [fileId]: currentPageAnnotations
          }));
          
          setLastLoadedPageIds([...currentPageImageIds]);
          
          // Update the file with the loaded samples and mark as loaded
          const updatedFiles = annotationFiles.map(f => 
            f.id === fileId 
              ? { 
                  ...f, 
                  samples: currentPageAnnotations, 
                  classColors: updatedClassColors, // Save the updated colors
                  // Use the bbox state parameter if provided, otherwise preserve current state
                  showBboxes: currentBboxState !== undefined ? currentBboxState : f.showBboxes,
                  currentPageLoaded: true,
                  isLoadingCurrentPage: false,
                  // Re-detect type now that we have samples loaded
                  type: currentPageAnnotations.length > 0 ? (() => {
                    const hasSegmentation = currentPageAnnotations.some(sample => 
                      sample.segmentation && Array.isArray(sample.segmentation) && sample.segmentation.length > 0
                    );
                    const hasMeaningfulBbox = currentPageAnnotations.some(sample => 
                      sample.bbox && Array.isArray(sample.bbox) && sample.bbox.length === 4 && 
                      (sample.bbox[0] !== 0 || sample.bbox[1] !== 0 || sample.bbox[2] !== 0 || sample.bbox[3] !== 0)
                    );
                    
                    if (hasSegmentation && hasMeaningfulBbox) {
                      return 'segmentation-mask-bbox';
                    } else if (hasSegmentation) {
                      return 'segmentation-mask';
                    } else if (hasMeaningfulBbox) {
                      return 'segmentation-bbox';
                    } else {
                      return 'classification';
                    }
                  })() : f.type
                }
              : f
          );
          setAnnotationFiles(updatedFiles);
          
          console.log(`Updated annotation file ${file.name} with ${currentPageAnnotations.length} samples`);
          
          return currentPageAnnotations;
        }
      } catch (apiError) {
        console.log('Annotation data API failed, falling back to content API:', apiError);
      }
      
      // Fallback to original content loading method
      const contentResponse = await api.getAnnotationContent(id, fileId);
      if (!contentResponse.success || !contentResponse.data.content) {
        console.warn(`Failed to load annotation content for file ${file.name}:`, contentResponse);
        
        // Check if it's a large file
        if (contentResponse.data?.is_large) {
          console.log('File is too large for content API, annotations will be loaded on-demand');
          return [];
        }
        
        return [];
      }

      const cocoData = JSON.parse(contentResponse.data.content);
      
      // Filter annotations for current page images only
      const currentPageAnnotations = [];
      
      if (cocoData.annotations && Array.isArray(cocoData.annotations)) {
        // Create image ID mapping
        const imageMap = new Map();
        if (cocoData.images && Array.isArray(cocoData.images)) {
          cocoData.images.forEach((img: any) => {
            imageMap.set(img.id, img.file_name);
          });
        }

        // Track used colors to ensure uniqueness
        const usedColors = new Set(Object.values(file.classColors || {}));

        // Filter annotations for current page
        for (const anno of cocoData.annotations) {
          const imageName = imageMap.get(anno.image_id);
          if (!imageName) continue;
          
          // Check if this image is in current page
          const matchingImage = images.find(img => 
            img.fileName === imageName || 
            img.fileName === imageName.replace(/\.[^/.]+$/, '') || // without extension
            imageName.includes(img.fileName.replace(/\.[^/.]+$/, ''))
          );
          
          if (matchingImage && currentPageImageIds.includes(matchingImage.id)) {
            // Convert COCO annotation to our format
            const category = cocoData.categories?.find((cat: any) => cat.id === anno.category_id);
            const className = category ? category.name : `category_${anno.category_id}`;
            
            // Get image dimensions for bbox normalization
            const imageInfo = cocoData.images?.find((img: any) => img.id === anno.image_id);
            const imageWidth = imageInfo?.width || 1;
            const imageHeight = imageInfo?.height || 1;
            
            let bbox: [number, number, number, number] = [0, 0, 0, 0];
            if (anno.bbox && Array.isArray(anno.bbox) && anno.bbox.length === 4) {
              bbox = [
                anno.bbox[0] / imageWidth,
                anno.bbox[1] / imageHeight,
                anno.bbox[2] / imageWidth,
                anno.bbox[3] / imageHeight
              ] as [number, number, number, number];
            }

            const color = getOrAssignClassColor(className, file.classColors || {}, usedColors);
            usedColors.add(color); // Track this color as used

            const annotationSample: AnnotationSample = {
              id: `${fileId}_${anno.id}`,
              imageId: matchingImage.id,
              className,
              bbox,
              segmentation: normalizeSegmentation(anno.segmentation),
              area: anno.area,
              confidence: 1.0,
              color: color,
              isVisible: true, // This controls mask visibility
              showBboxes: bboxState !== false, // Use the passed bbox state
              annotationFileName: file.name,
              referenceImageWidth: imageWidth,
              referenceImageHeight: imageHeight,
            };
            
            currentPageAnnotations.push(annotationSample);
          }
        }
      }

      console.log(`Loaded ${currentPageAnnotations.length} annotations for current page from ${file.name}`);
      
      // Update classColors with any new colors that were generated
      const updatedClassColors = { ...file.classColors };
      currentPageAnnotations.forEach(annotation => {
        if (!updatedClassColors[annotation.className]) {
          updatedClassColors[annotation.className] = annotation.color;
        }
      });
      
      // Update the annotation file with loaded samples (reference dims set) and COCO images for correct mask scaling
      setAnnotationFiles(prev => prev.map(f => 
        f.id === fileId 
          ? { 
              ...f, 
              samples: currentPageAnnotations,
              cocoImages: cocoData.images || f.cocoImages,
              classColors: updatedClassColors,
              // Re-detect type now that we have samples loaded
              type: currentPageAnnotations.length > 0 ? (() => {
                const hasSegmentation = currentPageAnnotations.some(sample => 
                  sample.segmentation && Array.isArray(sample.segmentation) && sample.segmentation.length > 0
                );
                const hasMeaningfulBbox = currentPageAnnotations.some(sample => 
                  sample.bbox && Array.isArray(sample.bbox) && sample.bbox.length === 4 && 
                  (sample.bbox[0] !== 0 || sample.bbox[1] !== 0 || sample.bbox[2] !== 0 || sample.bbox[3] !== 0)
                );
                
                if (hasSegmentation && hasMeaningfulBbox) {
                  return 'segmentation-mask-bbox';
                } else if (hasSegmentation) {
                  return 'segmentation-mask';
                } else if (hasMeaningfulBbox) {
                  return 'segmentation-bbox';
                } else {
                  return 'classification';
                }
              })() : f.type
            }
          : f
      ));
      
      // Cache the loaded annotations
      setCurrentPageAnnotations(prev => ({
        ...prev,
        [fileId]: currentPageAnnotations
      }));
      
      setLastLoadedPageIds([...currentPageImageIds]);
      
      return currentPageAnnotations;
      
    } catch (error) {
      console.error('Error loading annotations for current page:', error);
      
      // Only show toast if it's not a network error (to avoid spam)
      if (!(error instanceof TypeError && error.message.includes('Failed to fetch'))) {
        toast({
          title: "Error loading annotations",
          description: `Failed to load annotations for ${file?.name || 'file'}`,
          variant: "destructive"
        });
      }
      
      return [];
    } finally {
      // Clear loading state
      setLoadingAnnotations(prev => {
        const newSet = new Set(prev);
        newSet.delete(fileId);
        return newSet;
      });
      
      // Clear the loading flag on the file
      setAnnotationFiles(prev => prev.map(f => 
        f.id === fileId ? { ...f, isLoadingCurrentPage: false } : f
      ));
    }
  };

  const handleRenameClass = async (annotationId: string, oldClassName: string, newClassName: string) => {
    try {
      let serverClasses: Array<{ className: string; count: number; color: string; opacity?: number }> | undefined;
      if (api) {
        const response = await api.renameAnnotationClass(id, annotationId, oldClassName, newClassName);
        if (!response.success) throw new Error(response.error || "Failed to rename class on server");
        serverClasses = response.data?.classes;
      }
      const updatedFiles = annotationFiles.map(file => {
        if (file.id !== annotationId) return file;
        const updatedClassColors = { ...file.classColors };
        if (updatedClassColors[oldClassName]) {
          updatedClassColors[newClassName] = updatedClassColors[oldClassName];
          delete updatedClassColors[oldClassName];
        }
        const updatedSamples = file.samples?.map(sample =>
          sample.className === oldClassName ? { ...sample, className: newClassName } : sample
        );
        const updatedClassStats = serverClasses?.length
          ? serverClasses.map(c => ({
              className: c.className,
              count: c.count ?? 0,
              color: updatedClassColors[c.className] ?? c.color ?? "#ea384c",
              opacity: c.opacity ?? 0.25,
            }))
          : file.classStats?.map(stat =>
              stat.className === oldClassName
                ? { ...stat, className: newClassName, count: stat.count ?? 0 }
                : { ...stat, count: stat.count ?? 0 }
            );
        return { ...file, classStats: updatedClassStats, samples: updatedSamples, classColors: updatedClassColors };
      });
      if (!api) localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      setAnnotationFiles(updatedFiles);
      if (selectedClass === oldClassName) setSelectedClass(newClassName);
      toast({ title: "Class renamed", description: `"${oldClassName}" renamed to "${newClassName}".` });
    } catch (error) {
      console.error('Error renaming class:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to rename class",
        variant: "destructive",
      });
    }
  };
  const [imageStatusDialog, setImageStatusDialog] = useState<{
    isOpen: boolean;
    type: 'present' | 'missing' | 'breakdown';
    files: string[];
    annotationFileName: string;
    presentCount?: number;
    missingCount?: number;
    presentFiles?: string[];
    missingFiles?: string[];
    isLoading?: boolean;
  }>({ isOpen: false, type: 'present', files: [], annotationFileName: '' });
  
  const [editDialog, setEditDialog] = useState<{
    isOpen: boolean;
    annotationId: string;
    currentName: string;
    newName: string;
  }>({ isOpen: false, annotationId: '', currentName: '', newName: '' });
  
  // Auto-detect annotation type based on content with detailed segmentation types
  const detectAnnotationType = (file: AnnotationFile): 'Classification' | 'Segmentation (mask+bbox)' | 'Segmentation (mask)' | 'Segmentation (bbox)' | 'Other' => {
    // If type is explicitly set, use it (but expand old types to new ones)
    if (file.type === 'Classification' || file.type === 'classification') return 'Classification';
    if (file.type === 'Segmentation (mask+bbox)' || file.type === 'segmentation-mask-bbox') return 'Segmentation (mask+bbox)';
    if (file.type === 'Segmentation (mask)' || file.type === 'segmentation-mask') return 'Segmentation (mask)';
    if (file.type === 'Segmentation (bbox)' || file.type === 'segmentation-bbox') return 'Segmentation (bbox)';
    if (file.type === 'segmentation') {
      // For old 'segmentation' type, we still need to detect the detailed subtype
      if (file.samples && file.samples.length > 0) {
        const hasSegmentation = file.samples.some(sample => 
          sample.segmentation && Array.isArray(sample.segmentation) && sample.segmentation.length > 0
        );
        const hasMeaningfulBbox = file.samples.some(sample => 
          sample.bbox && Array.isArray(sample.bbox) && sample.bbox.length === 4 && 
          (sample.bbox[0] !== 0 || sample.bbox[1] !== 0 || sample.bbox[2] !== 0 || sample.bbox[3] !== 0)
        );
        
        if (hasSegmentation && hasMeaningfulBbox) return 'Segmentation (mask+bbox)';
        if (hasSegmentation) return 'Segmentation (mask)';
        if (hasMeaningfulBbox) return 'Segmentation (bbox)';
      }
      return 'Segmentation (bbox)'; // Default fallback for old segmentation type
    }
    
    // Auto-detect based on samples content
    if (file.samples && file.samples.length > 0) {
      // Check if any annotation has segmentation mask data
      const hasSegmentation = file.samples.some(sample => 
        sample.segmentation && Array.isArray(sample.segmentation) && sample.segmentation.length > 0
      );
      
      // Check if annotations have meaningful bounding boxes (not [0,0,0,0])
      const hasMeaningfulBbox = file.samples.some(sample => 
        sample.bbox && Array.isArray(sample.bbox) && sample.bbox.length === 4 && 
        (sample.bbox[0] !== 0 || sample.bbox[1] !== 0 || sample.bbox[2] !== 0 || sample.bbox[3] !== 0)
      );
      
      // Determine detailed segmentation type
      if (hasSegmentation && hasMeaningfulBbox) {
        return 'Segmentation (mask+bbox)'; // Both masks and bounding boxes
      } else if (hasSegmentation) {
        return 'Segmentation (mask)'; // Only segmentation masks
      } else if (hasMeaningfulBbox) {
        return 'Segmentation (bbox)'; // Only bounding boxes (object detection)
      }
      
      // If all bboxes are [0,0,0,0] or missing, it's classification
      const hasOnlyEmptyBbox = file.samples.every(sample => 
        !sample.bbox || 
        (Array.isArray(sample.bbox) && sample.bbox.length === 4 && 
         sample.bbox[0] === 0 && sample.bbox[1] === 0 && sample.bbox[2] === 0 && sample.bbox[3] === 0)
      );
      if (hasOnlyEmptyBbox) return 'Classification';
    }
    
    // Check filename for hints
    if (file.name) {
      const nameLower = file.name.toLowerCase();
      if (nameLower.includes('classification') || nameLower.includes('class')) return 'Classification';
      if (nameLower.includes('mask') && nameLower.includes('bbox')) return 'Segmentation (mask+bbox)';
      if (nameLower.includes('mask')) return 'Segmentation (mask)';
      if (nameLower.includes('bbox') || nameLower.includes('detection')) return 'Segmentation (bbox)';
      if (nameLower.includes('segmentation') || nameLower.includes('seg')) return 'Segmentation (mask+bbox)';
    }
    
    // Check content for COCO classification patterns (for saved classifications)
    if ((file as any).content) {
      const content = (file as any).content;
      // COCO format with only category_ids and no bbox/segmentation
      if (content.annotations && Array.isArray(content.annotations)) {
        const hasOnlyCategories = content.annotations.every((ann: any) => 
          ann.category_id && !ann.bbox && !ann.segmentation
        );
        if (hasOnlyCategories && content.annotations.length > 0) return 'Classification';
      }
    }
    
    // If we have annotation data but can't determine type, default to bbox segmentation
    // since most COCO annotation files are object detection (bounding boxes)
    if (file.samples && file.samples.length > 0) {
      return 'Segmentation (bbox)';
    }
    
    // Default to "Other" until we can analyze the content
    return 'Other';
  };

  // Handler for managing tags
  const handleTagsClick = (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const file = annotationFiles.find(f => f.id === annotationId);
    if (file) {
      setTagsDialog({
        isOpen: true,
        annotationId: annotationId,
        annotationName: file.name,
        currentTags: file.tags || []
      });
    }
  };

  const handleSaveTags = async (tags: string[]) => {
    const annotationId = tagsDialog.annotationId;
    console.log(`Saving tags for annotation ${annotationId}:`, tags); // Debug log
    
    const updatedFiles = annotationFiles.map(file => 
      file.id === annotationId 
        ? { 
            ...file, 
            tags: tags,
            // Update all samples to reflect the new tags
            samples: file.samples?.map(sample => ({
              ...sample,
              annotationFileName: file.name
            }))
          }
        : file
    );

    try {
      let success = true;
      if (api) {
        // Call the API to update tags in the database
        console.log(`Calling API to save tags for annotation ${annotationId}:`, tags);
        const response = await api.updateAnnotationTags(id, annotationId, tags);
        console.log('API response for saving tags:', response); // Debug log
        if (!response.success) {
          success = false;
          throw new Error(response.error || "Failed to save tags on server");
        }
      } else {
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      }

      if (success) {
        setAnnotationFiles(updatedFiles);
        console.log('Tags successfully saved and state updated'); // Debug log
        // Also update localStorage for local persistence (backup)
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      }
    } catch (error) {
      console.error('Error saving tags:', error); // Debug log
      throw error; // Re-throw to be handled by the dialog
    }
  };

  // Handler for inline name editing
  const handleStartEditName = (annotationId: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingName({ annotationId, newName: currentName });
  };

  const handleSaveEditName = async () => {
    if (!editingName || !editingName.newName.trim()) return;

    const { annotationId, newName } = editingName;
    const trimmedName = newName.trim();

    // Check if name already exists
    if (annotationFiles.some(f => f.id !== annotationId && f.name === trimmedName)) {
      toast({
        title: "Name already exists",
        description: "An annotation file with this name already exists.",
        variant: "destructive",
      });
      return;
    }

    try {
      const updatedFiles = annotationFiles.map(file => 
        file.id === annotationId 
          ? { 
              ...file, 
              name: trimmedName,
              samples: file.samples?.map(sample => ({
                ...sample,
                annotationFileName: trimmedName
              }))
            }
          : file
      );

      let success = true;
      if (api) {
        try {
          const response = await api.renameAnnotation(id, annotationId, trimmedName);
          if (!response.success) {
            success = false;
            throw new Error(response.error || "Failed to rename annotation file on server");
          }
        } catch (error) {
          success = false;
          throw error;
        }
      } else {
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      }

      if (success) {
        setAnnotationFiles(updatedFiles);
        setEditingName(null);
        toast({
          title: "Annotation renamed",
          description: `Successfully renamed to "${trimmedName}".`,
        });
      }
    } catch (error) {
      toast({
        title: "Rename failed",
        description: error instanceof Error ? error.message : "Failed to rename annotation file.",
        variant: "destructive",
      });
    }
  };

  const handleCancelEditName = () => {
    setEditingName(null);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveEditName();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEditName();
    }
  };

  // Merge annotations handler
  const handleMergeAnnotations = async () => {
    console.log("Merge button clicked, selected files:", selectedForMerge.size);
    if (selectedForMerge.size < 2) {
      toast({
        title: "Invalid selection",
        description: "Please select at least 2 annotation files to merge.",
        variant: "destructive",
      });
      return;
    }

    const filesToMerge = annotationFiles.filter(file => selectedForMerge.has(file.id));
    
    try {
      if (!api) {
        throw new Error("API not available");
      }

      // Generate merged filename
      const mergedFileName = `merged_${filesToMerge.map(f => f.name.replace(/\.[^/.]+$/, '')).join('_')}.json`;
      
      // Call backend merge endpoint
      const response = await api.mergeAnnotationFiles(
        id, 
        Array.from(selectedForMerge), 
        mergedFileName
      );
      
      if (response.success) {
        toast({
          title: "Annotation merge started",
          description: `Merging ${filesToMerge.length} annotation files into "${mergedFileName}". Check tasks for progress.`,
        });
        
        // Reset merge mode
        setMergeMode(false);
        setSelectedForMerge(new Set());
        
        // Refresh annotation files after a short delay to allow task to start
        setTimeout(async () => {
          await loadAnnotationFilesFromBackend();
        }, 1000);
      } else {
        throw new Error(response.error || "Failed to start merge task");
      }
      
    } catch (error) {
      console.error('Error merging annotations:', error);
      toast({
        title: "Merge failed",
        description: error instanceof Error ? error.message : "Failed to merge annotation files.",
        variant: "destructive",
      });
    }
  };

  // Sync filtered annotations with annotation files when they change
  useEffect(() => {
    setFilteredAnnotationFiles(annotationFiles);
  }, [annotationFiles]);

  const handleMergeClasses = async (annotationId: string, sources: string[], mergedName: string) => {
    console.log(`[MERGE DEBUG] handleMergeClasses called - annotationId: ${annotationId}, sources: [${sources.join(', ')}], mergedName: ${mergedName}`);
    const originalFile = annotationFiles.find(f => f.id === annotationId);
    console.log(`[MERGE DEBUG] originalFile samples length: ${originalFile?.samples?.length || 0}`);
    console.log(`[MERGE DEBUG] originalFile classStats:`, originalFile?.classStats);
    
    const updatedFiles = annotationFiles.map(file => {
      if (file.id === annotationId) {
        // Update samples
        const updatedSamples = file.samples?.map(sample =>
          sources.includes(sample.className)
            ? { ...sample, className: mergedName }
            : sample
        );
        // Update classStats
        const mergedCount = file.classStats
          ?.filter(stat => sources.includes(stat.className))
          .reduce((sum, stat) => sum + (stat.count || 0), 0) || 0;
        const filteredStats = file.classStats?.filter(stat => !sources.includes(stat.className)) || [];
        // If mergedName already exists, add to its count, else create new stat
        let found = false;
        let mergedColor: string | undefined = undefined;
        let mergedOpacity: number | undefined = undefined;
        file.classStats?.forEach(stat => {
          if (sources.includes(stat.className)) {
            if (!mergedColor && stat.color) mergedColor = stat.color;
            if (mergedOpacity === undefined && stat.opacity !== undefined) mergedOpacity = stat.opacity;
          }
        });
        const updatedClassStats = filteredStats.map(stat => {
          if (stat.className === mergedName) {
            found = true;
            return { ...stat, count: (stat.count || 0) + mergedCount };
          }
          return stat;
        });
        if (!found && mergedCount > 0) {
          updatedClassStats.push({ className: mergedName, count: mergedCount, color: mergedColor || generateRandomColor(), ...(mergedOpacity !== undefined ? { opacity: mergedOpacity } : {}) });
        }
        // Update classColors
        const updatedClassColors = { ...file.classColors };
        sources.forEach(source => {
          delete updatedClassColors[source];
        });
        if (mergedColor) {
          updatedClassColors[mergedName] = mergedColor;
        }
        return {
          ...file,
          samples: updatedSamples,
          classStats: updatedClassStats,
          classColors: updatedClassColors,
        };
      }
      return file;
    });
    setAnnotationFiles(updatedFiles);
    
    // Automatically save the changes to the backend
    const updatedFile = updatedFiles.find(f => f.id === annotationId);
    if (updatedFile && api) {
      try {
        // CRITICAL: Ensure samples are loaded before converting to COCO
        // If samples were just updated in memory but not fully loaded, we need the complete data
        let fileWithSamples = updatedFile;
        console.log(`[MERGE DEBUG] updatedFile.samples length: ${updatedFile.samples?.length || 0}`);
        console.log(`[MERGE DEBUG] updatedFile.imageMapping:`, updatedFile.imageMapping);
        if (!updatedFile.samples || updatedFile.samples.length === 0) {
          console.log(`Loading samples for ${updatedFile.name} before saving merge...`);
          const contentResponse = await api.getAnnotationContent(id, updatedFile.id);
          if (contentResponse && contentResponse.success && contentResponse.data.content) {
            const mockFile = new File([contentResponse.data.content], updatedFile.name, { type: 'application/json' });
            const result = await processCOCOAnnotations(mockFile, id);
            console.log(`[MERGE DEBUG] processCOCOAnnotations returned ${result.samples.length} samples`);
            // Apply the class merge to the freshly loaded samples
            const mergedSamples = result.samples.map(sample =>
              sources.includes(sample.className)
                ? { ...sample, className: mergedName }
                : sample
            );
            fileWithSamples = {
              ...updatedFile,
              samples: mergedSamples,
              imageMapping: result.imageMapping || updatedFile.imageMapping,
              imageDetails: result.imageDetails || updatedFile.imageDetails
            };
            console.log(`Loaded ${mergedSamples.length} samples with merged classes`);
          }
        } else {
          console.log(`[MERGE DEBUG] Using updatedFile.samples directly (${updatedFile.samples.length} samples)`);
        }
        
        console.log(`[MERGE DEBUG] fileWithSamples.samples length before toCOCOFormat: ${fileWithSamples.samples?.length || 0}`);
        console.log(`[MERGE DEBUG] fileWithSamples.imageMapping:`, fileWithSamples.imageMapping);
        const cocoData = toCOCOFormat(fileWithSamples);
        console.log(`[MERGE DEBUG] toCOCOFormat returned ${cocoData.annotations.length} annotations`);
        console.log(`[MERGE DEBUG] toCOCOFormat returned ${cocoData.images.length} images`);
        const jsonContent = JSON.stringify(cocoData, null, 2);
        const fileToUpload = new File([jsonContent], fileWithSamples.name, { type: 'application/json' });
        const response = await api.updateAnnotationContent(id, annotationId, fileToUpload);
        if (!response.success) {
          throw new Error(response.error || "Failed to save merged classes");
        }
        toast({ title: "Classes merged", description: `Merged [${sources.join(", ")}] into '${mergedName}' and saved to database.` });
      } catch (error) {
        markDirty(annotationId);
        toast({ 
          title: "Classes merged (not saved)", 
          description: `Merged classes but failed to save: ${error instanceof Error ? error.message : "Unknown error"}. Please save manually.`,
          variant: "destructive"
        });
      }
    } else {
      markDirty(annotationId);
      toast({ title: "Classes merged", description: `Merged [${sources.join(", ")}] into '${mergedName}'.` });
    }
  };

  // Save annotations to localStorage only when no API is available
  useEffect(() => {
    if (annotationFiles.length > 0 && !api) {
      saveAnnotationFilesToLocalStorage(annotationFiles);
    }
  }, [annotationFiles, id, api]);
  
  // Save visibility state to localStorage
  useEffect(() => {
    localStorage.setItem(`annotation_visibility_${id}`, JSON.stringify(Array.from(visibleAnnotations)));
  }, [visibleAnnotations, id]);

  // Use images directly, since parent now passes a stable reference
  const imagesMemo = images;

  // Map annotation COCO image IDs to actual uploaded image IDs using filename
  function mapAnnotationImageIds(annotations: AnnotationSample[], annotationFile: AnnotationFile): AnnotationSample[] {
    if (!annotationFile.imageMapping || imagesMemo.length === 0) {
      return annotations;
    }
    
    // Create a mapping from filename to actual image ID
    const filenameToImageId: { [filename: string]: string } = {};
    imagesMemo.forEach(img => {
      filenameToImageId[img.fileName] = img.id;
    });
    
    let mappedCount = 0;
    const mappedAnnotations = annotations.map(annotation => {
      // Annotation may already have dataset image id (e.g. from content load with reference set); pass through unchanged
      if (imagesMemo.some(img => String(img.id) === String(annotation.imageId))) {
        return annotation;
      }
      // Get the filename from the COCO image ID using the stored mapping
      const filename = annotationFile.imageMapping![annotation.imageId];
      if (filename && filenameToImageId[filename]) {
        mappedCount++;
        
        // NEW: Re-scale annotations based on actual image dimensions
        const image = imagesMemo.find(img => img.fileName === filename);
        const cocoImage = annotationFile.cocoImages?.find((img: { id: number }) => img.id.toString() === annotation.imageId.toString());

        if (image && cocoImage && (annotation.bbox || annotation.segmentation)) {
          const scaleX = image.width / cocoImage.width;
          const scaleY = image.height / cocoImage.height;

          const scaledAnnotation = { ...annotation };

          if (scaledAnnotation.bbox) {
            scaledAnnotation.bbox = [
              scaledAnnotation.bbox[0] * scaleX,
              scaledAnnotation.bbox[1] * scaleY,
              scaledAnnotation.bbox[2] * scaleX,
              scaledAnnotation.bbox[3] * scaleY,
            ] as [number, number, number, number];
          }

          if (scaledAnnotation.segmentation) {
            scaledAnnotation.segmentation = scaledAnnotation.segmentation.map(polygon =>
              polygon.map((point, index) => (index % 2 === 0 ? point * scaleX : point * scaleY))
            );
          }
          
          return {
            ...scaledAnnotation,
            imageId: filenameToImageId[filename],
            referenceImageWidth: image.width,
            referenceImageHeight: image.height,
          };
        }

        // Fallback: keep annotation as-is but use dataset image dimensions as reference if we have them (image already declared above)
        return {
          ...annotation,
          imageId: filenameToImageId[filename],
          ...(image?.width && image?.height && !annotation.referenceImageWidth && !annotation.referenceImageHeight
            ? { referenceImageWidth: image.width, referenceImageHeight: image.height }
            : {}),
        };
      }
      return annotation;
    });
    
    return mappedAnnotations;
  }

  // Update visible annotations based on currently visible files
  const updateVisibleAnnotations = useCallback(() => {
    console.log('updateVisibleAnnotations called');
    console.log('annotationFiles:', annotationFiles.length);
    console.log('visibleAnnotations:', Array.from(visibleAnnotations));
    
    const allVisibleAnnotations: AnnotationSample[] = [];
    annotationFiles.forEach(file => {
      // Include annotations if the eye button is enabled (visibleAnnotations.has(file.id))
      if (visibleAnnotations.has(file.id) && file.samples) {
        console.log(`Processing visible file ${file.name} with ${file.samples.length} samples`);
        // Map the annotation image IDs to actual uploaded image IDs
        const mappedSamples = mapAnnotationImageIds(file.samples, file);
        console.log(`Mapped to ${mappedSamples.length} samples`);
        
        // Attach the annotation file name and set visibility based on file settings
        const samplesWithFileName = mappedSamples.map(sample => ({
          ...sample,
          annotationFileName: file.name,
          // Set visibility based on eye button (if file is in visibleAnnotations, it should be visible)
          isVisible: true, // This controls mask visibility
          // Set bbox visibility based on bbox button state
          showBboxes: file.showBboxes !== false
        }));
        
        console.log(`Added ${samplesWithFileName.length} samples from ${file.name}, showBboxes: ${file.showBboxes}`);
        allVisibleAnnotations.push(...samplesWithFileName);
      } else if (visibleAnnotations.has(file.id)) {
        console.log(`File ${file.name} is visible but has no samples`);
      }
    });
    
    console.log(`Total visible annotations: ${allVisibleAnnotations.length}`);
    
    // Debug: Check if annotations have segmentation data
    const annotationsWithSegmentation = allVisibleAnnotations.filter(ann => ann.segmentation && ann.segmentation.length > 0);
    console.log(`Annotations with segmentation data: ${annotationsWithSegmentation.length}`);
    if (annotationsWithSegmentation.length > 0) {
      console.log('Sample annotation with segmentation:', {
        id: annotationsWithSegmentation[0].id,
        imageId: annotationsWithSegmentation[0].imageId,
        className: annotationsWithSegmentation[0].className,
        isVisible: annotationsWithSegmentation[0].isVisible,
        hasSegmentation: !!annotationsWithSegmentation[0].segmentation,
        segmentationLength: annotationsWithSegmentation[0].segmentation?.length || 0
      });
    }
    
    if (onShowAnnotationsChange) {
      // If showAllAnnotationsOnGrid is true, always show all annotations
      if (showAllAnnotationsOnGrid) {
        const allAnnotations = annotationFiles.flatMap(file => {
          const mappedSamples = mapAnnotationImageIds(file.samples || [], file);
          return mappedSamples.map(sample => ({
            ...sample,
            annotationFileName: file.name,
            // Eye icon controls mask visibility; only show masks when file is in visibleAnnotations
            isVisible: visibleAnnotations.has(file.id),
            showBboxes: file.showBboxes !== false
          }));
        });
        console.log(`Sending ${allAnnotations.length} annotations to parent (showAllAnnotationsOnGrid mode)`);
        onShowAnnotationsChange(allAnnotations.length > 0, allAnnotations, annotationFiles);
      } else {
        console.log(`Sending ${allVisibleAnnotations.length} visible annotations to parent`);
        onShowAnnotationsChange(allVisibleAnnotations.length > 0, allVisibleAnnotations, annotationFiles);
      }
    }
  }, [annotationFiles, visibleAnnotations, imagesMemo, showAllAnnotationsOnGrid]); // REMOVE onShowAnnotationsChange from deps
  
  // Update visible annotations whenever visibility, annotation files, or images change
  useEffect(() => {
    updateVisibleAnnotations();
  }, [annotationFiles, visibleAnnotations, imagesMemo, showAllAnnotationsOnGrid]); // REMOVE updateVisibleAnnotations from deps to prevent infinite loop

  // Reset currentPageLoaded flag when page changes
  useEffect(() => {
    if (currentPageImageIds.length > 0) {
      setAnnotationFiles(prev => prev.map(f => ({ 
        ...f, 
        currentPageLoaded: false,
        isLoadingCurrentPage: false 
      })));
    }
  }, [currentPageImageIds.join(',')]); // Only trigger when actual page changes

  // Auto-load annotations for current page when page changes
  useEffect(() => {
    if (currentPageImageIds.length > 0 && api) {
      // Find annotation files that need loading for current page
      const filesNeedingLoad = annotationFiles.filter(file => 
        visibleAnnotations.has(file.id) &&
        !(file as any).currentPageLoaded &&
        !loadingAnnotations.has(file.id) && // Don't load if already loading
        !(file as any).isLoadingCurrentPage // Additional check to prevent loading if already processing
      );
      
      if (filesNeedingLoad.length > 0) {
        console.log(`Auto-loading annotations for ${filesNeedingLoad.length} files. Current page has ${currentPageImageIds.length} images.`);
        
        // Load annotations for each file immediately (database is fast)
        filesNeedingLoad.forEach((file) => {
          loadAnnotationsForCurrentPage(file.id, true);
        });
      }
    }
  }, [currentPageImageIds, annotationFiles, visibleAnnotations, api]); // Removed loadAnnotationsForCurrentPage from dependencies

  // Handle restoration notification after both annotation files and visibility are loaded
  useEffect(() => {
    if (annotationFiles.length > 0 && onShowAnnotationsChange) {
      const allVisibleAnnotations: AnnotationSample[] = [];
      
      annotationFiles.forEach(file => {
        if (visibleAnnotations.has(file.id) && file.samples) {
          // Map the annotation image IDs to actual uploaded image IDs
          const mappedSamples = mapAnnotationImageIds(file.samples, file);
          const samplesWithFileName = mappedSamples.map(sample => ({
            ...sample,
            annotationFileName: file.name,
            // Set visibility based on eye button (if file is in visibleAnnotations, it should be visible)
            isVisible: true,
            // Set bbox visibility based on bbox button state
            showBboxes: file.showBboxes !== false
          }));
          allVisibleAnnotations.push(...samplesWithFileName);
        }
      });
      
      if (allVisibleAnnotations.length > 0) {
        onShowAnnotationsChange(true, allVisibleAnnotations, annotationFiles);
      } else {
        onShowAnnotationsChange(false, [], annotationFiles);
      }
    }
  }, [annotationFiles, visibleAnnotations, imagesMemo]);
  
  // Update annotation color
  const handleClassColorChange = (annotationId: string, className: string, newColor: string) => {
    const updatedFiles = annotationFiles.map(file => {
      if (file.id === annotationId) {
        const updatedClassColors = { ...file.classColors, [className]: newColor };
        const updatedClassStats = file.classStats?.map(stat => 
          stat.className === className ? { ...stat, color: newColor } : stat
        );
        const updatedSamples = file.samples?.map(sample => 
          sample.className === className ? { 
            ...sample, 
            color: newColor,
            annotationFileName: file.name // Preserve annotationFileName
          } : {
            ...sample,
            annotationFileName: file.name // Ensure all samples have annotationFileName
          }
        );
        
        return {
          ...file,
          classColors: updatedClassColors,
          classStats: updatedClassStats,
          samples: updatedSamples
        };
      }
      return file;
    });
    
    setAnnotationFiles(updatedFiles);
    
    // Save updated files to localStorage only when no API is available
    if (!api) {
      localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
    }
  };

  // Update annotation color and opacity
  const handleClassColorOpacityChange = (annotationId: string, className: string, newColor: string, opacity: number) => {
    const updatedFiles = annotationFiles.map(file => {
      if (file.id === annotationId) {
        const updatedClassColors = { ...file.classColors, [className]: newColor };
        const updatedClassStats = file.classStats?.map(stat => 
          stat.className === className ? { ...stat, color: newColor, opacity: opacity } : stat
        );
        const updatedSamples = file.samples?.map(sample => 
          sample.className === className ? { 
            ...sample, 
            color: newColor, 
            opacity: opacity,
            annotationFileName: file.name // Preserve annotationFileName
          } : {
            ...sample,
            annotationFileName: file.name // Ensure all samples have annotationFileName
          }
        );
        
        return {
          ...file,
          classColors: updatedClassColors,
          classStats: updatedClassStats,
          samples: updatedSamples
        };
      }
      return file;
    });
    
    setAnnotationFiles(updatedFiles);
    
    // Save updated files to localStorage only when no API is available
    if (!api) {
      localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
    }
  };

  const handleAnnotationClick = (annotationId: string) => {
    if (mergeMode) {
      // In merge mode, toggle merge selection instead of expanding statistics
      setSelectedForMerge(prev => {
        const newSet = new Set(prev);
        if (newSet.has(annotationId)) {
          newSet.delete(annotationId);
        } else {
          newSet.add(annotationId);
        }
        return newSet;
      });
      return;
    }
    const newSelectedAnnotation = annotationId === selectedAnnotation ? null : annotationId;
    setSelectedAnnotation(newSelectedAnnotation);
  };  // Helper function to safely save annotation files to localStorage with smart pagination
  const saveAnnotationFilesToLocalStorage = (files: AnnotationFile[]) => {
    // Only save if no API is available (localStorage is fallback)
    if (api) return;
    
    // Check if dataset is too large for localStorage (estimate size)
    const totalSamples = files.reduce((sum, file) => sum + (file.samples?.length || 0), 0);
    
    try {
      if (totalSamples > 1000) {
        // For large datasets: Store metadata + samples for images that are present in the dataset
        console.log(`Large dataset detected (${totalSamples} samples), storing metadata + relevant samples only`);
        
        const previewFiles = files.map(file => {
          // Filter samples to only include those for images present in the current dataset
          const relevantSamples = file.samples?.filter(sample => {
            if (!file.imageMapping) return false;
            const filename = file.imageMapping[sample.imageId];
            if (!filename) return false;
            // Check if this image file exists in the current dataset
            return imagesMemo.some(img => img.fileName === filename);
          }) || [];
          
          // Take up to 50 relevant samples instead of just first 20
          const limitedSamples = relevantSamples.slice(0, 50);
          
          return {
            id: file.id,
            name: file.name,
            date: file.date,
            format: file.format,
            type: file.type,
            classCount: file.classCount,
            imageCount: file.imageCount,
            matchedImageCount: file.matchedImageCount,
            datasetId: file.datasetId,
            isVisible: file.isVisible,
            showBboxes: file.showBboxes,
            classColors: file.classColors,
            imageMapping: file.imageMapping, // IMPORTANT: Preserve full image mapping for present/missing counts
            tags: file.tags,
            classStats: file.classStats,
            // Store total count from database (already mapped to totalSampleCount)
            totalSampleCount: file.totalSampleCount || 0,
            samples: limitedSamples,
            isLargeDataset: true, // Flag to indicate this is a partial dataset
            relevantSamplesCount: relevantSamples.length // Track how many samples are relevant to current dataset
          };
        });
        
        localStorage.setItem(`annotations_${id}`, JSON.stringify(previewFiles));
        localStorage.setItem(`annotations_${id}_large_dataset_flag`, 'true');
        
        // Store pagination info
        localStorage.setItem(`annotations_${id}_pagination`, JSON.stringify({
          totalFiles: files.length,
          totalSamples: totalSamples,
          previewSize: 50, // Increased from 20
          currentPage: 1,
          lastUpdate: Date.now()
        }));
        
      } else {
        // For small datasets: Store everything as before
        const lightweightFiles = files.map(file => ({
          id: file.id,
          name: file.name,
          date: file.date,
          format: file.format,
          type: file.type,
          classCount: file.classCount,
          imageCount: file.imageCount,
          matchedImageCount: file.matchedImageCount,
          datasetId: file.datasetId,
          isVisible: file.isVisible,
          showBboxes: file.showBboxes,
          classColors: file.classColors,
          imageMapping: file.imageMapping, // Preserve image mapping for present/missing counts
          tags: file.tags,
          classStats: file.classStats,
          samples: file.samples,
          totalSampleCount: file.totalSampleCount || 0,
          isLargeDataset: false
        }));
        
        localStorage.setItem(`annotations_${id}`, JSON.stringify(lightweightFiles));
        localStorage.removeItem(`annotations_${id}_large_dataset_flag`);
      }
      
    } catch (error) {
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('LocalStorage quota exceeded even with preview mode, storing absolute minimum...');
        
        // Emergency fallback: Store only the most essential metadata
        try {
          const emergencyFiles = files.map(file => ({
            id: file.id,
            name: file.name,
            isVisible: file.isVisible,
            showBboxes: file.showBboxes,
            classCount: file.classCount,
            imageCount: file.imageCount, // Total image count for display
            totalSampleCount: file.totalSampleCount || 0,
            imageMapping: file.imageMapping, // Try to preserve for present/missing counts
            emergency: true
          }));
          
          localStorage.setItem(`annotations_${id}`, JSON.stringify(emergencyFiles));
          localStorage.setItem(`annotations_${id}_emergency_mode`, 'true');
          
          toast({
            title: "Large dataset detected",
            description: "Storing minimal data locally. Full features available with backend connection.",
            variant: "default"
          });
          
        } catch (emergencyError) {
          console.error('Failed to save even emergency annotation data:', emergencyError);
          
          // Try one more time without imageMapping if it's too large
          try {
            const minimalFiles = files.map(file => ({
              id: file.id,
              name: file.name,
              isVisible: file.isVisible,
              showBboxes: file.showBboxes,
              classCount: file.classCount,
              imageCount: file.imageCount || 0, // At least preserve total count
              totalSampleCount: file.totalSampleCount || 0,
              emergency: true,
              noImageMapping: true // Flag to indicate imageMapping was omitted
            }));
            
            localStorage.setItem(`annotations_${id}`, JSON.stringify(minimalFiles));
            localStorage.setItem(`annotations_${id}_emergency_mode`, 'true');
            
            toast({
              title: "Minimal data stored",
              description: "Image matching unavailable locally. Connect to backend for full features.",
              variant: "default"
            });
            
          } catch (finalError) {
            // Clear localStorage completely and show warning
            localStorage.removeItem(`annotations_${id}`);
            
            toast({
              title: "Dataset too large for local storage",
              description: "Please use backend database for large annotation datasets.",
              variant: "destructive"
            });
          }
        }
      } else {
        console.error('Failed to save annotation files to localStorage:', error);
      }
    }
  };

  const handleToggleAnnotationVisibility = async (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const file = annotationFiles.find(f => f.id === annotationId);
    if (!file) return;
    
    const isBecomingVisible = !visibleAnnotations.has(annotationId);
    
    // If trying to make annotations visible, check if we have any matching images
    if (isBecomingVisible) {
      // For large files, use a different approach - check if we have current page images
      if (!file.imageMapping && api) {
        console.log('Checking annotation availability for current page images...');
        try {
          // Get current page image IDs
          const currentImageIds = currentPageImageIds;
          
          if (currentImageIds.length === 0) {
            toast({
              title: "No images on current page",
              description: "Navigate to a page with images to view annotations.",
              variant: "default"
            });
            return;
          }
          
          // Try to load annotations for current page images only
          console.log(`Checking annotations for ${currentImageIds.length} current page images`);
          const annotationDataResponse = await api.getAnnotationData(id, file.id, {
            imageIds: currentImageIds,
            limit: 10 // Just check if any exist
          });
          
          if (annotationDataResponse?.success && annotationDataResponse.data) {
            const hasAnnotations = annotationDataResponse.data.annotations && annotationDataResponse.data.annotations.length > 0;
            
            console.log(`Visibility check result: ${hasAnnotations ? 'found' : 'no'} annotations for current page`);
            console.log('Annotation data response:', annotationDataResponse.data);
            
            if (!hasAnnotations) {
              toast({
                title: "No annotations for current page",
                description: "There are no annotations for images on the current page. Try navigating to other pages.",
                variant: "default"
              });
              return;
            }
            
            console.log(`Found ${annotationDataResponse.data.annotations.length} annotations for current page - proceeding with visibility toggle`);
          } else {
            // Fallback to original method for smaller files
            console.log('Falling back to full content loading...');
            const contentResponse = await api.getAnnotationContent(id, file.id);
            
            if (contentResponse?.success && contentResponse.data) {
              // Check if file is too large
              if (contentResponse.data.is_large && !contentResponse.data.content) {
                toast({
                  title: "Annotation file too large", 
                  description: `${contentResponse.data.message || 'This annotation file is too large to load all at once'}. Navigate to specific pages to view relevant annotations.`,
                  variant: "default"
                });
                return;
              }
              
              if (contentResponse.data.content) {
                const cocoData = JSON.parse(contentResponse.data.content);
                
                // Create imageMapping from COCO data
                const imageMapping: { [imageId: string]: string } = {};
                if (cocoData.images && Array.isArray(cocoData.images)) {
                  cocoData.images.forEach((img: any) => {
                    if (img.id && img.file_name) {
                      imageMapping[img.id.toString()] = img.file_name;
                    }
                  });
                }
                
                // Update the file with imageMapping
                const updatedFiles = annotationFiles.map(f => 
                  f.id === annotationId 
                    ? { ...f, imageMapping }
                    : f
                );
                setAnnotationFiles(updatedFiles);
                
                // Now check with the new imageMapping
                const { presentFiles } = getImageFileLists({ ...file, imageMapping });
                
                if (presentFiles.length === 0) {
                  toast({
                    title: "Cannot show annotations",
                    description: "There are no matching images in the dataset for these annotations.",
                    variant: "destructive"
                  });
                  return;
                }
              } else {
                toast({
                  title: "Cannot load annotations",
                  description: "Annotation content is not available.",
                  variant: "destructive"
                });
                return;
              }
            } else {
              console.error('Failed to load annotation content:', contentResponse);
              const errorMsg = contentResponse?.error || (contentResponse?.data as any)?.message || "Failed to load annotation content. Please try again.";
              toast({
                title: "Cannot load annotations",
                description: errorMsg,
                variant: "destructive"
              });
              return;
            }
          }
        } catch (error) {
          console.error('Error checking annotation availability:', error);
          toast({
            title: "Cannot load annotations",
            description: "Failed to check annotation availability. Please try again.",
            variant: "destructive"
          });
          return;
        }
      } else {
        // Check with existing imageMapping or samples
        const { presentFiles } = getImageFileLists(file);
        
        if (presentFiles.length === 0) {
          toast({
            title: "Cannot show annotations",
            description: "There are no matching images in the dataset for these annotations.",
            variant: "destructive"
          });
          return;
        }
      }
    }
    
    const newVisibleAnnotations = new Set(visibleAnnotations);
    
    if (visibleAnnotations.has(annotationId)) {
      newVisibleAnnotations.delete(annotationId);
      console.log(`Hiding annotations for file ${file.name}`);
    } else {
      newVisibleAnnotations.add(annotationId);
      console.log(`Showing annotations for file ${file.name}`);
      
      // Load annotations for current page when making them visible
      if (currentPageImageIds.length > 0 && api) {
        console.log(`Loading annotations for current page with ${currentPageImageIds.length} images`);
        loadAnnotationsForCurrentPage(file.id, true).then(annotations => {
          console.log(`Loaded ${annotations?.length || 0} annotations for visibility toggle`);
        });
      }
    }
    
    setVisibleAnnotations(newVisibleAnnotations);
    
    // Save visibility state to localStorage
    localStorage.setItem(`annotation_visibility_${id}`, JSON.stringify(Array.from(newVisibleAnnotations)));
    
    // Update the annotation files to mark visibility (don't need to update individual sample visibility)
    const updatedFiles = annotationFiles.map(file => 
      file.id === annotationId 
        ? { 
            ...file, 
            isVisible: isBecomingVisible
          }
        : file
    );
    
    setAnnotationFiles(updatedFiles);
    
    console.log(`Updated annotation files after visibility toggle. File ${file.name} is now ${isBecomingVisible ? 'visible' : 'hidden'}`);
    
    // Save updated files to localStorage with quota handling
    saveAnnotationFilesToLocalStorage(updatedFiles);
  };


  const handleToggleAnnotationBboxes = async (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const file = annotationFiles.find(f => f.id === annotationId);
    if (!file) return;

    // If trying to show bboxes, check if we have annotations for current page
    if (!file.showBboxes) {
      // For large files, use the annotation data API instead of loading full content
      if (!file.imageMapping && api) {
        console.log('Checking bounding box availability for current page images...');
        try {
          // Get current page image IDs
          const currentImageIds = currentPageImageIds;
          
          if (currentImageIds.length === 0) {
            toast({
              title: "No images on current page",
              description: "Navigate to a page with images to view bounding boxes.",
              variant: "default"
            });
            return;
          }
          
          // Try to load annotations for current page images only
          console.log(`Checking bounding boxes for ${currentImageIds.length} current page images`);
          const annotationDataResponse = await api.getAnnotationData(id, file.id, {
            imageIds: currentImageIds,
            limit: 10 // Just check if any exist
          });
          
          if (annotationDataResponse?.success && annotationDataResponse.data) {
            const hasAnnotations = annotationDataResponse.data.annotations && annotationDataResponse.data.annotations.length > 0;
            
            console.log(`Bbox check result: ${hasAnnotations ? 'found' : 'no'} annotations for current page`);
            console.log('Bbox annotation data response:', annotationDataResponse.data);
            
            if (!hasAnnotations) {
              toast({
                title: "No bounding boxes for current page",
                description: "There are no bounding boxes for images on the current page. Try navigating to other pages.",
                variant: "default"
              });
              return;
            }
            
            console.log(`Found ${annotationDataResponse.data.annotations.length} bounding boxes for current page - proceeding with bbox toggle`);
          } else {
            // Fallback to original method for smaller files
            console.log('Falling back to full content loading for bounding boxes...');
            const contentResponse = await api.getAnnotationContent(id, file.id);
            
            if (contentResponse?.success && contentResponse.data) {
              // Check if file is too large
              if (contentResponse.data.is_large && !contentResponse.data.content) {
                toast({
                  title: "Annotation file too large",
                  description: `${contentResponse.data.message || 'This annotation file is too large to load all at once'}. Navigate to specific pages to view relevant bounding boxes.`,
                  variant: "default"
                });
                return;
              }
              
              if (contentResponse.data.content) {
                const cocoData = JSON.parse(contentResponse.data.content);
                
                // Create imageMapping from COCO data
                const imageMapping: { [imageId: string]: string } = {};
                if (cocoData.images && Array.isArray(cocoData.images)) {
                  cocoData.images.forEach((img: any) => {
                    if (img.id && img.file_name) {
                      imageMapping[img.id.toString()] = img.file_name;
                    }
                  });
                }
                
                // Update the file with imageMapping
                const updatedFiles = annotationFiles.map(f => 
                  f.id === annotationId 
                    ? { ...f, imageMapping }
                    : f
                );
                setAnnotationFiles(updatedFiles);
                
                // Now check with the new imageMapping
                const { presentFiles } = getImageFileLists({ ...file, imageMapping });
                
                if (presentFiles.length === 0) {
                  toast({
                    title: "Cannot show bounding boxes",
                    description: "There are no matching images in the dataset for these annotations.",
                    variant: "destructive"
                  });
                  return;
                }
              } else {
                toast({
                  title: "Cannot load annotations",
                  description: "Annotation content is not available.",
                  variant: "destructive"
                });
                return;
              }
            } else {
              console.error('Failed to load annotation content:', contentResponse);
              const errorMsg = contentResponse?.error || (contentResponse?.data as any)?.message || "Failed to load annotation content. Please try again.";
              toast({
                title: "Cannot load annotations",
                description: errorMsg,
                variant: "destructive"
              });
              return;
            }
          }
        } catch (error) {
          console.error('Error checking bounding box availability:', error);
          toast({
            title: "Cannot load bounding boxes",
            description: "Failed to check bounding box availability. Please try again.",
            variant: "destructive"
          });
          return;
        }
      } else {
        // Check with existing imageMapping or samples
        const { presentFiles } = getImageFileLists(file);
        
        if (presentFiles.length === 0) {
          toast({
            title: "Cannot show bounding boxes",
            description: "There are no matching images in the dataset for these annotations.",
            variant: "destructive"
          });
          return;
        }
      }
    }
    
    // Toggle individual bbox visibility for this annotation file
    const newBboxVisibility = !file.showBboxes;
    
    console.log(`Toggling bbox visibility for ${file.name} to ${newBboxVisibility}`);
    
    // Update the annotation files to toggle bbox visibility
    const updatedFiles = annotationFiles.map(f => 
      f.id === annotationId 
        ? { 
            ...f, 
            showBboxes: newBboxVisibility
          }
        : f
    );
    
    setAnnotationFiles(updatedFiles);

    // Push updated annotations to parent immediately so grid thumbnails show/hide bboxes without delay
    if (onShowAnnotationsChange) {
      if (showAllAnnotationsOnGrid) {
        const allAnnotations = updatedFiles.flatMap(f => {
          const mapped = mapAnnotationImageIds(f.samples || [], f);
          return mapped.map(s => ({
            ...s,
            annotationFileName: f.name,
            isVisible: visibleAnnotations.has(f.id),
            showBboxes: f.showBboxes !== false
          }));
        });
        onShowAnnotationsChange(allAnnotations.length > 0, allAnnotations, updatedFiles);
      } else {
        const visible = updatedFiles
          .filter(f => visibleAnnotations.has(f.id) && f.samples?.length)
          .flatMap(f => {
            const mapped = mapAnnotationImageIds(f.samples || [], f);
            return mapped.map(s => ({
              ...s,
              annotationFileName: f.name,
              isVisible: true,
              showBboxes: f.showBboxes !== false
            }));
          });
        onShowAnnotationsChange(visible.length > 0, visible, updatedFiles);
      }
    }
    
    console.log(`Updated annotation files after bbox toggle. File ${file.name} showBboxes: ${newBboxVisibility}`);
    
    // If we're enabling bboxes, make sure we load annotations for current page
    // Do this AFTER updating the annotation files to ensure we use the correct bbox state
    if (newBboxVisibility && currentPageImageIds.length > 0 && api) {
      console.log(`Loading annotations for bbox display with ${currentPageImageIds.length} images`);
      // Pass the new bbox state to ensure it's used correctly
      loadAnnotationsForCurrentPage(annotationId, true, newBboxVisibility).then(annotations => {
        console.log(`Loaded ${annotations?.length || 0} annotations for bbox display`);
      });
    }
    
    // Save updated files to localStorage with quota handling
    saveAnnotationFilesToLocalStorage(updatedFiles);
    
    toast({
      title: newBboxVisibility ? "Bounding boxes shown" : "Bounding boxes hidden",
      description: `Bounding boxes ${newBboxVisibility ? 'enabled' : 'disabled'} for ${file.name}`,
    });
  };

  const handleDeleteAnnotation = async (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Find the annotation file that's being deleted
    const fileToDelete = annotationFiles.find(file => file.id === annotationId);
    if (!fileToDelete) {
      toast({
        title: "Error",
        description: "Could not find the annotation file to delete.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Always try to delete from backend first if API is available
      if (api) {
        const response = await api.deleteAnnotation(id, annotationId);
        if (!response.success) {
          throw new Error(response.error || "Failed to delete annotation file");
        }
        
        // If backend deletion was successful, refresh from backend
        await loadAnnotationFilesFromBackend();
      } else {
        // If no API, update the UI manually and clean up localStorage
        const updatedFiles = annotationFiles.filter(file => file.id !== annotationId);
        setAnnotationFiles(updatedFiles);
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      }
      
      // Also clean up classification localStorage if it exists (legacy support)
      const savedAnnotations = localStorage.getItem(`saved_annotations_${id}`);
      if (savedAnnotations) {
        try {
          const annotationsList = JSON.parse(savedAnnotations);
          const updatedList = annotationsList.filter((annotation: any) => annotation.id !== annotationId);
          localStorage.setItem(`saved_annotations_${id}`, JSON.stringify(updatedList));
        } catch (e) {
          console.warn('Failed to clean up classification localStorage:', e);
        }
      }
      
      // Remove from visible annotations if it was visible (this is UI state)
      const newVisibleAnnotations = new Set(visibleAnnotations);
      newVisibleAnnotations.delete(annotationId);
      setVisibleAnnotations(newVisibleAnnotations);
      
      // Update visibility state in localStorage
      localStorage.setItem(`annotation_visibility_${id}`, JSON.stringify(Array.from(newVisibleAnnotations)));
      
      if (selectedAnnotation === annotationId) {
        setSelectedAnnotation(null);
      }

      // Update parent component with new annotation state
      if (onShowAnnotationsChange) {
        const currentFiles = api ? annotationFiles : annotationFiles.filter(file => file.id !== annotationId);
        const allSamples = currentFiles.flatMap(file => file.samples || []);
        const visibleSamples = allSamples.filter(sample => 
          sample.annotationFileName && newVisibleAnnotations.has(
            currentFiles.find(f => f.name === sample.annotationFileName)?.id || ''
          )
        );
        onShowAnnotationsChange(visibleSamples.length > 0, visibleSamples, currentFiles);
      }
      
      toast({
        title: "Annotation deleted",
        description: `Annotation file "${fileToDelete.name}" has been removed.`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete annotation file",
        variant: "destructive",
      });
    }
  };

  // Helper function to clear annotation cache before editing
  const clearAnnotationCache = (annotationType: 'classification' | 'segmentation') => {
    console.log(`Clearing ${annotationType} annotation cache before editing...`);
    
    const keysToRemove: string[] = [];
    const prefixes = annotationType === 'classification' 
      ? [`classifications_${id}_`, `classColors_${id}`, `annotation_settings_${id}`]
      : [`annotations_${id}_`, `classes_${id}`, `annotation_settings_${id}`];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && prefixes.some(prefix => key.startsWith(prefix))) {
        keysToRemove.push(key);
      }
    }
    
    // Remove all identified keys
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      console.log(`Cleared cache key: ${key}`);
    });
    
    if (keysToRemove.length > 0) {
      toast({
        title: "Cache cleared",
        description: `Cleared ${keysToRemove.length} cached ${annotationType} entries for fresh editing.`,
      });
    }
    
    return keysToRemove.length;
  };

  const handleEditAnnotation = (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const file = annotationFiles.find(f => f.id === annotationId);
    if (file) {
      setEditDialog({
        isOpen: true,
        annotationId: annotationId,
        currentName: file.name,
        newName: file.name
      });
    }
  };

  const handleEditClassificationAnnotation = (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const file = annotationFiles.find(f => f.id === annotationId);
    if (file && detectAnnotationType(file) === 'Classification') {
      // Clear all existing annotation cache to start fresh
      clearAnnotationCache('classification');
      
      // Navigate to classification page with the dataset ID and annotation file ID
      navigate(`/datasets/${id}/annotate/classification?annotationId=${annotationId}`);
    }
  };

  const handleEditSegmentationAnnotation = (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const file = annotationFiles.find(f => f.id === annotationId);
    const annotationType = detectAnnotationType(file);
    
    if (file && annotationType.startsWith('Segmentation')) {
      // Clear all existing annotation cache to start fresh
      clearAnnotationCache('segmentation');
      
      // Navigate to segmentation page with the dataset ID and annotation file ID
      navigate(`/datasets/${id}/annotate/segmentation?annotationId=${annotationId}`);
    }
  };

  const handleSaveAnnotationName = () => {
    if (!editDialog.newName.trim()) {
      toast({
        variant: "destructive",
        title: "Invalid name",
        description: "Annotation name cannot be empty.",
      });
      return;
    }

    const newName = editDialog.newName.trim();
    const annotationId = editDialog.annotationId;
    const updatedFiles = annotationFiles.map(file => 
      file.id === annotationId 
        ? { 
            ...file, 
            name: newName,
            // Update all samples to reflect the new annotation file name
            samples: file.samples?.map(sample => ({
              ...sample,
              annotationFileName: newName
            }))
          }
        : file
    );

    const doRename = async () => {
      let success = true;
      if (api) {
        try {
          // Call backend API to rename annotation file
          const response = await api.renameAnnotation(id, annotationId, newName);
          if (!response.success) {
            success = false;
            throw new Error(response.error || "Failed to rename annotation file on server");
          }
        } catch (error) {
          success = false;
          toast({
            title: "Rename failed",
            description: error instanceof Error ? error.message : "Failed to rename annotation file on server.",
            variant: "destructive",
          });
        }
      } else {
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      }
      if (success) {
        setAnnotationFiles(updatedFiles);
        toast({
          title: "Annotation renamed",
          description: `Successfully renamed to "${newName}".`,
        });
        setEditDialog({ isOpen: false, annotationId: '', currentName: '', newName: '' });
      }
    };
    doRename();
  };

  const handleCancelEdit = () => {
    setEditDialog({ isOpen: false, annotationId: '', currentName: '', newName: '' });
  };

  const handleDownloadAnnotation = async (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const file = annotationFiles.find(f => f.id === annotationId);
    if (!file) {
      toast({
        title: "Error",
        description: "Annotation file not found.",
        variant: "destructive",
      });
      return;
    }

    // Show loading toast for better UX
    toast({
      title: "Preparing export...",
      description: "Generating COCO format file for download.",
    });

    try {
      if (api) {
        // Smart approach: Try to get the annotation content directly and export as-is
        // This avoids loading into memory as our internal format
        console.log(`Requesting direct export for annotation file ${file.name}...`);
        
        // Get the annotation content directly from backend
        const contentResponse = await api.getAnnotationContent(id, file.id);
        
        if (!contentResponse || !contentResponse.success || !contentResponse.data.content) {
          throw new Error('Failed to load annotation content from backend for export.');
        }

        // Parse to validate it's proper COCO format, but don't convert to our internal format
        let cocoData;
        try {
          cocoData = JSON.parse(contentResponse.data.content);
        } catch (parseError) {
          throw new Error('Annotation file contains invalid JSON data.');
        }
        
        if (!cocoData.annotations || !Array.isArray(cocoData.annotations) || cocoData.annotations.length === 0) {
          toast({
            title: "No data to export",
            description: "This annotation file contains no annotation data.",
            variant: "destructive",
          });
          return;
        }

        // Directly export the COCO data without any conversion 
        // Just ensure it has proper COCO structure
        const exportData = {
          info: cocoData.info || {
            description: `Annotations for ${file.name}`,
            version: "1.0",
            year: new Date().getFullYear(),
            contributor: "AI Data Creator",
            date_created: new Date().toISOString()
          },
          licenses: cocoData.licenses || [{
            id: 1,
            name: "Unknown License",
            url: ""
          }],
          images: cocoData.images || [],
          categories: cocoData.categories || [],
          annotations: cocoData.annotations || []
        };

        console.log(`Exporting ${exportData.annotations.length} annotations directly from backend COCO data`);

        // Create and download the file directly from the original COCO data
        const dataStr = JSON.stringify(exportData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${file.name.replace(/\.[^/.]+$/, '')}_export.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({
          title: "Download completed",
          description: `Successfully exported ${file.name} with ${exportData.annotations.length} annotations.`,
        });

      } else {
        // No API available - export from local samples
        const samplesData = file.samples;
        
        if (!samplesData || samplesData.length === 0) {
          toast({
            title: "No data to export",
            description: "This annotation file has no samples to export and no backend connection is available.",
            variant: "destructive",
          });
          return;
        }

        console.log(`Exporting ${samplesData.length} samples from local data`);
        
        // Extract unique categories from samples
        const categoryMap = new Map<string, number>();
        let categoryId = 1;
        
        samplesData.forEach(sample => {
          if (!categoryMap.has(sample.className)) {
            categoryMap.set(sample.className, categoryId++);
          }
        });

        const categories = Array.from(categoryMap.entries()).map(([name, id]) => ({
          id,
          name,
          supercategory: ""
        }));

        // Create images array from samples
        const imageSet = new Map<string, any>();
        samplesData.forEach(sample => {
          if (!imageSet.has(sample.imageId)) {
            const actualImage = imagesMemo.find(img => img.id === sample.imageId);
            const fileName = file.imageMapping?.[sample.imageId] || actualImage?.fileName || `image_${sample.imageId}.jpg`;
            
            imageSet.set(sample.imageId, {
              id: parseInt(sample.imageId) || Math.abs(sample.imageId.split('').reduce((a, b) => {
                a = ((a << 5) - a) + b.charCodeAt(0);
                return a & a;
              }, 0)) || Math.floor(Math.random() * 1000000),
              width: actualImage?.width || 640,
              height: actualImage?.height || 480,
              file_name: fileName,
              license: 1,
              flickr_url: "",
              coco_url: "",
              date_captured: ""
            });
          }
        });

        const cocoData = {
          info: {
            description: `Annotations for ${file.name}`,
            version: "1.0",
            year: new Date().getFullYear(),
            contributor: "AI Data Creator",
            date_created: new Date().toISOString()
          },
          licenses: [{
            id: 1,
            name: "Unknown License",
            url: ""
          }],
          images: Array.from(imageSet.values()),
          categories: categories,
          annotations: samplesData.map((sample, index) => {
            const imageInfo = imageSet.get(sample.imageId);
            const imageWidth = imageInfo?.width || 640;
            const imageHeight = imageInfo?.height || 480;
            
            // Convert normalized bbox to absolute coordinates if needed
            let bboxAbsolute = [0, 0, 0, 0];
            if (sample.bbox && Array.isArray(sample.bbox) && sample.bbox.length === 4) {
              if (sample.bbox[0] > 1 || sample.bbox[1] > 1 || sample.bbox[2] > 1 || sample.bbox[3] > 1) {
                bboxAbsolute = [...sample.bbox];
              } else {
                bboxAbsolute = [
                  sample.bbox[0] * imageWidth,
                  sample.bbox[1] * imageHeight,
                  sample.bbox[2] * imageWidth,
                  sample.bbox[3] * imageHeight
                ];
              }
            }
            
            return {
              id: index + 1,
              image_id: imageInfo?.id || parseInt(sample.imageId) || 1,
              category_id: categoryMap.get(sample.className) || 1,
              bbox: bboxAbsolute,
              area: sample.area || (bboxAbsolute[2] * bboxAbsolute[3]),
              iscrowd: 0,
              segmentation: sample.segmentation || []
            };
          })
        };

        // Create and download the file
        const dataStr = JSON.stringify(cocoData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const link = document.createElement('a');
        link.href = url;
        link.download = `${file.name.replace(/\.[^/.]+$/, '')}_export.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        toast({
          title: "Download completed",
          description: `Successfully exported ${file.name} with ${cocoData.annotations.length} annotations.`,
        });
      }

    } catch (error) {
      console.error('Error downloading annotation:', error);
      toast({
        title: "Export failed",
        description: error instanceof Error ? error.message : "Failed to export annotation file.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadImagesClick = async (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const file = annotationFiles.find(f => f.id === annotationId);
    if (!file) {
      toast({
        title: "Error",
        description: "Annotation file not found.",
        variant: "destructive",
      });
      return;
    }

    try {
      if (api) {
        // Get annotation content to extract categories
        const contentResponse = await api.getAnnotationContent(id, file.id);
        
        if (!contentResponse || !contentResponse.success || !contentResponse.data.content) {
          throw new Error('Failed to load annotation content from backend.');
        }

        const cocoData = JSON.parse(contentResponse.data.content);
        
        if (!cocoData.categories || cocoData.categories.length === 0) {
          toast({
            title: "No classes found",
            description: "This annotation file has no classes defined.",
            variant: "destructive",
          });
          return;
        }

        // Open dialog with categories
        setDownloadImagesDialog({
          isOpen: true,
          annotationId: file.id,
          categories: cocoData.categories
        });

      } else {
        toast({
          title: "Error",
          description: "Backend connection not available.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error preparing download images:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to prepare image download.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadImagesByClass = async (className: string) => {
    const { annotationId } = downloadImagesDialog;
    
    try {
      if (!api) {
        throw new Error('Backend connection not available.');
      }

      toast({
        title: "Preparing download...",
        description: `Collecting images for class "${className}"...`,
      });

      // Get annotation content
      const contentResponse = await api.getAnnotationContent(id, annotationId);
      
      if (!contentResponse || !contentResponse.success || !contentResponse.data.content) {
        throw new Error('Failed to load annotation content from backend.');
      }

      const cocoData = JSON.parse(contentResponse.data.content);
      
      // Find category ID for the selected class
      const category = cocoData.categories.find((cat: any) => cat.name === className);
      if (!category) {
        throw new Error(`Class "${className}" not found in annotation file.`);
      }

      // Get all image IDs that have this class
      const imageIdsWithClass = new Set<number>();
      cocoData.annotations.forEach((ann: any) => {
        if (ann.category_id === category.id) {
          imageIdsWithClass.add(ann.image_id);
        }
      });

      if (imageIdsWithClass.size === 0) {
        toast({
          title: "No images found",
          description: `No images have the class "${className}".`,
          variant: "destructive",
        });
        setDownloadImagesDialog({ isOpen: false, annotationId: '', categories: [] });
        return;
      }

      // Get filenames for these image IDs
      const imageFilenames: string[] = [];
      cocoData.images.forEach((img: any) => {
        if (imageIdsWithClass.has(img.id)) {
          imageFilenames.push(img.file_name);
        }
      });

      // Create a mapping from filename to actual image URL
      const filenameToImageUrl: { [filename: string]: string } = {};
      images.forEach(img => {
        filenameToImageUrl[img.fileName] = img.url;
      });

      // Download images as zip
      toast({
        title: "Downloading images...",
        description: `Preparing ${imageFilenames.length} images for download...`,
      });

      // Create a zip file using JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Fetch each image and add to zip
      let successCount = 0;
      let failCount = 0;

      for (const filename of imageFilenames) {
        try {
          // Get the actual image URL from the loaded images
          const imageUrl = filenameToImageUrl[filename];
          
          if (!imageUrl) {
            console.warn(`No URL found for ${filename}`);
            failCount++;
            continue;
          }
          
          const response = await fetch(imageUrl);
          if (!response.ok) {
            console.warn(`Failed to fetch ${filename} from ${imageUrl}`);
            failCount++;
            continue;
          }

          const blob = await response.blob();
          zip.file(filename, blob);
          successCount++;
        } catch (error) {
          console.error(`Error fetching ${filename}:`, error);
          failCount++;
        }
      }

      if (successCount === 0) {
        throw new Error('Failed to download any images. Make sure images are loaded in the dataset.');
      }

      // Generate zip file
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      
      // Download zip file
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${className}_images.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Download completed",
        description: `Downloaded ${successCount} images${failCount > 0 ? ` (${failCount} failed)` : ''}.`,
      });

      setDownloadImagesDialog({ isOpen: false, annotationId: '', categories: [] });

    } catch (error) {
      console.error('Error downloading images:', error);
      toast({
        title: "Download failed",
        description: error instanceof Error ? error.message : "Failed to download images.",
        variant: "destructive",
      });
    }
  };

  const handleImportClick = () => {
    setShowUploadDialog(true);
  };  // Get present and missing image file names for an annotation file
  const getImageFileLists = (file: AnnotationFile) => {
    if (!file.imageMapping && (!file.samples || file.samples.length === 0)) {
      // No mapping and no samples - nothing to check
      return { presentFiles: [], missingFiles: [] };
    }
    
    let allImageIds: string[] = [];
    let imageMapping: { [imageId: string]: string } = {};
    
    if (file.imageMapping) {
      // Use existing imageMapping if available
      allImageIds = Object.keys(file.imageMapping);
      imageMapping = file.imageMapping;
    } else if (file.samples && file.samples.length > 0) {
      // Fallback: extract unique image IDs from samples
      allImageIds = Array.from(new Set(file.samples.map(sample => sample.imageId)));
      // Create a basic mapping using image IDs as filenames (best guess)
      allImageIds.forEach(imageId => {
        imageMapping[imageId] = imageId; // Will be compared directly with image IDs
      });
    }
    
    // Create a set of uploaded image info for quick lookup (both ID and fileName)
    const uploadedImageIds = new Set(imagesMemo.map(img => img.id));
    const uploadedImageNames = new Set(imagesMemo.map(img => img.fileName));
    
    const presentFiles: string[] = [];
    const missingFiles: string[] = [];
    
    allImageIds.forEach(imageId => {
      const fileName = imageMapping[imageId];
      
      if (fileName) {
        // Check if this image file exists in the current dataset
        // Try both by fileName (for COCO files) and by imageId (for database images)
        if (uploadedImageNames.has(fileName) || uploadedImageIds.has(fileName) || uploadedImageIds.has(imageId)) {
          presentFiles.push(fileName);
        } else {
          missingFiles.push(fileName);
        }
      } else {
        // Fallback for images without mapping
        const fallbackName = `image_${imageId}.jpg`;
        missingFiles.push(fallbackName);
      }
    });
    
    return { presentFiles, missingFiles };
  };

  const handleShowPresentImages = async (file: AnnotationFile) => {
    // Redirect to breakdown view which will show all options
    await handleShowImageBreakdown(file);
  };

  const handleShowImageBreakdown = async (file: AnnotationFile) => {
    if (!api) {
      setImageStatusDialog({
        isOpen: true,
        type: 'breakdown',
        files: ['Backend connection required to calculate image coverage.'],
        annotationFileName: file.name
      });
      return;
    }

    // Show loading dialog immediately
    setImageStatusDialog({
      isOpen: true,
      type: 'breakdown',
      files: [],
      annotationFileName: file.name,
      isLoading: true
    });

    try {
      console.log(`Loading coverage data for ${file.name}...`);
      
      // Use the new coverage API instead of parsing COCO content
      const coverageResponse = await api.getAnnotationFileCoverage(id, file.id);
      
      if (!coverageResponse || !coverageResponse.success || !coverageResponse.data) {
        throw new Error('Failed to fetch coverage data');
      }

      const coverage = coverageResponse.data;
      const presentImages = coverage.present.map(img => img.file_name);
      const missingImages = coverage.missing.map(img => img.file_name || `COCO ID: ${img.coco_image_id}`);
      
      console.log(`Coverage: ${coverage.present_count} present, ${coverage.missing_count} missing`);
      
      // Show breakdown dialog with buttons for each category
      const breakdownMessage = [
        `📊 Image Coverage for "${file.name}":`,
        ``,
        `📁 Total Images Referenced: ${coverage.total_referenced_images}`,
        `✅ Present in Dataset: ${coverage.present_count}`,
        `❌ Missing from Dataset: ${coverage.missing_count}`,
        ``,
        `Click "Present Images" or "Missing Images" below to see the file lists.`
      ];
      
      setImageStatusDialog({
        isOpen: true,
        type: 'breakdown',
        files: breakdownMessage,
        annotationFileName: file.name,
        presentCount: coverage.present_count,
        missingCount: coverage.missing_count,
        presentFiles: presentImages,
        missingFiles: missingImages,
        isLoading: false
      });
      
    } catch (error) {
      console.error('Failed to calculate image coverage:', error);
      setImageStatusDialog({
        isOpen: true,
        type: 'breakdown',
        files: [`Failed to calculate image coverage: ${error instanceof Error ? error.message : 'Unknown error'}`],
        annotationFileName: file.name,
        isLoading: false
      });
    }
  };

  const handleShowMissingImages = async (file: AnnotationFile) => {
    // Redirect to breakdown view which will show all options
    await handleShowImageBreakdown(file);
  };

  // Polling function to check processing status
  const startProcessingStatusPolling = useCallback(() => {
    if (!api || processingFiles.size === 0) return;
    
    const pollInterval = setInterval(async () => {
      try {
        // Check status of processing files
        const response = await api.getAnnotations(id);
        if (response && response.success && response.data) {
          const updatedProcessingFiles = new Set(processingFiles);
          let shouldRefresh = false;
          
          for (const fileId of processingFiles) {
            const fileData = response.data.find((f: any) => f.id === fileId);
            if (fileData && fileData.processing_status === 'completed') {
              updatedProcessingFiles.delete(fileId);
              shouldRefresh = true;
              console.log(`File ${fileId} processing completed`);
            } else if (fileData && fileData.processing_status === 'failed') {
              updatedProcessingFiles.delete(fileId);
              console.warn(`File ${fileId} processing failed:`, fileData.error_message);
              toast({
                variant: "destructive",
                title: "Processing failed",
                description: `Annotation processing failed: ${fileData.error_message}`,
              });
            }
          }
          
          setProcessingFiles(updatedProcessingFiles);
          
          // If any files completed processing, refresh the annotation list
          if (shouldRefresh) {
            await loadAnnotationFilesFromBackend();
          }
          
          // Stop polling when no files are processing
          if (updatedProcessingFiles.size === 0) {
            clearInterval(pollInterval);
          }
        }
      } catch (error) {
        console.error('Error polling processing status:', error);
      }
    }, 2000); // Poll every 2 seconds
    
    // Cleanup after 60 seconds max to prevent infinite polling
    setTimeout(() => {
      clearInterval(pollInterval);
      setProcessingFiles(new Set());
    }, 60000);
  }, [api, id, processingFiles]);

  // Task monitoring function for background annotation processing
  const startTaskMonitoring = useCallback(() => {
    if (!api || activeTasks.size === 0) return;
    
    const taskIds = Array.from(activeTasks.keys());
    console.log(`Starting task monitoring for ${taskIds.length} tasks:`, taskIds);
    
    const pollInterval = setInterval(async () => {
      try {
        const updatedTasks = new Map(activeTasks);
        let shouldRefreshAnnotations = false;
        
        // Add error tracking and circuit breaker
        let errorCount = 0;
        const maxErrors = 3;
        
        for (const taskId of taskIds) {
          try {
            const taskResponse = await api.getTask(taskId);
            if (taskResponse && taskResponse.success && taskResponse.data) {
              const task = taskResponse.data;
              const currentTask = activeTasks.get(taskId);
              
              // Update task in our state
              updatedTasks.set(taskId, {
                ...task,
                file_id: currentTask?.file_id,
                fileName: currentTask?.fileName
              });
              
              // Handle completed tasks
              if (task.status === 'completed') {
                console.log(`Task ${taskId} completed successfully:`, task.name);
                updatedTasks.delete(taskId);
                shouldRefreshAnnotations = true;
                
                // Clear the file from processing files if it exists
                if (currentTask?.file_id) {
                  setProcessingFiles(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(currentTask.file_id);
                    return newSet;
                  });
                }
                
                toast({
                  title: "Annotation processing completed",
                  description: `Successfully processed: ${currentTask?.fileName || task.name}`,
                });
              } else if (task.status === 'failed') {
                console.warn(`Task ${taskId} failed:`, task.error_message);
                updatedTasks.delete(taskId);
                
                // Clear the file from processing files if it exists
                if (currentTask?.file_id) {
                  setProcessingFiles(prev => {
                    const newSet = new Set(prev);
                    newSet.delete(currentTask.file_id);
                    return newSet;
                  });
                }
                
                toast({
                  variant: "destructive",
                  title: "Annotation processing failed",
                  description: `Failed to process ${currentTask?.fileName || task.name}: ${task.error_message}`,
                });
              }
            } else {
              errorCount++;
              console.warn(`Failed to get task ${taskId} status`);
            }
          } catch (taskError) {
            errorCount++;
            console.error(`Error getting task ${taskId}:`, taskError);
            
            // If too many errors for individual tasks, stop polling
            if (errorCount >= maxErrors) {
              console.warn('Too many task polling errors, stopping monitoring');
              clearInterval(pollInterval);
              setActiveTasks(new Map());
              return;
            }
          }
        }
        
        setActiveTasks(updatedTasks);
        
        // Refresh annotation files when tasks complete
        if (shouldRefreshAnnotations && api) {
          try {
            // Refresh annotation files from backend
            await loadAnnotationFilesFromBackend();
            
            // Clear any lingering processing state
            setProcessingFiles(new Set());
            setImportingFiles(new Set());
            
            console.log('Annotation files refreshed after task completion');
          } catch (error) {
            console.error('Error refreshing annotations after task completion:', error);
          }
        }
        
        // Stop polling when no active tasks remain
        if (updatedTasks.size === 0) {
          clearInterval(pollInterval);
          console.log('All tasks completed, stopping task monitoring');
          
          // Clear any remaining processing state
          setProcessingFiles(new Set());
          setImportingFiles(new Set());
        }
      } catch (error) {
        console.error('Error monitoring tasks:', error);
        // On general error, just log it but continue (could be network issue)
      }
    }, 8000); // Poll every 8 seconds for tasks (reduced frequency)
    
    // Cleanup after 5 minutes max to prevent infinite polling
    setTimeout(() => {
      clearInterval(pollInterval);
      setActiveTasks(new Map());
      console.log('Task monitoring timeout reached, stopping monitoring');
    }, 300000);
  }, [api, activeTasks, id, toast]);

  // Start task monitoring when tasks are added
  useEffect(() => {
    if (activeTasks.size > 0) {
      startTaskMonitoring();
    }
  }, [activeTasks.size > 0, startTaskMonitoring]); // Only trigger when we go from 0 to >0 tasks

  // Helper function to detect annotation type from COCO content string with detailed segmentation types
  const detectAnnotationTypeFromContent = (content: string, fileName: string): 'Classification' | 'Segmentation (mask+bbox)' | 'Segmentation (mask)' | 'Segmentation (bbox)' | 'Other' => {
    try {
      const cocoData = JSON.parse(content);
      
      console.log(`Analyzing COCO content for ${fileName} for type detection...`);
      
      // Check if it's valid COCO format
      if (!cocoData.annotations || !Array.isArray(cocoData.annotations)) {
        console.log(`${fileName}: No annotations array found, defaulting to Other`);
        return 'Other';
      }
      
      const annotations = cocoData.annotations;
      if (annotations.length === 0) {
        console.log(`${fileName}: Empty annotations, defaulting to Other`);
        return 'Other';
      }
      
      let hasSegmentation = false;
      let hasNonZeroBbox = false;
      let hasZeroBbox = false;
      
      // Analyze all annotations to determine type
      for (const ann of annotations) {
        // Check for segmentation masks
        if (ann.segmentation && Array.isArray(ann.segmentation) && ann.segmentation.length > 0) {
          // Check if segmentation is not empty (not just empty arrays)
          const hasValidSegmentation = ann.segmentation.some((seg: any) => 
            Array.isArray(seg) && seg.length > 0
          );
          if (hasValidSegmentation) {
            hasSegmentation = true;
          }
        }
        
        // Check bounding boxes
        if (ann.bbox && Array.isArray(ann.bbox) && ann.bbox.length === 4) {
          const [x, y, width, height] = ann.bbox;
          if (width > 0 && height > 0) {
            hasNonZeroBbox = true;
          } else if (width === 0 && height === 0) {
            hasZeroBbox = true;
          }
        }
      }
      
      // Determine detailed type based on analysis
      let detectedType: 'Classification' | 'Segmentation (mask+bbox)' | 'Segmentation (mask)' | 'Segmentation (bbox)' | 'Other';
      
      if (hasSegmentation && hasNonZeroBbox) {
        detectedType = 'Segmentation (mask+bbox)';
        console.log(`${fileName}: Detected as Segmentation (mask+bbox) (has both masks and bboxes)`);
      } else if (hasSegmentation) {
        detectedType = 'Segmentation (mask)';
        console.log(`${fileName}: Detected as Segmentation (mask) (has segmentation masks only)`);
      } else if (hasNonZeroBbox && !hasZeroBbox) {
        detectedType = 'Segmentation (bbox)'; // Has valid bounding boxes, object detection
        console.log(`${fileName}: Detected as Segmentation (bbox) (has non-zero bboxes)`);
      } else if (hasZeroBbox && !hasNonZeroBbox) {
        detectedType = 'Classification'; // Only zero bboxes, likely classification
        console.log(`${fileName}: Detected as Classification (has only zero bboxes)`);
      } else if (!hasNonZeroBbox && !hasZeroBbox) {
        // No bbox data at all, check if we have category_id only
        const hasOnlyCategories = annotations.every((ann: any) => 
          ann.category_id && !ann.bbox && !ann.segmentation
        );
        if (hasOnlyCategories) {
          detectedType = 'Classification';
          console.log(`${fileName}: Detected as Classification (category_id only)`);
        } else {
          detectedType = 'Other';
          console.log(`${fileName}: Detected as Other (no clear indicators, default)`);
        }
      } else {
        // Mixed case - has both zero and non-zero bboxes, default to bbox segmentation
        detectedType = 'Segmentation (bbox)';
        console.log(`${fileName}: Detected as Segmentation (bbox) (mixed bbox types)`);
      }
      
      return detectedType;
      
    } catch (error) {
      console.error(`Error parsing COCO content for ${fileName}:`, error);
      return 'Other'; // Default fallback
    }
  };

  // Automatically detect annotation type from COCO format content with detailed segmentation types
  const detectAnnotationTypeFromCOCO = (file: File): Promise<'Classification' | 'Segmentation (mask+bbox)' | 'Segmentation (mask)' | 'Segmentation (bbox)' | 'Other'> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const cocoData = JSON.parse(content);
          
          console.log(`Analyzing COCO file ${file.name} for type detection...`);
          
          // Check if it's valid COCO format
          if (!cocoData.annotations || !Array.isArray(cocoData.annotations)) {
            console.log(`${file.name}: No annotations array found, defaulting to Other`);
            resolve('Other');
            return;
          }
          
          const annotations = cocoData.annotations;
          if (annotations.length === 0) {
            console.log(`${file.name}: Empty annotations, defaulting to Other`);
            resolve('Other');
            return;
          }
          
          let hasSegmentation = false;
          let hasNonZeroBbox = false;
          let hasZeroBbox = false;
          
          // Analyze all annotations to determine type
          for (const ann of annotations) {
            // Check for segmentation masks
            if (ann.segmentation && Array.isArray(ann.segmentation) && ann.segmentation.length > 0) {
              // Check if segmentation is not empty (not just empty arrays)
              const hasValidSegmentation = ann.segmentation.some((seg: any) => 
                Array.isArray(seg) && seg.length > 0
              );
              if (hasValidSegmentation) {
                hasSegmentation = true;
              }
            }
            
            // Check bounding boxes
            if (ann.bbox && Array.isArray(ann.bbox) && ann.bbox.length === 4) {
              const [x, y, width, height] = ann.bbox;
              if (width > 0 && height > 0) {
                hasNonZeroBbox = true;
              } else if (width === 0 && height === 0) {
                hasZeroBbox = true;
              }
            }
          }
          
          // Determine detailed type based on analysis
          let detectedType: 'Classification' | 'Segmentation (mask+bbox)' | 'Segmentation (mask)' | 'Segmentation (bbox)' | 'Other';
          
          if (hasSegmentation && hasNonZeroBbox) {
            detectedType = 'Segmentation (mask+bbox)';
            console.log(`${file.name}: Detected as Segmentation (mask+bbox) (has both masks and bboxes)`);
          } else if (hasSegmentation) {
            detectedType = 'Segmentation (mask)';
            console.log(`${file.name}: Detected as Segmentation (mask) (has segmentation masks only)`);
          } else if (hasNonZeroBbox && !hasZeroBbox) {
            detectedType = 'Segmentation (bbox)'; // Has valid bounding boxes, object detection
            console.log(`${file.name}: Detected as Segmentation (bbox) (has non-zero bboxes)`);
          } else if (hasZeroBbox && !hasNonZeroBbox) {
            detectedType = 'Classification'; // Only zero bboxes, likely classification
            console.log(`${file.name}: Detected as Classification (has only zero bboxes)`);
          } else if (!hasNonZeroBbox && !hasZeroBbox) {
            // No bbox data at all, check if we have category_id only
            const hasOnlyCategories = annotations.every((ann: any) => 
              ann.category_id && !ann.bbox && !ann.segmentation
            );
            if (hasOnlyCategories) {
              detectedType = 'Classification';
              console.log(`${file.name}: Detected as Classification (category_id only)`);
            } else {
              detectedType = 'Other';
              console.log(`${file.name}: Detected as Other (no clear indicators, default)`);
            }
          } else {
            // Mixed case - has both zero and non-zero bboxes, default to bbox segmentation
            detectedType = 'Segmentation (bbox)';
            console.log(`${file.name}: Detected as Segmentation (bbox) (mixed bbox types)`);
          }
          
          resolve(detectedType);
          
        } catch (error) {
          console.error(`Error parsing COCO file ${file.name}:`, error);
          resolve('Other'); // Default fallback
        }
      };
      
      reader.onerror = () => {
        console.error(`Error reading file ${file.name}`);
        resolve('Other'); // Default fallback
      };
      
      reader.readAsText(file);
    });
  };

  const handleFilesSelected = async (files: File[], type?: string, processMode: 'immediate' | 'background' = 'background') => {
    console.log('AnnotationsContent.handleFilesSelected called with:', files.map(f => f.name), 'type:', type, 'mode:', processMode);
    setIsLoading(true);
    
    try {
      const successfulImports: Array<{ fileName: string; type: string }> = [];
      const failedImports: Array<{ fileName: string; error: string }> = [];
      
      for (const file of files) {
        try {
          // Validate file type
          if (!file.name.toLowerCase().endsWith('.json')) {
            throw new Error('Only JSON files are supported for COCO annotations');
          }
          
          // Automatically detect annotation type from COCO content
          const detectedType = await detectAnnotationTypeFromCOCO(file);
          console.log(`Auto-detected type for ${file.name}: ${detectedType}`);
          
          // Use detected type, or fallback to user-specified type if provided
          const finalType = detectedType;
          
          // Process the COCO annotation file
          const result = await processCOCOAnnotations(file, id);
          
          console.log(`Processing results for ${file.name}:`, {
            classColors: result.classColors,
            statsCount: result.stats.length,
            samplesCount: result.samples.length
          });
          
          // Set all annotation samples to be hidden by default and assign colors
          const samples = result.samples.map(sample => ({
            ...sample,
            isVisible: false,
            showBboxes: false, // Individual bbox visibility disabled by default
            annotationFileName: file.name,
            color: result.classColors[sample.className] || sample.color || generateRandomColor() // Ensure each sample has a color
          }));
          
          console.log(`Sample color assignment for ${file.name}:`, 
            samples.slice(0, 3).map(s => ({ class: s.className, color: s.color }))
          );
          
          let fileId = Math.random().toString(36).substring(2, 11); // Default fallback ID
          
          // Choose processing method based on mode
          if (api) {
            try {
              console.log(`Processing ${file.name} with mode: ${processMode}, type: ${finalType}`);
              
              // Add to importing files set
              setImportingFiles(prev => new Set(prev).add(file.name));
              
              if (processMode === 'background') {
                // Create annotation processing task for background processing
                const taskResult = await api.createAnnotationProcessingTask(
                  id, 
                  file, 
                  finalType,
                  `Process annotation file: ${file.name}`
                );
                
                console.log(`Task creation result for ${file.name}:`, taskResult);
                if (taskResult && taskResult.success && taskResult.data) {
                  // Use the file ID returned by the backend
                  fileId = taskResult.data.file_id;
                  console.log(`Backend assigned file ID: ${fileId} for ${file.name}`);
                  console.log(`Created processing task ID: ${taskResult.data.task_id}`);
                  
                  // Add task to active tasks for monitoring
                  setActiveTasks(prev => {
                    const newTasks = new Map(prev);
                    newTasks.set(taskResult.data.task_id, {
                      id: taskResult.data.task_id,
                      name: `Process annotation file: ${file.name}`,
                      description: `Processing ${file.name} for dataset ${id}`,
                      task_type: 'annotation_processing',
                      status: 'pending',
                      progress: 0,
                      created_at: new Date().toISOString(),
                      file_id: fileId,
                      fileName: file.name
                    });
                    return newTasks;
                  });
                  
                  toast({
                    title: "Annotation processing started",
                    description: `Background processing started for ${file.name}. You'll be notified when complete.`,
                  });
                } else {
                  console.warn('Task creation succeeded but no file_id returned, using fallback ID');
                }
              } else {
                // Immediate processing using original import API
                const apiResult = await api.importAnnotations(id, file, finalType);
                console.log(`Immediate API result for ${file.name}:`, apiResult);
                if (apiResult && apiResult.success && apiResult.data.file_id) {
                  fileId = apiResult.data.file_id;
                  console.log(`Backend assigned file ID: ${fileId} for ${file.name}`);
                  
                  // Add to processing files set for status tracking
                  setProcessingFiles(prev => new Set(prev).add(fileId));
                  
                  toast({
                    title: "Annotation import started",
                    description: `Immediate processing started for ${file.name}.`,
                  });
                } else {
                  console.warn('Immediate import succeeded but no file_id returned, using fallback ID');
                }
              }
            } catch (apiError) {
              console.warn(`${processMode} processing failed:`, apiError);
              
              if (processMode === 'background') {
                // Fallback to immediate processing if background task creation fails
                try {
                  console.log('Falling back to immediate processing...');
                  const apiResult = await api.importAnnotations(id, file, finalType);
                  console.log(`Fallback API result for ${file.name}:`, apiResult);
                  if (apiResult && apiResult.success && apiResult.data.file_id) {
                    fileId = apiResult.data.file_id;
                    console.log(`Backend assigned file ID: ${fileId} for ${file.name}`);
                    
                    // Add to processing files set for status tracking
                    setProcessingFiles(prev => new Set(prev).add(fileId));
                    
                    toast({
                      title: "Processing mode changed",
                      description: `Background processing unavailable, using immediate processing for ${file.name}.`,
                    });
                  }
                } catch (fallbackError) {
                  console.warn('Both background and immediate processing failed:', fallbackError);
                  throw fallbackError;
                }
              } else {
                throw apiError;
              }
            } finally {
              // Remove from importing files set
              setImportingFiles(prev => {
                const newSet = new Set(prev);
                newSet.delete(file.name);
                return newSet;
              });
            }
          } else {
            console.warn('No API available, using fallback ID');
          }
          
          // Create annotation file record with the backend-provided ID and auto-detected type
          const annotationFile: AnnotationFile = {
            id: fileId,
            name: file.name,
            date: new Date().toISOString(), // Use full timestamp for precise sorting
            format: "COCO",
            type: finalType, // Use the auto-detected type
            classCount: result.stats.length,
            imageCount: result.totalImageCount,
            matchedImageCount: result.matchedImageCount,
            datasetId: id,
            classStats: result.stats,
            samples: samples,
            isVisible: false, // Set visibility to false by default
            showBboxes: false, // Individual bbox visibility disabled by default
            classColors: result.classColors,
            imageMapping: result.imageMapping,
            imageDetails: result.imageDetails, // ADDED: Preserve image dimensions
            tags: [] // Initialize with empty tags array
          };
          
          console.log(`Created annotation file for ${file.name}:`, {
            type: finalType,
            classColors: result.classColors,
            classStats: result.stats.map(s => ({ name: s.className, color: s.color }))
          });              console.log(`Creating annotation file with ID: ${fileId} for file: ${file.name}`);
          
          // If API is available, we'll refresh from backend after all uploads
          // If no API, add to local state immediately
          if (!api) {
            setAnnotationFiles(prev => {
              // Remove any existing file with the same name to avoid duplicates
              const filteredPrev = prev.filter(existingFile => existingFile.name !== file.name);
              const newFiles = [annotationFile, ...filteredPrev]; // Add new file to top
              console.log(`Updated annotation files. Total count: ${newFiles.length}. IDs: ${newFiles.map(f => f.id).join(', ')}`);
              return newFiles;
            });
          }
          
          // Do not add to visible annotations set
          // The user will need to explicitly enable visibility
          
          successfulImports.push({ fileName: file.name, type: finalType });
          
        } catch (fileError) {
          console.error(`Error processing file ${file.name}:`, fileError);
          failedImports.push({
            fileName: file.name,
            error: fileError instanceof Error ? fileError.message : 'Unknown error occurred'
          });
        }
      }
      
      // Show appropriate success/error messages
      if (successfulImports.length > 0) {
        const importSummary = successfulImports.map(imp => `${imp.fileName} (${imp.type})`).join(', ');
        toast({
          title: "Annotations imported",
          description: `Successfully imported ${successfulImports.length} annotation file(s): ${importSummary}`,
        });
        
        // If API is available, refresh from backend to get the updated list
        if (api) {
          console.log('Refreshing annotation files from backend after successful import');
          // Store current colors before refresh to preserve them
          const currentColors: { [fileName: string]: { [className: string]: string } } = {};
          annotationFiles.forEach(file => {
            if (file.classColors && Object.keys(file.classColors).length > 0) {
              currentColors[file.name] = { ...file.classColors };
            }
          });
          console.log('Preserving colors from current files:', currentColors);
          
          await loadAnnotationFilesFromBackend();
          
          // Restore colors if they were lost during backend refresh
          if (Object.keys(currentColors).length > 0) {
            setAnnotationFiles(prev => prev.map(file => {
              const savedColors = currentColors[file.name];
              if (savedColors && (!file.classColors || Object.keys(file.classColors).length === 0)) {
                console.log(`Restoring colors for ${file.name}:`, savedColors);
                return {
                  ...file,
                  classColors: savedColors,
                  classStats: file.classStats?.map(stat => ({
                    ...stat,
                    color: savedColors[stat.className] || stat.color
                  }))
                };
              }
              return file;
            }));
          }
          
          // Start polling for processing status if we have processing files
          if (processingFiles.size > 0) {
            startProcessingStatusPolling();
          }
        }
        
        // Note: Not calling onImportAnnotations prop to avoid duplicate API calls
        // since we already handle the backend import in this component
      }
      
      if (failedImports.length > 0) {
        const errorDetails = failedImports.map(fail => `${fail.fileName}: ${fail.error}`).join('\n');
        toast({
          variant: "destructive",
          title: "Import errors",
          description: `Failed to import ${failedImports.length} file(s):\n${errorDetails}`,
        });
      }
      
      if (successfulImports.length === 0 && failedImports.length > 0) {
        // All imports failed
        throw new Error(`All ${failedImports.length} file(s) failed to import`);
      }
      
    } catch (error) {
      console.error('Error importing annotations:', error);
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error instanceof Error ? error.message : "There was an error importing the annotation files.",
      });
    } finally {
      setIsLoading(false);
      setShowUploadDialog(false);
    }
  };

  // Load existing annotation files from backend with optimized lazy loading
  const loadAnnotationFilesFromBackend = async () => {
    if (!api) return;
    
    setIsLoadingFromBackend(true);
    try {
      // Try to load annotation files from the backend (prefer full annotation metadata including `type`)
      console.log('Loading annotation files from backend...');
      const annotationsResponse = await api.getAnnotations(id);

      if (annotationsResponse && annotationsResponse.success && annotationsResponse.data) {
        const filesData = annotationsResponse.data;
        // Create lightweight annotation file objects from backend-provided list (no full content fetch - use backend type for fast load)
        const lightweightFiles: AnnotationFile[] = await Promise.all(filesData.map(async (fileSummary: any) => {
          const backendType = fileSummary.type || fileSummary.format || null;
          const hasBackendType = typeof backendType === 'string' && backendType.length > 0;
          let detectedType: 'Classification' | 'Segmentation (mask+bbox)' | 'Segmentation (mask)' | 'Segmentation (bbox)' | 'Other' = 'Other';
          if (hasBackendType) {
            detectedType = backendType as typeof detectedType;
          } else {
            const nameLower = (fileSummary.name || '').toLowerCase();
            if (nameLower.includes('classification') || nameLower.includes('class')) {
              detectedType = 'Classification';
            } else if (nameLower.includes('segmentation') || nameLower.includes('seg') || nameLower.includes('mask')) {
              detectedType = 'Segmentation (mask+bbox)';
            } else {
              detectedType = 'Segmentation (bbox)';
            }
          }

          // Load class statistics (lightweight; coverage comes from list response)
          let classStats: Array<{ className: string; count: number; color: string; opacity: number }> = [];
          try {
            const classesResponse = await api.getAnnotationClasses(id, fileSummary.id);
            if (classesResponse?.success && classesResponse.data) {
              const raw = (classesResponse.data as any).classes ?? (classesResponse.data as any).data?.classes ?? [];
              const rawStats = (Array.isArray(raw) ? raw : []).map((c: Record<string, unknown>) => ({
                className: String(c.className ?? c.class_name ?? ''),
                count: Number(c.count ?? 0),
                color: String(c.color ?? ''),
                opacity: Number(c.opacity ?? 0.25),
              })).filter((s) => s.className.length > 0);
              // Assign random colors to classes that have no color or the default fallback
              const classNames = rawStats.map(s => s.className);
              const randomColors = generateClassColors(classNames);
              classStats = rawStats.map(s => ({
                ...s,
                color: s.color && s.color !== '#ea384c' ? s.color : randomColors[s.className] ?? '#ea384c',
              }));
            }
          } catch (error) {
            console.warn(`Failed to load classes for ${fileSummary.name}:`, error);
          }

          // Load coverage data for the file
          let coverageData = {
            totalReferencedImages: undefined as number | undefined,
            presentCount: undefined as number | undefined,
            missingCount: undefined as number | undefined
          };
          
          // Use coverage data directly from backend response if available
          if (fileSummary.image_coverage) {
            coverageData = {
              totalReferencedImages: fileSummary.image_coverage.total_referenced,
              presentCount: fileSummary.image_coverage.present,
              missingCount: fileSummary.image_coverage.missing
            };
          } else {
            // Fallback to separate API call for older backends
            try {
              const coverageResponse = await api.getAnnotationFileCoverage(id, fileSummary.id);
              if (coverageResponse && coverageResponse.success && coverageResponse.data) {
                const coverage = coverageResponse.data;
                coverageData = {
                  totalReferencedImages: coverage.total_referenced_images,
                  presentCount: coverage.present_count,
                  missingCount: coverage.missing_count
                };
              }
            } catch (error) {
              console.warn(`Failed to load coverage for ${fileSummary.name}:`, error);
            }
          }
          
          // First, generate unique colors for all classes
          const uniqueClassColors = classStats.reduce((acc, stat) => {
            const usedColors = new Set(Object.values(acc));
            const assignedColor = getOrAssignClassColor(stat.className, acc, usedColors);
            acc[stat.className] = assignedColor;
            return acc;
          }, {} as Record<string, string>);
          
          // Update classStats to use the new unique colors
          const updatedClassStats = classStats.map(stat => ({
            ...stat,
            color: uniqueClassColors[stat.className] || stat.color
          }));

          const annotationFile: AnnotationFile = {
            id: fileSummary.id,
            name: fileSummary.name,
            date: fileSummary.created_at || new Date().toISOString().split('T')[0], // Use backend created_at for correct sort order
            format: 'COCO', // Default format
            type: detectedType,
            classCount: classStats.length,
            imageCount: fileSummary.image_count || 0, // Use image_count from summary
            matchedImageCount: 0, // Will be calculated when needed
            totalSampleCount: fileSummary.annotation_count || fileSummary.actual_count || fileSummary.stored_count || 0,
            datasetId: id,
            samples: [], // Empty initially - will be loaded on demand
            classStats: updatedClassStats, // Use updated classStats with unique colors
            classColors: uniqueClassColors, // Use the same color mapping
            isVisible: false,
            showBboxes: false,
            tags: fileSummary.tags || [], // Load tags from backend summary
            // Mark as lazy-loaded so we know content isn't loaded yet
            isContentLoaded: false,
            processing_status: fileSummary.processing_status,
            // Add coverage properties
            totalReferencedImages: coverageData.totalReferencedImages,
            presentCount: coverageData.presentCount,
            missingCount: coverageData.missingCount
          };
          
          return annotationFile;
        }));
        
        // Load saved classifications from localStorage and merge
        const savedClassifications = loadSavedClassifications();
        
        // Filter out classifications that are already in backend files (to avoid duplicates)
        const backendClassificationIds = new Set(
          lightweightFiles.filter(file => detectAnnotationType(file) === 'Classification').map(file => file.id)
        );
        
        const filteredSavedClassifications = savedClassifications.filter(classification => 
          !backendClassificationIds.has(classification.id)
        );
        
        const combined = [...filteredSavedClassifications, ...lightweightFiles];
        
        // Sort by date (newest first) - handle both full timestamps and date-only strings
        combined.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          const timeA = dateA.getTime();
          const timeB = dateB.getTime();
          
          // If dates are exactly the same, sort by name for consistency
          if (timeA === timeB) {
            return a.name.localeCompare(b.name);
          }
          
          return timeB - timeA; // Newest first
        });
        
        setAnnotationFiles(combined);
        console.log(`Loaded ${lightweightFiles.length} annotation files (lightweight) from backend and ${filteredSavedClassifications.length} classifications from localStorage`);
        
        // Restore visibility state from localStorage
        const savedVisibility = localStorage.getItem(`annotation_visibility_${id}`);
        if (savedVisibility) {
          const visibilityArray: string[] = JSON.parse(savedVisibility);
          const visibilitySet = new Set(visibilityArray);
          setVisibleAnnotations(visibilitySet);
        }
        
        // Clear localStorage to prevent conflicts with backend data
        localStorage.removeItem(`annotations_${id}`);
        console.log(`Cleared localStorage for dataset ${id} to prevent conflicts`);
      } else {
        console.warn('Failed to load annotation summary, falling back to full data loading');
        // Fallback to original method if summary fails
        await loadAnnotationFilesFromBackendFull();
      }
    } catch (error) {
      console.warn('Failed to load annotation files summary from backend:', error);
      // Fallback to localStorage if backend fails
      loadAnnotationFilesFromLocalStorage();
    } finally {
      setIsLoadingFromBackend(false);
    }
  };
  
  // Original full loading method as fallback
  const loadAnnotationFilesFromBackendFull = async () => {
    if (!api) return;
    
    try {
      const response = await api.getAnnotations(id);
      if (response && response.success && response.data) {
        // Load full annotation content immediately for all files (original behavior)
        const processedFiles = await Promise.all(response.data.map(async (file: any) => {
          // Always detect annotation type by loading content
          let detectedType: 'Classification' | 'Segmentation (mask+bbox)' | 'Segmentation (mask)' | 'Segmentation (bbox)' | 'Other' = 'Other';
          
          console.log(`🔍 ANNOTATIONS: Processing file ${file.id}:`, file);
          console.log(`🔍 ANNOTATIONS: annotation_count = ${file.annotation_count}`);
          
          const annotationFile: AnnotationFile = {
            id: file.id, // Use the backend-provided ID
            name: file.name || file.filename,
            date: file.created_at ? new Date(file.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            format: file.format || 'COCO',
            type: detectedType, // Will be updated below
            classCount: file.category_count || 0,
            imageCount: file.image_count || 0,
            matchedImageCount: file.matched_image_count || 0,
            totalSampleCount: file.annotation_count || 0, // Use backend annotation count as initial value
            datasetId: id,
            classStats: [],
            samples: [],
            isVisible: false,
            showBboxes: false,
            classColors: {},
            imageMapping: {},
            tags: file.tags || [],
            processing_status: file.processing_status,
            error_message: file.error_message
          };
          
          console.log(`🔍 ANNOTATIONS: Created annotationFile with totalSampleCount = ${annotationFile.totalSampleCount}`);

          // Load full content and statistics immediately
          try {
            // Use same statistics source as Edit segmentation view (getAnnotationClasses)
            let classStats: Array<{ className: string; count: number; color: string; opacity?: number }> = [];
            try {
              const classesResponse = await api.getAnnotationClasses(id, file.id);
              if (classesResponse?.success && classesResponse.data?.classes?.length) {
                const classNames = classesResponse.data.classes.map((c: any) => c.className);
                const randomColors = generateClassColors(classNames);
                classStats = classesResponse.data.classes.map((c: { className: string; count?: number; color?: string; opacity?: number }) => ({
                  className: c.className,
                  count: c.count ?? 0,
                  color: c.color && c.color !== '#ea384c' ? c.color : randomColors[c.className] ?? '#ea384c',
                  opacity: c.opacity ?? 0.25,
                }));
              }
            } catch (e) {
              console.warn(`Failed to load classes for ${file.name}, will use from content:`, e);
            }

            console.log(`Loading content and detecting type for ${file.name}...`);
            const contentResponse = await api.getAnnotationContent(id, file.id);
            if (contentResponse && contentResponse.success && contentResponse.data.content) {
              // Detect annotation type from content first
              detectedType = detectAnnotationTypeFromContent(contentResponse.data.content, file.name);
              console.log(`Auto-detected type for ${file.name}: ${detectedType}`);
              
              // Process the full COCO content for samples/colors/mapping (stats already from getAnnotationClasses)
              const mockFile = new File([contentResponse.data.content], file.name, { type: 'application/json' });
              const result = await processCOCOAnnotations(mockFile, id);
              
              // Update annotation file with full processed data; keep classStats from backend (same as Edit segmentation)
              annotationFile.type = detectedType;
              if (classStats.length > 0) {
                annotationFile.classStats = classStats;
                annotationFile.classCount = classStats.length;
                annotationFile.classColors = classStats.reduce((acc, s) => ({ ...acc, [s.className]: s.color }), {} as Record<string, string>);
              } else {
                annotationFile.classStats = result.stats;
                annotationFile.classCount = result.stats.length;
                annotationFile.classColors = result.classColors;
              }
              annotationFile.imageMapping = result.imageMapping;
              annotationFile.imageDetails = result.imageDetails; // ADDED: Preserve image dimensions
              annotationFile.samples = result.samples.map(sample => ({
                ...sample,
                isVisible: false,
                showBboxes: false,
                annotationFileName: file.name,
                color: (annotationFile.classColors as Record<string, string>)[sample.className] || sample.color || generateRandomColor()
              }));
              
              console.log(`Full backend loading for ${file.name} - Stats from backend: ${classStats.length} classes`);
            } else {
              // Fallback to filename-based detection
              const isClassification = file.name && (file.name.toLowerCase().includes('classification') || file.name.toLowerCase().includes('class'));
              detectedType = isClassification ? 'Classification' : 'Other';
              annotationFile.type = detectedType;
              console.log(`Fallback filename-based detection for ${file.name}: ${detectedType}`);
            }
          } catch (error) {
            console.error(`Failed to load content for ${file.name}:`, error);
            // Fallback to filename-based detection
            const isClassification = file.name && (file.name.toLowerCase().includes('classification') || file.name.toLowerCase().includes('class'));
            detectedType = isClassification ? 'Classification' : 'Other';
            annotationFile.type = detectedType;
          }
          
          return annotationFile;
        }));
        
        // Sort by date (newest first) before setting - handle both full timestamps and date-only strings
        processedFiles.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          const timeA = dateA.getTime();
          const timeB = dateB.getTime();
          
          // If dates are exactly the same, sort by name for consistency
          if (timeA === timeB) {
            return a.name.localeCompare(b.name);
          }
          
          return timeB - timeA; // Newest first
        });
        
        // Load saved classifications and merge them with backend files
        const savedClassifications = loadSavedClassifications();
        
        // Filter out classifications that are already in backend files (to avoid duplicates)
        const backendClassificationIds = new Set(
          processedFiles.filter(file => detectAnnotationType(file) === 'Classification').map(file => file.id)
        );
        
        const filteredSavedClassifications = savedClassifications.filter(classification => 
          !backendClassificationIds.has(classification.id)
        );
        
        const combined = [...filteredSavedClassifications, ...processedFiles];
        
        // Sort by date (newest first) - handle both full timestamps and date-only strings
        combined.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          const timeA = dateA.getTime();
          const timeB = dateB.getTime();
          
          // If dates are exactly the same, sort by name for consistency
          if (timeA === timeB) {
            return a.name.localeCompare(b.name);
          }
          
          return timeB - timeA; // Newest first
        });
        
        console.log('🔍 ANNOTATIONS: Final combined array before setAnnotationFiles:', combined);
        combined.forEach((file, index) => {
          console.log(`🔍 ANNOTATIONS: File ${index}: ${file.name} - totalSampleCount: ${file.totalSampleCount}`);
        });
        
        setAnnotationFiles(combined);
        console.log(`Loaded ${processedFiles.length} annotation files with full content from backend and ${filteredSavedClassifications.length} classifications from localStorage`);
        
        // Restore visibility state from localStorage
        const savedVisibility = localStorage.getItem(`annotation_visibility_${id}`);
        if (savedVisibility) {
          const visibilityArray: string[] = JSON.parse(savedVisibility);
          const visibilitySet = new Set(visibilityArray);
          setVisibleAnnotations(visibilitySet);
        }
        
        // Clear localStorage to prevent conflicts with backend data
        localStorage.removeItem(`annotations_${id}`);
        console.log(`Cleared localStorage for dataset ${id} to prevent conflicts`);
      }
    } catch (error) {
      console.warn('Failed to load annotation files from backend:', error);
      // Fallback to localStorage if backend fails
      loadAnnotationFilesFromLocalStorage();
    } finally {
      setIsLoadingFromBackend(false);
    }
  };

  // Load existing annotations from localStorage (fallback) with smart loading
  const loadAnnotationFilesFromLocalStorage = () => {
    const savedAnnotations = localStorage.getItem(`annotations_${id}`);
    const isLargeDatasetFlag = localStorage.getItem(`annotations_${id}_large_dataset_flag`);
    const isEmergencyMode = localStorage.getItem(`annotations_${id}_emergency_mode`);
    
    if (savedAnnotations) {
      try {
        const parsed = JSON.parse(savedAnnotations);
        
        if (isEmergencyMode) {
          // Emergency mode: Very minimal data, show warning
          console.warn('Loading in emergency mode - minimal data available');
          
          const emergencyFiles = parsed.map((file: any) => ({
            id: file.id,
            name: file.name,
            date: new Date().toISOString().split('T')[0],
            format: 'COCO',
            type: undefined,
            classCount: file.classCount || 0,
            imageCount: 0,
            matchedImageCount: 0,
            datasetId: id,
            isVisible: file.isVisible || false,
            showBboxes: file.showBboxes !== false,
            classColors: {},
            tags: [],
            classStats: [],
            samples: [],
            totalSampleCount: file.totalSampleCount || 0,
            emergencyMode: true
          }));
          
          setAnnotationFiles(emergencyFiles);
          
          toast({
            title: "Limited local data",
            description: "Only metadata available. Connect to backend for full annotation features.",
            variant: "default"
          });
          
          return;
        }
        
        if (isLargeDatasetFlag) {
          // Large dataset mode: Preview data with pagination info
          console.log('Loading large dataset in preview mode');
          
          const paginationInfo = localStorage.getItem(`annotations_${id}_pagination`);
          if (paginationInfo) {
            const pagination = JSON.parse(paginationInfo);
            console.log(`Large dataset: ${pagination.totalSamples} total samples, showing preview of ${pagination.previewSize} per file`);
          }
          
          const previewFiles = parsed.map((file: any) => {
            // Ensure all classes have colors assigned, even in preview mode
            const usedColors = new Set<string>(Object.values(file.classColors || {}));
            const updatedClassColors = { ...file.classColors };
            
            // Check if any samples need colors assigned
            if (file.samples) {
              file.samples.forEach((sample: any) => {
                if (!updatedClassColors[sample.className]) {
                  updatedClassColors[sample.className] = getOrAssignClassColor(sample.className, updatedClassColors, usedColors);
                  usedColors.add(updatedClassColors[sample.className]);
                }
              });
            }
            
            return {
              ...file,
              classColors: updatedClassColors,
              samples: file.samples?.map((sample: any) => ({
                ...sample,
                color: updatedClassColors[sample.className] || sample.color || generateRandomColor(), // Ensure every sample has a color
                showBboxes: sample.showBboxes ?? false,
                annotationFileName: sample.annotationFileName || file.name
              })) || []
            };
          });
          
          setAnnotationFiles(previewFiles);
          
          toast({
            title: "Large dataset loaded",
            description: `Showing preview data. ${parsed.reduce((sum: number, f: any) => sum + (f.totalSampleCount || 0), 0)} total annotations available.`,
            variant: "default"
          });
          
        } else {
          // Normal mode: Complete data for small datasets
          const annotationsWithFileNames = parsed.map((file: AnnotationFile) => {
            // Ensure all classes have colors assigned
            const usedColors = new Set<string>(Object.values(file.classColors || {}));
            const updatedClassColors = { ...file.classColors };
            
            // Check if any classes need colors assigned
            if (file.samples) {
              file.samples.forEach(sample => {
                if (!updatedClassColors[sample.className]) {
                  updatedClassColors[sample.className] = getOrAssignClassColor(sample.className, updatedClassColors, usedColors);
                  usedColors.add(updatedClassColors[sample.className]);
                }
              });
            }
            
            // Also ensure classStats have colors
            if (file.classStats) {
              file.classStats.forEach(stat => {
                if (!updatedClassColors[stat.className]) {
                  updatedClassColors[stat.className] = getOrAssignClassColor(stat.className, updatedClassColors, usedColors);
                  usedColors.add(updatedClassColors[stat.className]);
                }
              });
            }
            
            return {
              ...file,
              classColors: updatedClassColors,
              showBboxes: file.showBboxes !== false,
              samples: file.samples?.map(sample => ({
                ...sample,
                color: updatedClassColors[sample.className] || sample.color, // Use assigned color
                showBboxes: file.showBboxes !== false, // Use file's bbox state, not individual sample state
                annotationFileName: (sample as any).annotationFileName || file.name
              }))
            };
          });
          
          setAnnotationFiles(annotationsWithFileNames);
        }
        
        // Sort by date (newest first) before setting - handle both full timestamps and date-only strings
        setAnnotationFiles(prev => {
          const sorted = [...prev].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            const timeA = dateA.getTime();
            const timeB = dateB.getTime();
            
            // If dates are exactly the same, sort by name for consistency
            if (timeA === timeB) {
              return a.name.localeCompare(b.name);
            }
            
            return timeB - timeA; // Newest first
          });
          return sorted;
        });
        
        // Restore visibility state with proper typing
        const savedVisibility = localStorage.getItem(`annotation_visibility_${id}`);
        if (savedVisibility) {
          const visibilityArray: string[] = JSON.parse(savedVisibility);
          const visibilitySet = new Set(visibilityArray);
          setVisibleAnnotations(visibilitySet);
        }
        
        
      } catch (error) {
        console.error('Error loading annotations from localStorage:', error);
        // Clear corrupted data
        localStorage.removeItem(`annotations_${id}`);
        localStorage.removeItem(`annotations_${id}_large_dataset_flag`);
        localStorage.removeItem(`annotations_${id}_emergency_mode`);
        localStorage.removeItem(`annotations_${id}_pagination`);
      }
    }
  };

  // Load saved classification annotations
  const loadSavedClassifications = () => {
    const savedAnnotations = localStorage.getItem(`saved_annotations_${id}`);
    if (savedAnnotations) {
      try {
        const annotationsList = JSON.parse(savedAnnotations);
        const classificationFiles = annotationsList.map((annotation: any) => {
          let classCount = 0;
          let imageCount = 0;
          
          // Check if it's COCO format or legacy JSON format
          if (annotation.format === 'COCO' && annotation.content) {
            // COCO format
            const cocoData = annotation.content;
            classCount = cocoData.categories ? cocoData.categories.length : 0;
            imageCount = cocoData.images ? cocoData.images.length : 0;
          } else if (annotation.content) {
            // Legacy JSON format
            classCount = Object.values(annotation.content).reduce((acc: number, classes: any) => 
              acc + (classes.class ? classes.class.length : 0), 0) as number;
            imageCount = Object.keys(annotation.content).length;
          }
          
          return {
            id: annotation.id,
            name: annotation.name,
            date: annotation.date || new Date().toISOString().split('T')[0], // Use annotation.date instead of annotation.savedAt
            format: annotation.format || (annotation.type === 'COCO' ? 'COCO' : 'JSON'),
            classCount: classCount,
            imageCount: imageCount,
            matchedImageCount: imageCount,
            datasetId: id,
            classStats: [],
            samples: [],
            isVisible: false,
            classColors: {},
            imageMapping: {},
            type: 'classification',
            content: annotation.content,
            tags: annotation.tags || [] // Load tags from saved data or initialize empty
          };
        });
        
        return classificationFiles;
      } catch (error) {
        console.error('Error loading saved classifications:', error);
        return [];
      }
    }
    return [];
  };

  // Load active annotation processing tasks from backend
  const loadActiveTasks = async () => {
    if (!api) return;
    
    try {
      console.log('Loading active annotation processing tasks...');
      const response = await api.getTasks({
        task_type: 'annotation_processing',
        status: 'pending'
      });
      
      const runningResponse = await api.getTasks({
        task_type: 'annotation_processing', 
        status: 'running'
      });
      
      if (response && response.success && response.data) {
        const tasks = new Map();
        
        // Add pending tasks
        response.data.forEach(task => {
          if (task.task_metadata?.dataset_id?.toString() === id.toString()) {
            tasks.set(task.id, {
              ...task,
              file_id: task.task_metadata?.file_id,
              fileName: task.task_metadata?.filename || task.name
            });
          }
        });
        
        // Add running tasks
        if (runningResponse && runningResponse.success && runningResponse.data) {
          runningResponse.data.forEach(task => {
            if (task.task_metadata?.dataset_id?.toString() === id.toString()) {
              tasks.set(task.id, {
                ...task,
                file_id: task.task_metadata?.file_id,
                fileName: task.task_metadata?.filename || task.name
              });
            }
          });
        }
        
        setActiveTasks(tasks);
        console.log(`Loaded ${tasks.size} active annotation processing tasks`);
        
        if (tasks.size > 0) {
          toast({
            title: "Active tasks found",
            description: `Found ${tasks.size} annotation processing task${tasks.size > 1 ? 's' : ''} in progress.`,
          });
        }
      }
    } catch (error) {
      console.warn('Failed to load active tasks:', error);
    }
  };

  // Load annotations on component mount
  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      try {
        if (api) {
          // Clear localStorage when using backend to prevent conflicts
          localStorage.removeItem(`annotations_${id}`);
          await Promise.all([
            loadAnnotationFilesFromBackend(), // This now handles classifications too
            loadActiveTasks() // Load any active annotation processing tasks
          ]);
        } else {
          loadAnnotationFilesFromLocalStorage();
          
          // Always load saved classifications from localStorage when no API
          const savedClassifications = loadSavedClassifications();
          if (savedClassifications.length > 0) {
            setAnnotationFiles(prev => {
              // Remove any existing classification files to avoid duplicates
              const nonClassificationFiles = prev.filter(file => detectAnnotationType(file) !== 'Classification');
              const combined = [...savedClassifications, ...nonClassificationFiles];
              // Sort by date (newest first) - handle both full timestamps and date-only strings
              combined.sort((a, b) => {
                const dateA = new Date(a.date);
                const dateB = new Date(b.date);
                const timeA = dateA.getTime();
                const timeB = dateB.getTime();
                
                // If dates are exactly the same, sort by name for consistency
                if (timeA === timeB) {
                  return a.name.localeCompare(b.name);
                }
                
                return timeB - timeA; // Newest first
              });
              return combined;
            });
          }
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, [id, api]);

  // Refresh data when component becomes visible or user returns to the page
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && api) {
        // Refresh data when page becomes visible
        loadAnnotationFilesFromBackend();
      }
    };

    const handleFocus = () => {
      if (api) {
        // Refresh data when window gains focus
        loadAnnotationFilesFromBackend();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
    };
  }, [api, id]);

  // Refresh statistics when expanding a card (same source as Edit segmentation view: getAnnotationClasses)
  useEffect(() => {
    if (!selectedAnnotation || !api || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getAnnotationClasses(id, selectedAnnotation);
        if (cancelled || !res?.success) return;
        // Support both res.data.classes and res.data as the payload (backend may wrap differently)
        const rawClasses = Array.isArray(res.data?.classes)
          ? res.data.classes
          : Array.isArray((res.data as any)?.data?.classes)
            ? (res.data as any).data.classes
            : [];
        const rawStats = rawClasses.map((c: Record<string, unknown>) => ({
          className: String(c.className ?? c.class_name ?? ''),
          count: Number(c.count ?? 0),
          color: String(c.color ?? ''),
          opacity: Number(c.opacity ?? 0.25),
        })).filter((s) => s.className.length > 0);
        const classNames = rawStats.map(s => s.className);
        const randomColors = generateClassColors(classNames);
        const classStats = rawStats.map(s => ({
          ...s,
          color: s.color && s.color !== '#ea384c' ? s.color : randomColors[s.className] ?? '#ea384c',
        }));
        // Don't overwrite with empty when we have no classes from API (keeps existing or leaves as-is)
        setAnnotationFiles(prev =>
          prev.map(f => {
            if (f.id !== selectedAnnotation) return f;
            const nextStats = classStats.length > 0 ? classStats : (f.classStats ?? []);
            return {
              ...f,
              classStats: nextStats,
              classCount: nextStats.length,
              classColors: { ...(f.classColors || {}), ...nextStats.reduce((acc, s) => ({ ...acc, [s.className]: s.color }), {} as Record<string, string>) },
            };
          })
        );
      } catch (e) {
        if (!cancelled) console.warn('Failed to refresh annotation classes:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedAnnotation, api, id]);

  // Periodically check for new saved classifications (only when no API)
  useEffect(() => {
    if (api) return; // Don't run periodic checks when using backend
    
    const interval = setInterval(() => {
      const savedClassifications = loadSavedClassifications();
      if (savedClassifications.length > 0) {
        setAnnotationFiles(prev => {
          // Remove any existing classification files to avoid duplicates
          const nonClassificationFiles = prev.filter(file => detectAnnotationType(file) !== 'Classification');
          const combined = [...savedClassifications, ...nonClassificationFiles];
          // Sort by date (newest first) - handle both full timestamps and date-only strings
          combined.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            const timeA = dateA.getTime();
            const timeB = dateB.getTime();
            
            // If dates are exactly the same, sort by name for consistency
            if (timeA === timeB) {
              return a.name.localeCompare(b.name);
            }
            
            return timeB - timeA; // Newest first
          });
          return combined;
        });
      }
    }, 2000); // Check every 2 seconds
    
    return () => clearInterval(interval);
  }, [id, api]);

  const selectedAnnotationData = annotationFiles.find(file => file.id === selectedAnnotation);

  const handleDeleteClassClick = (annotationId: string, className: string) => {
    // Show confirmation dialog
    setDeleteClassDialog({ isOpen: true, className, annotationId });
  };

  const handleDeleteClass = async () => {
    const { annotationId, className } = deleteClassDialog;
    if (!annotationId || !className) return;
    
    // Close dialog
    setDeleteClassDialog({ isOpen: false, className: '', annotationId: '' });
    
    try {
      console.log('Deleting class:', className, 'from annotation:', annotationId);
      if (api) {
        // Use the optimized backend endpoint that deletes directly from database
        const response = await api.deleteAnnotationClass(id, annotationId, className);
        console.log('Delete response:', response);
        if (!response.success) {
          throw new Error(response.error || "Failed to delete class");
        }
        
        if (selectedClass === className) {
          setSelectedClass(null);
        }
        
        // Clear the cache to force reload
        setCurrentPageAnnotations(prev => {
          const newCache = { ...prev };
          delete newCache[annotationId];
          return newCache;
        });
        
        // Only reload if the annotation file is currently visible
        if (visibleAnnotations.has(annotationId)) {
          // Reload annotations for the current page to get fresh data from database
          await loadAnnotationsForCurrentPage(annotationId, true);
        } else {
          // If not visible, just update the metadata
          setAnnotationFiles(prev => prev.map(file => 
            file.id === annotationId
              ? {
                  ...file,
                  annotation_count: response.data?.remaining_annotations,
                  category_count: response.data?.remaining_categories,
                  currentPageLoaded: false, // Mark as needing reload when made visible
                }
              : file
          ));
        }
        
        toast({
          title: "Class deleted",
          description: `Deleted ${response.data?.deleted_count || 0} annotations for class '${className}'.`,
        });
      } else {
        // Fallback for localStorage mode
        const updatedFiles = annotationFiles.map(file => {
          if (file.id === annotationId) {
            const updatedClassStats = file.classStats?.filter(stat => stat.className !== className);
            const updatedSamples = file.samples?.filter(sample => sample.className !== className);
            const updatedClassColors = { ...file.classColors };
            delete updatedClassColors[className];
            return {
              ...file,
              classStats: updatedClassStats,
              samples: updatedSamples,
              classColors: updatedClassColors,
            };
          }
          return file;
        });
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
        setAnnotationFiles(updatedFiles);
        if (selectedClass === className) {
          setSelectedClass(null);
        }
        toast({
          title: "Class deleted",
          description: `Class '${className}' has been deleted from the annotation file.`,
        });
      }
    } catch (error) {
      console.error('Error deleting class:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete class",
        variant: "destructive",
      });
    }
  };

  // Save handler for a single annotation file
  const handleSaveAnnotationFile = async (annotationId: string) => {
    const fileToSave = annotationFiles.find(f => f.id === annotationId);
    if (!fileToSave) return;
    try {
      if (api) {
        // CRITICAL: If samples are not loaded yet (lazy loading), load them now before converting to COCO
        // This prevents losing all annotations when saving after class merge without expanding the file
        let fileWithSamples = fileToSave;
        if (!fileToSave.samples || fileToSave.samples.length === 0) {
          console.log(`Loading samples for ${fileToSave.name} before saving...`);
          try {
            const contentResponse = await api.getAnnotationContent(id, fileToSave.id);
            if (contentResponse && contentResponse.success && contentResponse.data.content) {
              const mockFile = new File([contentResponse.data.content], fileToSave.name, { type: 'application/json' });
              const result = await processCOCOAnnotations(mockFile, id);
              fileWithSamples = {
                ...fileToSave,
                samples: result.samples,
                imageMapping: result.imageMapping || fileToSave.imageMapping,
                imageDetails: result.imageDetails || fileToSave.imageDetails // ADDED: Preserve image dimensions
              };
              console.log(`Loaded ${result.samples.length} samples before saving`);
            }
          } catch (loadError) {
            console.error('Failed to load samples before save:', loadError);
            throw new Error('Cannot save without loading annotation data first. Please expand the annotation file to load data.');
          }
        }
        
        const jsonContent = JSON.stringify(toCOCOFormat(fileWithSamples), null, 2);
        const updatedFile = new File([jsonContent], fileWithSamples.name, { type: 'application/json' });
        const response = await api.updateAnnotationContent(id, annotationId, updatedFile);
        if (!response.success) throw new Error(response.error || "Failed to update annotation file on server");
      } else {
        localStorage.setItem(`annotations_${id}`, JSON.stringify(annotationFiles));
      }
      clearDirty(annotationId);
      toast({ title: "Changes saved", description: `Annotation file '${fileToSave.name}' saved successfully.` });
    } catch (error) {
      toast({ title: "Save failed", description: error instanceof Error ? error.message : "Failed to save changes.", variant: "destructive" });
    }
  };

  // Duplicate annotation handler
  const handleDuplicateAnnotation = async (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const file = annotationFiles.find(f => f.id === annotationId);
    if (!file) {
      toast({
        title: "Error",
        description: "Annotation file not found.",
        variant: "destructive",
      });
      return;
    }
    
    try {
      if (api) {
        // Use the backend endpoint to duplicate directly in database
        const response = await api.duplicateAnnotationFile(id, annotationId);
        if (!response.success) {
          throw new Error(response.error || "Failed to duplicate annotation file");
        }
        
        // Refresh annotation files from backend to get the new file
        await loadAnnotationFilesFromBackend();
        
        toast({
          title: "Annotation duplicated",
          description: `Created a copy: ${response.data?.new_file_name} with ${response.data?.annotation_count || 0} annotations`,
        });
      } else {
        // Fallback for localStorage mode
        const newId = Math.random().toString(36).substring(2, 11);
        const baseName = file.name.replace(/(\.[^/.]+)?$/, "");
        let copyIndex = 2;
        let newName = `${baseName}_copy`;
        
        while (annotationFiles.some(f => f.name === newName || f.name === `${baseName}_copy${copyIndex}`)) {
          newName = `${baseName}_copy${copyIndex}`;
          copyIndex++;
        }
        
        const duplicatedFile = {
          ...file,
          id: newId,
          name: newName,
          date: new Date().toISOString().split('T')[0],
          samples: file.samples ? file.samples.map(sample => ({ ...sample, annotationFileName: newName })) : [],
        };
        
        const updatedFiles = [...annotationFiles, duplicatedFile];
        setAnnotationFiles(updatedFiles);
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
        
        toast({
          title: "Annotation duplicated",
          description: `Created a copy: ${newName}`,
        });
      }
    } catch (error) {
      console.error('Error duplicating annotation:', error);
      toast({
        title: "Duplicate failed",
        description: error instanceof Error ? error.message : "Failed to duplicate annotation file.",
        variant: "destructive",
      });
    }
  };
  
  return (
    <div className={`h-full flex flex-col min-h-0 ${className}`}>
      <div className="flex-shrink-0 flex justify-between items-center mb-4">
        <div>
          <h2 className="text-2xl font-bold">Annotations</h2>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            onClick={handleImportClick}
            disabled={isLoading}
          >
            <Upload className="w-4 h-4 mr-2" />
            {isLoading ? "Importing..." : "Import Annotations"}
          </Button>
          <Button 
            onClick={() => setShowAnnotationChoiceModal(true)}
          >
            <Brush className="w-4 h-4 mr-2" />
            Annotate
          </Button>
          
          {/* Merge Mode Toggle */}
          {!mergeMode ? (
            <Button 
              variant="outline"
              onClick={() => setMergeMode(true)}
              disabled={filteredAnnotationFiles.length < 2}
            >
              <Merge className="w-4 h-4 mr-2" />
              Merge
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button 
                onClick={handleMergeAnnotations}
                disabled={selectedForMerge.size < 2}
              >
                <CheckSquare className="w-4 h-4 mr-2" />
                Merge Selected ({selectedForMerge.size})
              </Button>
              <Button 
                variant="outline"
                onClick={() => {
                  setMergeMode(false);
                  setSelectedForMerge(new Set());
                }}
              >
                <X className="w-4 h-4 mr-2" />
                Cancel
              </Button>
            </div>
          )}
        </div>      </div>

      {/* Main content: annotation files with expandable statistics - scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Search and filter controls */}
        <div className="mb-4">
          <AnnotationFilters
            annotations={annotationFiles}
            onFilterChange={setFilteredAnnotationFiles}
          />
        </div>

        <div className="space-y-2">
        {/* Initial loading indicator */}
        {isLoading && annotationFiles.length === 0 && (
          <div className="mb-4 p-4 bg-muted/50 border border-border rounded-lg text-center">
            <div className="flex items-center justify-center gap-2 text-sm">
              <Loader className="h-4 w-4 animate-spin text-primary" />
              <span className="text-muted-foreground">Loading annotations...</span>
            </div>
          </div>
        )}
        
        {/* Import/Processing status indicators */}
        {(importingFiles.size > 0 || processingFiles.size > 0 || activeTasks.size > 0) && (
          <div className="mb-4 p-3 bg-muted/50 border border-border rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <Loader className="h-4 w-4 animate-spin text-primary" />
              <span className="text-muted-foreground">
                {importingFiles.size > 0 && `Importing ${importingFiles.size} file${importingFiles.size > 1 ? 's' : ''}...`}
                {importingFiles.size > 0 && (processingFiles.size > 0 || activeTasks.size > 0) && ' • '}
                {processingFiles.size > 0 && `Processing ${processingFiles.size} file${processingFiles.size > 1 ? 's' : ''}...`}
                {processingFiles.size > 0 && activeTasks.size > 0 && ' • '}
                {activeTasks.size > 0 && `${activeTasks.size} background task${activeTasks.size > 1 ? 's' : ''} running...`}
              </span>
            </div>
            {/* Show individual task progress if we have active tasks */}
            {activeTasks.size > 0 && (
              <div className="mt-2 space-y-1">
                {Array.from(activeTasks.values()).map(task => (
                  <div key={task.id} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="truncate mr-2">{task.fileName || task.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="capitalize">{task.status}</span>
                      {task.progress > 0 && (
                        <span>({task.progress}%)</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        
        {filteredAnnotationFiles
          .sort((a, b) => {
            // Sort by date (newest first) - handle both full timestamps and date-only strings
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            const timeA = dateA.getTime();
            const timeB = dateB.getTime();
            
            // If dates are exactly the same (same timestamp), sort by name for consistency
            if (timeA === timeB) {
              return a.name.localeCompare(b.name);
            }
            
            return timeB - timeA; // Newest first
          })
          .map((file, index) => {
            const isBboxOnly = detectAnnotationType(file) === 'Segmentation (bbox)';
            const isOther = detectAnnotationType(file) === 'Other';
            const isUnsupportedFormat = isBboxOnly || isOther;
            return (
              <div
                key={file.id}
                className={`border rounded-lg overflow-hidden ${
                  isUnsupportedFormat
                    ? 'border-yellow-500/50 bg-yellow-500/10 dark:bg-yellow-500/10'
                    : 'border-border/60'
                }`}
              >
                {/* Main annotation row */}
                <div 
                  className={`cursor-pointer p-4 hover:bg-accent/50 transition-colors ${selectedAnnotation === file.id ? 'bg-accent' : ''} ${isUnsupportedFormat ? 'hover:bg-yellow-500/20' : ''}`}
                  onClick={() => handleAnnotationClick(file.id)}
                >
                   <div className="flex items-center justify-between">
                      {/* Number indicator */}
                      <div className="flex items-center mr-3 min-w-[24px]">
                        <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                          #{index + 1}
                        </span>
                      </div>
                      
                      {/* Checkbox for merge mode */}
                      {mergeMode && (
                        <div className="flex items-center mr-3">
                          <input
                            type="checkbox"
                            checked={selectedForMerge.has(file.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newSelected = new Set(selectedForMerge);
                              if (e.target.checked) {
                                newSelected.add(file.id);
                              } else {
                                newSelected.delete(file.id);
                              }
                              setSelectedForMerge(newSelected);
                            }}
                            className="w-4 h-4 rounded focus:ring-2 focus:ring-primary"
                          />
                        </div>
                     )}
                     <div className="flex-1">
                       <div className="flex items-center gap-2 group">
                         {editingName?.annotationId === file.id ? (
                            <div className="flex items-center gap-2 flex-1">
                              <Input
                                value={editingName.newName}
                                onChange={(e) => setEditingName({ ...editingName, newName: e.target.value })}
                                onKeyDown={handleNameKeyDown}
                                onBlur={handleSaveEditName}
                                className="font-medium h-6 px-2 text-sm"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-primary hover:text-primary/80"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSaveEditName();
                                }}
                              >
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCancelEditName();
                                }}
                              >
                               <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                               </svg>
                             </Button>
                           </div>
                         ) : (
                           <>
                             <div className="flex items-center gap-2">
                               <div className="font-medium">{file.name}</div>
                                {importingFiles.has(file.name) && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs bg-primary/20 text-primary border-primary flex items-center gap-1"
                                    title="Importing file..."
                                  >
                                    <Loader className="h-3 w-3 animate-spin" />
                                    Importing
                                  </Badge>
                                )}
                                {processingFiles.has(file.id) && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500 flex items-center gap-1"
                                    title="Processing annotations..."
                                  >
                                    <Loader className="h-3 w-3 animate-spin" />
                                    Processing
                                  </Badge>
                                )}
                                {(file as any).emergencyMode && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs bg-destructive/20 text-destructive border-destructive"
                                    title="Emergency mode: Minimal data only"
                                  >
                                    Limited
                                  </Badge>
                                )}
                             </div>
                             <Button
                               variant="ghost"
                               size="sm"
                               className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                               onClick={(e) => handleStartEditName(file.id, file.name, e)}
                               title="Edit annotation name"
                             >
                               <Edit className="h-3 w-3" />
                             </Button>
                           </>
                         )}
                       </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2">
                          <span>
                            {new Date(file.date).toLocaleDateString()} • {file.classCount} classes • {file.totalSampleCount || 0} annotations • {file.format}
                          </span>
                          <Badge 
                            variant="secondary" 
                            className={`text-xs capitalize ${
                              isUnsupportedFormat
                                ? 'cursor-default bg-yellow-500/25 text-yellow-800 dark:text-yellow-200 border-yellow-500/60'
                                : detectAnnotationType(file) === 'Classification'
                                ? 'cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors bg-primary/20 text-primary border-primary/50' 
                                : detectAnnotationType(file).startsWith('Segmentation')
                                ? 'cursor-pointer hover:bg-accent-foreground hover:text-accent transition-colors bg-accent text-accent-foreground border-accent'
                                : 'bg-muted text-muted-foreground border-border'
                            }`}
                            onClick={(e) => {
                              if (isUnsupportedFormat) {
                                e.stopPropagation();
                                return;
                              }
                              if (detectAnnotationType(file) === 'Classification') {
                                handleEditClassificationAnnotation(file.id, e);
                              } else if (detectAnnotationType(file).startsWith('Segmentation')) {
                                handleEditSegmentationAnnotation(file.id, e);
                              }
                            }}
                            title={
                              isBboxOnly
                                ? 'Format not supported, missing masks'
                                : isOther
                                ? 'Format not supported'
                                : detectAnnotationType(file) === 'Classification'
                                ? 'Click to edit classification annotations'
                                : detectAnnotationType(file).startsWith('Segmentation')
                                ? 'Click to edit segmentation annotations'
                                : `Type: ${detectAnnotationType(file)}`
                            }
                          >
                            {(() => {
                              const type = detectAnnotationType(file);
                              
                              // Ensure we always show a meaningful type
                              let displayType = type;
                              if (type === 'Other' && file.samples && file.samples.length > 0) {
                                // Try to detect again based on actual sample content
                                const hasSegmentation = file.samples.some(sample => 
                                  sample.segmentation && Array.isArray(sample.segmentation) && sample.segmentation.length > 0
                                );
                                const hasMeaningfulBbox = file.samples.some(sample => 
                                  sample.bbox && Array.isArray(sample.bbox) && sample.bbox.length === 4 && 
                                  (sample.bbox[0] !== 0 || sample.bbox[1] !== 0 || sample.bbox[2] !== 0 || sample.bbox[3] !== 0)
                                );
                                
                                if (hasSegmentation && hasMeaningfulBbox) {
                                  displayType = 'Segmentation (mask+bbox)';
                                } else if (hasSegmentation) {
                                  displayType = 'Segmentation (mask)';
                                } else if (hasMeaningfulBbox) {
                                  displayType = 'Segmentation (bbox)';
                                } else {
                                  displayType = 'Classification';
                                }
                              }
                              
                              switch (displayType) {
                                case 'Classification':
                                  return 'Classification';
                                case 'Segmentation (mask+bbox)':
                                  return 'Segmentation (mask+bbox)';
                                case 'Segmentation (mask)':
                                  return 'Segmentation (mask)';
                                case 'Segmentation (bbox)':
                                  return 'Segmentation (bbox)';
                                case 'Other':
                                  return 'Other';
                                default:
                                  return displayType || 'Other';
                              }
                            })()}
                          </Badge>
                          {isBboxOnly && (
                            <span className="text-xs text-yellow-700 dark:text-yellow-300 ml-1" title="Edit segmentation is not supported for bbox-only annotations">
                              Format not supported, missing masks
                            </span>
                          )}
                          {isOther && (
                            <span className="text-xs text-yellow-700 dark:text-yellow-300 ml-1" title="Edit is not supported for this annotation type">
                              Format not supported
                            </span>
                          )}
                          {file.processing_status === 'processing' && (
                            <Badge
                              variant="secondary"
                              className="text-xs bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 border-yellow-500 flex items-center gap-1"
                              title="File is being processed"
                            >
                              <Loader className="h-3 w-3 animate-spin" />
                              Processing
                            </Badge>
                          )}
                          {file.processing_status === 'failed' && (
                            <Badge
                              variant="secondary"
                              className="text-xs bg-destructive/20 text-destructive border-destructive"
                              title={file.error_message || "Processing failed"}
                            >
                              Failed
                            </Badge>
                          )}
                        </div>
                        {/* Tags display */}
                        {file.tags && file.tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-2">
                            {file.tags.slice(0, 3).map((tag) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="text-xs bg-primary/20 text-primary border-primary/30"
                              >
                                <Tag className="h-3 w-3 mr-1" />
                                {tag}
                              </Badge>
                            ))}
                            {file.tags.length > 3 && (
                              <Badge
                                variant="secondary"
                                className="text-xs bg-muted text-muted-foreground border-border"
                              >
                                +{file.tags.length - 3} more
                              </Badge>
                            )}
                          </div>
                        )}
                     </div>
                    <div className="flex items-center gap-4">                      {/* Images count with coverage */}
                      <div className="flex items-center gap-2 text-sm">
                        {(() => {
                          // If we have coverage data, show compact format
                          if (file.totalReferencedImages !== undefined) {
                            const presentCount = file.presentCount || 0;
                            const totalCount = file.totalReferencedImages;
                            const missingCount = file.missingCount || 0;
                            
                            return (
                              <button
                                className="hover:bg-accent px-2 py-1 rounded transition-colors cursor-pointer text-xs"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleShowImageBreakdown(file);
                                }}
                                title="Click to see image details"
                              >
                                <span className="text-green-600 dark:text-green-400">{presentCount}</span>
                                <span className="text-muted-foreground">/</span>
                                <span className="text-destructive">{missingCount}</span>
                                <span className="text-muted-foreground ml-1">({totalCount} total)</span>
                              </button>
                            );
                          } else {
                            // Just show total image count for loading state
                            const totalCount = file.imageCount || 0;
                            
                            return (
                              <button
                                className="hover:underline cursor-pointer text-primary hover:text-primary/80"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleShowImageBreakdown(file);
                                }}
                                title={`Click to see image coverage for ${totalCount} total images`}
                              >
                                {totalCount} images
                              </button>
                            );
                          }
                        })()}
                      </div>
                      {/* Visibility toggles */}
                      <div className="flex gap-1">
                        {/* Individual segmentation masks toggle */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${visibleAnnotations.has(file.id) ? 'text-primary' : 'text-muted-foreground'}`}
                          onClick={(e) => handleToggleAnnotationVisibility(file.id, e)}
                          title={visibleAnnotations.has(file.id) ? "Hide segmentation masks" : "Show segmentation masks"}
                          disabled={loadingAnnotations.has(file.id)}
                        >
                          {loadingAnnotations.has(file.id) ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                          ) : (
                            visibleAnnotations.has(file.id) ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />
                          )}
                        </Button>
                        
                        {/* Individual bounding boxes toggle */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${file.showBboxes ? 'text-primary' : 'text-muted-foreground'}`}
                          onClick={(e) => handleToggleAnnotationBboxes(file.id, e)}
                          title={file.showBboxes ? "Hide bounding boxes" : "Show bounding boxes"}
                          disabled={loadingAnnotations.has(file.id)}
                        >
                          {loadingAnnotations.has(file.id) ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                       {/* Actions */}
                       <div className="flex gap-2">
                         {/* Load buttons for preview mode */}
                         {(file as any).previewOnly && api && (
                           <>
                             <Button 
                               variant="ghost" 
                               size="icon" 
                               className="h-8 w-8 text-muted-foreground hover:text-primary"
                               onClick={(e) => {
                                 e.stopPropagation();
                                 if (currentPageImageIds.length > 0) {
                                   console.log(`Manual loading annotations for current page. Page has ${currentPageImageIds.length} images.`);
                                   loadAnnotationsForCurrentPage(file.id, true);
                                 } else {
                                   toast({
                                     title: "No images on current page",
                                     description: "Navigate to a page with images to load relevant annotations.",
                                     variant: "default"
                                   });
                                 }
                               }}
                               title={`Load annotations for current page images (${currentPageImageIds.length} images)`}
                             >
                               <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                               </svg>
                             </Button>
                           </>
                         )}
                         
                         {/* Tags button */}
                         <Button 
                           variant="ghost" 
                           size="icon" 
                           className="h-8 w-8 text-muted-foreground hover:text-primary"
                           onClick={(e) => handleTagsClick(file.id, e)}
                           title="Manage tags"
                         >
                           <Tag className="h-4 w-4" />
                         </Button>
                         {detectAnnotationType(file) === 'Classification' ? (
                           <Button 
                             variant="ghost" 
                             size="icon" 
                             className="h-8 w-8 text-muted-foreground hover:text-primary"
                             onClick={(e) => handleEditClassificationAnnotation(file.id, e)}
                             title="Edit classification annotations"
                           >
                             <Edit className="h-4 w-4" />
                           </Button>
                         ) : isBboxOnly ? (
                           <Button
                             variant="ghost"
                             size="icon"
                             className="h-8 w-8 text-muted-foreground/50 cursor-not-allowed"
                             disabled
                             title="Format not supported, missing masks"
                           >
                             <Brush className="h-4 w-4" />
                           </Button>
                         ) : isOther ? (
                           <Button
                             variant="ghost"
                             size="icon"
                             className="h-8 w-8 text-muted-foreground/50 cursor-not-allowed"
                             disabled
                             title="Format not supported"
                           >
                             <Edit className="h-4 w-4" />
                           </Button>
                         ) : detectAnnotationType(file).startsWith('Segmentation') ? (
                           <Button 
                             variant="ghost" 
                             size="icon" 
                             className="h-8 w-8 text-muted-foreground hover:text-primary"
                             onClick={(e) => handleEditSegmentationAnnotation(file.id, e)}
                             title="Edit segmentation annotations"
                           >
                             <Brush className="h-4 w-4" />
                           </Button>
                         ) : (
                           <Button 
                             variant="ghost" 
                             size="icon" 
                             className="h-8 w-8 text-muted-foreground hover:text-foreground"
                             onClick={(e) => handleStartEditName(file.id, file.name, e)}
                             title="Edit annotation name"
                           >
                             <Edit className="h-4 w-4" />
                           </Button>
                         )}
                         <Button
                           variant="ghost"
                           size="icon"
                           className="h-8 w-8 text-muted-foreground hover:text-primary"
                           onClick={(e) => handleDuplicateAnnotation(file.id, e)}
                           title="Duplicate annotation file"
                         >
                           {/* Copy icon SVG */}
                           <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><rect x="3" y="3" width="13" height="13" rx="2" strokeWidth="2"/></svg>
                         </Button>
                         <Button 
                           variant="ghost" 
                           size="icon" 
                           className="h-8 w-8 text-muted-foreground hover:text-destructive"
                           onClick={(e) => handleDeleteAnnotation(file.id, e)}
                           title="Delete annotation file"
                         >
                           <Trash2 className="h-4 w-4" />
                         </Button>
                         <Button 
                           variant="ghost" 
                           size="icon" 
                           className="h-8 w-8 text-muted-foreground hover:text-primary"
                           onClick={(e) => handleDownloadImagesClick(file.id, e)}
                           title="Download images by class"
                         >
                           <ImageDown className="h-4 w-4" />
                         </Button>
                         <Button 
                           variant="ghost" 
                           size="icon" 
                           className="h-8 w-8 text-muted-foreground hover:text-primary"
                           onClick={(e) => handleDownloadAnnotation(file.id, e)}
                           title="Download annotation file"
                         >
                           <Download className="h-4 w-4" />
                         </Button>
                       </div>
                    </div>
                  </div>
                </div>
                
                {/* Expandable statistics section */}
                {selectedAnnotation === file.id && (
                  <div className="border-t border-border bg-muted/30">
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-medium">
                          Classes & Statistics
                        </h4>
                        <div className="flex items-center gap-2">
                          {(file.classStats?.length || 0) > 1 && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7"
                              onClick={() => setMergeDialogOpen(true)}
                            >
                              <Merge className="h-3 w-3 mr-1" />
                              Merge
                            </Button>
                          )}
                          {dirtyAnnotationIds.has(file.id) && (
                            <Button size="sm" className="h-7" onClick={() => handleSaveAnnotationFile(file.id)}>
                              Save Changes
                            </Button>
                          )}
                        </div>
                      </div>
                      
                      {/* Combined statistics & config section */}
                      <div className="mb-3">
                        <ClassStatistics
                          statistics={file.classStats || []}
                          selectedClass={selectedClass}
                          onClassIconClick={(className) => setSelectedClass(selectedClass === className ? null : className)}
                        />
                      </div>
                      
                      {/* Class Configuration - inline when selected */}
                      <div>
                        {selectedClass && file.classStats && (
                            <div className="mt-4 pt-4 border-t border-border">
                              <ClassColorOpacityPicker
                                annotationId={file.id}
                                className={selectedClass}
                                color={file.classStats.find(s => s.className === selectedClass)?.color || generateRandomColor()}
                                opacity={(file.classStats.find(s => s.className === selectedClass) as any)?.opacity || 0.25}
                                onColorOpacityChange={handleClassColorOpacityChange}
                                onRenameClass={(className) => setRenameClassDialog({ isOpen: true, className, annotationId: file.id })}
                                onDeleteClass={(className) => handleDeleteClassClick(file.id, className)}
                              />
                            </div>
                          )}
                          {/* Rename Class Dialog */}
                          <RenameClassDialog
                            isOpen={renameClassDialog.isOpen}
                            onClose={() => setRenameClassDialog({ isOpen: false, className: '', annotationId: '' })}
                            className={renameClassDialog.className}
                            annotations={annotationFiles.find(f => f.id === renameClassDialog.annotationId)?.samples || []}
                            onRename={(oldClassName, newClassName) => handleRenameClass(renameClassDialog.annotationId, oldClassName, newClassName)}
                          />
                          {/* Delete Class Confirmation Dialog */}
                          <Dialog open={deleteClassDialog.isOpen} onOpenChange={(open) => !open && setDeleteClassDialog({ isOpen: false, className: '', annotationId: '' })}>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Delete All Annotations?</DialogTitle>
                              </DialogHeader>
                              <div className="py-4">
                                <p className="text-sm text-muted-foreground">
                                  Are you sure you want to delete all annotations for class <strong>"{deleteClassDialog.className}"</strong>?
                                </p>
                                <p className="text-sm text-destructive mt-2">
                                  This action cannot be undone.
                                </p>
                              </div>
                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="outline"
                                  onClick={() => setDeleteClassDialog({ isOpen: false, className: '', annotationId: '' })}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={handleDeleteClass}
                                >
                                  Delete All
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                      </div>
                  </div>
                )}
              </div>
            );
          })
        }
        
        {/* Download Images Dialog */}
        <Dialog open={downloadImagesDialog.isOpen} onOpenChange={(open) => !open && setDownloadImagesDialog({ isOpen: false, annotationId: '', categories: [] })}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Download Images by Class</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <p className="text-sm text-muted-foreground">
                Select a class to download all images that have that classification:
              </p>
              <ScrollArea className="max-h-96">
                <div className="space-y-2">
                  {downloadImagesDialog.categories.map((category) => (
                    <Button
                      key={category.id}
                      variant="outline"
                      className="w-full justify-start"
                      onClick={() => handleDownloadImagesByClass(category.name)}
                    >
                      <Tag className="h-4 w-4 mr-2" />
                      {category.name}
                    </Button>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </DialogContent>
        </Dialog>
        
        {annotationFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center p-8">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Tag className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-medium mb-2">No annotation files</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Import annotation files to view and configure class statistics
            </p>
          </div>
        )}
        {annotationFiles.length > 0 && filteredAnnotationFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center p-8">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Tag className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">No matching annotations</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Try adjusting your search query or filters to find annotation files
            </p>
          </div>
        )}
        </div>
      </div>

      <AnnotationsUploadDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
        onFilesSelected={handleFilesSelected}
      />      <Dialog open={imageStatusDialog.isOpen} onOpenChange={(open) => setImageStatusDialog(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {imageStatusDialog.type === 'breakdown' ? 'Image Coverage' :
               imageStatusDialog.type === 'present' ? 'Present Images' : 'Missing Images'} 
              {imageStatusDialog.type !== 'breakdown' && ` (${imageStatusDialog.files.length})`}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              From annotation file: {imageStatusDialog.annotationFileName}
            </p>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {imageStatusDialog.isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center gap-3">
                  <Loader className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-muted-foreground">Calculating image breakdown...</span>
                </div>
              </div>
            ) : imageStatusDialog.type === 'breakdown' ? (
              <div className="space-y-4">
                <div className="space-y-1">
                  {imageStatusDialog.files.map((line, index) => (
                    <div key={index} className="text-sm">
                      {line}
                    </div>
                  ))}
                </div>
                
                <div className="flex gap-3 pt-4 border-t border-border">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setImageStatusDialog({
                        isOpen: true,
                        type: 'present',
                        files: imageStatusDialog.presentFiles || [],
                        annotationFileName: imageStatusDialog.annotationFileName
                      });
                    }}
                    disabled={!imageStatusDialog.presentCount || imageStatusDialog.presentCount === 0}
                  >
                    View Present Images ({imageStatusDialog.presentCount || 0})
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setImageStatusDialog({
                        isOpen: true,
                        type: 'missing',
                        files: imageStatusDialog.missingFiles || [],
                        annotationFileName: imageStatusDialog.annotationFileName
                      });
                    }}
                    disabled={!imageStatusDialog.missingCount || imageStatusDialog.missingCount === 0}
                  >
                    View Missing Images ({imageStatusDialog.missingCount || 0})
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {imageStatusDialog.files.length > 0 ? (
                  <div className="space-y-1">
                    {imageStatusDialog.files.map((fileName, index) => (
                      <div 
                        key={index} 
                        className="text-sm p-2 bg-muted rounded border border-border"
                      >
                        {fileName}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    No {imageStatusDialog.type} images found.
                  </p>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialog.isOpen} onOpenChange={(open) => !open && handleCancelEdit()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Annotation File</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Change the name of the annotation file
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="annotation-name" className="text-sm font-medium block mb-2">
                Annotation Name
              </label>
              <Input
                id="annotation-name"
                value={editDialog.newName}
                onChange={(e) => setEditDialog(prev => ({ ...prev, newName: e.target.value }))}
                placeholder="Enter annotation name..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSaveAnnotationName();
                  } else if (e.key === 'Escape') {
                    handleCancelEdit();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={handleCancelEdit}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveAnnotationName}
                disabled={!editDialog.newName.trim() || editDialog.newName.trim() === editDialog.currentName}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      <AnnotationTagsDialog
        open={tagsDialog.isOpen}
        onOpenChange={(open) => setTagsDialog(prev => ({ ...prev, isOpen: open }))}
        annotationFileName={tagsDialog.annotationName}
        initialTags={tagsDialog.currentTags}
        onSaveTags={handleSaveTags}
      />
      
      <MergeClassesDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        classStats={selectedAnnotationData?.classStats || []}
        onMerge={(sources, mergedName) => handleMergeClasses(selectedAnnotation!, sources, mergedName)}
      />
      
      <AnnotationChoiceModal
        isOpen={showAnnotationChoiceModal}
        onOpenChange={setShowAnnotationChoiceModal}
        datasetId={id}
        projectId={projectId}
      />
    </div>
  );
}
