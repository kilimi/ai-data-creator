import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Navbar } from "@/components/Navbar";
import { useApi } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Dataset as DatasetType, Image, ImageCollection } from "@/types";
import { ImageUploadDialog } from "@/components/ImageUploadDialog";
import { VideoUploadDialog } from "@/components/VideoUploadDialog";
import { DatasetHeader } from "@/components/DatasetHeader";
import { DatasetBreadcrumb } from "@/components/DatasetBreadcrumb";
import { EditDatasetDialog } from "@/components/EditDatasetDialog";
import { AnnotationSample, processCOCOAnnotations } from "@/utils/annotations";
import { LayoutControls, LayoutType } from "@/components/LayoutControls";
import { ResizableDatasetLayout } from "@/components/ResizableDatasetLayout";
import { useDatasetSettings } from "@/hooks/useDatasetSettings";
import { 
  imageCollectionsApi, 
  convertToFrontendImageCollection, 
  ImageCollectionData 
} from "@/utils/imageCollections";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Session cache: once we've loaded a dataset id, don't show full-page loading again for it (avoids "Loading dataset" when component remounts during auto-annotate, etc.)
const loadedDatasetIds = new Set<string>();

export default function Dataset() {
  const { id, projectId } = useParams<{ id: string; projectId?: string }>();
  const { api } = useApi();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [dataset, setDataset] = useState<DatasetType | null>(null);
  const [isLoading, setIsLoading] = useState(() => (id ? !loadedDatasetIds.has(id) : true));
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isVideoUploadDialogOpen, setIsVideoUploadDialogOpen] = useState(false);
  const [isVideoUploading, setIsVideoUploading] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [images, setImages] = useState<Image[]>([]);
  const [imageCollections, setImageCollections] = useState<ImageCollection[]>([]);
  const [useTabbedImages, setUseTabbedImages] = useState(true); // Feature flag for tabbed images
  const [currentPage, setCurrentPage] = useState(1);
  const [datasetProjectId, setDatasetProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [visibleAnnotations, setVisibleAnnotations] = useState<AnnotationSample[]>([]);
  const [importedAnnotations, setImportedAnnotations] = useState<AnnotationSample[]>([]);
  
  // Compute the effective project ID (URL parameter takes precedence)
  const effectiveProjectId = projectId || datasetProjectId;
  
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
  
  // Load image collections from database (use same API client as rest of app so base URL is consistent)
  const loadImageCollections = async (): Promise<void> => {
    if (!datasetId) return;
    if (!api) return;

    try {
      let backendCollections: ImageCollectionData[];
      const response = await api.getImageCollections(datasetId);
      if (response.success && response.data) {
        backendCollections = response.data as ImageCollectionData[];
      } else {
        throw new Error(response.error || 'Failed to fetch image collections');
      }

      // Convert to frontend format
      const frontendCollections = backendCollections.map(collection =>
        convertToFrontendImageCollection(collection, settings.imagesPerPage)
      );

      setImageCollections(frontendCollections);

      // If no collections exist, initialize default collection then reload
      if (backendCollections.length === 0) {
        await imageCollectionsApi.initializeDefaultCollection(datasetId);
        const reloadResponse = await api.getImageCollections(datasetId);
        if (reloadResponse.success && reloadResponse.data) {
          const newCollections = reloadResponse.data as ImageCollectionData[];
          setImageCollections(
            newCollections.map((c) =>
              convertToFrontendImageCollection(c, settings.imagesPerPage)
            )
          );
        }
      }
    } catch (error) {
      console.error('Error loading image collections:', error);
      toast({
        title: "Error",
        description: "Failed to load image collections",
        variant: "destructive",
      });
    }
  };
  
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

  // Utility functions for managing image collections
  const createImageCollection = (id: string, name: string, images: Image[]): ImageCollection => {
    const imagesPerPage = settings.imagesPerPage;
    const totalPages = Math.ceil(images.length / imagesPerPage);
    const currentPage = 1;
    const paginatedImages = images.slice(0, imagesPerPage);
    
    return {
      id,
      name,
      images,
      currentPage,
      totalPages,
      paginatedImages,
      imageIds: images.map(img => img.id)
    };
  };

  const updateImageCollectionPagination = (collection: ImageCollection, newPage: number): ImageCollection => {
    const imagesPerPage = settings.imagesPerPage;
    const totalPages = Math.ceil(collection.images.length / imagesPerPage);
    const safePage = Math.max(1, Math.min(newPage, totalPages));
    const paginatedImages = collection.images.slice(
      (safePage - 1) * imagesPerPage,
      safePage * imagesPerPage
    );
    
    return {
      ...collection,
      currentPage: safePage,
      totalPages,
      paginatedImages,
      imageIds: collection.images.map(img => img.id)
    };
  };

  // Initialize collections when dataset is loaded and api is available
  useEffect(() => {
    if (settingsLoaded && dataset && api) {
      loadImageCollections();
    }
  }, [dataset, settingsLoaded, api]);

  // Update collections pagination when settings change
  useEffect(() => {
    if (useTabbedImages && imageCollections.length > 0) {
      setImageCollections(prev => prev.map(collection => 
        updateImageCollectionPagination(collection, collection.currentPage)
      ));
    }
  }, [settings.imagesPerPage, useTabbedImages]);

  // Tab event handlers
  const handleAddImageTab = async (name: string): Promise<void> => {
    if (!datasetId) return;
    
    try {
      await imageCollectionsApi.createImageCollection(datasetId, { name });
      await loadImageCollections(); // Reload to get updated data
      toast({
        title: "Success",
        description: `Image collection "${name}" created successfully`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create image collection",
        variant: "destructive",
      });
    }
  };

  const handleRemoveImageTab = async (collectionId: string): Promise<void> => {
    if (!datasetId) return;
    
    // Don't allow removing the main collection (default collection)
    const collection = imageCollections.find(c => c.id === collectionId);
    if (!collection) return;
    
    try {
      await imageCollectionsApi.deleteImageCollection(datasetId, parseInt(collectionId));
      await loadImageCollections(); // Reload to get updated data
      toast({
        title: "Success",
        description: `Image collection "${collection.name}" deleted successfully`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to delete image collection",
        variant: "destructive",
      });
    }
  };

  const handleTabPageChange = (collectionId: string, page: number) => {
    setImageCollections(prev => prev.map(collection => {
      if (collection.id === collectionId) {
        return updateImageCollectionPagination(collection, page);
      }
      return collection;
    }));
  };

  const handleTabDeleteImage = async (collectionId: string, imageId: string): Promise<void> => {
    if (!id) return;
    
    try {
      // Remove from frontend state first for immediate feedback
      setImageCollections(prev => prev.map(collection => {
        if (collection.id === collectionId) {
          const updatedImages = collection.images.filter(img => img.id !== imageId);
          return createImageCollection(collection.id, collection.name, updatedImages);
        }
        return collection;
      }));
      
      // Actually delete from database via API
      if (api) {
        const response = await api.deleteImage(id, imageId);
        if (response.success) {
          console.log('Image deleted from backend successfully');
          toast({
            title: "Success",
            description: "Image deleted successfully",
          });
        } else {
          console.error('Backend delete failed:', response.error);
          // Reload collections to restore state if backend delete failed
          await loadImageCollections();
          toast({
            title: "Error",
            description: "Failed to delete image from database",
            variant: "destructive",
          });
        }
      }
    } catch (error) {
      console.error('Error deleting image:', error);
      // Reload collections to restore state if delete failed
      await loadImageCollections();
      toast({
        title: "Error", 
        description: "Failed to delete image",
        variant: "destructive",
      });
    }
  };

  const handleTabUploadImages = async (collectionId: string, files: File[]): Promise<void> => {
    if (!datasetId) return;
    
    try {
      const collectionIdNum = parseInt(collectionId);
      if (isNaN(collectionIdNum)) {
        throw new Error('Invalid collection ID');
      }
      
      // Use chunked upload for better performance and progress tracking
      const CHUNK_SIZE = 1000;
      const totalFiles = files.length;
      const totalChunks = Math.ceil(totalFiles / CHUNK_SIZE);
      
      let totalUploaded = 0;
      let totalFailed = 0;

      // Process files in chunks
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const startIndex = chunkIndex * CHUNK_SIZE;
        const endIndex = Math.min(startIndex + CHUNK_SIZE, totalFiles);
        const chunk = files.slice(startIndex, endIndex);
        
        try {
          await imageCollectionsApi.uploadImagesToCollection(datasetId, collectionIdNum, chunk);
          totalUploaded += chunk.length;
          
          // Small delay between chunks to avoid overwhelming the server
          if (chunkIndex < totalChunks - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`Failed to upload chunk ${chunkIndex + 1}:`, error);
          totalFailed += chunk.length;
          throw error; // Re-throw to trigger the component's error handling
        }
      }
      
      // Reload collections to get updated data with new images
      await loadImageCollections();
      
      if (totalFailed === 0) {
        toast({
          title: "Upload Complete",
          description: `Successfully uploaded ${totalUploaded} images to collection in ${totalChunks} chunks`,
        });
      } else {
        toast({
          title: "Upload Completed with Errors",
          description: `Uploaded ${totalUploaded} images, ${totalFailed} failed`,
          variant: "destructive",
        });
      }
      
      console.log(`Files uploaded to collection: ${collectionId}`, files.map(f => f.name));
    } catch (error: any) {
      console.error('Failed to upload images:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to upload images",
        variant: "destructive",
      });
      throw error;
    }
  };

  const fetchDataset = async () => {
    if (!id || !api) {
      setIsLoading(false);
      return;
    }

    const isInitialLoad = dataset === null || (dataset != null && String(dataset.id) !== String(id));
    const alreadyLoadedThisSession = loadedDatasetIds.has(id);
    try {
      if (isInitialLoad && !alreadyLoadedThisSession) {
        setIsLoading(true);
      }
      const response = await api.getDataset(id);
      if (response.success && response.data) {
        const data = response.data;
        // If we're on legacy URL (/datasets/:id) and dataset has a project, redirect to project-scoped URL
        if (!projectId && data.project_id != null) {
          navigate(`/projects/${data.project_id}/datasets/${id}`, { replace: true });
          return;
        }
        loadedDatasetIds.add(id);
        setDataset(data);
        
        // If dataset has project_id, fetch the project name
        if (data.project_id) {
          setDatasetProjectId(data.project_id.toString());
          const projectResponse = await api.getProject(data.project_id.toString());
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

  // Refetch when route params or api change — include api so we refetch when api becomes available (useApi starts with null)
  useEffect(() => {
    fetchDataset();
  }, [id, projectId, api]);

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
      let totalOverwritten = 0;

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
            totalOverwritten += responseData.overwritten || 0;
          } else {
            totalUploaded += chunk.length;
          }
          
          setUploadedCount(totalUploaded);
          
          const chunkOverwritten = responseData.overwritten || 0;
          let chunkMessage = `Uploaded ${responseData.uploaded || chunk.length} images`;
          if (chunkOverwritten > 0) {
            chunkMessage += `, overwrote ${chunkOverwritten} existing images`;
          }
          chunkMessage += ` (${totalUploaded}/${totalFiles} total)`;
          
          toast({
            title: `Chunk ${chunkIndex + 1}/${totalChunks} Complete`,
            description: chunkMessage,
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
        setImages(prevImages => {
          // Deduplicate by image id returned from backend. Do not remove images with the same filename
          // that belong to other collections.
          const uploadedIds = new Set(allUploadedImages.map(i => String(i.id)));
          const existingImages = prevImages.filter(img => !uploadedIds.has(String(img.id)));
          return [...existingImages, ...allUploadedImages];
        });
      }

      // Create final success message
      let successMessage = `Successfully processed ${totalFiles} images in ${totalChunks} chunks`;
      if (totalOverwritten > 0) {
        successMessage += `\n• ${totalUploaded} new images uploaded\n• ${totalOverwritten} existing images overwritten`;
      } else {
        successMessage += `\n• ${totalUploaded} images uploaded`;
      }

      toast({
        title: "Upload Complete!",
        description: successMessage,
      });

    } catch (error) {
      console.error('Error uploading images:', error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      toast({
        title: "Upload Error",
        description: errorMessage || "Failed to upload images",
        variant: "destructive",
      });
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

  const handleVideoUpload = async (
    file: File,
    params: { interval_seconds: number; max_frames: number }
  ) => {
    if (!api || !id) return;
    setIsVideoUploading(true);
    try {
      const response = await api.uploadVideoExtract(id, file, params);
      if (response.success && response.data) {
        const data = response.data as { uploaded?: number; images?: any[] };
        const uploaded = data.uploaded ?? (data as any).images?.length ?? 0;
        await loadImageCollections();
        const imagesResponse = await api.getImages(id);
        if (imagesResponse.success && imagesResponse.data) {
          setImages(imagesResponse.data);
        }
        toast({
          title: "Video upload complete",
          description: `Extracted and uploaded ${uploaded} frame(s) from the video.`,
        });
        setIsVideoUploadDialogOpen(false);
      } else {
        throw new Error((response as any).error || "Video upload failed");
      }
    } catch (error) {
      console.error("Video upload error:", error);
      toast({
        title: "Video upload failed",
        description: error instanceof Error ? error.message : "Failed to extract frames from video",
        variant: "destructive",
      });
    } finally {
      setIsVideoUploading(false);
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

  // Handle opening delete confirmation dialog
  const handleDeleteDataset = () => {
    setShowDeleteDialog(true);
  };

  // Handle confirmed dataset deletion
  const handleConfirmDeleteDataset = async () => {
    if (!id || !api) return;

    try {
      const response = await api.deleteDataset(parseInt(id));
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to delete dataset');
      }

      toast({
        title: "Dataset deleted",
        description: `Dataset has been deleted successfully.`,
      });

      // Navigate back to datasets page
      navigate('/datasets');
    } catch (error) {
      console.error('Error deleting dataset:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete dataset. Please try again.",
        variant: "destructive",
      });
    } finally {
      setShowDeleteDialog(false);
    }
  };

  // Handle dataset duplication
  const handleDuplicateDataset = async () => {
    console.log('🚀🚀🚀 DUPLICATE BUTTON CLICKED! 🚀🚀🚀');
    console.log('handleDuplicateDataset called, id:', id);
    console.log('api exists?', !!api);
    
    if (!id || !api) {
      console.error('❌ No dataset ID or API available for duplication');
      console.error('id:', id, 'api:', !!api);
      return;
    }

    try {
      console.log('✅ Calling duplicate API for dataset:', id);
      
      const response = await api.duplicateDataset(parseInt(id, 10));
      
      console.log('Duplicate response:', response);
      
      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to duplicate dataset');
      }

      const responseData = response.data;
      
      // Check if it's a background task response
      console.log('🔍 Response data:', responseData);
      console.log('🔍 Has task_id?', !!responseData.task_id);
      
      if (responseData.task_id) {
        // Background task started - show prominent notification
        console.log('🎉 SHOWING TOAST NOTIFICATION NOW!');
        toast({
          title: "✨ Duplication Started",
          description: `Dataset duplication is running in background. Check the tasks panel for progress.`,
          duration: 5000,
        });
        
        console.log('Background task started with ID:', responseData.task_id);
        
        // Poll task status to navigate when complete
        const pollInterval = setInterval(async () => {
          try {
            const taskResponse = await api.getTask(responseData.task_id);
            if (taskResponse.success && taskResponse.data) {
              const taskData = taskResponse.data as any;
              
              if (taskData.status === 'completed') {
                clearInterval(pollInterval);
                const newDatasetId = taskData.task_metadata?.new_dataset_id;
                
                toast({
                  title: "✅ Dataset Duplicated",
                  description: `Successfully created a copy of the dataset!`,
                  duration: 4000,
                });
                
                // Navigate to the project datasets page
                setTimeout(() => {
                  if (effectiveProjectId) {
                    navigate(`/projects/${effectiveProjectId}/datasets`);
                  } else {
                    navigate(`/`);
                  }
                }, 500);
              } else if (taskData.status === 'failed') {
                clearInterval(pollInterval);
                toast({
                  title: "❌ Duplication Failed",
                  description: taskData.error_message || "Dataset duplication failed",
                  variant: "destructive",
                });
              }
            }
          } catch (error) {
            console.error('Error polling task status:', error);
          }
        }, 2000); // Poll every 2 seconds
        
        // Stop polling after 5 minutes
        setTimeout(() => clearInterval(pollInterval), 300000);
      } else {
        // Synchronous response (fallback mode)
        const duplicatedDataset = responseData;
        console.log('Duplicated dataset:', duplicatedDataset);
        
        toast({
          title: "✅ Dataset Duplicated",
          description: `Dataset has been duplicated successfully.`,
        });

        // Navigate to the project datasets page
        if (effectiveProjectId) {
          navigate(`/projects/${effectiveProjectId}/datasets`);
        } else {
          navigate(`/`);
        }
      }
    } catch (error) {
      console.error('Error duplicating dataset:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to duplicate dataset. Please try again.",
        variant: "destructive",
      });
    }
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
    <div className="h-screen flex flex-col overflow-hidden">
      <Navbar />
      <main className="flex-1 flex flex-col pt-16 min-h-0">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
              <h3 className="text-lg font-medium">Loading dataset...</h3>
              <p className="text-gray-500">Please wait while we fetch your images</p>
            </div>
          </div>
        ) : (
          <>
            <div className="px-6 py-4 border-b bg-background">
              <div>
                <DatasetBreadcrumb 
                  projectId={effectiveProjectId} 
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
                  onDeleteDataset={handleDeleteDataset}
                  onDuplicateDataset={handleDuplicateDataset}
                  projectId={effectiveProjectId}
                  imageCount={images.length}
                />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ResizableDatasetLayout
                layout={settings.layout}
                id={id || ''}
                projectId={effectiveProjectId || undefined}
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
                onOpenVideoUploadDialog={() => setIsVideoUploadDialogOpen(true)}
                onDeleteImage={handleDeleteImage}
                paginatedImages={paginatedImages}
                totalPages={totalPages}
                annotations={showAnnotations ? visibleAnnotations : []}
                onImportAnnotations={handleImportAnnotations}
                onShowAnnotationsChange={handleShowAnnotationsChange}
                selectedImageIndex={selectedImageIndex}
                setSelectedImageIndex={setSelectedImageIndex}
                // Tabbed images props
                useTabbedImages={useTabbedImages}
                imageCollections={imageCollections}
                onAddImageTab={handleAddImageTab}
                onRemoveImageTab={handleRemoveImageTab}
                onTabPageChange={handleTabPageChange}
                onTabDeleteImage={handleTabDeleteImage}
                onTabUploadImages={handleTabUploadImages}
              />
            </div>
            <ImageUploadDialog 
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onFilesSelected={handleUploadImages}
        />
        <VideoUploadDialog
          open={isVideoUploadDialogOpen}
          onOpenChange={setIsVideoUploadDialogOpen}
          onSubmit={handleVideoUpload}
          isUploading={isVideoUploading}
        />
        {dataset && (
          <EditDatasetDialog
            dataset={dataset}
            open={isEditDialogOpen}
            onOpenChange={setIsEditDialogOpen}
            onDatasetUpdated={handleDatasetUpdated}
          />
        )}

        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete the dataset "{dataset?.name}" and all its associated images and annotations.
                This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleConfirmDeleteDataset}
                className="bg-destructive hover:bg-destructive/90"
              >
                Delete Dataset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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
          </>
        )}
      </main>
    </div>
  );
}
