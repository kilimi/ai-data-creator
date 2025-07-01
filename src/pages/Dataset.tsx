import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Dataset as DatasetType, Image } from "@/types";
import { ImageUploadDialog } from "@/components/ImageUploadDialog";
import { DatasetHeader } from "@/components/DatasetHeader";
import { DatasetBreadcrumb } from "@/components/DatasetBreadcrumb";
import { AnnotationSample } from "@/utils/annotations";
import { LayoutControls, LayoutType } from "@/components/LayoutControls";
import { ResizableDatasetLayout } from "@/components/ResizableDatasetLayout";
import { useDatasetSettings } from "@/hooks/useDatasetSettings";

export default function Dataset() {
  const { id } = useParams<{ id: string }>();
  const { api } = useApi();
  const { toast } = useToast();
  const [dataset, setDataset] = useState<DatasetType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [images, setImages] = useState<Image[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [visibleAnnotations, setVisibleAnnotations] = useState<AnnotationSample[]>([]);
  const [importedAnnotations, setImportedAnnotations] = useState<AnnotationSample[]>([]);
  
  // Use persistent settings hook with better ID handling
  const datasetId = id || '';
  const { settings, isLoaded: settingsLoaded, updateImagesPerPage, updateImageSize, updateLayout, updateSliderPosition } = useDatasetSettings(datasetId);
  
  console.log('Dataset component render - ID:', id, 'Settings loaded:', settingsLoaded, 'Current settings:', settings);
  
  // Calculate pagination values using persistent settings
  const totalPages = Math.ceil((images?.length || 0) / settings.imagesPerPage);
  
  // Update currentPage when imagesPerPage changes
  useEffect(() => {
    const newTotalPages = Math.ceil(images.length / settings.imagesPerPage);
    if (currentPage > newTotalPages && newTotalPages > 0) {
      setCurrentPage(1);
    }
  }, [settings.imagesPerPage, images.length, currentPage]);

  // Calculate paginated images using persistent settings
  const paginatedImages = images.slice(
    (currentPage - 1) * settings.imagesPerPage,
    currentPage * settings.imagesPerPage
  );

  const fetchDataset = async () => {
    if (!id || !api) return;

    try {
      setIsLoading(true);
      const response = await api.getDataset(id);
      if (response.success && response.data) {
        setDataset(response.data);
        
        // If dataset has project_id, fetch the project name
        if (response.data.project_id) {
          setProjectId(response.data.project_id.toString());
          const projectResponse = await api.getProject(response.data.project_id.toString());
          if (projectResponse.success && projectResponse.data) {
            setProjectName(projectResponse.data.name);
          }
        }
        
        const imagesResponse = await api.getImages(id);
        if (imagesResponse.success && imagesResponse.data) {
          setImages(imagesResponse.data);
        }
      } else {
        toast({
          title: "Error",
          description: "Failed to load dataset",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error fetching dataset:', error);
      toast({
        title: "Error",
        description: "Failed to load dataset",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDataset();
  }, [id, api, toast]);

  // Re-evaluate annotations when images change (fixes issue when annotations are uploaded before images)
  useEffect(() => {
    if (images.length > 0 && visibleAnnotations.length > 0) {
      // Find any stored annotation files that might need to be re-processed
      const savedAnnotations = localStorage.getItem(`annotations_${id}`);
      if (savedAnnotations) {
        try {
          const annotationFiles = JSON.parse(savedAnnotations);
          const savedVisibility = localStorage.getItem(`annotation_visibility_${id}`);
          if (savedVisibility) {
            const visibilityArray: string[] = JSON.parse(savedVisibility);
            const visibilitySet = new Set(visibilityArray);
            
            // Collect all visible annotations from stored files
            const allVisibleAnnotations: AnnotationSample[] = [];
            annotationFiles.forEach((file: any) => {
              if (visibilitySet.has(file.id) && file.samples) {
                const samplesWithFileName = file.samples.map((sample: any) => ({
                  ...sample,
                  annotationFileName: file.name
                }));
                allVisibleAnnotations.push(...samplesWithFileName);
              }
            });
            
            if (allVisibleAnnotations.length > 0) {
              setShowAnnotations(true);
              setVisibleAnnotations(allVisibleAnnotations);
            }
          }
        } catch (error) {
          console.error('Error re-processing annotations after image load:', error);
        }
      }
    }
  }, [images.length, id]);

  const handleUploadImages = async (files: File[]) => {
    if (!api || !id) return;

    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file);
      });

      const response = await api.uploadImages(id, formData);
      
      if (response.success) {
        // Update images state with the newly uploaded images
        if (response.data?.images) {
          setImages(prevImages => [...prevImages, ...response.data.images]);
        }
        
        toast({
          title: "Success",
          description: `Successfully uploaded ${files.length} images`,
        });
      } else {
        throw new Error(response.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Error uploading images:', error);
      toast({
        title: "Error",
        description: "Failed to upload images",
        variant: "destructive",
      });
    }
    setIsUploadDialogOpen(false);
  };
  const handleDeleteImage = async (imageId: string) => {
    if (!id) return;
    
    try {
      // Always delete locally first
      setImages(prevImages => prevImages.filter(image => image.id !== imageId));
      
      // Adjust current page if needed after deletion
      if (paginatedImages.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      }
      
      // Try to delete via API if available (but don't fail if it doesn't work)
      if (api) {
        try {
          const response = await api.deleteImage(id, imageId);
          if (response.success) {
            console.log('Image deleted from backend successfully');
          } else {
            console.warn('Backend delete failed (this is non-critical):', response.error);
          }
        } catch (apiError) {
          console.warn('Backend delete failed (this is non-critical):', apiError);
          // Don't fail the whole process if backend fails - local deletion already succeeded
        }
      } else {
        console.log('No API available, skipping backend delete');
      }
      
      toast({
        title: "Success",
        description: "Image deleted successfully",
      });
      
    } catch (error) {
      console.error('Error deleting image:', error);
      toast({
        title: "Error",
        description: "Failed to delete image",
        variant: "destructive",
      });
    }
  };
  // Updated function to handle annotation imports with better error handling
  const handleImportAnnotations = async (files: File[]) => {
    if (!id) return;

    try {
      const successfulImports: string[] = [];
      const failedImports: Array<{ fileName: string; error: string }> = [];
      const allImportedAnnotations: AnnotationSample[] = [];
      
      for (const file of files) {
        try {
          console.log(`Processing annotation file locally: ${file.name}`);
          
          // Validate file type
          if (!file.name.toLowerCase().endsWith('.json')) {
            throw new Error('Only JSON files are supported for COCO annotations');
          }
          
          // Process the COCO file to get annotation data for local display only
          // The AnnotationsContent component handles the backend import
          const { processCOCOAnnotations } = await import('@/utils/annotations');
          const result = await processCOCOAnnotations(file, id);
          
          // Add to local state for immediate display
          allImportedAnnotations.push(...result.samples);
          
          // Note: Backend import is handled by AnnotationsContent component
          // to avoid duplicate API calls
          
          successfulImports.push(file.name);
          
        } catch (fileError) {
          console.error(`Error processing file ${file.name}:`, fileError);
          failedImports.push({
            fileName: file.name,
            error: fileError instanceof Error ? fileError.message : 'Unknown error occurred'
          });
        }
      }
      
      // Update local state with successfully imported annotations
      if (allImportedAnnotations.length > 0) {
        setImportedAnnotations(prev => [...prev, ...allImportedAnnotations]);
      }
      
      // Show appropriate success/error messages
      if (successfulImports.length > 0) {
        toast({
          title: "Annotations imported",
          description: `Successfully imported ${successfulImports.length} annotation file(s): ${successfulImports.join(', ')}`,
        });
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
      console.error("Error importing annotations:", error);
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error instanceof Error ? error.message : "There was an error importing the annotation files.",
      });
    }
  };
  // Updated function to handle annotation visibility changes with actual annotations
  const handleShowAnnotationsChange = (show: boolean, annotations: AnnotationSample[], annotationFiles?: any[]) => {
    setShowAnnotations(show);
    
    if (show && annotations.length > 0) {
      // Store all annotations - filtering will happen at display time
      setVisibleAnnotations(annotations);
    } else {
      setVisibleAnnotations([]);
    }
  };

  // Add state and persistence for selected image index (annotation position)
  const LS_ANNOTATION_POSITION_KEY = "imagesTab_selectedImageIndex";
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(() => {
    const saved = localStorage.getItem(LS_ANNOTATION_POSITION_KEY);
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  });

  useEffect(() => {
    if (selectedImageIndex !== null) {
      localStorage.setItem(LS_ANNOTATION_POSITION_KEY, selectedImageIndex.toString());
    } else {
      localStorage.removeItem(LS_ANNOTATION_POSITION_KEY);
    }
  }, [selectedImageIndex]);

  // Fix the image size change handler to properly handle the array format
  const handleImageSizeChange = (value: number[]) => {
    updateImageSize(value[0]);
  };

  if (!settingsLoaded) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex flex-col pt-16">
        <div className="px-6 py-4 border-b bg-background">
          <div>
            <DatasetBreadcrumb 
              projectId={projectId} 
              projectName={projectName} 
              datasetName={dataset?.name}
              isLoading={isLoading}
            />
            <DatasetHeader 
              isLoading={isLoading} 
              name={dataset?.name}
              currentLayout={settings.layout}
              onLayoutChange={updateLayout}
            />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ResizableDatasetLayout
            layout={settings.layout}
            id={id || ''}
            images={images}
            currentPage={currentPage}
            imagesPerPage={settings.imagesPerPage}
            imageSize={settings.imageSize}
            sliderPosition={settings.sliderPosition}
            onImagesPerPageChange={updateImagesPerPage}
            onImageSizeChange={handleImageSizeChange}
            onSliderPositionChange={updateSliderPosition}
            onPageChange={setCurrentPage}
            onOpenUploadDialog={() => setIsUploadDialogOpen(true)}
            onDeleteImage={handleDeleteImage}
            paginatedImages={paginatedImages}
            totalPages={totalPages}
            annotations={showAnnotations ? visibleAnnotations : []}
            onImportAnnotations={handleImportAnnotations}
            onShowAnnotationsChange={handleShowAnnotationsChange}
            selectedImageIndex={selectedImageIndex}
            setSelectedImageIndex={setSelectedImageIndex}
          />
        </div>
        <ImageUploadDialog 
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onFilesSelected={handleUploadImages}
        />
      </main>
    </div>
  );
}
