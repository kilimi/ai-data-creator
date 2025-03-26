
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { Link } from "react-router-dom";
import { ArrowRight, Database, FolderPlus, Search, Tag } from "lucide-react";
import { DatasetCard, DatasetCardSkeleton } from "@/components/DatasetCard";
import { useState, useEffect } from "react";
import { Dataset } from "@/types";
import { Input } from "@/components/ui/input";

// Mock data for the homepage - expanded to have tags
const mockDatasets: Dataset[] = [
  {
    id: "1",
    name: "Vehicle Detection",
    description: "Urban traffic dataset with annotations for cars, trucks, and pedestrians",
    type: "classification",
    tags: ["traffic", "vehicles", "urban"],
    createdAt: "2023-06-15T10:30:00Z",
    imageCount: 1250,
    annotationCount: 4932,
    thumbnailUrl: "https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "2",
    name: "Retail Products",
    description: "Product recognition dataset with shelf items and packaging",
    type: "segmentation",
    tags: ["retail", "products", "packaging"],
    createdAt: "2023-09-22T14:15:00Z",
    imageCount: 873,
    annotationCount: 3218,
    thumbnailUrl: "https://images.unsplash.com/photo-1534723328310-e82dad3ee43f?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "3",
    name: "Medical Imagery",
    description: "X-ray and MRI scans with annotated features for disease detection",
    type: "panomatic",
    tags: ["medical", "xray", "healthcare"],
    createdAt: "2023-11-03T09:45:00Z",
    imageCount: 615,
    annotationCount: 1845,
    thumbnailUrl: "https://images.unsplash.com/photo-1530497610245-94d3c16cda28?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "4",
    name: "Aerial Photography",
    description: "Drone imagery for geographic feature detection and mapping",
    type: "segmentation",
    tags: ["aerial", "drone", "geography"],
    createdAt: "2023-08-17T16:20:00Z",
    imageCount: 527,
    annotationCount: 1432,
    thumbnailUrl: "https://images.unsplash.com/photo-1508138221679-760a23a2285b?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "5",
    name: "Wildlife Monitoring",
    description: "Camera trap imagery of wildlife with species annotations",
    type: "classification",
    tags: ["wildlife", "nature", "animals"],
    createdAt: "2023-10-05T11:40:00Z",
    imageCount: 942,
    annotationCount: 2854,
    thumbnailUrl: "https://images.unsplash.com/photo-1557008075-7f2c5efa4cfd?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
  },
  {
    id: "6",
    name: "Industrial Defects",
    description: "Manufacturing quality control with annotated defect regions",
    type: "panomatic",
    tags: ["industrial", "manufacturing", "quality"],
    createdAt: "2023-07-29T08:50:00Z",
    imageCount: 318,
    annotationCount: 563,
    thumbnailUrl: "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1000&q=80",
  },
];

const Index = () => {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  
  useEffect(() => {
    // Simulate API call
    const fetchData = async () => {
      await new Promise(resolve => setTimeout(resolve, 1000));
      setDatasets(mockDatasets);
      setLoading(false);
    };
    
    fetchData();
  }, []);
  
  // Filter datasets based on search query and/or selected tag
  const filteredDatasets = datasets.filter(dataset => {
    const matchesSearch = searchQuery === "" || 
      dataset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dataset.description.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesTag = selectedTag === null || 
      (dataset.tags && dataset.tags.includes(selectedTag));
    
    return matchesSearch && matchesTag;
  });
  
  // Extract all unique tags from datasets
  const allTags = Array.from(
    new Set(
      datasets.flatMap(dataset => dataset.tags || [])
    )
  ).sort();
  
  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <section className="pt-32 pb-12 px-4 relative">
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
      
      <section className="container max-w-6xl py-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <h2 className="text-2xl font-semibold">All Datasets</h2>
          <div className="relative flex items-center w-full md:w-auto">
            <Search className="absolute left-3 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search datasets..."
              className="pl-9 pr-4"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
        
        {/* Tag filtering */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            <Button
              variant={selectedTag === null ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedTag(null)}
              className="gap-1"
            >
              All
            </Button>
            {allTags.map(tag => (
              <Button
                key={tag}
                variant={selectedTag === tag ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedTag(tag)}
                className="gap-1"
              >
                <Tag className="w-3 h-3" />
                {tag}
              </Button>
            ))}
          </div>
        )}
        
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(6).fill(0).map((_, i) => (
              <DatasetCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredDatasets.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredDatasets.map(dataset => (
              <DatasetCard key={dataset.id} dataset={dataset} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <h3 className="text-lg font-medium mb-2">No datasets found</h3>
            <p className="text-muted-foreground mb-6">
              {searchQuery || selectedTag 
                ? `No datasets matching your search criteria`
                : "You haven't created any datasets yet."
              }
            </p>
            <Button asChild>
              <Link to="/datasets/new">
                <FolderPlus className="w-4 h-4 mr-2" />
                Create your first dataset
              </Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
};

export default Index;
