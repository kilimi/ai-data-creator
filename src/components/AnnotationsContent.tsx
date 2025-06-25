
import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Tag, Edit, Trash2, Eye, EyeOff } from "lucide-react";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClassStatistics } from "@/components/ClassStatistics";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Switch } from "@/components/ui/switch";
import { AnnotationSample, processCOCOAnnotations, AnnotationFile } from "@/utils/annotations";
import { AnnotationsUploadDialog } from "@/components/AnnotationsUploadDialog";
import { ClassColorPicker } from "@/components/ClassColorPicker";
import { ClassColorOpacityPicker } from "@/components/ClassColorOpacityPicker";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";

interface AnnotationsContentProps {
  id: string;
  className?: string;
  onShowAnnotationsChange?: (show: boolean, annotations: AnnotationSample[]) => void;
  onImportAnnotations?: (files: File[]) => void;
}

export function AnnotationsContent({ 
  id, 
  className = "", 
  onShowAnnotationsChange,
  onImportAnnotations 
}: AnnotationsContentProps) {
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [visibleAnnotations, setVisibleAnnotations] = useState<Set<string>>(new Set());
  const [annotationFiles, setAnnotationFiles] = useState<AnnotationFile[]>([]);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  
  const { api } = useApi();
  const { toast } = useToast();

  // Load existing annotations from localStorage for demo purposes
  useEffect(() => {
    const savedAnnotations = localStorage.getItem(`annotations_${id}`);
    if (savedAnnotations) {
      try {
        const parsed = JSON.parse(savedAnnotations);
        setAnnotationFiles(parsed);
        
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

  // Update annotation color
  const handleClassColorChange = (annotationId: string, className: string, newColor: string) => {
    setAnnotationFiles(prev => prev.map(file => {
      if (file.id === annotationId) {
        const updatedClassColors = { ...file.classColors, [className]: newColor };
        const updatedClassStats = file.classStats?.map(stat => 
          stat.className === className ? { ...stat, color: newColor } : stat
        );
        const updatedSamples = file.samples?.map(sample => 
          sample.className === className ? { ...sample, color: newColor } : sample
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
          sample.className === className ? { ...sample, color: newColor, opacity: opacity } : sample
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

  // Update visible annotations based on currently visible files
  const updateVisibleAnnotations = () => {
    console.log('Updating visible annotations. Visible files:', Array.from(visibleAnnotations));
    
    const allVisibleAnnotations: AnnotationSample[] = [];
    
    annotationFiles.forEach(file => {
      if (visibleAnnotations.has(file.id) && file.samples) {
        console.log(`Adding ${file.samples.length} annotations from file: ${file.name}`);
        allVisibleAnnotations.push(...file.samples);
      }
    });
    
    console.log('Total visible annotations:', allVisibleAnnotations.length);
    
    if (onShowAnnotationsChange) {
      onShowAnnotationsChange(allVisibleAnnotations.length > 0, allVisibleAnnotations);
    }
  };

  const handleAnnotationClick = (annotationId: string) => {
    const newSelectedAnnotation = annotationId === selectedAnnotation ? null : annotationId;
    setSelectedAnnotation(newSelectedAnnotation);
  };

  const handleToggleAnnotationVisibility = (annotationId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const newVisibleAnnotations = new Set(visibleAnnotations);
    
    if (visibleAnnotations.has(annotationId)) {
      newVisibleAnnotations.delete(annotationId);
      console.log(`Hiding annotations for file: ${annotationId}`);
    } else {
      newVisibleAnnotations.add(annotationId);
      console.log(`Showing annotations for file: ${annotationId}`);
    }
    
    setVisibleAnnotations(newVisibleAnnotations);
    
    // Update the annotation files to mark visibility
    setAnnotationFiles(prev => prev.map(file => 
      file.id === annotationId 
        ? { ...file, isVisible: newVisibleAnnotations.has(annotationId) }
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
    console.log(`Edit annotation: ${annotationId}`);
    // Implement actual edit functionality here
  };

  const handleImportClick = () => {
    setShowUploadDialog(true);
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
          }
          
          // Process the COCO annotation file
          const result = await processCOCOAnnotations(file, id);
          
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
            samples: result.samples,
            isVisible: false,
            classColors: result.classColors
          };
          
          setAnnotationFiles(prev => [...prev, annotationFile]);
          
          // Also try to import via API if available
          if (api) {
            try {
              const apiResult = await api.importAnnotations(id, file);
              if (apiResult.success) {
                console.log('Annotations imported to backend:', apiResult.data);
              } else {
                console.warn('Backend import failed:', apiResult.error);
              }
            } catch (apiError) {
              console.error('Backend import failed:', apiError);
              // Don't fail the whole process if backend fails
            }
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
    <div className={`h-full ${className}`}>
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
      </div>

      <ResizablePanelGroup direction="horizontal" className="min-h-[600px] border rounded-lg bg-gray-950/20">
        <ResizablePanel defaultSize={40} minSize={30}>
          <Card className="h-full bg-gray-900/50 border-gray-700 rounded-none">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h3 className="font-medium">Annotation Files</h3>
              <div className="text-sm text-gray-400">
                Show on Images
              </div>
            </div>
            <ScrollArea className="h-[calc(100%-53px)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Images</TableHead>
                    <TableHead className="text-center">Visible</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {annotationFiles.map((file) => (
                    <TableRow 
                      key={file.id}
                      className={`cursor-pointer ${selectedAnnotation === file.id ? 'bg-gray-800' : ''}`}
                      onClick={() => handleAnnotationClick(file.id)}
                    >
                      <TableCell className="font-medium">
                        {file.name}
                        <div className="text-xs text-muted-foreground mt-1">
                          {new Date(file.date).toLocaleDateString()} • {file.classCount} classes
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-gray-800 border-gray-700">
                          {file.format}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge 
                            variant="outline" 
                            className={`${file.matchedImageCount > 0 ? 'bg-blue-600/30 text-blue-300 border-blue-700' : 'bg-gray-800 border-gray-700'}`}
                          >
                            {file.matchedImageCount} uploaded
                          </Badge>
                          <div className="text-xs text-muted-foreground">
                            of {file.imageCount} total
                          </div>
                          {file.matchedImageCount < file.imageCount && (
                            <div className="mt-1">
                              <Badge variant="outline" className="bg-amber-600/30 text-amber-300 border-amber-700 text-xs">
                                {file.imageCount - file.matchedImageCount} missing
                              </Badge>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${visibleAnnotations.has(file.id) ? 'text-blue-400' : 'text-gray-500'}`}
                          onClick={(e) => handleToggleAnnotationVisibility(file.id, e)}
                          title={visibleAnnotations.has(file.id) ? "Hide annotations" : "Show annotations"}
                        >
                          {visibleAnnotations.has(file.id) ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-2 justify-end">
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </Card>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={60}>
          <Card className="h-full bg-gray-900/50 border-gray-700 rounded-none flex flex-col">
            <div className="p-4 border-b border-gray-700">
              <h3 className="font-medium">
                {selectedAnnotationData ? 'Statistics & Configuration' : 'Statistics Overview'}
              </h3>
            </div>
            <div className="p-4 flex-1 flex flex-col">
              {selectedAnnotationData ? (
                <div className="flex flex-col h-full">
                  {/* Statistics section at the top */}
                  <div className="mb-6">
                    <h4 className="text-sm font-medium mb-4">Class Statistics</h4>
                    <ClassStatistics statistics={selectedAnnotationData.classStats || []} />
                  </div>
                  
                  {/* Class Configuration section at the bottom */}
                  <div className="flex-1 flex flex-col">
                    <div className="mb-4">
                      <h4 className="text-sm font-medium mb-2">Class Configuration</h4>
                      <p className="text-xs text-muted-foreground mb-4">
                        Click on a class name to customize its appearance
                      </p>
                    </div>
                    
                    <ScrollArea className="flex-1">
                      <div className="space-y-2">
                        {selectedAnnotationData.classStats?.map((classStat) => (
                          <div
                            key={classStat.className}
                            className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                              selectedClass === classStat.className 
                                ? 'bg-gray-700' 
                                : 'bg-gray-900 hover:bg-gray-800'
                            }`}
                            onClick={() => setSelectedClass(
                              selectedClass === classStat.className ? null : classStat.className
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-sm font-medium">{classStat.className}</span>
                              <span className="text-sm text-gray-400">{classStat.count} annotations</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                    
                    {/* Color and Opacity picker for selected class */}
                    {selectedClass && selectedAnnotationData.classStats && (
                      <div className="mt-4 pt-4 border-t border-gray-700">
                        <ClassColorOpacityPicker
                          className={selectedClass}
                          color={selectedAnnotationData.classStats.find(s => s.className === selectedClass)?.color || '#ea384c'}
                          opacity={(selectedAnnotationData.classStats.find(s => s.className === selectedClass) as any)?.opacity || 0.25}
                          onColorOpacityChange={(className, color, opacity) => 
                            handleClassColorOpacityChange(selectedAnnotationData.id, className, color, opacity)
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="h-[340px] flex flex-col items-center justify-center text-center p-4">
                  <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                    <Tag className="h-6 w-6 text-blue-400" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">Select an annotation file</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Click on an annotation file to view statistics and configure class appearance
                  </p>
                </div>
              )}
            </div>
          </Card>
        </ResizablePanel>
      </ResizablePanelGroup>

      <AnnotationsUploadDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
        onFilesSelected={handleFilesSelected}
      />
    </div>
  );
}
