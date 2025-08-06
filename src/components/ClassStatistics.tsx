import React from "react";
import { Progress } from "@/components/ui/progress";

type ClassStat = {
  className: string;
  count: number;
  color: string;
};

interface ClassStatisticsProps {
  statistics: ClassStat[];
  selectedClass?: string;
  onClassIconClick?: (className: string) => void;
}

export const ClassStatistics: React.FC<ClassStatisticsProps> = ({ statistics, selectedClass, onClassIconClick }) => {
  // Calculate total instances for percentage calculation
  const totalInstances = statistics.reduce(
    (total, stat) => total + stat.count,
    0
  );

  // Sort by count (descending)
  const sortedStats = [...statistics].sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-4">
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
          </div>
        ))}
      </div>
      
      <div className="pt-2">
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
      </div>
    </div>
  );
};
