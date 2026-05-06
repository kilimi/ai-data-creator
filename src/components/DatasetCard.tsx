import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Dataset } from "@/types";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, FileImage, Layers, MoreHorizontal, Tag, Edit, ExternalLink, Copy, Pencil, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { useImageLoad } from "@/utils/animations";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EditDatasetDialog } from "@/components/EditDatasetDialog";
import { useApi } from "@/hooks/use-api";
import { resolveBackendMediaUrl } from "@/config/api";
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
  const thumbnailSrc = resolveBackendMediaUrl(dataset.thumbnailUrl);
  const imageLoaded = useImageLoad(thumbnailSrc);
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
  
  // Derived metrics
  const imgCount = dataset.image_count || 0;
  const fileCount = dataset.annotation_file_count || 0;

  // Only surface a status pill when the dataset has images but no annotation files yet.
  // A dataset can have many annotation files, so we don't compute a 1:1 progress.
  const status: { label: string; cls: string; Icon: typeof CheckCircle2 } | null =
    imgCount === 0
      ? { label: "Empty", cls: "bg-muted text-muted-foreground border-border", Icon: CircleDashed }
      : fileCount === 0
        ? { label: "Unannotated", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30", Icon: CircleDashed }
        : null;

  const datasetHref = dataset.project_id
    ? `/projects/${dataset.project_id}/datasets/${dataset.id}`
    : `/datasets/${dataset.id}`;
  const annotateHref = `${datasetHref}/annotate`;

  return (
    <Card
      className={cn(
        "group overflow-hidden hover-card flex flex-col h-full transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 cursor-pointer",
        className,
      )}
      onClick={() => navigate(datasetHref)}
    >
      <CardHeader className="p-0">
        <div className="relative h-40 w-full overflow-hidden bg-muted/30">
          {thumbnailSrc ? (
            <>
              {!imageLoaded && (
                <div className="absolute inset-0 bg-muted animate-pulse" />
              )}
              <img
                key={thumbnailSrc}
                src={thumbnailSrc}
                alt={dataset.name}
                loading="lazy"
                decoding="async"
                className={cn(
                  "h-full w-full object-cover transition-all duration-500",
                  !imageLoaded && "opacity-0",
                  imageLoaded && "opacity-100",
                )}
              />
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted/50">
              <Database className="h-16 w-16 text-muted-foreground/30" />
            </div>
          )}

          {/* Status pill, top-left (only shown for Empty / Unannotated) */}
          {status && (
            <div className="absolute top-2 left-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium backdrop-blur",
                  status.cls,
                )}
              >
                <status.Icon className="h-3 w-3" />
                {status.label}
              </span>
            </div>
          )}

          {/* Actions menu, top-right */}
          <div className="absolute top-2 right-2" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur"
                >
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

      <CardContent className="p-4 flex-1 flex flex-col">
        <div className="space-y-1 flex-1">
          <h3 className="font-medium line-clamp-1 hover:text-primary transition-colors">
            {dataset.name}
          </h3>
          <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
            {dataset.description || "No description provided"}
          </p>

          {/* Annotation progress removed: datasets can have many annotation files (1:N) */}

          {/* Tags */}
          {dataset.tags && dataset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-2">
              {dataset.tags.slice(0, 4).map((tag) => (
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

      <CardFooter className="p-4 pt-0 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <FileImage className="h-3.5 w-3.5" />
            {imgCount.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" />
            {fileCount}
          </span>
          <span title={new Date(dataset.updated_at || dataset.created_at).toLocaleString()}>
            · {formatRelative(dataset.updated_at || dataset.created_at)}
          </span>
        </div>
        {fileCount === 0 && imgCount > 0 ? (
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-primary hover:text-primary"
            onClick={(e) => e.stopPropagation()}
          >
            <Link to={annotateHref}>
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Annotate
            </Link>
          </Button>
        ) : progress > 0 && progress < 100 ? (
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={(e) => e.stopPropagation()}
          >
            <Link to={annotateHref}>
              <Pencil className="h-3.5 w-3.5 mr-1" />
              Resume
            </Link>
          </Button>
        ) : null}
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

function formatRelative(dateStr: string): string {
  const d = new Date(dateStr).getTime();
  const diff = Date.now() - d;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
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
