import { describe, it, expect, beforeEach } from 'vitest';
import { OptimizedClassificationStorage, LocalStorageCleanup } from './optimizedStorage';

describe('OptimizedClassificationStorage', () => {
  let storage: OptimizedClassificationStorage;

  beforeEach(() => {
    localStorage.clear();
    storage = new OptimizedClassificationStorage('test-ds');
  });

  describe('saveClassifications / loadClassifications', () => {
    it('round-trips classification data', () => {
      const classifications = {
        img1: ['cat', 'dog'],
        img2: ['bird'],
      };
      const classes = ['cat', 'dog', 'bird'];

      storage.saveClassifications(classifications, classes);
      const loaded = storage.loadClassifications();

      expect(loaded.classifications).toEqual(classifications);
      expect(loaded.classes).toEqual(classes);
    });

    it('returns empty data when nothing is saved', () => {
      const loaded = storage.loadClassifications();
      expect(loaded.classifications).toEqual({});
      expect(loaded.classes).toEqual([]);
    });

    it('ignores class names not in the class list', () => {
      const classifications = {
        img1: ['cat', 'unknown_class'],
      };
      const classes = ['cat', 'dog'];

      storage.saveClassifications(classifications, classes);
      const loaded = storage.loadClassifications();

      expect(loaded.classifications.img1).toEqual(['cat']);
    });
  });

  describe('loadLegacyFormat', () => {
    it('falls back to legacy format when optimized is missing', () => {
      const legacyData = { img1: ['cat'] };
      localStorage.setItem('classifications_test-ds', JSON.stringify(legacyData));
      localStorage.setItem('classification_classes_test-ds', JSON.stringify(['cat']));

      const loaded = storage.loadClassifications();
      expect(loaded.classifications).toEqual(legacyData);
      expect(loaded.classes).toEqual(['cat']);
    });
  });

  describe('migrateLegacyData', () => {
    it('migrates legacy data to optimized format', () => {
      const legacyData = { img1: ['cat', 'dog'], img2: ['bird'] };
      localStorage.setItem('classifications_test-ds', JSON.stringify(legacyData));
      localStorage.setItem('classification_classes_test-ds', JSON.stringify(['cat', 'dog', 'bird']));

      const result = storage.migrateLegacyData();
      expect(result).toBe(true);

      expect(localStorage.getItem('classifications_test-ds')).toBeNull();
      expect(localStorage.getItem('opt_classifications_test-ds')).toBeTruthy();

      const loaded = storage.loadClassifications();
      expect(loaded.classifications).toEqual(legacyData);
    });

    it('returns true when there is no legacy data', () => {
      expect(storage.migrateLegacyData()).toBe(true);
    });
  });

  describe('getStorageStats', () => {
    it('reports sizes for optimized format', () => {
      storage.saveClassifications({ img1: ['cat'] }, ['cat']);
      const stats = storage.getStorageStats();
      expect(stats.optimizedSize).toBeGreaterThan(0);
      expect(stats.totalSize).toBeGreaterThan(0);
    });

    it('reports zero when empty', () => {
      const stats = storage.getStorageStats();
      expect(stats.optimizedSize).toBe(0);
      expect(stats.legacySize).toBe(0);
    });
  });

  describe('clearData', () => {
    it('removes all classification data for the dataset', () => {
      storage.saveClassifications({ img1: ['cat'] }, ['cat']);
      expect(localStorage.getItem('opt_classifications_test-ds')).toBeTruthy();

      storage.clearData();
      expect(localStorage.getItem('opt_classifications_test-ds')).toBeNull();
      expect(localStorage.getItem('classification_classes_test-ds')).toBeNull();
    });
  });
});

describe('LocalStorageCleanup', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('analyzeUsage', () => {
    it('returns total size and categories', () => {
      localStorage.setItem('classifications_1', 'data');
      localStorage.setItem('annotations_2', 'data');
      localStorage.setItem('other_key', 'data');

      const result = LocalStorageCleanup.analyzeUsage();
      expect(result.totalSize).toBeGreaterThan(0);
      expect(result.categories.classifications.count).toBe(1);
      expect(result.categories.annotations.count).toBe(1);
      expect(result.categories.other.count).toBe(1);
    });

    it('handles empty storage', () => {
      const result = LocalStorageCleanup.analyzeUsage();
      expect(result.totalSize).toBe(0);
    });
  });

  describe('cleanupOldData', () => {
    it('removes managed data not in keep list', () => {
      localStorage.setItem('classifications_1', 'data');
      localStorage.setItem('classifications_2', 'data');
      localStorage.setItem('unrelated_key', 'data');

      const removed = LocalStorageCleanup.cleanupOldData(['1']);
      expect(removed).toBe(1);
      expect(localStorage.getItem('classifications_1')).toBe('data');
      expect(localStorage.getItem('classifications_2')).toBeNull();
      expect(localStorage.getItem('unrelated_key')).toBe('data');
    });

    it('keeps all data when all IDs are in keep list', () => {
      localStorage.setItem('classifications_1', 'data');
      localStorage.setItem('classifications_2', 'data');

      const removed = LocalStorageCleanup.cleanupOldData(['1', '2']);
      expect(removed).toBe(0);
    });
  });

  describe('cleanupClassificationData', () => {
    it('removes oldest classification entries beyond keepRecentCount', () => {
      localStorage.setItem('classifications_a', JSON.stringify({ timestamp: '2023-01-01' }));
      localStorage.setItem('classifications_b', JSON.stringify({ timestamp: '2024-01-01' }));
      localStorage.setItem('classifications_c', JSON.stringify({ timestamp: '2025-01-01' }));

      const removed = LocalStorageCleanup.cleanupClassificationData(2);
      expect(removed).toBe(1);
      expect(localStorage.getItem('classifications_a')).toBeNull();
    });
  });
});
