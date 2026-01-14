import { useRef, useCallback } from 'react';

/**
 * Creates a throttled callback that limits how often it can be called
 */
export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const lastRun = useRef<number>(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastArgsRef = useRef<Parameters<T> | null>(null);

  const throttledCallback = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastRun = now - lastRun.current;

      lastArgsRef.current = args;

      if (timeSinceLastRun >= delay) {
        // Enough time has passed, execute immediately
        lastRun.current = now;
        return callback(...args);
      } else {
        // Schedule execution
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        return new Promise<ReturnType<T>>((resolve) => {
          timeoutRef.current = setTimeout(() => {
            lastRun.current = Date.now();
            const result = callback(...lastArgsRef.current!);
            resolve(result);
          }, delay - timeSinceLastRun);
        });
      }
    },
    [callback, delay]
  ) as T;

  return throttledCallback;
}
