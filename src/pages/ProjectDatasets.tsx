import React, { useState, useEffect } from 'react';
import { useParams, Link, useOutletContext } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { useTasks } from '@/hooks/use-tasks';
import { getApiBaseUrl } from '@/config/api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { DatasetCard, DatasetCardSkeleton } from '@/components/DatasetCard';
import { DatasetGroupCard } from '@/components/DatasetGroupCard';
import { AddGroupModal } from '@/components/AddGroupModal';
import { EditGroupModal } from '@/components/EditGroupModal';
import { CreateAugmentedDatasetModal } from '@/components/CreateAugmentedDatasetModal';
import { MergeDatasetsModal } from '@/components/MergeDatasetsModal';
import { FolderPlus, Search, SlidersHorizontal, Database, Tag, ChevronDown, Users, GitMerge, Image as ImageIcon, Brain, Pencil, Rocket, BookOpen, ArrowRight, CheckCircle2, Activity } from "lucide-react";
import { HelpHint } from "@/components/ui/help-hint";
import { Card } from "@/components/ui/card";
import { Dataset, Project, DatasetGroup } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface OutletContext {
  project: Project | null;
  loading: boolean;
}

export default function ProjectDatasets() {
  const { id } = useParams<{ id: string }>();
  const { project } = useOutletContext<OutletContext>();
  const { api } = useApi();
  const { toast } = useToast();
  const { tasks } = useTasks(id ? parseInt(id) : undefined);
  
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name" | "images" | "annotations">("newest");
  const [showAugmentedModal, setShowAugmentedModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [datasetGroups, setDatasetGroups] = useState<DatasetGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DatasetGroup | null>(null);
  
  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [datasetToDelete, setDatasetToDelete] = useState<Dataset | null>(null);
  const [augmentedDatasets, setAugmentedDatasets] = useState<{ id: number; name: string }[]>([]);
  const [deleteAugmented, setDeleteAugmented] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch datasets for the project
  const fetchProjectDatasets = async () => {
    if (!id) return;
    
    setIsLoading(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/projects/${id}/datasets/list?include_thumbnails=true`,
        { credentials: 'omit' },
      );
      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          setDatasets(result.data);
        }
      }
    } catch (error) {
      console.error('Error fetching project datasets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch dataset groups for the project
  const fetchDatasetGroups = async () => {
    if (!id) return;
    
    try {
      const response = await fetch(`${getApiBaseUrl()}/projects/${id}/dataset-groups/`, { credentials: 'omit' });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          setDatasetGroups(result.data);
        }
      }
    } catch (error) {
      console.error('Error fetching dataset groups:', error);
    }
  };

  useEffect(() => {
    fetchProjectDatasets();
    fetchDatasetGroups();
  }, [id]);

  // Refresh datasets when augmentation tasks complete
  useEffect(() => {
    const completedAugmentations = tasks.filter(
      task => task.task_type === 'augmentation' && task.status === 'completed'
    );
    
    if (completedAugmentations.length > 0) {
      // Refresh datasets to show updated logos/thumbnails
      fetchProjectDatasets();
    }
  }, [tasks.map(t => `${t.id}-${t.status}`).join(',')]);

  // Get all unique tags from datasets
  const allTags = React.useMemo(() => {
    const tagSet = new Set<string>();
    datasets.forEach(dataset => {
      if (dataset.tags) {
        dataset.tags.forEach(tag => tagSet.add(tag));
      }
    });
    return Array.from(tagSet).sort();
  }, [datasets]);

  // Get datasets that are not in any group
  const getUngroupedDatasets = () => {
    const groupedDatasetIds = new Set<number>();
    datasetGroups.forEach(group => {
      group.datasets.forEach(dataset => {
        groupedDatasetIds.add(dataset.id);
      });
    });
    return datasets.filter(dataset => !groupedDatasetIds.has(dataset.id));
  };

  const filteredAndSortedDatasets = () => {
    let result = getUngroupedDatasets();
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        dataset => 
          dataset.name.toLowerCase().includes(query) || 
          dataset.description?.toLowerCase().includes(query) ||
          (dataset.tags && dataset.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }
    
    if (selectedTag) {
      result = result.filter(
        dataset => dataset.tags && dataset.tags.includes(selectedTag)
      );
    }
    
    switch (sortOrder) {
      case "newest":
        return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      case "oldest":
        return result.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case "name":
        return result.sort((a, b) => a.name.localeCompare(b.name));
      case "images":
        return result.sort((a, b) => (b.image_count || 0) - (a.image_count || 0));
      case "annotations":
        return result.sort((a, b) => (b.annotation_count || 0) - (a.annotation_count || 0));
      default:
        return result;
    }
  };

  // Filter and sort dataset groups
  const filteredAndSortedGroups = () => {
    let result = [...datasetGroups];
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(group => {
        if (group.name.toLowerCase().includes(query) || 
            (group.description && group.description.toLowerCase().includes(query))) {
          return true;
        }
        return group.datasets.some(dataset =>
          dataset.name.toLowerCase().includes(query) || 
          (dataset.description && dataset.description.toLowerCase().includes(query)) ||
          (dataset.tags && dataset.tags.some(tag => tag.toLowerCase().includes(query)))
        );
      });
    }
    
    if (selectedTag) {
      result = result.filter(group =>
        group.datasets.some(dataset => 
          dataset.tags && dataset.tags.includes(selectedTag)
        )
      );
    }
    
    return result;
  };

  const handleToggleGroupExpanded = (groupId: number) => {
    const newSet = new Set(expandedGroups);
    if (newSet.has(groupId)) {
      newSet.delete(groupId);
    } else {
      newSet.add(groupId);
    }
    setExpandedGroups(newSet);
  };

  const handleDeleteDataset = async (dataset: Dataset) => {
    // First check if there are augmented datasets
    try {
      const response = await fetch(`${getApiBaseUrl()}/datasets/${dataset.id}/augmented-datasets`, { credentials: 'omit' });
      if (response.ok) {
        const result = await response.json();
        setAugmentedDatasets(result.augmented_datasets || []);
      } else {
        setAugmentedDatasets([]);
      }
    } catch (error) {
      setAugmentedDatasets([]);
    }
    
    setDatasetToDelete(dataset);
    setDeleteAugmented(false);
    setShowDeleteConfirm(true);
  };
  
  const confirmDeleteDataset = async () => {
    if (!datasetToDelete) return;
    
    setIsDeleting(true);
    try {
      const url = new URL(`${getApiBaseUrl()}/datasets/${datasetToDelete.id}`);
      if (deleteAugmented) {
        url.searchParams.set('delete_augmented', 'true');
      }
      
      const response = await fetch(url.toString(), {
        method: 'DELETE'
      });
      
      if (response.ok) {
        const result = await response.json();
        toast({
          title: "Dataset Deleted",
          description: result.deleted_count > 1 
            ? `Successfully deleted ${result.deleted_count} datasets.`
            : "The dataset has been deleted successfully."
        });
        fetchProjectDatasets();
      } else {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete dataset');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete dataset",
        variant: "destructive"
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setDatasetToDelete(null);
      setAugmentedDatasets([]);
    }
  };

  const handleDatasetUpdated = (updatedDataset?: Dataset) => {
    // If we have the updated dataset, update it in the local state immediately
    // This provides instant feedback while the full refresh happens
    if (updatedDataset) {
      setDatasets(prevDatasets => 
        prevDatasets.map(d => d.id === updatedDataset.id ? updatedDataset : d)
      );
    }
    // Also refresh the full list to ensure consistency
    fetchProjectDatasets();
  };

  const handleGroupCreated = () => {
    fetchDatasetGroups();
    setShowAddGroupModal(false);
  };

  const handleGroupUpdated = () => {
    fetchDatasetGroups();
    setShowEditGroupModal(false);
    setEditingGroup(null);
  };

  const handleEditGroup = (group: DatasetGroup) => {
    setEditingGroup(group);
    setShowEditGroupModal(true);
  };

  const handleDeleteGroup = (group: DatasetGroup) => {
    const deleteGroup = async () => {
      try {
        const response = await fetch(`${getApiBaseUrl()}/projects/${id}/dataset-groups/${group.id}`, {
          credentials: 'omit',
          method: 'DELETE'
        });
        if (response.ok) {
          toast({
            title: "Group Deleted",
            description: "The dataset group has been deleted."
          });
          fetchDatasetGroups();
        }
      } catch (error) {
        toast({
          title: "Error",
          description: "Failed to delete group",
          variant: "destructive"
        });
      }
    };
    deleteGroup();
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Database className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Datasets</h1>
          <Badge variant="secondary" className="ml-2">
            {datasets.length + datasetGroups.length} items
          </Badge>
          {datasetGroups.length > 0 && (
            <Badge variant="outline" className="ml-1">
              <Users className="h-3 w-3 mr-1" />
              {datasetGroups.length} groups
            </Badge>
          )}
          <HelpHint ariaLabel="What are datasets?" popover>
            <div className="space-y-2 text-sm">
              <p className="font-semibold text-foreground">Datasets</p>
              <p>
                A dataset is a collection of images and their annotations. Upload images,
                label them, then use one or more datasets to train and evaluate models.
              </p>
              <Link
                to="/help/dataset-view"
                className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
              >
                Read the full guide →
              </Link>
            </div>
          </HelpHint>
        </div>

        {/* Project health stats strip */}
        {datasets.length > 0 && (() => {
          const totalImages = datasets.reduce((s, d) => s + (d.image_count || 0), 0);
          const totalAnn = datasets.reduce((s, d) => s + Math.min(d.annotation_count || 0, d.image_count || 0), 0);
          const pct = totalImages > 0 ? Math.round((totalAnn / totalImages) * 100) : 0;
          const readyCount = datasets.filter(d => (d.annotation_file_count || 0) > 0 && (d.annotation_count || 0) >= (d.image_count || 0) && (d.image_count || 0) > 0).length;
          return (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ImageIcon className="h-4 w-4" />
                {totalImages.toLocaleString()} images
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1.5">
                <Pencil className="h-4 w-4" />
                {totalAnn.toLocaleString()} annotated <span className="text-xs">({pct}%)</span>
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                {readyCount} ready to train
              </span>
            </div>
          );
        })()}
      </div>
      
      {/* Search and Filter Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search datasets by name, description or tags..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="text-muted-foreground h-4 w-4" />
          <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as any)}>
            <SelectTrigger className="min-w-[180px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="name">Name (A-Z)</SelectItem>
              <SelectItem value="images">Most images</SelectItem>
              <SelectItem value="annotations">Most annotations</SelectItem>
            </SelectContent>
          </Select>
          
          <Button 
            variant="outline" 
            size="sm" 
            className="whitespace-nowrap ml-2"
            onClick={() => setShowMergeModal(true)}
            disabled={datasets.length < 2}
            title={datasets.length < 2 ? "Need at least 2 datasets to merge" : "Merge datasets"}
          >
            <GitMerge className="w-4 h-4 mr-2" />
            Merge
          </Button>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="default" 
                size="sm" 
                className="whitespace-nowrap ml-2"
              >
                <FolderPlus className="w-4 h-4 mr-2" />
                Create
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem 
                onClick={() => setShowAddGroupModal(true)}
                className="flex items-center cursor-pointer"
              >
                <Users className="w-4 h-4 mr-2 text-blue-600" />
                <span className="text-blue-600">Dataset Group</span>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link 
                  to="/projects/new/dataset" 
                  state={{ projectId: id ? parseInt(id, 10) : undefined }}
                  className="flex items-center cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Dataset
                </Link>
              </DropdownMenuItem>
              {datasets.length > 0 && (
                <DropdownMenuItem asChild>
                  <div
                    onClick={() => setShowAugmentedModal(true)}
                    className="flex items-center cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4 mr-2 text-yellow-600" />
                    <span className="text-yellow-600">Augmented Dataset</span>
                  </div>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      
      {/* Tag Filter */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant={selectedTag === null ? "default" : "outline"}
            size="sm"
            onClick={() => setSelectedTag(null)}
            className="gap-1"
          >
            All Tags
          </Button>
          {allTags.map(tag => (
            <Button
              key={tag}
              variant={selectedTag === tag ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedTag(tag)}
              className="gap-1"
            >
              <Tag className="w-3 h-3" />
              {tag}
            </Button>
          ))}
        </div>
      )}
      
      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array(3).fill(0).map((_, i) => (
            <DatasetCardSkeleton key={i} />
          ))}
        </div>
      ) : filteredAndSortedGroups().length > 0 || filteredAndSortedDatasets().length > 0 ? (
        <div className="space-y-6">
          {/* Dataset Groups */}
          {filteredAndSortedGroups().length > 0 && (
            <div>
              <h4 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Dataset Groups
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredAndSortedGroups().map(group => (
                  <DatasetGroupCard 
                    key={group.id} 
                    group={group}
                    expanded={expandedGroups.has(group.id)}
                    onToggleExpanded={() => handleToggleGroupExpanded(group.id)}
                    onEdit={handleEditGroup}
                    onDelete={handleDeleteGroup}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Individual Datasets */}
          {filteredAndSortedDatasets().length > 0 && (
            <div>
              <h4 className="text-lg font-medium mb-4 flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                Individual Datasets
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredAndSortedDatasets().map(dataset => (
                  <DatasetCard 
                    key={dataset.id} 
                    dataset={dataset}
                    onDelete={handleDeleteDataset}
                    onDatasetUpdated={handleDatasetUpdated}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-16">
          <Database className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">
            {searchQuery || selectedTag ? 'No datasets match your search' : 'No datasets found'}
          </h3>
          <p className="text-muted-foreground mb-6">
            {searchQuery || selectedTag
              ? `No datasets matching your search criteria`
              : "This project doesn't have any datasets yet."
            }
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <FolderPlus className="w-4 h-4 mr-2" />
                Create Dataset
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuItem 
                onClick={() => setShowAddGroupModal(true)}
                className="flex items-center cursor-pointer"
              >
                <Users className="w-4 h-4 mr-2 text-blue-600" />
                <span className="text-blue-600">Dataset Group</span>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link 
                  to="/projects/new/dataset" 
                  state={{ projectId: id ? parseInt(id, 10) : undefined }}
                  className="flex items-center cursor-pointer"
                >
                  <FolderPlus className="w-4 h-4 mr-2" />
                  Dataset
                </Link>
              </DropdownMenuItem>
              {datasets.length > 0 && (
                <DropdownMenuItem asChild>
                  <div
                    onClick={() => setShowAugmentedModal(true)}
                    className="flex items-center cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4 mr-2 text-yellow-600" />
                    <span className="text-yellow-600">Augmented Dataset</span>
                  </div>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      
      {/* Modals */}
      <CreateAugmentedDatasetModal
        open={showAugmentedModal}
        onOpenChange={setShowAugmentedModal}
        projectId={id || ''}
        datasets={datasets}
        datasetGroups={datasetGroups}
      />
      
      <MergeDatasetsModal
        open={showMergeModal}
        onOpenChange={setShowMergeModal}
        projectId={id || ''}
        datasets={datasets}
        onMergeComplete={() => {
          fetchProjectDatasets();
        }}
      />
      
      <AddGroupModal
        open={showAddGroupModal}
        onOpenChange={setShowAddGroupModal}
        projectId={id || ''}
        datasets={datasets}
        onGroupCreated={handleGroupCreated}
      />
      
      <EditGroupModal
        open={showEditGroupModal}
        onOpenChange={setShowEditGroupModal}
        group={editingGroup}
        availableDatasets={datasets}
        onGroupUpdated={handleGroupUpdated}
      />
      
      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Dataset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{datasetToDelete?.name}"? This will permanently remove the dataset and all its images and annotations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          {augmentedDatasets.length > 0 && (
            <div className="my-4 p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-2">
                This dataset has {augmentedDatasets.length} augmented dataset{augmentedDatasets.length > 1 ? 's' : ''}:
              </p>
              <ul className="text-sm text-muted-foreground mb-3 list-disc list-inside">
                {augmentedDatasets.slice(0, 5).map(ds => (
                  <li key={ds.id}>{ds.name}</li>
                ))}
                {augmentedDatasets.length > 5 && (
                  <li>...and {augmentedDatasets.length - 5} more</li>
                )}
              </ul>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="deleteAugmented"
                  checked={deleteAugmented}
                  onCheckedChange={(checked) => setDeleteAugmented(checked === true)}
                />
                <label
                  htmlFor="deleteAugmented"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  Also delete augmented datasets
                </label>
              </div>
            </div>
          )}
          
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteDataset}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
