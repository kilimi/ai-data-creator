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

const Datasets = () => {
  const [loading, setLoading] = useState(true);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [project, setProject] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name" | "images" | "annotations">("newest");
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch projects first
        const projectsResponse = await fetch('http://localhost:8000/projects/');
        if (projectsResponse.ok) {
          const projectsData = await projectsResponse.json();
          // Get the first project
          if (projectsData.length > 0) {
            setProject(projectsData[0]);
          }
        }

        // Then fetch datasets
        const datasetsResponse = await fetch('http://localhost:8000/datasets/');
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
              <Link 
                to="/projects/new/dataset" 
                state={{ projectId: project?.id || null }}
                className="flex items-center gap-2"
              >
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
              <div key={dataset.id}>
                <DatasetCard dataset={dataset} />
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
            <Button asChild>
              <Link 
                to={project ? "/projects/new/dataset" : "/projects/new"}
                state={project ? { projectId: project.id } : undefined}
              >
                <FolderPlus className="w-4 h-4 mr-2" />
                {project ? "Create your first dataset" : "Create your first project"}
              </Link>
            </Button>
          </div>
        )}
      </main>
    </div>
  );
};

export default Datasets;
