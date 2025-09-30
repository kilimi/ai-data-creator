import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { Dataset, Image as ImageType } from "@/types";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/hooks/use-api";
import { UploadCard } from "@/components/UploadCard";
import { processCOCOAnnotations, AnnotationSample } from "@/utils/annotations";
import { ClassStatistics } from "@/components/ClassStatistics";
import { ClassStatisticsWithManagement } from "@/components/ClassStatisticsWithManagement";
import { AnnotationVisualizer } from "@/components/AnnotationVisualizer";
import { AnnotationImagesDialog } from "@/components/AnnotationImagesDialog";
import { AnnotationsUploadDialog } from "@/components/AnnotationsUploadDialog";
import { ImageUploadDialog } from "@/components/ImageUploadDialog";
import { ChunkedImageUploadDialog } from "@/components/ChunkedImageUploadDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, 
  FileImage, 
  FileJson, 
  Loader2, 
  Trash2, 
  Save,
  X,
  Pencil,
  Tag,
  Upload,
  ChevronLeft,
  ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useImageLoad } from "@/utils/animations";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Badge,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMockDataset } from "@/utils/mockData";

interface AnnotationFile {
  id: number | string; // Allow both number and string IDs
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  type: string;
  classStats: Array<{
    className: string;
    count: number;
    color: string;
  }>;
  samples: Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl: string;
  }>;
  matchedImageCount: number;
  tags: string[];
  annotation_count: number;
  processing_status?: string;
  totalReferencedImages?: number;
  presentCount?: number;
  missingCount?: number;
}

interface EditDatasetProps {
  projectMode?: boolean;
}

const EditDataset = ({ projectMode = false }: EditDatasetProps) => {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { api } = useApi(); // Add the useApi hook here

  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("images");
  
  const [images, setImages] = useState<ImageType[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationFile[]>([]);
  
  const [selectedImage, setSelectedImage] = useState<ImageType | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<AnnotationFile | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newFilename, setNewFilename] = useState("");
  const [showAnnotationsOnImage, setShowAnnotationsOnImage] = useState<AnnotationSample[]>([]);
  
  const [showAnnotationsDialog, setShowAnnotationsDialog] = useState(false);
  const [annotationsToShow, setAnnotationsToShow] = useState<AnnotationSample[]>([]);
  const [annotationFileNameToShow, setAnnotationFileNameToShow] = useState("");
  const [coverageData, setCoverageData] = useState<{
    present: Array<{ image_id: number; file_name: string }>;
    missing: Array<{ coco_image_id: number; file_name: string }>;
  } | null>(null);
  const [showCoverageDialog, setShowCoverageDialog] = useState(false);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [showImageUploadDialog, setShowImageUploadDialog] = useState(false);
  const [showChunkedUploadDialog, setShowChunkedUploadDialog] = useState(false);

  const [imageDimensions, setImageDimensions] = useState({ width: 800, height: 600 });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const imagesPerPage = 20;

  // Polling function to check for processing completion
  const pollForProcessingCompletion = async (annotationIds: number[]) => {
    let attempts = 0;
    const maxAttempts = 30; // Poll for up to 5 minutes (30 * 10 seconds)
    
    const poll = async () => {
      if (attempts >= maxAttempts) {
        toast({
          title: "Processing taking longer than expected",
          description: "Please refresh the page manually to see updated counts.",
          variant: "default",
        });
        return;
      }
      
      try {
        if (!api) {
          console.warn('API not available for polling');
          return;
        }
        
        const annotationsRes = await api.getAnnotations(id);
        if (annotationsRes?.success && annotationsRes.data) {
          const currentAnnotations = annotationsRes.data.map((apiAnnotation: any) => ({
            id: apiAnnotation.id,
            fileName: apiAnnotation.name || apiAnnotation.fileName,
            fileSize: apiAnnotation.size || apiAnnotation.fileSize || 0,
            uploadedAt: apiAnnotation.created_at || apiAnnotation.uploadedAt || new Date().toISOString(),
            type: apiAnnotation.type,
            classStats: [],
            samples: [],
            matchedImageCount: 0,
            tags: apiAnnotation.tags || [],
            annotation_count: apiAnnotation.annotation_count || 0,
            processing_status: apiAnnotation.processing_status,
          }));
          
          // Check if the target annotations are still processing
          const stillProcessing = currentAnnotations.filter(
            ann => annotationIds.includes(ann.id) && 
                   (ann.processing_status === 'pending' || ann.processing_status === 'processing')
          );
          
          // Update the state with latest data
          setAnnotations(currentAnnotations);
          
          if (stillProcessing.length === 0) {
            // All target annotations are done processing
            toast({
              title: "Processing complete",
              description: "Annotation counts have been updated.",
            });
            return;
          } else {
            // Still processing, continue polling
            attempts++;
            setTimeout(poll, 10000); // Poll every 10 seconds
          }
        }
      } catch (error) {
        console.warn('Error during polling:', error);
        attempts++;
        setTimeout(poll, 10000);
      }
    };
    
    // Start polling
    setTimeout(poll, 5000); // Wait 5 seconds before first poll
  };
  
  // Calculate pagination
  const totalPages = Math.ceil((images?.length || 0) / imagesPerPage);
  const paginatedImages = images.slice(
    (currentPage - 1) * imagesPerPage,
    currentPage * imagesPerPage
  );

  useEffect(() => {
    const fetchData = async () => {
      if (!id) {
        setLoading(false);
        return;
      }

      try {
        if (api) {
          console.log('🌐 API client available, making requests...');
          // Load real dataset data
          const [datasetRes, imagesRes, annotationsRes] = await Promise.all([
            api.getDataset(id),
            api.getImages(id),
            api.getAnnotations(id)
          ]);
          
          console.log('🌐 API responses received:', { datasetRes: !!datasetRes, imagesRes: !!imagesRes, annotationsRes: !!annotationsRes });
          
          if (datasetRes?.success && datasetRes.data) {
            setDataset(datasetRes.data);
          } else {
            // Fallback to mock data if API fails
            setDataset(getMockDataset(id));
          }
          
          if (imagesRes?.success && imagesRes.data) {
            setImages(imagesRes.data);
          }
          
          if (annotationsRes?.success && annotationsRes.data) {
            console.log('🔍 Raw annotations API response:', annotationsRes.data);
            console.log('🔍 Response type:', typeof annotationsRes.data);
            console.log('🔍 Is array:', Array.isArray(annotationsRes.data));
            console.log('🔍 First item keys:', annotationsRes.data[0] ? Object.keys(annotationsRes.data[0]) : 'No items');
            
            // Transform API response to match our AnnotationFile type
            const annotationsWithCoverage = annotationsRes.data.map((apiAnnotation: any, index: number) => {
              console.log(`🔍 Processing annotation ${index}:`, apiAnnotation);
              console.log(`🔍 annotation_count field:`, apiAnnotation.annotation_count);
              console.log(`🔍 annotation_count type:`, typeof apiAnnotation.annotation_count);
              console.log(`🔍 All fields:`, Object.keys(apiAnnotation));
              
              const transformed: AnnotationFile = {
                id: apiAnnotation.id,
                fileName: apiAnnotation.name || apiAnnotation.fileName,
                fileSize: apiAnnotation.size || apiAnnotation.fileSize || 0,
                uploadedAt: apiAnnotation.created_at || apiAnnotation.uploadedAt || new Date().toISOString(),
                type: apiAnnotation.type,
                classStats: [], // Will be populated if needed
                samples: [], // Will be populated if needed
                matchedImageCount: 0, // Will be calculated from coverage
                tags: apiAnnotation.tags || [],
                annotation_count: apiAnnotation.annotation_count || 0,
                processing_status: apiAnnotation.processing_status,
                // Coverage will be added below
              };
              
              console.log('🔍 Transformed annotation:', transformed);
              console.log('🔍 Final annotation_count in transformed:', transformed.annotation_count);
              return transformed;
            });
            
            // Load coverage data for each annotation file
            try {
              const coverageRes = await api.getDatasetAnnotationsCoverage(id);
              if (coverageRes?.success && coverageRes.data) {
                // Map coverage data to annotations
                annotationsWithCoverage.forEach(annotation => {
                  const coverage = coverageRes.data.find((c: any) => c.annotation_file_id === annotation.id);
                  if (coverage) {
                    annotation.totalReferencedImages = coverage.total_referenced_images;
                    annotation.presentCount = coverage.present_count;
                    annotation.missingCount = coverage.missing_count;
                  }
                });
              }
            } catch (error) {
              console.warn('Failed to load coverage data:', error);
            }
            
            setAnnotations(annotationsWithCoverage);
          }
        } else {
          // Fallback to mock data if no API
          setDataset(getMockDataset(id));
        }
      } catch (error) {
        console.error('Error loading dataset data:', error);
        // Fallback to mock data on error
        setDataset(getMockDataset(id));
        toast({
          variant: "destructive",
          title: "Loading error",
          description: "Failed to load dataset data, using offline mode.",
        });
      }
      
      setLoading(false);
    };
    
    fetchData();
  }, [id, toast]);

  const handleChunkedImageUpload = async (files: File[]) => {
    if (!api || !id) return;

    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    try {
      const result = await api.uploadImages(id, formData);
      if (result.success) {
        // Refresh images list
        // Refresh by fetching dataset again which includes images
        if (api) {
          const result = await api.getDataset(id);
          if (result.success && result.data) {
            // Dataset API doesn't return images, so this would need a separate API call
          }
        }
      }
    } catch (error) {
      console.error('Failed to upload chunk:', error);
      throw error;
    }
  };

  const handleImageUpload = (files: File[]) => {
    const newImages: ImageType[] = [];

    const tifToPng = async (file: File): Promise<string | null> => {
      // try dynamic import of utif; fallback to null if not available
      try {
  // Use global UTIF loaded from CDN (index.html). If it's missing, skip conversion.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny: any = window as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const UTIF = globalAny.UTIF as any;
  if (!UTIF) return null;
        const arrayBuffer = await file.arrayBuffer();
        const ifds = UTIF.decode(arrayBuffer);
        if (!ifds || ifds.length === 0) return null;
        UTIF.decodeImage(arrayBuffer, ifds[0]);
        const rgba = UTIF.toRGBA8(ifds[0]);
        const width = ifds[0].width;
        const height = ifds[0].height;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const imageData = new ImageData(new Uint8ClampedArray(rgba), width, height);
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL('image/png');
      } catch (e) {
        // utif not available or decode failed
        console.warn('TIFF conversion failed or utif not installed:', e);
        return null;
      }
    };

    const buildImageObject = async (file: File) => {
      let imageUrl = URL.createObjectURL(file);
      const lower = file.name.toLowerCase();
      if (file.type === 'image/tiff' || lower.endsWith('.tif') || lower.endsWith('.tiff')) {
        const converted = await tifToPng(file);
        if (converted) imageUrl = converted;
      }

      return {
        id: Math.random().toString(36).substring(2, 11),
        datasetId: id || "",
        fileName: file.name,
        fileSize: file.size,
        width: 1920,
        height: 1080,
        url: imageUrl,
        thumbnailUrl: imageUrl,
        uploadedAt: new Date().toISOString(),
        annotationsCount: 0,
      } as ImageType;
    };

    // build images in sequence to avoid blocking too many conversions in parallel
    (async () => {
      for (const file of files) {
        const imgObj = await buildImageObject(file);
        newImages.push(imgObj);
        setImages(prev => [...prev, imgObj]);
      }
    })();
    
  // images are appended asynchronously above; no-op here
    
    if (dataset) {
      setDataset({
        ...dataset,
        image_count: (dataset.image_count || 0) + files.length,
      });
    }
    
    toast({
      title: "Images added",
      description: `${files.length} images added successfully.`,
    });
  };

  const handleAnnotationUpload = async (files: File[]) => {
    if (!id) return;

    toast({
      title: "Importing annotations",
      description: "Processing COCO annotation files...",
    });
    
    try {
      // Use the actual API to import annotations
      const { useApi } = await import('@/hooks/use-api');
      const { api } = useApi();
      
      if (!api) {
        throw new Error('API client not available');
      }

      for (const file of files) {
        console.log(`Importing annotation file: ${file.name}`);
        const result = await api.importAnnotations(id, file);
        
        if (result.success && result.data) {
          const { imported, skipped, message, file_id } = result.data;
          
          // Update the annotations count in the dataset  
          if (dataset) {
            setDataset({
              ...dataset,
              annotation_count: (dataset.annotation_count || 0) + imported,
            });
          }
          
          toast({
            title: "Annotations imported",
            description: message || `Imported ${imported} annotations, skipped ${skipped}`,
          });
        } else {
          throw new Error(result.error || 'Failed to import annotations');
        }
      }
      
      // Refresh the annotations list after all imports are complete
      // Wait for processing to complete before showing final results
      try {
        const refreshedAnnotationsRes = await api.getAnnotations(id);
        if (refreshedAnnotationsRes?.success && refreshedAnnotationsRes.data) {
          console.log('Refreshed annotations API response:', refreshedAnnotationsRes.data);
          // Transform API response to match our AnnotationFile type
          const refreshedAnnotations = refreshedAnnotationsRes.data.map((apiAnnotation: any) => {
            console.log('Processing refreshed annotation:', apiAnnotation);
            return {
              id: apiAnnotation.id,
              fileName: apiAnnotation.name || apiAnnotation.fileName,
              fileSize: apiAnnotation.size || apiAnnotation.fileSize || 0,
              uploadedAt: apiAnnotation.created_at || apiAnnotation.uploadedAt || new Date().toISOString(),
              type: apiAnnotation.type,
              classStats: [], // Will be populated if needed
              samples: [], // Will be populated if needed
              matchedImageCount: 0, // Will be calculated from coverage
              tags: apiAnnotation.tags || [],
              annotation_count: apiAnnotation.annotation_count || 0,
              processing_status: apiAnnotation.processing_status,
            };
          });
          setAnnotations(refreshedAnnotations);
          
          // Check if any annotations are still processing
          const processingAnnotations = refreshedAnnotations.filter(
            ann => ann.processing_status === 'pending' || ann.processing_status === 'processing'
          );
          
          if (processingAnnotations.length > 0) {
            toast({
              title: "Processing annotations",
              description: `${processingAnnotations.length} annotation file(s) are still being processed. Counts will update automatically.`,
            });
            
            // Poll for processing completion
            pollForProcessingCompletion(processingAnnotations.map(a => a.id));
          }
        }
      } catch (refreshError) {
        console.warn('Failed to refresh annotations list:', refreshError);
      }
    } catch (error) {
      console.error("Error importing annotations:", error);
      toast({
        variant: "destructive",
        title: "Import failed",
        description: error instanceof Error ? error.message : "There was an error importing the annotation files.",
      });
    }
  };

  const handleDeleteImage = (image: ImageType) => {
    setImages(prevImages => prevImages.filter(img => img.id !== image.id));
    
    if (dataset) {
      setDataset({
        ...dataset,
        image_count: Math.max(0, (dataset.image_count || 0) - 1),
      });
    }
    
    if (selectedImage && selectedImage.id === image.id) {
      setSelectedImage(null);
    }
    
    toast({
      title: "Image deleted",
      description: `${image.fileName} has been removed.`,
    });
  };

  const handleDeleteAnnotation = (annotation: AnnotationFile) => {
    // Use the annotation_count from database instead of calculating from classStats
    const annotationCount = annotation.annotation_count || annotation.classStats?.reduce((acc, stat) => acc + stat.count, 0) || 0;
    
    setAnnotations(prevAnnotations => 
      prevAnnotations.filter(anno => anno.id !== annotation.id)
    );
    
    if (dataset) {
      setDataset({
        ...dataset,
        annotation_count: Math.max(0, (dataset.annotation_count || 0) - annotationCount),
      });
    }
    
    if (selectedAnnotation && selectedAnnotation.id === annotation.id) {
      setSelectedAnnotation(null);
    }
    
    if (annotation.samples && annotation.samples.length > 0 && 
        showAnnotationsOnImage.some(showAnno => 
          annotation.samples?.some(sample => sample.id === showAnno.id)
        )) {
      setShowAnnotationsOnImage([]);
    }
    
    toast({
      title: "Annotation deleted",
      description: `${annotation.fileName} has been removed.`,
    });
  };

  const handleRenameAnnotation = async () => {
    if (!selectedAnnotation || !newFilename.trim()) return;
    
    try {
      if (!api) {
        throw new Error('API client not available');
      }

      // Call the backend API to rename the annotation file
      const result = await api.renameAnnotation(id, String(selectedAnnotation.id), newFilename.trim());
      
      if (result.success) {
        // Update local state only after successful backend update
        setAnnotations(prevAnnotations => 
          prevAnnotations.map(anno => 
            anno.id === selectedAnnotation.id 
              ? { ...anno, fileName: newFilename.trim() } 
              : anno
          )
        );
        
        setSelectedAnnotation(prev => prev ? { ...prev, fileName: newFilename.trim() } : null);
        setIsRenaming(false);
        setNewFilename("");
        
        toast({
          title: "Annotation renamed",
          description: result.data?.message || "Filename has been updated successfully.",
        });
      } else {
        throw new Error(result.error || 'Failed to rename annotation file');
      }
    } catch (error) {
      console.error("Error renaming annotation:", error);
      toast({
        variant: "destructive",
        title: "Rename failed",
        description: error instanceof Error ? error.message : "There was an error renaming the annotation file.",
      });
    }
  };

  const handleShowCoverage = async (annotation: AnnotationFile) => {
    if (!id) return;
    
    try {
      const { useApi } = await import('@/hooks/use-api');
      const { api } = useApi();
      
      if (api) {
        const coverageRes = await api.getAnnotationFileCoverage(id, String(annotation.id));
        if (coverageRes?.success && coverageRes.data) {
          setCoverageData({
            present: coverageRes.data.present,
            missing: coverageRes.data.missing
          });
          setAnnotationFileNameToShow(annotation.fileName);
          setShowCoverageDialog(true);
        } else {
          toast({
            variant: "destructive",
            title: "Failed to load coverage",
            description: "Could not retrieve coverage information for this annotation file.",
          });
        }
      }
    } catch (error) {
      console.error('Error loading coverage:', error);
      toast({
        variant: "destructive",
        title: "Coverage error",
        description: "An error occurred while loading coverage data.",
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    
    try {
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      toast({
        title: "Dataset saved",
        description: "All changes have been saved successfully.",
      });
      
      // Refresh the page by navigating to the same URL
      window.location.reload();
    } catch (error) {
      console.error("Error saving dataset:", error);
      toast({
        variant: "destructive",
        title: "Save failed",
        description: "There was an error saving your changes. Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDataset = async () => {
    if (!dataset) return;
    
    try {
      // Simulating API call
      await new Promise(resolve => setTimeout(resolve, 1000));

      toast({
        title: 'Dataset deleted',
        description: 'Dataset and all associated data have been removed.',
      });

      // Navigate back to the appropriate page
      if (projectId) {
        navigate(`/projects/${projectId}`);
      } else {
        navigate('/');
      }
    } catch (error) {
      console.error('Error deleting dataset:', error);
      toast({
        variant: 'destructive',
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'There was an error deleting the dataset.',
      });
    }
    setShowDeleteConfirm(false);
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageDimensions({
      width: img.naturalWidth,
      height: img.naturalHeight
    });
  };

  const handleAnnotate = () => {
    if (!id) return;
    window.open(`/datasets/${id}/annotate`, '_blank');
  };

  // Class management handlers
  const handleRenameClass = (oldClassName: string, newClassName: string) => {
    if (!selectedAnnotation) return;
    
    const updatedAnnotation = {
      ...selectedAnnotation,
      classStats: selectedAnnotation.classStats?.map(stat => 
        stat.className === oldClassName 
          ? { ...stat, className: newClassName }
          : stat
      ),
      samples: selectedAnnotation.samples?.map(sample =>
        sample.className === oldClassName
          ? { ...sample, className: newClassName }
          : sample
      )
    };
    
    setSelectedAnnotation(updatedAnnotation);
    setAnnotations(prev => 
      prev.map(anno => anno.id === selectedAnnotation.id ? updatedAnnotation : anno)
    );
    
    toast({
      title: "Class renamed",
      description: `"${oldClassName}" has been renamed to "${newClassName}"`
    });
  };

  const handleDeleteClass = (className: string) => {
    if (!selectedAnnotation) return;
    
    const updatedAnnotation = {
      ...selectedAnnotation,
      classStats: selectedAnnotation.classStats?.filter(stat => stat.className !== className),
      samples: selectedAnnotation.samples?.filter(sample => sample.className !== className)
    };
    
    setSelectedAnnotation(updatedAnnotation);
    setAnnotations(prev => 
      prev.map(anno => anno.id === selectedAnnotation.id ? updatedAnnotation : anno)
    );
    
    toast({
      title: "Class deleted",
      description: `All annotations for "${className}" have been removed`
    });
  };

  const handleMergeClasses = (sourceClassName: string, targetClassName: string) => {
    if (!selectedAnnotation) return;
    
    const updatedAnnotation = {
      ...selectedAnnotation,
      classStats: selectedAnnotation.classStats?.map(stat => {
        if (stat.className === targetClassName) {
          const sourceCount = selectedAnnotation.classStats?.find(s => s.className === sourceClassName)?.count || 0;
          return { ...stat, count: stat.count + sourceCount };
        }
        return stat;
      }).filter(stat => stat.className !== sourceClassName),
      samples: selectedAnnotation.samples?.map(sample =>
        sample.className === sourceClassName
          ? { ...sample, className: targetClassName }
          : sample
      )
    };
    
    setSelectedAnnotation(updatedAnnotation);
    setAnnotations(prev => 
      prev.map(anno => anno.id === selectedAnnotation.id ? updatedAnnotation : anno)
    );
    
    toast({
      title: "Classes merged",
      description: `"${sourceClassName}" has been merged into "${targetClassName}"`
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navbar />
        <div className="container max-w-7xl pt-32 flex justify-center items-center">
          <div className="flex flex-col items-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-muted-foreground">Loading dataset...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="min-h-screen bg-black text-white">
        <Navbar />
        <div className="container max-w-7xl pt-32 text-center">
          <h1 className="text-2xl font-bold mb-4">Dataset not found</h1>
          <p className="text-muted-foreground mb-6">
            The dataset you're looking for doesn't exist or has been deleted.
          </p>
          <Button asChild>
            <Link to="/datasets">Return to datasets</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 bg-black text-white">
      <Navbar />
      
      <div className="bg-gray-900 py-4 border-b border-gray-800 mt-16">
        <div className="container max-w-7xl">
          <div className="flex items-center">
            <Button 
              variant="ghost" 
              asChild 
              className="mr-2 text-gray-300 hover:text-white hover:bg-gray-800"
            >
              <Link to={projectId ? `/projects/${projectId}/datasets/${id}` : `/datasets/${id}`}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Back
              </Link>
            </Button>
            <h1 className="text-xl font-semibold flex-1 text-white">
              Edit: {dataset?.name}
            </h1>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
                disabled={saving}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Dataset
              </Button>
              <Button 
                onClick={handleSave} 
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      </div>
      
      <main className="container max-w-7xl py-8">
        <div className="flex flex-col gap-6">
          <Card className="bg-gray-900 border-gray-800">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-white">Dataset Content</h2>
                <div className="text-sm text-gray-400">
                  {images.length} images • {dataset?.annotation_count} annotations
                </div>
              </div>
              
              <Tabs 
                value={activeTab} 
                onValueChange={setActiveTab}
                className="text-white"
              >
                <TabsList className="w-full justify-start gap-1 bg-gray-800/50 p-2 border-b border-gray-700">
                  <TabsTrigger 
                    value="images"
                    className="data-[state=active]:bg-blue-600 data-[state=active]:text-white px-6 py-2.5 text-base"
                  >
                    <FileImage className="h-4 w-4 mr-2" />
                    Images
                  </TabsTrigger>
                  <TabsTrigger 
                    value="annotations"
                    className="data-[state=active]:bg-blue-600 data-[state=active]:text-white px-6 py-2.5 text-base"
                  >
                    <FileJson className="h-4 w-4 mr-2" />
                    Annotations
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="images" className="space-y-4">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-medium text-white">
                      Image Gallery
                      <span className="ml-2 text-sm font-normal text-gray-400">
                        {images.length} images
                      </span>
                    </h3>
                    <div className="flex gap-2">
                      <Button 
                        onClick={() => setShowImageUploadDialog(true)}
                        size="sm"
                        variant="outline"
                      >
                        <Upload className="h-4 w-4 mr-2" /> Add Images
                      </Button>
                      <Button 
                        onClick={() => setShowChunkedUploadDialog(true)}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Upload className="h-4 w-4 mr-2" /> Bulk Upload
                      </Button>
                    </div>
                  </div>
                  
                  {images.length > 0 ? (
                    <div className="space-y-4">
                      <div className="h-[65vh] overflow-y-auto rounded-lg border border-gray-700 bg-gray-800/50">
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-3 p-3">
                          {paginatedImages.map((image) => (
                            <div 
                              key={image.id}
                              onClick={() => setSelectedImage(image)}
                              className="cursor-pointer relative group rounded-md overflow-hidden border border-gray-700 bg-gray-800 hover:border-blue-500/50 transition-colors"
                            >
                              <div className="aspect-square relative">
                                <img 
                                  src={image.thumbnailUrl} 
                                  alt={image.fileName} 
                                  className="w-full h-full object-cover"
                                />
                                {showAnnotationsOnImage.length > 0 && 
                                 showAnnotationsOnImage.some(anno => anno.imageId === image.id) && (
                                  <div className="absolute top-2 right-2">
                                    <Badge variant="secondary" className="bg-blue-600/70 backdrop-blur-sm">
                                      <Tag className="h-3 w-3 mr-1" />
                                      {showAnnotationsOnImage.filter(anno => anno.imageId === image.id).length}
                                    </Badge>
                                  </div>
                                )}
                              </div>
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Button 
                                  variant="destructive" 
                                  size="icon" 
                                  className="h-8 w-8"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteImage(image);
                                  }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      <div className="flex justify-between items-center mt-4">
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="text-white hover:text-white hover:bg-gray-800"
                          disabled={currentPage === 1}
                          onClick={() => setCurrentPage(currentPage - 1)}
                        >
                          <ChevronLeft className="h-5 w-5" />
                        </Button>
                        <span className="text-sm text-gray-400">
                          Page {currentPage} of {totalPages}
                        </span>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="text-white hover:text-white hover:bg-gray-800"
                          disabled={currentPage === totalPages}
                          onClick={() => setCurrentPage(currentPage + 1)}
                        >
                          <ChevronRight className="h-5 w-5" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center bg-gray-800 rounded-lg p-12 text-center">
                      <FileImage className="h-12 w-12 text-gray-400 mb-4" />
                      <h4 className="text-lg font-medium text-white">No images yet</h4>
                      <p className="text-gray-400 mt-1 mb-4">
                        Click the "Add Images" button to get started
                      </p>
                      <div className="flex gap-2">
                        <Button 
                          onClick={() => setShowImageUploadDialog(true)}
                          variant="outline"
                        >
                          <Upload className="h-4 w-4 mr-2" /> Add Images
                        </Button>
                        <Button 
                          onClick={() => setShowChunkedUploadDialog(true)}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          <Upload className="h-4 w-4 mr-2" /> Bulk Upload
                        </Button>
                      </div>
                    </div>
                  )}
                  
                </TabsContent>
                
                <TabsContent value="annotations" className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xl font-semibold">Annotations</h2>
                    <div className="flex gap-2">
                      <Button 
                        onClick={handleAnnotate}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Pencil className="h-4 w-4 mr-1" />
                        Annotate Images
                      </Button>
                      <Button 
                        onClick={() => setShowUploadDialog(true)}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Upload className="h-4 w-4 mr-1" /> Add Annotations
                      </Button>
                    </div>
                  </div>
                  
                  {annotations.length > 0 ? (
                    <div className="border border-gray-700 rounded-md max-h-[500px] overflow-y-auto mb-6">
                      <Table>
            <TableHeader className="bg-gray-800">
                          <TableRow className="border-b-gray-700">
                            <TableHead className="text-gray-300">Filename</TableHead>
              <TableHead className="text-gray-300">Type</TableHead>
                            <TableHead className="text-gray-300">Size</TableHead>
                            <TableHead className="text-gray-300">Date</TableHead>
                            <TableHead className="text-gray-300">Tags</TableHead>
                            <TableHead className="text-gray-300">Classes</TableHead>
                            <TableHead className="text-gray-300">Annotations</TableHead>
                            <TableHead className="text-gray-300">Images</TableHead>
                            <TableHead className="text-gray-300">Coverage</TableHead>
                            <TableHead className="w-[130px] text-gray-300">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {annotations.map((annotation) => (
                            <TableRow 
                              key={annotation.id}
                              className="cursor-pointer border-b-gray-700 hover:bg-gray-800"
                              onClick={() => setSelectedAnnotation(annotation)}
                            >
                              <TableCell className="font-medium text-white">
                                {annotation.fileName}
                              </TableCell>
                              <TableCell className="text-gray-300">
                                {annotation.type ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-200 capitalize">
                                    {annotation.type}
                                  </span>
                                ) : (
                                  <span className="text-xs text-gray-500">unknown</span>
                                )}
                              </TableCell>
                              <TableCell className="text-gray-300">
                                {(annotation.fileSize / 1024).toFixed(1)} KB
                              </TableCell>
                              <TableCell className="text-gray-300">
                                {new Date(annotation.uploadedAt).toLocaleDateString()}
                              </TableCell>
                              <TableCell className="text-gray-300">
                                <div className="flex flex-wrap gap-1">
                                  {annotation.tags && annotation.tags.length > 0 ? (
                                    <>
                                      {annotation.tags.slice(0, 2).map((tag) => (
                                        <Badge
                                          key={tag}
                                          variant="secondary"
                                          className="text-xs bg-blue-600/20 text-blue-300 border-blue-600/30"
                                        >
                                          <Tag className="h-3 w-3 mr-1" />
                                          {tag}
                                        </Badge>
                                      ))}
                                      {annotation.tags.length > 2 && (
                                        <Badge
                                          variant="secondary"
                                          className="text-xs bg-gray-600/20 text-gray-400 border-gray-600/30"
                                        >
                                          +{annotation.tags.length - 2}
                                        </Badge>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-gray-500 text-xs">No tags</span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-gray-300">
                                {annotation.classStats ? (
                                  <Badge className="bg-green-600/50">
                                    {annotation.classStats.length} classes
                                  </Badge>
                                ) : "0 classes"}
                              </TableCell>
                              <TableCell className="text-gray-300">
                                {annotation.processing_status === 'pending' || annotation.processing_status === 'processing' ? (
                                  <Badge className="bg-yellow-600/50">
                                    Processing...
                                  </Badge>
                                ) : annotation.annotation_count ? (
                                  <Badge className="bg-purple-600/50">
                                    {annotation.annotation_count} annotations
                                  </Badge>
                                ) : (
                                  <Badge className="bg-gray-600/50">
                                    0 annotations
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-gray-300">
                                {annotation.matchedImageCount ? (
                                  <Badge className="bg-blue-600/50">
                                    {annotation.matchedImageCount} matches
                                  </Badge>
                                ) : "0 matches"}
                              </TableCell>
                              <TableCell className="text-gray-300">
                                {annotation.totalReferencedImages !== undefined ? (
                                  <button
                                    className="text-xs hover:bg-gray-700 px-2 py-1 rounded transition-colors cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleShowCoverage(annotation);
                                    }}
                                    title="Click to see image details"
                                  >
                                    <span className="text-green-400">{annotation.presentCount || 0}</span>
                                    <span className="text-gray-500">/</span>
                                    <span className="text-gray-300">{annotation.totalReferencedImages}</span>
                                    {(annotation.missingCount || 0) > 0 && (
                                      <span className="text-red-400"> ({annotation.missingCount} missing)</span>
                                    )}
                                  </button>
                                ) : (
                                  <span className="text-gray-500 text-xs">No data</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button 
                                    variant="outline" 
                                    size="icon" 
                                    className={`h-8 w-8 border-gray-700 ${
                                      annotation.matchedImageCount ? "bg-blue-900/50 hover:bg-blue-800/70" : "bg-gray-800 hover:bg-gray-700"
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleShowCoverage(annotation);
                                    }}
                                    title="Show image coverage"
                                  >
                                    <Tag className={`h-4 w-4 ${annotation.matchedImageCount ? "text-blue-300" : "text-gray-400"}`} />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-8 w-8 hover:bg-gray-700"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedAnnotation(annotation);
                                      setNewFilename(annotation.fileName);
                                      setIsRenaming(true);
                                    }}
                                  >
                                    <Pencil className="h-4 w-4 text-gray-400" />
                                  </Button>
                                  <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    className="h-8 w-8 text-red-500 hover:bg-gray-700"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteAnnotation(annotation);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center bg-gray-800 rounded-lg p-12 text-center mb-6">
                      <FileJson className="h-12 w-12 text-gray-400 mb-4" />
                      <h4 className="text-lg font-medium text-white">No annotations yet</h4>
                      <p className="text-gray-400 mt-1 mb-4">
                        Upload COCO format annotation files
                      </p>
                      <Button 
                        onClick={() => setShowUploadDialog(true)}
                        className="bg-blue-600 hover:bg-blue-700"
                      >
                        <Upload className="h-4 w-4 mr-2" /> Add Annotations
                      </Button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </main>
      
      <Dialog 
        open={!!selectedImage} 
        onOpenChange={(open) => !open && setSelectedImage(null)}
      >
        <DialogContent className="max-w-3xl bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>{selectedImage?.fileName}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {selectedImage?.width}x{selectedImage?.height} • {(selectedImage?.fileSize ? (selectedImage.fileSize / 1024 / 1024).toFixed(2) : 0)} MB
            </DialogDescription>
          </DialogHeader>
          
          <div className="relative aspect-video bg-gray-950 rounded-md overflow-hidden flex items-center justify-center">
            {selectedImage && (
              <>
                <img 
                  src={selectedImage.url} 
                  alt={selectedImage.fileName} 
                  className="max-w-full max-h-full object-contain"
                  onLoad={handleImageLoad}
                />
                
                {selectedImage && showAnnotationsOnImage.filter(anno => anno.imageId === selectedImage.id).length > 0 && (
                  <AnnotationVisualizer 
                    annotations={showAnnotationsOnImage.filter(anno => anno.imageId === selectedImage.id)}
                    imageWidth={imageDimensions.width}
                    imageHeight={imageDimensions.height}
                    className="absolute inset-0"
                  />
                )}
              </>
            )}
          </div>
          
          <DialogFooter className="flex flex-col sm:flex-row justify-between gap-2">
            <div className="text-sm text-gray-400">
              {selectedImage && showAnnotationsOnImage.filter(anno => anno.imageId === selectedImage.id).length > 0 
                ? `Showing ${showAnnotationsOnImage.filter(anno => anno.imageId === selectedImage.id).length} annotations` 
                : "No annotations shown"
              }
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedImage) {
                  handleDeleteImage(selectedImage);
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Image
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog 
        open={!!selectedAnnotation && !isRenaming} 
        onOpenChange={(open) => !open && setSelectedAnnotation(null)}
      >
        <DialogContent className="max-w-2xl bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>{selectedAnnotation?.fileName}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {(selectedAnnotation?.fileSize ? (selectedAnnotation.fileSize / 1024).toFixed(1) : 0)} KB • Uploaded {selectedAnnotation?.uploadedAt && new Date(selectedAnnotation.uploadedAt).toLocaleDateString()}
            </DialogDescription>
          </DialogHeader>
          
          {selectedAnnotation?.classStats && selectedAnnotation.classStats.length > 0 ? (
            <div className="max-h-[60vh] overflow-y-auto">
              <ClassStatisticsWithManagement 
                statistics={selectedAnnotation.classStats}
                annotations={selectedAnnotation.samples || []}
                onRenameClass={handleRenameClass}
                onDeleteClass={handleDeleteClass}
                onMergeClasses={handleMergeClasses}
              />
              
              {selectedAnnotation.samples && selectedAnnotation.samples.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-2 text-white">Sample Annotations</h3>
                  <p className="text-sm text-gray-400 mb-4">
                    Showing {Math.min(5, selectedAnnotation.samples.length)} of {selectedAnnotation.samples.length} annotations
                  </p>
                  
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {selectedAnnotation.samples.slice(0, 5).map((sample, idx) => (
                      <div key={idx} className="rounded-md border border-gray-700 p-2 bg-gray-800">
                        <div className="font-medium text-white">{sample.className}</div>
                        <div className="text-xs text-gray-400">
                          Image ID: {sample.imageId.substring(0, 6)}...
                        </div>
                        {sample.confidence && (
                          <div className="text-xs text-gray-400">
                            Confidence: {Math.round(sample.confidence * 100)}%
                          </div>
                        )}
                        {sample.segmentation && (
                          <div className="text-xs text-green-400">
                            Has segmentation mask
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-gray-400">No class statistics available</p>
            </div>
          )}
          
          <DialogFooter className="flex justify-between sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="border-gray-700 bg-gray-800 hover:bg-gray-700 text-white"
                onClick={() => {
                  if (selectedAnnotation) {
                    setNewFilename(selectedAnnotation.fileName);
                    setIsRenaming(true);
                  }
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </Button>
              <Button
                variant="outline"
                className="border-gray-700 bg-gray-800 hover:bg-gray-700 text-white"
                onClick={() => {
                  if (selectedAnnotation) {
                    handleShowCoverage(selectedAnnotation);
                    setSelectedAnnotation(null);
                  }
                }}
              >
                <Tag className="mr-2 h-4 w-4" />
                Show Coverage
              </Button>
            </div>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedAnnotation) {
                  handleDeleteAnnotation(selectedAnnotation);
                }
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <Dialog open={isRenaming} onOpenChange={(open) => !open && setIsRenaming(false)}>
        <DialogContent className="sm:max-w-md bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
            <DialogDescription className="text-gray-400">
              Enter a new name for this annotation file
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="filename" className="text-right text-gray-300">
                Filename
              </Label>
              <Input
                id="filename"
                value={newFilename}
                onChange={(e) => setNewFilename(e.target.value)}
                className="col-span-3 bg-gray-800 border-gray-700 text-white"
                autoFocus
              />
            </div>
          </div>
          
          <DialogFooter>
            <DialogClose asChild>
              <Button
                variant="secondary"
                onClick={() => setIsRenaming(false)}
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              variant="default"
              onClick={handleRenameAnnotation}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <AnnotationsUploadDialog 
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
        onFilesSelected={handleAnnotationUpload}
      />
      
      <ImageUploadDialog
        open={showImageUploadDialog}
        onOpenChange={setShowImageUploadDialog}
        onFilesSelected={handleImageUpload}
      />
      
      <ChunkedImageUploadDialog
        open={showChunkedUploadDialog}
        onOpenChange={setShowChunkedUploadDialog}
        onFilesUploaded={(count) => {
          toast({
            title: "Bulk upload complete",
            description: `Successfully uploaded ${count} images`,
          });
        }}
        onUploadChunk={handleChunkedImageUpload}
        chunkSize={1000}
      />
      
      <AnnotationImagesDialog
        open={showAnnotationsDialog}
        onOpenChange={setShowAnnotationsDialog}
        annotations={annotationsToShow}
        annotationFileName={annotationFileNameToShow}
        images={images}
        onShowOnImage={(annotations) => {
          setShowAnnotationsOnImage(annotations);
          setShowAnnotationsDialog(false);
        }}
      />

      <Dialog open={showCoverageDialog} onOpenChange={setShowCoverageDialog}>
        <DialogContent className="bg-gray-900 text-white border-gray-700 max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Images for {annotationFileNameToShow}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto">
            {coverageData && (
              <>
                {coverageData.present.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-green-400 mb-2">
                      Present Images ({coverageData.present.length})
                    </h3>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {coverageData.present.map((img, index) => (
                        <div key={index} className="text-sm text-gray-300 pl-2">
                          {img.file_name}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {coverageData.missing.length > 0 && (
                  <div>
                    <h3 className="text-lg font-semibold text-red-400 mb-2">
                      Missing Images ({coverageData.missing.length})
                    </h3>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                      {coverageData.missing.map((img, index) => (
                        <div key={index} className="text-sm text-gray-300 pl-2">
                          {img.file_name || `COCO ID: ${img.coco_image_id}`}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowCoverageDialog(false)}
              className="bg-gray-800 hover:bg-gray-700"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="bg-gray-900 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>Delete Dataset</DialogTitle>
            <DialogDescription className="text-gray-400">
              This will permanently delete this dataset and all its associated images and annotations.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowDeleteConfirm(false)}
              className="bg-gray-800 hover:bg-gray-700"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteDataset}
            >
              Delete Dataset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EditDataset;
