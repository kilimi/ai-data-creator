import { describe, it, expect } from 'vitest';
import { fadeIn, scaleIn, slideIn, staggeredChildren, blurIn } from './animations';

describe('animation variants', () => {
  it('fadeIn has hidden, visible, and exit states', () => {
    expect(fadeIn.hidden).toHaveProperty('opacity', 0);
    expect(fadeIn.visible).toHaveProperty('opacity', 1);
    expect(fadeIn.exit).toHaveProperty('opacity', 0);
    expect(fadeIn.hidden).toHaveProperty('y', 10);
    expect(fadeIn.visible).toHaveProperty('y', 0);
  });

  it('scaleIn animates scale from 0.95 to 1', () => {
    expect(scaleIn.hidden).toHaveProperty('scale', 0.95);
    expect(scaleIn.visible).toHaveProperty('scale', 1);
    expect(scaleIn.exit).toHaveProperty('scale', 0.95);
  });

  it('slideIn animates x from -10 to 0', () => {
    expect(slideIn.hidden).toHaveProperty('x', -10);
    expect(slideIn.visible).toHaveProperty('x', 0);
    expect(slideIn.exit).toHaveProperty('x', -10);
  });

  it('staggeredChildren configures stagger timing', () => {
    expect(staggeredChildren.visible.transition).toHaveProperty('staggerChildren', 0.1);
    expect(staggeredChildren.visible.transition).toHaveProperty('delayChildren', 0.2);
  });

  it('blurIn animates blur filter', () => {
    expect(blurIn.hidden).toHaveProperty('filter', 'blur(10px)');
    expect(blurIn.visible).toHaveProperty('filter', 'blur(0px)');
  });

  it('all variants have transition durations', () => {
    expect(fadeIn.visible.transition.duration).toBe(0.4);
    expect(scaleIn.visible.transition.duration).toBe(0.4);
    expect(slideIn.visible.transition.duration).toBe(0.4);
    expect(blurIn.visible.transition.duration).toBe(0.5);
  });
});
