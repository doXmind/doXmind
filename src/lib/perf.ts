// Lightweight performance instrumentation, opt-in via:
//   - URL `?perf=1` (preferred — works on the very first page load)
//   - localStorage.DOXMIND_PERF = "1"
//   - or `window.__DOXMIND_PERF__ = true` (set by the dev overlay)
//
// In production (and by default in dev) every helper is a no-op so we pay
// nothing. When enabled, marks/measures land in the browser User Timings
// (visible in DevTools Performance) AND a small ring-buffer that the dev
// overlay (perf-overlay.tsx) reads to show p50/p95 per name.
//
// The enabled flag is captured ONCE at module load and cached for the life
// of the page. Earlier versions called `localStorage.getItem` on every
// `perfMark` / `perfSync` / `perfAsync` invocation; on the file-switch hot
// path that adds up to a dozen+ synchronous storage hits per switch, paid
// by every default-disabled user. Toggling perf mid-session now requires
// a reload (the `?perf=1` URL flow already implies one).

type PerfRecord = {
  name: string;
  durationMs: number;
  startTime: number;
  detail?: Record<string, unknown>;
};

const RING_SIZE = 500;

declare global {
  interface Window {
    __DOXMIND_PERF__?: boolean;
    __doxmindPerfRing__?: PerfRecord[];
    /**
     * Cross-component handshake for the user-visible switch.firstPaint
     * measure. editor-client sets these on currentFileId change; whichever
     * workspace finishes mounting first reads them, closes the measure,
     * and clears them so subsequent re-renders don't double-stamp. See the
     * effect blocks in editor.tsx / pdf-editor-workspace.tsx /
     * excel-editor-workspace.tsx that consume these.
     */
    __doxmindSwitchStartMark?: string;
    __doxmindSwitchFileId?: string;
    __doxmindEditorActivationStartMark?: string;
    __doxmindEditorActivationFileId?: string;
  }
}

const _enabled: boolean = (() => {
  if (typeof window === "undefined") return false;
  if (window.__DOXMIND_PERF__) return true;
  try {
    if (window.localStorage?.getItem("DOXMIND_PERF") === "1") return true;
  } catch {
    // localStorage may be locked in some sandboxed contexts; fall through.
  }
  try {
    if (
      typeof window.location?.search === "string" &&
      new URLSearchParams(window.location.search).get("perf") === "1"
    ) {
      return true;
    }
  } catch {
    // URL parsing should never throw, but stay defensive.
  }
  return false;
})();

function ring(): PerfRecord[] {
  if (typeof window === "undefined") return [];
  if (!window.__doxmindPerfRing__) window.__doxmindPerfRing__ = [];
  return window.__doxmindPerfRing__;
}

function pushRecord(record: PerfRecord): void {
  const buffer = ring();
  buffer.push(record);
  if (buffer.length > RING_SIZE) buffer.splice(0, buffer.length - RING_SIZE);
  // Notify any subscribers (the dev overlay uses this).
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("doxmind:perf", { detail: record }));
  }
}

export function perfMark(name: string): void {
  if (!_enabled) return;
  try {
    performance.mark(name);
  } catch {
    // ignore — older browsers / restricted contexts
  }
}

export function perfMeasure(
  name: string,
  startMark: string,
  endMark?: string,
  detail?: Record<string, unknown>
): void {
  if (!_enabled) return;
  try {
    const entry = performance.measure(name, startMark, endMark);
    pushRecord({
      name,
      durationMs: entry.duration,
      startTime: entry.startTime,
      detail,
    });
  } catch {
    // start/end mark may not exist if a code path bailed early — ignore
  }
}

// Time a synchronous operation. Returns whatever fn returns.
export function perfSync<T>(name: string, fn: () => T, detail?: Record<string, unknown>): T {
  if (!_enabled) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    const dur = performance.now() - start;
    try {
      performance.measure(name, { start, duration: dur });
    } catch {
      // older browsers don't support the options form
    }
    pushRecord({ name, durationMs: dur, startTime: start, detail });
  }
}

// Time an async operation.
export async function perfAsync<T>(
  name: string,
  fn: () => Promise<T>,
  detail?: Record<string, unknown>
): Promise<T> {
  if (!_enabled) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const dur = performance.now() - start;
    try {
      performance.measure(name, { start, duration: dur });
    } catch {
      // ignore
    }
    pushRecord({ name, durationMs: dur, startTime: start, detail });
  }
}

// Read the ring buffer (for the dev overlay).
export function perfSnapshot(): PerfRecord[] {
  return ring().slice();
}

export function perfClear(): void {
  if (typeof window === "undefined") return;
  window.__doxmindPerfRing__ = [];
  try {
    performance.clearMarks();
    performance.clearMeasures();
  } catch {
    // ignore
  }
}

export function perfEnabled(): boolean {
  return _enabled;
}

export type { PerfRecord };
