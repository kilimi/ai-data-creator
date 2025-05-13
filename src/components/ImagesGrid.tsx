
import { useState } from "react";
import { Image } from "@/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { ImageDetailModal } from "./ImageDetailModal";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ImagesGridProps {
  images: Image[];
  imageSize: number;
  onOpenUploadDialog: () => void;
  onDeleteImage?: (imageId: string) => Promise<void>;
  className?: string;
  maxHeight?: string;
}

export function ImagesGrid({ 
  images, 
  imageSize, 
  onOpenUploadDialog, 
  onDeleteImage,
  className = "",
  maxHeight = "600px" 
}: ImagesGridProps) {
  const [imageLoadErrors, setImageLoadErrors] = useState<Record<string, boolean>>({});
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [hoveredImage, setHoveredImage] = useState<string | null>(null);

  const handleImageClick = (image: Image) => {
    setSelectedImage(image);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedImage(null);
  };

  const handleDeleteImage = async (imageId: string) => {
    if (onDeleteImage) {
      await onDeleteImage(imageId);
    }
  };

  if (images.length === 0) {
    return (
      <Card className="p-8 text-center bg-gray-900/50 border-dashed border-2 border-gray-700">
        <p className="text-muted-foreground mb-6">No images uploaded yet</p>
        <Button onClick={onOpenUploadDialog} className="bg-blue-600 hover:bg-blue-700">
          <Upload className="w-4 h-4 mr-2" />
          Upload Images
        </Button>
      </Card>
    );
  }

  // Calculate the number of columns based on container width and image size
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${imageSize}px, 1fr))`,
    gap: '0.75rem',
    padding: '0.75rem'
  };

  return (
    <>
      <ScrollArea className={`h-[${maxHeight}] w-full rounded-md border border-gray-700/50 bg-gray-900/20 ${className}`}>
        <div style={gridStyle}>
          {images.map((image) => (
            <div 
              key={image.id}
              className="group relative aspect-square cursor-pointer rounded-md overflow-hidden bg-gray-800"
              onClick={() => handleImageClick(image)}
              onMouseEnter={() => setHoveredImage(image.id)}
              onMouseLeave={() => setHoveredImage(null)}
            >
              <div className="absolute inset-0 p-1">
                <div className="h-full w-full rounded-sm overflow-hidden bg-gray-900/50 ring-1 ring-gray-700/50">
                  {imageLoadErrors[image.id] ? (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-gray-900/90">
                      <span className="text-sm">Failed to load image</span>
                    </div>
                  ) : (
                    <img
                      src={image.thumbnailUrl || image.url}
                      alt={image.fileName}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={() => setImageLoadErrors(prev => ({ ...prev, [image.id]: true }))}
                    />
                  )}
                </div>
              </div>
              
              <div className={`absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200`}>
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <div className="mb-2 px-2">
                    <p className="text-sm text-white truncate">{image.fileName}</p>
                    <p className="text-xs text-gray-300">
                      {image.width}×{image.height} • {(image.fileSize / (1024 * 1024)).toFixed(1)} MB
                    </p>
                  </div>
                  {onDeleteImage && (
                    <div className="flex justify-end px-1">
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteImage(image.id);
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4"
                        >
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <ImageDetailModal 
        image={selectedImage}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onDelete={handleDeleteImage}
      />
    </>
  );
}
