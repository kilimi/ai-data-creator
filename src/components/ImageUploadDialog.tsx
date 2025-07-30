import { useState, useRef } from "react";
import { 
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Upload, Image } from "lucide-react";

export interface ImageUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilesSelected: (files: File[]) => void;
}

export const ImageUploadDialog = ({ 
  open, 
  onOpenChange,
  onFilesSelected 
}: ImageUploadDialogProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    
    const fileArray = Array.from(files);
    const currentTotal = selectedFiles.length + fileArray.length;
    
    // Check if total would exceed 5000 files
    if (currentTotal > 5000) {
      // Show warning and only add files up to the limit
      const remainingSlots = 5000 - selectedFiles.length;
      const filesToAdd = fileArray.slice(0, remainingSlots);
      
      setSelectedFiles(prev => [...prev, ...filesToAdd]);
      
      // Show warning toast
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: {
            title: "File Limit Warning",
            description: `Maximum 5000 files allowed. Added ${filesToAdd.length} files. ${fileArray.length - filesToAdd.length} files were excluded.`,
            variant: "destructive"
          }
        }));
      }
      return;
    }
    
    setSelectedFiles(prev => [...prev, ...fileArray]);
  };

  const handleSelectFiles = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = () => {
    onFilesSelected(selectedFiles);
    handleClose();
  };

  const handleClose = () => {
    setSelectedFiles([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>Upload Images</DialogTitle>
          <DialogDescription className="text-gray-400">
            Upload images to add to your dataset (Max: 5000 files)
          </DialogDescription>
        </DialogHeader>
        
        <div className="my-4">
          <input 
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept="image/*"
            multiple
          />
          
          <div 
            className="border-2 border-dashed border-gray-700 rounded-lg p-12 text-center hover:border-gray-600 transition-colors cursor-pointer"
            onClick={handleSelectFiles}
          >
            {selectedFiles.length > 0 ? (
              <div className="flex flex-col items-center">
                <Image className="h-12 w-12 text-gray-400 mb-4" />
                <p className="text-lg font-medium">
                  {selectedFiles.length} {selectedFiles.length === 1 ? 'image' : 'images'} selected
                  <span className="text-sm text-gray-500 ml-2">
                    ({selectedFiles.length}/5000)
                  </span>
                </p>
                <p className="mt-2 text-sm text-gray-500">Click to add more images</p>
              </div>
            ) : (
              <>
                <Image className="mx-auto h-12 w-12 text-gray-400" />
                <div className="mt-4">
                  <Button>
                    <Upload className="mr-2 h-4 w-4" />
                    Select Images
                  </Button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  PNG, JPG, WEBP up to 10MB each. Large batches will be uploaded in chunks of 1000.
                </p>
              </>
            )}
          </div>
        </div>
        
        <DialogFooter>
          <Button
            onClick={handleClose}
            variant="outline"
            className="bg-transparent border-gray-700 hover:bg-gray-800 mr-2"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={selectedFiles.length === 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Upload {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
