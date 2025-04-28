import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Dataset } from "@/types";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, FileImage, Layers, MoreHorizontal, Tag, Pencil } from "lucide-react";
import { useImageLoad } from "@/utils/animations";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DatasetCardProps extends React.HTMLAttributes<HTMLDivElement> {
  dataset: Dataset;
  className?: string;
  onDelete?: (dataset: Dataset) => Promise<void>;
}

export function DatasetCard({ dataset, className, onDelete, ...props }: DatasetCardProps) {
  const imageLoaded = useImageLoad(dataset.thumbnailUrl);
  
  // Function to get dataset type badge color
  const getTypeColor = (type?: string) => {
    switch (type) {
      case "classification":
        return "bg-blue-500";
      case "segmentation":
        return "bg-green-500";
      case "panomatic":
        return "bg-purple-500";
      default:
        return "bg-gray-500";
    }
  };
  
  return (
    <Card className={cn("overflow-hidden hover-card", className)}>
      <CardHeader className="p-0">
        <div className="relative h-40 w-full overflow-hidden">
          {dataset.thumbnailUrl ? (
            <>
              {!imageLoaded && (
                <div className="absolute inset-0 bg-muted animate-pulse" />
              )}
              <img
                src={dataset.thumbnailUrl}
                alt={dataset.name}
                className={cn(
                  "h-full w-full object-cover transition-all duration-500",
                  !imageLoaded && "opacity-0",
                  imageLoaded && "opacity-100"
                )}
              />
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted/50">
              <Database className="h-16 w-16 text-muted-foreground/30" />
            </div>
          )}
          
          <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent" />
          
          <div className="absolute bottom-3 left-4 right-4 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">
                {new Date(dataset.created_at).toLocaleDateString()}
              </div>
              
              {/* Dataset type badge */}
              {dataset.type && (
                <div className={`rounded-md px-1.5 py-0.5 text-xs font-medium text-white ${getTypeColor(dataset.type)}`}>
                  {dataset.type.charAt(0).toUpperCase() + dataset.type.slice(1)}
                </div>
              )}
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link to={`/dataset/${dataset.id}/annotate`}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Annotate
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem>Rename</DropdownMenuItem>
                <DropdownMenuItem>Duplicate</DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-destructive"
                  onClick={() => onDelete && onDelete(dataset)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-4">
        <div className="space-y-1">
          <Link to={`/dataset/${dataset.id}`} className="block">
            <h3 className="font-medium line-clamp-1 hover:text-primary transition-colors">
              {dataset.name}
            </h3>
          </Link>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {dataset.description || "No description provided"}
          </p>
          
          {/* Display tags if available */}
          {dataset.tags && dataset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2">
              {dataset.tags.map(tag => (
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
      
      <CardFooter className="p-4 pt-0 flex justify-between text-sm text-muted-foreground">
        <div className="flex items-center">
          <FileImage className="h-4 w-4 mr-1.5" />
          <span>{dataset.image_count} {dataset.image_count === 1 ? 'image' : 'images'}</span>
        </div>
        <div className="flex items-center">
          <Layers className="h-4 w-4 mr-1.5" />
          <span>{dataset.annotation_count} {dataset.annotation_count === 1 ? 'annotation' : 'annotations'}</span>
        </div>
      </CardFooter>
    </Card>
  );
}

export function DatasetCardSkeleton() {
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
        <Skeleton className="h-4 w-24" />
      </CardFooter>
    </Card>
  );
}
