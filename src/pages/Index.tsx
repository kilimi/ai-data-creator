import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Settings, Sparkles, Database, Brain, Zap, TrendingUp, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { useStableLoading } from "@/hooks/useStableLoading";

export default function Index() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { api, isConfigured, isConnected } = useApi();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">("newest");
  
  // Use stable loading to prevent flickering
  const stableLoading = useStableLoading(loading, 250);

  useEffect(() => {
    const fetchProjects = async () => {
      // Wait for API configuration and connection to be established
      if (!isConfigured || !api || isConnected === null) {
        return;
      }

      // If connection failed, set loading to false and return
      if (isConnected === false) {
        setLoading(false);
        setError('API connection failed');
        return;
      }

      try {
        setError(null); // Clear any previous errors
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
  }, [api, isConfigured, isConnected, toast]);

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

  const stats = {
    totalProjects: projects.length,
    totalDatasets: projects.reduce((acc, p) => acc + (p.datasets?.length || 0), 0),
    totalImages: projects.reduce((acc, p) => acc + p.datasets?.reduce((datasetAcc, d) => datasetAcc + (d.image_count || 0), 0), 0)
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-accent/5">
      <Navbar />
      
      <main className="container max-w-7xl mx-auto px-4 pt-32">
        {/* Hero Section */}
        <div className="relative mb-8 text-center">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-accent/10 to-secondary/10 rounded-2xl blur-3xl -z-10" />
          <div className="relative bg-card/80 backdrop-blur-sm border rounded-2xl p-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-3 gap-3 mb-6 max-w-lg mx-auto">
              <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Database className="w-4 h-4 text-primary" />
                    <span className="text-lg font-bold text-primary">{stats.totalProjects}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Projects</p>
                </CardContent>
              </Card>
              
              <Card className="bg-gradient-to-br from-accent/5 to-accent/10 border-accent/20">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Brain className="w-4 h-4 text-accent" />
                    <span className="text-lg font-bold text-accent">{stats.totalDatasets}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Datasets</p>
                </CardContent>
              </Card>
              
              <Card className="bg-gradient-to-br from-secondary/5 to-secondary/10 border-secondary/20">
                <CardContent className="p-3 text-center">
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Activity className="w-4 h-4 text-secondary" />
                    <span className="text-lg font-bold text-secondary">{stats.totalImages.toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Images</p>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button className="px-6" asChild>
                <Link to="/projects/new" className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  New Project
                </Link>
              </Button>
              <Button variant="outline" className="px-6" asChild>
                <Link to="/api-settings" className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Settings
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {/* Projects Section */}
        <div className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <TrendingUp className="w-6 h-6 text-primary" />
                Your Projects
              </h2>
              <p className="text-muted-foreground">Manage and monitor your AI projects</p>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex-1 flex items-center gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search projects..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-background/80 backdrop-blur-sm"
                />
              </div>
              <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as any)}>
                <SelectTrigger className="w-[180px] bg-background/80 backdrop-blur-sm">
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
        </div>

        {/* Projects Grid */}
        {stableLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(6).fill(0).map((_, i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <Card className="p-8 text-center">
            <div className="text-destructive mb-4">
              <Zap className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <h3 className="text-lg font-medium">Connection Error</h3>
            </div>
            <p className="text-muted-foreground mb-4">{error}</p>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try Again
            </Button>
          </Card>
        ) : filteredAndSortedProjects().length === 0 ? (
          <Card className="p-12 text-center">
            <div className="mb-6">
              <div className="w-24 h-24 mx-auto mb-4 rounded-full bg-gradient-to-br from-primary/10 to-accent/10 flex items-center justify-center">
                <Brain className="w-12 h-12 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">
                {searchQuery ? "No matching projects" : "Ready to start your AI journey?"}
              </h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                {searchQuery
                  ? "No projects matching your search criteria. Try adjusting your search terms."
                  : "Create your first project to begin annotating data, training models, and building intelligent applications."
                }
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button size="lg" asChild>
                <Link to="/projects/new" className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Create Your First Project
                </Link>
              </Button>
              {searchQuery && (
                <Button variant="outline" size="lg" onClick={() => setSearchQuery("")}>
                  Clear Search
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedProjects().map((project, index) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
