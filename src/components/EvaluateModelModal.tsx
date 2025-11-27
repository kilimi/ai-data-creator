import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Database } from "lucide-react";
import { useState } from "react";

interface EvaluateModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trainingTasks: any[];
  datasets: any[];
  onEvaluate: (params: {
    taskId: number;
    datasetId: number;
    annotationFileId: string | null;
    checkpoint: 'best' | 'last';
    confThreshold: number;
    iouThreshold: number;
    evaluationName: string;
    useGrid: boolean;
    gridSize: number;
    gridOverlap: number;
  }) => Promise<void>;
}

export function EvaluateModelModal({
  open,
  onOpenChange,
  trainingTasks,
  datasets,
  onEvaluate
}: EvaluateModelModalProps) {
  const [evaluationName, setEvaluationName] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<'best' | 'last'>('best');
  const [selectedDataset, setSelectedDataset] = useState('');
  const [useGroundTruth, setUseGroundTruth] = useState(true);
  const [selectedAnnotation, setSelectedAnnotation] = useState('');
  const [confThreshold, setConfThreshold] = useState(0.25);
  const [iouThreshold, setIouThreshold] = useState(0.45);
  const [useGrid, setUseGrid] = useState(false);
  const [gridSize, setGridSize] = useState(640);
  const [gridOverlap, setGridOverlap] = useState(0.2);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedDatasetData = datasets.find(d => d.id.toString() === selectedDataset);

  const handleSubmit = async () => {
    if (!selectedModel || !selectedDataset) return;

    setIsSubmitting(true);
    try {
      await onEvaluate({
        taskId: parseInt(selectedModel),
        datasetId: parseInt(selectedDataset),
        annotationFileId: useGroundTruth ? selectedAnnotation : null,
        checkpoint: selectedCheckpoint,
        confThreshold,
        iouThreshold,
        evaluationName: evaluationName.trim(),
        useGrid,
        gridSize,
        gridOverlap
      });
      
      // Reset form
      setEvaluationName('');
      setSelectedModel('');
      setSelectedDataset('');
      setSelectedAnnotation('');
      setUseGroundTruth(true);
      setConfThreshold(0.25);
      setIouThreshold(0.45);
      setUseGrid(false);
      setGridSize(640);
      setGridOverlap(0.2);
      
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            New Model Evaluation
          </DialogTitle>
          <DialogDescription>
            Evaluate a trained model on a test dataset
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Evaluation Name */}
          <div className="space-y-2">
            <Label htmlFor="eval-name">Evaluation Name (Optional)</Label>
            <Input
              id="eval-name"
              value={evaluationName}
              onChange={(e) => setEvaluationName(e.target.value)}
              placeholder="e.g., Test Set Evaluation"
            />
          </div>

          {/* Model Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Model Selection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="model-select">Trained Model</Label>
                <Select value={selectedModel} onValueChange={setSelectedModel}>
                  <SelectTrigger id="model-select">
                    <SelectValue placeholder="Select a trained model" />
                  </SelectTrigger>
                  <SelectContent>
                    {trainingTasks.filter(t => t.status === 'completed' && t.task_type === 'yolo_training').map(task => (
                      <SelectItem key={task.id} value={task.id.toString()}>
                        {task.name} (ID: {task.id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="checkpoint-select">Checkpoint</Label>
                <Select value={selectedCheckpoint} onValueChange={(v) => setSelectedCheckpoint(v as 'best' | 'last')}>
                  <SelectTrigger id="checkpoint-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="best">Best Model</SelectItem>
                    <SelectItem value="last">Last Epoch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Dataset Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dataset Selection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dataset-select">Test Dataset</Label>
                <Select value={selectedDataset} onValueChange={setSelectedDataset}>
                  <SelectTrigger id="dataset-select">
                    <SelectValue placeholder="Select a dataset" />
                  </SelectTrigger>
                  <SelectContent>
                    {datasets.map(dataset => (
                      <SelectItem key={dataset.id} value={dataset.id.toString()}>
                        {dataset.name} ({dataset.image_count} images)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedDatasetData && (
                  <p className="text-xs text-muted-foreground">
                    Annotation files: {selectedDatasetData.annotation_files?.length || 0}
                  </p>
                )}
              </div>

              {selectedDatasetData?.annotation_files && selectedDatasetData.annotation_files.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="use-ground-truth"
                      checked={useGroundTruth}
                      onChange={(e) => setUseGroundTruth(e.target.checked)}
                      className="rounded"
                    />
                    <Label htmlFor="use-ground-truth">Use Ground Truth</Label>
                  </div>
                  
                  {useGroundTruth && (
                    <Select value={selectedAnnotation} onValueChange={setSelectedAnnotation}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select annotation file" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedDatasetData.annotation_files.map((file: any) => (
                          <SelectItem key={file.id} value={String(file.id)}>
                            {file.file_name || file.name} ({file.annotation_count || 0} annotations)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Thresholds */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detection Thresholds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="conf-threshold">Confidence Threshold: {confThreshold.toFixed(2)}</Label>
                <Input
                  id="conf-threshold"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={confThreshold}
                  onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="iou-threshold">IoU Threshold: {iouThreshold.toFixed(2)}</Label>
                <Input
                  id="iou-threshold"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={iouThreshold}
                  onChange={(e) => setIouThreshold(parseFloat(e.target.value))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Grid Inference */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Grid Inference</CardTitle>
              <CardDescription>
                Split images into overlapping tiles for better detection of small objects
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="use-grid"
                  checked={useGrid}
                  onChange={(e) => setUseGrid(e.target.checked)}
                  className="rounded"
                />
                <Label htmlFor="use-grid">Enable Grid Inference</Label>
              </div>

              {useGrid && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="grid-size">Grid Tile Size: {gridSize}px</Label>
                    <Input
                      id="grid-size"
                      type="range"
                      min="320"
                      max="1280"
                      step="32"
                      value={gridSize}
                      onChange={(e) => setGridSize(parseInt(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Each image will be divided into {gridSize}×{gridSize} tiles
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="grid-overlap">Grid Overlap: {(gridOverlap * 100).toFixed(0)}%</Label>
                    <Input
                      id="grid-overlap"
                      type="range"
                      min="0"
                      max="0.5"
                      step="0.05"
                      value={gridOverlap}
                      onChange={(e) => setGridOverlap(parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Overlap helps detect objects at tile boundaries
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit}
              disabled={isSubmitting || !selectedModel || !selectedDataset}
            >
              {isSubmitting ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Starting...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Start Evaluation
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
