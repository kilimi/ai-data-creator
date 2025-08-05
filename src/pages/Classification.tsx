import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Navbar } from "@/components/Navbar";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/hooks/use-api";
import { Image } from "@/types";
import { ArrowLeft, Plus, X, Check, ChevronLeft, ChevronRight, Settings2, Save } from "lucide-react";
import { ImageDisplayControls } from "@/components/ImageDisplayControls";
import { PaginationControls } from "@/components/PaginationControls";
import { useDatasetSettings } from "@/hooks/useDatasetSettings";

interface ClassificationData {
  [imageId: string]: string[];
}

export default function Classification() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { api } = useApi();
  
  // Dataset settings
  const datasetId = id || '';
  const { settings, updateImagesPerPage, updateImageSize } = useDatasetSettings(datasetId);
  
  // Data states
  const [images, setImages] = useState<Image[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [classifications, setClassifications] = useState<ClassificationData>({});
  const [loading, setLoading] = useState(true);
  
  // UI states
  const [newClass, setNewClass] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  
  // Calculate pagination
  const totalPages = Math.ceil(images.length / settings.imagesPerPage);
  const paginatedImages = images.slice(
    (currentPage - 1) * settings.imagesPerPage,
    currentPage * settings.imagesPerPage
  );

  // Load images and existing classifications
  useEffect(() => {
    const loadData = async () => {
      if (!id || !api) return;
      
      try {
        setLoading(true);
        const imagesRes = await api.getImages(id);
        if (imagesRes.success && imagesRes.data) {
          setImages(imagesRes.data);
        }
        
        // Load existing classifications from localStorage
        const savedClassifications = localStorage.getItem(`classifications_${id}`);
        if (savedClassifications) {
          setClassifications(JSON.parse(savedClassifications));
        }
        
        const savedClasses = localStorage.getItem(`classification_classes_${id}`);
        if (savedClasses) {
          setClasses(JSON.parse(savedClasses));
        }
      } catch (error) {
        console.error('Error loading data:', error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load dataset images",
        });
      } finally {
        setLoading(false);
      }
    };
    
    loadData();
  }, [id, api, toast]);

  // Save classifications to localStorage
  const saveClassifications = useCallback((newClassifications: ClassificationData) => {
    if (id) {
      localStorage.setItem(`classifications_${id}`, JSON.stringify(newClassifications));
      setClassifications(newClassifications);
    }
  }, [id]);

  // Save classes to localStorage
  const saveClasses = useCallback((newClasses: string[]) => {
    if (id) {
      localStorage.setItem(`classification_classes_${id}`, JSON.stringify(newClasses));
      setClasses(newClasses);
    }
  }, [id]);

  // Add new class
  const handleAddClass = () => {
    if (newClass.trim() && !classes.includes(newClass.trim())) {
      const updatedClasses = [...classes, newClass.trim()];
      saveClasses(updatedClasses);
      setNewClass("");
      toast({
        title: "Class added",
        description: `Added new class: ${newClass.trim()}`,
      });
    }
  };

  // Remove class
  const handleRemoveClass = (classToRemove: string) => {
    const updatedClasses = classes.filter(c => c !== classToRemove);
    saveClasses(updatedClasses);
    
    // Remove class from all image classifications
    const updatedClassifications = { ...classifications };
    Object.keys(updatedClassifications).forEach(imageId => {
      updatedClassifications[imageId] = updatedClassifications[imageId].filter(c => c !== classToRemove);
    });
    saveClassifications(updatedClassifications);
    
    toast({
      title: "Class removed",
      description: `Removed class: ${classToRemove}`,
    });
  };

  // Toggle class for specific image
  const handleImageClassToggle = (imageId: string, className: string) => {
    const currentImageClasses = classifications[imageId] || [];
    const updatedClassifications = {
      ...classifications,
      [imageId]: currentImageClasses.includes(className)
        ? currentImageClasses.filter(c => c !== className)
        : [...currentImageClasses, className]
    };
    saveClassifications(updatedClassifications);
  };

  // Assign class to all images on current page
  const handleAssignToAllOnPage = (className: string) => {
    const updatedClassifications = { ...classifications };
    paginatedImages.forEach(image => {
      const currentClasses = updatedClassifications[image.id] || [];
      if (!currentClasses.includes(className)) {
        updatedClassifications[image.id] = [...currentClasses, className];
      }
    });
    saveClassifications(updatedClassifications);
    
    toast({
      title: "Class assigned",
      description: `Assigned "${className}" to all ${paginatedImages.length} images on this page`,
    });
  };

  // Handle pagination
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  // Handle image size change
  const handleImageSizeChange = (value: number[]) => {
    updateImageSize(value[0]);
  };

  // Save annotations as JSON file
  const handleSaveAnnotations = () => {
    const annotationsData: { [filename: string]: { class: string[] } } = {};
    
    images.forEach(image => {
      const imageClasses = classifications[image.id] || [];
      annotationsData[image.fileName] = { class: imageClasses };
    });

    // Create JSON file
    const jsonContent = JSON.stringify(annotationsData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    // Download file
    const link = document.createElement('a');
    link.href = url;
    link.download = `classifications_${id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Store in localStorage to be picked up by annotations section
    const savedAnnotations = localStorage.getItem(`saved_annotations_${id}`) || '[]';
    const annotationsList = JSON.parse(savedAnnotations);
    
    const newAnnotation = {
      id: `classification_${Date.now()}`,
      name: `classifications_${id}.json`,
      type: 'JSON',
      content: annotationsData,
      savedAt: new Date().toISOString()
    };
    
    annotationsList.push(newAnnotation);
    localStorage.setItem(`saved_annotations_${id}`, JSON.stringify(annotationsList));

    toast({
      title: "Annotations saved",
      description: `Classification annotations saved as JSON file`,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center pt-16">
          <div>Loading...</div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex flex-col pt-16">
        {/* Header */}
        <div className="px-6 py-4 border-b bg-background">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" asChild>
                <Link to={`/datasets/${id}/annotate`}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back to Annotation Choice
                </Link>
              </Button>
              <div>
                <h1 className="text-2xl font-semibold">Classification</h1>
                <p className="text-muted-foreground">
                  Assign class labels to images ({images.length} total images)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handleSaveAnnotations} className="mr-4">
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handlePrevPage}
                disabled={currentPage === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground px-3">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={handleNextPage}
                disabled={currentPage === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex">
          {/* Main Content */}
          <div className="flex-1 p-6">
            {/* Controls */}
            <div className="mb-6">
              <ImageDisplayControls
                imagesPerPage={settings.imagesPerPage}
                onImagesPerPageChange={updateImagesPerPage}
                imageSize={settings.imageSize}
                onImageSizeChange={handleImageSizeChange}
              />
            </div>

            {/* Images Grid */}
            <div className="mb-6">
              <div 
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${settings.imageSize}px, 1fr))`
                }}
              >
                {paginatedImages.map((image) => {
                  const imageClasses = classifications[image.id] || [];
                  return (
                    <Card key={image.id} className="overflow-hidden">
                      <div className="relative">
                        <img
                          src={image.url}
                          alt={image.fileName}
                          className="w-full aspect-square object-cover"
                          style={{ height: `${settings.imageSize}px` }}
                        />
                        {imageClasses.length > 0 && (
                          <div className="absolute top-2 left-2">
                            <Badge variant="secondary" className="text-xs">
                              {imageClasses.length} class{imageClasses.length !== 1 ? 'es' : ''}
                            </Badge>
                          </div>
                        )}
                      </div>
                      <CardContent className="p-3">
                        <p className="text-xs text-muted-foreground truncate mb-2">
                          {image.fileName}
                        </p>
                        <div className="space-y-1">
                          {classes.map((className) => {
                            const isAssigned = imageClasses.includes(className);
                            return (
                              <Button
                                key={className}
                                variant={isAssigned ? "default" : "outline"}
                                size="sm"
                                className="w-full h-7 text-xs"
                                onClick={() => handleImageClassToggle(image.id, className)}
                              >
                                {isAssigned && <Check className="h-3 w-3 mr-1" />}
                                {className}
                              </Button>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Pagination */}
            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </div>

          {/* Class Management Panel */}
          <div className="w-80 border-l bg-background p-6">
            <ScrollArea className="h-full">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold mb-4">Class Management</h3>
                  
                  {/* Add new class */}
                  <div className="flex gap-2 mb-4">
                    <Input
                      value={newClass}
                      onChange={(e) => setNewClass(e.target.value)}
                      placeholder="Add new class"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleAddClass();
                        }
                      }}
                    />
                    <Button onClick={handleAddClass} size="icon">
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Available classes */}
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">
                      Available Classes ({classes.length})
                    </h4>
                    {classes.map((className) => {
                      const totalAssigned = Object.values(classifications).filter(
                        imageClasses => imageClasses.includes(className)
                      ).length;
                      
                      return (
                        <Card key={className} className="p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <p className="font-medium">{className}</p>
                              <p className="text-xs text-muted-foreground">
                                {totalAssigned} image{totalAssigned !== 1 ? 's' : ''} assigned
                              </p>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleAssignToAllOnPage(className)}
                              >
                                Assign to Page
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleRemoveClass(className)}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>

                {/* Bulk operations */}
                {selectedClass && (
                  <div>
                    <h4 className="text-sm font-medium text-muted-foreground mb-3">
                      Bulk Operations
                    </h4>
                    <Card className="p-3">
                      <p className="text-sm mb-3">Selected: {selectedClass}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => handleAssignToAllOnPage(selectedClass)}
                      >
                        Assign to All on Page
                      </Button>
                    </Card>
                  </div>
                )}

                {/* Statistics */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">
                    Statistics
                  </h4>
                  <Card className="p-3">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Total Images:</span>
                        <span>{images.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Classes:</span>
                        <span>{classes.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Classified Images:</span>
                        <span>
                          {Object.keys(classifications).filter(
                            imageId => classifications[imageId].length > 0
                          ).length}
                        </span>
                      </div>
                    </div>
                  </Card>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </main>
    </div>
  );
}