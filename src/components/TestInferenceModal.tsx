import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Upload, Image as ImageIcon, Loader2, AlertCircle } from "lucide-react";
import { useToast } from '@/hooks/use-toast';

interface TestInferenceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onnxFilePath: string;
  taskId: number;
}

interface InferenceResult {
  predictions: Array<{
    class: string;
    confidence: number;
    bbox: [number, number, number, number];
    segmentation?: number[][];
  }>;
  image_url?: string;
  error?: string;
}

export function TestInferenceModal({
  open,
  onOpenChange,
  onnxFilePath,
  taskId,
}: TestInferenceModalProps) {
  const { toast } = useToast();
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<InferenceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid file",
          description: "Please select an image file",
          variant: "destructive",
        });
        return;
      }
      setSelectedImage(file);
      setResult(null);
      setError(null);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setImagePreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRunInference = async () => {
    if (!selectedImage) {
      toast({
        title: "No image selected",
        description: "Please select an image to test",
        variant: "destructive",
      });
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('image', selectedImage);
      formData.append('onnx_file_path', onnxFilePath);
      formData.append('task_id', taskId.toString());

      const response = await fetch('http://localhost:9999/export/test-inference', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || 'Inference failed');
      }

      if (data.success) {
        setResult(data.result);
        toast({
          title: "Inference completed",
          description: `Found ${data.result.predictions?.length || 0} predictions`,
        });
      } else {
        throw new Error(data.error || 'Inference failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to run inference';
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleClose = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setResult(null);
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-primary" />
            Test ONNX Model Inference
          </DialogTitle>
          <DialogDescription>
            Upload an image to test the exported ONNX model predictions
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Image Upload */}
          <div className="space-y-2">
            <Label htmlFor="test-image">Test Image</Label>
            <div className="flex items-center gap-4">
              <input
                ref={fileInputRef}
                id="test-image"
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isRunning}
              >
                <Upload className="h-4 w-4 mr-2" />
                Select Image
              </Button>
              {selectedImage && (
                <span className="text-sm text-muted-foreground">
                  {selectedImage.name}
                </span>
              )}
            </div>
          </div>

          {/* Image Preview */}
          {imagePreview && (
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="border rounded-lg p-4 bg-muted/50">
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="max-w-full max-h-64 mx-auto rounded"
                />
              </div>
            </div>
          )}

          {/* Run Inference Button */}
          <div className="flex justify-end">
            <Button
              onClick={handleRunInference}
              disabled={!selectedImage || isRunning}
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running Inference...
                </>
              ) : (
                <>
                  <ImageIcon className="h-4 w-4 mr-2" />
                  Run Inference
                </>
              )}
            </Button>
          </div>

          {/* Error Display */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <div className="flex items-center gap-2 text-red-400">
                <AlertCircle className="h-5 w-5" />
                <span className="font-medium">Error</span>
              </div>
              <p className="mt-2 text-sm text-red-300">{error}</p>
            </div>
          )}

          {/* Results Display */}
          {result && (
            <div className="space-y-4">
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                <h3 className="font-semibold mb-3">Inference Results</h3>
                
                {result.image_url && (
                  <div className="mb-4">
                    <Label>Annotated Image</Label>
                    <div className="mt-2 border rounded-lg p-4 bg-muted/50">
                      <img
                        src={result.image_url}
                        alt="Inference result"
                        className="max-w-full rounded"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Predictions ({result.predictions?.length || 0})</Label>
                  {result.predictions && result.predictions.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {result.predictions.map((pred, idx) => (
                        <div
                          key={idx}
                          className="bg-background rounded p-3 border"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">{pred.class}</span>
                            <span className="text-sm text-muted-foreground">
                              {(pred.confidence * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            BBox: [{pred.bbox.map(b => b.toFixed(1)).join(', ')}]
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No predictions found
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
