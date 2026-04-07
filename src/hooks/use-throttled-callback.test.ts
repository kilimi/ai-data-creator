import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThrottledCallback } from './use-throttled-callback';

describe('useThrottledCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes immediately on first call', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(fn, 200));

    act(() => {
      result.current('a');
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('a');
  });

  it('throttles subsequent calls within delay', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(fn, 200));

    act(() => {
      result.current('first');
    });
    expect(fn).toHaveBeenCalledTimes(1);

    act(() => {
      result.current('second');
    });
    expect(fn).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('second');
  });

  it('allows execution after delay has passed', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useThrottledCallback(fn, 100));

    act(() => {
      result.current('first');
    });

    act(() => {
      vi.advanceTimersByTime(150);
    });

    act(() => {
      result.current('second');
    });

    expect(fn).toHaveBeenCalledTimes(2);
  });
});
