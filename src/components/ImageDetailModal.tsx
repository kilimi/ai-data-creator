
import { Image } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2, X } from "lucide-react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";

interface ImageDetailModalProps {
  image: Image | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (imageId: string) => Promise<void>;
}

export function ImageDetailModal({ image, isOpen, onClose, onDelete }: ImageDetailModalProps) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);

  const handleDelete = async () => {
    if (!image) return;
    
    setIsDeleting(true);
    try {
      await onDelete(image.id);
      setIsDeleteDialogOpen(false);
      onClose();
    } catch (error) {
      console.error("Error deleting image:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader className="flex justify-between items-center flex-row">
            <DialogTitle className="text-xl font-semibold truncate max-w-[calc(100%-80px)]">
              {image?.fileName}
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="icon"
                onClick={() => setIsDeleteDialogOpen(true)}
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto relative min-h-[300px] flex items-center justify-center bg-gray-900">
            {image && (
              imageLoadError ? (
                <div className="text-center text-muted-foreground">
                  <p>Failed to load image</p>
                  <p className="text-sm mt-2">Filename: {image.fileName}</p>
                </div>
              ) : (
                <img 
                  src={image.url} 
                  alt={image.fileName}
                  className="max-w-full max-h-full object-contain" 
                  onError={() => setImageLoadError(true)}
                />
              )
            )}
          </div>
          
          <div className="text-sm text-muted-foreground mt-2 flex flex-wrap justify-between">
            <span>
              Size: {(image?.fileSize || 0) / 1024 < 1000 ? 
                `${Math.round((image?.fileSize || 0) / 1024)} KB` : 
                `${Math.round((image?.fileSize || 0) / (1024 * 1024) * 10) / 10} MB`}
            </span>
            <span>Dimensions: {image?.width} × {image?.height}</span>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Image</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this image? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
