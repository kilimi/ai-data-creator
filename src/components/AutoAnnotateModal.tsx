import * as React from "react";
import { cn } from "@/lib/utils";
import { Bot, Crosshair, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";

interface AutoAnnotateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasetId: number;
  datasetName: string;
}

type Family = "yolo" | "depth_anything";

const YOLO_ARCHS = [
  { value: "yolo11", label: "YOLO11", desc: "Latest generation" },
  { value: "yolo26", label: "YOLO26", desc: "Newest release" },
  { value: "yolo_nas", label: "YOLO-NAS", desc: "Neural architecture search" },
  { value: "rtdetr", label: "RT-DETR", desc: "Transformer-based" },
];

const YOLO_SIZES: Record<string, { value: string; label: string }[]> = {
  yolo11: [
    { value: "n", label: "Nano" },
    { value: "s", label: "Small" },
    { value: "m", label: "Medium" },
    { value: "l", label: "Large" },
    { value: "x", label: "X-Large" },
  ],
  yolo26: [
    { value: "n", label: "Nano" },
    { value: "s", label: "Small" },
    { value: "m", label: "Medium" },
    { value: "l", label: "Large" },
    { value: "x", label: "X-Large" },
  ],
  yolo_nas: [
    { value: "s", label: "Small" },
    { value: "m", label: "Medium" },
    { value: "l", label: "Large" },
  ],
  rtdetr: [
    { value: "l", label: "Large" },
    { value: "x", label: "X-Large" },
  ],
};

const DEPTH_SIZES = [
  { value: "small", label: "Small (ViT-S)" },
  { value: "base", label: "Base (ViT-B)" },
  { value: "large", label: "Large (ViT-L)" },
];

export function AutoAnnotateModal({ open, onOpenChange, datasetId, datasetName }: AutoAnnotateModalProps) {
  const { toast } = useToast();
  const [selectedFamily, setSelectedFamily] = React.useState<Family | null>(null);
  const [selectedYoloArch, setSelectedYoloArch] = React.useState("yolo11");
  const [selectedSize, setSelectedSize] = React.useState("n");
  const [saveAsNew, setSaveAsNew] = React.useState(false);
  const [saveTarget, setSaveTarget] = React.useState<"dataset" | "collection">("dataset");
  const [newDatasetName, setNewDatasetName] = React.useState("");

  const selectedModel = selectedFamily === "yolo"
    ? `${selectedYoloArch}${selectedSize}`
    : selectedFamily === "depth_anything"
    ? `depth_anything_v2_${selectedSize}`
    : "";

  const handleSubmit = async () => {
    try {
      const body: Record<string, any> = {
        model_name: selectedModel,
        dataset_id: datasetId,
      };

      if (selectedFamily === "depth_anything" && saveAsNew) {
        body.save_as = saveTarget;
        if (saveTarget === "dataset") {
          body.new_dataset_name = newDatasetName || `${datasetName} - Depth`;
        }
      }

      await fetch("http://localhost:9999/preannotate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      toast({
        title: "Auto-annotation started",
        description: `Running ${selectedModel} on ${datasetName}. Check tasks for progress.`,
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to start auto-annotation",
        variant: "destructive",
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg mx-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
            <Bot className="h-5 w-5 text-primary" />
            Auto-Annotate with AI
          </DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Automatically generate annotations for <span className="font-medium text-foreground">{datasetName}</span> using a pre-trained model.
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-4 mt-2">
          <span className="block font-medium text-sm">Choose a model family</span>
          <div className="grid grid-cols-2 gap-2">
            {([
              { key: "yolo" as Family, icon: Crosshair, label: "YOLO", desc: "Object detection & segmentation" },
              { key: "depth_anything" as Family, icon: Layers, label: "Depth Anything V2", desc: "Monocular depth estimation" },
            ]).map(({ key, icon: Icon, label, desc }) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setSelectedFamily(key);
                  if (key === "yolo") { setSelectedYoloArch("yolo11"); setSelectedSize("n"); }
                  else { setSelectedSize("small"); }
                  setSaveAsNew(false);
                  setNewDatasetName("");
                }}
                className={cn(
                  "flex items-center gap-3 rounded-lg border p-3 text-left transition-all",
                  selectedFamily === key
                    ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                    : "border-border hover:border-muted-foreground/30 hover:bg-muted/40"
                )}
              >
                <div className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                  selectedFamily === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* YOLO: architecture + size */}
          {selectedFamily === "yolo" && (
            <>
              <div className="space-y-2">
                <span className="block font-medium text-sm">Architecture</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {YOLO_ARCHS.map(({ value, label, desc }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setSelectedYoloArch(value);
                        const sizes = YOLO_SIZES[value];
                        setSelectedSize(sizes[0].value);
                      }}
                      className={cn(
                        "flex flex-col rounded-md border px-3 py-2 text-left text-sm transition-all",
                        selectedYoloArch === value
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:bg-muted/40"
                      )}
                    >
                      <span className="font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <span className="block font-medium text-sm">Model size</span>
                <div className="flex gap-1.5 flex-wrap">
                  {(YOLO_SIZES[selectedYoloArch] || []).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSelectedSize(value)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm font-medium transition-all",
                        selectedSize === value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted/40"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Depth Anything V2: size + save options */}
          {selectedFamily === "depth_anything" && (
            <>
              <div className="space-y-2">
                <span className="block font-medium text-sm">Model size</span>
                <div className="flex gap-1.5">
                  {DEPTH_SIZES.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSelectedSize(value)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-sm font-medium transition-all",
                        selectedSize === value
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted/40"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save output options */}
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="save-as-new"
                    checked={saveAsNew}
                    onCheckedChange={(checked) => setSaveAsNew(checked === true)}
                  />
                  <Label htmlFor="save-as-new" className="text-sm font-medium cursor-pointer">
                    Save output as new resource
                  </Label>
                </div>

                {saveAsNew && (
                  <div className="space-y-3 pl-6">
                    <RadioGroup
                      value={saveTarget}
                      onValueChange={(v) => setSaveTarget(v as "dataset" | "collection")}
                      className="space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="dataset" id="target-dataset" />
                        <Label htmlFor="target-dataset" className="text-sm cursor-pointer">
                          New Dataset
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="collection" id="target-collection" />
                        <Label htmlFor="target-collection" className="text-sm cursor-pointer">
                          New Image Collection
                        </Label>
                      </div>
                    </RadioGroup>

                    {saveTarget === "dataset" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="new-dataset-name" className="text-xs text-muted-foreground">
                          Dataset name
                        </Label>
                        <Input
                          id="new-dataset-name"
                          placeholder={`${datasetName} - Depth`}
                          value={newDatasetName}
                          onChange={(e) => setNewDatasetName(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!selectedFamily} onClick={handleSubmit}>
              <Bot className="h-4 w-4 mr-2" />
              Start Annotation
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
