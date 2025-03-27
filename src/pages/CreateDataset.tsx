
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Dataset } from "@/types";
import { DatasetForm } from "@/components/DatasetForm";
import { toast } from "@/hooks/use-toast";

const CreateDataset = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  
  // Handle dataset info submission
  const onInfoSubmit = async (
    data: {
      name?: string; 
      description?: string;
      type?: "classification" | "segmentation" | "panomatic";
      tags?: string;
    }, 
    logoFile?: File
  ) => {
    if (!data.name || !data.description) {
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
      
      // Parse tags from string to array
      const tags = data.tags ? data.tags.split(',').map(tag => tag.trim()) : [];
      
      // Create a mock dataset with generated ID
      const newDataset: Dataset = {
        id: Math.random().toString(36).substring(2, 11),
        name: data.name,
        description: data.description,
        type: data.type,
        tags: tags,
        createdAt: new Date().toISOString(),
        imageCount: 0,
        annotationCount: 0,
        thumbnailUrl
      };
      
      // Show success message
      toast({
        title: "Dataset created",
        description: `${data.name} has been successfully created. You can now add images and annotations.`,
      });
      
      // Navigate to the dataset edit page
      navigate(`/datasets/${newDataset.id}/edit`);
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
  
  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <main className="container max-w-3xl pt-32 animate-fade-in">
        <h1 className="text-3xl font-bold mb-2">Create New Dataset</h1>
        <p className="text-muted-foreground mb-8">
          Create a new dataset for your machine learning project
        </p>
        
        <DatasetForm 
          onSubmit={onInfoSubmit}
          loading={loading}
        />
      </main>
    </div>
  );
};

export default CreateDataset;
