
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Dataset as DatasetType } from "@/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImageUploadDialog } from "@/components/ImageUploadDialog";
import { Card } from "@/components/ui/card";
import { DatasetHeader } from "@/components/DatasetHeader";
import { ImagesTabContent } from "@/components/ImagesTabContent";

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
  
  const totalPages = Math.ceil((images?.length || 0) / imagesPerPage);
  const paginatedImages = images.slice(
    (currentPage - 1) * imagesPerPage,
    currentPage * imagesPerPage
  );

  useEffect(() => {
    const fetchDataset = async () => {
      if (!id || !api) return;

      try {
        setIsLoading(true);
        const response = await api.getDataset(id);
        if (response.success && response.data) {
          setDataset(response.data);
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
        const datasetResponse = await api.getDataset(id);
        if (datasetResponse.success && datasetResponse.data) {
          setDataset(datasetResponse.data);
        }
        const imagesResponse = await api.getImages(id);
        if (imagesResponse.success && imagesResponse.data) {
          setImages(imagesResponse.data);
        }
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

  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      <main className="container max-w-7xl mx-auto px-4 pt-24">
        <DatasetHeader 
          isLoading={isLoading} 
          name={dataset?.name} 
        />

        <Tabs defaultValue="images" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="images">Images</TabsTrigger>
            <TabsTrigger value="annotations">Annotations</TabsTrigger>
          </TabsList>

          <TabsContent value="images">
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
              paginatedImages={paginatedImages}
              totalPages={totalPages}
            />
          </TabsContent>

          <TabsContent value="annotations" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Annotations</h2>
            </div>
            <Card className="p-6">
              <p className="text-muted-foreground text-center">
                Annotation functionality will be implemented here
              </p>
            </Card>
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
