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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Video, Upload } from "lucide-react";

export interface VideoUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (file: File, params: { interval_seconds: number; max_frames: number }) => void;
  isUploading?: boolean;
}

const VIDEO_ACCEPT = "video/mp4,video/avi,video/quicktime,video/x-matroska,video/webm,video/x-m4v,video/x-ms-wmv";

export function VideoUploadDialog({
  open,
  onOpenChange,
  onSubmit,
  isUploading = false
}: VideoUploadDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [framesPerSecond, setFramesPerSecond] = useState(24);
  const [maxFramesText, setMaxFramesText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
  };

  const handleSelectFile = () => {
    fileInputRef.current?.click();
  };

  const handleSubmit = () => {
    if (!selectedFile) return;
    const safeFps = framesPerSecond > 0 ? framesPerSecond : 24;
    const intervalSeconds = 1 / safeFps;
    const trimmed = maxFramesText.trim();
    const parsedLimit = trimmed === "" ? 0 : Math.max(0, parseInt(trimmed, 10) || 0);
    onSubmit(selectedFile, {
      interval_seconds: intervalSeconds,
      max_frames: parsedLimit
    });
  };

  const handleClose = () => {
    setSelectedFile(null);
    setFramesPerSecond(24);
    setMaxFramesText("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white">
        <DialogHeader>
          <DialogTitle>Upload Video</DialogTitle>
          <DialogDescription className="text-gray-400">
            Extract frames from a video and add them as images to your dataset. Supports MP4, AVI, MOV, MKV, WebM, M4V, WMV.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 space-y-4">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
            accept={VIDEO_ACCEPT}
          />

          <div
            className="border-2 border-dashed border-gray-700 rounded-lg p-6 text-center hover:border-gray-600 transition-colors cursor-pointer"
            onClick={handleSelectFile}
          >
            <Upload className="mx-auto h-8 w-8 text-gray-400 mb-2" />
            <p className="text-sm font-medium">
              {selectedFile ? selectedFile.name : "Select video file"}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {selectedFile
                ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                : "MP4, AVI, MOV, MKV, WebM, M4V, WMV"}
            </p>
          </div>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="frames_per_second" className="text-gray-300">
                Frames per second
              </Label>
              <Input
                id="frames_per_second"
                type="number"
                min={0.1}
                step={1}
                value={framesPerSecond}
                onChange={(e) => setFramesPerSecond(Number(e.target.value) || 24)}
                className="bg-gray-800 border-gray-600 text-white"
              />
              <p className="text-xs text-gray-500">
                e.g. 24 = 24 fps, 1 = one frame per second, 0.5 ≈ one frame every 2 seconds
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_frames" className="text-gray-300">
                Maximum frames (optional)
              </Label>
              <Input
                id="max_frames"
                type="number"
                min={0}
                value={maxFramesText}
                onChange={(e) => setMaxFramesText(e.target.value)}
                className="bg-gray-800 border-gray-600 text-white"
              />
              <p className="text-xs text-gray-500">
                Leave empty to use all frames at this frame rate. Set a number to cap total extracted frames.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleClose}
            variant="outline"
            className="bg-transparent border-gray-700 hover:bg-gray-800 mr-2"
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selectedFile || isUploading}
            className="bg-blue-600 hover:bg-blue-700 gap-2"
          >
            {isUploading ? (
              <>
                <span className="animate-pulse">Extracting...</span>
              </>
            ) : (
              <>
                <Video className="w-4 h-4" />
                Extract &amp; Upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
