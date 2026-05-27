import { create } from "zustand";

export interface NotificationError {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  persistent?: boolean;
}

export interface PushErrorOptions {
  description?: string;
  /**
   * Suppress the 5s auto-dismiss timer. The user must close the banner
   * manually. Reserve for messages that the user has to see even while
   * actively typing — e.g. read-only autosave failures, where the user
   * is mid-edit and a transient toast would be invisible.
   */
  persistent?: boolean;
}

export type ProgressStatus = "running" | "success" | "error";

export interface ProgressTask {
  id: string;
  label: string;
  /**
   * Optional step text shown beneath the label. Long-running tasks
   * (PDF export, large imports) update this as they move through
   * phases so the user sees the operation is making progress.
   */
  detail?: string;
  status: ProgressStatus;
  message?: string;
  startedAt: number;
  finishedAt?: number;
}

interface NotificationState {
  errors: NotificationError[];
  progress: ProgressTask[];

  pushError: (title: string, options?: PushErrorOptions) => string;
  dismissError: (id: string) => void;
  clearAllErrors: () => void;

  startProgress: (label: string, detail?: string) => string;
  updateProgress: (id: string, patch: { label?: string; detail?: string }) => void;
  resolveProgress: (id: string, message?: string) => void;
  failProgress: (id: string, message?: string) => void;
  removeProgress: (id: string) => void;
}

let nextId = 0;
const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(nextId++).toString(36)}`;

export const useNotificationStore = create<NotificationState>((set) => ({
  errors: [],
  progress: [],

  pushError: (title, options) => {
    const id = makeId("err");
    set((state) => ({
      errors: [
        ...state.errors,
        {
          id,
          title,
          description: options?.description,
          persistent: options?.persistent,
          createdAt: Date.now(),
        },
      ],
    }));
    return id;
  },

  dismissError: (id) => {
    set((state) => ({ errors: state.errors.filter((error) => error.id !== id) }));
  },

  clearAllErrors: () => set({ errors: [] }),

  startProgress: (label, detail) => {
    const id = makeId("prog");
    set((state) => ({
      progress: [
        ...state.progress,
        { id, label, detail, status: "running", startedAt: Date.now() },
      ],
    }));
    return id;
  },

  updateProgress: (id, patch) => {
    set((state) => ({
      progress: state.progress.map((task) =>
        task.id === id
          ? {
              ...task,
              ...(patch.label !== undefined ? { label: patch.label } : {}),
              ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
            }
          : task
      ),
    }));
  },

  resolveProgress: (id, message) => {
    set((state) => ({
      progress: state.progress.map((task) =>
        task.id === id ? { ...task, status: "success", message, finishedAt: Date.now() } : task
      ),
    }));
  },

  failProgress: (id, message) => {
    set((state) => ({
      progress: state.progress.map((task) =>
        task.id === id ? { ...task, status: "error", message, finishedAt: Date.now() } : task
      ),
    }));
  },

  removeProgress: (id) => {
    set((state) => ({ progress: state.progress.filter((task) => task.id !== id) }));
  },
}));

export function notify(title: string, description?: string) {
  return useNotificationStore.getState().pushError(title, { description });
}
