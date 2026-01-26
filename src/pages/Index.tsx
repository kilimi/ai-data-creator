import { useState, useEffect } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Plus, Search, Settings, Database, Brain, Activity, Tag, Filter, Sparkles, RefreshCw, FolderOpen, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProjectCard, ProjectCardSkeleton } from "@/components/ProjectCard";
import { Project } from "@/types";
import { Navbar } from "@/components/Navbar";
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
import { cn } from "@/lib/utils";

interface SidebarNavItemProps {
  to?: string;
  icon: React.ReactNode;
  label: string;
  count?: number;
  isActive: boolean;
  onClick?: () => void;
}

function SidebarNavItem({ to, icon, label, count, isActive, onClick }: SidebarNavItemProps) {
  const content = (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 cursor-pointer",
        "hover:bg-gray-800/50 group",
        isActive 
          ? "bg-primary/10 border-l-4 border-primary text-primary" 
          : "text-gray-400 hover:text-white border-l-4 border-transparent"
      )}
      onClick={onClick}
    >
      <span className={cn(
        "transition-colors",
        isActive ? "text-primary" : "text-gray-500 group-hover:text-gray-300"
      )}>
        {icon}
      </span>
      <span className="font-medium">{label}</span>
      {count !== undefined && (
        <span className={cn(
          "ml-auto text-xs px-2 py-0.5 rounded-full",
          isActive 
            ? "bg-primary/20 text-primary" 
            : "bg-gray-700 text-gray-400"
        )}>
          {count}
        </span>
      )}
    </div>
  );

  if (to) {
    return <Link to={to}>{content}</Link>;
  }
  return content;
}

export default function Index() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { api, isConfigured, isConnected } = useApi();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">("newest");
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const [activeSection, setActiveSection] = useState<"projects" | "settings">("projects");
  
  // Use stable loading to prevent flickering
  const stableLoading = useStableLoading(loading, 250);

  const handleRefresh = () => {
    setRefetchTrigger(prev => prev + 1);
    toast({
      title: "Refreshing projects...",
      description: "Loading latest data",
    });
  };

  useEffect(() => {
    const fetchProjects = async () => {
      if (!isConfigured || !api || isConnected === null) {
        return;
      }

      if (isConnected === false) {
        setLoading(false);
        setError('API connection failed');
        return;
      }

      try {
        setError(null);
        const response = await api.getProjects();
        
        if (response.success && response.data) {
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
  }, [api, isConfigured, isConnected, toast, refetchTrigger]);

  useEffect(() => {
    if (location.state?.refetch) {
      setRefetchTrigger(prev => prev + 1);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

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
      
      <div className="pt-16 flex">
        {/* Sidebar Navigation */}
        <aside className="w-64 min-h-[calc(100vh-4rem)] border-r border-gray-800 bg-gray-950/50 fixed left-0 top-16">
          <div className="p-4">
            {/* App Header */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-8 w-8 rounded-lg bg-primary/20 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <span className="text-xs text-gray-500 uppercase tracking-wider">Workspace</span>
              </div>
              <h2 className="text-lg font-semibold text-white truncate px-2">
                LAI Studio
              </h2>
            </div>
            
            {/* Navigation Links */}
            <nav className="space-y-1">
              <SidebarNavItem
                icon={<FolderOpen className="h-5 w-5" />}
                label="Projects"
                count={stats.totalProjects}
                isActive={activeSection === 'projects'}
                onClick={() => setActiveSection('projects')}
              />
              <SidebarNavItem
                icon={<Database className="h-5 w-5" />}
                label="Datasets"
                count={stats.totalDatasets}
                isActive={false}
                onClick={() => {}}
              />
              <SidebarNavItem
                icon={<Brain className="h-5 w-5" />}
                label="Models"
                isActive={false}
                onClick={() => {}}
              />
              <SidebarNavItem
                to="/settings"
                icon={<Settings className="h-5 w-5" />}
                label="Settings"
                isActive={activeSection === 'settings'}
              />
            </nav>

            {/* Quick Stats */}
            <div className="mt-8 pt-6 border-t border-gray-800">
              <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-4 px-2">Quick Stats</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900/50">
                  <span className="text-sm text-gray-400">Projects</span>
                  <span className="text-sm font-semibold text-white">{stats.totalProjects}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900/50">
                  <span className="text-sm text-gray-400">Datasets</span>
                  <span className="text-sm font-semibold text-white">{stats.totalDatasets}</span>
                </div>
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-900/50">
                  <span className="text-sm text-gray-400">Images</span>
                  <span className="text-sm font-semibold text-white">{stats.totalImages.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
        
        {/* Main Content */}
        <main className="flex-1 ml-64">
          <div className="container max-w-6xl mx-auto px-6 py-6">
            {/* Page Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Projects</h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Manage your machine learning projects
                </p>
              </div>
              <Button asChild>
                <Link to="/projects/new" className="flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  New Project
                </Link>
              </Button>
            </div>

            {/* Search and Filters */}
            <div className="glass-card rounded-xl p-4 mb-6">
              <div className="flex flex-col lg:flex-row gap-4">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search projects..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-10 bg-background/50 border-border/50"
                  />
                </div>
                
                {/* Sort Dropdown */}
                <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as any)}>
                  <SelectTrigger className="w-[160px] h-10 bg-background/50 border-border/50">
                    <Filter className="w-4 h-4 mr-2" />
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                    <SelectItem value="name">Name (A-Z)</SelectItem>
                  </SelectContent>
                </Select>
                
                {/* Refresh Button */}
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleRefresh}
                  disabled={loading}
                  className="h-10 w-10 bg-background/50 border-border/50"
                  title="Refresh"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              
              {/* Tag Filter */}
              {allTags.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Tag className="w-4 h-4 text-muted-foreground" />
                    <Button
                      variant={selectedTag === null ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setSelectedTag(null)}
                      className="h-7 text-xs"
                    >
                      All
                    </Button>
                    {allTags.map(tag => (
                      <Button
                        key={tag}
                        variant={selectedTag === tag ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setSelectedTag(tag)}
                        className="h-7 text-xs"
                      >
                        {tag}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Projects Grid */}
            {stableLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {Array(6).fill(0).map((_, i) => (
                  <ProjectCardSkeleton key={i} />
                ))}
              </div>
            ) : error ? (
              <Card className="glass-card p-12 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
                  <Activity className="w-8 h-8 text-destructive" />
                </div>
                <h3 className="text-lg font-semibold mb-2 text-destructive">Connection Error</h3>
                <p className="text-muted-foreground mb-4 text-sm">{error}</p>
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                    Try Again
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/settings">Settings</Link>
                  </Button>
                </div>
              </Card>
            ) : filteredAndSortedProjects().length === 0 ? (
              <Card className="glass-card p-12 text-center">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-primary/10 via-accent/10 to-secondary/10 flex items-center justify-center">
                  <Brain className="w-10 h-10 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">
                  {searchQuery || selectedTag ? "No matching projects" : "No projects yet"}
                </h3>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  {searchQuery || selectedTag
                    ? "Try adjusting your filters or search terms."
                    : "Create your first project to get started."
                  }
                </p>
                <div className="flex gap-3 justify-center">
                  <Button asChild>
                    <Link to="/projects/new" className="flex items-center gap-2">
                      <Plus className="w-4 h-4" />
                      Create Project
                    </Link>
                  </Button>
                  {(searchQuery || selectedTag) && (
                    <Button variant="outline" onClick={() => {
                      setSearchQuery("");
                      setSelectedTag(null);
                    }}>
                      Clear Filters
                    </Button>
                  )}
                </div>
              </Card>
            ) : (
              <div className="space-y-4">
                {/* Results Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {filteredAndSortedProjects().length} {filteredAndSortedProjects().length === 1 ? 'project' : 'projects'}
                    </span>
                    {(searchQuery || selectedTag) && (
                      <Badge variant="secondary" className="text-xs">
                        Filtered
                      </Badge>
                    )}
                  </div>
                </div>
                
                {/* Projects Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredAndSortedProjects().map((project, index) => (
                    <div key={project.id} className="animate-fade-in" style={{ animationDelay: `${index * 50}ms` }}>
                      <ProjectCard project={project} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
