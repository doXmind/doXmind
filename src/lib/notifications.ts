import { useNotificationStore } from "@/stores/notification-store";

interface ErrorOptions {
  description?: string;
}

interface PromiseOptions<T> {
  loading: string;
  success: string | ((value: T) => string);
  error: string | ((reason: unknown) => string);
}

/**
 * Inline notification surface — replaces sonner toast.
 *
 * - `error`: pushes to top-of-viewport banner stack, auto-dismisses after 5s
 * - `promise`: registers a header progress strip until resolved/rejected
 *
 * Success operations are silent by design: the UI change itself (sidebar
 * updates, file appearing, content rendering) is the feedback. No success
 * helper is exported — mirror Notion: silence on the happy path.
 */
export const notify = {
  error(title: string, options?: ErrorOptions): string {
    return useNotificationStore.getState().pushError(title, options?.description);
  },

  // Mirrors sonner's `toast.promise` shape but routes through our two
  // surfaces: the running task lives in the header progress strip, and a
  // rejection becomes a real error banner so the failure is actually
  // visible (the strip itself only renders while a task is `running`).
  //
  // The returned promise *resolves* in both branches — it never rejects —
  // because every call site fires it with `void` and an unhandled rejection
  // would otherwise bubble up. Callers that need the resolved value can
  // still `await` and discriminate on `undefined`.
  promise<T>(promise: Promise<T>, opts: PromiseOptions<T>): Promise<T | undefined> {
    const id = useNotificationStore.getState().startProgress(opts.loading);
    return promise.then(
      (value) => {
        const msg = typeof opts.success === "function" ? opts.success(value) : opts.success;
        useNotificationStore.getState().resolveProgress(id, msg);
        return value;
      },
      (reason) => {
        const msg = typeof opts.error === "function" ? opts.error(reason) : opts.error;
        useNotificationStore.getState().failProgress(id, msg);
        useNotificationStore.getState().pushError(msg);
        return undefined;
      }
    );
  },

  startProgress(label: string): string {
    return useNotificationStore.getState().startProgress(label);
  },
  resolveProgress(id: string, message?: string): void {
    useNotificationStore.getState().resolveProgress(id, message);
  },
  failProgress(id: string, message?: string): void {
    useNotificationStore.getState().failProgress(id, message);
  },
};
