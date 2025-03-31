
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Project, Dataset } from "@/types";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Folder, FolderOpen, Database, MoreHorizontal } from "lucide-react";
import { useImageLoad } from "@/utils/animations";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

interface ProjectCardProps {
  project: Project;
  className?: string;
}

export function ProjectCard({ project, className }: ProjectCardProps) {
  const imageLoaded = useImageLoad(project.thumbnailUrl);
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <Card 
      className={cn("overflow-hidden transition-all", className)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <CardHeader className="p-0">
        <div className="relative h-40 w-full overflow-hidden">
          {project.thumbnailUrl ? (
            <>
              {!imageLoaded && (
                <div className="absolute inset-0 bg-muted animate-pulse" />
              )}
              <img
                src={project.thumbnailUrl}
                alt={project.name}
                className={cn(
                  "h-full w-full object-cover transition-all duration-500",
                  !imageLoaded && "opacity-0",
                  imageLoaded && "opacity-100"
                )}
              />
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-tr from-primary/10 to-secondary/10">
              {isHovered ? (
                <FolderOpen className="h-16 w-16 text-primary/40" />
              ) : (
                <Folder className="h-16 w-16 text-muted-foreground/30" />
              )}
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
          
          <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between">
            <div className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
              {new Date(project.createdAt).toLocaleDateString()}
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>Rename</DropdownMenuItem>
                <DropdownMenuItem>Duplicate</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive">
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-4">
        <div className="space-y-2">
          <Link to={`/projects/${project.id}`} className="block">
            <h3 className="font-medium line-clamp-1 hover:text-primary transition-colors text-lg">
              {project.name}
            </h3>
          </Link>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {project.description || "No description provided"}
          </p>
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
                <DatasetThumbnail key={dataset.id} dataset={dataset} />
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
  );
}

interface DatasetThumbnailProps {
  dataset: Dataset;
}

function DatasetThumbnail({ dataset }: DatasetThumbnailProps) {
  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <Link to={`/datasets/${dataset.id}`}>
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
                {dataset.imageCount} images • {dataset.annotationCount} annotations
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
