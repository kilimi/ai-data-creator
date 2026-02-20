import { Link } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2, Copy, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LayoutControls, LayoutType } from "@/components/LayoutControls";
import { Dataset } from "@/types";
import { DatasetInfoBar } from "@/components/DatasetInfoBar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DatasetHeaderProps {
  isLoading: boolean;
  name: string | undefined;
  currentLayout?: LayoutType;
  onLayoutChange?: (layout: LayoutType) => void;
  dataset?: Dataset;
  onEditDataset?: () => void;
  onDeleteDataset?: () => void;
  onDuplicateDataset?: () => void;
  projectId?: string | null;
  imageCount?: number;
}

export function DatasetHeader({ isLoading, name, currentLayout, onLayoutChange, dataset, onEditDataset, onDeleteDataset, onDuplicateDataset, projectId, imageCount = 0 }: DatasetHeaderProps) {
  return (
    <div className="space-y-3">
      {/* Top row: back + title + actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost" 
            size="icon" 
            asChild
            className="h-9 w-9"
          >
            <Link to={projectId ? `/projects/${projectId}/datasets` : "/datasets"}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-2xl font-bold">
            {isLoading ? 'Loading...' : name}
          </h1>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Dataset actions dropdown */}
          {dataset && (onEditDataset || onDuplicateDataset || onDeleteDataset) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9">
                  <MoreHorizontal className="h-4 w-4 mr-1" />
                  Actions
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onEditDataset && (
                  <DropdownMenuItem onClick={onEditDataset}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit Dataset
                  </DropdownMenuItem>
                )}
                {onDuplicateDataset && (
                  <DropdownMenuItem onClick={onDuplicateDataset}>
                    <Copy className="h-4 w-4 mr-2" />
                    Duplicate Dataset
                  </DropdownMenuItem>
                )}
                {onDeleteDataset && (
                  <DropdownMenuItem onClick={onDeleteDataset} className="text-destructive focus:text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Dataset
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {currentLayout && onLayoutChange && (
            <div className="flex-shrink-0">
              <LayoutControls 
                currentLayout={currentLayout}
                onLayoutChange={onLayoutChange}
                compact={true}
              />
            </div>
          )}
        </div>
      </div>

      {/* Info bar row */}
      {dataset && !isLoading && (
        <DatasetInfoBar
          dataset={dataset}
          imageCount={imageCount}
        />
      )}
    </div>
  );
}
