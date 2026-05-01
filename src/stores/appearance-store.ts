import { create } from "zustand";
import { persist } from "zustand/middleware";

const UI_FONT_SIZE_MIN = 10;
const UI_FONT_SIZE_MAX = 22;
const UI_FONT_SIZE_DEFAULT = 13;
const CODE_FONT_SIZE_DEFAULT = 12;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

export const WELCOME_MODES = ["continuum", "stratigraphy", "terminal", "paper"] as const;
export type WelcomeMode = (typeof WELCOME_MODES)[number];
const WELCOME_MODE_DEFAULT: WelcomeMode = "stratigraphy";

interface AppearanceState {
  uiFontSize: number;
  codeFontSize: number;
  pointerCursors: boolean;
  welcomeMode: WelcomeMode;

  setUiFontSize: (value: number) => void;
  setCodeFontSize: (value: number) => void;
  setPointerCursors: (value: boolean) => void;
  setWelcomeMode: (value: WelcomeMode) => void;
  reset: () => void;
}

export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      uiFontSize: UI_FONT_SIZE_DEFAULT,
      codeFontSize: CODE_FONT_SIZE_DEFAULT,
      pointerCursors: false,
      welcomeMode: WELCOME_MODE_DEFAULT,

      setUiFontSize: (value) =>
        set({ uiFontSize: clamp(value, UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX) }),
      setCodeFontSize: (value) =>
        set({ codeFontSize: clamp(value, UI_FONT_SIZE_MIN, UI_FONT_SIZE_MAX) }),
      setPointerCursors: (value) => set({ pointerCursors: value }),
      setWelcomeMode: (value) => set({ welcomeMode: value }),

      reset: () =>
        set({
          uiFontSize: UI_FONT_SIZE_DEFAULT,
          codeFontSize: CODE_FONT_SIZE_DEFAULT,
          pointerCursors: false,
          welcomeMode: WELCOME_MODE_DEFAULT,
        }),
    }),
    {
      name: "doxmind-appearance",
    }
  )
);

export const APPEARANCE_LIMITS = {
  min: UI_FONT_SIZE_MIN,
  max: UI_FONT_SIZE_MAX,
  uiDefault: UI_FONT_SIZE_DEFAULT,
  codeDefault: CODE_FONT_SIZE_DEFAULT,
};
