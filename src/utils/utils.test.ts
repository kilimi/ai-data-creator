import { describe, it, expect } from 'vitest';
import { getRandomColor, formatFileSize, formatDate, truncateText } from './utils';

describe('getRandomColor', () => {
  it('returns a string starting with #', () => {
    const color = getRandomColor();
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('returns a color from the predefined list', () => {
    const predefined = [
      '#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6',
      '#1abc9c', '#d35400', '#c0392b', '#16a085', '#8e44ad',
      '#2980b9', '#f1c40f', '#e67e22', '#27ae60', '#fd79a8',
      '#6c5ce7', '#00cec9', '#0984e3', '#55efc4', '#fdcb6e',
    ];
    const color = getRandomColor();
    expect(predefined).toContain(color);
  });
});

describe('formatFileSize', () => {
  it('returns "0 Bytes" for 0', () => {
    expect(formatFileSize(0)).toBe('0 Bytes');
  });

  it('formats bytes correctly', () => {
    expect(formatFileSize(500)).toBe('500 Bytes');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1048576)).toBe('1 MB');
    expect(formatFileSize(1572864)).toBe('1.5 MB');
  });

  it('formats gigabytes', () => {
    expect(formatFileSize(1073741824)).toBe('1 GB');
  });

  it('respects decimals parameter', () => {
    expect(formatFileSize(1536, 2)).toBe('1.5 KB');
    expect(formatFileSize(1536, 0)).toBe('2 KB');
  });
});

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2023-06-15T10:30:00Z');
    expect(result).toContain('2023');
    expect(result).toContain('Jun');
    expect(result).toContain('15');
  });

  it('handles different date strings', () => {
    const result = formatDate('2024-01-01T00:00:00Z');
    expect(result).toContain('2024');
    expect(result).toContain('Jan');
  });
});

describe('truncateText', () => {
  it('returns full text when shorter than maxLength', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('returns full text when equal to maxLength', () => {
    expect(truncateText('hello', 5)).toBe('hello');
  });

  it('truncates and adds ellipsis when longer', () => {
    expect(truncateText('hello world', 5)).toBe('hello...');
  });

  it('handles empty string', () => {
    expect(truncateText('', 5)).toBe('');
  });
});
