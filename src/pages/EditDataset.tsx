
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Dataset, Image as ImageType } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { UploadCard } from "@/components/UploadCard";
import { processCOCOAnnotations } from "@/utils/annotations";
import { ClassStatistics } from "@/components/ClassStatistics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, 
  FileImage, 
  FileJson, 
  Loader2, 
  Trash2, 
  Save,
  X,
  Pencil,
  Tag
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useImageLoad } from "@/utils/animations";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Badge,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Mock data for a single dataset
const getMockDataset = (id: string): Dataset => ({
  id,
  name: "Vehicle Detection",
  description: "Urban traffic dataset with annotations for cars, trucks, and pedestrians.",
  createdAt: "2023-06-15T10:30:00Z",
  imageCount: 0,
  annotationCount: 0,
  thumbnailUrl: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
});

type AnnotationFile = {
  id: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  classStats?: { className: string; count: number; color: string }[];
  samples?: AnnotationSample[];
};

type AnnotationSample = {
  imageId: string;
  bbox: [number, number, number, number]; // [x, y, width, height]
  className: string;
  confidence?: number;
};

const EditDataset = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("images");
  
  const [images, setImages] = useState<ImageType[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationFile[]>([]);
  
  const [selectedImage, setSelectedImage] = useState<ImageType | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<AnnotationFile | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newFilename, setNewFilename] = useState("");
  const [showAnnotationsOnImage, setShowAnnotationsOnImage] = useState<AnnotationSample[]>([]);

  useEffect(() => {
    // Simulate API call to fetch dataset
    const fetchData = async () => {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (id) {
        setDataset(getMockDataset(id));
      }
      setLoading(false);
    };
    
    fetchData();
  }, [id]);

  // Handle image upload
  const handleImageUpload = (files: File[]) => {
    const newImages = files.map(file => {
      const imageUrl = URL.createObjectURL(file);
      return {
        id: Math.random().toString(36).substring(2, 11),
        datasetId: id || "",
        fileName: file.name,
        fileSize: file.size,
        width: 1920, // Placeholder, would be determined by loading the image
        height: 1080, // Placeholder, would be determined by loading the image
        url: imageUrl,
        thumbnailUrl: imageUrl,
        uploadedAt: new Date().toISOString(),
        annotationsCount: 0,
      } as ImageType;
    });
    
    setImages(prevImages => [...prevImages, ...newImages]);
    
    // Update dataset stats
    if (dataset) {
      setDataset({
        ...dataset,
        imageCount: (dataset.imageCount || 0) + files.length,
      });
    }
    
    toast({
      title: "Images added",
      description: `${files.length} images added successfully.`,
    });
  };
  
  // Handle annotation upload and processing
  const handleAnnotationUpload = async (files: File[]) => {
    toast({
      title: "Processing annotations",
      description: "Analyzing COCO annotation files...",
    });
    
    try {
      // Process each annotation file
      for (const file of files) {
        const { stats, samples } = await processCOCOAnnotations(file);
        const annotationCount = stats.reduce((acc, stat) => acc + stat.count, 0);
        
        const newAnnotation = {
          id: Math.random().toString(36).substring(2, 11),
          fileName: file.name,
          fileSize: file.size,
          uploadedAt: new Date().toISOString(),
          classStats: stats,
          samples: samples,
        };
        
        setAnnotations(prevAnnotations => [...prevAnnotations, newAnnotation]);
        
        // Update dataset stats
        if (dataset) {
          setDataset({
            ...dataset,
            annotationCount: (dataset.annotationCount || 0) + annotationCount,
          });
        }
      }
      
      toast({
        title: "Annotations processed",
        description: `${files.length} annotation files processed successfully.`,
      });
    } catch (error) {
      console.error("Error processing annotations:", error);
      toast({
        variant: "destructive",
        title: "Processing failed",
        description: "There was an error processing the annotation files.",
      });
    }
  };
  
  // Handle image deletion
  const handleDeleteImage = (image: ImageType) => {
    setImages(prevImages => prevImages.filter(img => img.id !== image.id));
    
    // Update dataset stats
    if (dataset) {
      setDataset({
        ...dataset,
        imageCount: Math.max(0, (dataset.imageCount || 0) - 1),
      });
    }
    
    // Clear selected image if it's the one being deleted
    if (selectedImage && selectedImage.id === image.id) {
      setSelectedImage(null);
    }
    
    toast({
      title: "Image deleted",
      description: `${image.fileName} has been removed.`,
    });
  };
  
  // Handle annotation deletion
  const handleDeleteAnnotation = (annotation: AnnotationFile) => {
    const annotationCount = annotation.classStats?.reduce((acc, stat) => acc + stat.count, 0) || 0;
    
    setAnnotations(prevAnnotations => 
      prevAnnotations.filter(anno => anno.id !== annotation.id)
    );
    
    // Update dataset stats
    if (dataset) {
      setDataset({
        ...dataset,
        annotationCount: Math.max(0, (dataset.annotationCount || 0) - annotationCount),
      });
    }
    
    // Clear selected annotation if it's the one being deleted
    if (selectedAnnotation && selectedAnnotation.id === annotation.id) {
      setSelectedAnnotation(null);
    }
    
    toast({
      title: "Annotation deleted",
      description: `${annotation.fileName} has been removed.`,
    });
  };
  
  // Handle annotation rename
  const handleRenameAnnotation = () => {
    if (!selectedAnnotation || !newFilename.trim()) return;
    
    setAnnotations(prevAnnotations => 
      prevAnnotations.map(anno => 
        anno.id === selectedAnnotation.id 
          ? { ...anno, fileName: newFilename.trim() } 
          : anno
      )
    );
    
    setSelectedAnnotation(prev => prev ? { ...prev, fileName: newFilename.trim() } : null);
    setIsRenaming(false);
    setNewFilename("");
    
    toast({
      title: "Annotation renamed",
      description: "Filename has been updated.",
    });
  };
  
  // Handle showing annotations on image
  const handleShowAnnotationsOnImage = (annotation: AnnotationFile) => {
    // Here we would normally fetch annotation samples from the API
    // We'll use the mock samples stored with the annotation for demonstration
    if (annotation.samples && annotation.samples.length > 0) {
      // Only show the first 5 samples
      setShowAnnotationsOnImage(annotation.samples.slice(0, 5));
      setActiveTab("images"); // Switch to images tab to show annotations
      toast({
        title: "Annotations loaded",
        description: `Showing annotations from ${annotation.fileName}`,
      });
    } else {
      toast({
        variant: "destructive",
        title: "No annotation samples",
        description: "This file doesn't contain any annotation samples to display.",
      });
    }
  };
  
  // Handle saving dataset
  const handleSave = async () => {
    setSaving(true);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      toast({
        title: "Dataset saved",
        description: "All changes have been saved successfully.",
      });
      
      navigate(`/datasets/${id}`);
    } catch (error) {
      console.error("Error saving dataset:", error);
      toast({
        variant: "destructive",
        title: "Save failed",
        description: "There was an error saving your changes. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="container max-w-7xl pt-32 flex justify-center items-center">
          <div className="flex flex-col items-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Loading dataset...</p>
          </div>
        </div>
      </div>
    );
  }
  
  if (!dataset) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="container max-w-7xl pt-32 text-center">
          <h1 className="text-2xl font-bold mb-4">Dataset not found</h1>
          <p className="text-muted-foreground mb-6">
            The dataset you're looking for doesn't exist or has been deleted.
          </p>
          <Button asChild>
            <Link to="/datasets">Return to datasets</Link>
          </Button>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen pb-20">
      <Navbar />
      
      <div className="bg-muted py-4 border-b mt-16">
        <div className="container max-w-7xl">
          <div className="flex items-center">
            <Button 
              variant="ghost" 
              asChild 
              className="mr-2"
            >
              <Link to={`/datasets/${id}`}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Link>
            </Button>
            <h1 className="text-xl font-semibold flex-1">
              Edit: {dataset.name}
            </h1>
            <Button 
              onClick={handleSave} 
              disabled={saving}
              className="ml-2"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </div>
        </div>
      </div>
      
      <main className="container max-w-7xl py-8">
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">Dataset Content</h2>
                <div className="text-sm text-muted-foreground">
                  {images.length} images • {dataset.annotationCount} annotations
                </div>
              </div>
              
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-4">
                  <TabsTrigger value="images">Images</TabsTrigger>
                  <TabsTrigger value="annotations">Annotations</TabsTrigger>
                </TabsList>
                
                <TabsContent value="images" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <h3 className="text-lg font-medium mb-4">Upload Images</h3>
                      <UploadCard
                        title="Add Images to Dataset"
                        description="Drag and drop images or click to browse"
                        accept="image/jpeg,image/png,image/webp"
                        onFilesSelected={handleImageUpload}
                        type="images"
                      />
                    </div>
                    
                    <div>
                      <h3 className="text-lg font-medium mb-4">
                        Image Gallery
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          {images.length} images
                        </span>
                      </h3>
                      {images.length > 0 ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mt-2 max-h-[500px] overflow-y-auto p-1">
                          {images.map((image) => (
                            <div 
                              key={image.id}
                              onClick={() => setSelectedImage(image)}
                              className="cursor-pointer relative group rounded-md overflow-hidden border bg-card hover:border-primary/50 transition-colors"
                            >
                              <div className="aspect-square relative">
                                <img 
                                  src={image.thumbnailUrl} 
                                  alt={image.fileName} 
                                  className="w-full h-full object-cover"
                                />
                                {/* Show badges for annotations */}
                                {showAnnotationsOnImage.length > 0 && 
                                 showAnnotationsOnImage.some(anno => anno.imageId === image.id) && (
                                  <div className="absolute top-2 right-2">
                                    <Badge variant="secondary" className="bg-primary/70 backdrop-blur-sm">
                                      <Tag className="h-3 w-3 mr-1" />
                                      {showAnnotationsOnImage.filter(anno => anno.imageId === image.id).length}
                                    </Badge>
                                  </div>
                                )}
                              </div>
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Button 
                                  variant="destructive" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteImage(image);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center bg-muted rounded-lg p-12 text-center">
                          <FileImage className="h-12 w-12 text-muted-foreground mb-4" />
                          <h4 className="text-lg font-medium">No images yet</h4>
                          <p className="text-muted-foreground mt-1 mb-4">
                            Upload your first image to get started
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="annotations" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <h3 className="text-lg font-medium mb-4">Upload Annotations</h3>
                      <UploadCard
                        title="Add COCO Annotations"
                        description="Upload JSON files in COCO format"
                        accept=".json"
                        onFilesSelected={handleAnnotationUpload}
                        type="annotations"
                      />
                    </div>
                    
                    <div>
                      <h3 className="text-lg font-medium mb-4">
                        Annotation Files
                        <span className="ml-2 text-sm font-normal text-muted-foreground">
                          {annotations.length} files
                        </span>
                      </h3>
                      {annotations.length > 0 ? (
                        <div className="border rounded-md max-h-[500px] overflow-y-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Filename</TableHead>
                                <TableHead>Size</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead className="w-[130px]">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {annotations.map((annotation) => (
                                <TableRow 
                                  key={annotation.id}
                                  className="cursor-pointer"
                                  onClick={() => setSelectedAnnotation(annotation)}
                                >
                                  <TableCell className="font-medium">
                                    {annotation.fileName}
                                  </TableCell>
                                  <TableCell>
                                    {(annotation.fileSize / 1024).toFixed(1)} KB
                                  </TableCell>
                                  <TableCell>
                                    {new Date(annotation.uploadedAt).toLocaleDateString()}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <Button 
                                        variant="outline" 
                                        size="icon" 
                                        className="h-8 w-8"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleShowAnnotationsOnImage(annotation);
                                        }}
                                        title="Show annotations on images"
                                      >
                                        <Tag className="h-4 w-4" />
                                      </Button>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedAnnotation(annotation);
                                          setNewFilename(annotation.fileName);
                                          setIsRenaming(true);
                                        }}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 text-destructive"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteAnnotation(annotation);
                                        }}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center bg-muted rounded-lg p-12 text-center">
                          <FileJson className="h-12 w-12 text-muted-foreground mb-4" />
                          <h4 className="text-lg font-medium">No annotations yet</h4>
                          <p className="text-muted-foreground mt-1 mb-4">
                            Upload COCO format annotation files
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </main>
      
      {/* Image Preview Dialog */}
      <Dialog 
        open={!!selectedImage} 
        onOpenChange={(open) => !open && setSelectedImage(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{selectedImage?.fileName}</DialogTitle>
            <DialogDescription>
              {selectedImage?.width}x{selectedImage?.height} • {(selectedImage?.fileSize ? (selectedImage.fileSize / 1024 / 1024).toFixed(2) : 0)} MB
            </DialogDescription>
          </DialogHeader>
          
          <div className="relative aspect-video bg-muted/30 rounded-md overflow-hidden flex items-center justify-center">
            {selectedImage && (
              <img 
                src={selectedImage.url} 
                alt={selectedImage.fileName} 
                className="max-w-full max-h-full object-contain"
              />
            )}
            
            {/* Show annotation boxes for this image */}
            {selectedImage && showAnnotationsOnImage.filter(anno => anno.imageId === selectedImage.id).map((anno, index) => (
              <div 
                key={`anno-${index}`}
                className="absolute border-2 border-primary"
                style={{
                  left: `${anno.bbox[0]}%`,
                  top: `${anno.bbox[1]}%`,
                  width: `${anno.bbox[2]}%`,
                  height: `${anno.bbox[3]}%`
                }}
              >
                <Popover>
                  <PopoverTrigger asChild>
                    <Badge 
                      className="absolute -top-6 -left-1 cursor-pointer bg-primary text-primary-foreground"
                    >
                      {anno.className}
                    </Badge>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2">
                    <div className="grid gap-1 text-xs">
                      <div className="font-semibold">{anno.className}</div>
                      {anno.confidence && (
                        <div>Confidence: {Math.round(anno.confidence * 100)}%</div>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            ))}
          </div>
          
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedImage) {
                  handleDeleteImage(selectedImage);
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Annotation Details Dialog */}
      <Dialog 
        open={!!selectedAnnotation && !isRenaming} 
        onOpenChange={(open) => !open && setSelectedAnnotation(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedAnnotation?.fileName}</DialogTitle>
            <DialogDescription>
              {(selectedAnnotation?.fileSize ? (selectedAnnotation.fileSize / 1024).toFixed(1) : 0)} KB • Uploaded {selectedAnnotation?.uploadedAt && new Date(selectedAnnotation.uploadedAt).toLocaleDateString()}
            </DialogDescription>
          </DialogHeader>
          
          {selectedAnnotation?.classStats && selectedAnnotation.classStats.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto">
              <ClassStatistics statistics={selectedAnnotation.classStats} />
              
              {/* Sample Annotations Section */}
              {selectedAnnotation.samples && selectedAnnotation.samples.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-2">Sample Annotations</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Showing {Math.min(5, selectedAnnotation.samples.length)} of {selectedAnnotation.samples.length} annotations
                  </p>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {selectedAnnotation.samples.slice(0, 5).map((sample, idx) => (
                      <div key={idx} className="rounded-md border p-2 bg-muted/30">
                        <div className="font-medium">{sample.className}</div>
                        <div className="text-xs text-muted-foreground">
                          Image ID: {sample.imageId.substring(0, 6)}...
                        </div>
                        {sample.confidence && (
                          <div className="text-xs text-muted-foreground">
                            Confidence: {Math.round(sample.confidence * 100)}%
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">No class statistics available</p>
            </div>
          )}
          
          <DialogFooter className="flex justify-between sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (selectedAnnotation) {
                    setNewFilename(selectedAnnotation.fileName);
                    setIsRenaming(true);
                  }
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (selectedAnnotation) {
                    handleShowAnnotationsOnImage(selectedAnnotation);
                    setSelectedAnnotation(null); // Close this dialog
                  }
                }}
              >
                <Tag className="mr-2 h-4 w-4" />
                Show on Images
              </Button>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedAnnotation) {
                  handleDeleteAnnotation(selectedAnnotation);
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Rename Dialog */}
      <Dialog open={isRenaming} onOpenChange={(open) => !open && setIsRenaming(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription>
              Enter a new name for this annotation file
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="filename" className="text-right">
                Filename
              </Label>
              <Input
                id="filename"
                value={newFilename}
                onChange={(e) => setNewFilename(e.target.value)}
                className="col-span-3"
                autoFocus
              />
            </div>
          </div>
          
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button 
              type="button" 
              disabled={!newFilename.trim()}
              onClick={handleRenameAnnotation}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EditDataset;
