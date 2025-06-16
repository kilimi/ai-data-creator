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
import { DatasetBreadcrumb } from "@/components/DatasetBreadcrumb";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileImage, Layers } from "lucide-react";
import { AnnotationSample } from "@/utils/annotations";

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
  const [activeTab, setActiveTab] = useState("images");
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [visibleAnnotations, setVisibleAnnotations] = useState<AnnotationSample[]>([]);
  
  // Calculate pagination values
  const totalPages = Math.ceil((images?.length || 0) / imagesPerPage);
  
  // Update currentPage when imagesPerPage changes
  useEffect(() => {
    const newTotalPages = Math.ceil(images.length / imagesPerPage);
    if (currentPage > newTotalPages) {
      setCurrentPage(1);
    }
  }, [imagesPerPage, images.length, currentPage]);

  // Calculate paginated images after state updates
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
        
        <Tabs 
          value={activeTab} 
          onValueChange={setActiveTab}
          className="space-y-4"
        >
          <TabsList className="border-b w-full justify-start rounded-none bg-transparent p-0">
            <TabsTrigger 
              value="images" 
              className="relative rounded-none border-b-2 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-b-primary data-[state=active]:text-foreground"
            >
              <FileImage className="mr-2 h-4 w-4" />
              Images
            </TabsTrigger>
            <TabsTrigger 
              value="annotations" 
              className="relative rounded-none border-b-2 border-b-transparent bg-transparent px-4 pb-3 pt-2 font-medium text-muted-foreground shadow-none transition-none data-[state=active]:border-b-primary data-[state=active]:text-foreground"
            >
              <Layers className="mr-2 h-4 w-4" />
              Annotations
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="images" className="mt-0 bg-transparent p-0">
            <div className="rounded-lg border bg-card p-6">
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
                annotations={showAnnotations ? visibleAnnotations : []}
              />
            </div>
          </TabsContent>
          
          <TabsContent value="annotations" className="mt-0 bg-transparent p-0">
            <div className="rounded-lg border bg-card p-6">
              <AnnotationsContent 
                id={id || ''} 
                onShowAnnotationsChange={handleShowAnnotationsChange}
              />
            </div>
          </TabsContent>
        </Tabs>

        <ImageUploadDialog 
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onFilesSelected={handleUploadImages}
        />
      </main>
    </div>
  );
}
