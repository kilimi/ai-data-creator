
import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Navbar } from "@/components/Navbar";
import { useProject } from '@/hooks/use-projects';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { DatasetCard, DatasetCardSkeleton } from '@/components/DatasetCard';
import { DatasetGroupCard } from '@/components/DatasetGroupCard';
import { AddGroupModal } from '@/components/AddGroupModal';
import { EditGroupModal } from '@/components/EditGroupModal';
import { ProjectBreadcrumb } from '@/components/ProjectBreadcrumb';
import { CreateAugmentedDatasetModal } from '@/components/CreateAugmentedDatasetModal';
import { FolderPlus, ArrowLeft, Copy, Pencil, Trash2, AlertCircle, Search, SlidersHorizontal, Database, Tag, ChevronDown, Users } from "lucide-react";
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

interface DatasetDetailProps {
  projectMode?: boolean;
}

const DatasetDetail = ({ projectMode = false }: DatasetDetailProps) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project: originalProject, loading, error } = useProject(id || '');
  const { api, isConnected } = useApi();
  const { toast } = useToast();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name" | "images" | "annotations">("newest");
  const [showAugmentedModal, setShowAugmentedModal] = useState(false);
  
  // Dataset groups state
  const [datasetGroups, setDatasetGroups] = useState<DatasetGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DatasetGroup | null>(null);

  // Update local project state when original project changes
  useEffect(() => {
    if (originalProject) {
      setProject(originalProject);
    }
  }, [originalProject]);

  // Fetch dataset groups for the project
  const fetchDatasetGroups = async () => {
    if (!id) return;
    
    try {
      const response = await fetch(`http://localhost:9999/projects/${id}/dataset-groups/`);
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
    if (projectMode && id) {
      fetchDatasetGroups();
    }
  }, [projectMode, id]);

  const handleToggleGroupExpanded = (groupId: number) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const handleEditGroup = (group: DatasetGroup) => {
    setEditingGroup(group);
    setShowEditGroupModal(true);
  };

  const handleDeleteGroup = async (group: DatasetGroup) => {
    try {
      const response = await fetch(`http://localhost:9999/dataset-groups/${group.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: `Group "${group.name}" deleted successfully`,
        });
        fetchDatasetGroups(); // Refresh groups
      } else {
        throw new Error('Failed to delete group');
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      toast({
        title: "Error",
        description: "Failed to delete group",
        variant: "destructive",
      });
    }
  };

  const handleGroupCreated = () => {
    fetchDatasetGroups(); // Refresh groups when a new one is created
  };

  const handleGroupUpdated = () => {
    fetchDatasetGroups(); // Refresh groups when one is updated
  };

  // Debug logging to track project ID
  console.log("Project Detail - Current Project ID:", id);
  console.log("Project Detail - Project Data:", project);
  console.log("Project Detail - Mode:", projectMode);

  const handleDeleteDataset = async (dataset: Dataset) => {
    try {
      if (!api) {
        throw new Error('API client not configured');
      }

      const response = await api.deleteDataset(dataset.id);
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to delete dataset');
      }

      // Update local datasets state for non-project mode
      setDatasets(prevDatasets => prevDatasets.filter(d => d.id !== dataset.id));
      
      // Update project state for project mode  
      if (project && projectMode) {
        setProject(prevProject => {
          if (!prevProject) return prevProject;
          return {
            ...prevProject,
            datasets: prevProject.datasets.filter(d => d.id !== dataset.id)
          };
        });
      }
      
      toast({
        title: "Dataset deleted",
        description: `${dataset.name} has been deleted successfully.`,
      });
    } catch (err) {
      console.error('Error deleting:', err);
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to delete. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDatasetUpdated = (updatedDataset: Dataset) => {
    // Update local datasets state for non-project mode
    setDatasets(prevDatasets => 
      prevDatasets.map(d => d.id === updatedDataset.id ? updatedDataset : d)
    );
    
    // Update project state for project mode
    if (project && projectMode) {
      setProject(prevProject => {
        if (!prevProject) return prevProject;
        return {
          ...prevProject,
          datasets: prevProject.datasets.map(d => 
            d.id === updatedDataset.id ? updatedDataset : d
          )
        };
      });
    }
  };

  const handleDuplicate = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${import.meta.env.VITE_API_URL}/datasets/${id}/duplicate`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Failed to duplicate dataset');
      }

      const duplicatedDataset = await response.json();
      navigate(`/datasets/${duplicatedDataset.id}`);
    } catch (error) {
      console.error('Error duplicating dataset:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Add useEffect to fetch individual dataset data when not in project mode
  useEffect(() => {
    const fetchDataset = async () => {
      if (!projectMode && id && api && isConnected === true) {
        try {
          setIsLoading(true);
          const response = await api.getDataset(id);
          if (response.success && response.data) {
            setDatasets([response.data]);
          } else {
            console.error('Failed to fetch dataset:', response.error);
            toast({
              title: "Error",
              description: "Failed to load dataset details",
              variant: "destructive",
            });
          }
        } catch (error) {
          console.error('Error fetching dataset:', error);
          toast({
            title: "Error",
            description: "Failed to load dataset details",
            variant: "destructive",
          });
        } finally {
          setIsLoading(false);
        }
      } else if (!projectMode && isConnected === false) {
        setIsLoading(false);
      }
    };

    fetchDataset();
  }, [id, projectMode, api, isConnected]);

  // Get all unique tags from datasets
  const allTags = Array.from(
    new Set(
      (project?.datasets || []).flatMap(dataset => dataset.tags || [])
    )
  ).sort() as string[];

  // Filter and sort datasets (only show ungrouped datasets)
  const getUngroupedDatasets = () => {
    if (!project?.datasets) return [];
    
    // Get all dataset IDs that are in groups
    const groupedDatasetIds = new Set(
      datasetGroups.flatMap(group => group.dataset_ids || [])
    );
    
    // Return only datasets that are not in any group
    return project.datasets.filter(dataset => !groupedDatasetIds.has(dataset.id));
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
        // Check group name and description
        if (group.name.toLowerCase().includes(query) || 
            (group.description && group.description.toLowerCase().includes(query))) {
          return true;
        }
        
        // Check if any dataset in the group matches
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
    
    // Auto-expand groups that contain matching datasets when searching
    if (searchQuery || selectedTag) {
      const groupsWithMatches = result.filter(group =>
        group.datasets.some(dataset => {
          let matches = false;
          if (searchQuery) {
            const query = searchQuery.toLowerCase();
            matches = dataset.name.toLowerCase().includes(query) || 
                     (dataset.description && dataset.description.toLowerCase().includes(query)) ||
                     (dataset.tags && dataset.tags.some(tag => tag.toLowerCase().includes(query)));
          }
          if (selectedTag && dataset.tags) {
            matches = matches || dataset.tags.includes(selectedTag);
          }
          return matches;
        })
      );
      
      const expandedGroupIds = new Set(expandedGroups);
      groupsWithMatches.forEach(group => expandedGroupIds.add(group.id));
      setExpandedGroups(expandedGroupIds);
    }
    
    return result;
  };

  if (!projectMode) {
    return (
      <div className="min-h-screen pb-16">
        <Navbar />
        <section className="container max-w-7xl mx-auto px-4 pt-24 pb-6">
          <div className="flex items-center gap-2 mb-6">
            <Button 
              variant="ghost" 
              size="icon" 
              asChild
              className="h-9 w-9"
            >
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h2 className="text-2xl font-bold">Dataset Details</h2>
          </div>

          {isLoading ? (
            <DatasetCardSkeleton />
          ) : datasets[0] ? (
            <div className="max-w-2xl">
              <DatasetCard 
                dataset={datasets[0]} 
                onDatasetUpdated={handleDatasetUpdated}
              />
              
              <div className="mt-6 space-y-6">
                <Card className="p-6">
                  <h3 className="text-lg font-semibold mb-4">Dataset Information</h3>
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Description</p>
                      <p>{datasets[0].description || "No description provided"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Created</p>
                      <p>{new Date(datasets[0].created_at).toLocaleDateString()}</p>
                    </div>
                    {datasets[0].tags && datasets[0].tags.length > 0 && (
                      <div>
                        <p className="text-sm font-medium text-muted-foreground mb-2">Tags</p>
                        <div className="flex flex-wrap gap-2">
                          {datasets[0].tags.map(tag => (
                            <Badge key={tag} variant="secondary">{tag}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </Card>

                <div className="flex gap-3">
                  <Button asChild variant="default">
                    <Link to={`/datasets/${datasets[0].id}/annotate`}>
                      <Pencil className="w-4 h-4 mr-2" />
                      Annotate Images
                    </Link>
                  </Button>
                  <Button variant="outline" onClick={handleDuplicate} disabled={isLoading}>
                    <Copy className="w-4 h-4 mr-2" />
                    Duplicate Dataset
                  </Button>
                  <Button 
                    variant="destructive" 
                    onClick={() => datasets[0] && handleDeleteDataset(datasets[0])}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Dataset
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Card className="p-6 text-center">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p>Dataset not found</p>
            </Card>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16">
      <Navbar />
      
      <section className="container max-w-7xl mx-auto px-4 pt-24 pb-6">
        {/* Breadcrumb Navigation */}
        <ProjectBreadcrumb 
          projectName={project?.name || null}
          isLoading={loading}
        />
        
        {/* Project Header with Back and Create Dataset Button */}
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="icon" 
              asChild
              className="h-9 w-9"
            >
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <h2 className="text-2xl font-bold">
              {loading ? 'Loading...' : project?.name}
            </h2>
          </div>
        </div>

        {/* Datasets Section Header */}
        <div className="flex items-center gap-2 mb-6">
          <Database className="h-5 w-5 text-primary" />
          <h3 className="text-xl font-semibold">Project Datasets</h3>
          <Badge variant="secondary" className="ml-2">
            {(project?.datasets?.length || 0) + datasetGroups.length} items
          </Badge>
          {datasetGroups.length > 0 && (
            <Badge variant="outline" className="ml-1">
              <Users className="h-3 w-3 mr-1" />
              {datasetGroups.length} groups
            </Badge>
          )}
        </div>
        
        {/* Search and Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4">
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
                <DropdownMenuItem asChild>
                  <div 
                    onClick={() => setShowAugmentedModal(true)}
                    className="flex items-center cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4 mr-2 text-yellow-600" />
                    <span className="text-yellow-600">Augmented Dataset</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        
        {/* Tag Filter */}
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
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
        
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(3).fill(0).map((_, i) => (
              <DatasetCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <Card className="p-6 text-center">
            <p className="text-red-500">Error loading project: {error}</p>
          </Card>
        ) : !project ? (
          <Card className="p-6 text-center">
            <p>Project not found</p>
          </Card>
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
                <DropdownMenuItem asChild>
                  <div 
                    onClick={() => setShowAugmentedModal(true)}
                    className="flex items-center cursor-pointer"
                  >
                    <FolderPlus className="w-4 h-4 mr-2 text-yellow-600" />
                    <span className="text-yellow-600">Augmented Dataset</span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </section>
      
      {/* Modals */}
      {project && (
        <>
          <CreateAugmentedDatasetModal
            open={showAugmentedModal}
            onOpenChange={setShowAugmentedModal}
            projectId={id || ''}
            datasets={project.datasets || []}
          />
          
          <AddGroupModal
            open={showAddGroupModal}
            onOpenChange={setShowAddGroupModal}
            projectId={id || ''}
            datasets={project.datasets || []}
            onGroupCreated={handleGroupCreated}
          />
          
          <EditGroupModal
            open={showEditGroupModal}
            onOpenChange={setShowEditGroupModal}
            group={editingGroup}
            availableDatasets={project.datasets || []}
            onGroupUpdated={handleGroupUpdated}
          />
        </>
      )}
    </div>
  );
};

export default DatasetDetail;
