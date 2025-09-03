import React, { useState, useEffect } from 'react';
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
import { Brain, Database, Settings, Trash2, Plus, Image, FileText } from "lucide-react";
import { Dataset } from "@/types";
import { YoloSettingsDialog } from "./YoloSettingsDialog";
import { MaskRCNNSettingsDialog } from "./MaskRCNNSettingsDialog";
import { RFDETRSettingsDialog } from "./RFDETRSettingsDialog";

interface TrainModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasets: Dataset[];
  projectId: string;
}

interface DatasetSelection {
  id: string;
  dataset: Dataset;
  imageCollection: string | null;
  annotation: string | null;
}

interface ModelConfig {
  type: 'yolo' | 'mask-rcnn' | 'rf-detr';
  settings: any;
}

export function TrainModelModal({ open, onOpenChange, datasets, projectId }: TrainModelModalProps) {
  const [selectedDatasets, setSelectedDatasets] = useState<DatasetSelection[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelConfig['type'] | null>(null);
  const [modelSettings, setModelSettings] = useState<any>({});
  const [showYoloSettings, setShowYoloSettings] = useState(false);
  const [showMaskRCNNSettings, setShowMaskRCNNSettings] = useState(false);
  const [showRFDETRSettings, setShowRFDETRSettings] = useState(false);
  const [isTraining, setIsTraining] = useState(false);

  // Mock data for image collections and annotations
  const [imageCollections] = useState([
    'Collection 1',
    'Collection 2',
    'All Images'
  ]);

  const [annotations] = useState([
    'annotations_v1.json',
    'annotations_v2.json',
    'latest_annotations.json'
  ]);

  const addDatasetSelection = () => {
    if (datasets.length === 0) return;
    
    const newSelection: DatasetSelection = {
      id: `${Date.now()}-${Math.random()}`,
      dataset: datasets[0],
      imageCollection: null,
      annotation: null,
    };
    
    setSelectedDatasets([...selectedDatasets, newSelection]);
  };

  const removeDatasetSelection = (id: string) => {
    setSelectedDatasets(selectedDatasets.filter(sel => sel.id !== id));
  };

  const updateDatasetSelection = (id: string, field: keyof Omit<DatasetSelection, 'id'>, value: any) => {
    setSelectedDatasets(selectedDatasets.map(sel => 
      sel.id === id ? { ...sel, [field]: value } : sel
    ));
  };

  const handleModelSettingsUpdate = (settings: any) => {
    setModelSettings(settings);
  };

  const canTrain = () => {
    return selectedDatasets.length > 0 && 
           selectedDatasets.every(sel => sel.imageCollection && sel.annotation) &&
           selectedModel;
  };

  const handleTrain = async () => {
    if (!canTrain()) return;
    
    setIsTraining(true);
    
    // TODO: Implement actual training logic
    console.log('Training with:', {
      datasets: selectedDatasets,
      model: selectedModel,
      settings: modelSettings,
      projectId
    });
    
    // Simulate training process
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    setIsTraining(false);
    onOpenChange(false);
    
    // Reset form
    setSelectedDatasets([]);
    setSelectedModel(null);
    setModelSettings({});
  };

  const resetForm = () => {
    setSelectedDatasets([]);
    setSelectedModel(null);
    setModelSettings({});
  };

  useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto bg-background z-50">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              Train Model
            </DialogTitle>
            <DialogDescription>
              Configure datasets and model settings to train a new AI model for your project.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Dataset Selection */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">Dataset Configuration</Label>
                <Button 
                  onClick={addDatasetSelection}
                  size="sm"
                  variant="outline"
                  disabled={datasets.length === 0}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Dataset
                </Button>
              </div>
              
              {selectedDatasets.length === 0 ? (
                <Card className="p-6 text-center border-dashed">
                  <Database className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-muted-foreground">No datasets selected</p>
                  <p className="text-sm text-muted-foreground">Add datasets to begin training</p>
                </Card>
              ) : (
                <div className="space-y-3">
                  {selectedDatasets.map((selection, index) => (
                    <Card key={selection.id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Database className="h-4 w-4" />
                            Dataset {index + 1}
                          </CardTitle>
                          <Button
                            onClick={() => removeDatasetSelection(selection.id)}
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label className="text-xs">Dataset</Label>
                            <Select 
                              value={selection.dataset.id.toString()} 
                              onValueChange={(value) => {
                                const dataset = datasets.find(d => d.id.toString() === value);
                                if (dataset) {
                                  updateDatasetSelection(selection.id, 'dataset', dataset);
                                }
                              }}
                            >
                              <SelectTrigger className="bg-background z-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-background border shadow-md z-50">
                                {datasets.map(dataset => (
                                  <SelectItem key={dataset.id} value={dataset.id.toString()}>
                                    {dataset.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="space-y-2">
                            <Label className="text-xs flex items-center gap-1">
                              <Image className="h-3 w-3" />
                              Image Collection
                            </Label>
                            <Select 
                              value={selection.imageCollection || ""} 
                              onValueChange={(value) => updateDatasetSelection(selection.id, 'imageCollection', value)}
                            >
                              <SelectTrigger className="bg-background z-40">
                                <SelectValue placeholder="Select collection" />
                              </SelectTrigger>
                              <SelectContent className="bg-background border shadow-md z-50">
                                {imageCollections.map(collection => (
                                  <SelectItem key={collection} value={collection}>
                                    {collection}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="space-y-2">
                            <Label className="text-xs flex items-center gap-1">
                              <FileText className="h-3 w-3" />
                              Annotation
                            </Label>
                            <Select 
                              value={selection.annotation || ""} 
                              onValueChange={(value) => updateDatasetSelection(selection.id, 'annotation', value)}
                            >
                              <SelectTrigger className="bg-background z-40">
                                <SelectValue placeholder="Select annotation" />
                              </SelectTrigger>
                              <SelectContent className="bg-background border shadow-md z-50">
                                {annotations.map(annotation => (
                                  <SelectItem key={annotation} value={annotation}>
                                    {annotation}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Model Selection */}
            <div className="space-y-4">
              <Label className="text-base font-medium">Model Selection</Label>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* YOLO */}
                <Card className={`cursor-pointer transition-all ${selectedModel === 'yolo' ? 'ring-2 ring-primary' : ''}`}>
                  <CardContent className="p-4" onClick={() => setSelectedModel('yolo')}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">YOLO</h4>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowYoloSettings(true);
                        }}
                      >
                        <Settings className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      You Only Look Once - Fast object detection
                    </p>
                    {selectedModel === 'yolo' && (
                      <Badge variant="default" className="mt-2 text-xs">
                        Selected
                      </Badge>
                    )}
                  </CardContent>
                </Card>

                {/* Mask R-CNN */}
                <Card className={`cursor-pointer transition-all ${selectedModel === 'mask-rcnn' ? 'ring-2 ring-primary' : ''}`}>
                  <CardContent className="p-4" onClick={() => setSelectedModel('mask-rcnn')}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">Mask R-CNN</h4>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowMaskRCNNSettings(true);
                        }}
                      >
                        <Settings className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Instance segmentation and object detection
                    </p>
                    {selectedModel === 'mask-rcnn' && (
                      <Badge variant="default" className="mt-2 text-xs">
                        Selected
                      </Badge>
                    )}
                  </CardContent>
                </Card>

                {/* RF-DETR */}
                <Card className={`cursor-pointer transition-all ${selectedModel === 'rf-detr' ? 'ring-2 ring-primary' : ''}`}>
                  <CardContent className="p-4" onClick={() => setSelectedModel('rf-detr')}>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-medium">RF-DETR</h4>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowRFDETRSettings(true);
                        }}
                      >
                        <Settings className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Real-time detection transformer
                    </p>
                    {selectedModel === 'rf-detr' && (
                      <Badge variant="default" className="mt-2 text-xs">
                        Selected
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={isTraining}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleTrain}
              disabled={!canTrain() || isTraining}
            >
              <Brain className="h-4 w-4 mr-2" />
              {isTraining ? 'Training...' : 'Train Model'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Dialogs */}
      <YoloSettingsDialog
        open={showYoloSettings}
        onOpenChange={setShowYoloSettings}
        onSettingsUpdate={handleModelSettingsUpdate}
      />
      
      <MaskRCNNSettingsDialog
        open={showMaskRCNNSettings}
        onOpenChange={setShowMaskRCNNSettings}
        onSettingsUpdate={handleModelSettingsUpdate}
      />
      
      <RFDETRSettingsDialog
        open={showRFDETRSettings}
        onOpenChange={setShowRFDETRSettings}
        onSettingsUpdate={handleModelSettingsUpdate}
      />
    </>
  );
}