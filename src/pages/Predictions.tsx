import React, { useState, useEffect } from 'react';
import { Navbar } from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Brain,
  Database,
  Play,
  AlertCircle,
  CheckCircle,
  TrendingUp,
  Image as ImageIcon,
  Grid3x3,
  Loader2
} from "lucide-react";

interface Model {
  id: number;
  name: string;
  project_id: number;
  task_metadata: any;
  status: string;
  created_at: string;
  completed_at?: string;
}

interface Dataset {
  id: number;
  name: string;
  project_id: number;
  image_count: number;
  annotation_files?: Array<{
    id: string;
    file_name: string;
  }>;
}

interface Project {
  id: number;
  name: string;
}

interface EvaluationResults {
  precision: number;
  recall: number;
  f1_score: number;
  map50: number;
  map50_95: number;
  confusion_matrix: number[][];
  class_names: string[];
  predictions_count: number;
  has_ground_truth: boolean;
  inference_time_ms: number;
}

export function Predictions() {
  const { api } = useApi();
  const { toast } = useToast();
  
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<'best' | 'last'>('best');
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<string>('');
  const [selectedAnnotation, setSelectedAnnotation] = useState<string>('');
  const [useGroundTruth, setUseGroundTruth] = useState(true);
  const [confThreshold, setConfThreshold] = useState(0.25);
  const [iouThreshold, setIouThreshold] = useState(0.45);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [results, setResults] = useState<EvaluationResults | null>(null);

  // Fetch projects
  useEffect(() => {
    fetchProjects();
  }, []);

  // Fetch models when project is selected
  useEffect(() => {
    if (selectedProject) {
      fetchModels();
      fetchDatasets();
    }
  }, [selectedProject]);

  const fetchProjects = async () => {
    if (!api) return;
    try {
      const response = await api.getProjects();
      setProjects(response.data || []);
    } catch (error) {
      console.error('Error fetching projects:', error);
    }
  };

  const fetchModels = async () => {
    if (!api || !selectedProject) return;
    try {
      const response = await fetch(`http://localhost:9999/tasks/?project_id=${selectedProject}&task_type=yolo_training&status=completed`);
      const data = await response.json();
      setModels(data || []);
    } catch (error) {
      console.error('Error fetching models:', error);
    }
  };

  const fetchDatasets = async () => {
    if (!api || !selectedProject) return;
    try {
      const response = await api.getDatasets(parseInt(selectedProject));
      setDatasets(response.data || []);
    } catch (error) {
      console.error('Error fetching datasets:', error);
    }
  };

  const handleEvaluate = async () => {
    if (!selectedModel || !selectedDataset) {
      toast({
        title: "Missing Selection",
        description: "Please select both a model and a dataset",
        variant: "destructive"
      });
      return;
    }

    setIsEvaluating(true);
    setResults(null);

    try {
      const response = await fetch('http://localhost:9999/predictions/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: parseInt(selectedModel),
          dataset_id: parseInt(selectedDataset),
          annotation_file_id: useGroundTruth ? selectedAnnotation : null,
          checkpoint: selectedCheckpoint,
          conf_threshold: confThreshold,
          iou_threshold: iouThreshold
        })
      });

      if (!response.ok) {
        throw new Error('Evaluation failed');
      }

      const data = await response.json();
      setResults(data);
      
      toast({
        title: "Evaluation Complete",
        description: `Processed ${data.predictions_count} predictions`,
      });
    } catch (error) {
      console.error('Error running evaluation:', error);
      toast({
        title: "Evaluation Failed",
        description: error instanceof Error ? error.message : "Failed to run evaluation",
        variant: "destructive"
      });
    } finally {
      setIsEvaluating(false);
    }
  };

  const selectedDatasetObj = datasets.find(d => d.id === parseInt(selectedDataset));
  const hasAnnotations = selectedDatasetObj?.annotation_files && selectedDatasetObj.annotation_files.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 flex items-center gap-3">
            <Brain className="w-10 h-10 text-primary" />
            Model Predictions & Evaluation
          </h1>
          <p className="text-muted-foreground">
            Run inference on your datasets and evaluate model performance with ground truth annotations
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Configuration Panel */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5" />
                  Model Selection
                </CardTitle>
                <CardDescription>
                  Select a trained model to evaluate
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Project</Label>
                  <Select value={selectedProject} onValueChange={setSelectedProject}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map(project => (
                        <SelectItem key={project.id} value={project.id.toString()}>
                          {project.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedProject && (
                  <>
                    <div className="space-y-2">
                      <Label>Trained Model</Label>
                      <Select value={selectedModel} onValueChange={setSelectedModel}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent>
                          {models.map(model => (
                            <SelectItem key={model.id} value={model.id.toString()}>
                              <div className="flex items-center justify-between w-full">
                                <span className="truncate">{model.name}</span>
                                <Badge variant="outline" className="ml-2">
                                  {model.task_metadata?.model_config?.model || 'YOLO'}
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Checkpoint</Label>
                      <Select value={selectedCheckpoint} onValueChange={(v: 'best' | 'last') => setSelectedCheckpoint(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="best">Best Model (best.pt)</SelectItem>
                          <SelectItem value="last">Last Epoch (last.pt)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="w-5 h-5" />
                  Dataset Selection
                </CardTitle>
                <CardDescription>
                  Choose dataset for inference
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedProject && (
                  <>
                    <div className="space-y-2">
                      <Label>Dataset</Label>
                      <Select value={selectedDataset} onValueChange={setSelectedDataset}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select dataset" />
                        </SelectTrigger>
                        <SelectContent>
                          {datasets.map(dataset => (
                            <SelectItem key={dataset.id} value={dataset.id.toString()}>
                              <div className="flex items-center justify-between w-full">
                                <span className="truncate">{dataset.name}</span>
                                <Badge variant="outline" className="ml-2">
                                  {dataset.image_count} images
                                </Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {hasAnnotations && (
                      <>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="use-gt"
                            checked={useGroundTruth}
                            onChange={(e) => setUseGroundTruth(e.target.checked)}
                            className="h-4 w-4"
                          />
                          <Label htmlFor="use-gt">Use Ground Truth for Evaluation</Label>
                        </div>

                        {useGroundTruth && (
                          <div className="space-y-2">
                            <Label>Annotation File (Ground Truth)</Label>
                            <Select value={selectedAnnotation} onValueChange={setSelectedAnnotation}>
                              <SelectTrigger>
                                <SelectValue placeholder="Select annotation file" />
                              </SelectTrigger>
                              <SelectContent>
                                {selectedDatasetObj?.annotation_files?.map(ann => (
                                  <SelectItem key={ann.id} value={ann.id}>
                                    {ann.file_name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Inference Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Confidence Threshold</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={confThreshold}
                      onChange={(e) => setConfThreshold(parseFloat(e.target.value))}
                    />
                    <span className="text-sm text-muted-foreground">{confThreshold}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>IoU Threshold</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={iouThreshold}
                      onChange={(e) => setIouThreshold(parseFloat(e.target.value))}
                    />
                    <span className="text-sm text-muted-foreground">{iouThreshold}</span>
                  </div>
                </div>

                <Button 
                  onClick={handleEvaluate} 
                  disabled={!selectedModel || !selectedDataset || isEvaluating}
                  className="w-full"
                  size="lg"
                >
                  {isEvaluating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Evaluating...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Run Evaluation
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Results Panel */}
          <div className="lg:col-span-2">
            {!results && !isEvaluating && (
              <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-16">
                  <Brain className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-xl font-semibold mb-2">Ready to Evaluate</h3>
                  <p className="text-muted-foreground">
                    Select a model and dataset, then click "Run Evaluation" to see results
                  </p>
                </CardContent>
              </Card>
            )}

            {isEvaluating && (
              <Card className="h-full flex items-center justify-center">
                <CardContent className="text-center py-16">
                  <Loader2 className="w-16 h-16 mx-auto mb-4 text-primary animate-spin" />
                  <h3 className="text-xl font-semibold mb-2">Running Evaluation</h3>
                  <p className="text-muted-foreground">
                    Processing predictions and calculating metrics...
                  </p>
                </CardContent>
              </Card>
            )}

            {results && (
              <div className="space-y-6">
                {/* Metrics Cards */}
                {results.has_ground_truth && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Precision</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold">{(results.precision * 100).toFixed(2)}%</div>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Recall</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold">{(results.recall * 100).toFixed(2)}%</div>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">F1 Score</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold text-primary">{(results.f1_score * 100).toFixed(2)}%</div>
                      </CardContent>
                    </Card>
                    
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">mAP@50</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-3xl font-bold">{(results.map50 * 100).toFixed(2)}%</div>
                      </CardContent>
                    </Card>
                  </div>
                )}

                {/* Info Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      Evaluation Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Predictions:</span>
                      <span className="font-medium">{results.predictions_count}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Inference Time:</span>
                      <span className="font-medium">{results.inference_time_ms.toFixed(2)} ms</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ground Truth:</span>
                      <Badge variant={results.has_ground_truth ? "default" : "secondary"}>
                        {results.has_ground_truth ? "Available" : "Not Available"}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>

                {/* Confusion Matrix */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Grid3x3 className="w-5 h-5" />
                      Confusion Matrix
                    </CardTitle>
                    <CardDescription>
                      Visualization of prediction accuracy per class
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {results.confusion_matrix && results.confusion_matrix.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse">
                          <thead>
                            <tr>
                              <th className="border border-gray-700 p-2 bg-gray-900"></th>
                              {results.class_names.map((name, idx) => (
                                <th key={idx} className="border border-gray-700 p-2 bg-gray-900 text-xs">
                                  {name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {results.confusion_matrix.map((row, i) => (
                              <tr key={i}>
                                <th className="border border-gray-700 p-2 bg-gray-900 text-xs">
                                  {results.class_names[i]}
                                </th>
                                {row.map((value, j) => {
                                  const maxValue = Math.max(...results.confusion_matrix.flat());
                                  const intensity = maxValue > 0 ? value / maxValue : 0;
                                  return (
                                    <td
                                      key={j}
                                      className="border border-gray-700 p-2 text-center text-sm font-medium"
                                      style={{
                                        backgroundColor: `rgba(59, 130, 246, ${intensity * 0.8})`,
                                      }}
                                    >
                                      {value}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No confusion matrix data available
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
