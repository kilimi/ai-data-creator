import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Upload, Tag, Edit, Trash2, Eye, EyeOff, Download } from "lucide-react";
import { ClassStatistics } from "@/components/ClassStatistics";
import { Switch } from "@/components/ui/switch";
import { AnnotationSample, processCOCOAnnotations, AnnotationFile } from "@/utils/annotations";
import { AnnotationsUploadDialog } from "@/components/AnnotationsUploadDialog";
import { ClassColorPicker } from "@/components/ClassColorPicker";
import { ClassColorOpacityPicker } from "@/components/ClassColorOpacityPicker";
import { RenameClassDialog } from "./RenameClassDialog";
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
  images = [] // NEW PROP
}: AnnotationsContentProps) {
  const navigate = useNavigate();
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [visibleAnnotations, setVisibleAnnotations] = useState<Set<string>>(new Set());
  const [annotationFiles, setAnnotationFiles] = useState<AnnotationFile[]>([]);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingFromBackend, setIsLoadingFromBackend] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [renameClassDialog, setRenameClassDialog] = useState<{ isOpen: boolean; className: string; annotationId: string }>({ isOpen: false, className: '', annotationId: '' });
  const [dirtyAnnotationIds, setDirtyAnnotationIds] = useState<Set<string>>(new Set());
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
  
  const { api } = useApi();
  const { toast } = useToast();
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

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
      localStorage.setItem(`annotations_${id}`, JSON.stringify(annotationFiles));
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
  }, [annotationFiles, visibleAnnotations, imagesMemo, showAllAnnotationsOnGrid, updateVisibleAnnotations]); // REMOVE onShowAnnotationsChange

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
  };  const handleToggleAnnotationVisibility = (annotationId: string, e: React.MouseEvent) => {
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
    
    // Save updated files to localStorage
    localStorage.setItem(`annotations_${id}`, JSON.stringify(updatedFiles));
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
      const isClassificationFile = (fileToDelete as any).type === 'classification' || fileToDelete.type === 'classification';
      
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
    if (file && (file.type === 'classification' || (file as any).type === 'classification')) {
      // Navigate to classification page with the dataset ID
      navigate(`/datasets/${id}/annotate/classification`);
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
    if (!file.samples || !file.imageMapping) {
      return { presentFiles: [], missingFiles: [] };
    }
    
    // Get all unique image IDs from the annotation samples
    const annotationImageIds = new Set(file.samples.map(sample => sample.imageId));
    
    // Create a set of uploaded image file names for quick lookup
    const uploadedImageNames = new Set(imagesMemo.map(img => img.fileName));
    
    const presentFiles: string[] = [];
    const missingFiles: string[] = [];
    
    annotationImageIds.forEach(imageId => {
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
            classColors: result.classColors,
            imageMapping: result.imageMapping
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
                samples: samples,
                isVisible: false,
                classColors: result.classColors,
                imageMapping: result.imageMapping
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
                classColors: {},
                imageMapping: {}
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
              classColors: {},
              imageMapping: {}
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
        
        setAnnotationFiles(processedFiles);
        console.log(`Loaded and processed ${processedFiles.length} annotation files from backend`);
        
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

  // Load existing annotations from localStorage (fallback)
  const loadAnnotationFilesFromLocalStorage = () => {
    const savedAnnotations = localStorage.getItem(`annotations_${id}`);
    if (savedAnnotations) {
      try {
        const parsed = JSON.parse(savedAnnotations);
        // Ensure all annotation samples have annotationFileName property
        const annotationsWithFileNames = parsed.map((file: AnnotationFile) => {
          return {
            ...file,
            samples: file.samples?.map(sample => ({
              ...sample,
              annotationFileName: (sample as any).annotationFileName || file.name
            }))
          };
        });
        
        // Sort by date (newest first) before setting
        annotationsWithFileNames.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          return dateB.getTime() - dateA.getTime();
        });
        
        setAnnotationFiles(annotationsWithFileNames);
        
        // Restore visibility state with proper typing
        const savedVisibility = localStorage.getItem(`annotation_visibility_${id}`);
        if (savedVisibility) {
          const visibilityArray: string[] = JSON.parse(savedVisibility);
          const visibilitySet = new Set(visibilityArray);
          setVisibleAnnotations(visibilitySet);
        }
      } catch (error) {
        console.error('Error loading annotations from localStorage:', error);
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
          if (annotation.type === 'COCO' && annotation.content) {
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
            date: new Date(annotation.savedAt).toISOString().split('T')[0],
            format: annotation.type === 'COCO' ? 'COCO' : 'JSON',
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
            content: annotation.content
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
      loadAnnotationFilesFromBackend();
    } else {
      loadAnnotationFilesFromLocalStorage();
    }
    
    // Always load saved classifications from localStorage
    const savedClassifications = loadSavedClassifications();
    if (savedClassifications.length > 0) {
      setAnnotationFiles(prev => {
        // Remove any existing classification files to avoid duplicates
        const nonClassificationFiles = prev.filter(file => (file as any).type !== 'classification' && file.type !== 'classification');
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
  }, [id, api]);

  // Periodically check for new saved classifications
  useEffect(() => {
    const interval = setInterval(() => {
      const savedClassifications = loadSavedClassifications();
      if (savedClassifications.length > 0) {
        setAnnotationFiles(prev => {
          // Remove any existing classification files to avoid duplicates
          const nonClassificationFiles = prev.filter(file => (file as any).type !== 'classification' && file.type !== 'classification');
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
  }, [id]);

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
            {annotationFiles.length} annotation files • {visibleAnnotations.size} visible on images
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
        <div className="space-y-2">
        {annotationFiles
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
                       <div className="font-medium">{file.name}</div>
                       <div className="text-xs text-muted-foreground mt-1">
                         {new Date(file.date).toLocaleDateString()} • {file.classCount} classes • {file.format}
                         {(file.type || (file as any).type) && (
                           <Badge variant="secondary" className="ml-2 text-xs capitalize">
                             {file.type || (file as any).type}
                           </Badge>
                         )}
                       </div>
                     </div>
                    <div className="flex items-center gap-4">                      {/* Images count */}
                      <div className="flex items-center gap-2 text-sm">
                        {(() => {                          const { presentFiles, missingFiles } = getImageFileLists(file);
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
                      {/* Visibility toggle */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-8 w-8 ${visibleAnnotations.has(file.id) ? 'text-blue-400' : 'text-gray-500'}`}
                        onClick={(e) => handleToggleAnnotationVisibility(file.id, e)}
                        title={visibleAnnotations.has(file.id) ? "Hide annotations" : "Show annotations"}
                      >
                        {visibleAnnotations.has(file.id) ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </Button>
                       {/* Actions */}
                       <div className="flex gap-2">
                         {(file.type === 'classification' || (file as any).type === 'classification') ? (
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
                               onClick={(e) => handleEditAnnotation(file.id, e)}
                               title="Edit annotation file"
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
                          {(file.type === 'classification' || (file as any).type === 'classification') ? 'JSON Content' : 'Statistics & Configuration'}
                        </h4>
                        {dirtyAnnotationIds.has(file.id) && (
                          <Button size="sm" className="ml-2" onClick={() => handleSaveAnnotationFile(file.id)}>
                            Save Changes
                          </Button>
                        )}
                      </div>
                      
                      {/* Classification JSON Content */}
                      {(file.type === 'classification' || (file as any).type === 'classification') ? (
                        <div className="mb-6">
                          <h5 className="text-xs font-medium mb-3 text-gray-400">Classification Data</h5>
                          <div className="bg-gray-900 rounded border border-gray-600 p-4">
                            <pre className="text-xs text-gray-300 whitespace-pre-wrap overflow-x-auto">
                              {JSON.stringify((file as any).content, null, 2)}
                            </pre>
                          </div>
                        </div>
                      ) : (
                        <>
                          {/* Statistics section */}
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
                        </>
                      )}
                      
                      {/* Class Configuration section - only for non-classification annotations */}
                      {(file as any).type !== 'classification' && (
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
                      )}
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
      <MergeClassesDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        classStats={selectedAnnotationData?.classStats || []}
        onMerge={(sources, mergedName) => handleMergeClasses(selectedAnnotation!, sources, mergedName)}
      />
    </div>
  );
}
