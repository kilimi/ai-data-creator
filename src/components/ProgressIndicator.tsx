
import React from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface ProgressIndicatorProps {
  value: number;
  className?: string;
  indicatorClassName?: string;
}

export const ProgressIndicator = ({
  value,
  className,
  indicatorClassName,
}: ProgressIndicatorProps) => {
  return (
    <div className={cn("relative", className)}>
      <Progress value={value} className="h-2 w-full" />
      {indicatorClassName && (
        <div 
          className={cn(
            "absolute top-0 left-0 h-2 rounded-full", 
            indicatorClassName
          )} 
          style={{ width: `${value}%` }}
        />
      )}
    </div>
  );
};
