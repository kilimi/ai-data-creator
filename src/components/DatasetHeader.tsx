
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DatasetHeaderProps {
  isLoading: boolean;
  name: string | undefined;
}

export function DatasetHeader({ isLoading, name }: DatasetHeaderProps) {
  return (
    <div className="flex items-center gap-2 mb-6">
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
  );
}
