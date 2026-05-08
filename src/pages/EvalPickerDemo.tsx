import { useState } from "react";
import {
  DatasetEvalPicker,
  type DatasetSelection,
  type PickerDataset,
  type PickerGroup,
} from "@/components/DatasetEvalPicker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Brain } from "lucide-react";

const FAKE_DATASETS: PickerDataset[] = [
  {
    id: 1,
    name: "orchard_test_2024",
    imageCount: 1240,
    lastUsedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    annotationFiles: [
      {
        id: "a1",
        name: "final_v3.json",
        classes: ["apple", "pear", "leaf", "branch"],
        taskType: "detection",
        modifiedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        annotationCount: 8421,
      },
      {
        id: "a2",
        name: "v1_initial.json",
        classes: ["apple", "pear"],
        taskType: "detection",
        modifiedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        annotationCount: 3120,
      },
      {
        id: "a3",
        name: "segmentation_masks.json",
        classes: ["apple", "pear", "leaf"],
        taskType: "segmentation",
        modifiedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
        annotationCount: 5500,
      },
    ],
    collections: [
      { id: "c1", name: "default", isDefault: true, imageCount: 1240 },
      { id: "c2", name: "validation_split", imageCount: 240 },
    ],
  },
  {
    id: 2,
    name: "orchard_val",
    imageCount: 340,
    lastUsedAt: new Date(Date.now() - 86400000).toISOString(),
    annotationFiles: [
      {
        id: "b1",
        name: "ground_truth.json",
        classes: ["apple", "pear", "leaf", "branch"],
        taskType: "detection",
        modifiedAt: new Date().toISOString(),
        annotationCount: 2104,
      },
    ],
    collections: [{ id: "c3", name: "default", isDefault: true, imageCount: 340 }],
  },
  {
    id: 3,
    name: "winter_subset",
    imageCount: 88,
    annotationFiles: [],
    collections: [{ id: "c4", name: "default", isDefault: true, imageCount: 88 }],
  },
  {
    id: 4,
    name: "legacy_dataset_2021",
    imageCount: 500,
    annotationFiles: [
      {
        id: "d1",
        name: "old_classes.json",
        classes: ["car", "truck", "bus"],
        taskType: "detection",
        modifiedAt: new Date(Date.now() - 365 * 86400000).toISOString(),
        annotationCount: 4200,
      },
    ],
    collections: [{ id: "c5", name: "default", isDefault: true, imageCount: 500 }],
  },
  {
    id: 5,
    name: "summer_orchard",
    imageCount: 980,
    annotationFiles: [
      {
        id: "e1",
        name: "labeled_v2.json",
        classes: ["apple", "leaf"],
        taskType: "detection",
        modifiedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        annotationCount: 6300,
      },
    ],
    collections: [
      { id: "c6", name: "default", isDefault: true, imageCount: 980 },
      { id: "c7", name: "morning_only", imageCount: 410 },
    ],
  },
  {
    id: 6,
    name: "night_orchard",
    imageCount: 420,
    annotationFiles: [
      {
        id: "f1",
        name: "ground_truth.json",
        classes: ["apple", "pear", "leaf", "branch"],
        taskType: "detection",
        modifiedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        annotationCount: 1890,
      },
    ],
    collections: [{ id: "c8", name: "default", isDefault: true, imageCount: 420 }],
  },
  {
    id: 7,
    name: "drone_overhead_v1",
    imageCount: 2100,
    annotationFiles: [
      {
        id: "g1",
        name: "annotations.json",
        classes: ["apple", "pear", "leaf"],
        taskType: "detection",
        modifiedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        annotationCount: 12400,
      },
    ],
    collections: [{ id: "c9", name: "default", isDefault: true, imageCount: 2100 }],
  },
];

const FAKE_GROUPS: PickerGroup[] = [
  { id: 100, name: "Validation suite", datasetIds: [2, 6] },
  { id: 101, name: "Full orchard benchmark", datasetIds: [1, 2, 5, 6, 7] },
];

const MODELS = [
  {
    id: "m1",
    name: "yolov8m_orchard_v3",
    classes: ["apple", "pear", "leaf", "branch"],
    taskType: "detection" as const,
  },
  {
    id: "m2",
    name: "yolov8s_apples_only",
    classes: ["apple"],
    taskType: "detection" as const,
  },
  {
    id: "m3",
    name: "mask_rcnn_seg_v1",
    classes: ["apple", "pear", "leaf"],
    taskType: "segmentation" as const,
  },
  { id: "none", name: "(no model picked)", classes: [], taskType: undefined },
];

export default function EvalPickerDemo() {
  const [modelId, setModelId] = useState("m1");
  const [selection, setSelection] = useState<DatasetSelection[]>([]);
  const model = MODELS.find((m) => m.id === modelId)!;

  return (
    <div className="min-h-screen bg-background p-6 md:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Brain className="h-6 w-6 text-primary" />
            Evaluation — dataset picker preview
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Demo of the new "Add datasets to evaluation" UX. Switch models to
            see compatibility badges change. All data is fake.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label className="text-xs text-muted-foreground">
              Trained model
            </Label>
            <Select value={modelId} onValueChange={setModelId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                    {m.classes.length > 0 && (
                      <span className="text-xs text-muted-foreground ml-2">
                        [{m.classes.join(", ")}]
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Datasets</CardTitle>
          </CardHeader>
          <CardContent>
            <DatasetEvalPicker
              datasets={FAKE_DATASETS}
              groups={FAKE_GROUPS}
              modelClasses={model.classes}
              modelTaskType={model.taskType}
              value={selection}
              onChange={setSelection}
            />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline">Cancel</Button>
          <Button disabled={selection.length === 0}>
            <Brain className="h-4 w-4 mr-2" />
            Start Evaluation ({selection.length})
          </Button>
        </div>

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Selection JSON (debug)</summary>
          <pre className="mt-2 p-3 bg-muted rounded-md overflow-x-auto">
            {JSON.stringify(selection, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
