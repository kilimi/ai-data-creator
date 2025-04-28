import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Upload, Pencil, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Dataset as DatasetType, Image } from "@/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImageUploadDialog } from "@/components/ImageUploadDialog";
import { Card } from "@/components/ui/card";
import { ImageDisplayControls } from "@/components/ImageDisplayControls";

export default function Dataset() {
  const { id } = useParams<{ id: string }>();
  const { api } = useApi();
  const { toast } = useToast();
  const [dataset, setDataset] = useState<DatasetType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [images, setImages] = useState<Image[]>([]);
  const [imageLoadErrors, setImageLoadErrors] = useState<Record<string, boolean>>({});
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
        <div className="flex items-center gap-2 mb-6">
          <Button 
            variant="ghost" 
            size="icon" 
            asChild
            className="h-9 w-9"
          >
            <Link to="/datasets">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">
            {isLoading ? 'Loading...' : dataset?.name}
          </h1>
        </div>

        <Tabs defaultValue="images" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="images">Images</TabsTrigger>
            <TabsTrigger value="annotations">Annotations</TabsTrigger>
          </TabsList>

          <TabsContent value="images" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Images</h2>
              <div className="flex gap-2">
                <Button asChild>
                  <Link to={`/datasets/${id}/annotate`}>
                    <Pencil className="w-4 h-4 mr-2" />
                    Annotate
                  </Link>
                </Button>
                <Button onClick={() => setIsUploadDialogOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Images
                </Button>
              </div>
            </div>

            <ImageDisplayControls
              imagesPerPage={imagesPerPage}
              onImagesPerPageChange={setImagesPerPage}
              imageSize={imageSize}
              onImageSizeChange={(value) => setImageSize(value[0])}
            />

            {dataset?.image_count === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-muted-foreground mb-4">No images uploaded yet</p>
                <Button onClick={() => setIsUploadDialogOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Images
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {paginatedImages.map((image) => (
                  <div 
                    key={image.id}
                    className="cursor-pointer relative group rounded-md overflow-hidden border border-gray-700 bg-gray-800 hover:border-blue-500/50 transition-colors"
                    style={{ width: imageSize, height: imageSize }}
                  >
                    <div className="aspect-square relative">
                      {imageLoadErrors[image.id] ? (
                        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                          <p className="text-xs text-center px-2">Failed to load image</p>
                        </div>
                      ) : (
                        <img 
                          src={image.url}
                          alt={image.fileName} 
                          className="w-full h-full object-cover"
                          onError={() => setImageLoadErrors(prev => ({ ...prev, [image.id]: true }))}
                          loading="lazy"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between items-center mt-4">
              <Button 
                variant="ghost" 
                size="icon" 
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <span className="text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <Button 
                variant="ghost" 
                size="icon" 
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="annotations" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Annotations</h2>
              <Button asChild>
                <Link to={`/datasets/${id}/annotate`}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Annotate Images
                </Link>
              </Button>
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
