
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";

interface ClassColorOpacityPickerProps {
  className: string;
  color: string;
  opacity: number;
  onColorOpacityChange: (className: string, color: string, opacity: number) => void;
}

export function ClassColorOpacityPicker({ 
  className, 
  color, 
  opacity, 
  onColorOpacityChange 
}: ClassColorOpacityPickerProps) {
  const [tempColor, setTempColor] = useState(color);
  const [tempOpacity, setTempOpacity] = useState(opacity);

  const predefinedColors = [
    "#ea384c", "#F97316", "#1EAEDB", "#8B5CF6", "#2ecc71", 
    "#f39c12", "#9b59b6", "#e74c3c", "#3498db", "#e67e22",
    "#95a5a6", "#34495e", "#1abc9c", "#16a085", "#27ae60"
  ];

  const handleApply = () => {
    onColorOpacityChange(className, tempColor, tempOpacity);
  };

  const handleReset = () => {
    setTempColor(color);
    setTempOpacity(opacity);
  };

  return (
    <Card className="p-4 bg-gray-800 border-gray-700">
      <div className="space-y-4">
        <div>
          <Label className="text-sm font-medium mb-2 block">
            Configuring: {className}
          </Label>
        </div>

        <div>
          <Label className="text-sm font-medium mb-2 block">Color</Label>
          <div className="flex gap-2 mb-3">
            <Input
              type="color"
              value={tempColor}
              onChange={(e) => setTempColor(e.target.value)}
              className="w-16 h-8 p-1 border"
            />
            <Input
              type="text"
              value={tempColor}
              onChange={(e) => setTempColor(e.target.value)}
              placeholder="#000000"
              className="flex-1 h-8"
            />
          </div>
          
          <div className="grid grid-cols-5 gap-2">
            {predefinedColors.map((presetColor) => (
              <button
                key={presetColor}
                className={`w-8 h-8 rounded border-2 ${
                  tempColor === presetColor ? 'border-white' : 'border-gray-600'
                }`}
                style={{ backgroundColor: presetColor }}
                onClick={() => setTempColor(presetColor)}
              />
            ))}
          </div>
        </div>

        <div>
          <Label className="text-sm font-medium mb-2 block">
            Opacity: {Math.round(tempOpacity * 100)}%
          </Label>
          <Slider
            value={[tempOpacity]}
            onValueChange={(value) => setTempOpacity(value[0])}
            max={1}
            min={0}
            step={0.05}
            className="w-full"
          />
        </div>

        <div className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg">
          <span className="text-sm">Preview:</span>
          <div
            className="w-8 h-8 rounded border border-gray-600"
            style={{ 
              backgroundColor: `${tempColor}${Math.round(tempOpacity * 255).toString(16).padStart(2, '0')}`
            }}
          />
          <span className="text-sm text-gray-400">
            {tempColor} at {Math.round(tempOpacity * 100)}%
          </span>
        </div>
        
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            className="flex-1"
          >
            Reset
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            className="flex-1"
          >
            Apply
          </Button>
        </div>
      </div>
    </Card>
  );
}
