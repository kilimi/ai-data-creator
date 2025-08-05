import { useState, useEffect, useCallback, useMemo } from "react";
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
import { OptimizedClassificationStorage, LocalStorageCleanup } from "@/utils/optimizedStorage";

interface ClassificationData {
  [imageId: string]: string[];
}

export default function Classification() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { api, isConfigured } = useApi();
  
  // Dataset settings
  const datasetId = id || '';
  const { settings, updateImagesPerPage, updateImageSize } = useDatasetSettings(datasetId);
  
  // Optimized storage instance
  const storage = useMemo(() => {
    return datasetId ? new OptimizedClassificationStorage(datasetId) : null;
  }, [datasetId]);
  
  // Data states
  const [images, setImages] = useState<Image[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [classifications, setClassifications] = useState<ClassificationData>({});
  const [loading, setLoading] = useState(true);
  
  // UI states
  const [newClass, setNewClass] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [hasShownQuotaWarning, setHasShownQuotaWarning] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(false); // Whether to store data temporarily
  
  // Calculate pagination
  const totalPages = Math.ceil(images.length / settings.imagesPerPage);
  const paginatedImages = images.slice(
    (currentPage - 1) * settings.imagesPerPage,
    currentPage * settings.imagesPerPage
  );

  // Load images and existing classifications
  useEffect(() => {
    const loadData = async () => {
      if (!id) {
        console.error('No dataset ID provided');
        setLoading(false);
        return;
      }
      
      // Wait for API to be configured
      if (!isConfigured) {
        console.log('API not configured yet, waiting...');
        return;
      }
      
      try {
        setLoading(true);
        
        // Load images if API is available
        if (api) {
          console.log('Loading images for dataset:', id);
          const imagesRes = await api.getImages(id);
          if (imagesRes.success && imagesRes.data) {
            setImages(imagesRes.data);
            console.log('Loaded', imagesRes.data.length, 'images');
          } else {
            console.warn('Failed to load images:', imagesRes.error);
          }
        } else {
          console.warn('API client not available');
        }
        
        // Load existing classifications from optimized storage
        if (storage) {
          console.log('Loading classifications from storage');
          const { classifications: loadedClassifications, classes: loadedClasses } = storage.loadClassifications();
          setClassifications(loadedClassifications);
          setClasses(loadedClasses);
          console.log('Loaded', Object.keys(loadedClassifications).length, 'classifications and', loadedClasses.length, 'classes');
          
          // Try to migrate legacy data if optimized data is empty but legacy exists
          if (Object.keys(loadedClassifications).length === 0) {
            console.log('Attempting legacy data migration');
            const migrated = storage.migrateLegacyData();
            if (migrated) {
              const { classifications: migratedClassifications, classes: migratedClasses } = storage.loadClassifications();
              setClassifications(migratedClassifications);
              setClasses(migratedClasses);
              console.log('Migrated', Object.keys(migratedClassifications).length, 'classifications');
            }
          }
        }
        
        // Clean up old classification data to free space (keep only 3 most recent datasets)
        const cleanedCount = LocalStorageCleanup.cleanupClassificationData(3);
        if (cleanedCount > 0) {
          console.log(`Cleaned up ${cleanedCount} old classification datasets to free space`);
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
        console.log('Classification component loading completed');
      }
    };
    
    loadData();
  }, [id, api, isConfigured, toast]);

  // Save classifications to optimized localStorage (with session-only option)
  const saveClassifications = useCallback((newClassifications: ClassificationData) => {
    if (id && storage && !sessionOnly) {
      try {
        const success = storage.saveClassifications(newClassifications, classes);
        if (success) {
          setClassifications(newClassifications);
        } else {
          throw new Error('Failed to save to optimized storage');
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'QuotaExceededError') {
          console.warn('localStorage quota exceeded, switching to session-only mode');
          
          // Show warning and switch to session-only mode
          if (!hasShownQuotaWarning) {
            setHasShownQuotaWarning(true);
            setSessionOnly(true);
            toast({
              title: "Storage full - Session mode",
              description: "Classifications will work but won't persist after page reload. Save your work before leaving!",
              variant: "destructive",
            });
          }
          
          // Just update state without localStorage
          setClassifications(newClassifications);
          
        } else {
          console.error('Error saving classifications:', error);
          // Fallback to legacy storage
          try {
            localStorage.setItem(`classifications_${id}`, JSON.stringify(newClassifications));
            setClassifications(newClassifications);
          } catch (fallbackError) {
            // If even legacy fails, go session-only
            setSessionOnly(true);
            setClassifications(newClassifications);
          }
        }
      }
    } else {
      // Session-only mode or no storage
      setClassifications(newClassifications);
    }
  }, [id, storage, classes, sessionOnly, hasShownQuotaWarning, toast]);

  // Save classes to optimized localStorage (with session-only option)
  const saveClasses = useCallback((newClasses: string[]) => {
    if (id && storage && !sessionOnly) {
      try {
        // Save current classifications with new classes
        storage.saveClassifications(classifications, newClasses);
        setClasses(newClasses);
      } catch (error) {
        if (error instanceof Error && error.name === 'QuotaExceededError') {
          console.warn('localStorage quota exceeded, switching to session-only mode');
          setSessionOnly(true);
          toast({
            title: "Storage full - Session mode", 
            description: "Classes will work but won't persist after reload. Save before leaving!",
            variant: "destructive",
          });
          // Still update the state even if localStorage fails
          setClasses(newClasses);
        } else {
          console.error('Error saving classes:', error);
          // Fallback to legacy storage
          try {
            localStorage.setItem(`classification_classes_${id}`, JSON.stringify(newClasses));
            setClasses(newClasses);
          } catch (fallbackError) {
            setSessionOnly(true);
            setClasses(newClasses);
          }
        }
      }
    } else {
      // Session-only mode
      setClasses(newClasses);
    }
  }, [id, storage, classifications, sessionOnly, toast]);

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

  // Assign class to all images without any classes on current page
  const handleAssignWithoutClasses = (className: string) => {
    const updatedClassifications = { ...classifications };
    let assignedCount = 0;
    
    paginatedImages.forEach(image => {
      const currentClasses = updatedClassifications[image.id] || [];
      // Only assign if image has no classes assigned
      if (currentClasses.length === 0) {
        updatedClassifications[image.id] = [className];
        assignedCount++;
      }
    });
    
    saveClassifications(updatedClassifications);
    
    toast({
      title: "Class assigned to unclassified",
      description: `Assigned "${className}" to ${assignedCount} unclassified images on this page`,
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

  // Go to next page with unlabeled images
  const handleGoToUnlabelled = () => {
    const imagesPerPage = settings.imagesPerPage;
    
    for (let page = 1; page <= totalPages; page++) {
      const startIndex = (page - 1) * imagesPerPage;
      const endIndex = Math.min(startIndex + imagesPerPage, images.length);
      const pageImages = images.slice(startIndex, endIndex);
      
      // Check if this page has any unlabeled images
      const hasUnlabeled = pageImages.some(image => {
        const imageClasses = classifications[image.id] || [];
        return imageClasses.length === 0;
      });
      
      if (hasUnlabeled) {
        setCurrentPage(page);
        toast({
          title: "Navigated to unlabeled images",
          description: `Moved to page ${page} which contains unlabeled images`,
        });
        return;
      }
    }
    
    toast({
      title: "No unlabeled images found",
      description: "All images have been classified",
    });
  };

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when no input is focused
      if (e.target instanceof HTMLInputElement) return;
      
      if (selectedClass && e.ctrlKey) {
        if (e.key === 'a') {
          e.preventDefault();
          handleAssignToAllOnPage(selectedClass);
        } else if (e.key === 'u') {
          e.preventDefault();
          handleAssignWithoutClasses(selectedClass);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedClass, handleAssignToAllOnPage, handleAssignWithoutClasses]);

  // Cleanup effect: Clear classification data when leaving the page
  // Since classifications are uploaded to annotations, we don't need to persist them
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Warn user if they have unsaved work and haven't saved to annotations
      if (Object.keys(classifications).length > 0) {
        e.preventDefault();
        e.returnValue = 'You have unsaved classifications. Make sure to save before leaving!';
        return 'You have unsaved classifications. Make sure to save before leaving!';
      }
    };

    const handleVisibilityChange = () => {
      // Clear data when page becomes hidden (user switched tabs/minimized)
      if (document.hidden && storage && id) {
        storage.clearData();
        console.log('Classification data cleared - page hidden');
      }
    };

    // Clear data when component unmounts (user navigates away)
    const cleanup = () => {
      if (storage && id) {
        storage.clearData();
        console.log('Classification data cleared - component unmounted');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanup();
    };
  }, [classifications, storage, id]);

  // Convert classification data to COCO format
  const convertToCOCOFormat = () => {
    // Get unique classes and create categories
    const allClasses = [...new Set(Object.values(classifications).flat())];
    const categories = allClasses.map((className, index) => ({
      id: index + 1,
      name: className
    }));

    // Create category name to ID mapping
    const categoryMap: { [name: string]: number } = {};
    categories.forEach(cat => {
      categoryMap[cat.name] = cat.id;
    });

    // Create images array
    const cocoImages = images.map((image, index) => ({
      id: index + 1,
      file_name: image.fileName,
      width: image.width || 640,
      height: image.height || 480
    }));

    // Create image filename to ID mapping
    const imageMap: { [fileName: string]: number } = {};
    cocoImages.forEach(img => {
      imageMap[img.file_name] = img.id;
    });

    // Create annotations array
    const cocoAnnotations: any[] = [];
    let annotationId = 1;

    images.forEach(image => {
      const imageClasses = classifications[image.id] || [];
      const imageId = imageMap[image.fileName];
      
      imageClasses.forEach(className => {
        const categoryId = categoryMap[className];
        if (categoryId) {
          cocoAnnotations.push({
            id: annotationId++,
            image_id: imageId,
            category_id: categoryId
          });
        }
      });
    });

    return {
      images: cocoImages,
      annotations: cocoAnnotations,
      categories: categories
    };
  };

  // Save annotations as COCO format file
  const handleSaveAnnotations = async () => {
    try {
      // Convert to COCO format
      const cocoData = convertToCOCOFormat();

      // Create JSON file
      const jsonContent = JSON.stringify(cocoData, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const fileName = `classifications_${id}_coco.json`;

      // Download file locally
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Upload to backend if API is available
      if (api) {
        try {
          const file = new File([jsonContent], fileName, { type: 'application/json' });
          const result = await api.importAnnotations(id!, file);
          
          if (result.success) {
            toast({
              title: "Annotations saved",
              description: `Classification annotations saved in COCO format and uploaded to dataset`,
            });
            
            // Clear classification data after successful upload since it's now stored as annotations
            if (storage) {
              storage.clearData();
              console.log('Classification data cleared after successful upload');
            }
            
          } else {
            throw new Error(result.error || 'Failed to upload to backend');
          }
        } catch (uploadError) {
          console.error('Failed to upload to backend:', uploadError);
          toast({
            title: "Partially saved",
            description: `File downloaded locally, but failed to upload to dataset: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`,
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Annotations saved",
          description: `Classification annotations saved in COCO format (local download only)`,
        });
      }

    } catch (error) {
      console.error('Error saving annotations:', error);
      toast({
        title: "Save failed",
        description: error instanceof Error ? error.message : "Failed to save annotations",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 flex items-center justify-center pt-16">
          <div className="text-center">
            <div className="text-lg mb-2">Loading...</div>
            {!isConfigured && <div className="text-sm text-muted-foreground">Configuring API connection...</div>}
          </div>
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
              <Button onClick={handleSaveAnnotations} className="mr-2">
                <Save className="h-4 w-4 mr-2" />
                Save & Upload
              </Button>
              {sessionOnly && (
                <Badge variant="destructive" className="mr-2">
                  Session Only
                </Badge>
              )}
              <Button 
                variant="outline" 
                onClick={handleGoToUnlabelled}
                className="mr-4"
              >
                Go to Unlabelled
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
                      <span className="text-xs ml-2 opacity-60">Click to select for bulk ops</span>
                    </h4>
                    {classes.map((className) => {
                      const totalAssigned = Object.values(classifications).filter(
                        imageClasses => imageClasses.includes(className)
                      ).length;
                      
                      return (
                        <Card 
                          key={className} 
                          className={`p-3 cursor-pointer transition-colors ${
                            selectedClass === className ? 'ring-2 ring-primary bg-primary/5' : ''
                          }`}
                          onClick={() => setSelectedClass(selectedClass === className ? null : className)}
                        >
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAssignToAllOnPage(className);
                                }}
                                title="Assign to all images on page (Ctrl+A)"
                              >
                                AP
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleAssignWithoutClasses(className);
                                }}
                                title="Assign to unclassified images on page (Ctrl+U)"
                              >
                                AU
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRemoveClass(className);
                                }}
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
                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => handleAssignToAllOnPage(selectedClass)}
                          title="Assign to all images on page (Ctrl+A)"
                        >
                          AP - Assign to All
                          <span className="ml-2 text-xs opacity-60">Ctrl+A</span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => handleAssignWithoutClasses(selectedClass)}
                          title="Assign to unclassified images on page (Ctrl+U)"
                        >
                          AU - Assign Unclassified
                          <span className="ml-2 text-xs opacity-60">Ctrl+U</span>
                        </Button>
                      </div>
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
                      <div className="flex justify-between">
                        <span>Unclassified Images:</span>
                        <span>
                          {images.length - Object.keys(classifications).filter(
                            imageId => classifications[imageId].length > 0
                          ).length}
                        </span>
                      </div>
                      <hr className="my-2" />
                      <div className="flex justify-between text-xs">
                        <span>Storage Mode:</span>
                        <span className={sessionOnly ? 'text-orange-600' : 'text-green-600'}>
                          {sessionOnly ? 'Session Only' : 'Persistent'}
                        </span>
                      </div>
                      {storage && (() => {
                        const stats = storage.getStorageStats();
                        return (
                          <>
                            <div className="flex justify-between text-xs">
                              <span>Storage Used:</span>
                              <span>{(stats.totalSize / 1024).toFixed(1)} KB</span>
                            </div>
                            {stats.savings > 0 && (
                              <div className="flex justify-between text-xs text-green-600">
                                <span>Space Saved:</span>
                                <span>{stats.savings.toFixed(1)}%</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      {sessionOnly && (
                        <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-800">
                          ⚠️ Session mode: Data won't persist after reload. Save before leaving!
                        </div>
                      )}
                    </div>
                  </Card>
                </div>

                {/* Storage Management */}
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-3">
                    Storage Management
                  </h4>
                  <Card className="p-3">
                    <div className="space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          const cleanedCount = LocalStorageCleanup.cleanupClassificationData(2);
                          toast({
                            title: "Storage cleaned",
                            description: `Removed ${cleanedCount} old classification datasets`,
                          });
                        }}
                      >
                        Clean Old Data
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          const analysis = LocalStorageCleanup.analyzeUsage();
                          const totalMB = (analysis.totalSize / (1024 * 1024)).toFixed(2);
                          toast({
                            title: "Storage Analysis",
                            description: `Total usage: ${totalMB} MB. Check console for details.`,
                          });
                          console.log('Storage Analysis:', analysis);
                        }}
                      >
                        Analyze Storage
                      </Button>
                      {storage && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => {
                            storage.clearData();
                            setClassifications({});
                            setClasses([]);
                            toast({
                              title: "Data cleared",
                              description: "All classification data has been cleared",
                            });
                          }}
                        >
                          Clear Current Data
                        </Button>
                      )}
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