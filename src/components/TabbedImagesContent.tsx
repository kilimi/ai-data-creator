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
  projectId?: string;
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
  projectId,
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
  const [selectedClickedImage, setSelectedClickedImage] = useState<Image | null>(null); // Store the actual clicked image
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

  // Debug: log the structure of imageCollections
  useEffect(() => {
    console.log('TabbedImagesContent: imageCollections:', imageCollections);
    if (imageCollections.length > 0) {
      console.log('TabbedImagesContent: First collection images:', imageCollections[0].images);
      if (imageCollections[0].images.length > 0) {
        console.log('TabbedImagesContent: First image structure:', imageCollections[0].images[0]);
      }
    }
  }, [imageCollections]);

  // Open modal at clicked image index (based on all images across tabs)
  const handleImageClick = (image: Image) => {
    console.log('TabbedImagesContent: Clicked image:', image);
    console.log('TabbedImagesContent: All images:', allImages);
    const idx = allImages.findIndex((img) => img.id === image.id);
    console.log('TabbedImagesContent: Found index:', idx, 'Selected image will be:', allImages[idx]);
    if (idx !== -1) {
      setSelectedImageIndex(idx);
      setSelectedClickedImage(image); // Store the actual clicked image with all properties
      setIsModalOpen(true);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedImageIndex(null);
    setSelectedClickedImage(null); // Clear the clicked image
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
      setSelectedClickedImage(allImages[newIndex]); // Update clicked image state too
    }
  };
  
  const handleNext = () => {
    if (hasNext && selectedImageIndex !== null) {
      const newIndex = selectedImageIndex + 1;
      setSelectedImageIndex(newIndex);
      setSelectedClickedImage(allImages[newIndex]); // Update clicked image state too
    }
  };

  // Get current image and annotations (based on all images)
  const selectedImage = selectedClickedImage || (selectedImageIndex !== null ? allImages[selectedImageIndex] : null);
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
      {/* Header with cleaner design */}
      <div className="flex-shrink-0 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Image Collections</h2>
            <p className="text-sm text-gray-400 mt-1">
              {allImages.length} total images across {imageCollections.length} collection{imageCollections.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {/* Modern Tab Design */}
      <div className="flex-shrink-0 mb-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex items-center gap-3 mb-6">
            {/* Tab List with modern styling */}
            <TabsList className="bg-gray-900/50 rounded-lg p-1 border border-gray-700/50 h-auto">
              {imageCollections.map((collection) => (
                <div key={collection.id} className="relative group">
                  <TabsTrigger 
                    value={collection.id}
                    className="
                      relative px-6 py-3 rounded-md text-sm font-medium transition-all duration-200
                      data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-lg
                      data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-white
                      data-[state=inactive]:hover:bg-gray-800/50
                      flex items-center gap-2 min-w-0
                    "
                  >
                    <FolderOpen className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{collection.name}</span>
                    <span className="
                      text-xs px-2 py-0.5 rounded-full flex-shrink-0
                      data-[state=active]:bg-blue-500/30 data-[state=active]:text-blue-100
                      data-[state=inactive]:bg-gray-700 data-[state=inactive]:text-gray-300
                    ">
                      {collection.images.length}
                    </span>
                  </TabsTrigger>
                  
                  {/* Remove button with better positioning */}
                  {imageCollections.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="
                        absolute -top-1 -right-1 h-5 w-5 rounded-full
                        bg-red-500/80 hover:bg-red-500 text-white
                        opacity-0 group-hover:opacity-100 transition-opacity duration-200
                        border border-red-400/50
                      "
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveTab(collection.id);
                      }}
                      title={`Remove ${collection.name} collection`}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              ))}
            </TabsList>
            
            {/* Add new tab button with modern styling */}
            <Button
              variant="outline"
              onClick={() => setIsAddTabDialogOpen(true)}
              className="
                px-4 py-3 rounded-lg border-dashed border-2 border-gray-600
                hover:border-blue-500 hover:bg-blue-500/10 hover:text-blue-400
                text-gray-400 transition-all duration-200
                flex items-center gap-2
              "
              title="Add new image collection"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">Add Collection</span>
            </Button>
          </div>

          {imageCollections.map((collection) => (
            <TabsContent key={collection.id} value={collection.id} className="mt-0 space-y-6">
              {/* Collection Header with modern card design */}
              <div className="bg-gradient-to-r from-gray-800/40 via-gray-700/20 to-gray-800/40 rounded-xl p-5 border border-gray-600/30 shadow-sm">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 bg-gradient-to-br from-blue-400 to-blue-600 rounded-full shadow-sm"></div>
                      <h3 className="text-xl font-bold text-white tracking-tight">{collection.name}</h3>
                    </div>
                    <div className="px-3 py-1.5 bg-gray-700/60 rounded-full border border-gray-600/40">
                      <span className="text-sm text-gray-200 font-medium">
                        {collection.images.length} {collection.images.length === 1 ? 'image' : 'images'}
                      </span>
                    </div>
                  </div>
                  <Button 
                    onClick={() => handleUploadClick(collection.id)}
                    className="
                      bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800
                      text-white px-5 py-2.5 rounded-lg transition-all duration-200
                      hover:shadow-lg hover:shadow-blue-500/30
                      flex items-center gap-2 font-medium border border-blue-500/20
                    "
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload Images</span>
                  </Button>
                </div>
              </div>

              {/* Controls with cleaner spacing */}
              <div className="flex-shrink-0">
                <ImageDisplayControls
                  imagesPerPage={imagesPerPage}
                  onImagesPerPageChange={onImagesPerPageChange}
                  imageSize={imageSize}
                  onImageSizeChange={onImageSizeChange}
                />
              </div>

              {/* Images Grid with better container */}
              <div className="flex-1 min-h-0">
                <div className="bg-gray-900/20 rounded-lg border border-gray-700/30 min-h-[400px]">
                  <ScrollArea className="h-[calc(100vh-400px)]">
                    <div className="p-4">
                      <ImagesGrid
                        images={collection.paginatedImages}
                        imageSize={imageSize}
                        onOpenUploadDialog={() => handleUploadClick(collection.id)}
                        onDeleteImage={(imageId) => onDeleteImage(collection.id, imageId)}
                        onImageClick={handleImageClick}
                        annotations={annotationsWithFileName}
                        annotationFiles={annotationFiles}
                      />
                    </div>
                  </ScrollArea>
                </div>
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
        projectId={projectId}
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
