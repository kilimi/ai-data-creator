import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCard } from "@/components/UploadCard";
import { X } from "lucide-react";

interface AnnotationsUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilesSelected: (files: File[]) => void;
}

export function AnnotationsUploadDialog({
  open,
  onOpenChange,
  onFilesSelected,
}: AnnotationsUploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-gray-900 text-white border-gray-700">
        <DialogHeader>
          <DialogTitle>Upload Annotations</DialogTitle>
          <DialogDescription className="text-gray-400">
            Select annotation files to import
          </DialogDescription>
        </DialogHeader>
        
        <div className="mt-4">
          <UploadCard
            title="Add Annotations"
            description="Drag and drop your annotation files here or click to select files."
            accept=".json"
            onFilesSelected={(files) => {
              onFilesSelected(files);
              onOpenChange(false);
            }}
            type="annotations"
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
