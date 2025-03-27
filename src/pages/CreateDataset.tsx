
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Dataset } from "@/types";
import { DatasetForm } from "@/components/DatasetForm";
import { toast } from "@/hooks/use-toast";
import { UploadCard } from "@/components/UploadCard";
import { processCOCOAnnotations } from "@/utils/annotations";
import { ClassStatistics } from "@/components/ClassStatistics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

const CreateDataset = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"info" | "upload">("info");
  const [formData, setFormData] = useState<{
    name?: string;
    description?: string;
    type?: "classification" | "segmentation" | "panomatic";
    tags?: string[];
  }>({});
  const [logoFile, setLogoFile] = useState<File | undefined>(undefined);
  const [images, setImages] = useState<File[]>([]);
  const [annotations, setAnnotations] = useState<File[]>([]);
  const [classStats, setClassStats] = useState<{
    className: string;
    count: number;
    color: string;
  }[]>([]);
  
  // Handle dataset info submission
  const onInfoSubmit = async (
    data: {
      name?: string; 
      description?: string;
      type?: "classification" | "segmentation" | "panomatic";
      tags?: string[];
    }, 
    logoFile?: File
  ) => {
    setFormData(data);
    setLogoFile(logoFile);
    setStep("upload");
  };
  
  // Handle image upload
  const handleImageUpload = (files: File[]) => {
    setImages(prevImages => [...prevImages, ...files]);
    toast({
      title: "Images added",
      description: `${files.length} images added successfully.`,
    });
  };
  
  // Handle annotation upload and processing
  const handleAnnotationUpload = async (files: File[]) => {
    toast({
      title: "Processing annotations",
      description: "Analyzing COCO annotation files...",
    });
    
    setAnnotations(prevAnnotations => [...prevAnnotations, ...files]);
    
    try {
      // Process the first annotation file to extract class statistics
      if (files.length > 0) {
        const stats = await processCOCOAnnotations(files[0]);
        setClassStats(stats);
        
        toast({
          title: "Annotations processed",
          description: `${stats.length} classes found in the annotations.`,
        });
      }
    } catch (error) {
      console.error("Error processing annotations:", error);
      toast({
        variant: "destructive",
        title: "Processing failed",
        description: "There was an error processing the annotation file. Please check the format.",
      });
    }
  };
  
  // Final submission to create dataset with all data
  const handleCreateDataset = async () => {
    if (!formData.name || !formData.description) {
      toast({
        variant: "destructive",
        title: "Missing information",
        description: "Please provide a name and description for your dataset.",
      });
      return;
    }
    
    setLoading(true);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // In a real app, you would upload the logo file to storage and get back a URL
      let thumbnailUrl: string | undefined = undefined;
      
      if (logoFile) {
        // Simulate file upload and getting back a URL
        thumbnailUrl = URL.createObjectURL(logoFile);
      }
      
      // Create a mock dataset with generated ID
      const newDataset: Dataset = {
        id: Math.random().toString(36).substring(2, 11),
        name: formData.name,
        description: formData.description,
        type: formData.type,
        tags: formData.tags,
        createdAt: new Date().toISOString(),
        imageCount: images.length,
        annotationCount: classStats.reduce((acc, stat) => acc + stat.count, 0),
        thumbnailUrl
      };
      
      // Show success message
      toast({
        title: "Dataset created",
        description: `${formData.name} has been successfully created with ${images.length} images and ${newDataset.annotationCount} annotations.`,
      });
      
      // Navigate to the dataset page
      navigate(`/datasets/${newDataset.id}`);
    } catch (error) {
      console.error("Error creating dataset:", error);
      toast({
        variant: "destructive",
        title: "Creation failed",
        description: "There was an error creating your dataset. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };
  
  // Go back to info step
  const handleBack = () => {
    setStep("info");
  };

  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <main className="container max-w-3xl pt-32 animate-fade-in">
        <h1 className="text-3xl font-bold mb-2">Create New Dataset</h1>
        <p className="text-muted-foreground mb-8">
          Create a new dataset for your machine learning project
        </p>
        
        {step === "info" ? (
          <DatasetForm 
            onSubmit={onInfoSubmit}
            loading={false}
          />
        ) : (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={handleBack} className="mb-4">
                Back to Dataset Info
              </Button>
              <Button 
                onClick={handleCreateDataset} 
                disabled={loading || images.length === 0} 
                className="mb-4"
              >
                {loading ? "Creating..." : "Create Dataset"}
                {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <UploadCard
                  title="Add Images"
                  description="Upload images for your dataset"
                  accept="image/jpeg,image/png,image/webp"
                  onFilesSelected={handleImageUpload}
                  type="images"
                />
              </div>
              
              <div>
                <UploadCard
                  title="Add COCO Annotations"
                  description="Upload annotations in COCO JSON format"
                  accept=".json"
                  onFilesSelected={handleAnnotationUpload}
                  type="annotations"
                />
              </div>
            </div>
            
            {classStats.length > 0 && (
              <Card className="mt-6">
                <CardContent className="pt-6">
                  <h2 className="text-xl font-semibold mb-4">Class Statistics</h2>
                  <ClassStatistics statistics={classStats} />
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default CreateDataset;
