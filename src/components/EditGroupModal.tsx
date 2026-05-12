import { useState, useEffect } from "react";
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
  Edit,
  Tag as TagIcon
} from "lucide-react";
import { Dataset, DatasetGroup } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { resolveBackendMediaUrl, getApiBaseUrl } from "@/config/api";

interface EditGroupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: DatasetGroup | null;
  availableDatasets: Dataset[];
  onGroupUpdated?: () => void;
}

export function EditGroupModal({
  open,
  onOpenChange,
  group,
  availableDatasets,
  onGroupUpdated
}: EditGroupModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [selectedDatasets, setSelectedDatasets] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (group) {
      setName(group.name);
      setDescription(group.description || "");
      setUrl(group.url || "");
      setSelectedDatasets(group.dataset_ids || []);
    }
  }, [group]);

  const handleDatasetToggle = (datasetId: number) => {
    setSelectedDatasets(prev => 
      prev.includes(datasetId)
        ? prev.filter(id => id !== datasetId)
        : [...prev, datasetId]
    );
  };

  const handleSubmit = async () => {
    if (!group) return;

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

      const response = await fetch(`${getApiBaseUrl()}/dataset-groups/${group.id}`, {
        method: 'PUT',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to update group');
      }

      const result = await response.json();
      
      if (result.success) {
        toast({
          title: "Success",
          description: `Group "${name}" updated successfully`,
        });
        
        // Close modal and refresh data
        onOpenChange(false);
        onGroupUpdated?.();
      } else {
        throw new Error(result.error || 'Failed to update group');
      }
    } catch (error) {
      console.error('Error updating group:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to update group",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getTotalStats = () => {
    const selected = availableDatasets.filter(d => selectedDatasets.includes(d.id));
    return {
      images: selected.reduce((sum, d) => sum + (d.image_count || 0), 0),
      annotations: selected.reduce((sum, d) => sum + (d.annotation_count || 0), 0)
    };
  };

  const stats = getTotalStats();

  if (!group) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            Edit Dataset Group
          </DialogTitle>
          <DialogDescription>
            Modify the group details and dataset selection.
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
                {availableDatasets.map((dataset) => {
                  const thumb = resolveBackendMediaUrl(dataset.thumbnailUrl);
                  return (
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
                        
                        {thumb ? (
                          <img
                            src={thumb}
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
                );
                })}
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
            {isLoading ? "Updating..." : "Update Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
