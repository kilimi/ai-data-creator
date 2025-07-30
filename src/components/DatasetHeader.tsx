
import { Link } from "react-router-dom";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LayoutControls, LayoutType } from "@/components/LayoutControls";
import { Dataset } from "@/types";

interface DatasetHeaderProps {
  isLoading: boolean;
  name: string | undefined;
  currentLayout?: LayoutType;
  onLayoutChange?: (layout: LayoutType) => void;
  dataset?: Dataset;
  onEditDataset?: () => void;
}

export function DatasetHeader({ isLoading, name, currentLayout, onLayoutChange, dataset, onEditDataset }: DatasetHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-2">
        <Button 
          variant="ghost" 
          size="icon" 
          asChild
          className="h-9 w-9"
        >
          <Link to="/datasets">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">
          {isLoading ? 'Loading...' : name}
        </h1>
      </div>
      
      <div className="flex items-center gap-2">
        {dataset && onEditDataset && (
          <Button 
            variant="outline" 
            size="sm"
            onClick={onEditDataset}
            className="h-9"
          >
            <Pencil className="h-4 w-4 mr-2" />
            Edit Dataset
          </Button>
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
  );
}
