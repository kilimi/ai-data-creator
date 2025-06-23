import { Link } from "react-router-dom";
import { Pencil, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Image } from "@/types";
import { ImageDisplayControls } from "@/components/ImageDisplayControls";
import { ImagesGrid } from "@/components/ImagesGrid";
import { PaginationControls } from "@/components/PaginationControls";
import { AnnotationSample } from "@/utils/annotations";
import { ImageDetailModal } from "@/components/ImageDetailModal";
import { useState } from "react";

interface ImagesTabContentProps {
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
  onImageClick?: (image: Image) => void;
  paginatedImages: Image[];
  totalPages: number;
  annotations?: AnnotationSample[];
  onImportAnnotations?: (files: File[]) => void;
  selectedImageIndex: number | null;
  setSelectedImageIndex: (idx: number | null) => void;
}

export function ImagesTabContent({
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
  selectedImageIndex,
  setSelectedImageIndex,
}: ImagesTabContentProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Open modal at clicked image index
  const handleImageClick = (image: Image) => {
    const idx = paginatedImages.findIndex((img) => img.id === image.id);
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
    await onDeleteImage(imageId);
    handleCloseModal();
  };

  // Navigation handlers
  const hasPrev = selectedImageIndex !== null && selectedImageIndex > 0;
  const hasNext = selectedImageIndex !== null && selectedImageIndex < paginatedImages.length - 1;
  const handlePrev = () => {
    if (hasPrev && selectedImageIndex !== null) setSelectedImageIndex(selectedImageIndex - 1);
  };
  const handleNext = () => {
    if (hasNext && selectedImageIndex !== null) setSelectedImageIndex(selectedImageIndex + 1);
  };

  // Get current image and annotations
  const selectedImage = selectedImageIndex !== null ? paginatedImages[selectedImageIndex] : null;
  const selectedImageAnnotations = selectedImage
    ? annotations.filter((anno) => anno.imageId === selectedImage.id)
    : [];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold">Images</h2>
        <div className="flex gap-2">
          <Button asChild>
            <Link to={`/datasets/${id}/annotate`}>
              <Pencil className="w-4 h-4 mr-2" />
              Annotate
            </Link>
          </Button>
          <Button onClick={onOpenUploadDialog} className="bg-blue-600 hover:bg-blue-700">
            <Upload className="w-4 h-4 mr-2" />
            Upload Images
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-4">
        <ImageDisplayControls
          imagesPerPage={imagesPerPage}
          onImagesPerPageChange={onImagesPerPageChange}
          imageSize={imageSize}
          onImageSizeChange={onImageSizeChange}
        />
      </div>

      {/* Images Grid - takes remaining space */}
      <div className="flex-1 mb-4">
        <ImagesGrid
          images={paginatedImages}
          imageSize={imageSize}
          onOpenUploadDialog={onOpenUploadDialog}
          onDeleteImage={onDeleteImage}
          onImageClick={handleImageClick}
          annotations={annotations}
        />
      </div>

      {/* Pagination */}
      <div className="mt-auto">
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </div>

      {/* Image Detail Modal */}
      <ImageDetailModal
        image={selectedImage}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onDelete={handleDeleteFromModal}
        annotations={selectedImageAnnotations}
        onPrev={handlePrev}
        onNext={handleNext}
        hasPrev={hasPrev}
        hasNext={hasNext}
        imageIndex={selectedImageIndex !== null ? selectedImageIndex + 1 : null}
        imageCount={paginatedImages.length}
      />
    </div>
  );
}
