import { describe, it, expect } from 'vitest';
import { generateClassColors, processCOCOAnnotations } from './annotations';

describe('generateClassColors', () => {
  it('returns colors for each class name', () => {
    const colors = generateClassColors(['cat', 'dog', 'bird']);
    expect(Object.keys(colors)).toHaveLength(3);
    expect(colors).toHaveProperty('cat');
    expect(colors).toHaveProperty('dog');
    expect(colors).toHaveProperty('bird');
  });

  it('returns valid hex colors', () => {
    const colors = generateClassColors(['a', 'b']);
    Object.values(colors).forEach((color) => {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('handles empty array', () => {
    const colors = generateClassColors([]);
    expect(Object.keys(colors)).toHaveLength(0);
  });

  it('handles single class', () => {
    const colors = generateClassColors(['onlyClass']);
    expect(Object.keys(colors)).toHaveLength(1);
    expect(colors).toHaveProperty('onlyClass');
  });

  it('handles many classes beyond predefined palette', () => {
    const classes = Array.from({ length: 60 }, (_, i) => `class_${i}`);
    const colors = generateClassColors(classes);
    expect(Object.keys(colors)).toHaveLength(60);
  });
});

describe('processCOCOAnnotations', () => {
  function makeCocoFile(data: object): File {
    const json = JSON.stringify(data);
    return new File([json], 'annotations.json', { type: 'application/json' });
  }

  it('parses a valid COCO annotation file', async () => {
    const coco = {
      images: [
        { id: 1, file_name: 'img1.jpg', width: 640, height: 480 },
        { id: 2, file_name: 'img2.jpg', width: 800, height: 600 },
      ],
      categories: [
        { id: 1, name: 'cat' },
        { id: 2, name: 'dog' },
      ],
      annotations: [
        { id: 1, image_id: 1, category_id: 1, bbox: [100, 100, 200, 150], area: 30000 },
        { id: 2, image_id: 1, category_id: 2, bbox: [300, 200, 100, 100], area: 10000 },
        { id: 3, image_id: 2, category_id: 1, bbox: [50, 50, 300, 250], area: 75000 },
      ],
    };

    const result = await processCOCOAnnotations(makeCocoFile(coco));

    expect(result.samples).toHaveLength(3);
    expect(result.stats).toHaveLength(2);
    expect(result.totalImageCount).toBe(2);
    expect(result.matchedImageCount).toBe(2);

    const catStat = result.stats.find((s) => s.className === 'cat');
    expect(catStat?.count).toBe(2);

    const dogStat = result.stats.find((s) => s.className === 'dog');
    expect(dogStat?.count).toBe(1);
  });

  it('normalizes bounding boxes to 0-1 range', async () => {
    const coco = {
      images: [{ id: 1, file_name: 'img.jpg', width: 1000, height: 500 }],
      categories: [{ id: 1, name: 'obj' }],
      annotations: [
        { id: 1, image_id: 1, category_id: 1, bbox: [100, 50, 200, 100] },
      ],
    };

    const result = await processCOCOAnnotations(makeCocoFile(coco));
    const bbox = result.samples[0].bbox;

    expect(bbox[0]).toBeCloseTo(0.1);  // 100/1000
    expect(bbox[1]).toBeCloseTo(0.1);  // 50/500
    expect(bbox[2]).toBeCloseTo(0.2);  // 200/1000
    expect(bbox[3]).toBeCloseTo(0.2);  // 100/500
  });

  it('attaches datasetId to each sample when provided', async () => {
    const coco = {
      images: [{ id: 1, file_name: 'img.jpg', width: 640, height: 480 }],
      categories: [{ id: 1, name: 'obj' }],
      annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 10, 10] }],
    };

    const result = await processCOCOAnnotations(makeCocoFile(coco), 'ds-42');
    expect(result.samples[0].datasetId).toBe('ds-42');
  });

  it('handles segmentation polygons', async () => {
    const coco = {
      images: [{ id: 1, file_name: 'img.jpg', width: 640, height: 480 }],
      categories: [{ id: 1, name: 'obj' }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          bbox: [10, 10, 50, 50],
          segmentation: [[10, 10, 60, 10, 60, 60, 10, 60]],
        },
      ],
    };

    const result = await processCOCOAnnotations(makeCocoFile(coco));
    expect(result.samples[0].segmentation).toBeDefined();
    expect(result.samples[0].segmentation![0]).toHaveLength(8);
  });

  it('filters out too-short segmentation polygons', async () => {
    const coco = {
      images: [{ id: 1, file_name: 'img.jpg', width: 640, height: 480 }],
      categories: [{ id: 1, name: 'obj' }],
      annotations: [
        {
          id: 1,
          image_id: 1,
          category_id: 1,
          bbox: [10, 10, 50, 50],
          segmentation: [[10, 10]], // too short (< 6 values)
        },
      ],
    };

    const result = await processCOCOAnnotations(makeCocoFile(coco));
    expect(result.samples[0].segmentation).toBeUndefined();
  });

  it('rejects file with missing images field', async () => {
    const coco = { categories: [], annotations: [] };
    await expect(processCOCOAnnotations(makeCocoFile(coco))).rejects.toThrow(
      'Invalid COCO format: missing or invalid "images" field'
    );
  });

  it('rejects file with missing annotations field', async () => {
    const coco = { images: [{ id: 1, file_name: 'img.jpg' }], categories: [] };
    await expect(processCOCOAnnotations(makeCocoFile(coco))).rejects.toThrow(
      'Invalid COCO format: missing or invalid "annotations" field'
    );
  });

  it('handles missing categories gracefully', async () => {
    const coco = {
      images: [{ id: 1, file_name: 'img.jpg', width: 640, height: 480 }],
      annotations: [
        { id: 1, image_id: 1, category_id: 99, bbox: [0, 0, 10, 10] },
      ],
    };

    const result = await processCOCOAnnotations(makeCocoFile(coco));
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].className).toBe('category_99');
  });

  it('builds imageMapping correctly', async () => {
    const coco = {
      images: [
        { id: 1, file_name: 'a.jpg', width: 100, height: 100 },
        { id: 2, file_name: 'b.jpg', width: 200, height: 200 },
      ],
      categories: [{ id: 1, name: 'x' }],
      annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 10, 10] }],
    };

    const result = await processCOCOAnnotations(makeCocoFile(coco));
    expect(result.imageMapping[1]).toBe('a.jpg');
    expect(result.imageMapping[2]).toBe('b.jpg');
  });

  it('builds imageDetails with dimensions', async () => {
    const coco = {
      images: [{ id: 1, file_name: 'a.jpg', width: 1920, height: 1080 }],
      categories: [{ id: 1, name: 'x' }],
      annotations: [{ id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 10, 10] }],
    };

    const result = await processCOCOAnnotations(makeCocoFile(coco));
    expect(result.imageDetails['1']).toEqual({
      fileName: 'a.jpg',
      width: 1920,
      height: 1080,
    });
  });
});
