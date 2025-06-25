import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pencil, Save, ArrowLeft, Plus, X, Eye, EyeOff } from "lucide-react";
import { Image } from "@/types";
import { useApi } from "@/hooks/use-api";
import { API_CONFIG } from "@/config/api";

const ImageAnnotation = () => {
  const { id: datasetId } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { api } = useApi();
  const [images, setImages] = useState<Image[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [classes, setClasses] = useState<string[]>([]);
  const [newClass, setNewClass] = useState("");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);

  useEffect(() => {
    const loadImagesAndAnnotations = async () => {
      if (!datasetId || !api) return;
      try {
        setLoading(true);
        const [imagesRes, annRes] = await Promise.all([
          api.getImages(datasetId),
          fetch(`${API_CONFIG.baseUrl}/datasets/${datasetId}/annotations`).then(r => r.json())
        ]);
        let images = imagesRes.success && imagesRes.data ? imagesRes.data : [];
        let annotations = annRes.success && annRes.data ? annRes.data : [];
        // Group annotations by imageId
        const annByImage = {};
        for (const ann of annotations) {
          if (!annByImage[ann.imageId]) annByImage[ann.imageId] = [];
          annByImage[ann.imageId].push(ann);
        }
        // Attach annotations to images
        images = images.map(img => ({ ...img, annotations: annByImage[img.id] || [] }));
        setImages(images);
      } catch (error) {
        console.error('Error loading images/annotations:', error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load images or annotations",
        });
      } finally {
        setLoading(false);
      }
    };
    loadImagesAndAnnotations();
  }, [datasetId, api, toast]);

  const handleAddClass = () => {
    if (newClass.trim() && !classes.includes(newClass.trim())) {
      setClasses([...classes, newClass.trim()]);
      setNewClass("");
    }
  };

  const handleRemoveClass = (classToRemove: string) => {
    setClasses(classes.filter(c => c !== classToRemove));
    setSelectedClasses(selectedClasses.filter(c => c !== classToRemove));
  };

  const handleClassToggle = (className: string) => {
    setSelectedClasses(prev => 
      prev.includes(className) 
        ? prev.filter(c => c !== className)
        : [...prev, className]
    );
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (direction === 'prev' && currentImageIndex > 0) {
      setCurrentImageIndex(prev => prev - 1);
    } else if (direction === 'next' && currentImageIndex < images.length - 1) {
      setCurrentImageIndex(prev => prev + 1);
    }
    setSelectedClasses([]);
  };

  const handleSaveAnnotation = async () => {
    // TODO: Implement annotation saving
    toast({
      title: "Annotations saved",
      description: `Saved classes: ${selectedClasses.join(", ")}`,
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="flex justify-center items-center h-[60vh]">
          Loading images...
        </div>
      </div>
    );
  }

  if (!images.length) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="flex justify-center items-center h-[60vh]">
          No images found in this dataset
        </div>
      </div>
    );
  }

  const currentImage = images[currentImageIndex];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="container max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <Button
            variant="ghost"
            onClick={() => window.history.back()}
            className="text-gray-300 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dataset
          </Button>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-400">
              Image {currentImageIndex + 1} of {images.length}
            </div>
            <Button
              variant="ghost"
              className="text-gray-300 hover:text-white flex items-center"
              onClick={() => setShowAnnotations((v) => !v)}
            >
              {showAnnotations ? <Eye className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
              {showAnnotations ? "Visible" : "Hidden"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Image Preview */}
          <div className="md:col-span-2">
            <Card className="bg-gray-800 border-gray-700 p-4">
              <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
                <img
                  src={currentImage.url}
                  alt={currentImage.fileName}
                  className="w-full h-full object-contain"
                />
                {/* Render SVG polygons if showAnnotations is true and currentImage.annotations exists */}
                {showAnnotations && Array.isArray(currentImage.annotations) && currentImage.annotations.length > 0 && (
                  <svg
                    className="absolute top-0 left-0 w-full h-full pointer-events-none"
                    viewBox="0 0 1000 562" // 16:9 aspect ratio, adjust as needed
                    style={{ zIndex: 2 }}
                  >
                    {currentImage.annotations.map((ann, idx) =>
                      Array.isArray(ann.segmentation)
                        ? ann.segmentation.map((seg, sidx) => (
                            <polygon
                              key={idx + '-' + sidx}
                              points={seg.reduce((acc, val, i) =>
                                i % 2 === 0
                                  ? acc + (i > 0 ? ' ' : '') + `${val},${seg[i + 1]}`
                                  : acc,
                                ''
                              )}
                              fill="rgba(0, 255, 0, 0.2)"
                              stroke="#00FF00"
                              strokeWidth={2}
                            />
                          ))
                        : null
                    )}
                  </svg>
                )}
              </div>
              
              <div className="flex justify-between mt-4">
                <Button
                  onClick={() => handleNavigate('prev')}
                  disabled={currentImageIndex === 0}
                  variant="secondary"
                >
                  Previous
                </Button>
                <Button
                  onClick={() => handleNavigate('next')}
                  disabled={currentImageIndex === images.length - 1}
                  variant="secondary"
                >
                  Next
                </Button>
              </div>
            </Card>
          </div>

          {/* Annotation Controls */}
          <div className="space-y-6">
            <Card className="bg-gray-800 border-gray-700 p-4">
              <h3 className="text-lg font-medium mb-4">Classes</h3>
              
              <div className="flex gap-2 mb-4">
                <Input
                  value={newClass}
                  onChange={(e) => setNewClass(e.target.value)}
                  placeholder="Add new class"
                  className="bg-gray-900 border-gray-700"
                />
                <Button onClick={handleAddClass} size="icon">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                {classes.map((className) => (
                  <div
                    key={className}
                    className="flex items-center justify-between bg-gray-900 rounded-lg p-2"
                  >
                    <Badge
                      variant={selectedClasses.includes(className) ? "default" : "secondary"}
                      className="cursor-pointer flex-1 justify-center"
                      onClick={() => handleClassToggle(className)}
                    >
                      {className}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-gray-400 hover:text-white"
                      onClick={() => handleRemoveClass(className)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {selectedClasses.length > 0 && (
                <div className="mt-6">
                  <Button onClick={handleSaveAnnotation} className="w-full">
                    <Save className="h-4 w-4 mr-2" />
                    Save Annotations
                  </Button>
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageAnnotation;
