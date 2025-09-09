import React, { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useApi } from '@/hooks/use-api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, FolderPlus, Image as ImageIcon, Layers, RotateCw, FlipHorizontal, Contrast, Sun, Palette, ChevronDown, ChevronRight, Box, Eye, EyeOff, Target, AlertTriangle } from 'lucide-react';
import { Dataset } from '@/types';

interface CreateAugmentedDatasetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | number;
  datasets: Dataset[];
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

export const CreateAugmentedDatasetModal = ({ open, onOpenChange, projectId, datasets }: CreateAugmentedDatasetModalProps) => {
  const { toast } = useToast();
  const { api, isConfigured } = useApi();
  
  const [loading, setLoading] = useState(false);
  const [datasetName, setDatasetName] = useState('');
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
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
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [annotationData, setAnnotationData] = useState<any[]>([]);
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);
  const [transformAnnotations, setTransformAnnotations] = useState(true);
  const [annotationSettings, setAnnotationSettings] = useState({
    preserveInvalidBounds: false,
    minVisibilityThreshold: 0.3,
    handleOutOfBounds: 'remove' as 'remove' | 'clip' | 'keep'
  });

  // Fetch annotations for selected datasets
  const fetchAnnotationsForDatasets = useCallback(async (datasetIds: string[]) => {
    if (!api || !isConfigured || datasetIds.length === 0) return;
    
    setLoadingAnnotations(true);
    try {
      const allAnnotations: any[] = [];
      
      for (const datasetId of datasetIds) {
        const response = await api.getAnnotations(parseInt(datasetId));
        if (response.success && response.data) {
          allAnnotations.push(...response.data.map((annotation: any) => ({
            ...annotation,
            dataset_id: datasetId,
            dataset_name: datasets?.find(d => d.id.toString() === datasetId)?.name || `Dataset ${datasetId}`
          })));
        }
      }
      
      setAnnotationData(allAnnotations);
    } catch (error) {
      console.error('Error fetching annotations:', error);
      toast({
        title: "Warning",
        description: "Could not load annotations for preview",
        variant: "destructive"
      });
    } finally {
      setLoadingAnnotations(false);
    }
  }, [api, isConfigured, datasets, toast]);

  // Update annotations when selected datasets change
  useEffect(() => {
    if (selectedDatasets.length > 0 && showAnnotations) {
      fetchAnnotationsForDatasets(selectedDatasets);
    } else {
      setAnnotationData([]);
    }
  }, [selectedDatasets, showAnnotations, fetchAnnotationsForDatasets]);

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      setDatasetName('');
      setSelectedDatasets([]);
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
      setShowAnnotations(false);
      setAnnotationData([]);
    }
  }, [open]);

  const handleDatasetToggle = (datasetId: string) => {
    setSelectedDatasets(prev => 
      prev.includes(datasetId) 
        ? prev.filter(id => id !== datasetId)
        : [...prev, datasetId]
    );
  };

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
    const isCurrentlySelected = selectedAugmentations.includes(augmentationId);
    const method = augmentationMethods.find(m => m.id === augmentationId);
    
    if (isCurrentlySelected) {
      // Remove from selection
      setSelectedAugmentations(prev => prev.filter(id => id !== augmentationId));
      // Clear parameters
      setMethodParameters(prev => {
        const newParams = { ...prev };
        delete newParams[augmentationId];
        return newParams;
      });
      // Collapse parameters
      setExpandedParameters(prev => ({ ...prev, [augmentationId]: false }));
    } else {
      // Add to selection
      setSelectedAugmentations(prev => [...prev, augmentationId]);
      // Initialize parameters if method has them
      if (method?.parameters) {
        setMethodParameters(prev => ({
          ...prev,
          [augmentationId]: { ...method.parameters }
        }));
        setExpandedParameters(prev => ({ ...prev, [augmentationId]: true }));
      }
    }
  }, [selectedAugmentations, augmentationMethods]);

  const handleCheckboxChange = useCallback((augmentationId: string, checked: boolean) => {
    // This function now just calls handleAugmentationToggle to avoid duplicate logic
    // We check if the current state matches what the checkbox wants to do
    const isCurrentlySelected = selectedAugmentations.includes(augmentationId);
    
    if (checked !== isCurrentlySelected) {
      handleAugmentationToggle(augmentationId);
    }
  }, [selectedAugmentations, handleAugmentationToggle]);

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

    if (selectedDatasets.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one dataset to augment",
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

      // Create the augmented dataset
      const formData = new FormData();
      formData.append('name', datasetName.trim());
      formData.append('description', `Augmented dataset created from ${selectedDatasets.length} source dataset(s)`);
      formData.append('project_id', String(projectId));
      formData.append('source_datasets', JSON.stringify(selectedDatasets));
      formData.append('augmentation_methods', JSON.stringify(selectedAugmentations));
      formData.append('method_parameters', JSON.stringify(methodParameters));
      formData.append('augmentation_factor', augmentationFactor);
      
      // Add annotation handling settings
      formData.append('transform_annotations', String(transformAnnotations));
      formData.append('annotation_settings', JSON.stringify(annotationSettings));

      const response = await api.createAugmentedDataset(formData);

      if (!response.success) {
        throw new Error(response.error || 'Failed to create augmented dataset');
      }

      toast({
        title: "Success",
        description: `Augmented dataset "${datasetName}" creation has been started. You can monitor the progress in the tasks panel.`,
      });

      // Reset form and close modal
      setDatasetName('');
      setSelectedDatasets([]);
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
      
      // Refresh the page to show the new dataset (it will be created immediately but empty)
      window.location.reload();
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

  const handleShowAnnotationsToggle = () => {
    setShowAnnotations(prev => !prev);
  };

  const handleAnnotationChange = (index: number, field: string, value: any) => {
    setAnnotationData(prev => {
      const newAnnotations = [...prev];
      newAnnotations[index] = {
        ...newAnnotations[index],
        [field]: value
      };
      return newAnnotations;
    });
  };

  const handleAddAnnotation = () => {
    setAnnotationData(prev => [...prev, { classId: '', bbox: { x: 0, y: 0, width: 100, height: 100 }, polygon: [] }]);
  };

  const handleRemoveAnnotation = (index: number) => {
    setAnnotationData(prev => prev.filter((_, i) => i !== index));
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
            Create a new dataset by applying data augmentation techniques to existing datasets
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
            <Label>Select Source Datasets</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto border rounded-md p-3">
              {datasets?.map((dataset: Dataset) => (
                <Card 
                  key={dataset.id} 
                  className={`cursor-pointer transition-colors ${
                    selectedDatasets.includes(dataset.id.toString()) 
                      ? 'border-accent-foreground/20 bg-accent text-accent-foreground' 
                      : 'hover:border-gray-400'
                  }`}
                  onClick={() => handleDatasetToggle(dataset.id.toString())}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox 
                        checked={selectedDatasets.includes(dataset.id.toString())}
                        onCheckedChange={() => handleDatasetToggle(dataset.id.toString())}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate">{dataset.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            <ImageIcon className="w-3 h-3 mr-1" />
                            {dataset.image_count || 0} images
                          </Badge>
                        </div>
                        {dataset.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                            {dataset.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {selectedDatasets.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {selectedDatasets.length} dataset(s) selected
              </p>
            )}
          </div>

          {/* Annotations Preview & Settings */}
          {selectedDatasets.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Box className="w-4 h-4" />
                  Annotation Handling
                </Label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAnnotations(!showAnnotations)}
                    className="text-xs"
                  >
                    {showAnnotations ? (
                      <>
                        <EyeOff className="w-3 h-3 mr-1" />
                        Hide Preview
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3 mr-1" />
                        Show Preview
                      </>
                    )}
                  </Button>
                  <Switch
                    checked={transformAnnotations}
                    onCheckedChange={setTransformAnnotations}
                    aria-label="Transform annotations"
                  />
                  <span className="text-sm text-muted-foreground">
                    Transform annotations
                  </span>
                </div>
              </div>

              {transformAnnotations && (
                <Card className="border-orange-200 bg-orange-50/50">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Target className="w-5 h-5 text-orange-600 mt-0.5" />
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-medium text-orange-900">Annotation Transformation Settings</h4>
                          <p className="text-sm text-orange-700">
                            Configure how annotations should be handled during augmentation
                          </p>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-orange-900">Min Visibility</Label>
                            <Input
                              type="number"
                              min="0"
                              max="1"
                              step="0.1"
                              value={annotationSettings.minVisibilityThreshold}
                              onChange={(e) => setAnnotationSettings(prev => ({
                                ...prev,
                                minVisibilityThreshold: parseFloat(e.target.value) || 0.3
                              }))}
                              className="text-xs"
                            />
                            <p className="text-xs text-orange-600">Minimum visibility to keep annotation</p>
                          </div>
                          
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-orange-900">Out of Bounds</Label>
                            <Select
                              value={annotationSettings.handleOutOfBounds}
                              onValueChange={(value: 'remove' | 'clip' | 'keep') => 
                                setAnnotationSettings(prev => ({
                                  ...prev,
                                  handleOutOfBounds: value
                                }))
                              }
                            >
                              <SelectTrigger className="text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="remove">Remove</SelectItem>
                                <SelectItem value="clip">Clip to bounds</SelectItem>
                                <SelectItem value="keep">Keep as-is</SelectItem>
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-orange-600">How to handle annotations outside image bounds</p>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <Switch
                              checked={annotationSettings.preserveInvalidBounds}
                              onCheckedChange={(checked) => setAnnotationSettings(prev => ({
                                ...prev,
                                preserveInvalidBounds: checked
                              }))}
                            />
                            <div>
                              <Label className="text-xs font-medium text-orange-900">Preserve Invalid</Label>
                              <p className="text-xs text-orange-600">Keep annotations with invalid bounds</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {showAnnotations && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Box className="w-4 h-4" />
                        Annotations Preview
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {loadingAnnotations ? (
                          <Loader2 className="w-3 h-3 animate-spin mr-1" />
                        ) : null}
                        {annotationData.length} annotations
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {loadingAnnotations ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-muted-foreground">Loading annotations...</span>
                      </div>
                    ) : annotationData.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <AlertTriangle className="w-12 h-12 mx-auto mb-4 opacity-50" />
                        <p>No annotations found in selected datasets</p>
                        <p className="text-xs">Augmentation will only process images</p>
                      </div>
                    ) : (
                      <ScrollArea className="max-h-64">
                        <div className="space-y-2">
                          {Object.entries(
                            annotationData.reduce((acc: Record<string, any[]>, annotation) => {
                              const key = annotation.dataset_name || `Dataset ${annotation.dataset_id}`;
                              if (!acc[key]) acc[key] = [];
                              acc[key].push(annotation);
                              return acc;
                            }, {} as Record<string, any[]>)
                          ).map(([datasetName, annotations]: [string, any[]]) => (
                            <div key={datasetName} className="space-y-1">
                              <div className="flex items-center justify-between py-2 border-b">
                                <span className="font-medium text-sm">{datasetName}</span>
                                <Badge variant="outline" className="text-xs">
                                  {annotations.length} annotations
                                </Badge>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                                {Object.entries(
                                  annotations.reduce((acc: Record<string, number>, ann: any) => {
                                    const category = ann.category || 'Unknown';
                                    acc[category] = (acc[category] || 0) + 1;
                                    return acc;
                                  }, {} as Record<string, number>)
                                ).map(([category, count]: [string, number]) => (
                                  <div key={category} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                                    <span className="truncate">{category}</span>
                                    <Badge variant="secondary" className="text-xs ml-1">
                                      {count}
                                    </Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

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
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                }}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  e.nativeEvent.stopImmediatePropagation();
                                  // Only toggle if we're not already processing this change
                                  const currentlySelected = selectedAugmentations.includes(method.id);
                                  if (currentlySelected !== isSelected) {
                                    // State is already changing, don't trigger again
                                    return;
                                  }
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
                                <Checkbox 
                                  checked={isSelected}
                                  onCheckedChange={(checked) => {
                                    // Only call if the state is actually different
                                    const isCurrentlySelected = selectedAugmentations.includes(method.id);
                                    if (checked !== isCurrentlySelected) {
                                      handleCheckboxChange(method.id, checked as boolean);
                                    }
                                  }}
                                  className="mt-0.5"
                                  onClick={(e) => e.stopPropagation()}
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
                                      {Object.entries(method.parameters).map(([paramName, defaultValue]) => (
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
                                      ))}
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

          {/* Annotations Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-lg font-semibold">Annotations</Label>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleShowAnnotationsToggle}
                className="gap-2"
              >
                {showAnnotations ? (
                  <>
                    <EyeOff className="w-4 h-4" />
                    Hide Annotations
                  </>
                ) : (
                  <>
                    <Eye className="w-4 h-4" />
                    Show Annotations
                  </>
                )}
              </Button>
            </div>
            
            {showAnnotations && (
              <Card className="p-4">
                <CardContent>
                  <div className="space-y-4">
                    {annotationData.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No annotations yet. Add annotations to define object locations and categories in the images.
                      </p>
                    )}
                    {annotationData.map((annotation, index) => (
                      <div key={index} className="p-3 rounded-md border">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {annotation.classId || 'N/A'}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {`(${annotation.bbox.width} x ${annotation.bbox.height})`}
                            </Badge>
                          </div>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveAnnotation(index);
                            }}
                          >
                            <AlertTriangle className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            variant={annotation.polygon.length > 0 ? "default" : "outline"} 
                            size="sm" 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAnnotationChange(index, 'polygon', annotation.polygon.length > 0 ? [] : [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
                            }}
                            className="flex-1"
                          >
                            {annotation.polygon.length > 0 ? 'Edit Polygon' : 'Add Polygon'}
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAnnotationChange(index, 'classId', annotation.classId === 'person' ? '' : 'person');
                            }}
                            className="flex-1"
                          >
                            Toggle Class
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
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
