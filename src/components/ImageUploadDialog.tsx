import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, X, Trash2 } from "lucide-react";

interface ImageUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (files: File[]) => void;
}

export function ImageUploadDialog({ open, onOpenChange, onUpload }: ImageUploadDialogProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const [selectedPreview, setSelectedPreview] = useState<string | null>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.type.startsWith('image/')
    );
    
    addFiles(files);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).filter(file => 
        file.type.startsWith('image/')
      );
      addFiles(files);
    }
  };

  const addFiles = (files: File[]) => {
    const newPreviews = files.map(file => URL.createObjectURL(file));
    setPreviews(prev => [...prev, ...newPreviews]);
    setSelectedFiles(prev => [...prev, ...files]);
  };

  const removeFile = (index: number) => {
    URL.revokeObjectURL(previews[index]);
    setPreviews(prev => prev.filter((_, i) => i !== index));
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    onUpload(selectedFiles);
    // Clean up URLs
    previews.forEach(url => URL.revokeObjectURL(url));
    setPreviews([]);
    setSelectedFiles([]);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Upload Images</DialogTitle>
          </DialogHeader>

          <div
            className={`mt-4 border-2 border-dashed rounded-lg p-8 text-center ${
              isDragging ? 'border-primary bg-primary/5' : 'border-border'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-2">
              Drag and drop images here, or click to select files
            </p>
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              id="file-upload"
              onChange={handleFileChange}
            />
            <Button variant="outline" asChild>
              <label htmlFor="file-upload" className="cursor-pointer">
                Select Files
              </label>
            </Button>
          </div>

          {selectedFiles.length > 0 && (
            <div className="mt-4">
              <h4 className="font-medium mb-2">Selected Images ({selectedFiles.length})</h4>
              <div className="grid grid-cols-3 gap-4 max-h-[300px] overflow-y-auto p-2">
                {previews.map((preview, index) => (
                  <div
                    key={index}
                    className="relative group aspect-square border rounded-md overflow-hidden bg-muted cursor-pointer"
                    onClick={() => setSelectedPreview(preview)}
                  >
                    <img
                      src={preview}
                      alt={`Preview ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFile(index);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => {
                previews.forEach(url => URL.revokeObjectURL(url));
                setPreviews([]);
                setSelectedFiles([]);
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={selectedFiles.length === 0}
            >
              Upload {selectedFiles.length > 0 && `(${selectedFiles.length})`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedPreview} onOpenChange={(open) => !open && setSelectedPreview(null)}>
        <DialogContent className="sm:max-w-3xl h-auto">
          <DialogHeader>
            <DialogTitle>Image Preview</DialogTitle>
          </DialogHeader>
          <div className="relative mt-4 overflow-hidden rounded-lg">
            {selectedPreview && (
              <img
                src={selectedPreview}
                alt="Large preview"
                className="w-full h-auto object-contain"
              />
            )}
          </div>
          <Button
            variant="outline"
            className="absolute right-4 top-4"
            size="icon"
            onClick={() => setSelectedPreview(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
