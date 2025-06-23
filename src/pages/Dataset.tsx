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
  
  // Use persistent settings hook
  const { settings, updateImagesPerPage, updateImageSize, updateLayout, updateSliderPosition } = useDatasetSettings(id || '');
  
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
    if (!api || !id) return;
    
    try {
      const response = await api.deleteImage(id, imageId);
      
      if (response.success) {
        toast({
          title: "Success",
          description: "Image deleted successfully",
        });
        
        // Update the images state
        setImages(prevImages => prevImages.filter(image => image.id !== imageId));
        
        // Adjust current page if needed after deletion
        if (paginatedImages.length === 1 && currentPage > 1) {
          setCurrentPage(currentPage - 1);
        }
      } else {
        throw new Error(response.error || 'Delete failed');
      }
    } catch (error) {
      console.error('Error deleting image:', error);
      toast({
        title: "Error",
        description: "Failed to delete image",
        variant: "destructive",
      });
    }
  };

  // Add function to handle annotation visibility changes
  const handleShowAnnotationsChange = (show: boolean, annotationId: string | null) => {
    setShowAnnotations(show);
    setActiveAnnotationId(annotationId);
    
    if (show && annotationId) {
      // Create some mock annotation samples for demonstration
      const mockAnnotations: AnnotationSample[] = [];
      
      // Generate annotations for the currently visible images
      for (let image of paginatedImages) {
        // Add 1-3 random annotations per image
        const annotationCount = Math.floor(Math.random() * 3) + 1;
        
        for (let i = 0; i < annotationCount; i++) {
          const classes = ["Car", "Person", "Traffic Light", "Bicycle", "Stop Sign"];
          const colors = ["#3498db", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6"];
          const classIndex = Math.floor(Math.random() * classes.length);
          
          // Create annotation with random position and size
          mockAnnotations.push({
            id: `${image.id}-anno-${i}`,
            imageId: image.id,
            className: classes[classIndex],
            confidence: Math.random() * 0.5 + 0.5,
            bbox: [
              Math.random() * 0.6, // x
              Math.random() * 0.6, // y
              Math.random() * 0.3 + 0.1, // width
              Math.random() * 0.3 + 0.1  // height
            ],
            color: colors[classIndex]
          });
        }
      }
      
      setVisibleAnnotations(mockAnnotations);
    } else {
      // Clear annotations when turned off
      setVisibleAnnotations([]);
    }
  };

  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      <main className="container max-w-7xl mx-auto px-4 pt-24">
        <DatasetBreadcrumb 
          projectId={projectId} 
          projectName={projectName} 
          datasetName={dataset?.name}
          isLoading={isLoading}
        />
        
        <DatasetHeader 
          isLoading={isLoading} 
          name={dataset?.name} 
        />
        
        <LayoutControls 
          currentLayout={settings.layout}
          onLayoutChange={updateLayout}
        />
        
        <ResizableDatasetLayout
          layout={settings.layout}
          id={id || ''}
          images={images}
          currentPage={currentPage}
          imagesPerPage={settings.imagesPerPage}
          imageSize={settings.imageSize}
          sliderPosition={settings.sliderPosition}
          onImagesPerPageChange={updateImagesPerPage}
          onImageSizeChange={(value) => updateImageSize(value[0])}
          onSliderPositionChange={updateSliderPosition}
          onPageChange={setCurrentPage}
          onOpenUploadDialog={() => setIsUploadDialogOpen(true)}
          onDeleteImage={handleDeleteImage}
          paginatedImages={paginatedImages}
          totalPages={totalPages}
          annotations={showAnnotations ? visibleAnnotations : []}
          onImportAnnotations={handleUploadImages}
          onShowAnnotationsChange={handleShowAnnotationsChange}
        />

        <ImageUploadDialog 
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onFilesSelected={handleUploadImages}
        />
      </main>
    </div>
  );
}
