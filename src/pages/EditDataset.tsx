import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Dataset, Image as ImageType } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { UploadCard } from "@/components/UploadCard";
import { processCOCOAnnotations, AnnotationSample } from "@/utils/annotations";
import { ClassStatistics } from "@/components/ClassStatistics";
import { AnnotationVisualizer } from "@/components/AnnotationVisualizer";
import { AnnotationImagesDialog } from "@/components/AnnotationImagesDialog";
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
  Tag,
  Upload
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
  matchedImageCount?: number;
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
  
  const [showAnnotationsDialog, setShowAnnotationsDialog] = useState(false);
  const [annotationsToShow, setAnnotationsToShow] = useState<AnnotationSample[]>([]);
  const [annotationFileNameToShow, setAnnotationFileNameToShow] = useState("");

  const [imageDimensions, setImageDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const fetchData = async () => {
      await new Promise(resolve => setTimeout(resolve, 800));
      if (id) {
        setDataset(getMockDataset(id));
      }
      setLoading(false);
    };
    
    fetchData();
  }, [id]);

  const handleImageUpload = (files: File[]) => {
    const newImages = files.map(file => {
      const imageUrl = URL.createObjectURL(file);
      return {
        id: Math.random().toString(36).substring(2, 11),
        datasetId: id || "",
        fileName: file.name,
        fileSize: file.size,
        width: 1920,
        height: 1080,
        url: imageUrl,
        thumbnailUrl: imageUrl,
        uploadedAt: new Date().toISOString(),
        annotationsCount: 0,
      } as ImageType;
    });
    
    setImages(prevImages => [...prevImages, ...newImages]);
    
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

  const handleAnnotationUpload = async (files: File[]) => {
    toast({
      title: "Processing annotations",
      description: "Analyzing COCO annotation files...",
    });
    
    try {
      for (const file of files) {
        const { stats, samples, matchedImages } = await processCOCOAnnotations(file);
        const annotationCount = stats.reduce((acc, stat) => acc + stat.count, 0);
        
        const enhancedSamples = samples.map(sample => {
          if (Math.random() > 0.5) {
            const segmentation = [[
              sample.bbox[0] + sample.bbox[2] * 0.2,
              sample.bbox[1] + sample.bbox[3] * 0.2,
              sample.bbox[0] + sample.bbox[2] * 0.8,
              sample.bbox[1] + sample.bbox[3] * 0.2,
              sample.bbox[0] + sample.bbox[2] * 0.8,
              sample.bbox[1] + sample.bbox[3] * 0.8,
              sample.bbox[0] + sample.bbox[2] * 0.2,
              sample.bbox[1] + sample.bbox[3] * 0.8,
            ]];
            const area = sample.bbox[2] * sample.bbox[3] * 0.6 * 100;
            return { ...sample, segmentation, area };
          }
          return sample;
        });
        
        const matchingImages = images.filter(img => 
          enhancedSamples.some(sample => sample.imageId === img.id)
        );
        
        if (matchingImages.length === 0) {
          const updatedSamples = enhancedSamples.map((sample, idx) => {
            if (idx < Math.min(enhancedSamples.length, images.length)) {
              return { ...sample, imageId: images[idx % images.length].id };
            }
            return sample;
          });
          
          const matchedCount = new Set(updatedSamples.map(s => s.imageId)).size;
          
          const newAnnotation = {
            id: Math.random().toString(36).substring(2, 11),
            fileName: file.name,
            fileSize: file.size,
            uploadedAt: new Date().toISOString(),
            classStats: stats,
            samples: updatedSamples,
            matchedImageCount: matchedCount
          };
          
          setAnnotations(prevAnnotations => [...prevAnnotations, newAnnotation]);
        } else {
          const newAnnotation = {
            id: Math.random().toString(36).substring(2, 11),
            fileName: file.name,
            fileSize: file.size,
            uploadedAt: new Date().toISOString(),
            classStats: stats,
            samples: enhancedSamples,
            matchedImageCount: matchingImages.length
          };
          
          setAnnotations(prevAnnotations => [...prevAnnotations, newAnnotation]);
        }
        
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

  const handleDeleteImage = (image: ImageType) => {
    setImages(prevImages => prevImages.filter(img => img.id !== image.id));
    
    if (dataset) {
      setDataset({
        ...dataset,
        imageCount: Math.max(0, (dataset.imageCount || 0) - 1),
      });
    }
    
    if (selectedImage && selectedImage.id === image.id) {
      setSelectedImage(null);
    }
    
    toast({
      title: "Image deleted",
      description: `${image.fileName} has been removed.`,
    });
  };

  const handleDeleteAnnotation = (annotation: AnnotationFile) => {
    const annotationCount = annotation.classStats?.reduce((acc, stat) => acc + stat.count, 0) || 0;
    
    setAnnotations(prevAnnotations => 
      prevAnnotations.filter(anno => anno.id !== annotation.id)
    );
    
    if (dataset) {
      setDataset({
        ...dataset,
        annotationCount: Math.max(0, (dataset.annotationCount || 0) - annotationCount),
      });
    }
    
    if (selectedAnnotation && selectedAnnotation.id === annotation.id) {
      setSelectedAnnotation(null);
    }
    
    if (annotation.samples && 
        showAnnotationsOnImage.some(a => annotation.samples?.includes(a))) {
      setShowAnnotationsOnImage([]);
    }
    
    toast({
      title: "Annotation deleted",
      description: `${annotation.fileName} has been removed.`,
    });
  };

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

  const handleShowAnnotationsOnImage = (annotation: AnnotationFile) => {
    if (annotation.samples && annotation.samples.length > 0) {
      const matchingImageIds = new Set(
        annotation.samples
          .map(a => a.imageId)
          .filter(id => images.some(img => img.id === id))
      );
      
      if (matchingImageIds.size > 0) {
        setAnnotationsToShow(annotation.samples);
        setAnnotationFileNameToShow(annotation.fileName);
        setShowAnnotationsDialog(true);
        
        toast({
          title: "Annotations loaded",
          description: `Showing annotations from ${annotation.fileName}`,
        });
      } else {
        const updatedSamples = [...annotation.samples];
        for (let i = 0; i < Math.min(5, updatedSamples.length); i++) {
          if (i < images.length) {
            updatedSamples[i] = { ...updatedSamples[i], imageId: images[i].id };
          }
        }
        
        setAnnotationsToShow(updatedSamples);
        setAnnotationFileNameToShow(annotation.fileName);
        setShowAnnotationsDialog(true);
        
        toast({
          title: "Annotations loaded",
          description: `Showing annotations from ${annotation.fileName} (modified for demo)`,
        });
      }
    } else {
      toast({
        variant: "destructive",
        title: "No annotation samples",
        description: "This file doesn't contain any annotation samples to display.",
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    
    try {
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

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
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
      <div className="min-h-screen bg-black text-white">
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
    <div className="min-h-screen pb-20 bg-black text-white">
      <Navbar />
      
      <div className="bg-gray-900 py-4 border-b border-gray-800 mt-16">
        <div className="container max-w-7xl">
          <div className="flex items-center">
            <Button 
              variant="ghost" 
              asChild 
              className="mr-2 text-gray-300 hover:text-white hover:bg-gray-800"
            >
              <Link to={`/datasets/${id}`}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Link>
            </Button>
            <h1 className="text-xl font-semibold flex-1 text-white">
              Edit: {dataset.name}
            </h1>
            <Button 
              onClick={handleSave} 
              disabled={saving}
              className="ml-2 bg-blue-600 hover:bg-blue-700"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </div>
        </div>
      </div>
      
      <main className="container max-w-7xl py-8">
        <div className="flex flex-col gap-6">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Dataset Content</h2>
                <div className="text-sm text-gray-400">
                  {images.length} images • {dataset.annotationCount} annotations
                </div>
              </div>
              
              <Tabs 
                value={activeTab} 
                onValueChange={setActiveTab}
                className="text-white"
              >
                <TabsList className="mb-4 bg-gray-800">
                  <TabsTrigger 
                    value="images"
                    className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                  >
                    Images
                  </TabsTrigger>
                  <TabsTrigger 
                    value="annotations"
                    className="data-[state=active]:bg-blue-600 data-[state=active]:text-white"
                  >
                    Annotations
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="images" className="space-y-4">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-medium text-white">
                      Image Gallery
                      <span className="ml-2 text-sm font-normal text-gray-400">
                        {images.length} images
                      </span>
                    </h3>
                    <Button 
                      onClick={() => document.getElementById('image-upload-input')?.click()}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      <Upload className="h-4 w-4 mr-1" /> Add Images
                    </Button>
                  </div>

                  <div className="hidden">
                    <input
                      id="image-upload-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleImageUpload(Array.from(e.target.files));
                        }
                      }}
                    />
                  </div>
                  
                  {images.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3 mt-4 max-h-[600px] overflow-y-auto p-1">
                      {images.map((image) => (
                        <div 
                          key={image.id}
                          onClick={() => setSelectedImage(image)}
                          className="cursor-pointer relative group rounded-md overflow-hidden border border-gray-700 bg-gray-800 hover:border-blue-500/50 transition-colors"
                        >
                          <div className="aspect-square relative">
                            <img 
                              src={image.thumbnailUrl} 
                              alt={image.fileName} 
                              className="w-full h-full object-cover"
                            />
                            {showAnnotationsOnImage.length > 0 && 
                             showAnnotationsOnImage.some(anno => anno.imageId === image.id) && (
                              <div className="absolute top-2 right-2">
                                <Badge variant="secondary" className="bg-blue-600/70 backdrop-blur-sm">
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
                    <div className="flex flex-col items-center justify-center bg-gray-800 rounded-lg p-12 text-center">
                      <FileImage className="h-12 w-12 text-gray-400 mb-4" />
                      <h4 className="text-lg font-medium text-white">No images yet</h4>
                      <p className="text-gray-400 mt-1 mb-4">
                        Click the "Add Images" button to get started
                      </p>
                      <Button 
                        onClick={() => document.getElementById('image-upload-input')?.click()}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Upload className="h-4 w-4 mr-2" /> Add Images
                      </Button>
                    </div>
                  )}
                  
                  <div className="mt-6">
                    <h3 className="text-lg font-medium mb-4 text-white">Advanced Upload</h3>
                    <UploadCard
                      title="Add Images to Dataset"
                      description="Drag and drop images or click to browse"
                      accept="image/jpeg,image/png,image/webp"
                      onFilesSelected={handleImageUpload}
                      type="images"
                      multiple={true}
                    />
                  </div>
                </TabsContent>
                
                <TabsContent value="annotations" className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <h3 className="text-lg font-medium mb-4 text-white">Upload Annotations</h3>
                      <UploadCard
                        title="Add COCO Annotations"
                        description="Upload JSON files in COCO format"
                        accept=".json"
                        onFilesSelected={handleAnnotationUpload}
                        type="annotations"
                      />
                    </div>
                    
                    <div>
                      <h3 className="text-lg font-medium mb-4 text-white">
                        Annotation Files
                        <span className="ml-2 text-sm font-normal text-gray-400">
                          {annotations.length} files
                        </span>
                      </h3>
                      {annotations.length > 0 ? (
                        <div className="border border-gray-700 rounded-md max-h-[500px] overflow-y-auto">
                          <Table>
                            <TableHeader className="bg-gray-800">
                              <TableRow className="border-b-gray-700">
                                <TableHead className="text-gray-300">Filename</TableHead>
                                <TableHead className="text-gray-300">Size</TableHead>
                                <TableHead className="text-gray-300">Date</TableHead>
                                <TableHead className="text-gray-300">Images</TableHead>
                                <TableHead className="w-[130px] text-gray-300">Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {annotations.map((annotation) => (
                                <TableRow 
                                  key={annotation.id}
                                  className="cursor-pointer border-b-gray-700 hover:bg-gray-800"
                                  onClick={() => setSelectedAnnotation(annotation)}
                                >
                                  <TableCell className="font-medium text-white">
                                    {annotation.fileName}
                                  </TableCell>
                                  <TableCell className="text-gray-300">
                                    {(annotation.fileSize / 1024).toFixed(1)} KB
                                  </TableCell>
                                  <TableCell className="text-gray-300">
                                    {new Date(annotation.uploadedAt).toLocaleDateString()}
                                  </TableCell>
                                  <TableCell className="text-gray-300">
                                    {annotation.matchedImageCount ? (
                                      <Badge className="bg-blue-600/50">
                                        {annotation.matchedImageCount} matches
                                      </Badge>
                                    ) : "0 matches"}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-1">
                                      <Button 
                                        variant="outline" 
                                        size="icon" 
                                        className={`h-8 w-8 border-gray-700 ${
                                          annotation.matchedImageCount ? "bg-blue-900/50 hover:bg-blue-800/70" : "bg-gray-800 hover:bg-gray-700"
                                        }`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleShowAnnotationsOnImage(annotation);
                                        }}
                                        title="Show annotations on images"
                                      >
                                        <Tag className={`h-4 w-4 ${annotation.matchedImageCount ? "text-blue-300" : "text-gray-400"}`} />
                                      </Button>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 hover:bg-gray-700"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedAnnotation(annotation);
                                          setNewFilename(annotation.fileName);
                                          setIsRenaming(true);
                                        }}
                                      >
                                        <Pencil className="h-4 w-4 text-gray-400" />
                                      </Button>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        className="h-8 w-8 text-red-500 hover:bg-gray-700"
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
                        <div className="flex flex-col items-center justify-center bg-gray-800 rounded-lg p-12 text-center">
                          <FileJson className="h-12 w-12 text-gray-400 mb-4" />
                          <h4 className="text-lg font-medium text-white">No annotations yet</h4>
                          <p className="text-gray-400 mt-1 mb-4">
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
      
      <Dialog 
        open={!!selectedImage} 
        onOpenChange={(open) => !open && setSelectedImage(null)}
      >
        <DialogContent className="max-w-3xl bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>{selectedImage?.fileName}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {selectedImage?.width}x{selectedImage?.height} • {(selectedImage?.fileSize ? (selectedImage.fileSize / 1024 / 1024).toFixed(2) : 0)} MB
            </DialogDescription>
          </DialogHeader>
          
          <div className="relative aspect-video bg-gray-950 rounded-md overflow-hidden flex items-center justify-center">
            {selectedImage && (
              <>
                <img 
                  src={selectedImage.url} 
                  alt={selectedImage.fileName} 
                  className="max-w-full max-h-full object-contain"
                  onLoad={handleImageLoad}
                />
                
                {selectedImage && showAnnotationsOnImage.filter(anno => anno.imageId === selectedImage.id).length > 0 && (
                  <AnnotationVisualizer 
                    annotations={showAnnotationsOnImage.filter(anno => anno.imageId === selectedImage.id)}
                    imageWidth={imageDimensions.width}
                    imageHeight={imageDimensions.height}
                    className="absolute inset-0"
                  />
                )}
              </>
            )}
          </div>
          
          <DialogFooter className="flex flex-col sm:flex-row justify-between gap-2">
            <div className="text-sm text-gray-400">
              {selectedImage && showAnnotationsOnImage.filter(anno => anno.imageId === selectedImage.id).length > 0 
                ? `Showing ${showAnnotationsOnImage.filter(anno => anno.imageId === selectedImage.id).length} annotations` 
                : "No annotations shown"
              }
            </div>
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
      
      <Dialog 
        open={!!selectedAnnotation && !isRenaming} 
        onOpenChange={(open) => !open && setSelectedAnnotation(null)}
      >
        <DialogContent className="max-w-2xl bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>{selectedAnnotation?.fileName}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {(selectedAnnotation?.fileSize ? (selectedAnnotation.fileSize / 1024).toFixed(1) : 0)} KB • Uploaded {selectedAnnotation?.uploadedAt && new Date(selectedAnnotation.uploadedAt).toLocaleDateString()}
            </DialogDescription>
          </DialogHeader>
          
          {selectedAnnotation?.classStats && selectedAnnotation.classStats.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto">
              <ClassStatistics statistics={selectedAnnotation.classStats} />
              
              {selectedAnnotation.samples && selectedAnnotation.samples.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-2 text-white">Sample Annotations</h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Showing {Math.min(5, selectedAnnotation.samples.length)} of {selectedAnnotation.samples.length} annotations
                  </p>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {selectedAnnotation.samples.slice(0, 5).map((sample, idx) => (
                      <div key={idx} className="rounded-md border border-gray-700 p-2 bg-gray-800">
                        <div className="font-medium text-white">{sample.className}</div>
                        <div className="text-xs text-gray-400">
                          Image ID: {sample.imageId.substring(0, 6)}...
                        </div>
                        {sample.confidence && (
                          <div className="text-xs text-gray-400">
                            Confidence: {Math.round(sample.confidence * 100)}%
                          </div>
                        )}
                        {sample.segmentation && (
                          <div className="text-xs text-green-400">
                            Has segmentation mask
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
              <p className="text-gray-400">No class statistics available</p>
            </div>
          )}
          
          <DialogFooter className="flex justify-between sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-gray-700 bg-gray-800 hover:bg-gray-700 text-white"
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
                className="border-gray-700 bg-gray-800 hover:bg-gray-700 text-white"
                onClick={() => {
                  if (selectedAnnotation) {
                    handleShowAnnotationsOnImage(selectedAnnotation);
                    setSelectedAnnotation(null);
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
      
      <Dialog open={isRenaming} onOpenChange={(open) => !open && setIsRenaming(false)}>
        <DialogContent className="sm:max-w-md bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription className="text-gray-400">
              Enter a new name for this annotation file
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="filename" className="text-right text-gray-300">
                Filename
              </Label>
              <Input
                id="filename"
                value={newFilename}
                onChange={(e) => setNewFilename(e.target.value)}
                className="col-span-3 bg-gray-800 border-gray-700 text-white"
                autoFocus
              />
            </div>
          </div>
          
          <DialogFooter>
            <DialogClose asChild>
              <Button 
                type="button" 
                variant="secondary"
                className="bg-gray-800 hover:bg-gray-700 text-white"
              >
                Cancel
              </Button>
            </DialogClose>
            <Button 
              type="button" 
              disabled={!newFilename.trim()}
              onClick={handleRenameAnnotation}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <AnnotationImagesDialog 
        open={showAnnotationsDialog}
        onOpenChange={setShowAnnotationsDialog}
        annotations={annotationsToShow}
        images={images}
        annotationFileName={annotationFileNameToShow}
      />
    </div>
  );
};

export default EditDataset;
