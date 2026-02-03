import { create } from "zustand";
import type { FileItem } from "@/types";

interface DemoState {
  isDemoMode: boolean;
  demoFile: FileItem | null;
  initDemo: (content: string) => void;
  updateDemoContent: (content: string) => void;
  resetDemo: () => void;
}

export const useDemoStore = create<DemoState>((set) => ({
  isDemoMode: false,
  demoFile: null,

  initDemo: (content: string) =>
    set({
      isDemoMode: true,
      demoFile: {
        id: "demo-file",
        name: "Demo Document",
        content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }),

  updateDemoContent: (content: string) =>
    set((state) => ({
      demoFile: state.demoFile
        ? { ...state.demoFile, content, updatedAt: new Date().toISOString() }
        : null,
    })),

  resetDemo: () => set({ isDemoMode: false, demoFile: null }),
}));
