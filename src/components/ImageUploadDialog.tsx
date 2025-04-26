
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
import { X, Upload, Plus, Image, Trash2, ZoomIn } from "lucide-react";

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
  const [previews, setPreviews] = useState<string[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [currentPreviewUrl, setCurrentPreviewUrl] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files?.length) return;
    
    const fileArray = Array.from(files);
    setSelectedFiles(prev => [...prev, ...fileArray]);
    
    // Generate previews
    fileArray.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setPreviews(prev => [...prev, e.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSelectFiles = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = () => {
    onFilesSelected(selectedFiles);
    handleClose();
  };

  const handleClose = () => {
    setSelectedFiles([]);
    setPreviews([]);
    onOpenChange(false);
  };

  const openPreview = (url: string, e: React.MouseEvent) => {
    // Don't open preview if the click was on the delete button
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    
    setCurrentPreviewUrl(url);
    setPreviewOpen(true);
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setCurrentPreviewUrl("");
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white">
          <DialogHeader>
            <DialogTitle>Upload Images</DialogTitle>
            <DialogDescription className="text-gray-400">
              Upload images to add to your dataset
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
            
            {previews.length > 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {previews.map((preview, index) => (
                    <div 
                      key={index} 
                      className="relative border border-gray-700 rounded-md overflow-hidden group cursor-pointer"
                      onClick={(e) => openPreview(preview, e)}
                    >
                      <div className="aspect-square">
                        <img 
                          src={preview} 
                          alt={`Preview ${index + 1}`} 
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button 
                          variant="destructive" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveFile(index);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  
                  <div
                    className="border border-dashed border-gray-600 rounded-md flex items-center justify-center hover:border-gray-500 transition-colors cursor-pointer aspect-square"
                    onClick={handleSelectFiles}
                  >
                    <div className="flex flex-col items-center text-gray-400">
                      <Plus className="h-8 w-8 mb-1" />
                      <span className="text-sm">Add more</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div 
                className="border-2 border-dashed border-gray-700 rounded-lg p-12 text-center hover:border-gray-600 transition-colors cursor-pointer"
                onClick={handleSelectFiles}
              >
                <Image className="mx-auto h-12 w-12 text-gray-400" />
                <div className="mt-4">
                  <Button>
                    <Upload className="mr-2 h-4 w-4" />
                    Select Images
                  </Button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  PNG, JPG, WEBP up to 10MB
                </p>
              </div>
            )}
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
      
      {/* Image Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-4xl">
          <DialogHeader>
            <DialogTitle>Image Preview</DialogTitle>
            <Button 
              variant="ghost" 
              size="icon" 
              className="absolute right-4 top-4"
              onClick={closePreview}
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogHeader>
          <div className="flex items-center justify-center p-4">
            <img 
              src={currentPreviewUrl} 
              alt="Preview" 
              className="max-h-[70vh] max-w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
