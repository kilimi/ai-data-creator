import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Upload, Tag, Edit, Trash2, Eye, EyeOff, Download, Square } from "lucide-react";
import { ClassStatistics } from "@/components/ClassStatistics";
import { Switch } from "@/components/ui/switch";
import { AnnotationSample, processCOCOAnnotations, AnnotationFile } from "@/utils/annotations";
import { AnnotationsUploadDialog } from "@/components/AnnotationsUploadDialog";
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
  className?: string;
  onShowAnnotationsChange?: (show: boolean, annotations: AnnotationSample[], annotationFiles?: AnnotationFile[]) => void;
  onImportAnnotations?: (files: File[]) => void;
  showAllAnnotationsOnGrid?: boolean;
  images?: Image[];
  
  currentPageImageIds?: string[]; // NEW: Current page image IDs
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
    images: Object.entries(file.imageMapping || {}).map(([imageId, fileName]) => ({
      id: parseInt(imageId),
      width: 640, // Default width
      height: 480, // Default height
      file_name: fileName,
      license: 1,
      flickr_url: "",
      coco_url: "",
      date_captured: ""
    })),
    categories,
    annotations: (file.samples || []).map((sample, index) => ({
      id: index + 1,
      image_id: parseInt(sample.imageId),
      category_id: categoryMap.get(sample.className) || 1,
      bbox: sample.bbox ? [
        sample.bbox[0] * 640,
        sample.bbox[1] * 480,
        sample.bbox[2] * 640,
        sample.bbox[3] * 480
      ] : [0, 0, 0, 0],
      area: sample.area || (sample.bbox ? sample.bbox[2] * sample.bbox[3] * 640 * 480 : 0),
      iscrowd: 0,
      segmentation: sample.segmentation || []
    }))
  };
}

export function AnnotationsContent({ 
  id, 
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
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingFromBackend, setIsLoadingFromBackend] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [renameClassDialog, setRenameClassDialog] = useState<{ isOpen: boolean; className: string; annotationId: string }>({ isOpen: false, className: '', annotationId: '' });
  const [dirtyAnnotationIds, setDirtyAnnotationIds] = useState<Set<string>>(new Set());
  const [tagsDialog, setTagsDialog] = useState<{ isOpen: boolean; annotationId: string; annotationName: string; currentTags: string[] }>({ isOpen: false, annotationId: '', annotationName: '', currentTags: [] });
  const [editingName, setEditingName] = useState<{ annotationId: string; newName: string } | null>(null);
  // Handler for renaming a class in an annotation file
  const markDirty = (annotationId: string) => {
    setDirtyAnnotationIds(prev => new Set(prev).add(annotationId));
  };
  const clearDirty = (annotationId: string) => {
    setDirtyAnnotationIds(prev => {
      const next = new Set(prev);
      next.delete(annotationId);
      return next;
    });
  };
  const handleRenameClass = async (annotationId: string, oldClassName: string, newClassName: string) => {
    try {
      const updatedFiles = annotationFiles.map(file => {
        if (file.id === annotationId) {
          // Update classStats
          const updatedClassStats = file.classStats?.map(stat =>
            stat.className === oldClassName ? { ...stat, className: newClassName } : stat
          );
          // Update samples
          const updatedSamples = file.samples?.map(sample =>
            sample.className === oldClassName ? { ...sample, className: newClassName } : sample
          );
          // Update classColors
          const updatedClassColors = { ...file.classColors };
          if (updatedClassColors[oldClassName]) {
            updatedClassColors[newClassName] = updatedClassColors[oldClassName];
            delete updatedClassColors[oldClassName];
          }
          return {
            ...file,
            classStats: updatedClassStats,
            samples: updatedSamples,
            classColors: updatedClassColors,
          };
        }
        return file;
      });
      // Mark as dirty
      markDirty(annotationId);
      let success = true;
      if (api) {
        const fileToUpdate = updatedFiles.find(file => file.id === annotationId);
        if (fileToUpdate) {
          const jsonContent = JSON.stringify(toCOCOFormat(fileToUpdate), null, 2);
          const updatedFile = new File([jsonContent], fileToUpdate.name, { type: 'application/json' });
          const response = await api.updateAnnotationContent(id, annotationId, updatedFile);
          if (!response.success) {
            success = false;
            throw new Error(response.error || "Failed to update annotation file on server");
          }
        }
      } else {
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      }
      if (success) {
        setAnnotationFiles(updatedFiles);
        if (selectedClass === oldClassName) {
          setSelectedClass(newClassName);
        }
        toast({
          title: "Class renamed",
          description: `Class \"${oldClassName}\" renamed to \"${newClassName}\".`,
        });
      }
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
    type: 'present' | 'missing';
    files: string[];
    annotationFileName: string;
  }>({ isOpen: false, type: 'present', files: [], annotationFileName: '' });
  
  const [editDialog, setEditDialog] = useState<{
    isOpen: boolean;
    annotationId: string;
    currentName: string;
    newName: string;
  }>({ isOpen: false, annotationId: '', currentName: '', newName: '' });
  
  // Auto-detect annotation type based on content
  const detectAnnotationType = (file: AnnotationFile): 'classification' | 'segmentation' | 'depth' => {
    // If type is explicitly set, use it
    if (file.type === 'classification') return 'classification';
    if (file.type === 'segmentation') return 'segmentation';
    if (file.type === 'depth') return 'depth';
    
    // Auto-detect based on samples content
    if (file.samples && file.samples.length > 0) {
      // Check if any annotation has segmentation data
      const hasSegmentation = file.samples.some(sample => 
        sample.segmentation && Array.isArray(sample.segmentation) && sample.segmentation.length > 0
      );
      if (hasSegmentation) return 'segmentation';
      
      // Check if annotations have meaningful bounding boxes (not [0,0,0,0])
      const hasMeaningfulBbox = file.samples.some(sample => 
        sample.bbox && Array.isArray(sample.bbox) && sample.bbox.length === 4 && 
        (sample.bbox[0] !== 0 || sample.bbox[1] !== 0 || sample.bbox[2] !== 0 || sample.bbox[3] !== 0)
      );
      if (hasMeaningfulBbox) return 'segmentation'; // Bounding boxes are part of segmentation/detection
      
      // If all bboxes are [0,0,0,0] or missing, it's classification
      const hasOnlyEmptyBbox = file.samples.every(sample => 
        !sample.bbox || 
        (Array.isArray(sample.bbox) && sample.bbox.length === 4 && 
         sample.bbox[0] === 0 && sample.bbox[1] === 0 && sample.bbox[2] === 0 && sample.bbox[3] === 0)
      );
      if (hasOnlyEmptyBbox) return 'classification';
    }
    
    // Check filename for hints
    if (file.name) {
      const nameLower = file.name.toLowerCase();
      if (nameLower.includes('classification') || nameLower.includes('class')) return 'classification';
      if (nameLower.includes('segmentation') || nameLower.includes('seg')) return 'segmentation';
      if (nameLower.includes('depth')) return 'depth';
    }
    
    // Check content for COCO classification patterns (for saved classifications)
    if ((file as any).content) {
      const content = (file as any).content;
      // COCO format with only category_ids and no bbox/segmentation
      if (content.annotations && Array.isArray(content.annotations)) {
        const hasOnlyCategories = content.annotations.every((ann: any) => 
          ann.category_id && !ann.bbox && !ann.segmentation
        );
        if (hasOnlyCategories && content.annotations.length > 0) return 'classification';
      }
    }
    
    // Default fallback - if we can't determine, assume depth
    return 'depth';
  };

  const { api } = useApi();
  const { toast } = useToast();
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

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
        console.log(`Saving tags for annotation ${annotationId}:`, tags);
        const response = await api.updateAnnotationTags(id, annotationId, tags);
        if (!response.success) {
          success = false;
          throw new Error(response.error || "Failed to save tags on server");
        }
      } else {
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      }

      if (success) {
        setAnnotationFiles(updatedFiles);
        // Also update localStorage for local persistence (backup)
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      }
    } catch (error) {
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

  // Sync filtered annotations with annotation files when they change
  useEffect(() => {
    setFilteredAnnotationFiles(annotationFiles);
  }, [annotationFiles]);

  const handleMergeClasses = (annotationId: string, sources: string[], mergedName: string) => {
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
          updatedClassStats.push({ className: mergedName, count: mergedCount, color: mergedColor || '#ea384c', ...(mergedOpacity !== undefined ? { opacity: mergedOpacity } : {}) });
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
    markDirty(annotationId);
    toast({ title: "Classes merged", description: `Merged [${sources.join(", ")}] into '${mergedName}'.` });
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
      // Get the filename from the COCO image ID using the stored mapping
      const filename = annotationFile.imageMapping![annotation.imageId];
      if (filename && filenameToImageId[filename]) {
        mappedCount++;
        
        // NEW: Re-scale annotations based on actual image dimensions
        const image = imagesMemo.find(img => img.fileName === filename);
        const cocoImage = (annotationFile as any).cocoImages?.find((img: any) => img.id.toString() === annotation.imageId.toString());

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
          };
        }

        // Fallback to original behavior if scaling info is not available
        return {
          ...annotation,
          imageId: filenameToImageId[filename]
        };
      }
      return annotation;
    });
    
    return mappedAnnotations;
  }

  // Update visible annotations based on currently visible files
  const updateVisibleAnnotations = useCallback(() => {
    const allVisibleAnnotations: AnnotationSample[] = [];
    annotationFiles.forEach(file => {
      if (visibleAnnotations.has(file.id) && file.samples) {
        // Map the annotation image IDs to actual uploaded image IDs
        const mappedSamples = mapAnnotationImageIds(file.samples, file);
        // Attach the annotation file name to each sample
        const samplesWithFileName = mappedSamples.map(sample => ({
          ...sample,
          annotationFileName: file.name
        }));
        allVisibleAnnotations.push(...samplesWithFileName);
      }
    });
    if (onShowAnnotationsChange) {
      // If showAllAnnotationsOnGrid is true, always show all annotations
      if (showAllAnnotationsOnGrid) {
        const allAnnotations = annotationFiles.flatMap(file => {
          const mappedSamples = mapAnnotationImageIds(file.samples || [], file);
          return mappedSamples.map(sample => ({
            ...sample,
            annotationFileName: file.name
          }));
        });
        onShowAnnotationsChange(allAnnotations.length > 0, allAnnotations, annotationFiles);
      } else {
        onShowAnnotationsChange(allVisibleAnnotations.length > 0, allVisibleAnnotations, annotationFiles);
      }
    }
  }, [annotationFiles, visibleAnnotations, imagesMemo, showAllAnnotationsOnGrid]); // REMOVE onShowAnnotationsChange from deps
  
  // Update visible annotations whenever visibility, annotation files, or images change
  useEffect(() => {
    updateVisibleAnnotations();
  }, [annotationFiles, visibleAnnotations, imagesMemo, showAllAnnotationsOnGrid]); // REMOVE updateVisibleAnnotations from deps to prevent infinite loop

  // Load full annotation data for a specific file (when user needs more than preview)
  const loadFullAnnotationData = async (annotationId: string) => {
    if (!api) {
      toast({
        title: "Backend required",
        description: "Full data loading requires backend connection.",
        variant: "destructive"
      });
      return;
    }

    try {
      const contentResponse = await api.getAnnotationContent(id, annotationId);
      if (contentResponse && contentResponse.success && contentResponse.data.content) {
        // Create a mock File object to process the COCO data
        const mockFile = new File([contentResponse.data.content], `annotation_${annotationId}.json`, { type: 'application/json' });
        
        // Re-process the full COCO annotation file
        const result = await processCOCOAnnotations(mockFile, id);
        
        // Update the specific file with full data
        setAnnotationFiles(prevFiles => {
          return prevFiles.map(file => {
            if (file.id === annotationId) {
              return {
                ...file,
                samples: result.samples.map(sample => ({
                  ...sample,
                  isVisible: file.isVisible,
                  showBboxes: file.showBboxes,
                  annotationFileName: file.name
                })),
                totalSampleCount: result.samples.length,
                previewOnly: false, // No longer in preview mode
                isLargeDataset: false
              };
            }
            return file;
          });
        });

        toast({
          title: "Full data loaded",
          description: `Loaded ${result.samples.length} annotations for ${annotationFiles.find(f => f.id === annotationId)?.name}`,
        });
      }
    } catch (error) {
      console.error('Error loading full annotation data:', error);
      toast({
        title: "Error loading full data",
        description: error instanceof Error ? error.message : "Failed to load full annotation data",
        variant: "destructive"
      });
    }
  };

  // New function to load annotations for current page images
  const loadAnnotationsForCurrentPage = useCallback(async (annotationId: string, currentPageImageIds: string[]) => {
    console.log(`Loading annotations for file ${annotationId} with ${currentPageImageIds.length} current page images`);
    
    if (!api) {
      toast({
        title: "Backend required",
        description: "Page-specific annotation loading requires backend connection.",
        variant: "destructive"
      });
      return;
    }

    try {
      const contentResponse = await api.getAnnotationContent(id, annotationId);
      if (contentResponse && contentResponse.success && contentResponse.data.content) {
        // Create a mock File object to process the COCO data
        const mockFile = new File([contentResponse.data.content], `annotation_${annotationId}.json`, { type: 'application/json' });
        
        // Re-process the full COCO annotation file
        const result = await processCOCOAnnotations(mockFile, id);
        
        // Filter annotations to only include those for current page images
        const currentPageSamples = result.samples.filter(sample => {
          // Map annotation image ID to actual image ID using imageMapping
          const file = annotationFiles.find(f => f.id === annotationId);
          if (!file?.imageMapping) return false;
          
          const filename = file.imageMapping[sample.imageId];
          if (!filename) return false;
          
          // Find the actual image ID for this filename
          const image = imagesMemo.find(img => img.fileName === filename);
          return image && currentPageImageIds.includes(image.id);
        });
        
        // Update the specific file with current page data
        setAnnotationFiles(prevFiles => {
          return prevFiles.map(file => {
            if (file.id === annotationId) {
              // Merge current page samples with existing samples, avoiding duplicates
              const existingSamples = file.samples || [];
              const existingImageIds = new Set(existingSamples.map(s => s.imageId));
              
              const newSamples = currentPageSamples.filter(sample => {
                // Map to actual image ID for comparison
                const filename = file.imageMapping?.[sample.imageId];
                if (!filename) return false;
                const image = imagesMemo.find(img => img.fileName === filename);
                return image && !existingImageIds.has(image.id);
              });
              
              const mergedSamples = [
                ...existingSamples,
                ...newSamples.map(sample => ({
                  ...sample,
                  isVisible: file.isVisible,
                  showBboxes: file.showBboxes,
                  annotationFileName: file.name
                }))
              ];
              
              return {
                ...file,
                samples: mergedSamples,
                // Keep preview mode but indicate we have current page data
                currentPageLoaded: true
              };
            }
            return file;
          });
        });

        if (currentPageSamples.length > 0) {
          toast({
            title: "Current page annotations loaded",
            description: `Loaded ${currentPageSamples.length} annotations for current page images`,
          });
        }
      }
    } catch (error) {
      console.error('Error loading current page annotations:', error);
      toast({
        title: "Error loading current page data",
        description: error instanceof Error ? error.message : "Failed to load annotations for current page",
        variant: "destructive"
      });
    }
  }, [api, id, annotationFiles, imagesMemo, toast]);

  // Auto-load annotations for current page when page changes
  useEffect(() => {
    if (currentPageImageIds.length > 0 && api) {
      // Find annotation files that are in preview mode and visible
      const previewFilesNeedingLoad = annotationFiles.filter(file => 
        (file as any).previewOnly && 
        visibleAnnotations.has(file.id) &&
        !(file as any).currentPageLoaded
      );
      
      if (previewFilesNeedingLoad.length > 0) {
        console.log(`Auto-loading annotations for ${previewFilesNeedingLoad.length} preview files. Current page has ${currentPageImageIds.length} images.`);
      }
      
      // Load annotations for each preview file
      previewFilesNeedingLoad.forEach(file => {
        loadAnnotationsForCurrentPage(file.id, currentPageImageIds);
      });
    }
  }, [currentPageImageIds, annotationFiles, visibleAnnotations, api, loadAnnotationsForCurrentPage]);

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
            annotationFileName: file.name
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
  }, [annotationFiles, visibleAnnotations, imagesMemo]); // REMOVED onShowAnnotationsChange from dependencies
  
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
            // Store total count but only relevant samples
            totalSampleCount: file.samples?.length || 0,
            samples: limitedSamples,
            isLargeDataset: true, // Flag to indicate this is a partial dataset
            previewOnly: true,
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
          totalSampleCount: file.samples?.length || 0,
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
            totalSampleCount: file.samples?.length || 0,
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
              totalSampleCount: file.samples?.length || 0,
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

  const handleToggleAnnotationVisibility = (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const file = annotationFiles.find(f => f.id === annotationId);
    if (!file) return;
    
    // Get the present files count
    const { presentFiles } = getImageFileLists(file);
    
    // If trying to make annotations visible but there are no present images, show a warning
    if (!visibleAnnotations.has(annotationId) && presentFiles.length === 0) {
      toast({
        title: "Cannot show annotations",
        description: "There are no matching images in the dataset for these annotations.",
        variant: "destructive"
      });
      return;
    }
    
    const newVisibleAnnotations = new Set(visibleAnnotations);
    const isVisible = !visibleAnnotations.has(annotationId);
    
    if (visibleAnnotations.has(annotationId)) {
      newVisibleAnnotations.delete(annotationId);
    } else {
      newVisibleAnnotations.add(annotationId);
    }
    
    setVisibleAnnotations(newVisibleAnnotations);
    
    // Save visibility state to localStorage
    localStorage.setItem(`annotation_visibility_${id}`, JSON.stringify(Array.from(newVisibleAnnotations)));
    
    // Update the annotation files to mark visibility AND update individual sample visibility
    const updatedFiles = annotationFiles.map(file => 
      file.id === annotationId 
        ? { 
            ...file, 
            isVisible: isVisible,
            samples: file.samples?.map(sample => ({
              ...sample,
              isVisible: isVisible,
              annotationFileName: file.name
            }))
          }
        : file
    );
    
    setAnnotationFiles(updatedFiles);
    
    // Save updated files to localStorage with quota handling
    saveAnnotationFilesToLocalStorage(updatedFiles);
  };


  const handleToggleAnnotationBboxes = (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const file = annotationFiles.find(f => f.id === annotationId);
    if (!file) return;
    
    // Toggle individual bbox visibility for this annotation file
    const newBboxVisibility = !file.showBboxes;
    
    // Update the annotation files to toggle bbox visibility for all samples in this file
    const updatedFiles = annotationFiles.map(f => 
      f.id === annotationId 
        ? { 
            ...f, 
            showBboxes: newBboxVisibility,
            samples: f.samples?.map(sample => ({
              ...sample,
              showBboxes: newBboxVisibility,
              annotationFileName: f.name
            }))
          }
        : f
    );
    
    setAnnotationFiles(updatedFiles);
    
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
      // Check if this is a classification file stored only in localStorage
      const isClassificationFile = detectAnnotationType(fileToDelete) === 'classification';
      
      if (isClassificationFile) {
        // Delete from saved_annotations localStorage
        const savedAnnotations = localStorage.getItem(`saved_annotations_${id}`);
        if (savedAnnotations) {
          const annotationsList = JSON.parse(savedAnnotations);
          const updatedList = annotationsList.filter((annotation: any) => annotation.id !== annotationId);
          localStorage.setItem(`saved_annotations_${id}`, JSON.stringify(updatedList));
        }
        
        // Update the UI by removing the classification file
        const updatedFiles = annotationFiles.filter(file => file.id !== annotationId);
        setAnnotationFiles(updatedFiles);
        
        toast({
          title: "Classification deleted",
          description: `Classification annotation "${fileToDelete.name}" has been deleted.`,
        });
      } else {
        // Delete from backend first (for regular annotation files)
        if (api) {
          const response = await api.deleteAnnotation(id, annotationId);
          if (!response.success) {
            throw new Error(response.error || "Failed to delete annotation file");
          }
          
          // If backend deletion was successful, refresh from backend
          await loadAnnotationFilesFromBackend();
        } else {
          // If no API, update the UI manually
          const updatedFiles = annotationFiles.filter(file => file.id !== annotationId);
          setAnnotationFiles(updatedFiles);
          localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
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
        description: "Annotation file has been removed.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete annotation file",
        variant: "destructive",
      });
    }
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
    if (file && detectAnnotationType(file) === 'classification') {
      // Navigate to classification page with the dataset ID and annotation file ID
      navigate(`/datasets/${id}/annotate/classification?annotationId=${annotationId}`);
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

  const handleDownloadAnnotation = (annotationId: string, e: React.MouseEvent) => {
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
      // Extract unique categories from samples
      const categoryMap = new Map<string, number>();
      let categoryId = 1;
      
      // Build category mapping
      file.samples?.forEach(sample => {
        if (!categoryMap.has(sample.className)) {
          categoryMap.set(sample.className, categoryId++);
        }
      });

      // Create categories array
      const categories = Array.from(categoryMap.entries()).map(([name, id]) => ({
        id,
        name,
        supercategory: ""
      }));

      // Create a COCO format JSON structure for download
      const cocoData = {
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
        images: Object.entries(file.imageMapping || {}).map(([imageId, fileName]) => ({
          id: parseInt(imageId),
          width: 640, // Default width - could be enhanced to store actual dimensions
          height: 480, // Default height - could be enhanced to store actual dimensions
          file_name: fileName,
          license: 1,
          flickr_url: "",
          coco_url: "",
          date_captured: ""
        })),
        categories,
        annotations: file.samples?.map((sample, index) => ({
          id: index + 1,
          image_id: parseInt(sample.imageId),
          category_id: categoryMap.get(sample.className) || 1,
          bbox: sample.bbox ? [
            sample.bbox[0] * 640, // Convert normalized to pixel coordinates
            sample.bbox[1] * 480,
            sample.bbox[2] * 640,
            sample.bbox[3] * 480
          ] : [0, 0, 0, 0],
          area: sample.area || (sample.bbox ? sample.bbox[2] * sample.bbox[3] * 640 * 480 : 0),
          iscrowd: 0,
          segmentation: sample.segmentation || []
        })) || []
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
        title: "Download started",
        description: `Downloading ${file.name} as COCO JSON format.`,
      });
    } catch (error) {
      console.error('Error downloading annotation:', error);
      toast({
        title: "Download failed",
        description: "Failed to export annotation file.",
        variant: "destructive",
      });
    }
  };

  const handleImportClick = () => {
    setShowUploadDialog(true);
  };  // Get present and missing image file names for an annotation file
  const getImageFileLists = (file: AnnotationFile) => {
    if (!file.imageMapping) {
      // Fallback for emergency mode without imageMapping or files without image data
      return { presentFiles: [], missingFiles: [] };
    }
    
    // For large datasets in preview mode, we should use the full imageMapping
    // instead of only the samples (which might be limited to first 20)
    // Get all unique image IDs from the complete imageMapping
    const allImageIds = Object.keys(file.imageMapping);
    
    // Create a set of uploaded image file names for quick lookup
    const uploadedImageNames = new Set(imagesMemo.map(img => img.fileName));
    
    const presentFiles: string[] = [];
    const missingFiles: string[] = [];
    
    allImageIds.forEach(imageId => {
      // Get the actual filename from the COCO images array
      const fileName = file.imageMapping![imageId];
      
      if (fileName) {
        // Check if this image file exists in the current dataset
        if (uploadedImageNames.has(fileName)) {
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

  const handleShowPresentImages = (file: AnnotationFile) => {
    const { presentFiles } = getImageFileLists(file);
    setImageStatusDialog({
      isOpen: true,
      type: 'present',
      files: presentFiles,
      annotationFileName: file.name
    });
  };

  const handleShowMissingImages = (file: AnnotationFile) => {
    const { missingFiles } = getImageFileLists(file);
    setImageStatusDialog({
      isOpen: true,
      type: 'missing',
      files: missingFiles,
      annotationFileName: file.name
    });
  };

  const handleFilesSelected = async (files: File[], type?: string) => {
    console.log('AnnotationsContent.handleFilesSelected called with:', files.map(f => f.name), 'type:', type);
    setIsLoading(true);
    
    try {
      const successfulImports: string[] = [];
      const failedImports: Array<{ fileName: string; error: string }> = [];
      
      for (const file of files) {
        try {
          // Validate file type
          if (!file.name.toLowerCase().endsWith('.json')) {
            throw new Error('Only JSON files are supported for COCO annotations');
          }
          
          // Process the COCO annotation file
          const result = await processCOCOAnnotations(file, id);
          
          // Set all annotation samples to be hidden by default
          const samples = result.samples.map(sample => ({
            ...sample,
            isVisible: false,
            showBboxes: false, // Individual bbox visibility disabled by default
            annotationFileName: file.name
          }));
          
          let fileId = Math.random().toString(36).substring(2, 11); // Default fallback ID
          
          // Try to import via API to get the proper file ID
          if (api) {
            try {
              console.log(`Making API call to import ${file.name} with type ${type}`);
              const apiResult = await api.importAnnotations(id, file, type);
              console.log(`API result for ${file.name}:`, apiResult);
              if (apiResult && apiResult.success && apiResult.data.file_id) {
                // Use the file ID returned by the backend
                fileId = apiResult.data.file_id;
                console.log(`Backend assigned file ID: ${fileId} for ${file.name}`);
              } else {
                console.warn('Backend import succeeded but no file_id returned, using fallback ID');
              }
            } catch (apiError) {
              console.warn('Backend import failed, using fallback ID:', apiError);
              // Don't fail the whole process if backend fails - use fallback ID
            }
          } else {
            console.warn('No API available, using fallback ID');
          }
          
          // Create annotation file record with the backend-provided ID
          const annotationFile: AnnotationFile = {
            id: fileId,
            name: file.name,
            date: new Date().toISOString().split('T')[0],
            format: "COCO",
            type: type && type !== 'any' ? type as 'classification' | 'segmentation' | 'depth' : undefined,
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
            tags: [] // Initialize with empty tags array
          };              console.log(`Creating annotation file with ID: ${fileId} for file: ${file.name}`);
          
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
          
          successfulImports.push(file.name);
          
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
        toast({
          title: "Annotations imported",
          description: `Successfully imported ${successfulImports.length} annotation file(s): ${successfulImports.join(', ')}`,
        });
        
        // If API is available, refresh from backend to get the updated list
        if (api) {
          console.log('Refreshing annotation files from backend after successful import');
          await loadAnnotationFilesFromBackend();
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

  // Load existing annotation files from backend
  const loadAnnotationFilesFromBackend = async () => {
    if (!api || isLoadingFromBackend) return;
    
    setIsLoadingFromBackend(true);
    try {
      const response = await api.getAnnotations(id);
      if (response && response.success && response.data) {
        // Convert backend annotation files to frontend format and fetch their content
        const processedFiles = [];
        
        for (const file of response.data) {
          try {
            // Fetch the file content to re-process it
            const contentResponse = await api.getAnnotationContent(id, file.id);
            
            if (contentResponse && contentResponse.success && contentResponse.data.content) {
              // Create a mock File object to process the COCO data
              const mockFile = new File([contentResponse.data.content], file.name, { type: 'application/json' });
              
              // Re-process the COCO annotation file
              const result = await processCOCOAnnotations(mockFile, id);
              
              // Set all annotation samples to be hidden by default
              const samples = result.samples.map(sample => ({
                ...sample,
                isVisible: false,
                showBboxes: false, // Individual bbox visibility disabled by default
                annotationFileName: file.name
              }));
              
              // Detect if this is a classification annotation by checking if all annotations only have category_id (no bbox/segmentation)
              const isClassification = contentResponse.data.content ? (() => {
                try {
                  const cocoData = JSON.parse(contentResponse.data.content);
                  if (cocoData.annotations && Array.isArray(cocoData.annotations) && cocoData.annotations.length > 0) {
                    // Check if annotations have no bbox or segmentation data (classification only)
                    const hasOnlyCategories = cocoData.annotations.every((ann: any) => 
                      ann.category_id && !ann.bbox && !ann.segmentation
                    );
                    return hasOnlyCategories;
                  }
                  // If no annotations, check filename for classification indicators
                  return file.name && (file.name.toLowerCase().includes('classification') || file.name.toLowerCase().includes('class'));
                } catch {
                  // If parsing fails, check filename for classification indicators
                  return file.name && (file.name.toLowerCase().includes('classification') || file.name.toLowerCase().includes('class'));
                }
              })() : (file.name && (file.name.toLowerCase().includes('classification') || file.name.toLowerCase().includes('class')));
              
              // For large datasets from backend, also implement preview mode
              const isLargeDataset = samples.length > 1000;
              
              const annotationFile: AnnotationFile = {
                id: file.id, // Use the backend-provided ID
                name: file.name || file.filename,
                date: file.created_at ? new Date(file.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                format: file.format || 'COCO',
                type: isClassification ? 'classification' : undefined,
                classCount: result.stats.length,
                imageCount: result.totalImageCount,
                matchedImageCount: result.matchedImageCount,
                datasetId: id,
                classStats: result.stats,
                samples: isLargeDataset ? samples.slice(0, 20) : samples, // Preview mode for large datasets
                isVisible: false,
                showBboxes: false, // Individual bbox visibility disabled by default
                classColors: result.classColors,
                imageMapping: result.imageMapping,
                tags: file.tags || [], // Use tags from backend response
                // Add preview mode indicators for large datasets
                ...(isLargeDataset && {
                  totalSampleCount: samples.length,
                  previewOnly: true,
                  isLargeDataset: true
                })
              };
              
              processedFiles.push(annotationFile);
            } else {
              // Fallback if content can't be fetched - create basic structure
              // Try to detect classification from filename or format
              const isClassification = file.name && (file.name.includes('classification') || file.name.includes('class'));
              
              const annotationFile = {
                id: file.id,
                name: file.name || file.filename,
                date: file.created_at ? new Date(file.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                format: file.format || 'COCO',
                type: isClassification ? 'classification' : undefined,
                classCount: file.category_count || 0,
                imageCount: file.image_count || 0,
                matchedImageCount: 0,
                datasetId: id,
                classStats: [],
                samples: [],
                isVisible: false,
                showBboxes: false, // Individual bbox visibility disabled by default
                classColors: {},
                imageMapping: {},
                tags: file.tags || [] // Use tags from backend response
              };
              
              processedFiles.push(annotationFile);
            }
            
          } catch (error) {
            console.warn(`Failed to process annotation file ${file.name}:`, error);
            // Create basic structure as fallback
            // Try to detect classification from filename or format
            const isClassification = file.name && (file.name.includes('classification') || file.name.includes('class'));
            
            const annotationFile = {
              id: file.id,
              name: file.name || file.filename,
              date: file.created_at ? new Date(file.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
              format: file.format || 'COCO',
              type: isClassification ? 'classification' : undefined,
              classCount: file.category_count || 0,
              imageCount: file.image_count || 0,
              matchedImageCount: 0,
              datasetId: id,
              classStats: [],
              samples: [],
              isVisible: false,
              showBboxes: false, // Individual bbox visibility disabled by default
              classColors: {},
              imageMapping: {},
              tags: file.tags || [] // Use tags from backend response
            };
            
            processedFiles.push(annotationFile);
          }
        }
        
        // Sort by date (newest first) before setting
        processedFiles.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          return dateB.getTime() - dateA.getTime();
        });
        
        // Load saved classifications and merge them with backend files
        const savedClassifications = loadSavedClassifications();
        
        // Filter out classifications that are already in backend files (to avoid duplicates)
        const backendClassificationIds = new Set(
          processedFiles.filter(file => detectAnnotationType(file) === 'classification').map(file => file.id)
        );
        
        const filteredSavedClassifications = savedClassifications.filter(classification => 
          !backendClassificationIds.has(classification.id)
        );
        
        const combined = [...filteredSavedClassifications, ...processedFiles];
        
        // Sort by date (newest first)
        combined.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          return dateB.getTime() - dateA.getTime();
        });
        
        setAnnotationFiles(combined);
        console.log(`Loaded and processed ${processedFiles.length} annotation files from backend and ${filteredSavedClassifications.length} classifications from localStorage`);
        
        // Check if any files were loaded in preview mode and notify user
        const previewFiles = processedFiles.filter(file => file.previewOnly);
        if (previewFiles.length > 0) {
          const fileNames = previewFiles.map(file => file.name).join(', ');
          toast({
            title: "Large datasets loaded in preview mode",
            description: `${previewFiles.length} file(s) (${fileNames}) show first 20 annotations only. Click "Load Full Data" to see all annotations.`,
          });
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
            showBboxes: file.showBboxes || false,
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
          
          const previewFiles = parsed.map((file: any) => ({
            ...file,
            samples: file.samples?.map((sample: any) => ({
              ...sample,
              showBboxes: sample.showBboxes ?? false,
              annotationFileName: sample.annotationFileName || file.name
            })) || []
          }));
          
          setAnnotationFiles(previewFiles);
          
          toast({
            title: "Large dataset loaded",
            description: `Showing preview data. ${parsed.reduce((sum: number, f: any) => sum + (f.totalSampleCount || 0), 0)} total annotations available.`,
            variant: "default"
          });
          
        } else {
          // Normal mode: Complete data for small datasets
          const annotationsWithFileNames = parsed.map((file: AnnotationFile) => {
            return {
              ...file,
              showBboxes: file.showBboxes ?? false,
              samples: file.samples?.map(sample => ({
                ...sample,
                showBboxes: (sample as any).showBboxes ?? false,
                annotationFileName: (sample as any).annotationFileName || file.name
              }))
            };
          });
          
          setAnnotationFiles(annotationsWithFileNames);
        }
        
        // Sort by date (newest first) before setting
        setAnnotationFiles(prev => {
          const sorted = [...prev].sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB.getTime() - dateA.getTime();
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

  // Load annotations on component mount
  useEffect(() => {
    if (api) {
      // Clear localStorage when using backend to prevent conflicts
      localStorage.removeItem(`annotations_${id}`);
      loadAnnotationFilesFromBackend(); // This now handles classifications too
    } else {
      loadAnnotationFilesFromLocalStorage();
      
      // Always load saved classifications from localStorage when no API
      const savedClassifications = loadSavedClassifications();
      if (savedClassifications.length > 0) {
        setAnnotationFiles(prev => {
          // Remove any existing classification files to avoid duplicates
          const nonClassificationFiles = prev.filter(file => detectAnnotationType(file) !== 'classification');
          const combined = [...savedClassifications, ...nonClassificationFiles];
          // Sort by date (newest first)
          combined.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB.getTime() - dateA.getTime();
          });
          return combined;
        });
      }
    }
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

  // Periodically check for new saved classifications (only when no API)
  useEffect(() => {
    if (api) return; // Don't run periodic checks when using backend
    
    const interval = setInterval(() => {
      const savedClassifications = loadSavedClassifications();
      if (savedClassifications.length > 0) {
        setAnnotationFiles(prev => {
          // Remove any existing classification files to avoid duplicates
          const nonClassificationFiles = prev.filter(file => detectAnnotationType(file) !== 'classification');
          const combined = [...savedClassifications, ...nonClassificationFiles];
          // Sort by date (newest first)
          combined.sort((a, b) => {
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB.getTime() - dateA.getTime();
          });
          return combined;
        });
      }
    }, 2000); // Check every 2 seconds
    
    return () => clearInterval(interval);
  }, [id, api]);

  const selectedAnnotationData = annotationFiles.find(file => file.id === selectedAnnotation);

  const handleDeleteClass = async (annotationId: string, className: string) => {
    try {
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
      // Mark as dirty
      markDirty(annotationId);
      let success = true;
      if (api) {
        const fileToUpdate = updatedFiles.find(file => file.id === annotationId);
        if (fileToUpdate) {
          const jsonContent = JSON.stringify(toCOCOFormat(fileToUpdate), null, 2);
          const updatedFile = new File([jsonContent], fileToUpdate.name, { type: 'application/json' });
          const response = await api.updateAnnotationContent(id, annotationId, updatedFile);
          if (!response.success) {
            success = false;
            throw new Error(response.error || "Failed to update annotation file on server");
          }
        }
      } else {
        localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
      }
      if (success) {
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
        const jsonContent = JSON.stringify(toCOCOFormat(fileToSave), null, 2);
        const updatedFile = new File([jsonContent], fileToSave.name, { type: 'application/json' });
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
    // Create a deep copy and new name
    const newId = Math.random().toString(36).substring(2, 11);
    const baseName = file.name.replace(/(\.[^/.]+)?$/, "");
    let copyIndex = 2;
    let newName = `${baseName}_copy`;
    // Ensure unique name
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
    let success = true;
    if (api) {
      try {
        // Upload to backend
        const jsonContent = JSON.stringify(toCOCOFormat(duplicatedFile), null, 2);
        const uploadFile = new File([jsonContent], newName, { type: 'application/json' });
        const response = await api.importAnnotations(id, uploadFile);
        if (!response.success) {
          success = false;
          throw new Error(response.error || "Failed to upload duplicated annotation file");
        }
        // Refresh annotation files from backend
        await loadAnnotationFilesFromBackend();
      } catch (error) {
        success = false;
        toast({
          title: "Duplicate failed",
          description: error instanceof Error ? error.message : "Failed to duplicate annotation file.",
          variant: "destructive",
        });
      }
    } else {
      // Add to localStorage
      const updatedFiles = [...annotationFiles, duplicatedFile];
      setAnnotationFiles(updatedFiles);
      localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
    }
    if (success) {
      toast({
        title: "Annotation duplicated",
        description: `Created a copy: ${newName}`,
      });
    }
  };
  
  return (
    <div className={`h-full flex flex-col min-h-0 ${className}`}>
      <div className="flex-shrink-0 flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-semibold mb-1">Annotations</h2>
          <p className="text-sm text-muted-foreground">
            {filteredAnnotationFiles.length === annotationFiles.length 
              ? `${annotationFiles.length} annotation files` 
              : `${filteredAnnotationFiles.length} of ${annotationFiles.length} annotation files`
            } • {visibleAnnotations.size} visible on images
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            className="border-gray-700 bg-gray-800 hover:bg-gray-700"
            onClick={handleImportClick}
            disabled={isLoading}
          >
            <Upload className="w-4 h-4 mr-2" />
            {isLoading ? "Importing..." : "Import Annotations"}
          </Button>
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
        {filteredAnnotationFiles
          .sort((a, b) => {
            // Sort by date (newest first)
            const dateA = new Date(a.date);
            const dateB = new Date(b.date);
            return dateB.getTime() - dateA.getTime();
          })
          .map((file) => (
              <div key={file.id} className="border border-gray-700 rounded-lg overflow-hidden">
                {/* Main annotation row */}
                <div 
                  className={`cursor-pointer p-4 hover:bg-gray-800/50 transition-colors ${selectedAnnotation === file.id ? 'bg-gray-800' : ''}`}
                  onClick={() => handleAnnotationClick(file.id)}
                >
                   <div className="flex items-center justify-between">
                     <div className="flex-1">
                       <div className="flex items-center gap-2 group">
                         {editingName?.annotationId === file.id ? (
                           <div className="flex items-center gap-2 flex-1">
                             <Input
                               value={editingName.newName}
                               onChange={(e) => setEditingName({ ...editingName, newName: e.target.value })}
                               onKeyDown={handleNameKeyDown}
                               onBlur={handleSaveEditName}
                               className="font-medium bg-gray-800 border-gray-600 text-white h-6 px-2 text-sm"
                               autoFocus
                               onClick={(e) => e.stopPropagation()}
                             />
                             <Button
                               variant="ghost"
                               size="sm"
                               className="h-6 w-6 p-0 text-green-400 hover:text-green-300"
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
                               className="h-6 w-6 p-0 text-gray-400 hover:text-gray-300"
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
                               {/* Show preview indicator for large datasets */}
                               {(file as any).previewOnly && (
                                 <Badge
                                   variant="secondary"
                                   className="text-xs bg-orange-500/20 text-orange-300 border-orange-500"
                                   title={`Preview mode: Showing first 20 of ${(file as any).totalSampleCount || 0} annotations`}
                                 >
                                   Preview
                                 </Badge>
                               )}
                               {(file as any).emergencyMode && (
                                 <Badge
                                   variant="secondary"
                                   className="text-xs bg-red-500/20 text-red-300 border-red-500"
                                   title="Emergency mode: Minimal data only"
                                 >
                                   Limited
                                 </Badge>
                               )}
                             </div>
                             <Button
                               variant="ghost"
                               size="sm"
                               className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-300"
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
                            {new Date(file.date).toLocaleDateString()} • {file.classCount} classes • {file.format}
                            {/* Show total annotation count for preview mode */}
                            {(file as any).totalSampleCount && (file as any).previewOnly && (
                              <> • {(file as any).totalSampleCount} annotations</>
                            )}
                          </span>
                          <Badge 
                            variant="secondary" 
                            className={`text-xs capitalize ${
                              detectAnnotationType(file) === 'classification'
                                ? 'cursor-pointer hover:bg-blue-600 hover:text-white transition-colors bg-blue-500/20 text-blue-300 border-blue-500' 
                                : detectAnnotationType(file) === 'segmentation'
                                ? 'bg-green-500/20 text-green-300 border-green-500'
                                : 'bg-purple-500/20 text-purple-300 border-purple-500' // depth
                            }`}
                            onClick={(e) => {
                              if (detectAnnotationType(file) === 'classification') {
                                handleEditClassificationAnnotation(file.id, e);
                              }
                            }}
                            title={
                              detectAnnotationType(file) === 'classification'
                                ? 'Click to edit classification annotations' 
                                : `Type: ${detectAnnotationType(file)}`
                            }
                          >
                            {detectAnnotationType(file)}
                          </Badge>
                        </div>
                        {/* Tags display */}
                        {file.tags && file.tags.length > 0 && (
                          <div className="flex items-center gap-1 mt-2">
                            {file.tags.slice(0, 3).map((tag) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="text-xs bg-blue-600/20 text-blue-300 border-blue-600/30"
                              >
                                <Tag className="h-3 w-3 mr-1" />
                                {tag}
                              </Badge>
                            ))}
                            {file.tags.length > 3 && (
                              <Badge
                                variant="secondary"
                                className="text-xs bg-gray-600/20 text-gray-400 border-gray-600/30"
                              >
                                +{file.tags.length - 3} more
                              </Badge>
                            )}
                          </div>
                        )}
                     </div>
                    <div className="flex items-center gap-4">                      {/* Images count */}
                      <div className="flex items-center gap-2 text-sm">
                        {(() => {
                          // Check if this is emergency mode without imageMapping
                          if ((file as any).noImageMapping || ((file as any).emergency && !file.imageMapping)) {
                            // Emergency mode without image mapping - show total count only
                            const totalCount = file.imageCount || 0;
                            return (
                              <>
                                <span className="text-gray-400" title="Image matching unavailable in emergency mode">
                                  ? / {totalCount}
                                </span>
                                <span className="text-xs text-amber-300" title="Connect to backend for image matching">
                                  (no matching data)
                                </span>
                              </>
                            );
                          }
                          
                          const { presentFiles, missingFiles } = getImageFileLists(file);
                          const currentPresentCount = presentFiles.length;
                          const currentMissingCount = missingFiles.length;
                          const totalCount = currentPresentCount + currentMissingCount;
                          
                          return (
                            <>
                              <button
                                className={`hover:underline cursor-pointer ${currentPresentCount > 0 ? 'text-blue-300 hover:text-blue-200' : 'text-gray-500'}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleShowPresentImages(file);
                                }}
                                title="Click to see present image files"
                              >
                                {currentPresentCount}
                              </button>
                              <span className="text-gray-500">/</span>
                              <span className="text-gray-400">{totalCount}</span>
                              {currentMissingCount > 0 && (
                                <button
                                  className="text-amber-300 text-xs hover:text-amber-200 hover:underline cursor-pointer ml-2"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleShowMissingImages(file);
                                  }}
                                  title="Click to see missing image files"
                                >
                                  ({currentMissingCount} missing)
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      {/* Visibility toggles */}
                      <div className="flex gap-1">
                        {/* Individual segmentation masks toggle */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${visibleAnnotations.has(file.id) ? 'text-blue-400' : 'text-gray-500'}`}
                          onClick={(e) => handleToggleAnnotationVisibility(file.id, e)}
                          title={visibleAnnotations.has(file.id) ? "Hide segmentation masks" : "Show segmentation masks"}
                        >
                          {visibleAnnotations.has(file.id) ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </Button>
                        
                        {/* Individual bounding boxes toggle */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${file.showBboxes ? 'text-blue-400' : 'text-gray-500'}`}
                          onClick={(e) => handleToggleAnnotationBboxes(file.id, e)}
                          title={file.showBboxes ? "Hide bounding boxes" : "Show bounding boxes"}
                        >
                          <Square className="h-4 w-4" />
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
                               className="h-8 w-8 text-muted-foreground hover:text-blue-400"
                               onClick={(e) => {
                                 e.stopPropagation();
                                 if (currentPageImageIds.length > 0) {
                                   console.log(`Manual loading annotations for current page. Page has ${currentPageImageIds.length} images.`);
                                   loadAnnotationsForCurrentPage(file.id, currentPageImageIds);
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
                             <Button 
                               variant="ghost" 
                               size="icon" 
                               className="h-8 w-8 text-muted-foreground hover:text-green-400"
                               onClick={(e) => {
                                 e.stopPropagation();
                                 loadFullAnnotationData(file.id);
                               }}
                               title={`Load all ${(file as any).totalSampleCount || 0} annotations`}
                             >
                               <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                               </svg>
                             </Button>
                           </>
                         )}
                         
                         {/* Tags button */}
                         <Button 
                           variant="ghost" 
                           size="icon" 
                           className="h-8 w-8 text-muted-foreground hover:text-blue-400"
                           onClick={(e) => handleTagsClick(file.id, e)}
                           title="Manage tags"
                         >
                           <Tag className="h-4 w-4" />
                         </Button>
                         {detectAnnotationType(file) === 'classification' ? (
                           <Button 
                             variant="ghost" 
                             size="icon" 
                             className="h-8 w-8 text-muted-foreground hover:text-blue-400"
                             onClick={(e) => handleEditClassificationAnnotation(file.id, e)}
                             title="Edit classification annotations"
                           >
                             <Edit className="h-4 w-4" />
                           </Button>
                         ) : (
                           <>
                             <Button 
                               variant="ghost" 
                               size="icon" 
                               className="h-8 w-8 text-muted-foreground hover:text-foreground"
                               onClick={(e) => handleStartEditName(file.id, file.name, e)}
                               title="Edit annotation name"
                             >
                               <Edit className="h-4 w-4" />
                             </Button>
                             <Button
                               variant="ghost"
                               size="icon"
                               className="h-8 w-8 text-muted-foreground hover:text-blue-400"
                               onClick={(e) => handleDuplicateAnnotation(file.id, e)}
                               title="Duplicate annotation file"
                             >
                               {/* Copy icon SVG */}
                               <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="2"/><rect x="3" y="3" width="13" height="13" rx="2" strokeWidth="2"/></svg>
                             </Button>
                           </>
                         )}
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
                           className="h-8 w-8 text-muted-foreground hover:text-green-400"
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
                  <div className="border-t border-gray-700 bg-gray-800/30">
                    <div className="p-4">
                      <div className="flex items-center justify-between mb-4">
                        <h4 className="text-sm font-medium">
                          Statistics & Configuration
                        </h4>
                        {dirtyAnnotationIds.has(file.id) && (
                          <Button size="sm" className="ml-2" onClick={() => handleSaveAnnotationFile(file.id)}>
                            Save Changes
                          </Button>
                        )}
                      </div>
                      
                      {/* Statistics section - now shown for all annotation types including classification */}
                      <div className="mb-6">
                        <div className="flex items-center justify-between mb-2">
                          <h5 className="text-xs font-medium mb-3 text-gray-400">Class Statistics</h5>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="text-xs ml-2 bg-yellow-400 text-black hover:bg-yellow-300 border-yellow-400"
                            onClick={() => setMergeDialogOpen(true)}
                          >
                            Merge Classes
                          </Button>
                        </div>
                        <ClassStatistics
                          statistics={file.classStats || []}
                          selectedClass={selectedClass}
                          onClassIconClick={(className) => setSelectedClass(selectedClass === className ? null : className)}
                        />
                      </div>
                      
                      {/* Class Configuration section - now available for all annotation types */}
                      <div>
                        <p className="text-xs text-muted-foreground mb-4">
                          Click a class color icon in the statistics above to customize its appearance
                        </p>
                        {selectedClass && file.classStats && (
                            <div className="mt-4 pt-4 border-t border-gray-700">
                              <ClassColorOpacityPicker
                                annotationId={file.id}
                                className={selectedClass}
                                color={file.classStats.find(s => s.className === selectedClass)?.color || '#ea384c'}
                                opacity={(file.classStats.find(s => s.className === selectedClass) as any)?.opacity || 0.25}
                                onColorOpacityChange={handleClassColorOpacityChange}
                                onRenameClass={(className) => setRenameClassDialog({ isOpen: true, className, annotationId: file.id })}
                                onDeleteClass={(className) => handleDeleteClass(file.id, className)}
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
                        </div>
                      </div>
                  </div>
                )}
              </div>
            ))
        }        
        {annotationFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center p-8">
            <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
              <Tag className="h-6 w-6 text-blue-400" />
            </div>
            <h3 className="text-lg font-medium mb-2">No annotation files</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              Import annotation files to view and configure class statistics
            </p>
          </div>
        )}
        {annotationFiles.length > 0 && filteredAnnotationFiles.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center p-8">
            <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
              <Tag className="h-6 w-6 text-gray-400" />
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
        <DialogContent className="max-w-2xl bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>
              {imageStatusDialog.type === 'present' ? 'Present Images' : 'Missing Images'} 
              {' '}({imageStatusDialog.files.length})
            </DialogTitle>
            <p className="text-sm text-gray-400">
              From annotation file: {imageStatusDialog.annotationFileName}
            </p>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto">
            {imageStatusDialog.files.length > 0 ? (
              <div className="space-y-1">
                {imageStatusDialog.files.map((fileName, index) => (
                  <div 
                    key={index} 
                    className="text-sm p-2 bg-gray-800 rounded border border-gray-700"
                  >
                    {fileName}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-400 text-sm">
                No {imageStatusDialog.type} images found.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialog.isOpen} onOpenChange={(open) => !open && handleCancelEdit()}>
        <DialogContent className="max-w-md bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>Edit Annotation File</DialogTitle>
            <p className="text-sm text-gray-400">
              Change the name of the annotation file
            </p>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="annotation-name" className="text-sm font-medium text-gray-300 block mb-2">
                Annotation Name
              </label>
              <Input
                id="annotation-name"
                value={editDialog.newName}
                onChange={(e) => setEditDialog(prev => ({ ...prev, newName: e.target.value }))}
                className="bg-gray-800 border-gray-600 text-white"
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
                className="border-gray-600 text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveAnnotationName}
                className="bg-blue-600 hover:bg-blue-700"
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
    </div>
  );
}
