import { describe, expect, it } from 'vitest';
import { applyClassColorsToAnnotations } from '@/utils/annotationColorConsistency';

describe('applyClassColorsToAnnotations', () => {
  it('remaps annotation colors from class palette for consistent stats/list colors', () => {
    const annotations = [
      { id: 'a1', label: 'Car', color: '#111111' },
      { id: 'a2', label: 'Person', color: '#222222' },
    ];
    const classes = [
      { name: 'Car', color: '#ff0000' },
      { name: 'Person', color: '#00ff00' },
    ];

    const result = applyClassColorsToAnnotations(annotations, classes);

    expect(result).toEqual([
      { id: 'a1', label: 'Car', color: '#ff0000' },
      { id: 'a2', label: 'Person', color: '#00ff00' },
    ]);
  });

  it('matches labels case-insensitively', () => {
    const annotations = [{ id: 'a1', label: 'person', color: '#111111' }];
    const classes = [{ name: 'Person', color: '#00ff00' }];

    const result = applyClassColorsToAnnotations(annotations, classes);

    expect(result[0].color).toBe('#00ff00');
  });

  it('keeps original color when class does not exist', () => {
    const annotations = [{ id: 'a1', label: 'Unknown', color: '#123456' }];
    const classes = [{ name: 'Car', color: '#ff0000' }];

    const result = applyClassColorsToAnnotations(annotations, classes);

    expect(result).toEqual([{ id: 'a1', label: 'Unknown', color: '#123456' }]);
  });
});
