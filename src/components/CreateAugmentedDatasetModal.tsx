import React, { useState, useCallback, useMemo } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useApi } from '@/hooks/use-api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Loader2, FolderPlus, Image as ImageIcon, Layers, RotateCw, FlipHorizontal, Contrast, Sun, Palette, ChevronDown, ChevronRight, Box, Plus, Trash2, Database, Users } from 'lucide-react';
import { Dataset, DatasetGroup, ImageCollection } from '@/types';
import { getApiBaseUrl } from "@/config/api";
import {
  DatasetEvalPicker,
  type DatasetSelection as PickerDatasetSelection,
  type PickerDataset,
  type PickerGroup,
} from "@/components/DatasetEvalPicker";


interface CreateAugmentedDatasetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | number;
  datasets: Dataset[];
  datasetGroups?: DatasetGroup[];
}

interface DatasetSelection {
  id: string; // unique selection id
  dataset: Dataset;
  collectionId: string | null; // selected image collection ID (required)
  imageCollections: ImageCollection[];
  loadingCollections: boolean;
  annotationFileId: string | null; // selected annotation file ID (or null for no annotations)
  annotationFiles: Array<{ id: number; name: string; annotation_count?: number }>;
  loadingAnnotations: boolean;
  fromGroup?: boolean;
  groupName?: string;
}

interface CreateAugmentedDatasetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | number;
  datasets: Dataset[];
  datasetGroups?: DatasetGroup[];
}

interface DatasetSelection {
  id: string; // unique selection id
  dataset: Dataset;
  collectionId: string | null; // selected image collection ID (required)
  imageCollections: ImageCollection[];
  loadingCollections: boolean;
  annotationFileId: string | null; // selected annotation file ID (or null for no annotations)
  annotationFiles: Array<{ id: number; name: string; annotation_count?: number }>;
  loadingAnnotations: boolean;
  fromGroup?: boolean;
  groupName?: string;
}

interface AugmentationMethod {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'geometric' | 'color' | 'noise' | 'advanced';
  parameters?: { [key: string]: any };
}

const augmentationMethods: AugmentationMethod[] = [
  // Geometric transformations
  { 
    id: 'rotation', 
    name: 'Rotation', 
    description: 'Rotate images by random angles', 
    icon: <RotateCw className="w-4 h-4" />, 
    category: 'geometric',
    parameters: { min_angle: -30, max_angle: 30 }
  },
  { 
    id: 'flip_horizontal', 
    name: 'Horizontal Flip', 
    description: 'Flip images horizontally', 
    icon: <FlipHorizontal className="w-4 h-4" />, 
    category: 'geometric' 
  },
  { 
    id: 'flip_vertical', 
    name: 'Vertical Flip', 
    description: 'Flip images vertically', 
    icon: <FlipHorizontal className="w-4 h-4 rotate-90" />, 
    category: 'geometric' 
  },
  { 
    id: 'scale', 
    name: 'Scaling', 
    description: 'Scale images up or down', 
    icon: <Layers className="w-4 h-4" />, 
    category: 'geometric',
    parameters: { min_scale: 0.8, max_scale: 1.2 }
  },
  
  // Color transformations
  { 
    id: 'brightness', 
    name: 'Brightness', 
    description: 'Adjust image brightness', 
    icon: <Sun className="w-4 h-4" />, 
    category: 'color',
    parameters: { factor: 0.2 }
  },
  { 
    id: 'contrast', 
    name: 'Contrast', 
    description: 'Adjust image contrast', 
    icon: <Contrast className="w-4 h-4" />, 
    category: 'color',
    parameters: { factor: 0.2 }
  },
  { 
    id: 'saturation', 
    name: 'Saturation', 
    description: 'Adjust color saturation', 
    icon: <Palette className="w-4 h-4" />, 
    category: 'color',
    parameters: { factor: 0.2 }
  },
  { 
    id: 'hue_shift', 
    name: 'Hue Shift', 
    description: 'Shift color hues', 
    icon: <Palette className="w-4 h-4" />, 
    category: 'color',
    parameters: { max_shift: 0.1 }
  },
  { 
    id: 'to_gray', 
    name: 'Grayscale', 
    description: 'Convert images to grayscale', 
    icon: <Palette className="w-4 h-4" />, 
    category: 'color'
  },
  { 
    id: 'color_space', 
    name: 'Color Space Transform', 
    description: 'Transform to different color space (HSV, Lab, etc)', 
    icon: <Palette className="w-4 h-4" />, 
    category: 'color',
    parameters: { color_space: 'HSV', channel: 'all' }
  },
  { 
    id: 'channel_select', 
    name: 'Single Channel', 
    description: 'Keep only one color channel', 
    icon: <Palette className="w-4 h-4" />, 
    category: 'color',
    parameters: { channel: 0 }
  },
  
  // Noise and blur
  { 
    id: 'gaussian_noise', 
    name: 'Gaussian Noise', 
    description: 'Add random noise to images', 
    icon: <ImageIcon className="w-4 h-4" />, 
    category: 'noise',
    parameters: { std: 0.01 }
  },
  { 
    id: 'gaussian_blur', 
    name: 'Gaussian Blur', 
    description: 'Apply blur effect', 
    icon: <ImageIcon className="w-4 h-4" />, 
    category: 'noise',
    parameters: { kernel_size: 3 }
  },
  
  // Advanced
  { 
    id: 'cutout', 
    name: 'Cutout', 
    description: 'Randomly mask rectangular regions', 
    icon: <Layers className="w-4 h-4" />, 
    category: 'advanced',
    parameters: { num_holes: 1, max_size: 16 }
  },
  { 
    id: 'mixup', 
    name: 'Mixup', 
    description: 'Blend images together', 
    icon: <Layers className="w-4 h-4" />, 
    category: 'advanced',
    parameters: { alpha: 0.2 }
  },
];

const getParameterDescription = (methodId: string, paramName: string): string => {
  const descriptions: Record<string, Record<string, string>> = {
    rotation: {
      min_angle: 'Minimum rotation angle in degrees (negative for counter-clockwise)',
      max_angle: 'Maximum rotation angle in degrees (positive for clockwise)'
    },
    scale: {
      min_scale: 'Minimum scale factor (e.g., 0.8 = 80% of original size)',
      max_scale: 'Maximum scale factor (e.g., 1.2 = 120% of original size)'
    },
    brightness: {
      factor: 'Brightness adjustment factor (0.0 = no change, higher = brighter)'
    },
    contrast: {
      factor: 'Contrast adjustment factor (0.0 = no change, higher = more contrast)'
    },
    saturation: {
      factor: 'Saturation adjustment factor (0.0 = no change, higher = more saturated)'
    },
    hue_shift: {
      max_shift: 'Maximum hue shift as a fraction of the hue wheel (0.0-1.0)'
    },
    color_space: {
      color_space: 'Target color space (HSV, Lab, YCrCb, HLS, etc.)',
      channel: 'Which channel to keep: "all" for all channels, or 0-2 for specific channel (H=0, S=1, V=2 in HSV)'
    },
    channel_select: {
      channel: 'RGB channel to keep (0=Red, 1=Green, 2=Blue)'
    },
    gaussian_noise: {
      std: 'Standard deviation of the Gaussian noise (lower = less noise)'
    },
    gaussian_blur: {
      kernel_size: 'Size of the blur kernel (odd numbers only, higher = more blur)'
    },
    cutout: {
      num_holes: 'Number of rectangular holes to cut out',
      max_size: 'Maximum size of each hole in pixels'
    },
    mixup: {
      alpha: 'Blending factor for mixing images (0.0-1.0, higher = more mixing)'
    }
  };
  
  return descriptions[methodId]?.[paramName] || 'Adjust this parameter as needed';
};

export const CreateAugmentedDatasetModal = ({ open, onOpenChange, projectId, datasets, datasetGroups = [] }: CreateAugmentedDatasetModalProps) => {
  const { toast } = useToast();
  const { api, isConfigured } = useApi();
  
  const [loading, setLoading] = useState(false);
  const [datasetName, setDatasetName] = useState('');
  const [datasetSelections, setDatasetSelections] = useState<DatasetSelection[]>([]);
  const [selectedAugmentations, setSelectedAugmentations] = useState<string[]>([]);
  const [augmentationFactor, setAugmentationFactor] = useState('2');
  const [methodParameters, setMethodParameters] = useState<Record<string, any>>({});
  const [expandedParameters, setExpandedParameters] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({
    geometric: true, // Start with geometric expanded by default
    color: false,
    noise: false,
    advanced: false
  });

  // Fetch image collections for a specific selection
  const fetchImageCollectionsForSelection = async (selectionId: string, datasetId: number) => {
    setDatasetSelections(prev => prev.map(sel =>
      sel.id === selectionId ? { ...sel, loadingCollections: true } : sel
    ));

    try {
      const response = await api?.getImageCollections(datasetId);
      if (response?.success && response.data) {
        const collections = response.data;
        const preferredCollection = collections.find(c => (c as any).is_default) || collections[0] || null;
        setDatasetSelections(prev => prev.map(sel => {
          if (sel.id !== selectionId) return sel;
          return {
            ...sel,
            imageCollections: collections,
            collectionId: preferredCollection ? String(preferredCollection.id) : null,
            loadingCollections: false,
          };
        }));
      } else {
        setDatasetSelections(prev => prev.map(sel =>
          sel.id === selectionId ? { ...sel, imageCollections: [], collectionId: null, loadingCollections: false } : sel
        ));
      }
    } catch (error) {
      console.error('Error fetching image collections:', error);
      setDatasetSelections(prev => prev.map(sel =>
        sel.id === selectionId ? { ...sel, imageCollections: [], collectionId: null, loadingCollections: false } : sel
      ));
    }
  };

  // Fetch annotation files for a specific selection
  const fetchAnnotationFilesForSelection = async (selectionId: string, datasetId: number) => {
    setDatasetSelections(prev => prev.map(sel => 
      sel.id === selectionId ? { ...sel, loadingAnnotations: true } : sel
    ));
    
    try {
      const response = await fetch(`${getApiBaseUrl()}/datasets/${datasetId}/annotation-files/list`);
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          setDatasetSelections(prev => prev.map(sel => {
            if (sel.id === selectionId) {
              const annotationFiles = result.data;
              // Auto-select first annotation file if available
              const autoSelect = annotationFiles.length === 1 ? annotationFiles[0].id.toString() : null;
              return { 
                ...sel, 
                annotationFiles,
                annotationFileId: autoSelect,
                loadingAnnotations: false 
              };
            }
            return sel;
          }));
        }
      }
    } catch (error) {
      console.error('Error fetching annotation files:', error);
      setDatasetSelections(prev => prev.map(sel => 
        sel.id === selectionId ? { ...sel, loadingAnnotations: false } : sel
      ));
    }
  };

  // Add a single dataset selection
  const addDatasetSelection = (dataset?: Dataset) => {
    const targetDataset = dataset || (datasets.length > 0 ? datasets[0] : null);
    if (!targetDataset) return;
    
    const newSelection: DatasetSelection = {
      id: `${Date.now()}-${Math.random()}`,
      dataset: targetDataset,
      collectionId: null,
      imageCollections: [],
      loadingCollections: false,
      annotationFileId: null,
      annotationFiles: [],
      loadingAnnotations: false,
    };
    
    setDatasetSelections(prev => [...prev, newSelection]);
    
    // Fetch annotation files for the dataset
    fetchImageCollectionsForSelection(newSelection.id, targetDataset.id);
    if ((targetDataset.annotation_count || 0) > 0) {
      fetchAnnotationFilesForSelection(newSelection.id, targetDataset.id);
    }
  };

  // Add all datasets from a group
  const addDatasetGroupSelection = (group: DatasetGroup) => {
    if (!group.datasets || group.datasets.length === 0) return;
    
    const newSelections: DatasetSelection[] = group.datasets.map(dataset => ({
      id: `${Date.now()}-${Math.random()}-${dataset.id}`,
      dataset: dataset,
      collectionId: null,
      imageCollections: [],
      loadingCollections: false,
      annotationFileId: null,
      annotationFiles: [],
      loadingAnnotations: false,
      fromGroup: true,
      groupName: group.name,
    }));
    
    setDatasetSelections(prev => [...prev, ...newSelections]);
    
    // Fetch annotation files for all datasets in the group
    newSelections.forEach(selection => {
      fetchImageCollectionsForSelection(selection.id, selection.dataset.id);
      if ((selection.dataset.annotation_count || 0) > 0) {
        fetchAnnotationFilesForSelection(selection.id, selection.dataset.id);
      }
    });
  };

  // Remove a dataset selection
  const removeDatasetSelection = (selectionId: string) => {
    setDatasetSelections(prev => prev.filter(sel => sel.id !== selectionId));
  };

  // Update a dataset selection
  const updateDatasetSelection = (selectionId: string, field: 'dataset' | 'collectionId' | 'annotationFileId', value: any) => {
    setDatasetSelections(prev => prev.map(sel => {
      if (sel.id === selectionId) {
        if (field === 'dataset') {
          // When changing dataset, reset annotation and fetch new files
          const newDataset = value as Dataset;
          const updated = { 
            ...sel, 
            dataset: newDataset, 
            collectionId: null,
            imageCollections: [],
            loadingCollections: false,
            annotationFileId: null,
            annotationFiles: [],
            loadingAnnotations: false,
            fromGroup: false, // No longer from group if manually changed
            groupName: undefined,
          };
          fetchImageCollectionsForSelection(sel.id, newDataset.id);
          if ((newDataset.annotation_count || 0) > 0) {
            fetchAnnotationFilesForSelection(sel.id, newDataset.id);
          }
          return updated;
        } else {
          return { ...sel, [field]: value };
        }
      }
      return sel;
    }));
  };

  // ── DatasetEvalPicker integration (shared with Train / Evaluate) ─────────
  const pickerDatasets: PickerDataset[] = useMemo(() => {
    return datasets.map(d => {
      const sel = datasetSelections.find(s => s.dataset.id === d.id);
      const annotationFilesFromProps = (d.annotation_files || []).map(f => ({
        id: String(f.id),
        name: f.name || f.file_name,
        classes: [] as string[],
      }));
      const annotationFiles = sel && sel.annotationFiles.length > 0
        ? sel.annotationFiles.map(a => ({
            id: String(a.id),
            name: a.name,
            classes: [] as string[],
            annotationCount: a.annotation_count,
          }))
        : annotationFilesFromProps;
      const collections = sel
        ? sel.imageCollections.map(c => ({
            id: String(c.id),
            name: c.name,
            isDefault: (c as any).is_default,
            imageCount: (c as any).totalImageCount ?? c.images?.length,
          }))
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
  }, [datasets, datasetSelections]);

  const pickerGroups: PickerGroup[] = useMemo(
    () => datasetGroups.map(g => ({
      id: g.id,
      name: g.name,
      datasetIds: (g.datasets || []).map(d => d.id),
    })),
    [datasetGroups]
  );

  const pickerValue: PickerDatasetSelection[] = useMemo(
    () => datasetSelections.map(s => ({
      datasetId: s.dataset.id,
      annotationFileId: s.annotationFileId ?? null,
      collectionId: s.collectionId ?? null,
    })),
    [datasetSelections]
  );

  const handlePickerChange = (next: PickerDatasetSelection[]) => {
    setDatasetSelections(prev => {
      const prevById = new Map(prev.map(s => [s.dataset.id, s]));
      const updated: DatasetSelection[] = [];
      const toFetch: { selectionId: string; datasetId: number; needAnnotations: boolean }[] = [];

      next.forEach(n => {
        const existing = prevById.get(n.datasetId);
        if (existing) {
          updated.push({
            ...existing,
            annotationFileId: n.annotationFileId ?? null,
            collectionId: n.collectionId ?? null,
          });
        } else {
          const dataset = datasets.find(d => d.id === n.datasetId)
            || datasetGroups.flatMap(g => g.datasets || []).find(d => d.id === n.datasetId);
          if (!dataset) return;
          const id = `${Date.now()}-${Math.random()}-${n.datasetId}`;
          updated.push({
            id,
            dataset,
            collectionId: n.collectionId ?? null,
            imageCollections: [],
            loadingCollections: true,
            annotationFileId: n.annotationFileId ?? null,
            annotationFiles: [],
            loadingAnnotations: (dataset.annotation_count || 0) > 0,
          });
          toFetch.push({
            selectionId: id,
            datasetId: dataset.id,
            needAnnotations: (dataset.annotation_count || 0) > 0,
          });
        }
      });

      // Trigger lazy fetches for newly added selections
      toFetch.forEach(({ selectionId, datasetId, needAnnotations }) => {
        setTimeout(() => {
          fetchImageCollectionsForSelection(selectionId, datasetId);
          if (needAnnotations) fetchAnnotationFilesForSelection(selectionId, datasetId);
        }, 0);
      });

      return updated;
    });
  };


  React.useEffect(() => {
    if (open) {
      setDatasetName('');
      setDatasetSelections([]);
      setSelectedAugmentations([]);
      setAugmentationFactor('2');
      setMethodParameters({});
      setExpandedParameters({});
      setExpandedCategories({
        geometric: true,
        color: false,
        noise: false,
        advanced: false
      });
    }
  }, [open]);

  const handleParameterToggle = (augmentationId: string) => {
    setExpandedParameters(prev => ({
      ...prev,
      [augmentationId]: !prev[augmentationId]
    }));
  };

  const handleCategoryToggle = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const handleAugmentationToggle = useCallback((augmentationId: string) => {
    const method = augmentationMethods.find(m => m.id === augmentationId);
    
    setSelectedAugmentations(prev => {
      const isCurrentlySelected = prev.includes(augmentationId);
      return isCurrentlySelected 
        ? prev.filter(id => id !== augmentationId)
        : [...prev, augmentationId];
    });
    
    // Handle parameters separately - read current state to decide action
    setMethodParameters(prev => {
      const isCurrentlySelected = augmentationId in prev;
      
      if (isCurrentlySelected) {
        // Remove parameters
        const newParams = { ...prev };
        delete newParams[augmentationId];
        return newParams;
      } else {
        // Add parameters if method has them
        if (method?.parameters) {
          return {
            ...prev,
            [augmentationId]: { ...method.parameters }
          };
        }
        return prev;
      }
    });
    
    setExpandedParameters(prev => {
      const isCurrentlyExpanded = prev[augmentationId];
      
      if (isCurrentlyExpanded) {
        return { ...prev, [augmentationId]: false };
      } else if (method?.parameters) {
        return { ...prev, [augmentationId]: true };
      }
      return prev;
    });
  }, []);

  const updateMethodParameter = (methodId: string, paramName: string, value: any) => {
    setMethodParameters(prev => ({
      ...prev,
      [methodId]: {
        ...prev[methodId],
        [paramName]: value
      }
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!datasetName.trim()) {
      toast({
        title: "Error",
        description: "Please enter a dataset name",
        variant: "destructive",
      });
      return;
    }

    if (datasetSelections.length === 0) {
      toast({
        title: "Error",
        description: "Please add at least one dataset to augment",
        variant: "destructive",
      });
      return;
    }

    if (selectedAugmentations.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one augmentation method",
        variant: "destructive",
      });
      return;
    }
    const missingCollection = datasetSelections.find(sel => !sel.collectionId);
    if (missingCollection) {
      toast({
        title: "Error",
        description: `Please select an image collection for dataset "${missingCollection.dataset.name}"`,
        variant: "destructive",
      });
      return;
    }

    if (!api || !isConfigured) {
      toast({
        title: "Error",
        description: "API client is not configured",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);

      // Prepare dataset configs - each selection becomes a config entry
      const datasetConfigs = datasetSelections.map(sel => ({
        dataset_id: sel.dataset.id,
        collection_id: sel.collectionId ? parseInt(sel.collectionId, 10) : null,
        annotation_file_id: sel.annotationFileId ? parseInt(sel.annotationFileId) : null,
      }));

      // Create the augmented dataset
      const formData = new FormData();
      formData.append('name', datasetName.trim());
      formData.append('description', `Augmented dataset created from ${datasetSelections.length} source dataset(s)`);
      formData.append('project_id', String(projectId));
      formData.append('dataset_configs', JSON.stringify(datasetConfigs));
      formData.append('augmentation_methods', JSON.stringify(selectedAugmentations));
      formData.append('method_parameters', JSON.stringify(methodParameters));
      formData.append('augmentation_factor', augmentationFactor);

      const response = await api.createAugmentedDataset(formData);

      if (!response.success) {
        throw new Error(response.error || 'Failed to create augmented dataset');
      }

      toast({
        title: "Augmentation Started",
        description: `Creating "${datasetName}" with ${selectedAugmentations.length} augmentation(s). Monitor progress in the tasks panel (Activity icon in navbar).`,
        duration: 8000,
      });

      // Reset form and close modal
      setDatasetName('');
      setDatasetSelections([]);
      setSelectedAugmentations([]);
      setAugmentationFactor('2');
      setMethodParameters({});
      setExpandedParameters({});
      setExpandedCategories({
        geometric: true,
        color: false,
        noise: false,
        advanced: false
      });
      onOpenChange(false);
      
      // Don't reload - let the user see the task in the navbar popover
      // The dataset will appear after the task completes
    } catch (err) {
      console.error('Error creating augmented dataset:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to create augmented dataset. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const groupedAugmentations = augmentationMethods.reduce((acc, method) => {
    if (!acc[method.category]) {
      acc[method.category] = [];
    }
    acc[method.category].push(method);
    return acc;
  }, {} as Record<string, AugmentationMethod[]>);

  const categoryNames = {
    geometric: 'Geometric Transformations',
    color: 'Color Adjustments',
    noise: 'Noise & Blur',
    advanced: 'Advanced Techniques'
  };

  const categoryIcons = {
    geometric: <RotateCw className="w-4 h-4" />,
    color: <Palette className="w-4 h-4" />,
    noise: <ImageIcon className="w-4 h-4" />,
    advanced: <Layers className="w-4 h-4" />
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-yellow-600" />
            Create Augmented Dataset
          </DialogTitle>
          <DialogDescription>
            Create a new dataset by applying data augmentation techniques to existing datasets. Augmentation runs only on the selected image collection for each source dataset.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6" onReset={(e) => e.preventDefault()}>
          {/* Dataset Name */}
          <div className="space-y-2">
            <Label htmlFor="datasetName">Dataset Name</Label>
            <Input
              id="datasetName"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder="Enter augmented dataset name"
              required
            />
          </div>

          {/* Source Datasets Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Source Datasets</Label>
              {datasetSelections.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {datasetSelections.length} selected · {datasetSelections.filter(s => s.annotationFileId).length} with annotations
                </span>
              )}
            </div>

            {datasets.length === 0 && datasetGroups.length === 0 ? (
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
          </div>

          {/* Augmentation Methods */}
          <div className="space-y-3">
            <Label>Select Augmentation Methods</Label>
            <div className="space-y-3">
              {Object.entries(groupedAugmentations).map(([category, methods]) => (
                <Card key={category}>
                  <CardHeader 
                    className="pb-3 cursor-pointer transition-colors rounded-t-lg border-b hover:border-gray-300"
                    onClick={() => handleCategoryToggle(category)}
                  >
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {categoryIcons[category as keyof typeof categoryIcons]}
                        <span>{categoryNames[category as keyof typeof categoryNames]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {selectedAugmentations.filter(id => methods.some(m => m.id === id)).length}/{methods.length}
                        </Badge>
                        {expandedCategories[category] ? (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                    </CardTitle>
                  </CardHeader>
                  {expandedCategories[category] && (
                    <CardContent className="pt-0 animate-in slide-in-from-top-2 duration-300">
                      <div className="space-y-4">
                        {methods.map((method) => {
                          const isSelected = selectedAugmentations.includes(method.id);
                          const hasParameters = method.parameters && Object.keys(method.parameters).length > 0;
                          const isExpanded = expandedParameters[method.id];
                          const currentParams = methodParameters[method.id] || method.parameters;
                          
                          return (
                            <div key={method.id} className="space-y-3">
                              <div
                                className={`flex items-start gap-3 p-3 rounded-md cursor-pointer transition-all duration-200 border ${
                                  isSelected
                                    ? 'border-accent-foreground/20 bg-accent text-accent-foreground'
                                    : 'border-transparent hover:border-gray-400'
                                }`}
                                role="button"
                                tabIndex={0}
                                onClick={(e) => {
                                  // Only toggle if not clicking on the checkbox itself
                                  if ((e.target as HTMLElement).tagName === 'INPUT') {
                                    return;
                                  }
                                  e.preventDefault();
                                  handleAugmentationToggle(method.id);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleAugmentationToggle(method.id);
                                  }
                                }}
                              >
                                <input 
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleAugmentationToggle(method.id)}
                                  className="mt-0.5 h-4 w-4 rounded border-gray-300"
                                />
                                <div className="flex items-center gap-2 flex-1">
                                  <div className={`p-1 rounded`}>
                                    {method.icon}
                                  </div>
                                  <div className="flex-1">
                                    <p className={`font-medium text-sm`}>
                                      {method.name}
                                    </p>
                                    <p className={`text-xs ${isSelected ? 'text-accent-foreground/80' : 'text-muted-foreground'}`}>
                                      {method.description}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              
                              {/* Parameter Configuration - shown directly below each selected augmentation */}
                              {isSelected && hasParameters && isExpanded && (
                                <Card className="ml-8 animate-in slide-in-from-top-2 duration-300">
                                  <CardHeader 
                                    className="pb-3 cursor-pointer hover:bg-gray-50 transition-colors rounded-t-lg"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleParameterToggle(method.id);
                                    }}
                                  >
                                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {method.icon}
                                        {method.name} Parameters
                                      </div>
                                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                                    </CardTitle>
                                  </CardHeader>
                                  <CardContent className="pt-0">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                      {Object.entries(method.parameters).map(([paramName, defaultValue]) => {
                                        // Special handling for color_space parameter
                                        if (method.id === 'color_space' && paramName === 'color_space') {
                                          return (
                                            <div key={paramName} className="space-y-2">
                                              <Label htmlFor={`${method.id}-${paramName}`} className="text-sm capitalize">
                                                {paramName.replace(/_/g, ' ')}
                                              </Label>
                                              <Select
                                                value={currentParams[paramName]}
                                                onValueChange={(value) => updateMethodParameter(method.id, paramName, value)}
                                              >
                                                <SelectTrigger className="text-sm">
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="HSV">HSV</SelectItem>
                                                  <SelectItem value="Lab">Lab</SelectItem>
                                                  <SelectItem value="YCrCb">YCrCb</SelectItem>
                                                  <SelectItem value="HLS">HLS</SelectItem>
                                                </SelectContent>
                                              </Select>
                                              <p className="text-xs text-muted-foreground">
                                                {getParameterDescription(method.id, paramName)}
                                              </p>
                                            </div>
                                          );
                                        }
                                        
                                        // Special handling for channel parameter in color_space
                                        if (method.id === 'color_space' && paramName === 'channel') {
                                          const colorSpace = currentParams['color_space'] || 'HSV';
                                          const channelNames: Record<string, string[]> = {
                                            'HSV': ['Hue (0)', 'Saturation (1)', 'Value (2)', 'All'],
                                            'Lab': ['L (0)', 'a (1)', 'b (2)', 'All'],
                                            'YCrCb': ['Y (0)', 'Cr (1)', 'Cb (2)', 'All'],
                                            'HLS': ['H (0)', 'L (1)', 'S (2)', 'All']
                                          };
                                          
                                          return (
                                            <div key={paramName} className="space-y-2">
                                              <Label htmlFor={`${method.id}-${paramName}`} className="text-sm capitalize">
                                                Channel
                                              </Label>
                                              <Select
                                                value={currentParams[paramName]?.toString() || 'all'}
                                                onValueChange={(value) => updateMethodParameter(method.id, paramName, value === 'all' ? 'all' : parseInt(value))}
                                              >
                                                <SelectTrigger className="text-sm">
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  {channelNames[colorSpace]?.map((name, idx) => (
                                                    <SelectItem key={idx} value={name.includes('All') ? 'all' : idx.toString()}>
                                                      {name}
                                                    </SelectItem>
                                                  )) || <SelectItem value="all">All</SelectItem>}
                                                </SelectContent>
                                              </Select>
                                              <p className="text-xs text-muted-foreground">
                                                {getParameterDescription(method.id, paramName)}
                                              </p>
                                            </div>
                                          );
                                        }
                                        
                                        // Special handling for channel_select
                                        if (method.id === 'channel_select' && paramName === 'channel') {
                                          return (
                                            <div key={paramName} className="space-y-2">
                                              <Label htmlFor={`${method.id}-${paramName}`} className="text-sm capitalize">
                                                RGB Channel
                                              </Label>
                                              <Select
                                                value={currentParams[paramName]?.toString() || '0'}
                                                onValueChange={(value) => updateMethodParameter(method.id, paramName, parseInt(value))}
                                              >
                                                <SelectTrigger className="text-sm">
                                                  <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                  <SelectItem value="0">Red (0)</SelectItem>
                                                  <SelectItem value="1">Green (1)</SelectItem>
                                                  <SelectItem value="2">Blue (2)</SelectItem>
                                                </SelectContent>
                                              </Select>
                                              <p className="text-xs text-muted-foreground">
                                                {getParameterDescription(method.id, paramName)}
                                              </p>
                                            </div>
                                          );
                                        }
                                        
                                        // Default number input for other parameters
                                        return (
                                        <div key={paramName} className="space-y-2">
                                          <Label htmlFor={`${method.id}-${paramName}`} className="text-sm capitalize">
                                            {paramName.replace(/_/g, ' ')}
                                          </Label>
                                          <Input
                                            id={`${method.id}-${paramName}`}
                                            type="number"
                                            step={typeof defaultValue === 'number' && defaultValue < 1 ? 0.01 : 1}
                                            value={currentParams[paramName]}
                                            onChange={(e) => {
                                              const value = parseFloat(e.target.value);
                                              if (!isNaN(value)) {
                                                updateMethodParameter(method.id, paramName, value);
                                              }
                                            }}
                                            className="text-sm"
                                            placeholder={`Default: ${defaultValue}`}
                                          />
                                          <p className="text-xs text-muted-foreground">
                                            {getParameterDescription(method.id, paramName)}
                                          </p>
                                        </div>
                                        );
                                      })}
                                    </div>
                                  </CardContent>
                                </Card>
                              )}
                              
                              {/* Collapsed parameter section - just shows that parameters are available */}
                              {isSelected && hasParameters && !isExpanded && (
                                <Card 
                                  className="ml-8 cursor-pointer hover:bg-gray-50 transition-colors"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleParameterToggle(method.id);
                                  }}
                                >
                                  <CardContent className="p-3">
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {method.icon}
                                        <span className="text-sm font-medium">{method.name} Parameters</span>
                                        <Badge variant="outline" className="text-xs">
                                          {Object.keys(method.parameters).length} parameters
                                        </Badge>
                                      </div>
                                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                    </div>
                                  </CardContent>
                                </Card>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
            {selectedAugmentations.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {selectedAugmentations.length} augmentation method(s) selected
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedAugmentations.map(id => {
                    const method = augmentationMethods.find(m => m.id === id);
                    return method ? (
                      <Badge 
                        key={id} 
                        variant="secondary" 
                        className="text-xs cursor-pointer hover:bg-secondary/80 flex items-center gap-1"
                        onClick={() => handleAugmentationToggle(id)}
                      >
                        {method.icon}
                        <span>{method.name}</span>
                      </Badge>
                    ) : null;
                  })}
                </div>
                <p className="text-xs text-muted-foreground opacity-75">
                  Selected augmentations with their parameters
                </p>
              </div>
            )}
          </div>

          {/* Augmentation Factor */}
          <div className="space-y-2">
            <Label htmlFor="augmentationFactor">Augmentation Factor</Label>
            <Select value={augmentationFactor} onValueChange={setAugmentationFactor}>
              <SelectTrigger>
                <SelectValue placeholder="Select augmentation factor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2">2x (Double the dataset)</SelectItem>
                <SelectItem value="3">3x (Triple the dataset)</SelectItem>
                <SelectItem value="4">4x (Quadruple the dataset)</SelectItem>
                <SelectItem value="5">5x (5 times the dataset)</SelectItem>
                <SelectItem value="10">10x (10 times the dataset)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              How many times to multiply the original dataset size through augmentation
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button 
              type="button" 
              variant="outline" 
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button 
              type="submit" 
              disabled={loading}
              className="bg-yellow-600 hover:bg-yellow-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Create Augmented Dataset
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
