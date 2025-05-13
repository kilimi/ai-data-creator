
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Image } from "@/types";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { AnnotationSample } from "@/utils/annotations";
import { AnnotationVisualizer } from "@/components/AnnotationVisualizer";
import { useState } from "react";

interface ImageDetailModalProps {
  image: Image | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: (imageId: string) => Promise<void>;
  annotations?: AnnotationSample[];
}

export function ImageDetailModal({ 
  image, 
  isOpen, 
  onClose, 
  onDelete,
  annotations = []
}: ImageDetailModalProps) {
  const [imageDimensions, setImageDimensions] = useState({ width: 800, height: 600 });

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight
    });
  };

  if (!image) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogTitle>{image.fileName}</DialogTitle>
        
        <div className="flex flex-col space-y-2">
          <div className="text-sm text-muted-foreground">
            {image.width} × {image.height} • {(image.fileSize / (1024 * 1024)).toFixed(2)} MB
          </div>
          
          <div className="relative aspect-video bg-gray-950 rounded overflow-hidden flex items-center justify-center">
            <img
              src={image.url}
              alt={image.fileName}
              className="max-h-full max-w-full object-contain"
              onLoad={handleImageLoad}
            />
            
            {annotations && annotations.length > 0 && (
              <AnnotationVisualizer
                annotations={annotations}
                imageWidth={imageDimensions.width}
                imageHeight={imageDimensions.height}
                className="absolute inset-0"
              />
            )}
          </div>
          
          <div className="flex justify-between items-center pt-2">
            <div className="text-sm text-muted-foreground">
              {annotations && annotations.length > 0 
                ? `${annotations.length} annotations displayed` 
                : "No annotations to display"}
            </div>
            
            {onDelete && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  onDelete(image.id);
                  onClose();
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Image
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
