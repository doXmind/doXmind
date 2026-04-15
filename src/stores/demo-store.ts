/**
 * Demo store stub — local desktop edition has no demo mode.
 */

import { create } from "zustand";

interface DemoState {
  isDemoMode: boolean;
  demoFile: null;
  updateDemoContent: (_content: string) => void;
  enable: () => void;
  disable: () => void;
}

export const useDemoStore = create<DemoState>(() => ({
  isDemoMode: false,
  demoFile: null,
  updateDemoContent: () => {},
  enable: () => {},
  disable: () => {},
}));
