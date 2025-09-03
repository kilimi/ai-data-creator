import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Settings } from "lucide-react";

interface YoloSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsUpdate: (settings: any) => void;
}

export function YoloSettingsDialog({ open, onOpenChange, onSettingsUpdate }: YoloSettingsDialogProps) {
  const [version, setVersion] = useState('yolo8');
  const [size, setSize] = useState('n');
  const [task, setTask] = useState('detection');

  const handleSave = () => {
    const settings = {
      version,
      size,
      task,
    };
    onSettingsUpdate(settings);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] bg-background z-[60]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            YOLO Settings
          </DialogTitle>
          <DialogDescription>
            Configure YOLO model parameters for training.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Version Selection */}
          <div className="space-y-3">
            <Label>YOLO Version</Label>
            <Select value={version} onValueChange={setVersion}>
              <SelectTrigger className="bg-background z-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-md z-[70]">
                <SelectItem value="yolo5">YOLOv5</SelectItem>
                <SelectItem value="yolo8">YOLOv8</SelectItem>
                <SelectItem value="yolo9">YOLOv9</SelectItem>
                <SelectItem value="yolo10">YOLOv10</SelectItem>
                <SelectItem value="yolo11">YOLOv11</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Model Size */}
          <div className="space-y-3">
            <Label>Model Size</Label>
            <RadioGroup value={size} onValueChange={setSize} className="flex flex-wrap gap-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="n" id="size-n" />
                <Label htmlFor="size-n" className="text-sm">Nano (n) - Fastest</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="s" id="size-s" />
                <Label htmlFor="size-s" className="text-sm">Small (s) - Balanced</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="m" id="size-m" />
                <Label htmlFor="size-m" className="text-sm">Medium (m)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="l" id="size-l" />
                <Label htmlFor="size-l" className="text-sm">Large (l) - Most Accurate</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="x" id="size-x" />
                <Label htmlFor="size-x" className="text-sm">Extra Large (x)</Label>
              </div>
            </RadioGroup>
          </div>

          {/* Task Type */}
          <div className="space-y-3">
            <Label>Task Type</Label>
            <RadioGroup value={task} onValueChange={setTask} className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="detection" id="task-detection" />
                <Label htmlFor="task-detection" className="text-sm">
                  Object Detection - Detect and classify objects with bounding boxes
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="segmentation" id="task-segmentation" />
                <Label htmlFor="task-segmentation" className="text-sm">
                  Instance Segmentation - Detect objects and create pixel-level masks
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="classification" id="task-classification" />
                <Label htmlFor="task-classification" className="text-sm">
                  Image Classification - Classify entire images
                </Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}