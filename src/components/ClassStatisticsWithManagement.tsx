import React, { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { ClassManagementMenu } from "./ClassManagementMenu";
import { GlobalMergeClassesDialog } from "./GlobalMergeClassesDialog";
import { Merge } from "lucide-react";
import { AnnotationSample } from "@/utils/annotations";

type ClassStat = {
  className: string;
  count: number;
  color: string;
};

interface ClassStatisticsWithManagementProps {
  statistics: ClassStat[];
  annotations: AnnotationSample[];
  selectedClass?: string;
  onClassIconClick?: (className: string) => void;
  onRenameClass: (oldClassName: string, newClassName: string) => void;
  onDeleteClass: (className: string) => void;
  onMergeClasses: (sourceClassName: string, targetClassName: string) => void;
}

export const ClassStatisticsWithManagement: React.FC<ClassStatisticsWithManagementProps> = ({ 
  statistics, 
  annotations,
  selectedClass, 
  onClassIconClick,
  onRenameClass,
  onDeleteClass,
  onMergeClasses
}) => {
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  
  // Calculate total instances for percentage calculation
  const totalInstances = statistics.reduce(
    (total, stat) => total + stat.count,
    0
  );

  // Sort by count (descending)
  const sortedStats = [...statistics].sort((a, b) => b.count - a.count);
  const availableClasses = sortedStats.map(stat => stat.className);

  return (
    <div className="space-y-4">
      {/* Header with merge classes button */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium text-white">Class Statistics</h3>
        {availableClasses.length > 1 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMergeDialog(true)}
            className="border-gray-700 bg-gray-800 hover:bg-gray-700 text-white"
          >
            <Merge className="h-4 w-4 mr-2" />
            Merge Classes
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2">
        {sortedStats.map((stat) => (
          <div key={stat.className} className="flex items-center gap-2">
            <button
              type="button"
              className={`w-3 h-3 rounded-full border-2 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400 flex-shrink-0 ${
                selectedClass === stat.className
                  ? 'border-blue-400 ring-2 ring-blue-400 scale-125'
                  : 'border-gray-600 hover:border-blue-400'
              }`}
              style={{ backgroundColor: stat.color }}
              title={`Edit color/opacity for ${stat.className}`}
              onClick={onClassIconClick ? () => onClassIconClick(stat.className) : undefined}
            >
              <span className="sr-only">{stat.className}</span>
            </button>
            <div className="flex-1 text-sm font-medium overflow-hidden">
              <span className="truncate">{stat.className}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              {stat.count} ({Math.round((stat.count / totalInstances) * 100)}%)
            </div>
            <ClassManagementMenu
              className={stat.className}
              annotations={annotations}
              availableClasses={availableClasses}
              onRenameClass={onRenameClass}
              onDeleteClass={onDeleteClass}
              onMergeClasses={onMergeClasses}
            />
          </div>
        ))}
      </div>
      
      <div className="pt-2 space-y-3">
        <div className="h-2 w-full flex rounded-full overflow-hidden">
          {sortedStats.map((stat) => (
            <div
              key={stat.className}
              style={{
                backgroundColor: stat.color,
                width: `${(stat.count / totalInstances) * 100}%`,
              }}
            />
          ))}
        </div>
        
        <div className="space-y-3">
          {sortedStats.map((stat) => (
            <div key={stat.className} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium">{stat.className}</span>
                <span className="text-muted-foreground">
                  {stat.count} instances
                </span>
              </div>
              <Progress
                value={(stat.count / totalInstances) * 100}
                className="h-2"
                style={{
                  ["--progress-background" as any]: stat.color,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Global merge classes dialog */}
      <GlobalMergeClassesDialog
        isOpen={showMergeDialog}
        onClose={() => setShowMergeDialog(false)}
        annotations={annotations}
        availableClasses={availableClasses}
        onMerge={onMergeClasses}
      />
    </div>
  );
};