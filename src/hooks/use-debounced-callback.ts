"use client";

import { useCallback, useRef, useEffect } from "react";

/**
 * A hook that returns a debounced version of the callback.
 * The callback will only be called after the specified delay has passed
 * without the function being called again.
 *
 * @param callback - The function to debounce
 * @param delay - The delay in milliseconds
 * @returns A debounced version of the callback
 *
 * @example
 * ```tsx
 * const debouncedSearch = useDebouncedCallback((query: string) => {
 *   fetchResults(query);
 * }, 300);
 *
 * // Call it like a normal function
 * debouncedSearch("hello");
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );
}

/**
 * A hook that provides both the debounced callback and a cancel function.
 * Useful when you need to cancel pending debounced calls.
 *
 * @param callback - The function to debounce
 * @param delay - The delay in milliseconds
 * @returns An object with the debounced callback and a cancel function
 *
 * @example
 * ```tsx
 * const { debouncedCallback, cancel } = useDebouncedCallbackWithCancel(
 *   (query: string) => fetchResults(query),
 *   300
 * );
 *
 * // Use the debounced callback
 * debouncedCallback("hello");
 *
 * // Cancel if needed (e.g., on component unmount or user action)
 * cancel();
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useDebouncedCallbackWithCancel<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): {
  debouncedCallback: (...args: Parameters<T>) => void;
  cancel: () => void;
  flush: () => void;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  const argsRef = useRef<Parameters<T> | null>(null);

  // Keep callback ref up to date
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    argsRef.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timerRef.current && argsRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      callbackRef.current(...argsRef.current);
      argsRef.current = null;
    }
  }, []);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      argsRef.current = args;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
        argsRef.current = null;
      }, delay);
    },
    [delay]
  );

  return { debouncedCallback, cancel, flush };
}
