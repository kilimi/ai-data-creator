
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Dataset } from "@/types";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, FileImage, Layers, MoreHorizontal } from "lucide-react";
import { useImageLoad } from "@/utils/animations";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DatasetCardProps {
  dataset: Dataset;
  className?: string;
}

export function DatasetCard({ dataset, className }: DatasetCardProps) {
  const imageLoaded = useImageLoad(dataset.thumbnailUrl);
  
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
                {new Date(dataset.createdAt).toLocaleDateString()}
              </div>
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
        <div className="space-y-1">
          <Link to={`/datasets/${dataset.id}`} className="block">
            <h3 className="font-medium line-clamp-1 hover:text-primary transition-colors">
              {dataset.name}
            </h3>
          </Link>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {dataset.description || "No description provided"}
          </p>
        </div>
      </CardContent>
      
      <CardFooter className="p-4 pt-0 flex justify-between text-sm text-muted-foreground">
        <div className="flex items-center">
          <FileImage className="h-4 w-4 mr-1.5" />
          <span>{dataset.imageCount} {dataset.imageCount === 1 ? 'image' : 'images'}</span>
        </div>
        <div className="flex items-center">
          <Layers className="h-4 w-4 mr-1.5" />
          <span>{dataset.annotationCount} {dataset.annotationCount === 1 ? 'annotation' : 'annotations'}</span>
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
