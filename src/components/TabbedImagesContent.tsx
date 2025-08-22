import { Link } from "react-router-dom";
import { Pencil, Upload, Plus, X, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Image, ImageCollection } from "@/types";
import { ImageDisplayControls } from "@/components/ImageDisplayControls";
import { ImagesGrid } from "@/components/ImagesGrid";
import { PaginationControls } from "@/components/PaginationControls";
import { AnnotationSample } from "@/utils/annotations";
import { ImageDetailModal } from "@/components/ImageDetailModal";
import { AnnotationChoiceModal } from "@/components/AnnotationChoiceModal";
import { AddImageTabDialog } from "@/components/AddImageTabDialog";
import { ImageUploadDialog } from "@/components/ImageUploadDialog";
import { useState, useEffect } from "react";

interface TabbedImagesContentProps {
  id: string;
  imageCollections: ImageCollection[];
  imagesPerPage: number;
  imageSize: number;
  onImagesPerPageChange: (value: number) => void;
  onImageSizeChange: (value: number[]) => void;
  onPageChange: (tabId: string, page: number) => void;
  onDeleteImage: (tabId: string, imageId: string) => Promise<void>;
  onUploadImages: (tabId: string, files: File[]) => Promise<void>;
  onAddTab: (tabName: string) => void;
  onRemoveTab: (tabId: string) => void;
  annotations?: AnnotationSample[];
  annotationFiles?: any[];
  selectedImageIndex: number | null;
  setSelectedImageIndex: (idx: number | null) => void;
}

function getAnnotationFileName(annotation: any, annotationFiles: any[]): string {
  if (!annotationFiles) return "?";
  const found = annotationFiles.find((f) =>
    Array.isArray(f.samples) ? f.samples.some((s) => s.id === annotation.id) : false
  );
  return found ? found.name : "?";
}

export function TabbedImagesContent({
  id,
  imageCollections,
  imagesPerPage,
  imageSize,
  onImagesPerPageChange,
  onImageSizeChange,
  onPageChange,
  onDeleteImage,
  onUploadImages,
  onAddTab,
  onRemoveTab,
  annotations = [],
  annotationFiles = [],
  selectedImageIndex,
  setSelectedImageIndex,
}: TabbedImagesContentProps) {
  const [activeTab, setActiveTab] = useState(imageCollections.length > 0 ? imageCollections[0].id : "");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAnnotationChoiceModalOpen, setIsAnnotationChoiceModalOpen] = useState(false);
  const [isAddTabDialogOpen, setIsAddTabDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadingTabId, setUploadingTabId] = useState<string>("");

  // Update active tab if collections change
  useEffect(() => {
    if (imageCollections.length > 0 && !imageCollections.find(c => c.id === activeTab)) {
      setActiveTab(imageCollections[0].id);
    }
  }, [imageCollections, activeTab]);

  const activeCollection = imageCollections.find(c => c.id === activeTab);
  const allImages = imageCollections.flatMap(c => c.images);

  // Open modal at clicked image index (based on all images across tabs)
  const handleImageClick = (image: Image) => {
    const idx = allImages.findIndex((img) => img.id === image.id);
    if (idx !== -1) {
      setSelectedImageIndex(idx);
      setIsModalOpen(true);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedImageIndex(null);
  };

  const handleDeleteFromModal = async (imageId: string) => {
    if (activeCollection) {
      await onDeleteImage(activeCollection.id, imageId);
      handleCloseModal();
    }
  };

  const handleAddTab = (tabName: string) => {
    onAddTab(tabName);
  };

  const handleRemoveTab = (tabId: string) => {
    if (imageCollections.length <= 1) return; // Don't allow removing the last tab
    onRemoveTab(tabId);
  };

  const handleUploadClick = (tabId: string) => {
    setUploadingTabId(tabId);
    setIsUploadDialogOpen(true);
  };

  const handleFilesSelected = async (files: File[]) => {
    if (uploadingTabId) {
      await onUploadImages(uploadingTabId, files);
    }
    setIsUploadDialogOpen(false);
    setUploadingTabId("");
  };

  // Navigation handlers (work across all images, not just current tab)
  const hasPrev = selectedImageIndex !== null && selectedImageIndex > 0;
  const hasNext = selectedImageIndex !== null && selectedImageIndex < allImages.length - 1;
  
  const handlePrev = () => {
    if (hasPrev && selectedImageIndex !== null) {
      const newIndex = selectedImageIndex - 1;
      setSelectedImageIndex(newIndex);
    }
  };
  
  const handleNext = () => {
    if (hasNext && selectedImageIndex !== null) {
      const newIndex = selectedImageIndex + 1;
      setSelectedImageIndex(newIndex);
    }
  };

  // Get current image and annotations (based on all images)
  const selectedImage = selectedImageIndex !== null ? allImages[selectedImageIndex] : null;
  const selectedImageAnnotations = selectedImage
    ? annotations.filter((anno) => {
        const matches = String(anno.imageId) === String(selectedImage.id);
        return matches;
      })
    : [];

  // Attach annotationFileName to each annotation for grid and popup
  const annotationsWithFileName = annotations.map((ann) => ({
    ...ann,
    annotationFileName: getAnnotationFileName(ann, annotationFiles),
  }));

  const selectedImageAnnotationsWithFile = selectedImageAnnotations.map((ann) => ({
    ...ann,
    annotationFileName: getAnnotationFileName(ann, annotationFiles),
  }));

  const existingTabNames = imageCollections.map(c => c.name);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 flex justify-between items-center mb-4">
        <div>
          <h2 className="text-xl font-semibold">Images</h2>
          <p className="text-sm text-muted-foreground">
            {allImages.length} total images across {imageCollections.length} collection{imageCollections.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setIsAnnotationChoiceModalOpen(true)}>
            <Pencil className="w-4 h-4 mr-2" />
            Annotate
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 mb-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex items-center gap-2 mb-4">
            <TabsList className="flex-1 bg-gray-800/50 border border-gray-700">
              {imageCollections.map((collection) => (
                <div key={collection.id} className="flex items-center group">
                  <TabsTrigger 
                    value={collection.id}
                    className="data-[state=active]:bg-blue-600 data-[state=active]:text-white relative pr-8"
                  >
                    <FolderOpen className="w-4 h-4 mr-2" />
                    {collection.name}
                    <span className="ml-2 text-xs opacity-70">
                      ({collection.images.length})
                    </span>
                  </TabsTrigger>
                  {imageCollections.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 ml-1 opacity-0 group-hover:opacity-100 hover:bg-red-600/20 hover:text-red-400"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveTab(collection.id);
                      }}
                      title={`Remove ${collection.name} tab`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </TabsList>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsAddTabDialogOpen(true)}
              className="border-gray-600 hover:bg-gray-800"
              title="Add new image collection tab"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {imageCollections.map((collection) => (
            <TabsContent key={collection.id} value={collection.id} className="mt-0 space-y-4">
              {/* Collection Header */}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <h3 className="text-lg font-medium">{collection.name}</h3>
                  <span className="text-sm text-muted-foreground">
                    {collection.images.length} images
                  </span>
                </div>
                <Button 
                  onClick={() => handleUploadClick(collection.id)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Images
                </Button>
              </div>

              {/* Controls */}
              <div className="flex-shrink-0">
                <ImageDisplayControls
                  imagesPerPage={imagesPerPage}
                  onImagesPerPageChange={onImagesPerPageChange}
                  imageSize={imageSize}
                  onImageSizeChange={onImageSizeChange}
                />
              </div>

              {/* Images Grid - scrollable content */}
              <div className="flex-1 min-h-0 mb-4">
                <ScrollArea className="h-full">
                  <ImagesGrid
                    images={collection.paginatedImages}
                    imageSize={imageSize}
                    onOpenUploadDialog={() => handleUploadClick(collection.id)}
                    onDeleteImage={(imageId) => onDeleteImage(collection.id, imageId)}
                    onImageClick={handleImageClick}
                    annotations={annotationsWithFileName}
                    annotationFiles={annotationFiles}
                  />
                </ScrollArea>
              </div>

              {/* Pagination - fixed at bottom */}
              <div className="flex-shrink-0">
                <PaginationControls
                  currentPage={collection.currentPage}
                  totalPages={collection.totalPages}
                  onPageChange={(page) => onPageChange(collection.id, page)}
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Image Detail Modal */}
      <ImageDetailModal
        image={selectedImage}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onDelete={handleDeleteFromModal}
        annotations={selectedImageAnnotationsWithFile}
        annotationFiles={annotationFiles}
        onPrev={handlePrev}
        onNext={handleNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
        imageIndex={selectedImageIndex !== null ? selectedImageIndex + 1 : null}
        imageCount={allImages.length}
      />

      {/* Annotation Choice Modal */}
      <AnnotationChoiceModal
        isOpen={isAnnotationChoiceModalOpen}
        onOpenChange={setIsAnnotationChoiceModalOpen}
        datasetId={id}
      />

      {/* Add Tab Dialog */}
      <AddImageTabDialog
        open={isAddTabDialogOpen}
        onOpenChange={setIsAddTabDialogOpen}
        onTabAdded={handleAddTab}
        existingTabNames={existingTabNames}
      />

      {/* Upload Dialog */}
      <ImageUploadDialog
        open={isUploadDialogOpen}
        onOpenChange={setIsUploadDialogOpen}
        onFilesSelected={handleFilesSelected}
      />
    </div>
  );
}
