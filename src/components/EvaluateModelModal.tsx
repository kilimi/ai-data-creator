import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Brain, Database, ChevronDown, ChevronUp, X, ImageIcon, FileText, CheckCircle2, Circle, Plus, Trash2, Users } from "lucide-react";
import { useState, useEffect } from "react";
import { useApi } from "@/hooks/use-api";
import { Dataset, DatasetGroup, ImageCollection } from "@/types";

interface AnnotationClass {
  className: string;
  count: number;
  color: string;
}

interface DatasetEvalConfig {
  datasetId: number;
  datasetName: string;
  annotationFileId: string | null;
  annotationFileName: string | null;
  collectionId: string | null;
}

interface EvaluateModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trainingTasks: any[];
  /** When true, datasets / models are still loading after the dialog opened */
  resourcesLoading?: boolean;
  projectId: string;
  datasets?: Dataset[];
  datasetGroups?: DatasetGroup[];
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
    ignoredClasses: string[];
    collectionId: string | null;
  }) => Promise<void>;
  onEvaluateMultiple?: (params: {
    taskId: number;
    datasets: DatasetEvalConfig[];
    checkpoint: 'best' | 'last';
    confThreshold: number;
    iouThreshold: number;
    evaluationName: string;
    useGrid: boolean;
    gridSize: number;
    gridOverlap: number;
    ignoredClasses: string[];
  }) => Promise<void>;
}

export function EvaluateModelModal({
  open,
  onOpenChange,
  trainingTasks,
  resourcesLoading = false,
  projectId,
  datasets = [],
  datasetGroups = [],
  onEvaluate,
  onEvaluateMultiple
}: EvaluateModelModalProps) {
  const { api } = useApi();
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
  const [loadingDatasets, setLoadingDatasets] = useState(false);
  
  // Multi-dataset selection state
  const [selectedDatasets, setSelectedDatasets] = useState<DatasetEvalConfig[]>([]);
  
  // Track which datasets came from groups
  const [datasetGroupInfo, setDatasetGroupInfo] = useState<Record<number, { groupName: string; groupId: number }>>({});
  
  // Ignored classes state
  const [annotationClasses, setAnnotationClasses] = useState<AnnotationClass[]>([]);
  const [modelClasses, setModelClasses] = useState<string[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(false);
  const [loadingModelClasses, setLoadingModelClasses] = useState(false);
  const [ignoredClasses, setIgnoredClasses] = useState<string[]>([]);
  const [showIgnoredClasses, setShowIgnoredClasses] = useState(false);

  // Local enriched datasets with annotation files
  const [enrichedDatasets, setEnrichedDatasets] = useState<Map<number, Dataset>>(new Map());
  const [datasetCollections, setDatasetCollections] = useState<Map<number, ImageCollection[]>>(new Map());
  const [collectionAnnotationCounts, setCollectionAnnotationCounts] = useState<Map<number, Record<string, number>>>(new Map());

  const fetchCollectionCountsForSelection = async (datasetId: number, annotationFileId: string | null) => {
    if (!annotationFileId) {
      setCollectionAnnotationCounts(prev => {
        const next = new Map(prev);
        next.set(datasetId, {});
        return next;
      });
      return;
    }
    try {
      const response = await api.getAnnotationCollectionCounts(datasetId, annotationFileId);
      if (response.success && response.data) {
        const countsByCollection = (response.data || []).reduce((acc: Record<string, number>, row: any) => {
          acc[String(row.collection_id)] = Number(row.annotation_count || 0);
          return acc;
        }, {});
        setCollectionAnnotationCounts(prev => {
          const next = new Map(prev);
          next.set(datasetId, countsByCollection);
          return next;
        });
      }
    } catch (error) {
      console.error('Error fetching annotation counts per collection:', error);
    }
  };

  // Add dataset to evaluation
  const addDatasetSelection = async (dataset: Dataset) => {
    // Check if already added
    if (selectedDatasets.some(d => d.datasetId === dataset.id)) {
      return;
    }
    
    // Fetch annotation files for this dataset (lightweight - only ID and name)
    let annotationFiles: any[] = [];
    let imageCollections: ImageCollection[] = [];
    try {
      const response = await fetch(`http://localhost:9999/datasets/${dataset.id}/annotation-files/list`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          annotationFiles = result.data;
        }
      }
      const collectionsResponse = await api.getImageCollections(dataset.id);
      if (collectionsResponse.success && collectionsResponse.data) {
        imageCollections = collectionsResponse.data;
      }
    } catch (error) {
      console.error('Error fetching annotation files:', error);
    }
    
    // Store enriched dataset with annotation files
    const datasetWithAnnotations = {
      ...dataset,
      annotation_files: annotationFiles
    };
    setEnrichedDatasets(prev => new Map(prev).set(dataset.id, datasetWithAnnotations));
    setDatasetCollections(prev => new Map(prev).set(dataset.id, imageCollections));

    const preferredCollection = imageCollections.find(c => (c as any).is_default) || imageCollections[0] || null;
    
    const config: DatasetEvalConfig = {
      datasetId: dataset.id,
      datasetName: dataset.name,
      annotationFileId: annotationFiles?.[0]?.id ? String(annotationFiles[0].id) : null,
      annotationFileName: annotationFiles?.[0]?.file_name || annotationFiles?.[0]?.name || null,
      collectionId: preferredCollection ? String(preferredCollection.id) : null,
    };
    
    setSelectedDatasets(prev => [...prev, config]);
    void fetchCollectionCountsForSelection(dataset.id, config.annotationFileId);
  };

  // Add all datasets from a group (fetch annotation file lists if not in lightweight group payload)
  const addDatasetGroupSelection = async (group: DatasetGroup) => {
    if (!group.datasets || group.datasets.length === 0) return;

    const newConfigs: DatasetEvalConfig[] = [];
    const groupInfoMap: Record<number, { groupName: string; groupId: number }> = {};
    const mergedEnriched = new Map<number, Dataset & { annotation_files?: any[] }>();

    for (const dataset of group.datasets) {
      if (selectedDatasets.some((d) => d.datasetId === dataset.id)) continue;

      let annFiles = dataset.annotation_files;
      let imageCollections: ImageCollection[] = [];
      if (!annFiles || annFiles.length === 0) {
        try {
          const response = await fetch(
            `http://localhost:9999/datasets/${dataset.id}/annotation-files/list`
          );
          if (response.ok) {
            const result = await response.json();
            if (result.success && result.data) annFiles = result.data;
          }
        } catch (e) {
          console.error("Error fetching annotation files for group dataset:", e);
        }
      }
      try {
        const collectionsResponse = await api.getImageCollections(dataset.id);
        if (collectionsResponse.success && collectionsResponse.data) {
          imageCollections = collectionsResponse.data;
        }
      } catch (e) {
        console.error("Error fetching image collections for group dataset:", e);
      }

      const dsWith = { ...dataset, annotation_files: annFiles || [] };
      mergedEnriched.set(dataset.id, dsWith);
      setDatasetCollections(prev => new Map(prev).set(dataset.id, imageCollections));
      const preferredCollection = imageCollections.find(c => (c as any).is_default) || imageCollections[0] || null;

      newConfigs.push({
        datasetId: dataset.id,
        datasetName: dataset.name,
        annotationFileId: annFiles?.[0]?.id ? String(annFiles[0].id) : null,
        annotationFileName: annFiles?.[0]?.file_name || annFiles?.[0]?.name || null,
        collectionId: preferredCollection ? String(preferredCollection.id) : null,
      });
      void fetchCollectionCountsForSelection(dataset.id, annFiles?.[0]?.id ? String(annFiles[0].id) : null);
      groupInfoMap[dataset.id] = { groupName: group.name, groupId: group.id };
    }

    setEnrichedDatasets((prev) => {
      const next = new Map(prev);
      mergedEnriched.forEach((v, k) => next.set(k, v));
      return next;
    });
    setSelectedDatasets((prev) => [...prev, ...newConfigs]);
    setDatasetGroupInfo((prev) => ({ ...prev, ...groupInfoMap }));
  };

  // Remove dataset from evaluation
  const removeDatasetSelection = (datasetId: number) => {
    setSelectedDatasets(prev => prev.filter(d => d.datasetId !== datasetId));
    setDatasetGroupInfo(prev => {
      const newInfo = { ...prev };
      delete newInfo[datasetId];
      return newInfo;
    });
  };

  const selectedDatasetData = datasets.find(d => d.id.toString() === selectedDataset);
  
  // Debug logging for selection changes
  useEffect(() => {
    if (selectedDataset) {
      console.log('[EvaluateModelModal] Dataset selection changed to:', selectedDataset);
      console.log('[EvaluateModelModal] Selected dataset data:', selectedDatasetData);
      console.log('[EvaluateModelModal] Annotation files count:', selectedDatasetData?.annotation_files?.length || 0);
      console.log('[EvaluateModelModal] Annotation files:', selectedDatasetData?.annotation_files);
    }
  }, [selectedDataset, selectedDatasetData]);

  // Fetch model classes when model is selected
  useEffect(() => {
    if (!selectedModel) {
      setModelClasses([]);
      setIgnoredClasses([]);
      return;
    }
    
    const fetchModelClasses = async () => {
      setLoadingModelClasses(true);
      try {
        const task = trainingTasks.find(t => t.id.toString() === selectedModel);
        if (task?.task_metadata?.class_names) {
          setModelClasses(task.task_metadata.class_names);
        }
      } catch (error) {
        console.error('[EvaluateModelModal] Error fetching model classes:', error);
      } finally {
        setLoadingModelClasses(false);
      }
    };
    
    fetchModelClasses();
  }, [selectedModel, trainingTasks]);

  // Fetch annotation classes from the first selected dataset with ground truth
  useEffect(() => {
    const datasetWithGT = selectedDatasets.find(d => d.annotationFileId);
    if (!datasetWithGT) {
      setAnnotationClasses([]);
      return;
    }
    
    const fetchClasses = async () => {
      setLoadingClasses(true);
      try {
        const response = await fetch(`http://localhost:9999/datasets/${datasetWithGT.datasetId}/annotations/${datasetWithGT.annotationFileId}/classes`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.classes) {
            setAnnotationClasses(data.data.classes);
          }
        }
      } catch (error) {
        console.error('[EvaluateModelModal] Error fetching annotation classes:', error);
      } finally {
        setLoadingClasses(false);
      }
    };
    
    fetchClasses();
  }, [selectedDatasets]);

  // Fetch annotation classes when annotation file is selected (for adding a new dataset)
  useEffect(() => {
    if (!selectedDataset || !selectedAnnotation || !useGroundTruth) {
      return;
    }
    
    const fetchClasses = async () => {
      setLoadingClasses(true);
      try {
        const response = await fetch(`http://localhost:9999/datasets/${selectedDataset}/annotations/${selectedAnnotation}/classes`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data?.classes) {
            setAnnotationClasses(data.data.classes);
          }
        }
      } catch (error) {
        console.error('[EvaluateModelModal] Error fetching annotation classes:', error);
      } finally {
        setLoadingClasses(false);
      }
    };
    
    fetchClasses();
  }, [selectedDataset, selectedAnnotation, useGroundTruth]);

  // Reset ignored classes when annotation file changes
  useEffect(() => {
    setIgnoredClasses([]);
  }, [selectedAnnotation]);

  const toggleIgnoredClass = (className: string) => {
    setIgnoredClasses(prev => 
      prev.includes(className) 
        ? prev.filter(c => c !== className)
        : [...prev, className]
    );
  };

  // Add selected dataset to the list
  const addDatasetToEvaluation = () => {
    if (!selectedDataset) return;
    
    const datasetData = datasets.find(d => d.id.toString() === selectedDataset);
    if (!datasetData) return;
    
    // Check if already added
    if (selectedDatasets.some(d => d.datasetId === parseInt(selectedDataset))) {
      return;
    }
    
    const config: DatasetEvalConfig = {
      datasetId: parseInt(selectedDataset),
      datasetName: datasetData.name,
      annotationFileId: useGroundTruth ? selectedAnnotation || null : null,
      annotationFileName: useGroundTruth && selectedAnnotation 
        ? datasetData.annotation_files?.find((f: any) => String(f.id) === selectedAnnotation)?.file_name || null
        : null,
      collectionId: null,
    };
    
    setSelectedDatasets(prev => [...prev, config]);
    void fetchCollectionCountsForSelection(parseInt(selectedDataset), config.annotationFileId);
    
    // Reset selection for adding more
    setSelectedDataset('');
    setSelectedAnnotation('');
  };

  // Remove dataset from list
  const removeDatasetFromEvaluation = (datasetId: number) => {
    setSelectedDatasets(prev => prev.filter(d => d.datasetId !== datasetId));
  };

  const handleSubmit = async () => {
    if (!selectedModel || selectedDatasets.length === 0) return;

    setIsSubmitting(true);
    try {
      if (onEvaluateMultiple && selectedDatasets.length > 1) {
        await onEvaluateMultiple({
          taskId: parseInt(selectedModel),
          datasets: selectedDatasets,
          checkpoint: selectedCheckpoint,
          confThreshold,
          iouThreshold,
          evaluationName: evaluationName.trim(),
          useGrid,
          gridSize,
          gridOverlap,
          ignoredClasses: ignoredClasses
        });
      } else if (selectedDatasets.length === 1) {
        // Fallback to single dataset evaluation
        await onEvaluate({
          taskId: parseInt(selectedModel),
          datasetId: selectedDatasets[0].datasetId,
          annotationFileId: selectedDatasets[0].annotationFileId,
          checkpoint: selectedCheckpoint,
          confThreshold,
          iouThreshold,
          evaluationName: evaluationName.trim(),
          useGrid,
          gridSize,
          gridOverlap,
          ignoredClasses: ignoredClasses,
          collectionId: selectedDatasets[0].collectionId,
        });
      }
      
      // Reset form
      setEvaluationName('');
      setSelectedModel('');
      setSelectedDataset('');
      setSelectedAnnotation('');
      setSelectedDatasets([]);
      setDatasetCollections(new Map());
      setCollectionAnnotationCounts(new Map());
      setUseGroundTruth(true);
      setConfThreshold(0.25);
      setIouThreshold(0.45);
      setUseGrid(false);
      setGridSize(640);
      setGridOverlap(0.2);
      setIgnoredClasses([]);
      setAnnotationClasses([]);
      setShowIgnoredClasses(false);
      
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
                <Select
                  value={selectedModel}
                  onValueChange={setSelectedModel}
                  disabled={resourcesLoading}
                >
                  <SelectTrigger id="model-select">
                    <SelectValue
                      placeholder={
                        resourcesLoading ? 'Loading models…' : 'Select a trained model'
                      }
                    />
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

          {/* Dataset Selection - Dropdown Menu with Cards */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="w-4 h-4" />
                  Dataset Configuration
                  {selectedDatasets.length > 0 && (
                    <Badge variant="default" className="bg-primary">
                      {selectedDatasets.length} selected
                    </Badge>
                  )}
                </CardTitle>
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
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger 
                        disabled={datasets.length === 0}
                        className="flex items-center cursor-pointer"
                      >
                        <Database className="w-4 h-4 mr-2" />
                        Add Dataset
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        {datasets.length === 0 ? (
                          <DropdownMenuItem disabled>
                            No datasets available
                          </DropdownMenuItem>
                        ) : (
                          datasets
                            .filter(d => !selectedDatasets.some(sd => sd.datasetId === d.id))
                            .map(dataset => (
                              <DropdownMenuItem 
                                key={dataset.id}
                                onClick={() => addDatasetSelection(dataset)}
                                className="flex items-center cursor-pointer"
                              >
                                <Database className="w-4 h-4 mr-2" />
                                {dataset.name} ({dataset.image_count} images)
                              </DropdownMenuItem>
                            ))
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
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
                              onClick={() => void addDatasetGroupSelection(group)}
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
              <CardDescription>
                Choose one or more datasets to evaluate the model on
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedDatasets.length === 0 ? (
                <div className="text-center py-8 border-2 border-dashed rounded-lg">
                  <Database className="h-10 w-10 mx-auto mb-2 text-muted-foreground opacity-50" />
                  <p className="text-muted-foreground font-medium">No datasets selected</p>
                  <p className="text-sm text-muted-foreground">Add datasets using the button above</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedDatasets.map((config) => {
                    // Try to get from enriched datasets first, then fall back to datasets prop
                    const dataset = enrichedDatasets.get(config.datasetId) || datasets.find(d => d.id === config.datasetId);
                    const groupInfo = datasetGroupInfo[config.datasetId];
                    const hasAnnotations = dataset?.annotation_files && dataset.annotation_files.length > 0;
                    const imageCollections = datasetCollections.get(config.datasetId) || [];
                    const countsForDataset = collectionAnnotationCounts.get(config.datasetId) || {};
                    
                    return (
                      <Card key={config.datasetId} className="border">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Database className="h-4 w-4" />
                              <span className="font-medium text-sm">{config.datasetName}</span>
                              {groupInfo && (
                                <Badge variant="secondary" className="text-xs">
                                  <Users className="h-3 w-3 mr-1" />
                                  {groupInfo.groupName}
                                </Badge>
                              )}
                            </div>
                            <Button
                              onClick={() => removeDatasetSelection(config.datasetId)}
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0 space-y-3">
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <ImageIcon className="w-3 h-3" />
                              {dataset?.image_count || 0} images
                            </span>
                            {hasAnnotations && (
                              <span className="flex items-center gap-1">
                                <FileText className="w-3 h-3" />
                                {dataset.annotation_files!.length} annotation {dataset.annotation_files!.length === 1 ? 'file' : 'files'}
                              </span>
                            )}
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Image Collection</Label>
                            <Select
                              value={config.collectionId || ''}
                              onValueChange={(value) => {
                                setSelectedDatasets(prev => prev.map(sd => {
                                  if (sd.datasetId === config.datasetId) {
                                    return {
                                      ...sd,
                                      collectionId: value || null,
                                    };
                                  }
                                  return sd;
                                }));
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Select image collection" />
                              </SelectTrigger>
                              <SelectContent className="z-[100]">
                                {imageCollections.map((collection: any) => (
                                  <SelectItem key={collection.id} value={String(collection.id)}>
                                    {collection.name} ({countsForDataset[String(collection.id)] ?? 0} annotations)
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          
                          {hasAnnotations && (
                            <div className="space-y-2">
                              <Label className="text-xs text-muted-foreground">Ground Truth Annotation</Label>
                              <Select
                                value={config.annotationFileId || 'none'}
                                onValueChange={(value) => {
                                  const nextAnnotationId = value === 'none' ? null : value;
                                  setSelectedDatasets(prev => prev.map(sd => {
                                    if (sd.datasetId === config.datasetId) {
                                      const selectedFile = dataset!.annotation_files!.find((f: any) => String(f.id) === value);
                                      return {
                                        ...sd,
                                        annotationFileId: nextAnnotationId,
                                        annotationFileName: selectedFile ? (selectedFile.file_name || selectedFile.name) : null
                                      };
                                    }
                                    return sd;
                                  }));
                                  void fetchCollectionCountsForSelection(config.datasetId, nextAnnotationId);
                                }}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue placeholder="Select annotation file" />
                                </SelectTrigger>
                                <SelectContent className="z-[100]">
                                  <SelectItem value="none">No ground truth</SelectItem>
                                  {dataset!.annotation_files!.map((file: any) => (
                                    <SelectItem key={file.id} value={String(file.id)}>
                                      {file.file_name || file.name} ({
                                        (() => {
                                          const fileCount = Number(file.annotation_count || 0);
                                          if (fileCount > 0) return fileCount;
                                          const dsCount = Number((dataset as any)?.annotation_count || 0);
                                          if ((dataset!.annotation_files!.length === 1) && dsCount > 0) return dsCount;
                                          return 0;
                                        })()
                                      } annotations)
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Ignored Classes Section - Show when model is selected */}
              {selectedModel && modelClasses.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <button
                    type="button"
                    onClick={() => setShowIgnoredClasses(!showIgnoredClasses)}
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showIgnoredClasses ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    <span>Ignore Classes (Predictions & Metrics)</span>
                    {ignoredClasses.length > 0 && (
                      <Badge variant="secondary" className="ml-1">
                        {ignoredClasses.length} ignored
                      </Badge>
                    )}
                  </button>
                  
                  {showIgnoredClasses && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Select classes to ignore. Predictions of these classes will not be saved, and they will be excluded from metrics calculations.
                      </p>
                      {loadingModelClasses ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary" />
                          Loading classes...
                        </div>
                      ) : modelClasses.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {modelClasses.map((className) => {
                            const isIgnored = ignoredClasses.includes(className);
                            return (
                              <button
                                key={className}
                                type="button"
                                onClick={() => toggleIgnoredClass(className)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                                  isIgnored
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border border-red-300 dark:border-red-700'
                                    : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700'
                                }`}
                              >
                                {className}
                                {isIgnored && <X className="w-3 h-3" />}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          No classes loaded. Select a dataset with ground truth first.
                        </p>
                      )}
                      {ignoredClasses.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setIgnoredClasses([])}
                          className="text-xs text-muted-foreground hover:text-foreground underline"
                        >
                          Clear all ignored classes
                        </button>
                      )}
                    </div>
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
              disabled={
                isSubmitting ||
                resourcesLoading ||
                !selectedModel ||
                selectedDatasets.length === 0 ||
                selectedDatasets.some((d) => !d.collectionId)
              }
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
