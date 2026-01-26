import { useState, useEffect } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Brain, Download, Info, CheckCircle2 } from "lucide-react";
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';

interface ExportModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trainingTasks: any[];
  projectId: string;
  onExportComplete?: () => void;
}

export function ExportModelModal({ 
  open, 
  onOpenChange, 
  trainingTasks,
  projectId,
  onExportComplete 
}: ExportModelModalProps) {
  const { api } = useApi();
  const { toast } = useToast();
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<'best' | 'last'>('best');
  const [exportFormat, setExportFormat] = useState<string>('onnx');
  const [exportName, setExportName] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [modelInfo, setModelInfo] = useState<any>(null);
  // ONNX export parameters
  const [half, setHalf] = useState(false);
  const [imgsz, setImgsz] = useState<number>(640);
  const [simplify, setSimplify] = useState(false);
  const [opset, setOpset] = useState<number | ''>('');
  const [dynamic, setDynamic] = useState(false);
  const [workspace, setWorkspace] = useState<number | ''>('');

  // Filter to only completed YOLO training tasks
  const availableModels = trainingTasks.filter(
    task => task.task_type === 'yolo_training' && task.status === 'completed'
  );

  // Update model info when model is selected
  useEffect(() => {
    if (!selectedModel) {
      setModelInfo(null);
      setExportName('');
      return;
    }

    const task = availableModels.find(t => t.id.toString() === selectedModel);
    if (task) {
      setModelInfo(task);
      // Generate default export name
      const checkpoint = selectedCheckpoint === 'best' ? 'best' : 'last';
      const precision = half ? 'FP16' : 'FP32';
      setExportName(`${task.name} - ${checkpoint} to ${exportFormat.toUpperCase()} (${precision})`);
    }
  }, [selectedModel, selectedCheckpoint, exportFormat, half, availableModels]);

  const handleExport = async () => {
    if (!selectedModel || !api) {
      toast({
        title: "Error",
        description: "Please select a model to convert",
        variant: "destructive",
      });
      return;
    }

    setIsExporting(true);
    try {
      const response = await fetch(`http://localhost:9999/export/yolo/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task_id: parseInt(selectedModel),
          checkpoint: selectedCheckpoint,
          export_format: exportFormat,
          task_name: exportName || undefined,
          half: half,
          imgsz: imgsz,
          simplify: simplify,
          opset: opset || undefined,
          dynamic: dynamic,
          workspace: workspace || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || 'Failed to start export');
      }

      if (result.success) {
        toast({
          title: "Export Started",
          description: `Export task "${result.data.name}" has been created and is running in the background.`,
        });
        
        onExportComplete?.();
        onOpenChange(false);
        
        // Reset form
        setSelectedModel('');
        setSelectedCheckpoint('best');
        setExportFormat('onnx');
        setExportName('');
        setModelInfo(null);
        setHalf(false);
        setImgsz(640);
        setSimplify(false);
        setOpset('');
        setDynamic(false);
        setWorkspace('');
      } else {
        throw new Error(result.error || 'Failed to start export');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to start export",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const getModelFamily = (modelName: string) => {
    if (!modelName) return '-';
    if (modelName.includes('yolo') || modelName.includes('YOLO')) return 'YOLO';
    return modelName;
  };

  const getModelSize = (modelName: string) => {
    if (!modelName) return '-';
    const sizes = ['n', 's', 'm', 'l', 'x'];
    for (const size of sizes) {
      if (modelName.endsWith(size) || modelName.includes(`${size}.pt`)) {
        return size.toUpperCase();
      }
    }
    return '-';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Convert Model
          </DialogTitle>
          <DialogDescription>
            Convert a trained YOLO model to different formats (ONNX, etc.) for deployment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
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
                    {availableModels.length === 0 ? (
                      <SelectItem value="no-models" disabled>
                        No completed YOLO models available
                      </SelectItem>
                    ) : (
                      availableModels.map(task => (
                        <SelectItem key={task.id} value={task.id.toString()}>
                          {task.name} (ID: {task.id})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {availableModels.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    You need to train and complete at least one YOLO model before you can export it.
                  </p>
                )}
              </div>

              {selectedModel && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="checkpoint-select">Checkpoint</Label>
                    <Select 
                      value={selectedCheckpoint} 
                      onValueChange={(v) => setSelectedCheckpoint(v as 'best' | 'last')}
                    >
                      <SelectTrigger id="checkpoint-select">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="best">Best Model</SelectItem>
                        <SelectItem value="last">Last Epoch</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Model Information */}
                  {modelInfo && (
                    <div className="mt-4 p-4 bg-muted/50 rounded-lg space-y-3">
                      <div className="flex items-center gap-2 mb-3">
                        <Info className="h-4 w-4 text-primary" />
                        <h4 className="font-medium">Model Information</h4>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Model Family:</span>
                          <div className="font-medium">{getModelFamily(modelInfo.task_metadata?.model_type || modelInfo.name)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Model Size:</span>
                          <div className="font-medium">{getModelSize(modelInfo.task_metadata?.model_type || modelInfo.name)}</div>
                        </div>
                        {modelInfo.task_metadata?.class_count && (
                          <div>
                            <span className="text-muted-foreground">Classes:</span>
                            <div className="font-medium">{modelInfo.task_metadata.class_count}</div>
                          </div>
                        )}
                        {modelInfo.task_metadata?.epochs && (
                          <div>
                            <span className="text-muted-foreground">Epochs:</span>
                            <div className="font-medium">{modelInfo.task_metadata.epochs}</div>
                          </div>
                        )}
                      </div>

                      {modelInfo.task_metadata?.class_names && (
                        <div className="mt-3">
                          <span className="text-muted-foreground text-sm">Class Names:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {modelInfo.task_metadata.class_names.slice(0, 10).map((name: string, idx: number) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {name}
                              </Badge>
                            ))}
                            {modelInfo.task_metadata.class_names.length > 10 && (
                              <Badge variant="secondary" className="text-xs">
                                +{modelInfo.task_metadata.class_names.length - 10} more
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Export Format Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Target Format</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="format-select">Format</Label>
                <Select value={exportFormat} onValueChange={setExportFormat}>
                  <SelectTrigger id="format-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="onnx">ONNX</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  ONNX (Open Neural Network Exchange) format for cross-platform deployment.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ONNX Export Parameters */}
          {exportFormat === 'onnx' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">ONNX Export Parameters</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="half"
                      checked={half}
                      onChange={(e) => setHalf(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="half" className="flex-1 cursor-pointer">
                      <div className="font-medium">FP16 Quantization (Half Precision)</div>
                      <div className="text-sm text-muted-foreground">
                        Export model with FP16 precision to reduce file size and improve inference speed. May slightly reduce accuracy.
                      </div>
                    </Label>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor="imgsz">Image Size</Label>
                    <input
                      id="imgsz"
                      type="number"
                      min="128"
                      max="2048"
                      step="32"
                      value={imgsz}
                      onChange={(e) => setImgsz(parseInt(e.target.value) || 640)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="text-sm text-muted-foreground">
                      Input image size (height/width). Common values: 640, 1280. Default: 640.
                    </p>
                  </div>

                  <Separator />

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="simplify"
                      checked={simplify}
                      onChange={(e) => setSimplify(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="simplify" className="flex-1 cursor-pointer">
                      <div className="font-medium">Simplify Model</div>
                      <div className="text-sm text-muted-foreground">
                        Simplify ONNX model by removing redundant operators. May improve compatibility.
                      </div>
                    </Label>
                  </div>

                  <Separator />

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="dynamic"
                      checked={dynamic}
                      onChange={(e) => setDynamic(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="dynamic" className="flex-1 cursor-pointer">
                      <div className="font-medium">Dynamic Axes</div>
                      <div className="text-sm text-muted-foreground">
                        Allow dynamic input shapes. Useful for variable-size inputs but may reduce optimization.
                      </div>
                    </Label>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor="opset">ONNX Opset Version (Optional)</Label>
                    <input
                      id="opset"
                      type="number"
                      min="7"
                      max="17"
                      value={opset}
                      onChange={(e) => setOpset(e.target.value ? parseInt(e.target.value) : '')}
                      placeholder="Auto (default)"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="text-sm text-muted-foreground">
                      ONNX opset version (7-17). Leave empty for default. Higher versions support more operators.
                    </p>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label htmlFor="workspace">Workspace Size (MB, Optional)</Label>
                    <input
                      id="workspace"
                      type="number"
                      min="1"
                      max="4096"
                      value={workspace}
                      onChange={(e) => setWorkspace(e.target.value ? parseInt(e.target.value) : '')}
                      placeholder="Auto (default)"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="text-sm text-muted-foreground">
                      Workspace size in MB for TensorRT optimization. Leave empty for default.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Export Name */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conversion Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="export-name">Conversion Task Name (Optional)</Label>
                <input
                  id="export-name"
                  type="text"
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                  placeholder="Auto-generated if left empty"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button 
            onClick={handleExport} 
            disabled={!selectedModel || isExporting || availableModels.length === 0}
          >
            {isExporting ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Converting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-2" />
                Start Conversion
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
