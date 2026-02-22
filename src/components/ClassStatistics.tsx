import React from "react";

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
  const totalInstances = statistics.reduce(
    (total, stat) => total + (stat.count ?? 0),
    0
  );

  const sortedStats = [...statistics].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  return (
    <div className="space-y-2">
      {/* Compact summary bar */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span className="font-medium">{sortedStats.length} classes</span>
        <span>·</span>
        <span>{totalInstances} total instances</span>
      </div>

      {/* Combined color bar */}
      <div className="h-2 w-full flex rounded-full overflow-hidden">
        {sortedStats.map((stat) => (
          <div
            key={stat.className}
            style={{
              backgroundColor: stat.color,
              width: `${totalInstances > 0 ? ((stat.count ?? 0) / totalInstances) * 100 : 0}%`,
            }}
            title={`${stat.className}: ${stat.count ?? 0} (${totalInstances > 0 ? Math.round(((stat.count ?? 0) / totalInstances) * 100) : 0}%)`}
          />
        ))}
      </div>

      {/* Class list - compact rows */}
      <div className="space-y-0.5">
        {sortedStats.map((stat) => {
          const pct = totalInstances > 0 ? ((stat.count ?? 0) / totalInstances) * 100 : 0;
          return (
            <button
              key={stat.className}
              type="button"
              className={`w-full flex items-center gap-2 px-2 py-1 rounded text-sm transition-colors hover:bg-accent/50 ${
                selectedClass === stat.className ? 'bg-accent ring-1 ring-primary/30' : ''
              }`}
              onClick={onClassIconClick ? () => onClassIconClick(stat.className) : undefined}
              data-testid={`class-color-${stat.className.replace(/\s+/g, '-')}`}
            >
              <span
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: stat.color }}
              />
              <span className="flex-1 text-left truncate font-medium text-foreground">{stat.className}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {stat.count ?? 0}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                {Math.round(pct)}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
