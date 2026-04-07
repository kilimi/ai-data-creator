import { describe, it, expect } from 'vitest';
import { getMockDataset } from './mockData';

describe('getMockDataset', () => {
  it('returns a dataset with the given id as number', () => {
    const ds = getMockDataset('42');
    expect(ds.id).toBe(42);
  });

  it('has required dataset fields', () => {
    const ds = getMockDataset('1');
    expect(ds.name).toBe('Vehicle Detection');
    expect(ds.description).toBeTruthy();
    expect(ds.tags).toContain('traffic');
    expect(ds.created_at).toBeTruthy();
    expect(ds.project_id).toBe(1);
  });

  it('has zero counts by default', () => {
    const ds = getMockDataset('1');
    expect(ds.image_count).toBe(0);
    expect(ds.annotation_count).toBe(0);
    expect(ds.annotation_file_count).toBe(0);
  });
});
