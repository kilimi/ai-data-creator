
import React, { useMemo, useState } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ImagesTabContent } from '@/components/ImagesTabContent';
import { AnnotationsContent } from '@/components/AnnotationsContent';
import { Image } from '@/types';
import { AnnotationSample } from '@/utils/annotations';
import { LayoutType } from './LayoutControls';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ResizableDatasetLayoutProps {
  layout: LayoutType;
  id: string;
  images: Image[];
  currentPage: number;
  imagesPerPage: number;
  imageSize: number;
  sliderPosition: number;
  onImagesPerPageChange: (value: number) => void;
  onImageSizeChange: (value: number[]) => void;
  onSliderPositionChange: (value: number) => void;
  onPageChange: (page: number) => void;
  onOpenUploadDialog: () => void;
  onDeleteImage: (imageId: string) => Promise<void>;
  paginatedImages: Image[];
  totalPages: number;
  annotations?: AnnotationSample[];
  onImportAnnotations?: (files: File[]) => void;
  onShowAnnotationsChange?: (show: boolean, annotations: AnnotationSample[], annotationFiles?: any[]) => void;
  selectedImageIndex: number | null;
  setSelectedImageIndex: (idx: number | null) => void;
}

export function ResizableDatasetLayout({
  layout,
  id,
  images,
  currentPage,
  imagesPerPage,
  imageSize,
  sliderPosition,
  onImagesPerPageChange,
  onImageSizeChange,
  onSliderPositionChange,
  onPageChange,
  onOpenUploadDialog,
  onDeleteImage,
  paginatedImages,
  totalPages,
  annotations = [],
  onImportAnnotations,
  onShowAnnotationsChange,
  selectedImageIndex,
  setSelectedImageIndex,
}: ResizableDatasetLayoutProps) {
  // Memoize images to prevent new array reference on every render
  const imagesMemo = useMemo(() => images, [JSON.stringify(images)]);
  const [annotationFiles, setAnnotationFiles] = useState<any[]>([]);

  // Handle annotation changes and store annotation files
  const handleShowAnnotationsChange = (show: boolean, annots: AnnotationSample[], files?: any[]) => {
    if (files) {
      setAnnotationFiles(files);
    }
    onShowAnnotationsChange?.(show, annots, files);
  };
  
  const renderImagesSection = () => (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 p-6">
        <ImagesTabContent
          id={id}
          images={imagesMemo}
          currentPage={currentPage}
          imagesPerPage={imagesPerPage}
          imageSize={imageSize}
          onImagesPerPageChange={onImagesPerPageChange}
          onImageSizeChange={onImageSizeChange}
          onPageChange={onPageChange}
          onOpenUploadDialog={onOpenUploadDialog}
          onDeleteImage={onDeleteImage}
          paginatedImages={paginatedImages}
          totalPages={totalPages}
          annotations={annotations}
          annotationFiles={annotationFiles}
          onImportAnnotations={onImportAnnotations}
          selectedImageIndex={selectedImageIndex}
          setSelectedImageIndex={setSelectedImageIndex}
        />
      </div>
    </div>
  );
  
  const renderAnnotationsSection = () => (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 p-6">
        <AnnotationsContent
          id={id}
          onShowAnnotationsChange={handleShowAnnotationsChange}
          onImportAnnotations={onImportAnnotations}
          className="h-full"
          // Add this prop to always show all annotations on the grid
          showAllAnnotationsOnGrid
          // Pass the dataset images
          images={imagesMemo}
        />
      </div>
    </div>
  );

  if (layout === 'images-only') {
    return (
      <div className="w-full h-full">
        {renderImagesSection()}
      </div>
    );
  }

  if (layout === 'annotations-only') {
    return (
      <div className="w-full h-full">
        {renderAnnotationsSection()}
      </div>
    );
  }

  if (layout === 'vertical') {
    return (
      <div className="w-full h-full">
        <ResizablePanelGroup 
          direction="vertical" 
          className="w-full h-full"
          onLayout={(sizes) => {
            if (sizes[0] !== undefined) {
              onSliderPositionChange(sizes[0]);
            }
          }}
        >
          <ResizablePanel 
            defaultSize={sliderPosition} 
            minSize={20}
            className="min-h-0"
          >
            <div className="bg-card h-full overflow-hidden">
              {renderImagesSection()}
            </div>
          </ResizablePanel>
          
          <ResizableHandle withHandle />
          
          <ResizablePanel 
            defaultSize={100 - sliderPosition} 
            minSize={20}
            className="min-h-0"
          >
            <div className="bg-card h-full overflow-hidden">
              {renderAnnotationsSection()}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    );
  }

  // Default horizontal layout
  return (
    <ResizablePanelGroup 
      direction="horizontal" 
      className="w-full h-full"
      onLayout={(sizes) => {
        if (sizes[0] !== undefined) {
          onSliderPositionChange(sizes[0]);
        }
      }}
    >
      <ResizablePanel defaultSize={sliderPosition} minSize={20}>
        <div className="bg-card h-full overflow-hidden">
          {renderImagesSection()}
        </div>
      </ResizablePanel>
      
      <ResizableHandle withHandle />
      
      <ResizablePanel defaultSize={100 - sliderPosition} minSize={20}>
        <div className="bg-card h-full overflow-hidden">
          {renderAnnotationsSection()}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
