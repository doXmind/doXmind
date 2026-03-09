/**
 * Stores the exact markdown snapshot sent to the server in each ChatRequest.
 *
 * When AI edits arrive back, the diff-review system needs the SAME markdown
 * the server validated old_str against. Without this store, the frontend reads
 * `file.contentMarkdown` from the file store, which is updated by a 1 s debounced
 * save — creating a timing gap where the two markdowns can diverge.
 */

import { create } from "zustand";

interface EditSnapshotState {
  /** fileId → exact markdown sent to the server */
  snapshots: Map<string, string>;

  /** Store a snapshot when a chat/inline-AI request is sent */
  setSnapshot: (fileId: string, markdown: string) => void;

  /** Retrieve the snapshot (called by use-edit-operations) */
  getSnapshot: (fileId: string) => string | undefined;

  /** Clear a snapshot when the diff-review session ends */
  clearSnapshot: (fileId: string) => void;
}

export const useEditSnapshotStore = create<EditSnapshotState>()((set, get) => ({
  snapshots: new Map(),

  setSnapshot: (fileId, markdown) =>
    set((state) => {
      const next = new Map(state.snapshots);
      next.set(fileId, markdown);
      return { snapshots: next };
    }),

  getSnapshot: (fileId) => get().snapshots.get(fileId),

  clearSnapshot: (fileId) =>
    set((state) => {
      const next = new Map(state.snapshots);
      next.delete(fileId);
      return { snapshots: next };
    }),
}));
