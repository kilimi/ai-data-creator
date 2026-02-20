import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { LayoutGrid, Grid3X3, Square } from "lucide-react"

interface ImageDisplayControlsProps {
  imagesPerPage: number;
  onImagesPerPageChange: (value: number) => void;
  imageSize: number;
  onImageSizeChange: (value: number[]) => void;
}

const DENSITY_PRESETS = [
  { label: "Compact", icon: LayoutGrid, size: 140, perPage: 48 },
  { label: "Comfortable", icon: Grid3X3, size: 260, perPage: 20 },
  { label: "Detail", icon: Square, size: 450, perPage: 12 },
] as const;

export function ImageDisplayControls({
  imagesPerPage,
  onImagesPerPageChange,
  imageSize,
  onImageSizeChange,
}: ImageDisplayControlsProps) {
  const activePreset = DENSITY_PRESETS.find(p => p.size === imageSize);

  return (
    <div className="flex items-center gap-6 mb-4 flex-wrap">
      {/* Density presets */}
      <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 border border-border/50">
        {DENSITY_PRESETS.map((preset) => {
          const Icon = preset.icon;
          const isActive = activePreset?.label === preset.label;
          return (
            <Button
              key={preset.label}
              variant={isActive ? "default" : "ghost"}
              size="sm"
              className={`h-8 px-3 gap-1.5 text-xs ${isActive ? "" : "text-muted-foreground"}`}
              onClick={() => {
                onImageSizeChange([preset.size]);
                onImagesPerPageChange(preset.perPage);
              }}
              title={preset.label}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{preset.label}</span>
            </Button>
          );
        })}
      </div>

      {/* Per page */}
      <div className="flex items-center gap-3">
        <Label htmlFor="imagesPerPage" className="text-xs text-muted-foreground whitespace-nowrap">Per page</Label>
        <Select
          value={imagesPerPage.toString()}
          onValueChange={(value) => onImagesPerPageChange(parseInt(value))}
        >
          <SelectTrigger className="w-20 h-8 text-xs">
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

      {/* Size slider */}
      <div className="flex items-center gap-3 flex-1 max-w-[200px]">
        <Label htmlFor="imageSize" className="text-xs text-muted-foreground whitespace-nowrap">Size</Label>
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
