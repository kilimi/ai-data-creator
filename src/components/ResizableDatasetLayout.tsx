
import React, { useMemo, useState, useEffect } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ImagesTabContent } from '@/components/ImagesTabContent';
import { TabbedImagesContent } from '@/components/TabbedImagesContent';
import { AnnotationsContent } from '@/components/AnnotationsContent';
import { Image, ImageCollection } from '@/types';
import { AnnotationSample } from '@/utils/annotations';
import { LayoutType } from './LayoutControls';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ResizableDatasetLayoutProps {
  layout: LayoutType;
  id: string;
  projectId?: string;
  images: Image[];
  imageCollections?: ImageCollection[]; // NEW: for tabbed image system
  useTabbedImages?: boolean; // NEW: flag to enable tabbed images
  currentPage: number;
  imagesPerPage: number;
  imageSize: number;
  sliderPosition: number;
  onImagesPerPageChange: (value: number) => void;
  onImageSizeChange: (value: number[]) => void;
  onSliderPositionChange: (value: number) => void;
  onPageChange: (page: number) => void;
  onTabPageChange?: (tabId: string, page: number) => void; // NEW: for tabbed pagination
  onOpenUploadDialog: () => void;
  onDeleteImage: (imageId: string) => Promise<void>;
  onTabDeleteImage?: (tabId: string, imageId: string) => Promise<void>; // NEW: for tabbed image deletion
  onTabUploadImages?: (tabId: string, files: File[]) => Promise<void>; // NEW: for tabbed image upload
  onAddImageTab?: (tabName: string) => void; // NEW: for adding new tabs
  onRemoveImageTab?: (tabId: string) => void; // NEW: for removing tabs
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
  projectId,
  images,
  imageCollections,
  useTabbedImages = false,
  currentPage,
  imagesPerPage,
  imageSize,
  sliderPosition,
  onImagesPerPageChange,
  onImageSizeChange,
  onSliderPositionChange,
  onPageChange,
  onTabPageChange,
  onOpenUploadDialog,
  onDeleteImage,
  onTabDeleteImage,
  onTabUploadImages,
  onAddImageTab,
  onRemoveImageTab,
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
    <ScrollArea className="h-full w-full">
      <div className="p-6">
        {useTabbedImages && imageCollections ? (
          <TabbedImagesContent
            id={id}
            projectId={projectId}
            imageCollections={imageCollections}
            imagesPerPage={imagesPerPage}
            imageSize={imageSize}
            onImagesPerPageChange={onImagesPerPageChange}
            onImageSizeChange={onImageSizeChange}
            onPageChange={onTabPageChange || (() => {})}
            onDeleteImage={onTabDeleteImage || (() => Promise.resolve())}
            onUploadImages={onTabUploadImages || (() => Promise.resolve())}
            onAddTab={onAddImageTab || (() => {})}
            onRemoveTab={onRemoveImageTab || (() => {})}
            annotations={annotations}
            annotationFiles={annotationFiles}
            selectedImageIndex={selectedImageIndex}
            setSelectedImageIndex={setSelectedImageIndex}
          />
        ) : (
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
        )}
      </div>
    </ScrollArea>
  );
  
  const renderAnnotationsSection = () => (
    <ScrollArea className="h-full w-full">
      <div className="p-6">
        <AnnotationsContent
          id={id}
          projectId={projectId}
          onShowAnnotationsChange={handleShowAnnotationsChange}
          onImportAnnotations={onImportAnnotations}
          className="h-full"
          // Add this prop to always show all annotations on the grid
          showAllAnnotationsOnGrid
          // Pass the dataset images
          images={imagesMemo}
          // Pass current page image IDs for smart annotation loading
          currentPageImageIds={paginatedImages.map(img => img.id)}
        />
      </div>
    </ScrollArea>
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
      <div className="w-full h-full flex flex-col">
        <div className="flex-1 min-h-0 border-b border-border">
          {renderImagesSection()}
        </div>
        <div className="flex-1 min-h-0">
          {renderAnnotationsSection()}
        </div>
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
