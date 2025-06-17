
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"

interface ImageDisplayControlsProps {
  imagesPerPage: number;
  onImagesPerPageChange: (value: number) => void;
  imageSize: number;
  onImageSizeChange: (value: number[]) => void;
}

export function ImageDisplayControls({
  imagesPerPage,
  onImagesPerPageChange,
  imageSize,
  onImageSizeChange,
}: ImageDisplayControlsProps) {
  return (
    <div className="flex items-center gap-8 mb-4">
      <div className="flex items-center gap-4">
        <Label htmlFor="imagesPerPage">Images per page:</Label>
        <Select
          value={imagesPerPage.toString()}
          onValueChange={(value) => onImagesPerPageChange(parseInt(value))}
        >
          <SelectTrigger className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="12">12</SelectItem>
            <SelectItem value="20">20</SelectItem>
            <SelectItem value="32">32</SelectItem>
            <SelectItem value="48">48</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-4 flex-1 max-w-xs">
        <Label htmlFor="imageSize">Image size:</Label>
        <Slider
          id="imageSize"
          min={100}
          max={600}
          step={20}
          value={[imageSize]}
          onValueChange={onImageSizeChange}
          className="flex-1"
        />
      </div>
    </div>
  );
}
