import * as React from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Dataset } from "@/types";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, FileImage, Layers, MoreHorizontal, Tag, Pencil, Edit, Bot, ScanEye, Eye, SquareStack, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useImageLoad } from "@/utils/animations";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EditDatasetDialog } from "@/components/EditDatasetDialog";
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
  const [isAnnotateModalOpen, setIsAnnotateModalOpen] = React.useState(false);
  const [selectedModel, setSelectedModel] = React.useState<string>("SAM");

  const handleDatasetUpdated = (updatedDataset: Dataset) => {
    if (onDatasetUpdated) {
      onDatasetUpdated(updatedDataset);
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
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="h-7 w-7">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <button
                    className="flex items-center w-full"
                    onClick={() => setIsAnnotateModalOpen(true)}
                  >
                    <Pencil className="h-4 w-4 mr-2" />
                    Annotate using AI foundation models
                  </button>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsEditDialogOpen(true)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Dataset
                </DropdownMenuItem>
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

      {/* Annotate Modal */}
      <Dialog open={isAnnotateModalOpen} onOpenChange={setIsAnnotateModalOpen}>
      {/* Annotate Modal - Modern UI */}
      <Dialog open={isAnnotateModalOpen} onOpenChange={setIsAnnotateModalOpen}>
        <DialogContent className="max-w-md mx-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
              <Bot className="h-5 w-5 text-primary" />
              Annotate with AI Model
            </DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">Select a foundation model to annotate your dataset images.</p>
          </DialogHeader>
          <div className="flex flex-col gap-6 mt-4">
            <div>
              <span className="block mb-2 font-medium text-sm">Model</span>
              <ToggleGroup
                type="single"
                value={selectedModel}
                onValueChange={setSelectedModel}
                className="flex gap-3"
              >
                <ToggleGroupItem value="SAM" aria-label="SAM" className="flex flex-col items-center px-4 py-2 rounded-lg border data-[state=on]:bg-primary data-[state=on]:text-white transition-colors">
                  <ScanEye className="h-5 w-5 mb-1" />
                  <span className="text-xs">SAM</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="YOLOv11n" aria-label="YOLOv11n" className="flex flex-col items-center px-4 py-2 rounded-lg border data-[state=on]:bg-primary data-[state=on]:text-white transition-colors">
                  <Eye className="h-5 w-5 mb-1" />
                  <span className="text-xs">YOLOv11n</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="YOLOv11s" aria-label="YOLOv11s" className="flex flex-col items-center px-4 py-2 rounded-lg border data-[state=on]:bg-primary data-[state=on]:text-white transition-colors">
                  <SquareStack className="h-5 w-5 mb-1" />
                  <span className="text-xs">YOLOv11s</span>
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <DialogFooter>
              <Button
                className="w-full"
                size="lg"
                onClick={async () => {
                  try {
                    await fetch("/api/preannotate", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        model_name: selectedModel,
                        dataset_id: dataset.id,
                      }),
                    });
                  } catch (err) {
                    // Optionally handle error
                  }
                  setIsAnnotateModalOpen(false);
                }}
              >
                <Pencil className="h-4 w-4 mr-2" />
                Annotate
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      </Dialog>
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
