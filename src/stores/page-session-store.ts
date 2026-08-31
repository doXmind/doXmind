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

/** A request to put the caret on one line of a Page, raised by a surface outside the editor. */
export interface PageRevealRequest {
  pageId: string;
  /** 1-based line within the Page body, matching what workspace search reports. */
  line: number;
  /** Distinguishes two clicks on the same line, so the second one still scrolls. */
  token: number;
}

interface PageSessionState {
  outlineSession: PageOutlineSession | null;
  publishOutline: (session: PageOutlineSession) => void;
  clearOutline: (pageId: string) => void;

  revealRequest: PageRevealRequest | null;
  requestReveal: (pageId: string, line: number) => void;
  clearReveal: () => void;
}

let revealToken = 0;

export const usePageSessionStore = create<PageSessionState>()((set) => ({
  outlineSession: null,
  publishOutline: (outlineSession) => set({ outlineSession }),
  clearOutline: (pageId) =>
    set((state) => (state.outlineSession?.pageId === pageId ? { outlineSession: null } : state)),

  revealRequest: null,
  requestReveal: (pageId, line) => {
    revealToken += 1;
    set({ revealRequest: { pageId, line, token: revealToken } });
  },
  clearReveal: () => set({ revealRequest: null }),
}));
