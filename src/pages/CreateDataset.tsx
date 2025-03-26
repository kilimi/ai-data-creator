
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Dataset } from "@/types";
import { DatasetForm } from "@/components/DatasetForm";
import { toast } from "@/hooks/use-toast";

const CreateDataset = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  
  const onSubmit = async (data: Omit<Dataset, "id" | "createdAt" | "imageCount" | "annotationCount">) => {
    setLoading(true);
    
    try {
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Create a mock dataset with generated ID
      const newDataset: Dataset = {
        id: Math.random().toString(36).substring(2, 11),
        name: data.name,
        description: data.description,
        createdAt: new Date().toISOString(),
        imageCount: 0,
        annotationCount: 0,
        thumbnailUrl: data.thumbnailUrl
      };
      
      // Show success message
      toast({
        title: "Dataset created",
        description: `${data.name} has been successfully created.`,
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

  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <main className="container max-w-3xl pt-32 animate-fade-in">
        <h1 className="text-3xl font-bold mb-2">Create New Dataset</h1>
        <p className="text-muted-foreground mb-8">
          Create a new dataset for your machine learning project
        </p>
        
        <DatasetForm 
          onSubmit={onSubmit}
          loading={loading}
        />
      </main>
    </div>
  );
};

export default CreateDataset;
