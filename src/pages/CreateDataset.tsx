
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DatasetForm } from '@/components/DatasetForm';
import { useToast } from '@/hooks/use-toast';
import { DatasetFormValues } from '@/types';

interface CreateDatasetProps {
  projectMode?: boolean;
}

const CreateDataset = ({ projectMode = false }: CreateDatasetProps) => {
  const location = useLocation();
  const projectId = location.state?.projectId;
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSubmit = (data: DatasetFormValues, logoFile?: File) => {
    // Simulate API call to create dataset
    setTimeout(() => {
      toast({
        title: "Dataset created",
        description: `${data.name} has been created successfully.`,
      });
      
      if (projectMode && projectId) {
        navigate(`/projects/${projectId}`);
      } else {
        navigate('/datasets');
      }
    }, 1500);
  };

  return (
    <DatasetForm 
      mode="create" 
      projectMode={projectMode}
      projectId={projectId}
      onSubmit={handleSubmit}
    />
  );
};

export default CreateDataset;
