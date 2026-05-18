import React, { useState, useEffect, useRef, useMemo } from 'react';
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
import {
  DatasetEvalPicker,
  type DatasetSelection as PickerDatasetSelection,
  type PickerDataset,
  type PickerGroup,
} from "@/components/DatasetEvalPicker";
import { YoloSettingsDialog } from "./YoloSettingsDialog";
import { RFDETRSettingsDialog } from "./RFDETRSettingsDialog";
import { TrainingStartedDialog } from "./TrainingStartedDialog";
import { useApi } from '@/hooks/use-api';
import { useToast } from "@/hooks/use-toast";
import { toast as sonnerToast } from 'sonner';
import { parseYoloPresetFromModelType, rtdetrVariantFromStored } from '@/utils/trainingCloneSettings';

interface TrainModelModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  datasets?: Dataset[];
  datasetGroups?: DatasetGroup[];
  /** When true, datasets/groups are still loading after the dialog opened */
  resourcesLoading?: boolean;
  projectId: string;
  /** When set with `open`, load this task's saved training settings into the form (does not start training). */
  cloneFromTaskId?: number | null;
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
  type: 'yolo' | 'rf-detr';
  settings: any;
}

/** Per-architecture sizes — aligned with install/foundation_models and AutoAnnotateModal. */
const YOLO_TRAIN_SIZES: Record<string, string[]> = {
  yolo11: ['n', 's', 'm', 'l', 'x'],
  yolo26: ['n', 's', 'm', 'l', 'x'],
  yolo_nas: ['s', 'm', 'l'],
};

const YOLO_VERSION_LABEL: Record<string, string> = {
  yolo11: 'YOLOv11',
  yolo26: 'YOLO26',
  yolo_nas: 'YOLO-NAS',
};

const LABEL_FOR_SIZE: Record<string, string> = {
  n: 'Nano',
  s: 'Small',
  m: 'Medium',
  l: 'Large',
  x: 'X-Large',
};

export function TrainModelModal({ open, onOpenChange, datasets = [], datasetGroups = [], resourcesLoading = false, projectId, cloneFromTaskId = null }: TrainModelModalProps) {
  const { api } = useApi();
  const { toast } = useToast();
  const [selectedDatasets, setSelectedDatasets] = useState<DatasetSelection[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelConfig['type'] | null>(null);
  const [modelSettings, setModelSettings] = useState<any>({});
  const [showYoloSettings, setShowYoloSettings] = useState(false);
  const [showRFDETRSettings, setShowRFDETRSettings] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [showClassDialog, setShowClassDialog] = useState(false);
  const [classStats, setClassStats] = useState<any | null>(null);
  const [customName, setCustomName] = useState('');
  
  // Track mount state and active fetch operations
  const isMountedRef = useRef(true);
  const activeFetchesRef = useRef<Map<string, AbortController>>(new Map());
  
  // Unique ID counter for generating collision-free IDs
  const idCounterRef = useRef(0);

  // Training started dialog state
  const [showTrainingStarted, setShowTrainingStarted] = useState(false);
  const [trainingInfo, setTrainingInfo] = useState<{
    taskId: string;
    modelName: string;
    datasetsCount: number;
    epochs: number;
    weightsDownloadNotice?: string;
  }>({
    taskId: '',
    modelName: '',
    datasetsCount: 0,
    epochs: 0
  });

  const yoloVersion = modelSettings.version || 'yolo11';
  const allowedYoloSizes = YOLO_TRAIN_SIZES[yoloVersion] || YOLO_TRAIN_SIZES.yolo11;
  useEffect(() => {
    const allowed = YOLO_TRAIN_SIZES[modelSettings.version || 'yolo11'] || YOLO_TRAIN_SIZES.yolo11;
    const sz = modelSettings.size || 'n';
    if (!allowed.includes(sz)) {
      setModelSettings((prev: any) => ({ ...prev, size: allowed[0] }));
    }
  }, [modelSettings.version, modelSettings.size]);

  // Dataset settings
  const [removeImagesWithoutAnnotations, setRemoveImagesWithoutAnnotations] = useState(true);

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
    if (!api || !isMountedRef.current) return;
    
    // Cancel any existing fetch for this selection
    const existingController = activeFetchesRef.current.get(selectionId);
    if (existingController) {
      existingController.abort();
    }
    
    // Create new abort controller for this fetch
    const abortController = new AbortController();
    activeFetchesRef.current.set(selectionId, abortController);
    
    // Update loading state for this selection
    if (isMountedRef.current) {
      setSelectedDatasets(prev => prev.map(sel => 
        sel.id === selectionId 
          ? { ...sel, loadingCollections: true, loadingAnnotations: true }
          : sel
      ));
    }
    
    try {
      // Fetch image collections
      const collectionsResponse = await api.getImageCollections(datasetId);
      
      // Check if fetch was aborted or component unmounted
      if (abortController.signal.aborted || !isMountedRef.current) return;
      
      const collections = collectionsResponse.success && collectionsResponse.data 
        ? collectionsResponse.data.map((col: any) => col.name)
        : [];
      
      // Fetch annotations
      const annotationsResponse = await api.getAnnotations(datasetId);
      
      // Check again if fetch was aborted or component unmounted
      if (abortController.signal.aborted || !isMountedRef.current) return;
      
      const annotations = annotationsResponse.success && annotationsResponse.data
        ? annotationsResponse.data.map((ann: any) => ({
            id: ann.id || ann.name,
            name: ann.name,
            // fallback to several possible field names used in backend
            type: ann.type || ann.annotation_type || ann.format || ann.file_type || ann.kind || null
          }))
        : [];
      
      // Update the selection with fetched data and auto-select if only one option
      if (isMountedRef.current) {
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
      }
    } catch (error) {
      // Don't update state if aborted or unmounted
      if (abortController.signal.aborted || !isMountedRef.current) return;
      
      console.error('Error fetching data for selection:', error);
      if (isMountedRef.current) {
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
    } finally {
      // Clean up the abort controller
      activeFetchesRef.current.delete(selectionId);
    }
  };

  const addDatasetSelection = () => {
    if (datasets.length === 0) return;
    
    // Generate collision-free unique ID
    idCounterRef.current += 1;
    const uniqueId = `dataset-${Date.now()}-${idCounterRef.current}-${Math.random().toString(36).slice(2, 11)}`;
    
    const newSelection: DatasetSelection = {
      id: uniqueId,
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
    
    // Create selections for all datasets in the group with unique IDs
    const timestamp = Date.now();
    const newSelections: DatasetSelection[] = group.datasets.map((dataset, index) => {
      idCounterRef.current += 1;
      return {
        id: `group-${timestamp}-${idCounterRef.current}-${index}-${Math.random().toString(36).slice(2, 11)}`,
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
      };
    });
    
    setSelectedDatasets([...selectedDatasets, ...newSelections]);
    
    // Fetch data for all newly selected datasets with rate limiting (250ms delay between fetches)
    newSelections.forEach((selection, index) => {
      setTimeout(() => {
        if (isMountedRef.current) {
          fetchDataForSelection(selection.id, selection.dataset.id);
        }
      }, index * 250);
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

  // ── Picker integration ────────────────────────────────────────────────────
  const pickerDatasets: PickerDataset[] = useMemo(() => {
    return datasets.map(d => {
      const sel = selectedDatasets.find(s => s.dataset.id === d.id);
      const annotationFilesFromProps = (d.annotation_files || []).map(f => ({
        id: String(f.id),
        name: f.name || f.file_name,
        classes: [] as string[],
      }));
      const annotationFiles = sel
        ? sel.annotations.map(a => ({
            id: a.id,
            name: a.name,
            classes: [] as string[],
            taskType: (a.type as any) || undefined,
          }))
        : annotationFilesFromProps;
      const collections = sel
        ? sel.imageCollections.map(c => ({ id: c, name: c }))
        : [];
      return {
        id: d.id,
        name: d.name,
        imageCount: d.image_count ?? 0,
        annotationFileCount: d.annotation_file_count ?? annotationFiles.length,
        thumbnailUrl: d.thumbnailUrl,
        annotationFiles,
        collections,
        tags: d.tags,
      };
    });
  }, [datasets, selectedDatasets]);

  const pickerGroups: PickerGroup[] = useMemo(
    () => datasetGroups.map(g => ({
      id: g.id,
      name: g.name,
      datasetIds: (g.datasets || []).map(d => d.id),
    })),
    [datasetGroups]
  );

  const pickerValue: PickerDatasetSelection[] = useMemo(
    () => selectedDatasets.map(s => ({
      datasetId: s.dataset.id,
      annotationFileId: s.annotation || null,
      collectionId: s.imageCollection || null,
    })),
    [selectedDatasets]
  );

  const handlePickerChange = (next: PickerDatasetSelection[]) => {
    const prevById = new Map(selectedDatasets.map(s => [s.dataset.id, s]));
    const nextById = new Map(next.map(s => [s.datasetId, s]));

    // Build new selectedDatasets list
    const updated: DatasetSelection[] = [];
    next.forEach(n => {
      const existing = prevById.get(n.datasetId);
      if (existing) {
        updated.push({
          ...existing,
          annotation: n.annotationFileId ?? '',
          imageCollection: n.collectionId ?? '',
        });
      } else {
        const dataset = datasets.find(d => d.id === n.datasetId);
        if (!dataset) return;
        idCounterRef.current += 1;
        const newSel: DatasetSelection = {
          id: `dataset-${Date.now()}-${idCounterRef.current}-${Math.random().toString(36).slice(2, 9)}`,
          dataset,
          imageCollection: n.collectionId ?? '',
          annotation: n.annotationFileId ?? '',
          imageCollections: [],
          annotations: [],
          loadingCollections: false,
          loadingAnnotations: false,
          split: { train: 80, val: 20, test: 0 },
        };
        updated.push(newSel);
        // Lazy-load collections + annotations
        setTimeout(() => {
          if (isMountedRef.current) fetchDataForSelection(newSel.id, dataset.id);
        }, 0);
      }
    });

    // Cleanup abort controllers for removed selections
    selectedDatasets.forEach(s => {
      if (!nextById.has(s.dataset.id)) {
        const ctrl = activeFetchesRef.current.get(s.id);
        if (ctrl) ctrl.abort();
        activeFetchesRef.current.delete(s.id);
      }
    });

    setSelectedDatasets(updated);
  };

  const handleModelSettingsUpdate = (settings: any) => {
    setModelSettings(settings);
  };

  const canTrain = () => {
    // Check that we have at least one dataset selected
    if (selectedDatasets.length === 0) return false;
    
    // Check that all datasets have both image collection AND annotation selected
    const allConfigured = selectedDatasets.every(sel => {
      const hasImageCollection = sel.imageCollection && sel.imageCollection.trim() !== '';
      const hasAnnotation = sel.annotation && sel.annotation.trim() !== '';
      return hasImageCollection && hasAnnotation;
    });
    
    // Check that a model type is selected
    if (!selectedModel || !allConfigured) return false;
    
    // If wandb is enabled, check if settings are configured
    if (saveToWandb) {
      return wandbSettings.apiKey && wandbSettings.project;
    }
    
    return true;
  };

  const handleTrain = async () => {
    if (!canTrain() || !api) return;
    
    setIsTraining(true);
    
    try {
      // Check if model is implemented
      if (selectedModel !== 'yolo' && selectedModel !== 'rf-detr') {
        toast({
          title: "Not Implemented",
          description: `${String(selectedModel).toUpperCase()} training is not yet implemented`,
          variant: "destructive",
        });
        setIsTraining(false);
        return;
      }

      // Prepare dataset configurations
      const datasetConfigs = selectedDatasets.map(sel => ({
        dataset_id: sel.dataset.id,
        annotation_file_id: sel.annotation,
        image_collection: sel.imageCollection || undefined,
        split: sel.split || { train: 80, val: 20, test: 0 }
      }));

      let response;
      let modelName = '';

      if (selectedModel === 'yolo') {
        // Compute model file name from inline settings if not set by full dialog
        let modelType = modelSettings.modelSize;
        if (!modelType) {
          const ver = modelSettings.version || 'yolo11';
          const sz = modelSettings.size || 'n';
          const task = modelSettings.task || 'segmentation';
          modelType = `${ver}${sz}${task === 'segmentation' ? '-seg' : task === 'classification' ? '-cls' : ''}.pt`;
        }
        // Prepare YOLO training request
        const trainingRequest = {
          project_id: parseInt(projectId),
          dataset_configs: datasetConfigs,
          model_type: modelType,
          epochs: modelSettings.epochs || 100,
          batch_size: modelSettings.batchSize || 16,
          image_size: modelSettings.imageSize || 640,
          device: modelSettings.device || '0',
          patience: modelSettings.patience || 50,
          optimizer: modelSettings.optimizer || 'auto',
          learning_rate: modelSettings.learningRate || 0.01,
          momentum: modelSettings.momentum || 0.937,
          weight_decay: modelSettings.weightDecay || 0.0005,
          save_period: modelSettings.savePeriod !== undefined ? modelSettings.savePeriod : -1,
          augmentations: modelSettings.augmentations || {},
          remove_images_without_annotations: removeImagesWithoutAnnotations,
          use_wandb: saveToWandb,
          wandb_project: saveToWandb ? wandbSettings.project : undefined,
          wandb_entity: saveToWandb ? wandbSettings.entity : undefined,
          task_name: customName.trim() || `YOLO Training - ${new Date().toLocaleString()}`
        };

        response = await api.startYoloTraining(trainingRequest);
        modelName = trainingRequest.model_type;
      } else if (selectedModel === 'rf-detr') {
        // Prepare RT-DETR training request
        const modelType = modelSettings.variant || 'rtdetrv2-s';
        const trainingRequest = {
          project_id: parseInt(projectId),
          dataset_configs: datasetConfigs,
          model_type: modelType.endsWith('.pt') ? modelType : `${modelType}.pt`,
          epochs: modelSettings.epochs || 100,
          batch_size: modelSettings.batchSize || 16,
          image_size: modelSettings.imageSize || 640,
          device: modelSettings.device || '0',
          patience: modelSettings.patience || 50,
          optimizer: modelSettings.optimizer || 'AdamW',
          learning_rate: modelSettings.learningRate || 0.0001,
          weight_decay: modelSettings.weightDecay || 0.0001,
          save_period: modelSettings.savePeriod !== undefined ? modelSettings.savePeriod : -1,
          use_wandb: saveToWandb,
          wandb_project: saveToWandb ? wandbSettings.project : undefined,
          wandb_entity: saveToWandb ? wandbSettings.entity : undefined,
          task_name: customName.trim() || `RT-DETR Training - ${new Date().toLocaleString()}`
        };

        response = await api.startRTDETRTraining(trainingRequest);
        modelName = trainingRequest.model_type;
      }

      // Handle both wrapped and unwrapped responses
      const responseData = response.data || response;
      
      if (response.success && (responseData.task_id || responseData.success)) {
        const taskId = responseData.task_id;

        const downloadNotice =
          responseData.weights_download_expected && responseData.weights_download_notice
            ? responseData.weights_download_notice
            : undefined;

        // Show training started dialog
        setTrainingInfo({
          taskId: taskId || 'unknown',
          modelName: modelName,
          datasetsCount: selectedDatasets.length,
          epochs: modelSettings.epochs || 100,
          weightsDownloadNotice: downloadNotice
        });

        sonnerToast.success("Training Started", {
          description: `Task "${modelName}" is now running on the GPU service.`,
          duration: 6000,
        });

        if (downloadNotice) {
          sonnerToast.info("Model weights will be downloaded", {
            description: downloadNotice,
            duration: 6000,
          });
        }
        
        onOpenChange(false);
        setShowTrainingStarted(true);
        
        // Reset form
        setSelectedDatasets([]);
        setSelectedModel(null);
        setModelSettings({});
      } else {
        const errorMsg = response.error || JSON.stringify(response) || 'Unknown error';
        toast({
          title: "Training Failed",
          description: errorMsg,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error starting training:', error);
      toast({
        title: "Error Starting Training",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
    } finally {
      setIsTraining(false);
    }
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
    setCustomName('');
    setRemoveImagesWithoutAnnotations(true);
  };

  const fetchDataForSelectionRef = useRef(fetchDataForSelection);
  fetchDataForSelectionRef.current = fetchDataForSelection;

  const lastSuccessfulCloneKeyRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    
    if (!open) {
      resetForm();
      lastSuccessfulCloneKeyRef.current = null;
      // Cancel all active fetches
      activeFetchesRef.current.forEach(controller => controller.abort());
      activeFetchesRef.current.clear();
    }
    
    return () => {
      isMountedRef.current = false;
      // Cancel all active fetches on unmount
      activeFetchesRef.current.forEach(controller => controller.abort());
      activeFetchesRef.current.clear();
    };
  }, [open]);

  useEffect(() => {
    if (!open || cloneFromTaskId == null || resourcesLoading) return;
    if (datasets.length === 0) return;

    const key = `task-${cloneFromTaskId}`;
    if (lastSuccessfulCloneKeyRef.current === key) return;

    let cancelled = false;

    const run = async () => {
      if (!api) return;
      try {
        const res = await api.getTask(cloneFromTaskId);
        if (!res.success || !res.data) {
          throw new Error(res.error || 'Failed to load task');
        }
        const task = res.data;
        const md = task.task_metadata || {};
        const rawCfgs = md.dataset_configs;
        if (!Array.isArray(rawCfgs) || rawCfgs.length === 0) {
          if (!cancelled) {
            toast({
              title: 'Could not copy settings',
              description: 'This training task has no saved dataset configuration in metadata.',
              variant: 'destructive',
            });
            lastSuccessfulCloneKeyRef.current = key;
          }
          return;
        }

        type CfgRow = {
          dataset_id?: number | string;
          annotation_file_id?: number | string;
          image_collection?: string;
          split?: { train: number; val: number; test: number };
        };

        const newSelections: DatasetSelection[] = [];
        for (const row of rawCfgs as CfgRow[]) {
          const dsId = Number(row.dataset_id);
          const annRaw = row.annotation_file_id;
          if (!Number.isFinite(dsId) || annRaw === undefined || annRaw === null) continue;

          const dataset = datasets.find((d) => String(d.id) === String(dsId));
          if (!dataset) continue;

          newSelections.push({
            id: `clone-${cloneFromTaskId}-${dsId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            dataset,
            imageCollection: row.image_collection || '',
            annotation: String(annRaw),
            imageCollections: [],
            annotations: [],
            loadingCollections: false,
            loadingAnnotations: false,
            split: row.split || { train: 80, val: 20, test: 0 },
          });
        }

        if (newSelections.length === 0) {
          if (!cancelled) {
            toast({
              title: 'Could not copy settings',
              description:
                'None of the saved datasets from this task are available in this project anymore.',
              variant: 'destructive',
            });
            lastSuccessfulCloneKeyRef.current = key;
          }
          return;
        }

        const tp = md.training_params || {};
        const rawModel =
          (typeof md.model_variant === 'string' ? md.model_variant : null) ||
          (typeof md.model_type === 'string' ? md.model_type : '') ||
          (md.model_config && typeof md.model_config === 'object' ? (md.model_config as { model?: string }).model : '') ||
          '';

        const isRf =
          String(md.model_type || '').toLowerCase() === 'rtdetr' || /rtdetr/i.test(String(rawModel));

        const epochs = tp.epochs ?? md.epochs ?? (isRf ? 300 : 100);
        const batchSize = tp.batch_size ?? 16;
        const imageSize = tp.image_size ?? tp.imgsz ?? md.image_size ?? 640;
        const device = tp.device ?? '0';
        const patience = tp.patience ?? 50;
        const savePeriod = tp.save_period ?? -1;

        if (!cancelled) {
          setSelectedDatasets(newSelections);
          newSelections.forEach((sel) => fetchDataForSelectionRef.current(sel.id, sel.dataset.id));

          const removeUnannotated =
            md.remove_images_without_annotations !== undefined &&
            md.remove_images_without_annotations !== null
              ? Boolean(md.remove_images_without_annotations)
              : true;
          setRemoveImagesWithoutAnnotations(removeUnannotated);

          if (isRf) {
            const variant = rtdetrVariantFromStored(String(rawModel));
            setSelectedModel('rf-detr');
            setModelSettings({
              variant,
              epochs,
              batchSize,
              imageSize,
              device,
              patience,
              optimizer: tp.optimizer ?? 'AdamW',
              learningRate: tp.lr0 ?? tp.learning_rate ?? 0.0001,
              weightDecay: tp.weight_decay ?? 0.0001,
              savePeriod,
            });
          } else {
            const preset = parseYoloPresetFromModelType(String(rawModel));
            let taskKind: 'detection' | 'segmentation' | 'classification' =
              preset?.task ?? 'segmentation';
            const mcTask = md.model_config && typeof md.model_config === 'object' ? (md.model_config as { task?: string }).task : '';
            const tLower = String(mcTask || '').toLowerCase();
            if (tLower.includes('seg')) taskKind = 'segmentation';
            else if (tLower.includes('cls') || tLower.includes('classif')) taskKind = 'classification';
            else if (tLower.includes('detect') || tLower === 'detection' || tLower === 'detect') taskKind = 'detection';

            const yoloPreset = preset ?? {
              version: 'yolo11',
              size: 'n',
              task: taskKind,
              modelSize: 'yolo11n-seg.pt',
            };

            const augmentationsClone =
              md.model_config && typeof md.model_config === 'object'
                ? (md.model_config as { augmentations?: Record<string, unknown> }).augmentations || {}
                : {};

            setSelectedModel('yolo');
            setModelSettings({
              version: yoloPreset.version,
              size: yoloPreset.size,
              task: taskKind,
              modelSize: yoloPreset.modelSize,
              epochs,
              batchSize,
              imageSize,
              device,
              patience,
              optimizer: tp.optimizer ?? 'auto',
              learningRate: tp.lr0 ?? tp.learning_rate ?? 0.01,
              momentum: tp.momentum ?? 0.937,
              weightDecay: tp.weight_decay ?? 0.0005,
              savePeriod,
              augmentations: augmentationsClone,
            });
          }

          toast({
            title: 'Training form filled',
            description: 'Review settings and press Train Model when ready.',
          });
          lastSuccessfulCloneKeyRef.current = key;
        }
      } catch (e) {
        if (!cancelled) {
          toast({
            title: 'Could not load task settings',
            description: e instanceof Error ? e.message : 'Unknown error',
            variant: 'destructive',
          });
          lastSuccessfulCloneKeyRef.current = key;
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open, cloneFromTaskId, resourcesLoading, datasets, toast]);

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
            {/* Custom Training Name */}
            <div className="space-y-2">
              <Label htmlFor="training-name" className="text-base font-medium">Training Name (Optional)</Label>
              <Input
                id="training-name"
                type="text"
                placeholder="e.g., My Custom YOLO Training"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                className="bg-background"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use default name: "[Model] Training - [Date/Time]"
              </p>
            </div>

            <Separator />

            {/* Dataset Selection */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-medium">Dataset Configuration</Label>
                {selectedDatasets.length > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {selectedDatasets.length} selected
                  </Badge>
                )}
              </div>

              {resourcesLoading ? (
                <Card className="p-6 text-center border-dashed">
                  <p className="text-muted-foreground text-sm">Loading datasets…</p>
                </Card>
              ) : datasets.length === 0 && datasetGroups.length === 0 ? (
                <Card className="p-6 text-center border-dashed">
                  <Database className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-muted-foreground">No datasets available</p>
                </Card>
              ) : (
                <DatasetEvalPicker
                  datasets={pickerDatasets}
                  groups={pickerGroups}
                  modelClasses={[]}
                  value={pickerValue}
                  onChange={handlePickerChange}
                />
              )}

              {/* Per-dataset Train / Val / Test split */}
              {selectedDatasets.length > 0 && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Train / Val / Test split</Label>
                  {selectedDatasets.map((selection) => (
                    <Card key={selection.id} className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Database className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium truncate">{selection.dataset.name}</span>
                          {selection.fromGroup && (
                            <Badge variant="outline" className="text-xs">
                              <Users className="h-3 w-3 mr-1" />
                              {selection.groupName}
                            </Badge>
                          )}
                          {selection.annotation && (() => {
                            const sel = selection.annotations.find(a => a.id === selection.annotation);
                            const t = sel?.type || 'unknown';
                            const variant = t === 'classification' ? 'default' : t === 'segmentation' ? 'secondary' : 'outline';
                            return <Badge variant={variant} className="text-xs">{t}</Badge>;
                          })()}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={async () => {
                            if (!selection.annotation) return;
                            try {
                              const res = await api?.getAnnotationClasses(selection.dataset.id, selection.annotation);
                              if (res && res.success) {
                                setClassStats(res.data);
                                setShowClassDialog(true);
                              }
                            } catch (e) {
                              console.error('Error fetching class stats', e);
                            }
                          }}
                          aria-label="Show class stats"
                        >
                          <Info className="h-3 w-3" />
                        </Button>
                      </div>
                      <div className="text-xs flex justify-between mb-1">
                        <span>Train: {selection.split?.train ?? 80}%</span>
                        <span>Val: {selection.split?.val ?? 20}%</span>
                        <span>Test: {selection.split?.test ?? 0}%</span>
                      </div>
                      <div className="w-full h-3 rounded overflow-hidden bg-muted flex">
                        <div style={{ width: `${selection.split?.train ?? 80}%` }} className="h-3 bg-green-500" />
                        <div style={{ width: `${selection.split?.val ?? 20}%` }} className="h-3 bg-yellow-400" />
                        <div style={{ width: `${selection.split?.test ?? 0}%` }} className="h-3 bg-blue-500" />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">Train %</Label>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={selection.split?.train ?? 80}
                            onChange={(e) => {
                              const train = Number(e.target.value);
                              const val = Math.min(selection.split?.val ?? 20, Math.max(0, 100 - train));
                              const test = Math.max(0, 100 - train - val);
                              updateDatasetSelection(selection.id, 'split', { train, val, test });
                            }}
                            className="w-full"
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
                            className="w-full"
                          />
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Model Selection */}
            <div className="space-y-4">
              <Label className="text-base font-medium">Model Selection</Label>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* YOLO — same families as install-time pretrained weights (YOLO11 / YOLO26 / YOLO-NAS) */}
                <Card className={`cursor-pointer transition-all ${selectedModel === 'yolo' ? 'ring-2 ring-primary' : 'hover:border-primary/50'}`}
                  onClick={() => { setSelectedModel('yolo'); if (!modelSettings.epochs) setModelSettings((prev: any) => ({ ...prev, epochs: 100, batchSize: 16, imageSize: 640, device: '0', patience: 50, optimizer: 'auto', learningRate: 0.01, momentum: 0.937, weightDecay: 0.0005, savePeriod: -1, version: 'yolo11', size: 'n', task: 'segmentation' })); }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="font-medium">YOLO</h4>
                      {selectedModel === 'yolo' && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground">YOLO11, YOLO26, YOLO-NAS — detection, segmentation, classification</p>
                  </CardContent>
                </Card>

                {/* RF-DETR — matches rtdetr in install / foundation_models */}
                <Card className={`cursor-pointer transition-all ${selectedModel === 'rf-detr' ? 'ring-2 ring-primary' : 'hover:border-primary/50'}`}
                  onClick={() => { setSelectedModel('rf-detr'); if (!modelSettings.variant) setModelSettings((prev: any) => ({ ...prev, variant: 'rtdetr-l', imageSize: 640, epochs: 300, batchSize: 16 })); }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <h4 className="font-medium">RF-DETR</h4>
                      {selectedModel === 'rf-detr' && <Check className="h-4 w-4 text-primary" />}
                    </div>
                    <p className="text-xs text-muted-foreground">Real-time detection transformer</p>
                  </CardContent>
                </Card>
              </div>

              {/* Inline Model Settings */}
              {selectedModel === 'yolo' && (
                <Card className="border-primary/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Settings className="h-4 w-4" /> YOLO Configuration
                      </CardTitle>
                      <Button size="sm" variant="outline" onClick={() => setShowYoloSettings(true)}>
                        <Settings className="h-3 w-3 mr-1" /> All Settings
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Version</Label>
                        <Select value={modelSettings.version || 'yolo11'} onValueChange={(v) => setModelSettings((prev: any) => ({ ...prev, version: v }))}>
                          <SelectTrigger className="h-8 text-xs bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-background border shadow-md z-[70]">
                            <SelectItem value="yolo11">YOLOv11</SelectItem>
                            <SelectItem value="yolo26">YOLO26</SelectItem>
                            <SelectItem value="yolo_nas">YOLO-NAS</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Size</Label>
                        <Select value={modelSettings.size || 'n'} onValueChange={(v) => setModelSettings((prev: any) => ({ ...prev, size: v }))}>
                          <SelectTrigger className="h-8 text-xs bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-background border shadow-md z-[70]">
                            {allowedYoloSizes.map((sz) => (
                              <SelectItem key={sz} value={sz}>
                                {LABEL_FOR_SIZE[sz] ?? sz}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Task</Label>
                        <Select value={modelSettings.task || 'segmentation'} onValueChange={(v) => setModelSettings((prev: any) => ({ ...prev, task: v }))}>
                          <SelectTrigger className="h-8 text-xs bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-background border shadow-md z-[70]">
                            <SelectItem value="detection">Detection</SelectItem>
                            <SelectItem value="segmentation">Segmentation</SelectItem>
                            <SelectItem value="classification">Classification</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Epochs</Label>
                        <Input type="number" className="h-8 text-xs bg-background" value={modelSettings.epochs || 100} onChange={(e) => setModelSettings((prev: any) => ({ ...prev, epochs: Number(e.target.value) }))} min={1} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Batch Size</Label>
                        <Input type="number" className="h-8 text-xs bg-background" value={modelSettings.batchSize || 16} onChange={(e) => setModelSettings((prev: any) => ({ ...prev, batchSize: Number(e.target.value) }))} min={1} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Image Size</Label>
                        <Input type="number" className="h-8 text-xs bg-background" value={modelSettings.imageSize || 640} onChange={(e) => setModelSettings((prev: any) => ({ ...prev, imageSize: Number(e.target.value) }))} min={32} step={32} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Learning Rate</Label>
                        <Input type="number" className="h-8 text-xs bg-background" value={modelSettings.learningRate || 0.01} onChange={(e) => setModelSettings((prev: any) => ({ ...prev, learningRate: Number(e.target.value) }))} step={0.001} min={0.0001} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Patience</Label>
                        <Input type="number" className="h-8 text-xs bg-background" value={modelSettings.patience || 50} onChange={(e) => setModelSettings((prev: any) => ({ ...prev, patience: Number(e.target.value) }))} min={1} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {selectedModel === 'rf-detr' && (
                <Card className="border-primary/30">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Settings className="h-4 w-4" /> RF-DETR Configuration
                      </CardTitle>
                      <Button size="sm" variant="outline" onClick={() => setShowRFDETRSettings(true)}>
                        <Settings className="h-3 w-3 mr-1" /> All Settings
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Variant</Label>
                        <Select value={modelSettings.variant || 'rtdetr-l'} onValueChange={(v) => setModelSettings((prev: any) => ({ ...prev, variant: v }))}>
                          <SelectTrigger className="h-8 text-xs bg-background"><SelectValue /></SelectTrigger>
                          <SelectContent className="bg-background border shadow-md z-[70]">
                            <SelectItem value="rtdetr-l">RT-DETR-L</SelectItem>
                            <SelectItem value="rtdetr-x">RT-DETR-X</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Epochs</Label>
                        <Input type="number" className="h-8 text-xs bg-background" value={modelSettings.epochs || 300} onChange={(e) => setModelSettings((prev: any) => ({ ...prev, epochs: Number(e.target.value) }))} min={1} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Batch Size</Label>
                        <Input type="number" className="h-8 text-xs bg-background" value={modelSettings.batchSize || 16} onChange={(e) => setModelSettings((prev: any) => ({ ...prev, batchSize: Number(e.target.value) }))} min={1} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Image Size</Label>
                        <Input type="number" className="h-8 text-xs bg-background" value={modelSettings.imageSize || 640} onChange={(e) => setModelSettings((prev: any) => ({ ...prev, imageSize: Number(e.target.value) }))} min={32} step={32} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <Separator />

            {/* Dataset Options */}
            <div className="space-y-4">
              <Label className="text-base font-medium">Dataset Options</Label>
              
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <Checkbox
                    id="remove-images-checkbox"
                    checked={removeImagesWithoutAnnotations}
                    onCheckedChange={(checked) => setRemoveImagesWithoutAnnotations(checked as boolean)}
                  />
                  <div className="flex-1">
                    <Label htmlFor="remove-images-checkbox" className="text-sm font-medium cursor-pointer">
                      Remove images without annotations
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Images that have no annotations will be excluded from the training dataset
                    </p>
                  </div>
                </div>
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

            {/* Training Summary / Review Panel */}
            {canTrain() && (
              <>
                <Separator />
                <div className="space-y-3">
                  <Label className="text-base font-medium flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" />
                    Training Summary
                  </Label>
                  <Card className="bg-muted/50 border-primary/20">
                    <CardContent className="p-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">Model</span>
                          <p className="font-medium">
                            {selectedModel === 'yolo' && `${YOLO_VERSION_LABEL[modelSettings.version || 'yolo11'] ?? modelSettings.version} · ${(modelSettings.size || 'n').toUpperCase()}`}
                            {selectedModel === 'rf-detr' && `RF-DETR ${(modelSettings.variant || 'rtdetr-l').toUpperCase()}`}
                          </p>
                        </div>
                        {selectedModel === 'yolo' && (
                          <div>
                            <span className="text-muted-foreground text-xs">Task</span>
                            <p className="font-medium capitalize">{modelSettings.task || 'segmentation'}</p>
                          </div>
                        )}
                        <div>
                          <span className="text-muted-foreground text-xs">Epochs</span>
                          <p className="font-medium">{modelSettings.epochs || (selectedModel === 'rf-detr' ? 300 : 100)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">Datasets</span>
                          <p className="font-medium">{selectedDatasets.length} dataset{selectedDatasets.length !== 1 ? 's' : ''}</p>
                        </div>
                        {(selectedModel === 'yolo' || selectedModel === 'rf-detr') && (
                          <>
                            <div>
                              <span className="text-muted-foreground text-xs">Batch Size</span>
                              <p className="font-medium">{modelSettings.batchSize || 16}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground text-xs">Image Size</span>
                              <p className="font-medium">{modelSettings.imageSize || 640}px</p>
                            </div>
                          </>
                        )}
                        <div>
                          <span className="text-muted-foreground text-xs">Learning Rate</span>
                          <p className="font-medium">{modelSettings.learningRate ?? (selectedModel === 'rf-detr' ? 0.0001 : 0.01)}</p>
                        </div>
                        {saveToWandb && (
                          <div>
                            <span className="text-muted-foreground text-xs">W&B Project</span>
                            <p className="font-medium">{wandbSettings.project}</p>
                          </div>
                        )}
                      </div>
                      <Separator className="my-3" />
                      <div className="space-y-1">
                        <span className="text-muted-foreground text-xs">Datasets</span>
                        {selectedDatasets.map((sel) => (
                          <div key={sel.id} className="flex items-center justify-between text-xs">
                            <span className="font-medium">{sel.dataset.name}</span>
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span>{sel.imageCollection}</span>
                              <span>•</span>
                              <span>{sel.split?.train ?? 80}/{sel.split?.val ?? 20}/{sel.split?.test ?? 0}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
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
              disabled={!canTrain() || isTraining || resourcesLoading}
            >
              <Brain className="h-4 w-4 mr-2" />
              {isTraining ? 'Training...' : resourcesLoading ? 'Loading…' : 'Train Model'}
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

      {/* Training Started Success Dialog */}
      <TrainingStartedDialog
        open={showTrainingStarted}
        onOpenChange={setShowTrainingStarted}
        taskId={trainingInfo.taskId}
        modelName={trainingInfo.modelName}
        datasetsCount={trainingInfo.datasetsCount}
        epochs={trainingInfo.epochs}
        weightsDownloadNotice={trainingInfo.weightsDownloadNotice}
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