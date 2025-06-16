import { Link } from "react-router-dom";
import { Pencil, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Image } from "@/types";
import { ImageDisplayControls } from "@/components/ImageDisplayControls";
import { ImagesGrid } from "@/components/ImagesGrid";
import { PaginationControls } from "@/components/PaginationControls";
import { AnnotationSample } from "@/utils/annotations";
import { AnnotationsContent } from "@/components/AnnotationsContent";
import { ImageDetailModal } from "@/components/ImageDetailModal";
import { useEffect, useState } from "react";

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
}: ImagesTabContentProps) {
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Reset to page 1 if current page is beyond total pages when imagesPerPage changes
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      onPageChange(1);
    }
  }, [currentPage, totalPages, onPageChange]);

  const handleImagesPerPageChange = (value: number) => {
    // Calculate what the new total pages would be
    const newTotalPages = Math.ceil(images.length / value);
    
    // If current page would be beyond the new total pages, reset to page 1
    if (currentPage > newTotalPages && newTotalPages > 0) {
      onPageChange(1);
    }
    
    onImagesPerPageChange(value);
  };

  const handleImageClick = (image: Image) => {
    setSelectedImage(image);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedImage(null);
  };

  const handleDeleteFromModal = async (imageId: string) => {
    await onDeleteImage(imageId);
    handleCloseModal();
  };

  // Get annotations for the selected image
  const selectedImageAnnotations = selectedImage 
    ? annotations.filter(anno => anno.imageId === selectedImage.id)
    : [];

  return (
    <div className="space-y-6">
      {/* Images Section */}
      <div className="space-y-4">
        <div className="flex justify-between items-center">
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

        <ImageDisplayControls
          imagesPerPage={imagesPerPage}
          onImagesPerPageChange={handleImagesPerPageChange}
          imageSize={imageSize}
          onImageSizeChange={onImageSizeChange}
        />

        <ImagesGrid
          images={paginatedImages}
          imageSize={imageSize}
          onOpenUploadDialog={onOpenUploadDialog}
          onDeleteImage={onDeleteImage}
          onImageClick={handleImageClick}
          maxHeight="400px"
          annotations={annotations}
        />

        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={onPageChange}
        />
      </div>

      {/* Annotations Section */}
      <div className="border-t border-gray-800 pt-6">
        <AnnotationsContent
          id={id}
          onImportAnnotations={onImportAnnotations}
          className="min-h-[500px]"
        />
      </div>

      {/* Image Detail Modal */}
      <ImageDetailModal
        image={selectedImage}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onDelete={handleDeleteFromModal}
        annotations={selectedImageAnnotations}
      />
    </div>
  );
}
