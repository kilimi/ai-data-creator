
import React from 'react';
import { useLocation } from 'react-router-dom';
import { DatasetForm } from '@/components/DatasetForm';

interface CreateDatasetProps {
  projectMode?: boolean;
}

const CreateDataset = ({ projectMode = false }: CreateDatasetProps) => {
  const location = useLocation();
  const projectId = location.state?.projectId;

  return (
    <DatasetForm 
      mode="create" 
      projectMode={projectMode}
      projectId={projectId}
    />
  );
};

export default CreateDataset;
