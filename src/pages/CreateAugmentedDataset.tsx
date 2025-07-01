import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import { useApi } from '@/hooks/use-api';
import { useProject } from '@/hooks/use-projects';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, FolderPlus, Image as ImageIcon, Layers, RotateCw, FlipHorizontal, Contrast, Sun, Palette } from 'lucide-react';
import { Dataset } from '@/types';

interface CreateAugmentedDatasetProps {
  projectMode?: boolean;
}

interface AugmentationMethod {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  category: 'geometric' | 'color' | 'noise' | 'advanced';
}

const augmentationMethods: AugmentationMethod[] = [
  // Geometric transformations
  { id: 'rotation', name: 'Rotation', description: 'Rotate images by random angles', icon: <RotateCw className="w-4 h-4" />, category: 'geometric' },
  { id: 'flip_horizontal', name: 'Horizontal Flip', description: 'Flip images horizontally', icon: <FlipHorizontal className="w-4 h-4" />, category: 'geometric' },
  { id: 'flip_vertical', name: 'Vertical Flip', description: 'Flip images vertically', icon: <FlipHorizontal className="w-4 h-4 rotate-90" />, category: 'geometric' },
  { id: 'scale', name: 'Scaling', description: 'Scale images up or down', icon: <Layers className="w-4 h-4" />, category: 'geometric' },
  
  // Color transformations
  { id: 'brightness', name: 'Brightness', description: 'Adjust image brightness', icon: <Sun className="w-4 h-4" />, category: 'color' },
  { id: 'contrast', name: 'Contrast', description: 'Adjust image contrast', icon: <Contrast className="w-4 h-4" />, category: 'color' },
  { id: 'saturation', name: 'Saturation', description: 'Adjust color saturation', icon: <Palette className="w-4 h-4" />, category: 'color' },
  { id: 'hue_shift', name: 'Hue Shift', description: 'Shift color hues', icon: <Palette className="w-4 h-4" />, category: 'color' },
  
  // Noise and blur
  { id: 'gaussian_noise', name: 'Gaussian Noise', description: 'Add random noise to images', icon: <ImageIcon className="w-4 h-4" />, category: 'noise' },
  { id: 'gaussian_blur', name: 'Gaussian Blur', description: 'Apply blur effect', icon: <ImageIcon className="w-4 h-4" />, category: 'noise' },
  
  // Advanced
  { id: 'cutout', name: 'Cutout', description: 'Randomly mask rectangular regions', icon: <Layers className="w-4 h-4" />, category: 'advanced' },
  { id: 'mixup', name: 'Mixup', description: 'Blend images together', icon: <Layers className="w-4 h-4" />, category: 'advanced' },
];

const CreateAugmentedDataset = ({ projectMode = false }: CreateAugmentedDatasetProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { api, isConfigured } = useApi();
  
  // Get projectId from location state
  const projectId = location.state?.projectId;
  const { project } = useProject(projectId?.toString() || '');
  
  const [isOpen, setIsOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [datasetName, setDatasetName] = useState('');
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [selectedAugmentations, setSelectedAugmentations] = useState<string[]>([]);
  const [augmentationFactor, setAugmentationFactor] = useState('2');

  // Debug logging
  console.log("Create Augmented Dataset - Project ID:", projectId);
  console.log("Create Augmented Dataset - Project:", project);

  const handleClose = () => {
    setIsOpen(false);
    // Small delay to allow dialog close animation
    setTimeout(() => {
      if (projectId) {
        navigate(`/projects/${projectId}`);
      } else {
        navigate('/datasets');
      }
    }, 150);
  };

  const handleDatasetToggle = (datasetId: string) => {
    setSelectedDatasets(prev => 
      prev.includes(datasetId) 
        ? prev.filter(id => id !== datasetId)
        : [...prev, datasetId]
    );
  };

  const handleAugmentationToggle = (augmentationId: string) => {
    setSelectedAugmentations(prev => 
      prev.includes(augmentationId) 
        ? prev.filter(id => id !== augmentationId)
        : [...prev, augmentationId]
    );
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
      formData.append('type', 'augmented');
      formData.append('project_id', String(projectId));
      formData.append('source_datasets', JSON.stringify(selectedDatasets));
      formData.append('augmentation_methods', JSON.stringify(selectedAugmentations));
      formData.append('augmentation_factor', augmentationFactor);

      const response = await api.createDataset(formData);

      if (!response.success) {
        throw new Error(response.error || 'Failed to create augmented dataset');
      }

      toast({
        title: "Success",
        description: `Augmented dataset "${datasetName}" has been created successfully.`,
      });

      // Close dialog and navigate back
      setIsOpen(false);
      setTimeout(() => {
        if (projectId) {
          navigate(`/projects/${projectId}`);
        } else {
          navigate('/datasets');
        }
      }, 150);
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

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
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

        <form onSubmit={handleSubmit} className="space-y-6">
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
              {project?.datasets?.map((dataset: Dataset) => (
                <Card 
                  key={dataset.id} 
                  className={`cursor-pointer transition-colors ${
                    selectedDatasets.includes(dataset.id.toString()) 
                      ? 'border-primary bg-primary/5' 
                      : 'hover:border-gray-400'
                  }`}
                  onClick={() => handleDatasetToggle(dataset.id.toString())}
                >
                  <CardContent className="p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox 
                        checked={selectedDatasets.includes(dataset.id.toString())}
                        onChange={() => handleDatasetToggle(dataset.id.toString())}
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate">{dataset.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            <ImageIcon className="w-3 h-3 mr-1" />
                            {dataset.image_count || 0} images
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {dataset.type}
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

          {/* Augmentation Methods */}
          <div className="space-y-3">
            <Label>Select Augmentation Methods</Label>
            <div className="space-y-4">
              {Object.entries(groupedAugmentations).map(([category, methods]) => (
                <Card key={category}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">
                      {categoryNames[category as keyof typeof categoryNames]}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {methods.map((method) => (
                        <div 
                          key={method.id}
                          className={`flex items-start gap-3 p-2 rounded-md cursor-pointer transition-colors ${
                            selectedAugmentations.includes(method.id)
                              ? 'bg-primary/10 border border-primary/20'
                              : 'hover:bg-gray-50'
                          }`}
                          onClick={() => handleAugmentationToggle(method.id)}
                        >
                          <Checkbox 
                            checked={selectedAugmentations.includes(method.id)}
                            onChange={() => handleAugmentationToggle(method.id)}
                          />
                          <div className="flex items-center gap-2 flex-1">
                            {method.icon}
                            <div>
                              <p className="font-medium text-sm">{method.name}</p>
                              <p className="text-xs text-muted-foreground">{method.description}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            {selectedAugmentations.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {selectedAugmentations.length} augmentation method(s) selected
              </p>
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
              onClick={handleClose}
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

export default CreateAugmentedDataset;
