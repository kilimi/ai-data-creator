import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { useState, useEffect } from "react";
import { Dataset } from "@/types";
import { DatasetCard, DatasetCardSkeleton } from "@/components/DatasetCard";
import { CreateAugmentedDatasetModal } from "@/components/CreateAugmentedDatasetModal";
import { FolderPlus, Search, Settings, SlidersHorizontal, Tag, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const Datasets = () => {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [project, setProject] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name" | "images" | "annotations">("newest");
  const [showAugmentedModal, setShowAugmentedModal] = useState(false);
  const { api } = useApi();
  const { toast } = useToast();
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch projects first
        const projectsResponse = await fetch('http://localhost:9999/projects/');
        if (projectsResponse.ok) {
          const projectsData = await projectsResponse.json();
          // Get the first project
          if (projectsData.length > 0) {
            setProject(projectsData[0]);
          }
        }

        // Then fetch datasets
        const datasetsResponse = await fetch('http://localhost:9999/datasets/');
        if (!datasetsResponse.ok) {
          throw new Error(`HTTP error! status: ${datasetsResponse.status}`);
        }
        const data = await datasetsResponse.json();
        setDatasets(data);
      } catch (err) {
        console.error('Error fetching data:', err);
      } finally {
        setLoading(false);
      }
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
        return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case "oldest":
        return result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case "name":
        return result.sort((a, b) => a.name.localeCompare(b.name));
      case "images":
        return result.sort((a, b) => b.image_count - a.image_count);
      case "annotations":
        return result.sort((a, b) => b.annotation_count - a.annotation_count);
      default:
        return result;
    }
  };

  const handleDeleteDataset = async (dataset: Dataset) => {
    try {
      const response = await api?.deleteDataset(dataset.id);
      
      if (!response?.success) {
        throw new Error(response?.error || 'Failed to delete dataset');
      }

      setDatasets(prevDatasets => prevDatasets.filter(d => d.id !== dataset.id));
      
      toast({
        title: "Dataset deleted",
        description: `${dataset.name} has been deleted successfully.`,
      });
    } catch (err) {
      console.error('Error deleting:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to delete. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDatasetUpdated = (updatedDataset: Dataset) => {
    setDatasets(prevDatasets => 
      prevDatasets.map(d => d.id === updatedDataset.id ? updatedDataset : d)
    );
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
              <Link to="/settings" title="Settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="flex items-center gap-2">
                  <FolderPlus className="w-4 h-4" />
                  Create
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link 
                    to="/projects/new/dataset" 
                    state={{ projectId: project?.id || null }}
                    className="flex items-center cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4 mr-2" />
                    Dataset
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <div 
                    onClick={() => setShowAugmentedModal(true)}
                    className="flex items-center cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4 mr-2 text-yellow-600" />
                    <span className="text-yellow-600">Augmented Dataset</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
              <div key={dataset.id}>
                <DatasetCard 
                  dataset={dataset} 
                  onDelete={handleDeleteDataset}
                  onDatasetUpdated={handleDatasetUpdated}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 animate-fade-in">
            <h3 className="text-lg font-medium mb-2">No datasets found</h3>
            <p className="text-muted-foreground mb-6">
              {searchQuery || selectedTag
                ? `No datasets matching your search criteria`
                : project 
                  ? "You haven't created any datasets yet."
                  : "Please create a project first before adding datasets."
              }
            </p>
            {project ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    <FolderPlus className="w-4 h-4 mr-2" />
                    Create Dataset
                    <ChevronDown className="w-4 h-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  <DropdownMenuItem asChild>
                    <Link 
                      to="/projects/new/dataset"
                      state={{ projectId: project.id }}
                      className="flex items-center cursor-pointer"
                    >
                      <FolderPlus className="w-4 h-4 mr-2" />
                      Dataset
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <div 
                      onClick={() => setShowAugmentedModal(true)}
                      className="flex items-center cursor-pointer"
                    >
                      <FolderPlus className="w-4 h-4 mr-2 text-yellow-600" />
                      <span className="text-yellow-600">Augmented Dataset</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Button asChild>
                <Link to="/projects/new">
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Create your first project
                </Link>
              </Button>
            )}
          </div>
        )}
      </main>
      
      {/* Augmented Dataset Modal */}
      {project && (
        <CreateAugmentedDatasetModal
          open={showAugmentedModal}
          onOpenChange={setShowAugmentedModal}
          projectId={project.id || ''}
          datasets={datasets || []}
        />
      )}
    </div>
  );
};

export default Datasets;
