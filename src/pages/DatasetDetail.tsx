import React from 'react';

interface DatasetDetailProps {
  projectMode?: boolean;
}

const DatasetDetail = ({ projectMode = false }: DatasetDetailProps) => {
  return (
    <div>
      <h1>Dataset Detail{projectMode ? ' (Project Mode)' : ''}</h1>
      {/* Component content */}
    </div>
  );
};

export default DatasetDetail;
