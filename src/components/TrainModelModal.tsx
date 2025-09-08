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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Brain, Database, Settings, Trash2, Plus, Image, FileText, Wand2, Check, ChevronDown, ChevronRight, Users, Info } from "lucide-react";
import { Dataset, DatasetGroup } from "@/types";
import { YoloSettingsDialog } from "./YoloSettingsDialog";
import { MaskRCNNSettingsDialog } from "./MaskRCNNSettingsDialog";
import { RFDETRSettingsDialog } from "./RFDETRSettingsDialog";
import { useApi } from '@/hooks/use-api';

interface TrainModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasets?: Dataset[];
  datasetGroups?: DatasetGroup[];
  projectId: string;
}

interface DatasetSelection {
  id: string;
  dataset: Dataset;
  imageCollection: string;
  // annotation stores the annotation file id (string) when selected
  annotation: string;
  imageCollections: string[];
  annotations: Array<{ id: string; name: string; type?: string }>;
  loadingCollections: boolean;
  loadingAnnotations: boolean;
  fromGroup?: boolean;
  groupName?: string;
  // percentage split for train/val/test (sum to 100)
  split?: {
    train: number;
    val: number;
    test: number;
  };
}

interface ModelConfig {
  type: 'yolo' | 'mask-rcnn' | 'rf-detr';
  settings: any;
}

export function TrainModelModal({ open, onOpenChange, datasets = [], datasetGroups = [], projectId }: TrainModelModalProps) {
  const { api } = useApi();
  const [selectedDatasets, setSelectedDatasets] = useState<DatasetSelection[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelConfig['type'] | null>(null);
  const [modelSettings, setModelSettings] = useState<any>({});
  const [showYoloSettings, setShowYoloSettings] = useState(false);
  const [showMaskRCNNSettings, setShowMaskRCNNSettings] = useState(false);
  const [showRFDETRSettings, setShowRFDETRSettings] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [showClassDialog, setShowClassDialog] = useState(false);
  const [classStats, setClassStats] = useState<any | null>(null);

  // Weights & Biases settings
  const [saveToWandb, setSaveToWandb] = useState(false);
  const [showWandbSettings, setShowWandbSettings] = useState(false);
  const [wandbSettings, setWandbSettings] = useState({
    apiKey: '',
    project: '',
    entity: ''
  });

  // Fetch image collections for a specific dataset selection
  const fetchDataForSelection = async (selectionId: string, datasetId: number) => {
    if (!api) return;
    
    // Update loading state for this selection
    setSelectedDatasets(prev => prev.map(sel => 
      sel.id === selectionId 
        ? { ...sel, loadingCollections: true, loadingAnnotations: true }
        : sel
    ));
    
    try {
      // Fetch image collections
      const collectionsResponse = await api.getImageCollections(datasetId);
      const collections = collectionsResponse.success && collectionsResponse.data 
        ? collectionsResponse.data.map((col: any) => col.name)
        : [];
      
      // Fetch annotations
      const annotationsResponse = await api.getAnnotations(datasetId);
      const annotations = annotationsResponse.success && annotationsResponse.data
        ? annotationsResponse.data.map((ann: any) => ({
            id: ann.id || ann.name,
            name: ann.name,
            // fallback to several possible field names used in backend
            type: ann.type || ann.annotation_type || ann.format || ann.file_type || ann.kind || null
          }))
        : [];
  console.log(`TrainModelModal: raw annotations response for dataset ${datasetId}:`, annotationsResponse);
  console.log(`TrainModelModal: mapped annotations for dataset ${datasetId}:`, annotations);
  if (annotations.length > 0) console.log('TrainModelModal: first annotation item', JSON.stringify(annotations[0], null, 2));
      
      // Update the selection with fetched data and auto-select if only one option
      setSelectedDatasets(prev => prev.map(sel => {
        if (sel.id === selectionId) {
          const updatedSel = { 
            ...sel, 
            imageCollections: collections,
            annotations: annotations,
            loadingCollections: false,
            loadingAnnotations: false
          };
          
          // Auto-select if only one option available and current selection is invalid or null
          const isImageCollectionValid = updatedSel.imageCollection && collections.includes(updatedSel.imageCollection);
          if (collections.length === 1 && !isImageCollectionValid) {
            updatedSel.imageCollection = collections[0];
          }
          
          const isAnnotationValid = updatedSel.annotation && annotations.find(a => a.id === updatedSel.annotation);
          if (annotations.length === 1 && !isAnnotationValid) {
            updatedSel.annotation = annotations[0].id;
          }
          
          return updatedSel;
        }
        return sel;
      }));
    } catch (error) {
      console.error('Error fetching data for selection:', error);
      setSelectedDatasets(prev => prev.map(sel => 
        sel.id === selectionId 
          ? { 
              ...sel, 
              imageCollections: [],
              annotations: [],
              loadingCollections: false,
              loadingAnnotations: false
            }
          : sel
      ));
    }
  };

  const addDatasetSelection = () => {
    if (datasets.length === 0) return;
    
    const newSelection: DatasetSelection = {
      id: `${Date.now()}-${Math.random()}`,
      dataset: datasets[0],
  imageCollection: '',
  annotation: '',
      imageCollections: [],
      annotations: [],
      loadingCollections: false,
      loadingAnnotations: false,
  split: { train: 80, val: 20, test: 0 },
    };
    
    setSelectedDatasets([...selectedDatasets, newSelection]);
    
    // Fetch data for the newly selected dataset
    fetchDataForSelection(newSelection.id, datasets[0].id);
  };

  const addDatasetGroupSelection = (group: DatasetGroup) => {
    if (!group.datasets || group.datasets.length === 0) return;
    
    // Create selections for all datasets in the group
    const newSelections: DatasetSelection[] = group.datasets.map(dataset => ({
      id: `${Date.now()}-${Math.random()}-${dataset.id}`,
      dataset: dataset,
  imageCollection: '',
  annotation: '',
      imageCollections: [],
      annotations: [],
      loadingCollections: false,
      loadingAnnotations: false,
      fromGroup: true,
      groupName: group.name,
  split: { train: 80, val: 20, test: 0 },
    }));
    
    setSelectedDatasets([...selectedDatasets, ...newSelections]);
    
    // Fetch data for all newly selected datasets
    newSelections.forEach(selection => {
      fetchDataForSelection(selection.id, selection.dataset.id);
    });
  };

  const removeDatasetSelection = (id: string) => {
    setSelectedDatasets(selectedDatasets.filter(sel => sel.id !== id));
  };

  const updateDatasetSelection = (id: string, field: keyof Omit<DatasetSelection, 'id' | 'imageCollections' | 'annotations' | 'loadingCollections' | 'loadingAnnotations'>, value: any) => {
    setSelectedDatasets(selectedDatasets.map(sel => {
      if (sel.id === id) {
        const updated = { ...sel, [field]: value };
        
        // If dataset changed, fetch new collections and annotations
        if (field === 'dataset' && value) {
          fetchDataForSelection(id, value.id);
        }
        
        return updated;
      }
      return sel;
    }));
  };

  const handleModelSettingsUpdate = (settings: any) => {
    setModelSettings(settings);
  };

  const canTrain = () => {
    const basicRequirements = selectedDatasets.length > 0 && 
           selectedDatasets.every(sel => sel.imageCollection && sel.annotation) &&
           selectedModel;
    
    if (!basicRequirements) return false;
    
    // If wandb is enabled, check if settings are configured
    if (saveToWandb) {
      return wandbSettings.apiKey && wandbSettings.project;
    }
    
    return true;
  };

  const handleTrain = async () => {
    if (!canTrain()) return;
    
    setIsTraining(true);
    
    // TODO: Implement actual training logic
    console.log('Training with:', {
      datasets: selectedDatasets,
      model: selectedModel,
      settings: modelSettings,
      wandb: saveToWandb ? wandbSettings : null,
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
    setSaveToWandb(false);
    setWandbSettings({
      apiKey: '',
      project: '',
      entity: ''
    });
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
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      size="sm"
                      variant="outline"
                      disabled={datasets.length === 0 && datasetGroups.length === 0}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add
                      <ChevronDown className="h-4 w-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem 
                      onClick={addDatasetSelection}
                      disabled={datasets.length === 0}
                      className="flex items-center cursor-pointer"
                    >
                      <Database className="w-4 h-4 mr-2" />
                      Add Dataset
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger 
                        disabled={datasetGroups.length === 0}
                        className="flex items-center cursor-pointer"
                      >
                        <Users className="w-4 h-4 mr-2" />
                        Add Dataset Group
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {datasetGroups.length === 0 ? (
                          <DropdownMenuItem disabled>
                            No dataset groups available
                          </DropdownMenuItem>
                        ) : (
                          datasetGroups.map(group => (
                            <DropdownMenuItem 
                              key={group.id}
                              onClick={() => addDatasetGroupSelection(group)}
                              className="flex items-center cursor-pointer"
                            >
                              <Users className="w-4 h-4 mr-2" />
                              {group.name} ({group.datasets?.length || 0} datasets)
                            </DropdownMenuItem>
                          ))
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  </DropdownMenuContent>
                </DropdownMenu>
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
                            {selection.fromGroup ? (
                              <div className="flex items-center gap-2">
                                <span>{selection.dataset.name}</span>
                                <Badge variant="secondary" className="text-xs">
                                  <Users className="h-3 w-3 mr-1" />
                                  {selection.groupName}
                                </Badge>
                              </div>
                            ) : (
                              <span>Dataset {index + 1}</span>
                            )}
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
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">{selection.dataset.name}</span>
                            {selection.fromGroup && (
                              <Badge variant="outline" className="text-xs">
                                <Users className="h-3 w-3 mr-1" />
                                {selection.groupName}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {selection.dataset.annotation_file_count || 0} annotation files
                          </div>
                        </div>
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
                              value={selection.imageCollection} 
                              onValueChange={(value) => updateDatasetSelection(selection.id, 'imageCollection', value)}
                              disabled={selection.loadingCollections}
                            >
                              <SelectTrigger className="bg-background z-40">
                                <SelectValue placeholder={selection.loadingCollections ? "Loading..." : "Select collection"} />
                              </SelectTrigger>
                              <SelectContent className="bg-background border shadow-md z-50">
                                {selection.imageCollections.length > 0 ? (
                                  selection.imageCollections.map(collection => (
                                    <SelectItem key={collection} value={collection}>
                                      {collection}
                                    </SelectItem>
                                  ))
                                ) : (
                                  <div className="px-2 py-1 text-sm text-muted-foreground">
                                    {selection.loadingCollections ? "Loading collections..." : "No collections available"}
                                  </div>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs flex items-center gap-1">
                                <FileText className="h-3 w-3" />
                                Annotation
                                    {selection.annotation && (
                                      (() => {
                                        const sel = selection.annotations.find(a => a.id === selection.annotation);
                                        const t = sel?.type || 'unknown';
                                        const variant = t === 'classification' ? 'default' : t === 'segmentation' ? 'secondary' : 'outline';
                                        return <Badge variant={variant} className="ml-2 text-xs">{t}</Badge>;
                                      })()
                                    )}
                              </Label>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={async () => {
                                if (!selection.annotation) return;
                                try {
                  console.log('TrainModelModal: fetching class stats for', selection.dataset.id, selection.annotation);
                                  const res = await api?.getAnnotationClasses(selection.dataset.id, selection.annotation);
                  console.log('TrainModelModal: class stats response', res);
                                  if (res && res.success) {
                                    setClassStats(res.data);
                                    setShowClassDialog(true);
                                  } else {
                                    console.warn('Failed to fetch class stats', res);
                                  }
                                } catch (e) {
                                  console.error('Error fetching class stats', e);
                                }
                              }}>
                                <Info className="h-3 w-3" />
                              </Button>
                            </div>
                            <Select 
                              value={selection.annotation} 
                              onValueChange={(value) => updateDatasetSelection(selection.id, 'annotation', value)}
                              disabled={selection.loadingAnnotations}
                            >
                              <SelectTrigger className="bg-background z-40">
                                <SelectValue placeholder={selection.loadingAnnotations ? "Loading..." : "Select annotation"} />
                              </SelectTrigger>
                              <SelectContent className="bg-background border shadow-md z-50">
                                {selection.annotations.length > 0 ? (
                                  selection.annotations.map(annotation => (
                                    <SelectItem key={annotation.id} value={annotation.id}>
                                      <div className="flex items-center justify-between w-full">
                                        <div>{annotation.name}</div>
                                        <Badge variant={annotation.type === 'classification' ? 'default' : annotation.type === 'segmentation' ? 'secondary' : 'outline'} className="text-xs">
                                          {annotation.type || 'unknown'}
                                        </Badge>
                                      </div>
                                    </SelectItem>
                                  ))
                                ) : (
                                  <div className="px-2 py-1 text-sm text-muted-foreground">
                                    {selection.loadingAnnotations ? "Loading annotations..." : "No annotations available"}
                                  </div>
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {selection.annotation && (
                          <div className="mt-3">
                            <Label className="text-xs">Train / Val / Test split</Label>
                            <div className="flex items-center gap-3 mt-2">
                              <div className="w-full">
                                <div className="text-xs flex justify-between mb-1">
                                  <span>Train: {selection.split?.train ?? 80}%</span>
                                  <span>Val: {selection.split?.val ?? 20}%</span>
                                  <span>Test: {selection.split?.test ?? 0}%</span>
                                </div>
                                <div className="w-full h-4 rounded overflow-hidden bg-muted">
                                  <div style={{ width: `${selection.split?.train ?? 80}%` }} className="h-4 bg-green-500 inline-block" />
                                  <div style={{ width: `${selection.split?.val ?? 20}%` }} className="h-4 bg-yellow-400 inline-block" />
                                  <div style={{ width: `${selection.split?.test ?? 0}%` }} className="h-4 bg-blue-500 inline-block" />
                                </div>

                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-xs">Train %</Label>
                                    <input
                                      type="range"
                                      min={0}
                                      max={100}
                                      value={selection.split?.train ?? 80}
                                      onChange={(e) => {
                                        const train = Number(e.target.value);
                                        // keep val the same if possible, adjust test
                                        const val = Math.min(selection.split?.val ?? 20, Math.max(0, 100 - train));
                                        const test = Math.max(0, 100 - train - val);
                                        updateDatasetSelection(selection.id, 'split', { train, val, test });
                                      }}
                                    />
                                  </div>

                                  <div>
                                    <Label className="text-xs">Val %</Label>
                                    <input
                                      type="range"
                                      min={0}
                                      max={100}
                                      value={selection.split?.val ?? 20}
                                      onChange={(e) => {
                                        const val = Number(e.target.value);
                                        const train = Math.min(selection.split?.train ?? 80, Math.max(0, 100 - val));
                                        const test = Math.max(0, 100 - train - val);
                                        updateDatasetSelection(selection.id, 'split', { train, val, test });
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
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

            <Separator />

            {/* Weights & Biases Integration */}
            <div className="space-y-4">
              <Label className="text-base font-medium">Experiment Tracking</Label>
              
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="wandb-checkbox"
                    checked={saveToWandb}
                    onCheckedChange={(checked) => setSaveToWandb(checked as boolean)}
                  />
                  <div className="flex items-center space-x-2">
                    <Wand2 className="h-4 w-4 text-purple-600" />
                    <Label htmlFor="wandb-checkbox" className="text-sm font-medium">
                      Save to Weights & Biases
                    </Label>
                  </div>
                </div>
                
                <Button
                  size="icon"
                  variant="ghost"
                  className={`h-8 w-8 ${saveToWandb && wandbSettings.apiKey && wandbSettings.project ? 'text-green-600' : ''}`}
                  onClick={() => setShowWandbSettings(true)}
                  disabled={!saveToWandb}
                >
                  {saveToWandb && wandbSettings.apiKey && wandbSettings.project ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Settings className="h-4 w-4" />
                  )}
                </Button>
              </div>
              
              {saveToWandb && (
                <div className="text-sm text-muted-foreground">
                  <p>Training metrics and model artifacts will be logged to Weights & Biases.</p>
                  {(!wandbSettings.apiKey || !wandbSettings.project) && (
                    <p className="text-orange-600 mt-1">
                      ⚠️ {wandbSettings.apiKey ? 'Project name' : 'API key and project name'} required in settings
                    </p>
                  )}
                </div>
              )}
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
      {/* Class distribution dialog */}
      <Dialog open={showClassDialog} onOpenChange={setShowClassDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Class distribution</DialogTitle>
            <DialogDescription>
              Per-class counts for the selected annotation file
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {classStats ? (
              <div>
                <div className="text-sm mb-2">Total annotations: {classStats.totalAnnotations}</div>
                <div className="space-y-2">
                  {classStats.classes.map((c: any) => (
                    <div key={c.className} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div style={{ width: 12, height: 12, backgroundColor: c.color }} className="rounded" />
                        <div className="text-sm">{c.className}</div>
                      </div>
                      <div className="text-sm text-muted-foreground">{c.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No class statistics available</div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClassDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <WandbSettingsDialog
        open={showWandbSettings}
        onOpenChange={setShowWandbSettings}
        settings={wandbSettings}
        onSettingsUpdate={setWandbSettings}
      />
    </>
  );
}

// Weights & Biases Settings Dialog
interface WandbSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: {
    apiKey: string;
    project: string;
    entity: string;
  };
  onSettingsUpdate: (settings: { apiKey: string; project: string; entity: string }) => void;
}

function WandbSettingsDialog({ open, onOpenChange, settings, onSettingsUpdate }: WandbSettingsDialogProps) {
  const [localSettings, setLocalSettings] = useState(settings);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const handleSave = () => {
    if (!localSettings.apiKey.trim() || !localSettings.project.trim()) {
      return; // Don't save if required fields are empty
    }
    onSettingsUpdate(localSettings);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setLocalSettings(settings); // Reset to original
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-purple-600" />
            Weights & Biases Settings
          </DialogTitle>
          <DialogDescription>
            Configure your Weights & Biases credentials for experiment tracking.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="wandb-api-key">API Key <span className="text-red-500">*</span></Label>
            <Input
              id="wandb-api-key"
              type="password"
              placeholder="Enter your W&B API key"
              value={localSettings.apiKey}
              onChange={(e) => setLocalSettings(prev => ({ ...prev, apiKey: e.target.value }))}
              className={!localSettings.apiKey.trim() ? 'border-red-300' : ''}
            />
            <p className="text-xs text-muted-foreground">
              Get your API key from <a href="https://wandb.ai/settings" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">wandb.ai/settings</a>
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wandb-project">Project Name <span className="text-red-500">*</span></Label>
            <Input
              id="wandb-project"
              placeholder="my-awesome-project"
              value={localSettings.project}
              onChange={(e) => setLocalSettings(prev => ({ ...prev, project: e.target.value }))}
              className={!localSettings.project.trim() ? 'border-red-300' : ''}
            />
            <p className="text-xs text-muted-foreground">
              The name of your W&B project for this experiment
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wandb-entity">Entity (Optional)</Label>
            <Input
              id="wandb-entity"
              placeholder="your-username or team-name"
              value={localSettings.entity}
              onChange={(e) => setLocalSettings(prev => ({ ...prev, entity: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Your W&B username or team name. Leave empty to use your default entity.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave}
            disabled={!localSettings.apiKey.trim() || !localSettings.project.trim()}
          >
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}