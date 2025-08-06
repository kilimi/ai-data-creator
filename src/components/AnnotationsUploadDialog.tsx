import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCard } from "@/components/UploadCard";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

interface AnnotationsUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilesSelected: (files: File[], type?: string) => void;
}

export function AnnotationsUploadDialog({
  open,
  onOpenChange,
  onFilesSelected,
}: AnnotationsUploadDialogProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [annotationType, setAnnotationType] = useState<string>("any");

  useEffect(() => {
    if (!open) {
      setSelectedFiles([]);
      setAnnotationType("any");
    }
  }, [open]);

  // Auto-upload when files are selected
  useEffect(() => {
    console.log('AnnotationsUploadDialog useEffect triggered, selectedFiles:', selectedFiles.length);
    if (selectedFiles.length > 0) {
      console.log('Auto-uploading files:', selectedFiles.map(f => f.name), 'with type:', annotationType);
      onFilesSelected(selectedFiles, annotationType);
      onOpenChange(false);
    }
  }, [selectedFiles]); // Remove onFilesSelected and onOpenChange from dependencies

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-gray-900 text-white border-gray-700">
        <DialogHeader>
          <DialogTitle>Upload Annotations</DialogTitle>
          <DialogDescription className="text-gray-400">
            Select annotation files to import. Files will be uploaded automatically.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4">
          {/* Annotation Type Selection */}
          <div className="space-y-2">
            <Label htmlFor="annotation-type" className="text-sm font-medium text-gray-300">
              Annotation Type
            </Label>
            <Select value={annotationType} onValueChange={setAnnotationType}>
              <SelectTrigger className="bg-gray-800 border-gray-600 text-white">
                <SelectValue placeholder="Select annotation type" />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-600">
                <SelectItem value="any">Any (Auto-detect)</SelectItem>
                <SelectItem value="classification">Classification</SelectItem>
                <SelectItem value="segmentation">Segmentation</SelectItem>
                <SelectItem value="depth">Depth</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-400">
              Specify the type of annotations to help with proper handling and display
            </p>
          </div>

          {/* File Upload */}
          <div>
            <UploadCard
              title="Add Annotations"
              description="Drag and drop your annotation files here or click to select files."
              accept=".json"
              maxSize={100}
              onFilesSelected={setSelectedFiles}
              type="annotations"
            />
          </div>
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
