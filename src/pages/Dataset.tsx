
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Dataset as DatasetType, Image } from "@/types";
import { ImageUploadDialog } from "@/components/ImageUploadDialog";
import { DatasetHeader } from "@/components/DatasetHeader";
import { ImagesTabContent } from "@/components/ImagesTabContent";
import { AnnotationsContent } from "@/components/AnnotationsContent";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { DatasetBreadcrumb } from "@/components/DatasetBreadcrumb";

export default function Dataset() {
  const { id } = useParams<{ id: string }>();
  const { api } = useApi();
  const { toast } = useToast();
  const [dataset, setDataset] = useState<DatasetType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [images, setImages] = useState<Image[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [imagesPerPage, setImagesPerPage] = useState(20);
  const [imageSize, setImageSize] = useState(160);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  
  // Default direction is vertical (annotations on top, images on bottom)
  const [direction, setDirection] = useState<"vertical" | "horizontal">("vertical");
  
  const totalPages = Math.ceil((images?.length || 0) / imagesPerPage);
  const paginatedImages = images.slice(
    (currentPage - 1) * imagesPerPage,
    currentPage * imagesPerPage
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
        toast({
          title: "Success",
          description: `Successfully uploaded ${files.length} images`,
        });
        fetchDataset();
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

  // Toggle layout direction (vertical/horizontal)
  const toggleDirection = () => {
    setDirection(prev => prev === "vertical" ? "horizontal" : "vertical");
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
        
        <div className="mb-4 flex items-center gap-4">
          <button
            onClick={toggleDirection}
            className="flex items-center justify-center p-2 bg-gray-800 rounded-md hover:bg-gray-700 transition-colors text-sm"
            title={direction === "vertical" ? "Switch to horizontal layout" : "Switch to vertical layout"}
          >
            {direction === "vertical" ? (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="18" height="8" rx="1" stroke="currentColor" strokeWidth="2" />
                <rect x="3" y="13" width="18" height="8" rx="1" stroke="currentColor" strokeWidth="2" />
              </svg>
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="3" y="3" width="8" height="18" rx="1" stroke="currentColor" strokeWidth="2" />
                <rect x="13" y="3" width="8" height="18" rx="1" stroke="currentColor" strokeWidth="2" />
              </svg>
            )}
          </button>
          <span className="text-sm text-muted-foreground">
            Drag the handle between panels to resize • Click the icon to change layout orientation
          </span>
        </div>

        <ResizablePanelGroup
          direction={direction}
          className="min-h-[80vh] border rounded-lg bg-gray-950/20"
        >
          {/* Annotations panel */}
          <ResizablePanel defaultSize={40} minSize={20}>
            <div className="p-4 h-full">
              <AnnotationsContent id={id || ''} />
            </div>
          </ResizablePanel>
          
          {/* Resizable handle with visual indicator */}
          <ResizableHandle withHandle />
          
          {/* Images panel */}
          <ResizablePanel defaultSize={60}>
            <div className="p-4 h-full">
              <ImagesTabContent
                id={id || ''}
                images={images}
                currentPage={currentPage}
                imagesPerPage={imagesPerPage}
                imageSize={imageSize}
                onImagesPerPageChange={setImagesPerPage}
                onImageSizeChange={(value) => setImageSize(value[0])}
                onPageChange={setCurrentPage}
                onOpenUploadDialog={() => setIsUploadDialogOpen(true)}
                onDeleteImage={handleDeleteImage}
                paginatedImages={paginatedImages}
                totalPages={totalPages}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        <ImageUploadDialog 
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onFilesSelected={handleUploadImages}
        />
      </main>
    </div>
  );
}
