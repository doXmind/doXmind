export type DesktopPlatform = "macos" | "windows" | "linux";

export interface DesktopEvent<T = unknown> {
  event: string;
  payload: T;
}

/**
 * Narrow renderer Interface exposed by Electron's context-isolated preload.
 * Browser development intentionally has no Implementation of this Interface.
 */
export interface DesktopBridge {
  platform: DesktopPlatform;
  invoke<T>(command: string, payload?: Record<string, unknown>): Promise<T>;
  listen<T>(event: string, callback: (event: DesktopEvent<T>) => void): () => void;
  getPathForFile(file: File): string | null;
}

declare global {
  interface Window {
    __DOXMIND_DESKTOP__?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = window.__DOXMIND_DESKTOP__;
  if (
    !bridge ||
    typeof bridge.invoke !== "function" ||
    typeof bridge.listen !== "function" ||
    typeof bridge.getPathForFile !== "function"
  ) {
    return null;
  }
  return bridge;
}

export function hasDesktopBridge(): boolean {
  return getDesktopBridge() !== null;
}

/** Detect Electron even when preload failed, so desktop I/O never falls back to HTTP. */
export function isElectronRenderer(): boolean {
  if (typeof navigator === "undefined") return false;
  return /(?:^|\s)Electron\/\d/i.test(navigator.userAgent);
}

export async function invokeDesktop<T>(
  command: string,
  payload: Record<string, unknown> = {}
): Promise<T> {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("Electron desktop bridge unavailable");
  return bridge.invoke<T>(command, payload);
}

export function listenDesktop<T>(
  event: string,
  callback: (event: DesktopEvent<T>) => void
): () => void {
  const bridge = getDesktopBridge();
  if (!bridge) return () => {};
  return bridge.listen(event, callback);
}

export function desktopPlatform(): DesktopPlatform | null {
  return getDesktopBridge()?.platform ?? null;
}
