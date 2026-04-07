import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStableLoading } from './useStableLoading';

describe('useStableLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true when loading is true', () => {
    const { result } = renderHook(() => useStableLoading(true, 300));
    expect(result.current).toBe(true);
  });

  it('returns false when loading is false initially', () => {
    const { result } = renderHook(() => useStableLoading(false, 300));
    expect(result.current).toBe(false);
  });

  it('maintains loading state for minimum duration after transition', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useStableLoading(loading, 300),
      { initialProps: { loading: false } }
    );

    expect(result.current).toBe(false);

    rerender({ loading: true });

    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(result.current).toBe(true);

    rerender({ loading: false });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(result.current).toBe(false);
  });

  it('stops immediately if min duration already passed', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useStableLoading(loading, 100),
      { initialProps: { loading: true } }
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });

    rerender({ loading: false });

    act(() => {
      vi.advanceTimersByTime(10);
    });

    expect(result.current).toBe(false);
  });
});
