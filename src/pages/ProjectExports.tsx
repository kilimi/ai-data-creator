import React, { useState, useEffect } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { ExportModelModal } from '@/components/ExportModelModal';
import { ExportDetailsModal } from '@/components/ExportDetailsModal';
import { TestInferenceModal } from '@/components/TestInferenceModal';
import { AlertCircle, Download, Brain, Trash2, Pencil, Search, SlidersHorizontal, TestTube } from "lucide-react";
import { Project } from '@/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface OutletContext {
  project: Project | null;
  loading: boolean;
}

export default function ProjectExports() {
  const { id } = useParams<{ id: string }>();
  const { project } = useOutletContext<OutletContext>();
  const { isConnected } = useApi();
  const { toast } = useToast();
  
  const [trainingTasks, setTrainingTasks] = useState<any[]>([]);
  const [exportTasks, setExportTasks] = useState<any[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "name">("newest");
  const [renamingTask, setRenamingTask] = useState<{ id: number; name: string } | null>(null);
  const [newTaskName, setNewTaskName] = useState('');
  const [testInference, setTestInference] = useState<{ id: number; onnxFilePath: string } | null>(null);

  // Fetch all tasks
  const fetchTasks = async () => {
    if (!id) return;
    
    setLoadingTasks(true);
    try {
      const response = await fetch(`http://localhost:9999/tasks/?project_id=${id}`);
      if (response.ok) {
        const data = await response.json();
        // Separate training and export tasks
        setTrainingTasks(data.filter((t: any) => t.task_type === 'yolo_training' && t.status === 'completed'));
        setExportTasks(data.filter((t: any) => t.task_type === 'model_export'));
      }
    } catch (error) {
      console.error('Error fetching tasks:', error);
    } finally {
      setLoadingTasks(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    
    // Polling for running tasks
    const interval = setInterval(() => {
      if (exportTasks.some(t => t.status === 'running' || t.status === 'pending')) {
        fetchTasks();
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [id]);

  const handleRenameTask = async (taskId: number) => {
    if (!newTaskName.trim()) return;
    
    try {
      const response = await fetch(`http://localhost:9999/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTaskName.trim() })
      });
      
      if (response.ok) {
        toast({
          title: "Success",
          description: "Task renamed successfully",
        });
        setRenamingTask(null);
        setNewTaskName('');
        fetchTasks();
      } else {
        throw new Error('Failed to rename task');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to rename task",
        variant: "destructive",
      });
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      const response = await fetch(`http://localhost:9999/tasks/${taskId}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        toast({
          title: "Success",
          description: "Export task deleted successfully",
        });
        fetchTasks();
      } else {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete task');
      }
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete export task",
        variant: "destructive",
      });
    }
  };

  // Filter and sort export tasks
  const filteredAndSortedTasks = exportTasks
    .filter(task => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        task.name?.toLowerCase().includes(query) ||
        task.task_metadata?.export_format?.toLowerCase().includes(query) ||
        task.task_metadata?.original_task_name?.toLowerCase().includes(query)
      );
    })
    .sort((a, b) => {
      switch (sortOrder) {
        case "newest":
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "oldest":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "name":
          return (a.name || '').localeCompare(b.name || '');
        default:
          return 0;
      }
    });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default" className="bg-green-600">Completed</Badge>;
      case 'running':
        return <Badge variant="default" className="bg-blue-600">Running</Badge>;
      case 'pending':
        return <Badge variant="secondary">Pending</Badge>;
      case 'failed':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '-';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Download className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Model Conversions</h1>
          <Badge variant="secondary" className="ml-2">
            {exportTasks.length} conversions
          </Badge>
        </div>
        
        <Button 
          variant="default" 
          size="sm" 
          className="whitespace-nowrap"
          onClick={() => setShowExportModal(true)}
        >
          <Download className="w-4 h-4 mr-2" />
          Convert Model
        </Button>
      </div>

      {/* Search and Filter Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search conversions by name or format..."
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
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Content */}
      {loadingTasks ? (
        <div className="text-center py-16">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground mt-4">Loading export tasks...</p>
        </div>
      ) : !isConnected ? (
        <div className="text-center py-16">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
          <h3 className="text-lg font-medium mb-2">API Connection Error</h3>
          <p className="text-muted-foreground mb-6">
            Unable to connect to the backend server. Please check your API settings.
          </p>
        </div>
      ) : filteredAndSortedTasks.length > 0 ? (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-900 border-b border-gray-800">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Model</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Format</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Progress</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">File Size</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {filteredAndSortedTasks.map((task) => {
                const metadata = task.task_metadata || {};
                const progress = task.progress || 0;
                const exportedFile = metadata.exported_file;
                const fileSize = metadata.file_size;
                
                return (
                  <tr 
                    key={task.id} 
                    className="hover:bg-gray-900/50 cursor-pointer"
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <td className="px-4 py-3 text-sm text-gray-300">{task.id}</td>
                    <td className="px-4 py-3 text-sm font-medium text-white">
                      {task.name || `Export #${task.id}`}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {metadata.original_task_name || `Task ${metadata.training_task_id}`}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400 uppercase">
                      {metadata.export_format || 'ONNX'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTaskId(task.id);
                        }}
                        className="hover:opacity-80 transition-opacity"
                      >
                        {getStatusBadge(task.status)}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {task.status === 'running' ? (
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-gray-700 rounded-full h-2">
                            <div 
                              className="bg-primary h-2 rounded-full transition-all"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs">{progress}%</span>
                        </div>
                      ) : (
                        <span>{progress}%</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {fileSize ? formatFileSize(fileSize) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {new Date(task.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        {task.status === 'completed' && exportedFile && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setTestInference({ id: task.id, onnxFilePath: exportedFile });
                              }}
                              className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-green-800 text-green-300 border border-green-700 hover:bg-green-700 hover:text-white transition-colors"
                              title="Test inference"
                            >
                              <TestTube className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(`http://localhost:9999/export/download/${task.id}`, '_blank');
                              }}
                              className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-blue-800 text-blue-300 border border-blue-700 hover:bg-blue-700 hover:text-white transition-colors"
                              title="Download exported model"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingTask({ id: task.id, name: task.name });
                            setNewTaskName(task.name);
                          }}
                          className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700 hover:text-white transition-colors"
                          title="Rename export"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Are you sure you want to delete "${task.name || `Export #${task.id}`}"? ${task.status === 'running' || task.status === 'pending' ? 'This will cancel the task if it is running.' : ''}`)) {
                              handleDeleteTask(task.id);
                            }
                          }}
                          className="inline-flex items-center justify-center w-8 h-8 rounded text-xs font-medium bg-red-800 text-red-300 border border-red-700 hover:bg-red-700 hover:text-white transition-colors"
                          title="Delete export"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
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
          <Download className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">No exports found</h3>
          <p className="text-muted-foreground mb-6">
            {searchQuery 
              ? "No exports match your search criteria"
              : "You haven't converted any models yet. Convert your first model to get started."
            }
          </p>
          {!searchQuery && (
            <Button onClick={() => setShowExportModal(true)}>
              <Download className="w-4 h-4 mr-2" />
              Create Export
            </Button>
          )}
        </div>
      )}

      {/* Export Modal */}
      <ExportModelModal
        open={showExportModal}
        onOpenChange={setShowExportModal}
        trainingTasks={trainingTasks}
        projectId={id || ''}
        onExportComplete={() => {
          fetchTasks();
        }}
      />

      {/* Export Details Modal */}
      {selectedTaskId && (
        <ExportDetailsModal
          open={!!selectedTaskId}
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null);
          }}
          taskId={selectedTaskId}
        />
      )}

      {/* Test Inference Modal */}
      {testInference && (
        <TestInferenceModal
          open={!!testInference}
          onOpenChange={(open) => {
            if (!open) setTestInference(null);
          }}
          onnxFilePath={testInference.onnxFilePath}
          taskId={testInference.id}
        />
      )}

      {/* Rename Dialog */}
      <Dialog open={!!renamingTask} onOpenChange={(open) => {
        if (!open) {
          setRenamingTask(null);
          setNewTaskName('');
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Export Task</DialogTitle>
            <DialogDescription>
              Enter a new name for this export task.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Task Name</label>
              <Input
                value={newTaskName}
                onChange={(e) => setNewTaskName(e.target.value)}
                placeholder="Enter task name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && renamingTask) {
                    handleRenameTask(renamingTask.id);
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenamingTask(null);
                setNewTaskName('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => renamingTask && handleRenameTask(renamingTask.id)}
              disabled={!newTaskName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
