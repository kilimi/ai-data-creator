
import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/Navbar";
import { useProject } from '@/hooks/use-projects';
import { DatasetCard, DatasetCardSkeleton } from '@/components/DatasetCard';
import { FolderPlus, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/card";

interface DatasetDetailProps {
  projectMode?: boolean;
}

const DatasetDetail = ({ projectMode = false }: DatasetDetailProps) => {
  const { id } = useParams<{ id: string }>();
  const { project, loading, error } = useProject(id || '');

  if (!projectMode) {
    return (
      <div>
        <h1>Dataset Detail Page</h1>
        {/* This would be for individual dataset view */}
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
            <Link to="/datasets/new" state={{ projectId: id }}>
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
        ) : project.datasets.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {project.datasets.map(dataset => (
              <DatasetCard key={dataset.id} dataset={dataset} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <h3 className="text-lg font-medium mb-2">No datasets found</h3>
            <p className="text-muted-foreground mb-6">
              This project doesn't have any datasets yet.
            </p>
            <Button asChild>
              <Link to="/datasets/new" state={{ projectId: id }}>
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
