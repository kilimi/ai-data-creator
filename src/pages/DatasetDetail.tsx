import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/Navbar";
import { useProject } from '@/hooks/use-projects';
import { useApi } from '@/hooks/use-api';
import { useToast } from '@/hooks/use-toast';
import { DatasetCard, DatasetCardSkeleton } from '@/components/DatasetCard';
import { FolderPlus, ArrowLeft, Copy, Pencil, Trash2, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Dataset } from '@/types';

interface DatasetDetailProps {
  projectMode?: boolean;
}

const DatasetDetail = ({ projectMode = false }: DatasetDetailProps) => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { project, loading, error } = useProject(id || '');
  const { api } = useApi();
  const { toast } = useToast();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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

      setDatasets(prevDatasets => prevDatasets.filter(d => d.id !== dataset.id));
      
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
      if (!projectMode && id && api) {
        try {
          setIsLoading(true);
          const response = await api.getDataset(id);
          if (response.success && response.data) {
            setDatasets([response.data]);
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
      }
    };

    fetchDataset();
  }, [id, projectMode, api]);

  if (!projectMode) {
    return (
      <div className="min-h-screen pb-16">
        <Navbar />
        <section className="container max-w-6xl pt-24 pb-6">
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
              <DatasetCard dataset={datasets[0]} />
              
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
      
      <section className="container max-w-6xl pt-24 pb-6">
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
          
          <Button 
            variant="default" 
            size="sm" 
            asChild
            className="whitespace-nowrap"
          >
            <Link 
              to="/projects/new/dataset" 
              state={{ projectId: id ? parseInt(id, 10) : undefined }}
            >
              <FolderPlus className="w-4 h-4 mr-2" />
              Create New Dataset
            </Link>
          </Button>
        </div>
        
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
        ) : project.datasets && project.datasets.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {project.datasets.map(dataset => (
              <DatasetCard 
                key={dataset.id} 
                dataset={dataset}
                onDelete={handleDeleteDataset}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <h3 className="text-lg font-medium mb-2">No datasets found</h3>
            <p className="text-muted-foreground mb-6">
              This project doesn't have any datasets yet.
            </p>
            <Button asChild>
              <Link 
                to="/projects/new/dataset" 
                state={{ projectId: id ? parseInt(id, 10) : undefined }}
              >
                <FolderPlus className="w-4 h-4 mr-2" />
                Create your first dataset
              </Link>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
};

export default DatasetDetail;
