
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { Link } from "react-router-dom";
import { ArrowRight, Database, FileImage, FolderPlus, Layers } from "lucide-react";
import { DatasetCard, DatasetCardSkeleton } from "@/components/DatasetCard";
import { useState, useEffect } from "react";
import { Dataset } from "@/types";

// Mock data for the homepage
const mockDatasets: Dataset[] = [
  {
    id: "1",
    name: "Vehicle Detection",
    description: "Urban traffic dataset with annotations for cars, trucks, and pedestrians",
    createdAt: "2023-06-15T10:30:00Z",
    imageCount: 1250,
    annotationCount: 4932,
    thumbnailUrl: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "2",
    name: "Retail Products",
    description: "Product recognition dataset with shelf items and packaging",
    createdAt: "2023-09-22T14:15:00Z",
    imageCount: 873,
    annotationCount: 3218,
    thumbnailUrl: "https://images.unsplash.com/photo-1534723328310-e82dad3ee43f?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "3",
    name: "Medical Imagery",
    description: "X-ray and MRI scans with annotated features for disease detection",
    createdAt: "2023-11-03T09:45:00Z",
    imageCount: 615,
    annotationCount: 1845,
    thumbnailUrl: "https://images.unsplash.com/photo-1530497610245-94d3c16cda28?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
  },
];

const Index = () => {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  
  useEffect(() => {
    // Simulate API call
    const fetchData = async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      setDatasets(mockDatasets);
      setLoading(false);
    };
    
    fetchData();
  }, []);
  
  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <section className="pt-32 pb-20 px-4 relative">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent" />
        <div className="container relative z-10 max-w-5xl text-center mx-auto animate-fade-in">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-balance mb-6">
            Vision AI Dataset Management
          </h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-8">
            Create, curate, and annotate high-quality datasets for computer vision. 
            Import COCO annotations, manage images, and prepare training data.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Button asChild size="lg" className="gap-2">
              <Link to="/datasets/new">
                <FolderPlus className="w-4 h-4" />
                Create New Dataset
              </Link>
            </Button>
            <Button variant="outline" asChild size="lg" className="gap-2">
              <Link to="/datasets">
                <Database className="w-4 h-4" />
                View All Datasets
              </Link>
            </Button>
          </div>
        </div>
      </section>
      
      <section className="container max-w-6xl py-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Recent Datasets</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/datasets" className="flex items-center gap-1">
              View all <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {loading
            ? Array(3).fill(0).map((_, i) => <DatasetCardSkeleton key={i} />)
            : datasets.map(dataset => (
                <DatasetCard key={dataset.id} dataset={dataset} />
              ))
          }
        </div>
      </section>
      
      <section className="container max-w-6xl py-12">
        <h2 className="text-2xl font-semibold mb-8">Features</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="glass-card p-6 rounded-xl">
            <div className="rounded-full bg-primary/10 p-3 w-fit mb-4">
              <FileImage className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">Image Management</h3>
            <p className="text-muted-foreground">
              Upload, categorize, and browse images with powerful filtering and search capabilities.
            </p>
          </div>
          
          <div className="glass-card p-6 rounded-xl">
            <div className="rounded-full bg-primary/10 p-3 w-fit mb-4">
              <Layers className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">COCO Annotations</h3>
            <p className="text-muted-foreground">
              Import and export industry-standard COCO format annotations for object detection and segmentation.
            </p>
          </div>
          
          <div className="glass-card p-6 rounded-xl">
            <div className="rounded-full bg-primary/10 p-3 w-fit mb-4">
              <Database className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-xl font-medium mb-2">Dataset Versioning</h3>
            <p className="text-muted-foreground">
              Track changes, create versions, and maintain the lineage of your datasets over time.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Index;
