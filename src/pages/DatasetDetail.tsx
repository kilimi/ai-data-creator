
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
import { MergeDatasetsModal } from '@/components/MergeDatasetsModal';
import { TrainModelModal } from '@/components/TrainModelModal';
import { TrainingDetailsModal } from '@/components/TrainingDetailsModal';
import { EvaluationDetailsModal } from '@/components/EvaluationDetailsModal';
import { EvaluateModelModal } from '@/components/EvaluateModelModal';
import { AutoAnnotateModal } from '@/components/AutoAnnotateModal';
import { FolderPlus, ArrowLeft, Copy, Pencil, Trash2, AlertCircle, Search, SlidersHorizontal, Database, Tag, ChevronDown, Users, Brain, RotateCw, GitMerge, Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dataset, Project, DatasetGroup } from '@/types';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const [showMergeModal, setShowMergeModal] = useState(false);
  
  // Get initial tab from URL or default to "datasets"
  const [searchParams, setSearchParams] = useState(new URLSearchParams(window.location.search));
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || "datasets");
  
  // Models state
  const [modelsSearchQuery, setModelsSearchQuery] = useState("");
  const [modelsSortOrder, setModelsSortOrder] = useState<"newest" | "oldest" | "name" | "accuracy" | "performance">("newest");
  const [showTrainModelModal, setShowTrainModelModal] = useState(false);
  const [showAutoAnnotateModal, setShowAutoAnnotateModal] = useState(false);
  const [datasetGroups, setDatasetGroups] = useState<DatasetGroup[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [showEditGroupModal, setShowEditGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DatasetGroup | null>(null);
  
  // Training tasks state
  const [trainingTasks, setTrainingTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTaskError, setSelectedTaskError] = useState<{ name: string; error: string; id: number } | null>(null);
  const [selectedTaskCommand, setSelectedTaskCommand] = useState<{ name: string; command: string; id: number } | null>(null);
  const [deletingFailedTasks, setDeletingFailedTasks] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [renamingTask, setRenamingTask] = useState<{ id: number; name: string } | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  
  // Expanded evaluations state for multi-dataset evaluations
  const [expandedEvaluations, setExpandedEvaluations] = useState<Set<number>>(new Set());

  // Predictions state
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<'best' | 'last'>('best');
  const [selectedDatasetForPrediction, setSelectedDatasetForPrediction] = useState<string>('');
  const [evaluationName, setEvaluationName] = useState<string>('');
  const [selectedAnnotation, setSelectedAnnotation] = useState<string>('');
  const [useGroundTruth, setUseGroundTruth] = useState(true);
  const [confThreshold, setConfThreshold] = useState(0.25);
  const [iouThreshold, setIouThreshold] = useState(0.45);
  const [useGrid, setUseGrid] = useState(false);
  const [gridSize, setGridSize] = useState(640);
  const [gridOverlap, setGridOverlap] = useState(0.2);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [results, setResults] = useState<any | null>(null);

  // Update local project state when original project changes
  useEffect(() => {
    if (originalProject) {
      setProject(originalProject);
    }
  }, [originalProject]);

  // Fetch datasets for the project
  const fetchProjectDatasets = async () => {
    if (!id) return;
    
    console.log('[DatasetDetail] Fetching project datasets for project:', id);
    try {
      // Fetch lightweight dataset list (no images/annotations data)
      const response = await fetch(`http://localhost:9999/projects/${id}/datasets/list`);
      console.log('[DatasetDetail] Datasets response status:', response.status);
      if (response.ok) {
        const result = await response.json();
        console.log('[DatasetDetail] Datasets result:', result);
        if (result.success && result.data) {
          console.log('[DatasetDetail] Setting datasets:', result.data);
          setDatasets(result.data);
        }
      } else {
        console.error('[DatasetDetail] Failed to fetch datasets:', response.status);
      }
    } catch (error) {
      console.error('Error fetching project datasets:', error);
    }
  };

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

  const fetchTrainingTasks = async () => {
    if (!id || !project?.id || !api) return;
    
    setLoadingTasks(true);
    try {
      const response = await api.getTasks();
      if (response.success) {
        // Filter for training and evaluation tasks related to this project
        const tasks = response.data.filter((task: any) => 
          (task.task_type === 'yolo_training' || 
           task.task_type === 'training' || 
           task.task_type === 'model_evaluation') && 
          task.project_id === project.id
        );
        setTrainingTasks(tasks);
      } else {
        console.error('Failed to fetch training tasks:', response.error);
      }
    } catch (error) {
      console.error('Error fetching training tasks:', error);
    } finally {
      setLoadingTasks(false);
    }
  };

  useEffect(() => {
    console.log('[DatasetDetail] useEffect triggered - projectMode:', projectMode, 'id:', id);
    if (projectMode && id) {
      console.log('[DatasetDetail] Calling fetchDatasetGroups and fetchProjectDatasets');
      fetchDatasetGroups();
      fetchProjectDatasets();
    }
  }, [projectMode, id]);

  useEffect(() => {
    if (projectMode && id && project?.id) {
      fetchTrainingTasks();
    }
  }, [projectMode, id, project?.id, api]);

  // Fetch training tasks when switching to models or predictions tab
  useEffect(() => {
    if ((activeTab === 'models' || activeTab === 'predictions') && project?.id && api && trainingTasks.length === 0) {
      fetchTrainingTasks();
    }
  }, [activeTab, project?.id, api]);

  // Handle tab change and update URL
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', value);
    window.history.pushState({}, '', url.toString());
  };

  const handleDeleteFailedTasks = async () => {
    if (!project?.id) return;
    
    const failedCount = trainingTasks.filter(t => t.status === 'failed' && t.task_type !== 'model_evaluation').length;
    if (failedCount === 0) {
      toast({
        title: "No failed tasks",
        description: "There are no failed training tasks to delete.",
      });
      return;
    }
    
    if (!confirm(`Are you sure you want to delete ${failedCount} failed training task(s)? This action cannot be undone.`)) {
      return;
    }
    
    setDeletingFailedTasks(true);
    try {
      const response = await api.deleteFailedTasks(project.id);
      if (response.success && response.data) {
        toast({
          title: "Success",
          description: `Deleted ${response.data.deleted_count} failed task(s)`,
        });
        fetchTrainingTasks();
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete tasks",
        variant: "destructive",
      });
    } finally {
      setDeletingFailedTasks(false);
    }
  };

  const generateTrainingCommand = (task: any) => {
    const metadata = task.task_metadata || {};
    const params = metadata.training_params || {};
    const modelConfig = metadata.model_config || {};
    
    // Build curl command for API call
    const apiCommand = `curl -X POST http://localhost:9999/training/yolo/start \\
  -H "Content-Type: application/json" \\
  -d '{
    "project_id": ${project?.id || 'PROJECT_ID'},
    "dataset_configs": [
      {
        "dataset_id": ${metadata.dataset_ids?.[0] || 'DATASET_ID'},
        "annotation_file_id": "ANNOTATION_FILE_ID",
        "split": {"train": 80, "val": 20, "test": 0}
      }
    ],
    "model_type": "${modelConfig.model || 'yolo11n-seg.pt'}",
    "epochs": ${params.epochs || 100},
    "batch_size": ${params.batch_size || 16},
    "image_size": ${params.imgsz || 640},
    "device": "${params.device || '0'}",
    "optimizer": "${params.optimizer || 'auto'}",
    "learning_rate": ${params.lr0 || 0.01},
    "momentum": ${params.momentum || 0.937},
    "weight_decay": ${params.weight_decay || 0.0005}
  }'`;

    // Build docker exec command
    const dockerCommand = `# Option 1: Using API (recommended)
${apiCommand}

# Option 2: Direct docker exec into celery worker
docker compose exec celery_worker python -c "
import sys
sys.path.insert(0, '/app')
from app.tasks.training_tasks import train_yolo_model

task_id = ${task.id}
training_config = {
    'project_id': ${project?.id || 'PROJECT_ID'},
    'dataset_configs': [{
        'dataset_id': ${metadata.dataset_ids?.[0] || 'DATASET_ID'},
        'annotation_file_id': 'ANNOTATION_FILE_ID',
        'split': {'train': 80, 'val': 20, 'test': 0}
    }],
    'model_type': '${modelConfig.model || 'yolo11n-seg.pt'}',
    'epochs': ${params.epochs || 100},
    'batch_size': ${params.batch_size || 16},
    'image_size': ${params.imgsz || 640},
    'device': '${params.device || '0'}',
    'optimizer': '${params.optimizer || 'auto'}',
    'learning_rate': ${params.lr0 || 0.01},
    'momentum': ${params.momentum || 0.937},
    'weight_decay': ${params.weight_decay || 0.0005}
}

train_yolo_model(task_id, training_config)
"

# Option 3: Check task status
curl http://localhost:9999/tasks/${task.id}`;

    return dockerCommand;
  };

  // Helper function to extract model family from model filename
  const getModelFamily = (modelName: string): string => {
    if (!modelName) return '-';
    const lower = modelName.toLowerCase();
    if (lower.includes('yolo11')) return 'YOLO11';
    if (lower.includes('yolo10')) return 'YOLO10';
    if (lower.includes('yolo9')) return 'YOLO9';
    if (lower.includes('yolo8')) return 'YOLO8';
    if (lower.includes('yolo5')) return 'YOLO5';
    if (lower.includes('yolo')) return 'YOLO';
    if (lower.includes('rtdetr') || lower.includes('rt-detr')) return 'RT-DETR';
    if (lower.includes('mask') || lower.includes('rcnn')) return 'Mask R-CNN';
    return 'YOLO';
  };

  // Helper function to extract model size from model filename
  const getModelSize = (modelName: string): string => {
    if (!modelName) return '-';
    const lower = modelName.toLowerCase();
    
    // YOLO sizes (nano, small, medium, large, x-large)
    if (lower.includes('yolo')) {
      // Match patterns like: yolo11n, yolov8s, yolo11n-seg, yolov8m-cls, etc.
      const match = modelName.match(/yolo(?:v?\d+)?([nsmxl])(?:-|\.)/i);
      if (match) {
        const size = match[1].toLowerCase();
        const sizeMap: Record<string, string> = {
          'n': 'Nano',
          's': 'Small',
          'm': 'Medium',
          'l': 'Large',
          'x': 'X-Large'
        };
        return sizeMap[size] || size.toUpperCase();
      }
    }
    
    // RT-DETR sizes
    if (lower.includes('rtdetr') || lower.includes('rt-detr')) {
      // Check for L/X sizes (with or without .pt extension)
      if (lower.match(/rtdetr-l(\.|$)/)) return 'L';
      if (lower.match(/rtdetr-x(\.|$)/)) return 'X';
    }
    
    return '-';
  };

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

  const handleDuplicate = async (datasetId: number) => {
    console.log('🚀🚀🚀 DUPLICATE BUTTON CLICKED IN DETAIL PAGE! 🚀🚀🚀');
    console.log('datasetId:', datasetId, 'api exists:', !!api);
    
    if (!datasetId || !api) {
      console.error('❌ No dataset ID or API available for duplication');
      console.error('datasetId:', datasetId, 'api:', !!api);
      return;
    }
    
    try {
      console.log('✅ Setting loading and calling duplicate API');
      setIsLoading(true);
      const response = await api.duplicateDataset(datasetId);
      
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to duplicate dataset');
      }

      const responseData = response.data;
      
      console.log('🔍 Duplicate response data:', responseData);
      console.log('🔍 Has task_id?', !!responseData.task_id);
      
      // Check if it's a background task response
      if (responseData.task_id) {
        // Background task started - show prominent notification
        console.log('🎉 SHOWING TOAST NOTIFICATION NOW!');
        toast({
          title: "✨ Duplication Started",
          description: `Dataset duplication is running in background. Check the tasks panel for progress.`,
          duration: 5000,
        });
        
        console.log('Background task started with ID:', responseData.task_id);
        
        // Poll task status to navigate when complete
        const pollInterval = setInterval(async () => {
          try {
            const taskResponse = await api.getTask(responseData.task_id);
            if (taskResponse.success && taskResponse.data) {
              const taskData = taskResponse.data as any;
              
              if (taskData.status === 'completed') {
                clearInterval(pollInterval);
                const newDatasetId = taskData.task_metadata?.new_dataset_id;
                
                toast({
                  title: "✅ Dataset Duplicated",
                  description: `Successfully created a copy of the dataset!`,
                  duration: 4000,
                });
                
                // Navigate to the project datasets page
                setTimeout(() => {
                  if (id) {
                    navigate(`/projects/${id}/datasets`);
                  } else {
                    navigate(`/`);
                  }
                }, 500);
              } else if (taskData.status === 'failed') {
                clearInterval(pollInterval);
                toast({
                  title: "❌ Duplication Failed",
                  description: taskData.error_message || "Dataset duplication failed",
                  variant: "destructive",
                });
              }
            }
          } catch (error) {
            console.error('Error polling task status:', error);
          }
        }, 2000); // Poll every 2 seconds
        
        // Stop polling after 5 minutes
        setTimeout(() => clearInterval(pollInterval), 300000);
      } else {
        // Synchronous response (fallback mode)
        const duplicatedDataset = responseData;
        
        toast({
          title: "✅ Dataset Duplicated",
          description: `Dataset has been duplicated successfully.`,
        });
        
        if (id) {
          navigate(`/projects/${id}/datasets`);
        } else {
          navigate(`/`);
        }
      }
    } catch (error) {
      console.error('Error duplicating dataset:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to duplicate dataset. Please try again.",
        variant: "destructive",
      });
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
  }, [id, projectMode, api, isConnected]); // Removed toast from dependencies

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
    
    return result;
  };

  // Auto-expand groups when searching or filtering - moved to useEffect
  useEffect(() => {
    if (searchQuery || selectedTag) {
      const result = [...datasetGroups];
      let filteredResult = result;
      
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filteredResult = filteredResult.filter(group => {
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
        filteredResult = filteredResult.filter(group =>
          group.datasets.some(dataset => 
            dataset.tags && dataset.tags.includes(selectedTag)
          )
        );
      }
      
      const groupsWithMatches = filteredResult.filter(group =>
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
  }, [searchQuery, selectedTag, datasetGroups, expandedGroups]);

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
                  <Button variant="outline" onClick={() => handleDuplicate(datasets[0].id)} disabled={isLoading}>
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

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6">
            <TabsTrigger value="datasets" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Datasets
            </TabsTrigger>
            <TabsTrigger value="models" className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Models
            </TabsTrigger>
            <TabsTrigger value="predictions" className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Model Evaluation
            </TabsTrigger>
          </TabsList>

          <TabsContent value="datasets" className="space-y-6">
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
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="whitespace-nowrap ml-2"
                  onClick={() => setShowMergeModal(true)}
                  disabled={!project?.datasets || project.datasets.length < 2}
                  title={!project?.datasets || project.datasets.length < 2 ? "Need at least 2 datasets to merge" : "Merge datasets"}
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
          </TabsContent>

          <TabsContent value="models" className="space-y-6">
            {/* Models Section Header */}
            <div className="flex items-center gap-2 mb-6">
              <Brain className="h-5 w-5 text-primary" />
              <h3 className="text-xl font-semibold">Project Models</h3>
              <Badge variant="secondary" className="ml-2">
                {trainingTasks.filter(t => t.task_type !== 'model_evaluation').length} models
              </Badge>
            </div>
            
            {/* Search and Filter Controls for Models */}
            <div className="flex flex-col sm:flex-row gap-4 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search models by name, type or performance..."
                  className="pl-9"
                  value={modelsSearchQuery}
                  onChange={(e) => setModelsSearchQuery(e.target.value)}
                />
              </div>
              
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="text-muted-foreground h-4 w-4" />
                <Select value={modelsSortOrder} onValueChange={(value) => setModelsSortOrder(value as any)}>
                  <SelectTrigger className="min-w-[180px]">
                    <SelectValue placeholder="Sort by" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                    <SelectItem value="name">Name (A-Z)</SelectItem>
                    <SelectItem value="accuracy">Best accuracy</SelectItem>
                    <SelectItem value="performance">Best performance</SelectItem>
                  </SelectContent>
                </Select>
                
                <Button 
                  variant="default" 
                  size="sm" 
                  className="whitespace-nowrap ml-2"
                  onClick={() => setShowTrainModelModal(true)}
                >
                  <Brain className="w-4 h-4 mr-2" />
                  Train Model
                </Button>

                <Button 
                  variant="outline" 
                  size="sm" 
                  className="whitespace-nowrap ml-2"
                  onClick={() => setShowAutoAnnotateModal(true)}
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  Auto-Annotate
                </Button>
                
                {trainingTasks.filter(t => t.status === 'failed' && t.task_type !== 'model_evaluation').length > 0 && (
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    className="whitespace-nowrap ml-2"
                    onClick={handleDeleteFailedTasks}
                    disabled={deletingFailedTasks}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    {deletingFailedTasks ? 'Deleting...' : `Delete Failed Tasks (${trainingTasks.filter(t => t.status === 'failed' && t.task_type !== 'model_evaluation').length})`}
                  </Button>
                )}
              </div>
            </div>

            {loadingTasks ? (
              <div className="text-center py-16">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                <p className="text-muted-foreground mt-4">Loading training tasks...</p>
              </div>
            ) : !isConnected ? (
              <div className="text-center py-16">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
                <h3 className="text-lg font-medium mb-2">API Connection Error</h3>
                <p className="text-muted-foreground mb-6">
                  Unable to connect to the backend server. Please check your API settings and ensure the server is running.
                </p>
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    Retry
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/settings">Check Settings</Link>
                  </Button>
                </div>
              </div>
            ) : trainingTasks.filter(t => t.task_type !== 'model_evaluation').length > 0 ? (
              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Started</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Progress</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Model</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Size</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Epochs</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-gray-950 divide-y divide-gray-800">
                    {trainingTasks.filter(t => t.task_type !== 'model_evaluation').map((task) => {
                      const metadata = task.task_metadata || {};
                      const isRunning = task.status === 'running';
                      const isFailed = task.status === 'failed';
                      const isCompleted = task.status === 'completed';
                      
                      return (
                        <tr 
                          key={task.id} 
                          className="hover:bg-gray-900 transition-colors cursor-pointer"
                          onClick={() => {
                            // Use evaluation modal for evaluation tasks, training modal for training tasks
                            setSelectedTaskId(task.id);
                          }}
                        >
                          <td className="px-4 py-3 text-sm text-gray-300">#{task.id}</td>
                          <td className="px-4 py-3 text-sm text-gray-200">{task.name}</td>
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {new Date(task.created_at).toLocaleString('en-GB', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {isRunning && (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                Running
                              </span>
                            )}
                            {isFailed && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTaskError({ name: task.name, error: task.error_message || 'Unknown error', id: task.id });
                                }}
                                className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 cursor-pointer transition-colors"
                              >
                                Failed
                              </button>
                            )}
                            {isCompleted && (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                                Completed
                              </span>
                            )}
                            {task.status === 'pending' && (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
                                Pending
                              </span>
                            )}
                            {task.status === 'stopped' && (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30">
                                Stopped
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 max-w-[120px]">
                                <div className="w-full bg-gray-800 rounded-full h-2">
                                  <div
                                    className={`h-2 rounded-full transition-all ${
                                      isFailed ? 'bg-red-500' : 
                                      isCompleted ? 'bg-green-500' : 
                                      task.status === 'stopped' ? 'bg-orange-500' : 
                                      'bg-blue-500'
                                    }`}
                                    style={{ width: `${task.progress}%` }}
                                  />
                                </div>
                              </div>
                              <span className="text-xs text-gray-400 min-w-[35px]">{task.progress}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {(() => {
                              // For evaluation tasks, show "Evaluation"
                              if (task.task_type === 'model_evaluation') {
                                return 'Evaluation';
                              }
                              // For training tasks
                              const modelName = metadata.model_config?.model || metadata.model_type || '';
                              const family = getModelFamily(modelName);
                              // Show just the base model type (YOLO, RT-DETR, etc.) without version
                              if (family.includes('YOLO')) return 'YOLO';
                              if (family.includes('DETR')) return 'RT-DETR';
                              return family;
                            })()}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {(() => {
                              // For evaluation tasks, show checkpoint type
                              if (task.task_type === 'model_evaluation') {
                                return metadata.checkpoint || 'best';
                              }
                              // For training tasks
                              const modelName = metadata.model_config?.model || metadata.model_variant || metadata.model_type || '';
                              const family = getModelFamily(modelName);
                              const size = getModelSize(modelName);
                              return size !== '-' ? size : family;
                            })()}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-400">
                            {(() => {
                              // For evaluation tasks, show images processed
                              if (task.task_type === 'model_evaluation') {
                                if (isCompleted && metadata.results?.images_processed) {
                                  return `${metadata.results.images_processed} imgs`;
                                }
                                return '-';
                              }
                              // For training tasks, show epochs
                              // Show current/total epochs if running, or last epoch if stopped/completed/failed
                              if (isRunning && metadata.current_epoch && metadata.epochs) {
                                return `${metadata.current_epoch}/${metadata.epochs}`;
                              } else if ((isCompleted || isFailed || task.status === 'stopped') && metadata.current_epoch) {
                                // Show last epoch reached
                                return metadata.current_epoch;
                              } else if (metadata.training_params?.epochs || metadata.epochs) {
                                return metadata.training_params?.epochs || metadata.epochs;
                              }
                              return '-';
                            })()}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTaskCommand({ name: task.name, command: generateTrainingCommand(task), id: task.id });
                                }}
                                className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                                title="View CLI command"
                              >
                                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                CLI
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingTask({ id: task.id, name: task.name });
                                  setNewTaskName(task.name);
                                }}
                                className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                                title="Rename task"
                              >
                                <Pencil className="w-3 h-3 mr-1" />
                                Rename
                              </button>
                              {(isRunning || task.status === 'pending') && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!confirm(`Are you sure you want to stop training task "${task.name}"?`)) {
                                      return;
                                    }
                                    try {
                                      const response = await fetch(`http://localhost:9999/tasks/${task.id}/cancel`, {
                                        method: 'PATCH'
                                      });
                                      if (response.ok) {
                                        toast({
                                          title: "Training Stopped",
                                          description: `Task "${task.name}" has been cancelled.`
                                        });
                                        fetchTrainingTasks();
                                      } else {
                                        throw new Error('Failed to cancel task');
                                      }
                                    } catch (error) {
                                      toast({
                                        title: "Error",
                                        description: "Failed to stop training task",
                                        variant: "destructive"
                                      });
                                    }
                                  }}
                                  className="inline-flex items-center px-2.5 py-1 rounded text-xs font-medium bg-red-800 text-red-300 border border-red-700 hover:bg-red-700 hover:text-white transition-colors"
                                  title="Stop training"
                                >
                                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  Stop
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-16">
                <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No models found</h3>
                <p className="text-muted-foreground mb-6">
                  This project doesn't have any trained models yet. Train your first model to get started.
                </p>
                <Button variant="outline" onClick={() => setShowTrainModelModal(true)}>
                  <Brain className="w-4 h-4 mr-2" />
                  Train Model
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="predictions" className="space-y-6">
            {/* Model Evaluation Section Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                <h3 className="text-xl font-semibold">Model Evaluation</h3>
                <Badge variant="secondary" className="ml-2">
                  {trainingTasks.filter(t => t.task_type === 'model_evaluation').length} evaluations
                </Badge>
              </div>
              
              <Button 
                variant="default" 
                size="sm" 
                className="whitespace-nowrap"
                onClick={() => setShowEvaluationModal(true)}
              >
                <Brain className="w-4 h-4 mr-2" />
                New Evaluation
              </Button>
            </div>

            {/* Evaluation Tasks Table */}
            {loadingTasks ? (
              <div className="text-center py-16">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                <p className="text-muted-foreground mt-4">Loading evaluation tasks...</p>
              </div>
            ) : !isConnected ? (
              <div className="text-center py-16">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
                <h3 className="text-lg font-medium mb-2">API Connection Error</h3>
                <p className="text-muted-foreground mb-6">
                  Unable to connect to the backend server. Please check your API settings and ensure the server is running.
                </p>
                <div className="flex gap-3 justify-center">
                  <Button variant="outline" onClick={() => window.location.reload()}>
                    Retry
                  </Button>
                  <Button variant="outline" asChild>
                    <Link to="/settings">Check Settings</Link>
                  </Button>
                </div>
              </div>
            ) : trainingTasks.filter(t => t.task_type === 'model_evaluation').length > 0 ? (
              <div className="border border-gray-800 rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-900 border-b border-gray-800">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider w-8"></th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Dataset</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Progress</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Model</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Images</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-gray-950 divide-y divide-gray-800">
                    {/* Filter to show only parent tasks and single dataset tasks (not child tasks) */}
                    {trainingTasks
                      .filter(t => t.task_type === 'model_evaluation' && !t.task_metadata?.parent_task_id)
                      .map((task) => {
                      const metadata = task.task_metadata || {};
                      const isRunning = task.status === 'running';
                      const isFailed = task.status === 'failed';
                      const isCompleted = task.status === 'completed';
                      const isMultiDataset = metadata.is_multi_dataset;
                      const childTaskIds = metadata.child_task_ids || [];
                      const isExpanded = expandedEvaluations.has(task.id);
                      
                      // Get child tasks for multi-dataset evaluations
                      const childTasks = isMultiDataset 
                        ? trainingTasks.filter(t => childTaskIds.includes(t.id))
                        : [];
                      
                      // Calculate aggregate progress for multi-dataset
                      const aggregateProgress = isMultiDataset && childTasks.length > 0
                        ? Math.round(childTasks.reduce((sum, ct) => sum + (ct.progress || 0), 0) / childTasks.length)
                        : task.progress;
                      
                      // Calculate aggregate status for multi-dataset
                      const getAggregateStatus = () => {
                        if (!isMultiDataset) return task.status;
                        if (childTasks.every(ct => ct.status === 'completed')) return 'completed';
                        if (childTasks.some(ct => ct.status === 'failed')) return 'partial_failed';
                        if (childTasks.some(ct => ct.status === 'running')) return 'running';
                        return task.status;
                      };
                      const aggregateStatus = getAggregateStatus();
                      
                      return (
                        <React.Fragment key={task.id}>
                          <tr 
                            className={`hover:bg-gray-900 transition-colors cursor-pointer ${isMultiDataset ? 'bg-gray-900/50' : ''}`}
                            onClick={() => {
                              if (isMultiDataset) {
                                // Toggle expansion for multi-dataset
                                setExpandedEvaluations(prev => {
                                  const newSet = new Set(prev);
                                  if (newSet.has(task.id)) {
                                    newSet.delete(task.id);
                                  } else {
                                    newSet.add(task.id);
                                  }
                                  return newSet;
                                });
                              } else {
                                setSelectedTaskId(task.id);
                              }
                            }}
                          >
                            {/* Expand/Collapse button for multi-dataset */}
                            <td className="px-2 py-3 text-sm text-gray-400">
                              {isMultiDataset && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedEvaluations(prev => {
                                      const newSet = new Set(prev);
                                      if (newSet.has(task.id)) {
                                        newSet.delete(task.id);
                                      } else {
                                        newSet.add(task.id);
                                      }
                                      return newSet;
                                    });
                                  }}
                                  className="p-0.5 hover:bg-gray-800 rounded"
                                >
                                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronDown className="w-4 h-4 -rotate-90" />}
                                </button>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-300">#{task.id}</td>
                            <td className="px-4 py-3 text-sm text-gray-200">
                              <div className="flex items-center gap-2">
                                {task.name}
                                {isMultiDataset && (
                                  <Badge variant="outline" className="text-xs">
                                    {childTaskIds.length} datasets
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-400">
                              {isMultiDataset 
                                ? `${metadata.dataset_names?.join(', ') || 'Multiple'}` 
                                : metadata.dataset_name || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {aggregateStatus === 'running' && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                  Running
                                </span>
                              )}
                              {aggregateStatus === 'failed' && (
                                <span 
                                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 cursor-pointer hover:bg-red-500/30"
                                  title="Click to see error details"
                                >
                                  Failed
                                </span>
                              )}
                              {aggregateStatus === 'partial_failed' && (
                                <span 
                                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400 border border-orange-500/30 cursor-pointer hover:bg-orange-500/30"
                                  title="Click to see error details"
                                >
                                  Partial
                                </span>
                              )}
                              {aggregateStatus === 'completed' && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                                  Completed
                                </span>
                              )}
                              {aggregateStatus === 'pending' && (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
                                  Pending
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 max-w-[120px]">
                                  <div className="w-full bg-gray-800 rounded-full h-2">
                                    <div
                                      className={`h-2 rounded-full transition-all ${
                                        aggregateStatus === 'failed' || aggregateStatus === 'partial_failed' ? 'bg-red-500' : 
                                        aggregateStatus === 'completed' ? 'bg-green-500' : 
                                        'bg-blue-500'
                                      }`}
                                      style={{ width: `${aggregateProgress}%` }}
                                    />
                                  </div>
                                </div>
                                <span className="text-xs text-gray-400 min-w-[35px]">{aggregateProgress}%</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-400">
                              {(() => {
                                const modelName = metadata.model_config?.model || metadata.model_type || '';
                                const family = getModelFamily(modelName);
                                if (family.includes('YOLO')) return 'YOLO';
                                if (family.includes('DETR')) return 'RT-DETR';
                                return family || 'Evaluation';
                              })()}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-400">
                              {isMultiDataset 
                                ? childTasks.filter(ct => ct.status === 'completed').reduce((sum, ct) => sum + (ct.task_metadata?.results?.images_processed || 0), 0)
                                : (isCompleted && metadata.results?.images_processed ? `${metadata.results.images_processed}` : '-')}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <div className="flex items-center gap-2">
                                {isMultiDataset && aggregateStatus === 'completed' && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      try {
                                        const response = await fetch(`http://localhost:9999/predictions/export-coco-all/${task.id}`);
                                        if (!response.ok) throw new Error('Failed to download');
                                        const blob = await response.blob();
                                        const url = window.URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = url;
                                        a.download = `evaluation_${task.id}_all_coco.zip`;
                                        document.body.appendChild(a);
                                        a.click();
                                        window.URL.revokeObjectURL(url);
                                        document.body.removeChild(a);
                                        toast({ title: "Download Complete", description: "All COCO files downloaded" });
                                      } catch (error) {
                                        toast({ title: "Download Failed", description: "Failed to download COCO files", variant: "destructive" });
                                      }
                                    }}
                                    className="inline-flex items-center p-1.5 rounded text-xs font-medium bg-green-800 text-green-300 border border-green-700 hover:bg-green-700 hover:text-white transition-colors"
                                    title="Download All COCO predictions"
                                  >
                                    <Database className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenamingTask({ id: task.id, name: task.name });
                                    setNewTaskName(task.name);
                                  }}
                                  className="inline-flex items-center p-1.5 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                                  title="Rename task"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!confirm(`Are you sure you want to delete evaluation task "${task.name}"${isMultiDataset ? ' and all its child evaluations' : ''}?`)) {
                                      return;
                                    }
                                    try {
                                      const response = await fetch(`http://localhost:9999/tasks/${task.id}`, {
                                        method: 'DELETE'
                                      });
                                      if (response.ok) {
                                        toast({
                                          title: "Task Deleted",
                                          description: `Evaluation task "${task.name}" has been deleted.`
                                        });
                                        fetchTrainingTasks();
                                      } else {
                                        throw new Error('Failed to delete task');
                                      }
                                    } catch (error) {
                                      toast({
                                        title: "Error",
                                        description: "Failed to delete evaluation task",
                                        variant: "destructive"
                                      });
                                    }
                                  }}
                                  className="inline-flex items-center p-1.5 rounded text-xs font-medium bg-red-800 text-red-300 border border-red-700 hover:bg-red-700 hover:text-white transition-colors"
                                  title="Delete task"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                          
                          {/* Child tasks for multi-dataset evaluations */}
                          {isMultiDataset && isExpanded && childTasks.map((childTask) => {
                            const childMetadata = childTask.task_metadata || {};
                            const childIsRunning = childTask.status === 'running';
                            const childIsFailed = childTask.status === 'failed';
                            const childIsCompleted = childTask.status === 'completed';
                            
                            return (
                              <tr 
                                key={childTask.id}
                                className="hover:bg-gray-900 transition-colors cursor-pointer bg-gray-900/30"
                                onClick={() => setSelectedTaskId(childTask.id)}
                              >
                                <td className="px-2 py-2"></td>
                                <td className="px-4 py-2 text-sm text-gray-400 pl-8">└ #{childTask.id}</td>
                                <td className="px-4 py-2 text-sm text-gray-300">{childMetadata.dataset_name || 'Unknown'}</td>
                                <td className="px-4 py-2 text-sm text-gray-400">{childMetadata.dataset_name || '-'}</td>
                                <td className="px-4 py-2 text-sm">
                                  {childIsRunning && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                      Running
                                    </span>
                                  )}
                                  {childIsFailed && (
                                    <span 
                                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/30 cursor-pointer hover:bg-red-500/30"
                                      title="Click to see error details"
                                    >
                                      Failed
                                    </span>
                                  )}
                                  {childIsCompleted && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400 border border-green-500/30">
                                      Completed
                                    </span>
                                  )}
                                  {childTask.status === 'pending' && (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400 border border-gray-500/30">
                                      Pending
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2 text-sm">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 max-w-[100px]">
                                      <div className="w-full bg-gray-800 rounded-full h-1.5">
                                        <div
                                          className={`h-1.5 rounded-full transition-all ${
                                            childIsFailed ? 'bg-red-500' : 
                                            childIsCompleted ? 'bg-green-500' : 
                                            'bg-blue-500'
                                          }`}
                                          style={{ width: `${childTask.progress}%` }}
                                        />
                                      </div>
                                    </div>
                                    <span className="text-xs text-gray-500">{childTask.progress}%</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2 text-sm text-gray-500">-</td>
                                <td className="px-4 py-2 text-sm text-gray-400">
                                  {childIsCompleted && childMetadata.results?.images_processed 
                                    ? childMetadata.results.images_processed 
                                    : '-'}
                                </td>
                                <td className="px-4 py-2 text-sm">
                                  <div className="flex items-center gap-1">
                                    {childIsCompleted && (
                                      <button
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          try {
                                            const response = await fetch(`http://localhost:9999/predictions/export-coco/${childTask.id}`);
                                            if (!response.ok) throw new Error('Failed to download');
                                            const blob = await response.blob();
                                            const url = window.URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = `evaluation_${childTask.id}_coco.json`;
                                            document.body.appendChild(a);
                                            a.click();
                                            window.URL.revokeObjectURL(url);
                                            document.body.removeChild(a);
                                          } catch (error) {
                                            toast({ title: "Error", description: "Failed to download COCO file", variant: "destructive" });
                                          }
                                        }}
                                        className="inline-flex items-center p-1 rounded text-xs bg-green-800/50 text-green-400 hover:bg-green-700 transition-colors"
                                        title="Download COCO predictions"
                                      >
                                        <Database className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-16">
                <Brain className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-medium mb-2">No Evaluations Yet</h3>
                <p className="text-muted-foreground mb-6">
                  Start evaluating your trained models to analyze their performance.
                </p>
                <Button onClick={() => setShowEvaluationModal(true)}>
                  <Brain className="w-4 h-4 mr-2" />
                  New Evaluation
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </section>
      
      {/* Modals */}
      {project && (
        <>
          <TrainModelModal
            open={showTrainModelModal}
            onOpenChange={(open) => {
              setShowTrainModelModal(open);
              if (!open) {
                // Refresh training tasks after modal closes
                setTimeout(() => fetchTrainingTasks(), 1000);
              }
            }}
            datasets={project?.datasets || []}
            datasetGroups={datasetGroups}
            projectId={id || ''}
          />

          <AutoAnnotateModal
            open={showAutoAnnotateModal}
            onOpenChange={(open) => {
              setShowAutoAnnotateModal(open);
              if (!open) {
                // Refresh training tasks after modal closes
                setTimeout(() => fetchTrainingTasks(), 1000);
              }
            }}
            datasetId={datasets[0]?.id || 0}
            datasetName={datasets[0]?.name || ''}
          />
          
          <CreateAugmentedDatasetModal
            open={showAugmentedModal}
            onOpenChange={setShowAugmentedModal}
            projectId={id || ''}
            datasets={project.datasets || []}
            datasetGroups={datasetGroups}
          />
          
          <MergeDatasetsModal
            open={showMergeModal}
            onOpenChange={setShowMergeModal}
            projectId={id || ''}
            datasets={project.datasets || []}
            onMergeComplete={() => {
              // Refresh the project data to show the new merged dataset
              window.location.reload();
            }}
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
          
          {/* Error Details Modal */}
          <Dialog open={!!selectedTaskError} onOpenChange={() => setSelectedTaskError(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                  Training Failed - Task #{selectedTaskError?.id}
                </DialogTitle>
                <DialogDescription>
                  {selectedTaskError?.name}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4">
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">Error Details:</h4>
                  <pre className="text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap font-mono">
                    {selectedTaskError?.error}
                  </pre>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* CLI Command Modal */}
          <Dialog open={!!selectedTaskCommand} onOpenChange={() => setSelectedTaskCommand(null)}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  CLI Commands - Task #{selectedTaskCommand?.id}
                </DialogTitle>
                <DialogDescription>
                  {selectedTaskCommand?.name}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Copy and paste these commands in your terminal to run training without the GUI:
                </p>
                <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <pre className="text-xs text-gray-800 dark:text-gray-200 whitespace-pre-wrap font-mono overflow-x-auto">
                    {selectedTaskCommand?.command}
                  </pre>
                </div>
                <Button
                  onClick={() => {
                    if (selectedTaskCommand?.command) {
                      navigator.clipboard.writeText(selectedTaskCommand.command);
                    }
                  }}
                  className="w-full"
                >
                  Copy All Commands
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Rename Task Modal */}
          <Dialog open={!!renamingTask} onOpenChange={() => setRenamingTask(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Pencil className="w-5 h-5" />
                  Rename Training Task
                </DialogTitle>
                <DialogDescription>
                  Task #{renamingTask?.id}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-4">
                <div>
                  <Label htmlFor="taskName">Task Name</Label>
                  <Input
                    id="taskName"
                    value={newTaskName}
                    onChange={(e) => setNewTaskName(e.target.value)}
                    placeholder="Enter new task name"
                    className="mt-2"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="outline"
                    onClick={() => setRenamingTask(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={async () => {
                      if (!renamingTask || !newTaskName.trim()) return;
                      
                      try {
                        const response = await fetch(`http://localhost:9999/tasks/${renamingTask.id}`, {
                          method: 'PATCH',
                          headers: {
                            'Content-Type': 'application/json',
                          },
                          body: JSON.stringify({
                            name: newTaskName.trim()
                          })
                        });
                        
                        if (response.ok) {
                          toast({
                            title: "Task Renamed",
                            description: `Task renamed to "${newTaskName.trim()}"`
                          });
                          setRenamingTask(null);
                          fetchTrainingTasks();
                        } else {
                          throw new Error('Failed to rename task');
                        }
                      } catch (error) {
                        toast({
                          title: "Error",
                          description: "Failed to rename task",
                          variant: "destructive"
                        });
                      }
                    }}
                    disabled={!newTaskName.trim() || newTaskName.trim() === renamingTask?.name}
                  >
                    Rename
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Training/Evaluation Details Modals */}
          {selectedTaskId && (() => {
            const selectedTask = trainingTasks.find(t => t.id === selectedTaskId);
            const isEvaluation = selectedTask?.task_type === 'model_evaluation';
            
            return isEvaluation ? (
              <EvaluationDetailsModal
                open={true}
                onOpenChange={(open) => !open && setSelectedTaskId(null)}
                taskId={selectedTaskId}
              />
            ) : (
              <TrainingDetailsModal
                open={true}
                onOpenChange={(open) => !open && setSelectedTaskId(null)}
                taskId={selectedTaskId}
              />
            );
          })()}

          {/* Evaluate Model Modal */}
          <EvaluateModelModal
            open={showEvaluationModal}
            onOpenChange={setShowEvaluationModal}
            trainingTasks={trainingTasks}
            projectId={id || ''}
            datasets={datasets}
            datasetGroups={datasetGroups}
            onEvaluate={async (params) => {
              try {
                const response = await fetch('http://localhost:9999/predictions/evaluate', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    task_id: params.taskId,
                    dataset_id: params.datasetId,
                    annotation_file_id: params.annotationFileId,
                    checkpoint: params.checkpoint,
                    conf_threshold: params.confThreshold,
                    iou_threshold: params.iouThreshold,
                    evaluation_name: params.evaluationName || null,
                    use_grid: params.useGrid,
                    grid_size: params.gridSize,
                    grid_overlap: params.gridOverlap,
                    ignored_classes: params.ignoredClasses || []
                  })
                });

                if (!response.ok) {
                  let errorMessage = 'Evaluation failed';
                  try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorData.message || errorMessage;
                  } catch (e) {
                    const errorText = await response.text();
                    if (errorText) errorMessage = errorText;
                  }
                  throw new Error(errorMessage);
                }

                const data = await response.json();
                
                toast({
                  title: "Evaluation Started",
                  description: `Task "${data.task_name}" has been created. Check the Predictions tab for progress.`
                });
                
                // Refresh tasks and switch to predictions tab
                await fetchTrainingTasks();
                handleTabChange('predictions');
              } catch (error) {
                console.error('Error evaluating model:', error);
                toast({
                  title: "Evaluation Failed",
                  description: error instanceof Error ? error.message : "An error occurred",
                  variant: "destructive"
                });
                throw error;
              }
            }}
            onEvaluateMultiple={async (params) => {
              try {
                console.log('[DatasetDetail] onEvaluateMultiple called with params:', params);
                console.log('[DatasetDetail] Datasets to evaluate:', params.datasets);
                
                const requestBody = {
                  task_id: params.taskId,
                  datasets: params.datasets,
                  checkpoint: params.checkpoint,
                  conf_threshold: params.confThreshold,
                  iou_threshold: params.iouThreshold,
                  evaluation_name: params.evaluationName || null,
                  use_grid: params.useGrid,
                  grid_size: params.gridSize,
                  grid_overlap: params.gridOverlap,
                  ignored_classes: params.ignoredClasses || []
                };
                console.log('[DatasetDetail] Request body:', JSON.stringify(requestBody, null, 2));
                
                const response = await fetch('http://localhost:9999/predictions/evaluate-multiple', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                  let errorMessage = 'Multi-dataset evaluation failed';
                  try {
                    const errorData = await response.json();
                    errorMessage = errorData.detail || errorData.message || errorMessage;
                  } catch (e) {
                    const errorText = await response.text();
                    if (errorText) errorMessage = errorText;
                  }
                  throw new Error(errorMessage);
                }

                const data = await response.json();
                
                toast({
                  title: "Multi-Dataset Evaluation Started",
                  description: `Task "${data.task_name}" has been created with ${data.child_task_ids?.length || 0} dataset evaluations.`
                });
                
                // Refresh tasks and switch to predictions tab
                await fetchTrainingTasks();
                handleTabChange('predictions');
              } catch (error) {
                console.error('Error evaluating model on multiple datasets:', error);
                toast({
                  title: "Evaluation Failed",
                  description: error instanceof Error ? error.message : "An error occurred",
                  variant: "destructive"
                });
                throw error;
              }
            }}
          />
        </>
      )}
    </div>
  );
};

export default DatasetDetail;
