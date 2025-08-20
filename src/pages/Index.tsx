import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Settings, Database, Brain, Activity, Tag, Rocket, Target, BarChart3, Filter, ArrowRight, Sparkles } from "lucide-react";
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
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
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
        project => {
          const nameMatch = project.name.toLowerCase().includes(query);
          const descMatch = (project.description || '').toLowerCase().includes(query);
          const tagMatch = project.tags && project.tags.some(tag => tag.toLowerCase().includes(query));
          
          return nameMatch || descMatch || tagMatch;
        }
      );
    }
    
    if (selectedTag) {
      result = result.filter(project => 
        project.tags && project.tags.includes(selectedTag)
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

  // Get all unique tags from projects
  const allTags = Array.from(
    new Set(
      projects.flatMap(project => project.tags || [])
    )
  ).sort();

  const stats = {
    totalProjects: projects.length,
    totalDatasets: projects.reduce((acc, p) => acc + (p.datasets?.length || 0), 0),
    totalImages: projects.reduce((acc, p) => acc + p.datasets?.reduce((datasetAcc, d) => datasetAcc + (d.image_count || 0), 0), 0)
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container max-w-7xl mx-auto px-4 pt-24">
        {/* Clean Hero Section */}
        <div className="relative mb-12">
          <div className="glass-card rounded-2xl p-8 lg:p-10">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-medium">
                  <Rocket className="w-4 h-4" />
                  AI Development Platform
                </div>
                <h1 className="text-3xl lg:text-4xl font-bold text-foreground">
                  Welcome back to your workspace
                </h1>
                <p className="text-muted-foreground max-w-2xl">
                  Continue working on your machine learning projects or start something new.
                </p>
              </div>
              
              {/* Quick Actions */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button size="lg" className="px-6 h-11 group" asChild>
                  <Link to="/projects/new" className="flex items-center gap-2">
                    <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
                    New Project
                  </Link>
                </Button>
                <Button variant="outline" size="lg" className="px-6 h-11" asChild>
                  <Link to="/api-settings" className="flex items-center gap-2">
                    <Settings className="w-5 h-5" />
                    Settings
                  </Link>
                </Button>
              </div>
            </div>

            {/* Overview Bar */}
            {stats.totalProjects > 0 && (
              <div className="flex items-center gap-6 text-sm text-muted-foreground border-t border-border/50 pt-6">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  <span>{stats.totalProjects} projects</span>
                </div>
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4" />
                  <span>{stats.totalDatasets} datasets</span>
                </div>
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  <span>{stats.totalImages.toLocaleString()} images</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Projects Section */}
        <div className="mb-8">
          {/* Section Header */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
            <div className="space-y-2">
              <h2 className="text-3xl font-bold flex items-center gap-3">
                <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center">
                  <Target className="w-5 h-5 text-primary" />
                </div>
                Your Projects
              </h2>
              <p className="text-muted-foreground text-lg">
                Manage and monitor your AI development workspace
              </p>
            </div>
            
            {/* Quick Actions */}
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" asChild>
                <Link to="/api-settings" className="flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Settings
                </Link>
              </Button>
            </div>
          </div>
          
          {/* Search and Filters */}
          <div className="glass-card rounded-2xl p-6 mb-8">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* Search */}
              <div className="relative flex-1 max-w-lg">
                <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search projects by name, description, or tags..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-12 h-12 bg-background/50 border-border/50 focus:border-primary/50 transition-colors"
                />
              </div>
              
              {/* Sort Dropdown */}
              <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as any)}>
                <SelectTrigger className="w-[200px] h-12 bg-background/50 border-border/50">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4" />
                      Newest first
                    </div>
                  </SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="name">Name (A-Z)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Tag Filter */}
            {allTags.length > 0 && (
              <div className="mt-6 pt-6 border-t border-border/50">
                <div className="flex items-center gap-3 mb-3">
                  <Tag className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">Filter by tags:</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={selectedTag === null ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedTag(null)}
                    className="rounded-full"
                  >
                    All Projects
                  </Button>
                  {allTags.map(tag => (
                    <Button
                      key={tag}
                      variant={selectedTag === tag ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedTag(tag)}
                      className="rounded-full gap-1"
                    >
                      {tag}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Projects Grid */}
        {stableLoading ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="h-6 w-32 bg-muted rounded animate-pulse"></div>
              <div className="h-4 w-20 bg-muted rounded animate-pulse"></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array(6).fill(0).map((_, i) => (
                <ProjectCardSkeleton key={i} />
              ))}
            </div>
          </div>
        ) : error ? (
          <Card className="glass-card p-12 text-center">
            <div className="mb-6">
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
                <Activity className="w-10 h-10 text-destructive animate-pulse" />
              </div>
              <h3 className="text-xl font-semibold mb-2 text-destructive">Connection Error</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">{error}</p>
            </div>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={() => window.location.reload()}>
                Try Again
              </Button>
              <Button variant="outline" asChild>
                <Link to="/api-settings">Check Settings</Link>
              </Button>
            </div>
          </Card>
        ) : filteredAndSortedProjects().length === 0 ? (
          <Card className="glass-card p-12 text-center">
            <div className="mb-8">
              <div className="w-32 h-32 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/10 via-accent/10 to-secondary/10 flex items-center justify-center animate-float">
                <Brain className="w-16 h-16 text-primary" />
              </div>
              <h3 className="text-2xl font-semibold mb-3">
                {searchQuery || selectedTag ? "No matching projects found" : "Welcome to Your AI Workspace"}
              </h3>
              <p className="text-muted-foreground mb-8 max-w-lg mx-auto text-lg leading-relaxed">
                {searchQuery || selectedTag
                  ? "We couldn't find any projects matching your search criteria. Try adjusting your filters or search terms."
                  : "Start your machine learning journey by creating your first project. Build datasets, train models, and deploy intelligent solutions."
                }
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-4 justify-center max-w-md mx-auto">
              <Button size="lg" className="flex-1 h-12" asChild>
                <Link to="/projects/new" className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  {searchQuery || selectedTag ? "Create New Project" : "Get Started"}
                </Link>
              </Button>
              {(searchQuery || selectedTag) && (
                <Button variant="outline" size="lg" className="flex-1 h-12" onClick={() => {
                  setSearchQuery("");
                  setSelectedTag(null);
                }}>
                  Clear Filters
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Results Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">
                  {filteredAndSortedProjects().length} {filteredAndSortedProjects().length === 1 ? 'Project' : 'Projects'}
                </h3>
                {(searchQuery || selectedTag) && (
                  <Badge variant="secondary" className="rounded-full">
                    Filtered
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Sorted by {sortOrder === 'newest' ? 'newest first' : sortOrder === 'oldest' ? 'oldest first' : 'name'}
              </p>
            </div>
            
            {/* Projects Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredAndSortedProjects().map((project, index) => (
                <div key={project.id} className="animate-fade-in" style={{ animationDelay: `${index * 100}ms` }}>
                  <ProjectCard project={project} />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
