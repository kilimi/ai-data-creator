import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Dataset as DatasetType } from "@/types";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ImageUploadDialog } from "@/components/ImageUploadDialog";
import { Card } from "@/components/ui/card";

export default function Dataset() {
  const { id } = useParams<{ id: string }>();
  const { api } = useApi();
  const { toast } = useToast();
  const [dataset, setDataset] = useState<DatasetType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  useEffect(() => {
    const fetchDataset = async () => {
      if (!id || !api) return;

      try {
        setIsLoading(true);
        const response = await api.getDataset(id);
        if (response.success && response.data) {
          setDataset(response.data);
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
        // Refresh dataset data
        const datasetResponse = await api.getDataset(id);
        if (datasetResponse.success && datasetResponse.data) {
          setDataset(datasetResponse.data);
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
              <Button onClick={() => setIsUploadDialogOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Images
              </Button>
            </div>

            {dataset?.image_count === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-muted-foreground mb-4">No images uploaded yet</p>
                <Button onClick={() => setIsUploadDialogOpen(true)}>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Images
                </Button>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {/* Image grid will be implemented here */}
              </div>
            )}
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
          onUpload={handleUploadImages}
        />
      </main>
    </div>
  );
}