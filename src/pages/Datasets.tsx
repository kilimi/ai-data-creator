import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { useState, useEffect } from "react";
import { Dataset } from "@/types";
import { DatasetCard, DatasetCardSkeleton } from "@/components/DatasetCard";
import { FolderPlus, Search, Settings, SlidersHorizontal, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

const Datasets = () => {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name" | "images" | "annotations">("newest");
  
  useEffect(() => {
    const fetchData = async () => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      setDatasets(mockDatasets);
      setLoading(false);
    };
    
    fetchData();
  }, []);
  
  const allTags = Array.from(
    new Set(
      datasets.flatMap(dataset => dataset.tags || [])
    )
  ).sort();
  
  const filteredAndSortedDatasets = () => {
    let result = [...datasets];
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        dataset => 
          dataset.name.toLowerCase().includes(query) || 
          dataset.description.toLowerCase().includes(query) ||
          (dataset.tags && dataset.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }
    
    if (selectedTag) {
      result = result.filter(
        dataset => dataset.tags && dataset.tags.includes(selectedTag)
      );
    }
    
    switch (sortOrder) {
      case "newest":
        return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      case "oldest":
        return result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case "name":
        return result.sort((a, b) => a.name.localeCompare(b.name));
      case "images":
        return result.sort((a, b) => b.imageCount - a.imageCount);
      case "annotations":
        return result.sort((a, b) => b.annotationCount - a.annotationCount);
      default:
        return result;
    }
  };
  
  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <main className="container max-w-7xl pt-32">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h1 className="text-3xl font-bold">Datasets</h1>
            <p className="text-muted-foreground">Create and manage your training datasets</p>
          </div>
          
          <div className="flex gap-2">
            <Button asChild variant="outline" size="icon" className="h-10 w-10">
              <Link to="/api-settings" title="API Settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild>
              <Link to="/datasets/new" className="flex items-center gap-2">
                <FolderPlus className="w-4 h-4" />
                New Dataset
              </Link>
            </Button>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 mb-4 animate-fade-in delay-150">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search datasets by name, description or tags..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="text-muted-foreground h-4 w-4" />
            <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as any)}>
              <SelectTrigger className="min-w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="name">Name (A-Z)</SelectItem>
                <SelectItem value="images">Most images</SelectItem>
                <SelectItem value="annotations">Most annotations</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6 animate-fade-in delay-200">
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
        ) : filteredAndSortedDatasets().length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in delay-300">
            {filteredAndSortedDatasets().map(dataset => (
              <DatasetCard key={dataset.id} dataset={dataset} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 animate-fade-in">
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
      </main>
    </div>
  );
};

export default Datasets;
