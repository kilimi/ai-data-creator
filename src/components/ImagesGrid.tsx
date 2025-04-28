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
}

export function ImagesGrid({ images, imageSize, onOpenUploadDialog, onDeleteImage }: ImagesGridProps) {
  const [imageLoadErrors, setImageLoadErrors] = useState<Record<string, boolean>>({});
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
      <Card className="p-6 text-center">
        <p className="text-muted-foreground mb-4">No images uploaded yet</p>
        <Button onClick={onOpenUploadDialog}>
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
    gap: '1rem',
    padding: '1rem'
  };

  return (
    <>
      <ScrollArea className="h-[600px] w-full rounded-md border border-border/50">
        <div style={gridStyle}>
          {images.map((image) => (
            <div 
              key={image.id}
              className="cursor-pointer relative group rounded-md overflow-hidden border border-border/50 bg-card hover:border-primary/50 transition-colors"
              onClick={() => handleImageClick(image)}
            >
              <div className="aspect-square relative">
                {imageLoadErrors[image.id] ? (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <span className="text-sm">Failed to load image</span>
                  </div>
                ) : (
                  <img
                    src={image.thumbnailUrl || image.url}
                    alt={image.fileName}
                    className="w-full h-full object-cover"
                    onError={() => setImageLoadErrors(prev => ({ ...prev, [image.id]: true }))}
                  />
                )}
              </div>
              {onDeleteImage && (
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                  <Button
                    variant="destructive"
                    size="icon"
                    className="h-8 w-8"
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
