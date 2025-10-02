import { ImageCollection } from '@/types';

const API_BASE = process.env.NODE_ENV === 'development' ? 'http://localhost:9999' : '';

export interface ImageCollectionData {
  id: number;
  dataset_id: number;
  name: string;
  description?: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  image_count: number;
  images: Array<{
    id: number;
    dataset_id: number;
    file_name: string;
    file_size: number;
    width: number;
    height: number;
    url: string;
    thumbnail_url: string;
    uploaded_at: string;
    annotations_count: number;
  }>;
}

export const imageCollectionsApi = {
  // Get all image collections for a dataset
  async getImageCollections(datasetId: string): Promise<ImageCollectionData[]> {
    const response = await fetch(`${API_BASE}/datasets/${datasetId}/image-collections`);
    if (!response.ok) {
      throw new Error(`Failed to fetch image collections: ${response.statusText}`);
    }
    return response.json();
  },

  // Create a new image collection
  async createImageCollection(datasetId: string, data: { 
    name: string; 
    description?: string; 
    is_default?: boolean 
  }): Promise<ImageCollectionData> {
    const response = await fetch(`${API_BASE}/datasets/${datasetId}/image-collections`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...data,
        dataset_id: parseInt(datasetId)
      }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Failed to create image collection');
    }
    return response.json();
  },

  // Delete an image collection
  async deleteImageCollection(datasetId: string, collectionId: number): Promise<void> {
    const response = await fetch(`${API_BASE}/datasets/${datasetId}/image-collections/${collectionId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Failed to delete image collection');
    }
  },

  // Upload images to a specific collection
  async uploadImagesToCollection(
    datasetId: string, 
    collectionId: number, 
    files: File[]
  ): Promise<{ message: string; images: any[] }> {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    const response = await fetch(`${API_BASE}/datasets/${datasetId}/image-collections/${collectionId}/images`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Failed to upload images');
    }
    return response.json();
  },

  // Upload images to a specific collection with chunking support
  async uploadImagesToCollectionChunked(
    datasetId: string, 
    collectionId: number, 
    files: File[],
    onProgress?: (progress: number, chunkIndex: number, totalChunks: number) => void
  ): Promise<{ message: string; totalUploaded: number; totalFailed: number }> {
    const CHUNK_SIZE = 1000;
    const totalFiles = files.length;
    const totalChunks = Math.ceil(totalFiles / CHUNK_SIZE);
    
    let totalUploaded = 0;
    let totalFailed = 0;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const startIndex = chunkIndex * CHUNK_SIZE;
      const endIndex = Math.min(startIndex + CHUNK_SIZE, totalFiles);
      const chunk = files.slice(startIndex, endIndex);

      try {
        const result = await this.uploadImagesToCollection(datasetId, collectionId, chunk);
        totalUploaded += chunk.length;
        
        // Update progress
        const progress = ((chunkIndex + 1) / totalChunks) * 100;
        onProgress?.(progress, chunkIndex + 1, totalChunks);
        
        // Small delay between chunks to avoid overwhelming the server
        if (chunkIndex < totalChunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error(`Failed to upload chunk ${chunkIndex + 1}:`, error);
        totalFailed += chunk.length;
        throw error; // Re-throw to allow component to handle the error
      }
    }

    return {
      message: `Successfully uploaded ${totalUploaded} images in ${totalChunks} chunks`,
      totalUploaded,
      totalFailed
    };
  },

  // Move an image to a different collection
  async moveImageToCollection(imageId: string, collectionId: number): Promise<void> {
    const response = await fetch(`${API_BASE}/images/${imageId}/collection`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ collection_id: collectionId }),
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Failed to move image');
    }
  },

  // Initialize default collection for existing datasets
  async initializeDefaultCollection(datasetId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/datasets/${datasetId}/image-collections/initialize`, {
      method: 'POST',
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(error.detail || 'Failed to initialize default collection');
    }
  },
};

// Helper function to convert backend data to frontend ImageCollection format
export function convertToFrontendImageCollection(
  backendCollection: ImageCollectionData,
  imagesPerPage: number = 12
): ImageCollection {
  const images = backendCollection.images.map(img => ({
    id: String(img.id),
    datasetId: String(img.dataset_id),
    fileName: img.file_name,
    fileSize: img.file_size,
    width: img.width,
    height: img.height,
    url: img.url,
    thumbnailUrl: img.thumbnail_url,
    uploadedAt: img.uploaded_at,
    annotationsCount: img.annotations_count,
  }));

  const totalPages = Math.ceil(images.length / imagesPerPage);
  const currentPage = 1;
  const startIndex = (currentPage - 1) * imagesPerPage;
  const endIndex = startIndex + imagesPerPage;
  const paginatedImages = images.slice(startIndex, endIndex);

  return {
    id: String(backendCollection.id),
    name: backendCollection.name,
    images,
    currentPage,
    totalPages,
    paginatedImages,
    imageIds: images.map(img => img.id),
  };
}
