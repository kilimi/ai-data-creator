import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Database, 
  Image as ImageIcon, 
  Layers,
  FolderPlus,
  Tag as TagIcon
} from "lucide-react";
import { Dataset } from "@/types";
import { useToast } from "@/hooks/use-toast";

interface AddGroupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  datasets: Dataset[];
  onGroupCreated?: () => void;
}

export function AddGroupModal({
  open,
  onOpenChange,
  projectId,
  datasets,
  onGroupCreated
}: AddGroupModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [selectedDatasets, setSelectedDatasets] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleDatasetToggle = (datasetId: number) => {
    setSelectedDatasets(prev => 
      prev.includes(datasetId)
        ? prev.filter(id => id !== datasetId)
        : [...prev, datasetId]
    );
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast({
        title: "Error",
        description: "Group name is required",
        variant: "destructive",
      });
      return;
    }

    if (selectedDatasets.length === 0) {
      toast({
        title: "Error", 
        description: "Please select at least one dataset",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('description', description);
      formData.append('url', url);
      
      // Send dataset IDs as comma-separated string
      formData.append('dataset_ids', selectedDatasets.join(','));

      const response = await fetch(`http://localhost:9999/projects/${projectId}/dataset-groups/`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to create group');
      }

      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Success",
          description: `Group "${name}" created successfully`,
        });
        
        // Reset form
        setName("");
        setDescription("");
        setUrl("");
        setSelectedDatasets([]);
        
        // Close modal and refresh data
        onOpenChange(false);
        onGroupCreated?.();
      } else {
        throw new Error(result.error || 'Failed to create group');
      }
    } catch (error) {
      console.error('Error creating group:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create group",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getTotalStats = () => {
    const selected = datasets.filter(d => selectedDatasets.includes(d.id));
    return {
      images: selected.reduce((sum, d) => sum + (d.image_count || 0), 0),
      annotations: selected.reduce((sum, d) => sum + (d.annotation_count || 0), 0)
    };
  };

  const stats = getTotalStats();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="h-5 w-5" />
            Create Dataset Group
          </DialogTitle>
          <DialogDescription>
            Group related datasets together for better organization and management.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Group Info */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="group-name">Group Name *</Label>
              <Input
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter group name..."
                className="mt-1"
              />
            </div>
            
            <div>
              <Label htmlFor="group-description">Description</Label>
              <Textarea
                id="group-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe this group..."
                className="mt-1"
                rows={3}
              />
            </div>
            
            <div>
              <Label htmlFor="group-url">URL</Label>
              <Input
                id="group-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter group URL..."
                className="mt-1"
                type="url"
              />
            </div>
          </div>

          {/* Dataset Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Select Datasets ({selectedDatasets.length} selected)</Label>
              {selectedDatasets.length > 0 && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <ImageIcon className="h-3 w-3" />
                    {stats.images} images
                  </div>
                  <div className="flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {stats.annotations} annotations
                  </div>
                </div>
              )}
            </div>
            
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {datasets.map((dataset) => (
                  <Card 
                    key={dataset.id}
                    className={`cursor-pointer transition-colors ${
                      selectedDatasets.includes(dataset.id)
                        ? 'border-primary bg-primary/5'
                        : 'hover:border-gray-400'
                    }`}
                    onClick={() => handleDatasetToggle(dataset.id)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-start gap-3">
                        <Checkbox 
                          checked={selectedDatasets.includes(dataset.id)}
                          onChange={() => handleDatasetToggle(dataset.id)}
                          className="mt-0.5"
                        />
                        
                        {dataset.thumbnailUrl ? (
                          <img
                            src={dataset.thumbnailUrl}
                            alt={dataset.name}
                            className="w-12 h-12 rounded object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded bg-muted flex items-center justify-center flex-shrink-0">
                            <Database className="h-6 w-6 text-muted-foreground" />
                          </div>
                        )}
                        
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium truncate">{dataset.name}</h4>
                          {dataset.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                              {dataset.description}
                            </p>
                          )}
                          
                          <div className="flex items-center gap-3 mt-2">
                            <Badge variant="secondary" className="text-xs">
                              <ImageIcon className="w-3 h-3 mr-1" />
                              {dataset.image_count || 0} images
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              <Layers className="w-3 h-3 mr-1" />
                              {dataset.annotation_count || 0} annotations
                            </Badge>
                            {dataset.type && (
                              <Badge variant="outline" className="text-xs">
                                {dataset.type}
                              </Badge>
                            )}
                          </div>
                          
                          {dataset.tags && dataset.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {dataset.tags.slice(0, 3).map(tag => (
                                <Badge key={tag} variant="secondary" className="text-xs">
                                  <TagIcon className="w-2 h-2 mr-1" />
                                  {tag}
                                </Badge>
                              ))}
                              {dataset.tags.length > 3 && (
                                <Badge variant="secondary" className="text-xs">
                                  +{dataset.tags.length - 3} more
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isLoading || !name.trim() || selectedDatasets.length === 0}
          >
            {isLoading ? "Creating..." : "Create Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
