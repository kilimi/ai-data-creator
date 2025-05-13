
import { useState } from "react";
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

interface AnnotationFile {
  id: string;
  name: string;
  date: string;
  format: string;
  classCount: number;
  imageCount: number; // Added image count property
}

interface AnnotationsContentProps {
  id: string;
  className?: string;
  onShowAnnotationsChange?: (show: boolean, annotationId: string | null) => void;
}

export function AnnotationsContent({ 
  id, 
  className = "", 
  onShowAnnotationsChange 
}: AnnotationsContentProps) {
  const [selectedAnnotation, setSelectedAnnotation] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);

  // Mock data for annotation files
  const mockAnnotationFiles = [
    {
      id: "ann-001",
      name: "coco_annotations_v1.json",
      date: "2025-05-10",
      format: "COCO",
      classCount: 3,
      imageCount: 24
    },
    {
      id: "ann-002",
      name: "yolo_dataset.yaml",
      date: "2025-05-12",
      format: "YOLO",
      classCount: 5,
      imageCount: 12
    },
    {
      id: "ann-003",
      name: "pascal_voc_annotations.xml",
      date: "2025-05-13",
      format: "VOC",
      classCount: 2,
      imageCount: 8
    }
  ];

  // Mock data for class statistics
  const mockClassStats = [
    {
      className: "Car",
      count: 245,
      color: "#3498db"
    },
    {
      className: "Person",
      count: 189,
      color: "#e74c3c"
    },
    {
      className: "Traffic Light",
      count: 67,
      color: "#2ecc71"
    },
    {
      className: "Bicycle",
      count: 45,
      color: "#f39c12"
    },
    {
      className: "Stop Sign",
      count: 32,
      color: "#9b59b6"
    }
  ];

  const handleAnnotationClick = (id: string) => {
    const newSelectedAnnotation = id === selectedAnnotation ? null : id;
    setSelectedAnnotation(newSelectedAnnotation);
    
    // When deselecting an annotation, also turn off the annotations display
    if (newSelectedAnnotation === null && showAnnotations) {
      setShowAnnotations(false);
      if (onShowAnnotationsChange) {
        onShowAnnotationsChange(false, null);
      }
    } else if (showAnnotations && onShowAnnotationsChange) {
      // When selecting a new annotation with visibility on, update the visibility
      onShowAnnotationsChange(true, newSelectedAnnotation);
    }
  };

  const handleDeleteAnnotation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log(`Delete annotation: ${id}`);
    // Implement actual delete functionality here
  };

  const handleEditAnnotation = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log(`Edit annotation: ${id}`);
    // Implement actual edit functionality here
  };

  const toggleAnnotationVisibility = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering row click handler
    const newShowAnnotations = !showAnnotations;
    setShowAnnotations(newShowAnnotations);
    
    if (onShowAnnotationsChange) {
      onShowAnnotationsChange(newShowAnnotations, selectedAnnotation);
    }
  };

  return (
    <div className={`h-full ${className}`}>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-semibold mb-1">Annotations</h2>
          <p className="text-sm text-muted-foreground">
            {mockAnnotationFiles.length} annotation files
          </p>
        </div>
        <div className="flex gap-2">
          <Button className="bg-blue-600 hover:bg-blue-700">
            <Tag className="w-4 h-4 mr-2" />
            Start Annotating
          </Button>
          <Button variant="outline" className="border-gray-700 bg-gray-800 hover:bg-gray-700">
            <Upload className="w-4 h-4 mr-2" />
            Import Annotations
          </Button>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="min-h-[600px] border rounded-lg bg-gray-950/20">
        <ResizablePanel defaultSize={40} minSize={30}>
          <Card className="h-full bg-gray-900/50 border-gray-700 rounded-none">
            <div className="p-4 border-b border-gray-700 flex justify-between items-center">
              <h3 className="font-medium">Annotation Files</h3>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Show on Images</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-8 w-8 ${showAnnotations ? 'text-blue-400' : 'text-gray-500'}`}
                  onClick={toggleAnnotationVisibility}
                  disabled={!selectedAnnotation}
                  title={showAnnotations ? "Hide annotations" : "Show annotations"}
                >
                  {showAnnotations ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[calc(100%-53px)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Format</TableHead>
                    <TableHead>Images</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mockAnnotationFiles.map((file) => (
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
                        <Badge 
                          variant="outline" 
                          className={`${file.imageCount > 0 ? 'bg-blue-600/30 text-blue-300 border-blue-700' : 'bg-gray-800 border-gray-700'}`}
                        >
                          {file.imageCount} images
                        </Badge>
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
          <Card className="h-full bg-gray-900/50 border-gray-700 rounded-none">
            <div className="p-4 border-b border-gray-700">
              <h3 className="font-medium">Class Distribution</h3>
            </div>
            <div className="p-4">
              {selectedAnnotation ? (
                <ClassStatistics statistics={mockClassStats} />
              ) : (
                <div className="h-[340px] flex flex-col items-center justify-center text-center p-4">
                  <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center mb-4">
                    <Tag className="h-6 w-6 text-blue-400" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">Select an annotation file</h3>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Click on an annotation file to view its class distribution and statistics
                  </p>
                </div>
              )}
            </div>
          </Card>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
