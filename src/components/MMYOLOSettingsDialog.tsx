import React, { useEffect, useState } from 'react';
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
import { Input } from "@/components/ui/input";
import { AlertCircle, Settings } from "lucide-react";

interface MMYOLOSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsUpdate: (settings: any) => void;
  currentSettings?: any;
  deployTarget?: 'general' | 'edge-drone';
  djiPatchName?: string | null;
  djiPatchUploading?: boolean;
  onDJIPatchUpload?: (file: File | null) => void;
}

export function MMYOLOSettingsDialog({
  open,
  onOpenChange,
  onSettingsUpdate,
  currentSettings,
  deployTarget = 'general',
  djiPatchName,
  djiPatchUploading = false,
  onDJIPatchUpload,
}: MMYOLOSettingsDialogProps) {
  const [optimizer, setOptimizer] = useState('AdamW');
  const [learningRate, setLearningRate] = useState(0.004);
  const [weightDecay, setWeightDecay] = useState(0.05);
  const [savePeriod, setSavePeriod] = useState(-1);

  useEffect(() => {
    if (!open) return;
    const s = currentSettings || {};
    if (s.optimizer) setOptimizer(String(s.optimizer));
    if (s.learningRate !== undefined) setLearningRate(Number(s.learningRate));
    if (s.weightDecay !== undefined) setWeightDecay(Number(s.weightDecay));
    if (s.savePeriod !== undefined) setSavePeriod(Number(s.savePeriod));
  }, [open, currentSettings]);

  const handleSave = () => {
    const settings = {
      ...(currentSettings || {}),
      optimizer,
      learningRate,
      weightDecay,
      savePeriod,
    };
    onSettingsUpdate(settings);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] bg-background z-[60]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            MMYOLO Advanced Settings
          </DialogTitle>
          <DialogDescription>
            Tune optimizer and checkpoint behavior. Device selection is automatic.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {deployTarget === 'edge-drone' && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
              <p className="text-xs text-amber-900 dark:text-amber-300 flex items-start gap-1.5">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                DJI AI Inside requires a private MMYOLO patch from the DJI developer portal.
              </p>
              <div className="space-y-1">
                <Label htmlFor="mmyolo-dji-patch">DJI Patch File (.patch)</Label>
                <Input
                  id="mmyolo-dji-patch"
                  type="file"
                  accept=".patch,text/plain"
                  className="bg-background"
                  disabled={djiPatchUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    onDJIPatchUpload?.(file);
                    e.currentTarget.value = '';
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {djiPatchName ? `Uploaded: ${djiPatchName}` : 'No patch uploaded yet.'}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="mmyolo-optimizer">Optimizer</Label>
            <Select value={optimizer} onValueChange={setOptimizer}>
              <SelectTrigger id="mmyolo-optimizer" className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-md z-[70]">
                <SelectItem value="AdamW">AdamW</SelectItem>
                <SelectItem value="SGD">SGD</SelectItem>
                <SelectItem value="Adam">Adam</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mmyolo-lr">Learning Rate</Label>
              <Input
                id="mmyolo-lr"
                type="number"
                min={0.000001}
                step={0.0001}
                value={learningRate}
                onChange={(e) => setLearningRate(Number(e.target.value))}
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mmyolo-wd">Weight Decay</Label>
              <Input
                id="mmyolo-wd"
                type="number"
                min={0}
                step={0.0001}
                value={weightDecay}
                onChange={(e) => setWeightDecay(Number(e.target.value))}
                className="bg-background"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mmyolo-save-period">Save Checkpoint Every N Epochs</Label>
            <Input
              id="mmyolo-save-period"
              type="number"
              min={-1}
              value={savePeriod}
              onChange={(e) => setSavePeriod(Number(e.target.value))}
              className="bg-background"
            />
            <p className="text-xs text-muted-foreground">
              Use -1 to save only best and last checkpoints.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
