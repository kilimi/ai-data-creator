
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LayoutControls, LayoutType } from "@/components/LayoutControls";

interface DatasetHeaderProps {
  isLoading: boolean;
  name: string | undefined;
  currentLayout?: LayoutType;
  onLayoutChange?: (layout: LayoutType) => void;
}

export function DatasetHeader({ isLoading, name, currentLayout, onLayoutChange }: DatasetHeaderProps) {
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
  );
}
