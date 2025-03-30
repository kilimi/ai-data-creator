
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCard } from "@/components/UploadCard";
import { X } from "lucide-react";

interface ImageUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilesSelected: (files: File[]) => void;
}

export function ImageUploadDialog({
  open,
  onOpenChange,
  onFilesSelected,
}: ImageUploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-gray-900 text-white border-gray-700">
        <DialogHeader>
          <DialogTitle>Upload Images</DialogTitle>
          <DialogDescription className="text-gray-400">
            Drag and drop or select image files to add to your dataset
          </DialogDescription>
        </DialogHeader>
        
        <div className="mt-4">
          <UploadCard
            title="Add Images"
            description="Upload JPG, PNG, or WEBP files"
            accept="image/jpeg,image/png,image/webp"
            onFilesSelected={(files) => {
              onFilesSelected(files);
              onOpenChange(false);
            }}
            type="images"
          />
        </div>
        
        <Button 
          className="absolute right-4 top-4 rounded-sm p-0 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-0 focus:ring-offset-0 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
          onClick={() => onOpenChange(false)}
          variant="ghost"
          size="icon"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
