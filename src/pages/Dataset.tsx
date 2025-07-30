import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Dataset as DatasetType, Image } from "@/types";
import { ImageUploadDialog } from "@/components/ImageUploadDialog";
import { DatasetHeader } from "@/components/DatasetHeader";
import { DatasetBreadcrumb } from "@/components/DatasetBreadcrumb";
import { EditDatasetDialog } from "@/components/EditDatasetDialog";
import { AnnotationSample } from "@/utils/annotations";
import { LayoutControls, LayoutType } from "@/components/LayoutControls";
import { ResizableDatasetLayout } from "@/components/ResizableDatasetLayout";
import { useDatasetSettings } from "@/hooks/useDatasetSettings";

export default function Dataset() {
  const { id } = useParams<{ id: string }>();
  const { api } = useApi();
  const { toast } = useToast();
  const [dataset, setDataset] = useState<DatasetType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [images, setImages] = useState<Image[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [visibleAnnotations, setVisibleAnnotations] = useState<AnnotationSample[]>([]);
  const [importedAnnotations, setImportedAnnotations] = useState<AnnotationSample[]>([]);
  
  // Upload progress state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [currentChunk, setCurrentChunk] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  
  // Use persistent settings hook with better ID handling
  const datasetId = id || '';
  const { settings, isLoaded: settingsLoaded, updateImagesPerPage, updateImageSize, updateLayout, updateSliderPosition } = useDatasetSettings(datasetId);
  
  console.log('Dataset component render - ID:', id, 'Settings loaded:', settingsLoaded, 'Current settings:', settings);
  
  // Calculate pagination values using persistent settings
  const totalPages = Math.ceil((images?.length || 0) / settings.imagesPerPage);
  
  // Update currentPage when imagesPerPage changes
  useEffect(() => {
    const newTotalPages = Math.ceil(images.length / settings.imagesPerPage);
    if (currentPage > newTotalPages && newTotalPages > 0) {
      setCurrentPage(1);
    }
  }, [settings.imagesPerPage, images.length, currentPage]);

  // Calculate paginated images using persistent settings
  const paginatedImages = images.slice(
    (currentPage - 1) * settings.imagesPerPage,
    currentPage * settings.imagesPerPage
  );

  const fetchDataset = async () => {
    if (!id || !api) return;

    try {
      setIsLoading(true);
      const response = await api.getDataset(id);
      if (response.success && response.data) {
        setDataset(response.data);
        
        // If dataset has project_id, fetch the project name
        if (response.data.project_id) {
          setProjectId(response.data.project_id.toString());
          const projectResponse = await api.getProject(response.data.project_id.toString());
          if (projectResponse.success && projectResponse.data) {
            setProjectName(projectResponse.data.name);
          }
        }
        
        const imagesResponse = await api.getImages(id);
        if (imagesResponse.success && imagesResponse.data) {
          setImages(imagesResponse.data);
        }
      } else {
        toast({
          title: "Error",
          description: "Failed to load dataset",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Error fetching dataset:', error);
      toast({
        title: "Error",
        description: "Failed to load dataset",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDataset();
  }, [id, api, toast]);

  // Re-evaluate annotations when images change (fixes issue when annotations are uploaded before images)
  useEffect(() => {
    if (images.length > 0 && visibleAnnotations.length > 0) {
      // Find any stored annotation files that might need to be re-processed
      const savedAnnotations = localStorage.getItem(`annotations_${id}`);
      if (savedAnnotations) {
        try {
          const annotationFiles = JSON.parse(savedAnnotations);
          const savedVisibility = localStorage.getItem(`annotation_visibility_${id}`);
          if (savedVisibility) {
            const visibilityArray: string[] = JSON.parse(savedVisibility);
            const visibilitySet = new Set(visibilityArray);
            
            // Collect all visible annotations from stored files
            const allVisibleAnnotations: AnnotationSample[] = [];
            annotationFiles.forEach((file: any) => {
              if (visibilitySet.has(file.id) && file.samples) {
                const samplesWithFileName = file.samples.map((sample: any) => ({
                  ...sample,
                  annotationFileName: file.name
                }));
                allVisibleAnnotations.push(...samplesWithFileName);
              }
            });
            
            if (allVisibleAnnotations.length > 0) {
              setShowAnnotations(true);
              setVisibleAnnotations(allVisibleAnnotations);
            }
          }
        } catch (error) {
          console.error('Error re-processing annotations after image load:', error);
        }
      }
    }
  }, [images.length, id]);

  const handleUploadImages = async (files: File[]) => {
    if (!api || !id) return;

    const CHUNK_SIZE = 1000; // Upload in chunks of 1000 files
    const totalFiles = files.length;
    const totalChunks = Math.ceil(totalFiles / CHUNK_SIZE);

    // Check total file count limit (5000)
    if (totalFiles > 5000) {
      toast({
        title: "Too Many Files",
        description: `Maximum 5000 files allowed. You selected ${totalFiles} files. Please select fewer files.`,
        variant: "destructive",
      });
      setIsUploadDialogOpen(false);
      return;
    }

    // Initialize progress tracking
    setIsUploading(true);
    setUploadProgress(0);
    setUploadedCount(0);
    setTotalFiles(totalFiles);
    setCurrentChunk(0);
    setTotalChunks(totalChunks);

    try {
      let allUploadedImages: any[] = [];
      let totalUploaded = 0;

      // Process files in chunks
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const startIndex = chunkIndex * CHUNK_SIZE;
        const endIndex = Math.min(startIndex + CHUNK_SIZE, totalFiles);
        const chunk = files.slice(startIndex, endIndex);
        
        // Update current chunk information
        setCurrentChunk(chunkIndex + 1);
        
        console.log(`DEBUG: Uploading chunk ${chunkIndex + 1}/${totalChunks} (${chunk.length} files)`);

        const formData = new FormData();
        chunk.forEach((file) => {
          formData.append('files', file);
        });

        // Create a custom XMLHttpRequest for progress tracking
        const xhr = new XMLHttpRequest();
        
        // Set up progress tracking for this chunk
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const chunkProgress = (event.loaded / event.total) * 100;
            const overallProgress = ((chunkIndex * CHUNK_SIZE + (event.loaded / event.total) * chunk.length) / totalFiles) * 100;
            setUploadProgress(Math.round(overallProgress));
          }
        };

        // Create a promise for the chunk upload
        const uploadPromise = new Promise<any>((resolve, reject) => {
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const response = JSON.parse(xhr.responseText);
                resolve(response);
              } catch (e) {
                reject(new Error('Invalid response format'));
              }
            } else {
              try {
                const errorResponse = JSON.parse(xhr.responseText);
                console.log('DEBUG: Error response:', errorResponse);
                console.log('DEBUG: Response status:', xhr.status);
                console.log('DEBUG: Response headers:', xhr.getAllResponseHeaders());
                reject(new Error(errorResponse.detail || `HTTP ${xhr.status}`));
              } catch (e) {
                console.log('DEBUG: Failed to parse error response:', xhr.responseText);
                reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
              }
            }
          };

          xhr.onerror = () => reject(new Error('Network error'));
          xhr.ontimeout = () => reject(new Error('Upload timeout'));
        });

        // Get the API base URL from localStorage or environment
        const apiBaseUrl = localStorage.getItem("apiBaseUrl") || 
                          import.meta.env.VITE_API_URL || 
                          'http://localhost:9999';
        
        console.log('DEBUG: Upload URL:', `${apiBaseUrl}/datasets/${id}/images`);
        console.log('DEBUG: Chunk file count:', chunk.length);
        
        // Configure and send the request
        xhr.open('POST', `${apiBaseUrl}/datasets/${id}/images`);
        xhr.timeout = 300000; // 5 minute timeout per chunk
        xhr.send(formData);

        // Wait for this chunk to complete
        const response = await uploadPromise;
        
        // Check if the response has a success field
        const isSuccess = response.success !== false;
        
        if (isSuccess) {
          // Update images state with the newly uploaded images from this chunk
          const responseData = response.data || response;
          if (responseData?.images) {
            allUploadedImages.push(...responseData.images);
            totalUploaded += responseData.uploaded || chunk.length;
          } else {
            totalUploaded += chunk.length;
          }
          
          setUploadedCount(totalUploaded);
          
          toast({
            title: `Chunk ${chunkIndex + 1}/${totalChunks} Complete`,
            description: `Uploaded ${chunk.length} images (${totalUploaded}/${totalFiles} total)`,
          });
        } else {
          throw new Error(response.error || `Upload failed for chunk ${chunkIndex + 1}`);
        }

        // Small delay between chunks to avoid overwhelming the server
        if (chunkIndex < totalChunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Increased delay to 2 seconds
        }
      }

      // Update the images state with all uploaded images
      if (allUploadedImages.length > 0) {
        setImages(prevImages => [...prevImages, ...allUploadedImages]);
      }

      toast({
        title: "Upload Complete!",
        description: `Successfully uploaded all ${totalFiles} images in ${totalChunks} chunks`,
      });

    } catch (error) {
      console.error('Error uploading images:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Check if it's a file limit error
      if (errorMessage.includes('Too many files') || errorMessage.includes('File limit')) {
        toast({
          title: "File Limit Exceeded",
          description: errorMessage,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Upload Error",
          description: errorMessage || "Failed to upload images",
          variant: "destructive",
        });
      }
    } finally {
      // Reset progress state
      setIsUploading(false);
      setUploadProgress(0);
      setUploadedCount(0);
      setTotalFiles(0);
      setCurrentChunk(0);
      setTotalChunks(0);
      setIsUploadDialogOpen(false);
    }
  };
  const handleDeleteImage = async (imageId: string) => {
    if (!id) return;
    
    try {
      // Always delete locally first
      setImages(prevImages => prevImages.filter(image => image.id !== imageId));
      
      // Adjust current page if needed after deletion
      if (paginatedImages.length === 1 && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      }
      
      // Try to delete via API if available (but don't fail if it doesn't work)
      if (api) {
        try {
          const response = await api.deleteImage(id, imageId);
          if (response.success) {
            console.log('Image deleted from backend successfully');
          } else {
            console.warn('Backend delete failed (this is non-critical):', response.error);
          }
        } catch (apiError) {
          console.warn('Backend delete failed (this is non-critical):', apiError);
          // Don't fail the whole process if backend fails - local deletion already succeeded
        }
      } else {
        console.log('No API available, skipping backend delete');
      }
      
      toast({
        title: "Success",
        description: "Image deleted successfully",
      });
      
    } catch (error) {
      console.error('Error deleting image:', error);
      toast({
        title: "Error",
        description: "Failed to delete image",
        variant: "destructive",
      });
    }
  };

  // Handle dataset updates
  const handleDatasetUpdated = (updatedDataset: DatasetType) => {
    setDataset(updatedDataset);
    toast({
      title: "Success",
      description: "Dataset updated successfully",
    });
  };

  // Handle opening edit dialog
  const handleEditDataset = () => {
    setIsEditDialogOpen(true);
  };
  // Updated function to handle annotation imports with better error handling
  const handleImportAnnotations = async (files: File[]) => {
    if (!id) return;

    try {
      const successfulImports: string[] = [];
      const failedImports: Array<{ fileName: string; error: string }> = [];
      const allImportedAnnotations: AnnotationSample[] = [];
      
      for (const file of files) {
        try {
          console.log(`Processing annotation file locally: ${file.name}`);
          
          // Validate file type
          if (!file.name.toLowerCase().endsWith('.json')) {
            throw new Error('Only JSON files are supported for COCO annotations');
          }
          
          // Process the COCO file to get annotation data for local display only
          // The AnnotationsContent component handles the backend import
          const { processCOCOAnnotations } = await import('@/utils/annotations');
          const result = await processCOCOAnnotations(file, id);
          
          // Add to local state for immediate display
          allImportedAnnotations.push(...result.samples);
          
          // Note: Backend import is handled by AnnotationsContent component
          // to avoid duplicate API calls
          
          successfulImports.push(file.name);
          
        } catch (fileError) {
          console.error(`Error processing file ${file.name}:`, fileError);
          failedImports.push({
            fileName: file.name,
            error: fileError instanceof Error ? fileError.message : 'Unknown error occurred'
          });
        }
      }
      
      // Update local state with successfully imported annotations
      if (allImportedAnnotations.length > 0) {
        setImportedAnnotations(prev => [...prev, ...allImportedAnnotations]);
      }
      
      // Show appropriate success/error messages
      if (successfulImports.length > 0) {
        toast({
          title: "Annotations imported",
          description: `Successfully imported ${successfulImports.length} annotation file(s): ${successfulImports.join(', ')}`,
        });
      }
      
      if (failedImports.length > 0) {
        const errorDetails = failedImports.map(fail => `${fail.fileName}: ${fail.error}`).join('\n');
        toast({
          variant: "destructive",
          title: "Import errors",
          description: `Failed to import ${failedImports.length} file(s):\n${errorDetails}`,
        });
      }
      
      if (successfulImports.length === 0 && failedImports.length > 0) {
        // All imports failed
        throw new Error(`All ${failedImports.length} file(s) failed to import`);
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
  // Updated function to handle annotation visibility changes with actual annotations
  const handleShowAnnotationsChange = (show: boolean, annotations: AnnotationSample[], annotationFiles?: any[]) => {
    setShowAnnotations(show);
    
    if (show && annotations.length > 0) {
      // Store all annotations - filtering will happen at display time
      setVisibleAnnotations(annotations);
    } else {
      setVisibleAnnotations([]);
    }
  };

  // Add state and persistence for selected image index (annotation position)
  const LS_ANNOTATION_POSITION_KEY = "imagesTab_selectedImageIndex";
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(() => {
    const saved = localStorage.getItem(LS_ANNOTATION_POSITION_KEY);
    if (saved !== null) {
      const parsed = parseInt(saved, 10);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  });

  useEffect(() => {
    if (selectedImageIndex !== null) {
      localStorage.setItem(LS_ANNOTATION_POSITION_KEY, selectedImageIndex.toString());
    } else {
      localStorage.removeItem(LS_ANNOTATION_POSITION_KEY);
    }
  }, [selectedImageIndex]);

  // Fix the image size change handler to properly handle the array format
  const handleImageSizeChange = (value: number[]) => {
    updateImageSize(value[0]);
  };

  if (!settingsLoaded) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 flex flex-col pt-16">
        <div className="px-6 py-4 border-b bg-background">
          <div>
            <DatasetBreadcrumb 
              projectId={projectId} 
              projectName={projectName} 
              datasetName={dataset?.name}
              isLoading={isLoading}
            />
            <DatasetHeader 
              isLoading={isLoading} 
              name={dataset?.name}
              currentLayout={settings.layout}
              onLayoutChange={updateLayout}
              dataset={dataset}
              onEditDataset={handleEditDataset}
            />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ResizableDatasetLayout
            layout={settings.layout}
            id={id || ''}
            images={images}
            currentPage={currentPage}
            imagesPerPage={settings.imagesPerPage}
            imageSize={settings.imageSize}
            sliderPosition={settings.sliderPosition}
            onImagesPerPageChange={updateImagesPerPage}
            onImageSizeChange={handleImageSizeChange}
            onSliderPositionChange={updateSliderPosition}
            onPageChange={setCurrentPage}
            onOpenUploadDialog={() => setIsUploadDialogOpen(true)}
            onDeleteImage={handleDeleteImage}
            paginatedImages={paginatedImages}
            totalPages={totalPages}
            annotations={showAnnotations ? visibleAnnotations : []}
            onImportAnnotations={handleImportAnnotations}
            onShowAnnotationsChange={handleShowAnnotationsChange}
            selectedImageIndex={selectedImageIndex}
            setSelectedImageIndex={setSelectedImageIndex}
          />
        </div>
        <ImageUploadDialog 
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onFilesSelected={handleUploadImages}
        />
        {dataset && (
          <EditDatasetDialog
            dataset={dataset}
            open={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
            onDatasetUpdated={handleDatasetUpdated}
          />
        )}
        {isUploading && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
            <div className="bg-background p-6 rounded-lg shadow-lg max-w-md w-full mx-4 border">
              <div className="text-center space-y-4">
                <div className="text-lg font-semibold">Uploading Images</div>
                {totalChunks > 1 && (
                  <div className="text-sm text-muted-foreground">
                    Processing chunk {currentChunk} of {totalChunks}
                  </div>
                )}
                <div className="space-y-2">
                  <div className="w-full bg-secondary rounded-full h-2.5">
                    <div 
                      className="bg-primary h-2.5 rounded-full transition-all duration-300 ease-out" 
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {uploadProgress}% complete
                    {totalFiles > 0 && (
                      <span className="ml-2">
                        ({uploadedCount}/{totalFiles} files)
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {totalChunks > 1 
                    ? `Uploading in ${totalChunks} chunks of 1000 files each...` 
                    : "Please wait while your images are being uploaded..."
                  }
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
