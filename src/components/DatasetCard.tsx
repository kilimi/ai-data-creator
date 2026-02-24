import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Dataset } from "@/types";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, FileImage, Layers, MoreHorizontal, Tag, Edit, ExternalLink, Copy } from "lucide-react";
import { useImageLoad } from "@/utils/animations";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EditDatasetDialog } from "@/components/EditDatasetDialog";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
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
  onDatasetUpdated?: (dataset: Dataset) => void;
}

export function DatasetCard({ dataset, className, onDelete, onDatasetUpdated, ...props }: DatasetCardProps) {
  const imageLoaded = useImageLoad(dataset.thumbnailUrl);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  
  const { api } = useApi();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleDatasetUpdated = (updatedDataset: Dataset) => {
    if (onDatasetUpdated) {
      onDatasetUpdated(updatedDataset);
    }
  };

  const handleDuplicate = async () => {
    if (!api) {
      toast({
        title: "Error",
        description: "API not available",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await api.duplicateDataset(dataset.id);
      
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to duplicate dataset');
      }

      const responseData = response.data;
      
      if (responseData.task_id) {
        toast({
          title: "✨ Duplication Started",
          description: `Dataset duplication is running in background. Check the tasks panel for progress.`,
          duration: 5000,
        });
        
        // Poll task status to navigate when complete
        const pollInterval = setInterval(async () => {
          try {
            const taskResponse = await api.getTask(responseData.task_id);
            if (taskResponse.success && taskResponse.data) {
              const taskData = taskResponse.data as any;
              
              if (taskData.status === 'completed') {
                clearInterval(pollInterval);
                const newDatasetId = taskData.task_metadata?.new_dataset_id;
                
                toast({
                  title: "✅ Dataset Duplicated",
                  description: `Successfully created a copy of the dataset!`,
                  duration: 4000,
                });
                
                // Navigate to the project datasets page
                if (dataset.project_id) {
                  setTimeout(() => {
                    navigate(`/projects/${dataset.project_id}/datasets`);
                  }, 500);
                }
              } else if (taskData.status === 'failed') {
                clearInterval(pollInterval);
                toast({
                  title: "❌ Duplication Failed",
                  description: taskData.error_message || "Dataset duplication failed",
                  variant: "destructive",
                });
              }
            }
          } catch (error) {
            console.error('Error polling task status:', error);
          }
        }, 2000);
        
        setTimeout(() => clearInterval(pollInterval), 300000);
      } else {
        const duplicatedDataset = responseData;
        toast({
          title: "✅ Dataset Duplicated",
          description: `Dataset has been duplicated successfully.`,
        });
        
        // Navigate to the project datasets page
        if (dataset.project_id) {
          navigate(`/projects/${dataset.project_id}/datasets`);
        }
      }
    } catch (error) {
      console.error('Error duplicating dataset:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to duplicate dataset",
        variant: "destructive",
      });
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
                key={dataset.thumbnailUrl}
                src={dataset.thumbnailUrl}
                alt={dataset.name}
                className={cn(
                  "h-full w-full object-cover transition-all duration-500",
                  !imageLoaded && "opacity-0",
                  imageLoaded && "opacity-100"
                )}
                onLoad={() => {
                  // Force re-render if image loads
                  if (!imageLoaded) {
                    // The useImageLoad hook will handle this, but this ensures it works
                  }
                }}
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
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsEditDialogOpen(true)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Dataset
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDuplicate}>
                  <Copy className="h-4 w-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
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
          <Link to={`/projects/${dataset.project_id}/datasets/${dataset.id}`} className="block">
            <h3 className="font-medium line-clamp-1 hover:text-primary transition-colors">
              {dataset.name}
            </h3>
          </Link>
          <p className="text-sm text-muted-foreground line-clamp-2">
            {dataset.description || "No description provided"}
          </p>
          
          {/* URL display */}
          {dataset.url && (
            <div className="flex items-center gap-1 text-xs pt-1">
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
              <a 
                href={dataset.url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline truncate"
                onClick={(e) => e.stopPropagation()}
              >
                {dataset.url}
              </a>
            </div>
          )}
          
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
          <span>{dataset.annotation_file_count || 0} {(dataset.annotation_file_count || 0) === 1 ? 'annotation file' : 'annotation files'}</span>
        </div>
      </CardFooter>

      <EditDatasetDialog
        dataset={dataset}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        onDatasetUpdated={handleDatasetUpdated}
      />

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
