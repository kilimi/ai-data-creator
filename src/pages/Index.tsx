import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectCard, ProjectCardSkeleton } from "@/components/ProjectCard";
import { Project } from "@/types";
import { Navbar } from "@/components/Navbar";
import { Link } from "react-router-dom";
import { useToast } from "@/components/ui/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApi } from "@/hooks/use-api";

export default function Index() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { api, isConfigured } = useApi();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">("newest");

  useEffect(() => {
    const fetchProjects = async () => {
      if (!isConfigured || !api) {
        setLoading(false);
        return;
      }

      try {
        const response = await api.getProjects();
        
        if (response.success && response.data) {
          console.log('Received projects:', response.data);
          
          const transformedProjects = response.data.map((project: any) => ({
            ...project,
            datasets: project.datasets || []
          }));
          
          setProjects(transformedProjects);
        } else {
          setError(response.error || 'Failed to fetch projects');
          toast({
            title: "Error fetching projects",
            description: response.error || "Check your API connection settings",
            variant: "destructive",
          });
        }
      } catch (err) {
        console.error('Error fetching projects:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch projects');
        toast({
          title: "Error fetching projects",
          description: "Check your API connection settings",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchProjects();
  }, [api, isConfigured, toast]);

  const filteredAndSortedProjects = () => {
    let result = [...projects];
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        project => 
          project.name.toLowerCase().includes(query) || 
          project.description.toLowerCase().includes(query)
      );
    }
    
    switch (sortOrder) {
      case "newest":
        return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case "oldest":
        return result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case "name":
        return result.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return result;
    }
  };

  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <main className="container max-w-7xl mx-auto px-4 pt-28">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 animate-fade-in">
          <div>
            <h1 className="text-3xl font-bold">Projects</h1>
            <p className="text-muted-foreground">Create and manage your AI projects</p>
          </div>
          
          <div className="flex gap-2">
            <Button variant="outline" size="icon" className="h-10 w-10" asChild>
              <Link to="/api-settings" title="API Settings">
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild>
              <Link to="/projects/new" className="flex items-center gap-2">
                <Plus className="w-4 h-4" />
                New Project
              </Link>
            </Button>
          </div>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 mb-6 animate-fade-in delay-150">
          <div className="flex-1 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as any)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="name">Name (A-Z)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(6).fill(0).map((_, i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-16 text-destructive">{error}</div>
        ) : filteredAndSortedProjects().length === 0 ? (
          <div className="text-center py-16 animate-fade-in">
            <h3 className="text-lg font-medium mb-2">No projects found</h3>
            <p className="text-muted-foreground mb-6">
              {searchQuery
                ? "No projects matching your search criteria"
                : "You haven't created any projects yet."
              }
            </p>
            <Button asChild>
              <Link to="/projects/new">
                <Plus className="w-4 h-4 mr-2" />
                Create your first project
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-fade-in delay-300">
            {filteredAndSortedProjects().map(project => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
