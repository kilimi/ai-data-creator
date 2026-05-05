import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  Download,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Trash2,
} from "lucide-react";
import {
  formatEvaluationModelDisplay,
  formatMetricPct,
  getEvaluationRowMetrics,
  type EvalMetrics,
} from "@/lib/evaluationTableDisplay";

type Status =
  | "running"
  | "pending"
  | "completed"
  | "failed"
  | "stopped"
  | "cancelled"
  | "partial_failed"
  | string;

const STATUS_BORDER: Record<string, string> = {
  completed: "border-l-green-500",
  running: "border-l-blue-500",
  pending: "border-l-gray-500",
  failed: "border-l-red-500",
  partial_failed: "border-l-orange-500",
  stopped: "border-l-amber-500",
  cancelled: "border-l-amber-500",
};

const STATUS_PILL: Record<string, string> = {
  completed: "bg-green-500/15 text-green-400 border border-green-500/30",
  running: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  pending: "bg-gray-500/15 text-gray-400 border border-gray-500/30",
  failed: "bg-red-500/15 text-red-400 border border-red-500/30",
  partial_failed: "bg-orange-500/15 text-orange-400 border border-orange-500/30",
  stopped: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  cancelled: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
};

const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  running: "Running",
  pending: "Pending",
  failed: "Failed",
  partial_failed: "Partial",
  stopped: "Stopped",
  cancelled: "Cancelled",
};

function metricColor(v: number): string {
  if (v >= 0.85) return "text-green-400";
  if (v >= 0.6) return "text-amber-400";
  return "text-red-400";
}

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function MetricTile({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </span>
      <span
        className={`text-2xl font-semibold tabular-nums leading-tight ${
          value === null ? "text-muted-foreground" : metricColor(value)
        }`}
      >
        {value === null ? "—" : formatMetricPct(value)}
      </span>
    </div>
  );
}

export interface EvaluationCardProps {
  task: any;
  childTasks?: any[];
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onOpen?: () => void;
  onRename?: () => void;
  onRerun?: () => void;
  onDelete?: () => void;
  onDownloadCoco?: () => void;
  // compare mode
  compareMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  // child appearance
  variant?: "parent" | "child";
}

export function EvaluationCard({
  task,
  childTasks = [],
  isExpanded,
  onToggleExpand,
  onOpen,
  onRename,
  onRerun,
  onDelete,
  onDownloadCoco,
  compareMode,
  selected,
  onToggleSelect,
  variant = "parent",
}: EvaluationCardProps) {
  const metadata = task.task_metadata || {};
  const isMultiDataset = !!metadata.is_multi_dataset;
  const isChild = variant === "child";

  const aggregateStatus: Status = (() => {
    if (!isMultiDataset) return task.status;
    if (childTasks.length === 0) return task.status;
    if (childTasks.every((ct) => ct.status === "completed")) return "completed";
    if (childTasks.some((ct) => ct.status === "failed")) return "partial_failed";
    if (childTasks.some((ct) => ct.status === "running")) return "running";
    return task.status;
  })();

  const aggregateProgress = isMultiDataset && childTasks.length > 0
    ? Math.round(
        childTasks.reduce((s, c) => s + (c.progress || 0), 0) / childTasks.length
      )
    : task.progress;

  const metrics: EvalMetrics | null = getEvaluationRowMetrics(metadata, {
    isMultiDataset,
    aggregateStatus,
  });
  const modelDisplay = formatEvaluationModelDisplay(metadata);

  const isCompleted = aggregateStatus === "completed";
  const isFailed = aggregateStatus === "failed";
  const canRerun =
    !isChild &&
    (isCompleted ||
      isFailed ||
      aggregateStatus === "partial_failed" ||
      task.status === "stopped" ||
      task.status === "cancelled");
  const showProgress =
    aggregateStatus === "running" || aggregateStatus === "pending";

  return (
    <div
      onClick={onOpen}
      className={`group relative rounded-lg border border-border bg-card text-card-foreground border-l-4 ${
        STATUS_BORDER[aggregateStatus] ?? "border-l-gray-500"
      } ${
        isChild ? "bg-muted/30 ml-8" : ""
      } cursor-pointer hover:border-primary/40 transition-colors`}
    >
      <div className="p-5">
        <div className="flex items-start gap-4">
          {compareMode && !isChild && (
            <div onClick={(e) => e.stopPropagation()} className="pt-1">
              <Checkbox checked={!!selected} onCheckedChange={onToggleSelect} />
            </div>
          )}

          {/* Left: identity */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold truncate" title={task.name}>
                {isChild ? (metadata.dataset_name || task.name) : task.name}
              </h3>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  STATUS_PILL[aggregateStatus] ?? STATUS_PILL.pending
                }`}
              >
                {STATUS_LABEL[aggregateStatus] ?? aggregateStatus}
              </span>
              {isMultiDataset && (
                <Badge variant="outline" className="text-xs">
                  {(metadata.child_task_ids || []).length} datasets
                </Badge>
              )}
            </div>
            <div className="mt-1 text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
              <span className="font-medium text-foreground/80">
                {modelDisplay}
              </span>
              <span>·</span>
              <span>#{task.id}</span>
              <span>·</span>
              <span title={task.created_at}>{timeAgo(task.created_at)}</span>
            </div>

            {showProgress && (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      isFailed
                        ? "bg-red-500"
                        : isCompleted
                        ? "bg-green-500"
                        : "bg-blue-500"
                    }`}
                    style={{ width: `${aggregateProgress}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                  {aggregateProgress}%
                </span>
              </div>
            )}
          </div>

          {/* Middle: metrics */}
          <div className="hidden md:grid grid-cols-3 gap-6 px-2">
            <MetricTile label="Precision" value={metrics?.precision ?? null} />
            <MetricTile label="Recall" value={metrics?.recall ?? null} />
            <MetricTile label="F1" value={metrics?.f1 ?? null} />
          </div>

          {/* Right: actions */}
          <div
            className="flex items-center gap-2 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {isMultiDataset && !isChild && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onToggleExpand}
                className="h-8 px-2"
              >
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    isExpanded ? "" : "-rotate-90"
                  }`}
                />
                <span className="ml-1 text-xs">
                  {isExpanded ? "Hide" : "Datasets"}
                </span>
              </Button>
            )}
            {canRerun && onRerun && (
              <Button
                variant="outline"
                size="sm"
                onClick={onRerun}
                className="h-8"
              >
                <RotateCw className="w-3.5 h-3.5 mr-1.5" />
                Rerun
              </Button>
            )}
            {!isChild && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreHorizontal className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {onRename && (
                    <DropdownMenuItem onClick={onRename}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Rename
                    </DropdownMenuItem>
                  )}
                  {onDownloadCoco && isCompleted && (
                    <DropdownMenuItem onClick={onDownloadCoco}>
                      <Download className="w-4 h-4 mr-2" />
                      Download COCO
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {onDelete && (
                    <DropdownMenuItem
                      onClick={onDelete}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {isChild && onDownloadCoco && isCompleted && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onDownloadCoco}
                title="Download COCO predictions"
              >
                <Download className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Mobile metrics */}
        <div className="mt-4 grid grid-cols-3 gap-4 md:hidden">
          <MetricTile label="Precision" value={metrics?.precision ?? null} />
          <MetricTile label="Recall" value={metrics?.recall ?? null} />
          <MetricTile label="F1" value={metrics?.f1 ?? null} />
        </div>
      </div>
    </div>
  );
}
