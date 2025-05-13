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
import { Button } from "@/components/ui/button";
import { Maximize2, Minimize2, PanelTopClose, PanelRightClose, PanelBottomClose, PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

type PanelPosition = "top" | "right" | "bottom" | "left";
type PanelLayout = "horizontal" | "vertical";

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
  
  // Panel state
  const [annotationsDetached, setAnnotationsDetached] = useState(false);
  const [annotationsPosition, setAnnotationsPosition] = useState<PanelPosition>("left");
  const [panelLayout, setPanelLayout] = useState<PanelLayout>("horizontal");
  
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

  const handlePositionChange = (position: PanelPosition) => {
    setAnnotationsPosition(position);
    setPanelLayout(position === "left" || position === "right" ? "horizontal" : "vertical");
  };

  const renderPositionControls = () => (
    <div className="flex items-center gap-2 mb-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setAnnotationsDetached(!annotationsDetached)}
        className="gap-2"
      >
        {annotationsDetached ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        {annotationsDetached ? "Attach" : "Detach"}
      </Button>
      
      {annotationsDetached && (
        <div className="flex items-center gap-1 border rounded-md p-1">
          <Button
            variant={annotationsPosition === "top" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => handlePositionChange("top")}
            className="h-8 w-8 p-0"
          >
            <PanelTopClose className="h-4 w-4" />
          </Button>
          <Button
            variant={annotationsPosition === "right" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => handlePositionChange("right")}
            className="h-8 w-8 p-0"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
          <Button
            variant={annotationsPosition === "bottom" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => handlePositionChange("bottom")}
            className="h-8 w-8 p-0"
          >
            <PanelBottomClose className="h-4 w-4" />
          </Button>
          <Button
            variant={annotationsPosition === "left" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => handlePositionChange("left")}
            className="h-8 w-8 p-0"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );

  const renderContent = () => {
    if (annotationsDetached) {
      return (
        <div className={cn(
          "flex gap-4",
          panelLayout === "horizontal" ? "flex-row" : "flex-col"
        )}>
          {/* Annotations Panel */}
          {(annotationsPosition === "left" || annotationsPosition === "top") && (
            <Card className="p-4 w-full max-w-md">
              <AnnotationsContent id={id || ''} />
            </Card>
          )}
          
          {/* Main Content */}
          <div className="flex-1">
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
          
          {/* Annotations Panel */}
          {(annotationsPosition === "right" || annotationsPosition === "bottom") && (
            <Card className="p-4 w-full max-w-md">
              <AnnotationsContent id={id || ''} />
            </Card>
          )}
        </div>
      );
    }

    return (
      <ResizablePanelGroup
        direction={panelLayout}
        className="min-h-[80vh] border rounded-lg"
      >
        <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
          <div className="p-4">
            <AnnotationsContent id={id || ''} />
          </div>
        </ResizablePanel>
        
        <ResizableHandle withHandle />
        
        <ResizablePanel defaultSize={80}>
          <div className="p-4">
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
    );
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

        {renderPositionControls()}
        {renderContent()}

        <ImageUploadDialog 
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onFilesSelected={handleUploadImages}
        />
      </main>
    </div>
  );
}
