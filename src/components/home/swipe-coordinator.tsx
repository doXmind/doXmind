"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";

interface SwipeCoordinatorContextType {
  /** Register a swipeable row. Returns cleanup function. */
  register: (id: string, closeCallback: () => void) => () => void;
  /** Called when a row opens — closes all other registered rows. */
  setOpenRow: (id: string) => void;
  /** Close all open rows (e.g., on scroll start). */
  closeAll: () => void;
}

const SwipeCoordinatorContext = createContext<SwipeCoordinatorContextType | null>(null);

export function SwipeCoordinatorProvider({ children }: { children: ReactNode }) {
  const rowsRef = useRef<Map<string, () => void>>(new Map());

  const register = useCallback((id: string, closeCallback: () => void) => {
    rowsRef.current.set(id, closeCallback);
    return () => {
      rowsRef.current.delete(id);
    };
  }, []);

  const setOpenRow = useCallback((id: string) => {
    rowsRef.current.forEach((close, rowId) => {
      if (rowId !== id) close();
    });
  }, []);

  const closeAll = useCallback(() => {
    rowsRef.current.forEach((close) => close());
  }, []);

  const value = useMemo(
    () => ({ register, setOpenRow, closeAll }),
    [register, setOpenRow, closeAll]
  );

  return (
    <SwipeCoordinatorContext.Provider value={value}>{children}</SwipeCoordinatorContext.Provider>
  );
}

export function useSwipeCoordinator() {
  return useContext(SwipeCoordinatorContext);
}
