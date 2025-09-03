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
import { Input } from "@/components/ui/input";
import { Settings } from "lucide-react";

interface MaskRCNNSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsUpdate: (settings: any) => void;
}

export function MaskRCNNSettingsDialog({ open, onOpenChange, onSettingsUpdate }: MaskRCNNSettingsDialogProps) {
  const [backbone, setBackbone] = useState('resnet50');
  const [fpn, setFpn] = useState('true');
  const [epochs, setEpochs] = useState('100');
  const [learningRate, setLearningRate] = useState('0.001');

  const handleSave = () => {
    const settings = {
      backbone,
      fpn: fpn === 'true',
      epochs: parseInt(epochs),
      learningRate: parseFloat(learningRate),
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
            Mask R-CNN Settings
          </DialogTitle>
          <DialogDescription>
            Configure Mask R-CNN model parameters for instance segmentation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Backbone Selection */}
          <div className="space-y-3">
            <Label>Backbone Network</Label>
            <Select value={backbone} onValueChange={setBackbone}>
              <SelectTrigger className="bg-background z-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-md z-[70]">
                <SelectItem value="resnet50">ResNet-50</SelectItem>
                <SelectItem value="resnet101">ResNet-101</SelectItem>
                <SelectItem value="resnext50">ResNeXt-50</SelectItem>
                <SelectItem value="resnext101">ResNeXt-101</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* FPN */}
          <div className="space-y-3">
            <Label>Feature Pyramid Network (FPN)</Label>
            <RadioGroup value={fpn} onValueChange={setFpn} className="space-y-2">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="fpn-true" />
                <Label htmlFor="fpn-true" className="text-sm">
                  Enable FPN - Better multi-scale detection
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="fpn-false" />
                <Label htmlFor="fpn-false" className="text-sm">
                  Disable FPN - Faster training
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Training Parameters */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="epochs">Epochs</Label>
              <Input
                id="epochs"
                type="number"
                value={epochs}
                onChange={(e) => setEpochs(e.target.value)}
                min="1"
                max="1000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="learning-rate">Learning Rate</Label>
              <Input
                id="learning-rate"
                type="number"
                step="0.0001"
                value={learningRate}
                onChange={(e) => setLearningRate(e.target.value)}
                min="0.0001"
                max="1"
              />
            </div>
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