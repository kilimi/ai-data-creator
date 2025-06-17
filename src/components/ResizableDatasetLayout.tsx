
import React from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ImagesTabContent } from '@/components/ImagesTabContent';
import { AnnotationsContent } from '@/components/AnnotationsContent';
import { Image } from '@/types';
import { AnnotationSample } from '@/utils/annotations';
import { LayoutType } from './LayoutControls';

interface ResizableDatasetLayoutProps {
  layout: LayoutType;
  id: string;
  images: Image[];
  currentPage: number;
  imagesPerPage: number;
  imageSize: number;
  onImagesPerPageChange: (value: number) => void;
  onImageSizeChange: (value: number[]) => void;
  onPageChange: (page: number) => void;
  onOpenUploadDialog: () => void;
  onDeleteImage: (imageId: string) => Promise<void>;
  paginatedImages: Image[];
  totalPages: number;
  annotations?: AnnotationSample[];
  onImportAnnotations?: (files: File[]) => void;
  onShowAnnotationsChange?: (show: boolean, annotationId: string | null) => void;
}

export function ResizableDatasetLayout({
  layout,
  id,
  images,
  currentPage,
  imagesPerPage,
  imageSize,
  onImagesPerPageChange,
  onImageSizeChange,
  onPageChange,
  onOpenUploadDialog,
  onDeleteImage,
  paginatedImages,
  totalPages,
  annotations = [],
  onImportAnnotations,
  onShowAnnotationsChange,
}: ResizableDatasetLayoutProps) {
  
  const renderImagesSection = () => (
    <div className="h-full">
      <ImagesTabContent
        id={id}
        images={images}
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
        onImportAnnotations={onImportAnnotations}
      />
    </div>
  );

  const renderAnnotationsSection = () => (
    <div className="h-full">
      <AnnotationsContent
        id={id}
        onShowAnnotationsChange={onShowAnnotationsChange}
        onImportAnnotations={onImportAnnotations}
        className="h-full"
      />
    </div>
  );

  if (layout === 'images-only') {
    return (
      <div className="rounded-lg border bg-card p-6 h-full">
        {renderImagesSection()}
      </div>
    );
  }

  if (layout === 'annotations-only') {
    return (
      <div className="rounded-lg border bg-card p-6 h-full">
        {renderAnnotationsSection()}
      </div>
    );
  }

  if (layout === 'vertical') {
    return (
      <ResizablePanelGroup direction="vertical" className="min-h-[800px] rounded-lg border">
        <ResizablePanel defaultSize={50} minSize={20}>
          <div className="bg-card p-6 h-full">
            {renderImagesSection()}
          </div>
        </ResizablePanel>
        
        <ResizableHandle withHandle />
        
        <ResizablePanel defaultSize={50} minSize={20}>
          <div className="bg-card p-6 h-full">
            {renderAnnotationsSection()}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  // Default horizontal layout - increased min-height for better height utilization
  return (
    <ResizablePanelGroup direction="horizontal" className="min-h-[calc(100vh-200px)] h-[calc(100vh-200px)] rounded-lg border">
      <ResizablePanel defaultSize={60} minSize={30}>
        <div className="bg-card p-6 h-full">
          {renderImagesSection()}
        </div>
      </ResizablePanel>
      
      <ResizableHandle withHandle />
      
      <ResizablePanel defaultSize={40} minSize={20}>
        <div className="bg-card p-6 h-full">
          {renderAnnotationsSection()}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
