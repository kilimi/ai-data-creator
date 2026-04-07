import { describe, it, expect } from 'vitest';
import { convertToFrontendImageCollection, ImageCollectionData } from './imageCollections';

function makeBackendCollection(overrides: Partial<ImageCollectionData> = {}): ImageCollectionData {
  return {
    id: 1,
    dataset_id: 10,
    name: 'Default',
    is_default: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    image_count: 3,
    images: [
      {
        id: 100, datasetId: 10, fileName: 'a.jpg', fileSize: 1024,
        width: 640, height: 480, url: '/img/a.jpg', thumbnailUrl: '/thumb/a.jpg',
        uploadedAt: '2024-01-01', annotationsCount: 2,
      },
      {
        id: 101, datasetId: 10, fileName: 'b.jpg', fileSize: 2048,
        width: 800, height: 600, url: '/img/b.jpg', thumbnailUrl: '/thumb/b.jpg',
        uploadedAt: '2024-01-02', annotationsCount: 0,
      },
      {
        id: 102, datasetId: 10, fileName: 'c.jpg', fileSize: 3072,
        width: 1024, height: 768, url: '/img/c.jpg', thumbnailUrl: '/thumb/c.jpg',
        uploadedAt: '2024-01-03', annotationsCount: 1,
      },
    ],
    ...overrides,
  };
}

describe('convertToFrontendImageCollection', () => {
  it('converts backend data to frontend format', () => {
    const result = convertToFrontendImageCollection(makeBackendCollection());

    expect(result.id).toBe('1');
    expect(result.name).toBe('Default');
    expect(result.images).toHaveLength(3);
    expect(result.currentPage).toBe(1);
  });

  it('converts numeric IDs to strings', () => {
    const result = convertToFrontendImageCollection(makeBackendCollection());

    expect(result.images[0].id).toBe('100');
    expect(result.images[0].datasetId).toBe('10');
  });

  it('computes totalPages based on imagesPerPage', () => {
    const result = convertToFrontendImageCollection(makeBackendCollection(), 2);
    expect(result.totalPages).toBe(2); // 3 images, 2 per page
  });

  it('paginates images for page 1', () => {
    const result = convertToFrontendImageCollection(makeBackendCollection(), 2);
    expect(result.paginatedImages).toHaveLength(2);
    expect(result.paginatedImages[0].fileName).toBe('a.jpg');
    expect(result.paginatedImages[1].fileName).toBe('b.jpg');
  });

  it('builds imageIds list', () => {
    const result = convertToFrontendImageCollection(makeBackendCollection());
    expect(result.imageIds).toEqual(['100', '101', '102']);
  });

  it('handles empty images array', () => {
    const result = convertToFrontendImageCollection(
      makeBackendCollection({ images: [], image_count: 0 })
    );
    expect(result.images).toHaveLength(0);
    expect(result.totalPages).toBe(0);
    expect(result.paginatedImages).toHaveLength(0);
  });

  it('defaults to 12 images per page', () => {
    const manyImages = Array.from({ length: 25 }, (_, i) => ({
      id: i, datasetId: 10, fileName: `img${i}.jpg`, fileSize: 1000,
      width: 640, height: 480, url: `/img/${i}.jpg`, thumbnailUrl: `/thumb/${i}.jpg`,
      uploadedAt: '2024-01-01', annotationsCount: 0,
    }));
    const result = convertToFrontendImageCollection(
      makeBackendCollection({ images: manyImages, image_count: 25 })
    );
    expect(result.totalPages).toBe(3); // ceil(25/12) = 3
    expect(result.paginatedImages).toHaveLength(12);
  });
});
