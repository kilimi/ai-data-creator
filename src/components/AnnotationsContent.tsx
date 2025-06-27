import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Upload, Tag, Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { ClassStatistics } from "@/components/ClassStatistics";
import { Switch } from "@/components/ui/switch";
import { AnnotationSample, processCOCOAnnotations, AnnotationFile } from "@/utils/annotations";
import { AnnotationsUploadDialog } from "@/components/AnnotationsUploadDialog";
import { ClassColorPicker } from "@/components/ClassColorPicker";
import { ClassColorOpacityPicker } from "@/components/ClassColorOpacityPicker";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface AnnotationsContentProps {
  id: string;
  className?: string;
  onShowAnnotationsChange?: (show: boolean, annotations: AnnotationSample[], annotationFiles?: AnnotationFile[]) => void;
  onImportAnnotations?: (files: File[]) => void;
  showAllAnnotationsOnGrid?: boolean;
  images?: { id: string; fileName: string }[];
}

export function AnnotationsContent({ 
  id, 
  className = "", 
  onShowAnnotationsChange,
  onImportAnnotations,
  showAllAnnotationsOnGrid = false, // NEW PROP
  images = [] // NEW PROP
}: AnnotationsContentProps) {
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [visibleAnnotations, setVisibleAnnotations] = useState<Set<string>>(new Set());
  const [annotationFiles, setAnnotationFiles] = useState<AnnotationFile[]>([]);  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);  const [imageStatusDialog, setImageStatusDialog] = useState<{
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
  const { toast } = useToast();  // Load existing annotations from localStorage for demo purposes
  useEffect(() => {
    const savedAnnotations = localStorage.getItem(`annotations_${id}`);
    if (savedAnnotations) {
      try {
        const parsed = JSON.parse(savedAnnotations);
          // Ensure all annotation samples have annotationFileName property
        const annotationsWithFileNames = parsed.map((file: AnnotationFile) => {
          console.log(`Loading annotation file from localStorage: ${file.name}`);
          console.log(`Has imageMapping:`, !!file.imageMapping);
          console.log(`imageMapping keys:`, file.imageMapping ? Object.keys(file.imageMapping).slice(0, 5) : 'none');
          
          return {
            ...file,
            samples: file.samples?.map(sample => ({
              ...sample,
              annotationFileName: (sample as any).annotationFileName || file.name
            }))
          };
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
        console.error('Error parsing saved annotations:', error);
      }
    }
  }, [id]);

  // Save annotations to localStorage whenever they change
  useEffect(() => {
    if (annotationFiles.length > 0) {
      localStorage.setItem(`annotations_${id}`, JSON.stringify(annotationFiles));
    }
  }, [annotationFiles, id]);

  // Save visibility state to localStorage
  useEffect(() => {
    localStorage.setItem(`annotation_visibility_${id}`, JSON.stringify(Array.from(visibleAnnotations)));
  }, [visibleAnnotations, id]);
  // Update visible annotations whenever visibility or annotation files change
  useEffect(() => {
    updateVisibleAnnotations();
  }, [visibleAnnotations, annotationFiles]);

  // Also call updateVisibleAnnotations when component mounts to handle initial state
  useEffect(() => {
    if (annotationFiles.length > 0) {
      updateVisibleAnnotations();
    }
  }, []);// Update annotation color
  const handleClassColorChange = (annotationId: string, className: string, newColor: string) => {
    setAnnotationFiles(prev => prev.map(file => {
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
    }));
  };

  // Update annotation color and opacity
  const handleClassColorOpacityChange = (annotationId: string, className: string, newColor: string, opacity: number) => {
    setAnnotationFiles(prev => prev.map(file => {
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
    }));
  };  // Update visible annotations based on currently visible files
  const updateVisibleAnnotations = () => {
    console.log('Updating visible annotations. Visible files:', Array.from(visibleAnnotations));
    
    const allVisibleAnnotations: AnnotationSample[] = [];
    
    annotationFiles.forEach(file => {
      if (visibleAnnotations.has(file.id) && file.samples) {
        console.log(`Adding ${file.samples.length} annotations from file: ${file.name}`);
        // Attach the annotation file name to each sample
        const samplesWithFileName = file.samples.map(sample => ({
          ...sample,
          annotationFileName: file.name
        }));
        allVisibleAnnotations.push(...samplesWithFileName);
      }
    });
    
    console.log('Total visible annotations:', allVisibleAnnotations.length);
    console.log('Sample annotation with fileName:', (allVisibleAnnotations[0] as any)?.annotationFileName);
      if (onShowAnnotationsChange) {
      // If showAllAnnotationsOnGrid is true, always show all annotations
      if (showAllAnnotationsOnGrid) {
        const allAnnotations = annotationFiles.flatMap(file => 
          (file.samples || []).map(sample => ({
            ...sample,
            annotationFileName: file.name
          }))
        );
        console.log('Sending all annotations to parent:', allAnnotations.length, 'first fileName:', (allAnnotations[0] as any)?.annotationFileName);
        onShowAnnotationsChange(allAnnotations.length > 0, allAnnotations, annotationFiles);
      } else {
        console.log('Sending visible annotations to parent:', allVisibleAnnotations.length, 'first fileName:', (allVisibleAnnotations[0] as any)?.annotationFileName);
        onShowAnnotationsChange(allVisibleAnnotations.length > 0, allVisibleAnnotations, annotationFiles);
      }
    }
  };

  const handleAnnotationClick = (annotationId: string) => {
    const newSelectedAnnotation = annotationId === selectedAnnotation ? null : annotationId;
    setSelectedAnnotation(newSelectedAnnotation);
  };  const handleToggleAnnotationVisibility = (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const newVisibleAnnotations = new Set(visibleAnnotations);
    const isVisible = !visibleAnnotations.has(annotationId);
    
    if (visibleAnnotations.has(annotationId)) {
      newVisibleAnnotations.delete(annotationId);
      console.log(`Hiding annotations for file: ${annotationId}`);
    } else {
      newVisibleAnnotations.add(annotationId);
      console.log(`Showing annotations for file: ${annotationId}`);
    }
    
    setVisibleAnnotations(newVisibleAnnotations);
    
    // Update the annotation files to mark visibility AND update individual sample visibility
    setAnnotationFiles(prev => prev.map(file => 
      file.id === annotationId 
        ? { 
            ...file, 
            isVisible: isVisible,
            // Update all samples in this file to inherit the file's visibility
            // Preserve all existing properties including annotationFileName
            samples: file.samples?.map(sample => ({
              ...sample,
              isVisible: isVisible,
              annotationFileName: file.name // Ensure annotationFileName is always set
            }))
          }
        : file
    ));
  };

  const handleDeleteAnnotation = (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    setAnnotationFiles(prev => prev.filter(file => file.id !== annotationId));
    
    // Remove from visible annotations if it was visible
    const newVisibleAnnotations = new Set(visibleAnnotations);
    newVisibleAnnotations.delete(annotationId);
    setVisibleAnnotations(newVisibleAnnotations);
    
    if (selectedAnnotation === annotationId) {
      setSelectedAnnotation(null);
    }
    
    toast({
      title: "Annotation deleted",
      description: "Annotation file has been removed.",
    });
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

  const handleSaveAnnotationName = () => {
    if (!editDialog.newName.trim()) {
      toast({
        variant: "destructive",
        title: "Invalid name",
        description: "Annotation name cannot be empty.",
      });
      return;
    }

    setAnnotationFiles(prev => prev.map(file => 
      file.id === editDialog.annotationId 
        ? { 
            ...file, 
            name: editDialog.newName.trim(),
            // Update all samples to reflect the new annotation file name
            samples: file.samples?.map(sample => ({
              ...sample,
              annotationFileName: editDialog.newName.trim()
            }))
          }
        : file
    ));

    toast({
      title: "Annotation renamed",
      description: `Successfully renamed to "${editDialog.newName.trim()}".`,
    });

    setEditDialog({ isOpen: false, annotationId: '', currentName: '', newName: '' });
  };

  const handleCancelEdit = () => {
    setEditDialog({ isOpen: false, annotationId: '', currentName: '', newName: '' });
  };
  const handleImportClick = () => {
    setShowUploadDialog(true);
  };  // Get present and missing image file names for an annotation file
  const getImageFileLists = (file: AnnotationFile) => {
    console.log('getImageFileLists called for file:', file.name);
    console.log('file.samples length:', file.samples?.length);
    console.log('file.imageMapping:', file.imageMapping);
    console.log('images prop length:', images.length);
    console.log('sample images filenames:', images.slice(0, 3).map(img => img.fileName));
    
    if (!file.samples || !file.imageMapping) {
      console.log('Missing samples or imageMapping, returning empty lists');
      return { presentFiles: [], missingFiles: [] };
    }
    
    // Get all unique image IDs from the annotation samples
    const annotationImageIds = new Set(file.samples.map(sample => sample.imageId));
    console.log('annotationImageIds:', Array.from(annotationImageIds).slice(0, 5));
    
    // Create a set of uploaded image file names for quick lookup
    const uploadedImageNames = new Set(images.map(img => img.fileName));
    console.log('uploadedImageNames:', Array.from(uploadedImageNames).slice(0, 5));
    
    const presentFiles: string[] = [];
    const missingFiles: string[] = [];
    
    annotationImageIds.forEach(imageId => {
      // Get the actual filename from the COCO images array
      const fileName = file.imageMapping![imageId];
      console.log(`Image ID ${imageId} maps to filename: ${fileName}`);
      
      if (fileName) {
        // Check if this image file exists in the current dataset
        if (uploadedImageNames.has(fileName)) {
          presentFiles.push(fileName);
          console.log(`Found present: ${fileName}`);
        } else {
          missingFiles.push(fileName);
          console.log(`Found missing: ${fileName}`);
        }
      } else {
        // Fallback for images without mapping
        const fallbackName = `image_${imageId}.jpg`;
        missingFiles.push(fallbackName);
        console.log(`No mapping for image ID ${imageId}, using fallback: ${fallbackName}`);
      }
    });
    
    console.log('Final presentFiles:', presentFiles);
    console.log('Final missingFiles:', missingFiles);
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

  const handleFilesSelected = async (files: File[]) => {
    setIsLoading(true);
    
    try {
      const successfulImports: string[] = [];
      const failedImports: Array<{ fileName: string; error: string }> = [];
      
      for (const file of files) {
        try {
          console.log(`Processing annotation file: ${file.name}`);
          
          // Validate file type
          if (!file.name.toLowerCase().endsWith('.json')) {
            throw new Error('Only JSON files are supported for COCO annotations');
          }          // Process the COCO annotation file
          const result = await processCOCOAnnotations(file, id);
          
          // Set all annotation samples to be visible by default and add annotationFileName
          const visibleSamples = result.samples.map(sample => ({
            ...sample,
            isVisible: true,
            annotationFileName: file.name
          }));
            // Create annotation file record
          const annotationFile: AnnotationFile = {
            id: Math.random().toString(36).substring(2, 11),
            name: file.name,
            date: new Date().toISOString().split('T')[0],
            format: "COCO",
            classCount: result.stats.length,
            imageCount: result.totalImageCount,
            matchedImageCount: result.matchedImageCount,
            datasetId: id,
            classStats: result.stats,
            samples: visibleSamples,
            isVisible: true, // Set to true so annotations are immediately visible upon upload
            classColors: result.classColors,
            imageMapping: result.imageMapping
          };
          
          setAnnotationFiles(prev => [...prev, annotationFile]);
            // Add the new annotation file to visible annotations immediately
          setVisibleAnnotations(prev => new Set(prev).add(annotationFile.id));
          
          // Also try to import via API if available (but don't fail if it doesn't work)
          if (api) {
            try {
              const apiResult = await api.importAnnotations(id, file);
              if (apiResult && apiResult.success) {
                console.log('Annotations imported to backend:', apiResult.data);
              } else {
                console.warn('Backend import failed or returned no success flag:', apiResult);
              }
            } catch (apiError) {
              console.warn('Backend import failed (this is non-critical):', apiError);
              // Don't fail the whole process if backend fails - this is just for additional persistence
            }
          } else {
            console.log('No API available, skipping backend import');
          }
          
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
        
        // Also call the parent handler if provided
        if (onImportAnnotations) {
          onImportAnnotations(files.filter(f => successfulImports.includes(f.name)));
        }
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

  const selectedAnnotationData = annotationFiles.find(file => file.id === selectedAnnotation);

  return (
    <div className={`h-full min-h-[700px] ${className}`}> {/* Add min-h to root */}
      <div className="flex justify-between items-center mb-4">
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
        </div>
      </div>      {/* Main content: annotation files with expandable statistics */}
      <Card className="bg-gray-900/50 border-gray-700 rounded-lg h-full flex flex-col">
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h3 className="font-medium">Annotation Files</h3>
          <div className="text-sm text-gray-400">
            Show on Images
          </div>
        </div>
        <ScrollArea className="flex-1 min-h-[200px]">
          <div className="space-y-2 p-4">
            {annotationFiles.map((file) => (
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
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {/* Images count */}
                      <div className="flex items-center gap-2 text-sm">
                        {(() => {
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
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={(e) => handleEditAnnotation(file.id, e)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={(e) => handleDeleteAnnotation(file.id, e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Expandable statistics section */}
                {selectedAnnotation === file.id && (
                  <div className="border-t border-gray-700 bg-gray-800/30">
                    <div className="p-4">
                      <h4 className="text-sm font-medium mb-4">Statistics & Configuration</h4>
                      
                      {/* Statistics section */}
                      <div className="mb-6">
                        <h5 className="text-xs font-medium mb-3 text-gray-400">Class Statistics</h5>
                        <ClassStatistics
                          statistics={file.classStats || []}
                          selectedClass={selectedClass}
                          onClassIconClick={(className) => setSelectedClass(selectedClass === className ? null : className)}
                        />
                      </div>
                      
                      {/* Class Configuration section */}
                      <div>
                        <h5 className="text-xs font-medium mb-2 text-gray-400">Class Configuration</h5>
                        <p className="text-xs text-muted-foreground mb-4">
                          Click a class color icon in the statistics above to customize its appearance
                        </p>
                        
                        {/* Color and Opacity picker for selected class */}
                        {selectedClass && file.classStats && (
                          <div className="mt-4 pt-4 border-t border-gray-700">
                            <ClassColorOpacityPicker
                              className={selectedClass}
                              color={file.classStats.find(s => s.className === selectedClass)?.color || '#ea384c'}
                              opacity={(file.classStats.find(s => s.className === selectedClass) as any)?.opacity || 0.25}
                              onColorOpacityChange={(className, color, opacity) => 
                                handleClassColorOpacityChange(file.id, className, color, opacity)
                              }
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            
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
        </ScrollArea>
      </Card><AnnotationsUploadDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
        onFilesSelected={handleFilesSelected}
      />      <Dialog open={imageStatusDialog.isOpen} onOpenChange={(open) => setImageStatusDialog(prev => ({ ...prev, isOpen: open }))}>
        <DialogContent className="max-w-md bg-gray-900 text-white border-gray-700">
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
    </div>
  );
}
