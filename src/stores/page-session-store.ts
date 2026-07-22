import { create } from "zustand";

export interface PageOutlineItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

export interface PageOutlineSession {
  pageId: string;
  headings: PageOutlineItem[];
  activeId: string | null;
  navigateTo: (heading: PageOutlineItem, options?: { skipFocus?: boolean }) => void;
}

interface PageSessionState {
  outlineSession: PageOutlineSession | null;
  publishOutline: (session: PageOutlineSession) => void;
  clearOutline: (pageId: string) => void;
}

export const usePageSessionStore = create<PageSessionState>()((set) => ({
  outlineSession: null,
  publishOutline: (outlineSession) => set({ outlineSession }),
  clearOutline: (pageId) =>
    set((state) => (state.outlineSession?.pageId === pageId ? { outlineSession: null } : state)),
}));
