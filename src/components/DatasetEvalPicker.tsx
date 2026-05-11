import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  ChevronRight,
  ChevronDown,
  Folder,
  Database,
  ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types exposed to caller ────────────────────────────────────────────────
export interface PickerAnnotationFile {
  id: string;
  name: string;
  classes: string[];
  taskType?: "detection" | "segmentation" | "classification";
  modifiedAt?: string;
  annotationCount?: number;
}

export interface PickerCollection {
  id: string;
  name: string;
  isDefault?: boolean;
  imageCount?: number;
}

export interface PickerDataset {
  id: number;
  name: string;
  imageCount: number;
  annotationFileCount?: number;
  thumbnailUrl?: string;
  annotationFiles: PickerAnnotationFile[];
  collections: PickerCollection[];
  lastUsedAt?: string;
}

export interface PickerGroup {
  id: number;
  name: string;
  datasetIds: number[];
}

export interface DatasetSelection {
  datasetId: number;
  annotationFileId: string | null;
  collectionId: string | null;
}

interface Props {
  datasets: PickerDataset[];
  groups?: PickerGroup[];
  modelClasses: string[];
  modelTaskType?: "detection" | "segmentation" | "classification";
  value: DatasetSelection[];
  onChange: (next: DatasetSelection[]) => void;
}

// ── Component ──────────────────────────────────────────────────────────────
export function DatasetEvalPicker({
  datasets,
  groups = [],
  value,
  onChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "with-gt">("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<number>>(
    new Set(groups.map((g) => g.id))
  );

  const selectionMap = useMemo(() => {
    const m = new Map<number, DatasetSelection>();
    value.forEach((s) => m.set(s.datasetId, s));
    return m;
  }, [value]);

  const datasetMap = useMemo(() => {
    const m = new Map<number, PickerDataset>();
    datasets.forEach((d) => m.set(d.id, d));
    return m;
  }, [datasets]);

  function visible(d: PickerDataset) {
    if (query && !d.name.toLowerCase().includes(query.toLowerCase()))
      return false;
    const gtCount = d.annotationFileCount ?? d.annotationFiles.length;
    if (filter === "with-gt" && gtCount === 0) return false;
    return true;
  }

  const groupedIds = new Set<number>(groups.flatMap((g) => g.datasetIds));
  const ungrouped = datasets.filter((d) => !groupedIds.has(d.id) && visible(d));

  const recent = [...ungrouped]
    .filter((d) => d.lastUsedAt)
    .sort(
      (a, b) =>
        new Date(b.lastUsedAt!).getTime() - new Date(a.lastUsedAt!).getTime()
    )
    .slice(0, 3);
  const recentIds = new Set(recent.map((d) => d.id));
  const others = ungrouped.filter((d) => !recentIds.has(d.id));

  function toggleSelected(d: PickerDataset, checked: boolean) {
    if (checked) {
      const file = d.annotationFiles[0];
      const coll = d.collections[0];
      onChange([
        ...value,
        {
          datasetId: d.id,
          annotationFileId: file?.id ?? null,
          collectionId: coll?.id ?? null,
        },
      ]);
      setExpanded((s) => new Set(s).add(d.id));
    } else {
      onChange(value.filter((s) => s.datasetId !== d.id));
    }
  }

  function updateSel(datasetId: number, patch: Partial<DatasetSelection>) {
    onChange(
      value.map((s) => (s.datasetId === datasetId ? { ...s, ...patch } : s))
    );
  }

  function DatasetRow({ d }: { d: PickerDataset }) {
    const sel = selectionMap.get(d.id);
    const isSelected = !!sel;
    const isExpanded = expanded.has(d.id);

    const gtCount = d.annotationFileCount ?? d.annotationFiles.length;

    return (
      <div
        className={cn(
          "rounded-md border bg-card transition-colors",
          isSelected ? "border-primary/50 bg-primary/[0.03]" : "border-border"
        )}
      >
        <div className="flex items-center gap-3 px-3 py-2">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(c) => toggleSelected(d, !!c)}
          />
          <div className="h-9 w-9 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
            {d.thumbnailUrl ? (
              <img src={d.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
            )}
          </div>

          <button
            type="button"
            className="flex-1 min-w-0 text-left"
            onClick={() => {
              if (isSelected) {
                setExpanded((s) => {
                  const n = new Set(s);
                  n.has(d.id) ? n.delete(d.id) : n.add(d.id);
                  return n;
                });
              } else {
                toggleSelected(d, true);
              }
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-medium text-sm truncate">{d.name}</span>
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5">
              <span>{d.imageCount.toLocaleString()} images</span>
              <span>
                {gtCount} GT file
                {gtCount === 1 ? "" : "s"}
              </span>
              {d.lastUsedAt && (
                <span className="text-muted-foreground/70">
                  used {timeAgo(d.lastUsedAt)}
                </span>
              )}
            </div>
          </button>

          {isSelected && (
            <button
              type="button"
              onClick={() =>
                setExpanded((s) => {
                  const n = new Set(s);
                  n.has(d.id) ? n.delete(d.id) : n.add(d.id);
                  return n;
                })
              }
              className="text-muted-foreground hover:text-foreground"
              aria-label={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
        </div>

        {isSelected && isExpanded && (
          <div className="border-t border-border/60 px-3 py-3 grid grid-cols-1 md:grid-cols-2 gap-3 bg-muted/30">
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Ground truth
              </label>
              <Select
                value={sel?.annotationFileId ?? "none"}
                onValueChange={(v) =>
                  updateSel(d.id, {
                    annotationFileId: v === "none" ? null : v,
                  })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Pick annotation file" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No ground truth</SelectItem>
                  {d.annotationFiles.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      <div className="flex items-center gap-2">
                        <span>{f.name}</span>
                        {f.taskType && (
                          <span className="text-[10px] text-muted-foreground">
                            ({f.taskType})
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
                Image collection
              </label>
              <Select
                value={sel?.collectionId ?? ""}
                onValueChange={(v) => updateSel(d.id, { collectionId: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Pick collection" />
                </SelectTrigger>
                <SelectContent>
                  {d.collections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                      {c.isDefault ? " (default)" : ""}
                      {c.imageCount != null && (
                        <span className="text-[10px] text-muted-foreground ml-1">
                          · {c.imageCount} imgs
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>
    );
  }

  const totalImages = value.reduce((sum, s) => {
    const d = datasetMap.get(s.datasetId);
    return sum + (d?.imageCount ?? 0);
  }, 0);

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search datasets…"
              className="pl-8 h-9"
            />
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs">
          {(
            [
              ["all", "All"],
              ["with-gt", "Has GT"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                "px-2 py-1 rounded-md border transition-colors",
                filter === k
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto p-3 space-y-4">
        {recent.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              Recently used
            </h4>
            <div className="space-y-2">
              {recent.map((d) => (
                <DatasetRow key={d.id} d={d} />
              ))}
            </div>
          </section>
        )}

        {groups.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
              Dataset groups
            </h4>
            {groups.map((g) => {
              const dsInGroup = g.datasetIds
                .map((id) => datasetMap.get(id))
                .filter(Boolean) as PickerDataset[];
              const visibleDs = dsInGroup.filter(visible);
              const isOpen = openGroups.has(g.id);
              return (
                <div key={g.id} className="rounded-md border border-border bg-background">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenGroups((s) => {
                          const n = new Set(s);
                          n.has(g.id) ? n.delete(g.id) : n.add(g.id);
                          return n;
                        })
                      }
                      className="flex items-center gap-1.5 text-sm font-medium"
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                      {g.name}
                      <Badge variant="secondary" className="text-[10px] ml-1">
                        {dsInGroup.length}
                      </Badge>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => {
                        const additions: DatasetSelection[] = [];
                        dsInGroup.forEach((d) => {
                          if (selectionMap.has(d.id)) return;
                          const file = d.annotationFiles[0];
                          const coll = d.collections[0];
                          additions.push({
                            datasetId: d.id,
                            annotationFileId: file?.id ?? null,
                            collectionId: coll?.id ?? null,
                          });
                        });
                        if (additions.length) onChange([...value, ...additions]);
                      }}
                    >
                      Add all
                    </Button>
                  </div>
                  {isOpen && visibleDs.length > 0 && (
                    <div className="space-y-2 px-2 pb-2">
                      {visibleDs.map((d) => (
                        <DatasetRow key={d.id} d={d} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {others.length > 0 && (
          <section className="space-y-2">
            {(recent.length > 0 || groups.length > 0) && (
              <h4 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">
                All datasets
              </h4>
            )}
            <div className="space-y-2">
              {others.map((d) => (
                <DatasetRow key={d.id} d={d} />
              ))}
            </div>
          </section>
        )}

        {ungrouped.length === 0 &&
          groups.every(
            (g) =>
              g.datasetIds
                .map((id) => datasetMap.get(id))
                .filter(Boolean)
                .filter((d) => visible(d as PickerDataset)).length === 0
          ) && (
            <div className="text-center py-10 text-sm text-muted-foreground">
              <Database className="h-8 w-8 mx-auto mb-2 opacity-40" />
              No datasets match your filters
            </div>
          )}
      </div>

      <div className="border-t border-border px-3 py-2 flex items-center gap-3 text-xs bg-muted/40 rounded-b-lg">
        <span className="font-medium">
          {value.length} dataset{value.length === 1 ? "" : "s"}
        </span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {totalImages.toLocaleString()} images
        </span>
      </div>
    </div>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  const m = Math.floor(d / 30);
  return `${m}mo ago`;
}
