
import { useState } from "react";
import { Image } from "@/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";

interface ImagesGridProps {
  images: Image[];
  imageSize: number;
  onOpenUploadDialog: () => void;
}

export function ImagesGrid({ images, imageSize, onOpenUploadDialog }: ImagesGridProps) {
  const [imageLoadErrors, setImageLoadErrors] = useState<Record<string, boolean>>({});

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

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3">
      {images.map((image) => (
        <div 
          key={image.id}
          className="cursor-pointer relative group rounded-md overflow-hidden border border-gray-700 bg-gray-800 hover:border-blue-500/50 transition-colors"
          style={{ width: imageSize, height: imageSize }}
        >
          <div className="aspect-square relative">
            {imageLoadErrors[image.id] ? (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <p className="text-xs text-center px-2">Failed to load image</p>
              </div>
            ) : (
              <img 
                src={image.url}
                alt={image.fileName} 
                className="w-full h-full object-cover"
                onError={() => setImageLoadErrors(prev => ({ ...prev, [image.id]: true }))}
                loading="lazy"
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
