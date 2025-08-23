import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Project, Dataset } from "@/types";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Folder, FolderOpen, Database, MoreHorizontal, Tag } from "lucide-react";
import { useImageLoad } from "@/utils/animations";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState, memo } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { createApiClient } from "@/utils/api";
import { API_CONFIG } from "@/config/api";
import { useToast } from "@/hooks/use-toast";
import { useAnnotationFilesCount } from "@/hooks/useAnnotationFilesCount";
import { EditProjectDialog } from "./EditProjectDialog";
import { Badge } from "@/components/ui/badge";

interface ProjectCardProps {
  project: Project;
  className?: string;
  onDelete?: () => void;
  onUpdate?: (project: Project) => void;
}

export function ProjectCard({ project, className, onDelete, onUpdate }: ProjectCardProps) {
  const imageLoaded = useImageLoad(project.logo_url);
  const [isHovered, setIsHovered] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const handleDelete = async () => {
    try {
      const apiClient = createApiClient(API_CONFIG);
      const response = await apiClient.deleteProject(project.id);
      
      if (!response.success) {
        throw new Error(response.error || "Failed to delete project");
      }

      toast({
        title: "Success",
        description: "Project has been deleted successfully.",
      });

      if (onDelete) {
        onDelete();
      } else {
        // If no onDelete handler provided, refresh the page
        navigate(0);
      }
    } catch (err) {
      console.error('Error deleting project:', err);
      toast({
        title: "Error",
        description: "Failed to delete project. Please try again.",
        variant: "destructive",
      });
    } finally {
      setShowDeleteDialog(false);
    }
  };

  const handleDuplicate = async () => {
    try {
      const apiClient = createApiClient(API_CONFIG);
      const response = await apiClient.duplicateProject(project.id);
      
      if (!response.success) {
        throw new Error(response.error || "Failed to duplicate project");
      }

      toast({
        title: "Success",
        description: "Project has been duplicated successfully.",
      });

      // If onUpdate handler provided, use it, otherwise refresh the page
      if (onUpdate && response.data) {
        onUpdate(response.data);
      } else {
        navigate(0);
      }
    } catch (err) {
      console.error('Error duplicating project:', err);
      toast({
        title: "Error",
        description: "Failed to duplicate project. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleProjectUpdate = (updatedProject: Project) => {
    if (onUpdate) {
      onUpdate(updatedProject);
    } else {
      // If no onUpdate handler provided, refresh the page
      navigate(0);
    }
  };

  return (
    <>
      <Card 
        className={cn(
          "overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:shadow-lg glass-card",
          className
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <CardHeader className="p-0">
          <div className="relative h-44 w-full overflow-hidden">
            {project.logo_url ? (
              <>
                {!imageLoaded && (
                  <div className="absolute inset-0 bg-muted animate-pulse" />
                )}
                <img
                  src={project.logo_url}
                  alt={project.name}
                  className={cn(
                    "h-full w-full object-cover transition-all duration-500",
                    !imageLoaded && "opacity-0",
                    imageLoaded && "opacity-100"
                  )}
                />
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-tr from-primary/5 to-secondary/5">
                {isHovered ? (
                  <FolderOpen className="h-16 w-16 text-primary/30" />
                ) : (
                  <Folder className="h-16 w-16 text-muted-foreground/20" />
                )}
              </div>
            )}
            
            <div className="absolute inset-0 bg-gradient-to-t from-background/90 to-transparent" />
            
            <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between">
              <div className="rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                {new Date(project.created_at).toLocaleDateString()}
              </div>
              
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" size="icon" className="h-7 w-7">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => setShowEditDialog(true)}>
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDuplicate}>
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    className="text-destructive focus:text-destructive"
                    onClick={() => setShowDeleteDialog(true)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-4">
          <div className="space-y-2">
            <Link to={`/projects/${project.id}`}>
              <h3 className="font-medium hover:text-primary transition-colors text-lg line-clamp-1">
                {project.name}
              </h3>
            </Link>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {project.description || "No description provided"}
            </p>
            
            {/* Display project tags */}
            {project.tags && project.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {project.tags.map(tag => (
                  <Badge 
                    key={tag} 
                    variant="secondary" 
                    className="flex items-center gap-1 text-xs"
                  >
                    <Tag className="h-3 w-3" />
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
        
        <CardFooter className="p-4 pt-0">
          <div className="flex justify-between items-center w-full">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {project.datasets.length} {project.datasets.length === 1 ? 'dataset' : 'datasets'}
              </span>
            </div>
            
            {project.datasets.length > 0 && (
              <div className="flex -space-x-2">
                {project.datasets.slice(0, 3).map((dataset) => (
                  <DatasetThumbnail key={dataset.id} dataset={dataset} projectId={project.id} />
                ))}
                {project.datasets.length > 3 && (
                  <Avatar className="border-2 border-background h-8 w-8">
                    <AvatarFallback className="bg-muted text-muted-foreground text-xs">
                      +{project.datasets.length - 3}
                    </AvatarFallback>
                  </Avatar>
                )}
              </div>
            )}
          </div>
        </CardFooter>
      </Card>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              {project.datasets.length > 0 
                ? `This will delete the project "${project.name}" and all ${project.datasets.length} datasets inside it. This action cannot be undone.`
                : `This will delete the project "${project.name}". This action cannot be undone.`
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditProjectDialog
        project={project}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onProjectUpdated={handleProjectUpdate}
      />
    </>
  );
}

interface DatasetThumbnailProps {
  dataset: Dataset;
  projectId: number;
}

function DatasetThumbnail({ dataset, projectId }: DatasetThumbnailProps) {
  // Get annotation count from localStorage (for locally saved annotations)
  const localAnnotationCount = useAnnotationFilesCount(dataset.id);
  
  // Use the higher of backend count or localStorage count
  const totalAnnotationCount = Math.max(dataset.annotation_count || 0, localAnnotationCount || 0);
  
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Link to={`/projects/${projectId}/datasets/${dataset.id}`}>
          <Avatar className="border-2 border-background h-8 w-8 cursor-pointer">
            {dataset.thumbnailUrl ? (
              <AvatarImage src={dataset.thumbnailUrl} alt={dataset.name} />
            ) : (
              <AvatarFallback className="bg-primary/10 text-primary text-xs">
                {dataset.name.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            )}
          </Avatar>
        </Link>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="flex space-x-4">
          <div className="w-16 h-16 rounded overflow-hidden bg-muted">
            {dataset.thumbnailUrl ? (
              <img src={dataset.thumbnailUrl} alt={dataset.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-primary/10">
                <span className="text-primary text-lg font-semibold">
                  {dataset.name.substring(0, 2).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{dataset.name}</h4>
            <p className="text-xs text-muted-foreground line-clamp-2">{dataset.description}</p>
            <div className="flex items-center pt-1">
              <span className="text-xs text-muted-foreground">
                {dataset.image_count} images • {totalAnnotationCount} annotation {totalAnnotationCount === 1 ? 'file' : 'files'}
              </span>
            </div>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function ProjectCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <div className="h-40 w-full">
        <Skeleton className="h-full w-full" />
      </div>
      <CardContent className="p-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0 flex justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-24" />
      </CardFooter>
    </Card>
  );
}

// Optimize with React.memo to prevent unnecessary re-renders
export const MemoizedProjectCard = memo(ProjectCard);
