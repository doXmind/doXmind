import type { ThemeDefinition, ThemeDiffTokens, ThemeStatusTokens } from "./types";

// ─── Shared diff / status templates ──────────────────────────────────────────
// Diff and status accents read consistently across themes — Apple-style red /
// green for inserted/deleted, neutral blue for focus. Per-theme deviations
// only matter when the theme's own accent palette is dramatic enough to
// warrant overriding (e.g. Dracula); kept centralised otherwise.

const LIGHT_DIFF: ThemeDiffTokens = {
  deletedBg: "rgba(255, 59, 48, 0.08)",
  deletedBgHover: "rgba(255, 59, 48, 0.12)",
  deletedBorder: "rgba(255, 59, 48, 0.2)",
  deletedText: "rgba(255, 59, 48, 0.7)",
  insertedBg: "rgba(52, 199, 89, 0.07)",
  insertedBgHover: "rgba(52, 199, 89, 0.11)",
  insertedBorder: "rgba(52, 199, 89, 0.18)",
  insertedAccent: "rgba(52, 199, 89, 0.5)",
  focusRing: "rgba(0, 122, 255, 0.25)",
  focusBorder: "rgba(0, 122, 255, 0.3)",
  toolbarBg: "rgba(255, 255, 255, 0.72)",
  toolbarBorder: "rgba(0, 0, 0, 0.06)",
  toolbarShadow: "0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.03)",
  btnAcceptBg: "rgba(52, 199, 89, 0.12)",
  btnAcceptFg: "rgb(36, 138, 61)",
  btnAcceptHover: "rgba(52, 199, 89, 0.2)",
  btnRejectBg: "rgba(255, 59, 48, 0.1)",
  btnRejectFg: "rgb(196, 43, 28)",
  btnRejectHover: "rgba(255, 59, 48, 0.18)",
};

const DARK_DIFF: ThemeDiffTokens = {
  deletedBg: "rgba(248, 81, 73, 0.1)",
  deletedBgHover: "rgba(248, 81, 73, 0.16)",
  deletedBorder: "rgba(248, 81, 73, 0.22)",
  deletedText: "rgba(248, 81, 73, 0.85)",
  insertedBg: "rgba(63, 185, 80, 0.08)",
  insertedBgHover: "rgba(63, 185, 80, 0.14)",
  insertedBorder: "rgba(63, 185, 80, 0.22)",
  insertedAccent: "rgba(63, 185, 80, 0.5)",
  focusRing: "rgba(47, 129, 247, 0.35)",
  focusBorder: "rgba(47, 129, 247, 0.4)",
  toolbarBg: "rgba(22, 27, 34, 0.85)",
  toolbarBorder: "rgba(255, 255, 255, 0.08)",
  toolbarShadow: "0 1px 3px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2)",
  btnAcceptBg: "rgba(63, 185, 80, 0.15)",
  btnAcceptFg: "rgb(63, 185, 80)",
  btnAcceptHover: "rgba(63, 185, 80, 0.25)",
  btnRejectBg: "rgba(248, 81, 73, 0.15)",
  btnRejectFg: "rgb(248, 81, 73)",
  btnRejectHover: "rgba(248, 81, 73, 0.25)",
};

const LIGHT_STATUS: ThemeStatusTokens = {
  successBg: "rgba(34, 197, 94, 0.1)",
  successBorder: "rgba(34, 197, 94, 0.3)",
  errorBg: "rgba(239, 68, 68, 0.1)",
  errorBorder: "rgba(239, 68, 68, 0.3)",
  infoBg: "rgba(59, 130, 246, 0.1)",
  infoBorder: "rgba(59, 130, 246, 0.3)",
  thinkingBg: "rgba(168, 85, 247, 0.1)",
  thinkingBorder: "rgba(168, 85, 247, 0.3)",
  warningBg: "rgba(251, 191, 36, 0.1)",
  warningBorder: "rgba(251, 191, 36, 0.3)",
};

const DARK_STATUS: ThemeStatusTokens = {
  successBg: "rgba(63, 185, 80, 0.1)",
  successBorder: "rgba(63, 185, 80, 0.3)",
  errorBg: "rgba(248, 81, 73, 0.1)",
  errorBorder: "rgba(248, 81, 73, 0.3)",
  infoBg: "rgba(47, 129, 247, 0.1)",
  infoBorder: "rgba(47, 129, 247, 0.3)",
  thinkingBg: "rgba(168, 85, 247, 0.1)",
  thinkingBorder: "rgba(168, 85, 247, 0.3)",
  warningBg: "rgba(210, 153, 34, 0.1)",
  warningBorder: "rgba(210, 153, 34, 0.3)",
};

// ─── Notion ──────────────────────────────────────────────────────────────────
// Light: Notion's classic warm-white surface (doXmind default).
// Dark: Notion's actual dark mode — neutral charcoal stack.
const notion: ThemeDefinition = {
  id: "notion",
  name: "Notion",
  description: "Clean, warm, minimal — the classic writing surface",
  baseMode: "light",
  tier: "free",
  preview: { accentColor: "#37352F", backgroundColor: "#FFFFFF", foregroundColor: "#37352F" },
  tokens: {
    background: "0 0% 100%",
    foreground: "45 8% 20%",
    card: "0 0% 100%",
    cardForeground: "45 8% 20%",
    popover: "0 0% 100%",
    popoverForeground: "45 8% 20%",
    primary: "45 8% 20%",
    primaryForeground: "0 0% 100%",
    secondary: "40 10% 95%",
    secondaryForeground: "45 8% 20%",
    muted: "40 10% 95%",
    mutedForeground: "40 3% 46%",
    accent: "40 10% 95%",
    accentForeground: "45 8% 20%",
    destructive: "0 84.2% 60.2%",
    destructiveForeground: "0 0% 98%",
    border: "60 4% 91%",
    borderSubtle: "60 4% 94%",
    input: "60 4% 91%",
    ring: "45 8% 20%",
    sidebar: "0 0% 100%",
  },
  diff: LIGHT_DIFF,
  status: LIGHT_STATUS,
};

const notionDark: ThemeDefinition = {
  id: "notion-dark",
  name: "Notion",
  description: "Notion's nocturnal palette — neutral charcoal with warm ink",
  baseMode: "dark",
  tier: "free",
  preview: { accentColor: "#2EAADC", backgroundColor: "#191919", foregroundColor: "#FFFFFF" },
  tokens: {
    background: "0 0% 10%", // #191919
    foreground: "0 0% 100%",
    card: "0 0% 13%",
    cardForeground: "0 0% 100%",
    popover: "0 0% 15%",
    popoverForeground: "0 0% 100%",
    primary: "0 0% 100%",
    primaryForeground: "0 0% 10%",
    secondary: "0 0% 18%",
    secondaryForeground: "0 0% 92%",
    muted: "0 0% 18%",
    mutedForeground: "0 0% 60%",
    accent: "198 73% 52%", // Notion blue #2EAADC
    accentForeground: "0 0% 100%",
    destructive: "0 62.8% 30.6%",
    destructiveForeground: "0 0% 95%",
    border: "0 0% 21%", // #373737
    borderSubtle: "0 0% 16%",
    input: "0 0% 21%",
    ring: "0 0% 80%",
    sidebar: "0 0% 10%",
  },
  diff: DARK_DIFF,
  status: DARK_STATUS,
};

// ─── GitHub ──────────────────────────────────────────────────────────────────
// Palettes from primer/primitives canvas + accent tokens.
const githubLight: ThemeDefinition = {
  id: "github-light",
  name: "GitHub",
  description: "GitHub's primer light palette",
  baseMode: "light",
  tier: "free",
  preview: { accentColor: "#0969DA", backgroundColor: "#FFFFFF", foregroundColor: "#1F2328" },
  tokens: {
    background: "0 0% 100%",
    foreground: "215 14% 14%",
    card: "0 0% 100%",
    cardForeground: "215 14% 14%",
    popover: "0 0% 100%",
    popoverForeground: "215 14% 14%",
    primary: "212 92% 45%",
    primaryForeground: "0 0% 100%",
    secondary: "210 17% 97%",
    secondaryForeground: "215 14% 14%",
    muted: "210 17% 97%",
    mutedForeground: "215 11% 39%",
    accent: "210 17% 97%",
    accentForeground: "212 92% 45%",
    destructive: "354 71% 48%",
    destructiveForeground: "0 0% 98%",
    border: "210 18% 85%",
    borderSubtle: "210 17% 90%",
    input: "210 18% 85%",
    ring: "212 92% 45%",
    sidebar: "0 0% 100%",
  },
  diff: LIGHT_DIFF,
  status: LIGHT_STATUS,
};

const githubDark: ThemeDefinition = {
  id: "github-dark",
  name: "GitHub",
  description: "GitHub's primer dark palette",
  baseMode: "dark",
  tier: "free",
  preview: { accentColor: "#2F81F7", backgroundColor: "#0D1117", foregroundColor: "#E6EDF3" },
  tokens: {
    background: "215 28% 7%",
    foreground: "213 22% 92%",
    card: "215 21% 11%",
    cardForeground: "213 22% 92%",
    popover: "215 21% 11%",
    popoverForeground: "213 22% 92%",
    primary: "212 92% 58%",
    primaryForeground: "0 0% 100%",
    secondary: "215 21% 11%",
    secondaryForeground: "213 22% 92%",
    muted: "215 21% 11%",
    mutedForeground: "213 9% 60%",
    accent: "215 21% 11%",
    accentForeground: "212 92% 58%",
    destructive: "4 92% 63%",
    destructiveForeground: "0 0% 100%",
    border: "215 11% 27%",
    borderSubtle: "213 16% 15%",
    input: "215 11% 27%",
    ring: "212 92% 58%",
    sidebar: "215 28% 7%",
  },
  diff: DARK_DIFF,
  status: DARK_STATUS,
};

// ─── VS Code (Default Light+ / Default Dark+) ────────────────────────────────
const vscodeLight: ThemeDefinition = {
  id: "vscode-light",
  name: "VS Code",
  description: "VS Code's Default Light+ — editor white with statusbar blue",
  baseMode: "light",
  tier: "free",
  preview: { accentColor: "#007ACC", backgroundColor: "#FFFFFF", foregroundColor: "#000000" },
  tokens: {
    background: "0 0% 100%",
    foreground: "0 0% 0%",
    card: "0 0% 100%",
    cardForeground: "0 0% 0%",
    popover: "0 0% 100%",
    popoverForeground: "0 0% 0%",
    primary: "204 100% 40%",
    primaryForeground: "0 0% 100%",
    secondary: "0 0% 95%", // #f3f3f3 sideBar.background
    secondaryForeground: "0 0% 25%",
    muted: "0 0% 95%",
    mutedForeground: "0 0% 38%", // #616161
    accent: "204 100% 95%",
    accentForeground: "204 100% 40%",
    destructive: "354 71% 48%",
    destructiveForeground: "0 0% 100%",
    border: "0 0% 91%", // #e7e7e7
    borderSubtle: "0 0% 95%",
    input: "0 0% 91%",
    ring: "204 100% 40%",
    sidebar: "0 0% 95%",
  },
  diff: LIGHT_DIFF,
  status: LIGHT_STATUS,
};

const vscodeDark: ThemeDefinition = {
  id: "vscode-dark",
  name: "VS Code",
  description: "VS Code's Default Dark+ — editor #1E1E1E with statusbar blue",
  baseMode: "dark",
  tier: "free",
  preview: { accentColor: "#007ACC", backgroundColor: "#1E1E1E", foregroundColor: "#D4D4D4" },
  tokens: {
    background: "0 0% 12%",
    foreground: "0 0% 83%",
    card: "240 2% 15%",
    cardForeground: "0 0% 80%",
    popover: "0 0% 18%",
    popoverForeground: "0 0% 83%",
    primary: "204 100% 40%",
    primaryForeground: "0 0% 100%",
    secondary: "240 2% 15%",
    secondaryForeground: "0 0% 83%",
    muted: "240 2% 15%",
    mutedForeground: "0 0% 60%",
    accent: "207 86% 24%",
    accentForeground: "0 0% 100%",
    destructive: "0 75% 50%",
    destructiveForeground: "0 0% 100%",
    border: "0 0% 24%",
    borderSubtle: "0 0% 18%",
    input: "0 0% 24%",
    ring: "204 100% 50%",
    sidebar: "240 2% 15%",
  },
  diff: DARK_DIFF,
  status: DARK_STATUS,
};

// ─── Atom One ────────────────────────────────────────────────────────────────
const oneLight: ThemeDefinition = {
  id: "one-light",
  name: "Atom One",
  description: "Atom's One Light — soft cream with measured blue accent",
  baseMode: "light",
  tier: "free",
  preview: { accentColor: "#4078F2", backgroundColor: "#FAFAFA", foregroundColor: "#383A42" },
  tokens: {
    background: "0 0% 98%", // #fafafa
    foreground: "225 8% 24%", // #383a42
    card: "0 0% 98%",
    cardForeground: "225 8% 24%",
    popover: "0 0% 100%",
    popoverForeground: "225 8% 24%",
    primary: "220 87% 60%", // #4078f2
    primaryForeground: "0 0% 100%",
    secondary: "240 1% 90%", // #e5e5e6
    secondaryForeground: "225 8% 24%",
    muted: "240 1% 90%",
    mutedForeground: "220 4% 51%", // #a0a1a7
    accent: "240 1% 90%",
    accentForeground: "220 87% 60%",
    destructive: "5 74% 59%", // #e45649
    destructiveForeground: "0 0% 100%",
    border: "240 6% 84%",
    borderSubtle: "240 6% 90%",
    input: "240 6% 84%",
    ring: "220 87% 60%",
    sidebar: "0 0% 98%",
  },
  diff: LIGHT_DIFF,
  status: LIGHT_STATUS,
};

const oneDark: ThemeDefinition = {
  id: "one-dark",
  name: "Atom One",
  description: "Atom's One Dark — slate with cool blue + muted comments",
  baseMode: "dark",
  tier: "free",
  preview: { accentColor: "#61AFEF", backgroundColor: "#282C34", foregroundColor: "#ABB2BF" },
  tokens: {
    background: "220 13% 18%", // #282c34
    foreground: "219 14% 71%", // #abb2bf
    card: "220 13% 22%",
    cardForeground: "219 14% 71%",
    popover: "220 13% 22%",
    popoverForeground: "219 14% 71%",
    primary: "207 82% 66%", // #61afef
    primaryForeground: "220 13% 18%",
    secondary: "220 13% 25%", // #3e4451
    secondaryForeground: "219 14% 71%",
    muted: "220 13% 25%",
    mutedForeground: "220 10% 40%", // #5c6370 comment
    accent: "220 13% 25%",
    accentForeground: "207 82% 66%",
    destructive: "355 65% 65%", // #e06c75
    destructiveForeground: "0 0% 100%",
    border: "220 13% 30%",
    borderSubtle: "220 13% 22%",
    input: "220 13% 30%",
    ring: "207 82% 66%",
    sidebar: "220 13% 18%",
  },
  diff: DARK_DIFF,
  status: DARK_STATUS,
};

// ─── Solarized ───────────────────────────────────────────────────────────────
// Ethan Schoonover's signature palette — base03/base3 backgrounds, blue accent.
const solarizedLight: ThemeDefinition = {
  id: "solarized-light",
  name: "Solarized",
  description: "Solarized base3 cream — warm yellow surface with cyan accent",
  baseMode: "light",
  tier: "free",
  preview: { accentColor: "#268BD2", backgroundColor: "#FDF6E3", foregroundColor: "#657B83" },
  tokens: {
    background: "44 87% 94%", // #fdf6e3
    foreground: "196 13% 45%", // #657b83
    card: "44 87% 94%",
    cardForeground: "196 13% 45%",
    popover: "46 42% 88%", // #eee8d5
    popoverForeground: "196 13% 45%",
    primary: "205 69% 49%", // #268bd2
    primaryForeground: "0 0% 100%",
    secondary: "46 42% 88%",
    secondaryForeground: "196 13% 45%",
    muted: "46 42% 88%",
    mutedForeground: "196 13% 35%",
    accent: "46 42% 88%",
    accentForeground: "205 69% 49%",
    destructive: "1 71% 52%", // #dc322f
    destructiveForeground: "0 0% 100%",
    border: "46 42% 80%",
    borderSubtle: "46 42% 88%",
    input: "46 42% 80%",
    ring: "205 69% 49%",
    sidebar: "44 87% 94%",
  },
  diff: LIGHT_DIFF,
  status: LIGHT_STATUS,
};

const solarizedDark: ThemeDefinition = {
  id: "solarized-dark",
  name: "Solarized",
  description: "Solarized base03 — deep teal surface with cyan accent",
  baseMode: "dark",
  tier: "free",
  preview: { accentColor: "#268BD2", backgroundColor: "#002B36", foregroundColor: "#839496" },
  tokens: {
    background: "192 100% 11%", // #002b36
    foreground: "184 6% 55%", // #839496
    card: "192 81% 14%", // #073642
    cardForeground: "184 6% 55%",
    popover: "192 81% 14%",
    popoverForeground: "184 6% 55%",
    primary: "205 69% 49%",
    primaryForeground: "0 0% 100%",
    secondary: "192 81% 14%",
    secondaryForeground: "184 6% 55%",
    muted: "192 81% 14%",
    mutedForeground: "180 7% 60%", // #93a1a1
    accent: "192 81% 14%",
    accentForeground: "205 69% 49%",
    destructive: "1 71% 52%",
    destructiveForeground: "0 0% 100%",
    border: "192 50% 22%",
    borderSubtle: "192 65% 18%",
    input: "192 50% 22%",
    ring: "205 69% 49%",
    sidebar: "192 100% 11%",
  },
  diff: DARK_DIFF,
  status: DARK_STATUS,
};

// ─── Tokyo (Day / Night) ─────────────────────────────────────────────────────
const tokyoDay: ThemeDefinition = {
  id: "tokyo-day",
  name: "Tokyo",
  description: "Tokyo Night Day — cool periwinkle haze with deep blue ink",
  baseMode: "light",
  tier: "free",
  preview: { accentColor: "#2E7DE9", backgroundColor: "#E1E2E7", foregroundColor: "#3760BF" },
  tokens: {
    background: "225 13% 90%", // #e1e2e7
    foreground: "220 54% 48%", // #3760bf
    card: "0 0% 100%",
    cardForeground: "220 54% 48%",
    popover: "0 0% 100%",
    popoverForeground: "220 54% 48%",
    primary: "213 81% 55%", // #2e7de9
    primaryForeground: "0 0% 100%",
    secondary: "227 41% 80%", // #b6bfe2
    secondaryForeground: "220 54% 48%",
    muted: "227 41% 80%",
    mutedForeground: "220 18% 45%",
    accent: "227 41% 80%",
    accentForeground: "213 81% 55%",
    destructive: "354 80% 56%",
    destructiveForeground: "0 0% 100%",
    border: "227 41% 75%",
    borderSubtle: "227 41% 82%",
    input: "227 41% 75%",
    ring: "213 81% 55%",
    sidebar: "225 13% 90%",
  },
  diff: LIGHT_DIFF,
  status: LIGHT_STATUS,
};

const tokyoNight: ThemeDefinition = {
  id: "tokyo-night",
  name: "Tokyo",
  description: "Tokyo Night — indigo midnight with periwinkle text",
  baseMode: "dark",
  tier: "free",
  preview: { accentColor: "#7AA2F7", backgroundColor: "#1A1B26", foregroundColor: "#C0CAF5" },
  tokens: {
    background: "235 19% 13%", // #1a1b26
    foreground: "229 76% 86%", // #c0caf5
    card: "235 19% 17%",
    cardForeground: "229 76% 86%",
    popover: "232 25% 22%", // #292e42
    popoverForeground: "229 76% 86%",
    primary: "218 89% 73%", // #7aa2f7
    primaryForeground: "235 19% 13%",
    secondary: "232 25% 22%",
    secondaryForeground: "229 76% 86%",
    muted: "232 25% 22%",
    mutedForeground: "228 23% 47%", // #565f89
    accent: "261 87% 79%", // #bb9af7 magenta
    accentForeground: "235 19% 13%",
    destructive: "352 88% 71%",
    destructiveForeground: "0 0% 100%",
    border: "232 25% 28%",
    borderSubtle: "235 19% 18%",
    input: "232 25% 28%",
    ring: "218 89% 73%",
    sidebar: "235 19% 13%",
  },
  diff: DARK_DIFF,
  status: DARK_STATUS,
};

// ─── Catppuccin (Latte / Mocha) ──────────────────────────────────────────────
const catppuccinLatte: ThemeDefinition = {
  id: "catppuccin-latte",
  name: "Catppuccin",
  description: "Catppuccin Latte — pastel cream with mauve accent",
  baseMode: "light",
  tier: "free",
  preview: { accentColor: "#1E66F5", backgroundColor: "#EFF1F5", foregroundColor: "#4C4F69" },
  tokens: {
    background: "220 23% 95%", // #eff1f5
    foreground: "234 16% 35%", // #4c4f69
    card: "0 0% 100%",
    cardForeground: "234 16% 35%",
    popover: "0 0% 100%",
    popoverForeground: "234 16% 35%",
    primary: "220 91% 54%", // #1e66f5 blue
    primaryForeground: "0 0% 100%",
    secondary: "223 16% 88%", // #ccd0da surface0
    secondaryForeground: "234 16% 35%",
    muted: "223 16% 88%",
    mutedForeground: "233 13% 41%", // #5c5f77
    accent: "266 85% 58%", // #8839ef mauve
    accentForeground: "0 0% 100%",
    destructive: "347 87% 44%", // #d20f39 red
    destructiveForeground: "0 0% 100%",
    border: "225 14% 84%",
    borderSubtle: "223 16% 88%",
    input: "225 14% 84%",
    ring: "220 91% 54%",
    sidebar: "220 23% 95%",
  },
  diff: LIGHT_DIFF,
  status: LIGHT_STATUS,
};

const catppuccinMocha: ThemeDefinition = {
  id: "catppuccin-mocha",
  name: "Catppuccin",
  description: "Catppuccin Mocha — warm midnight with pastel accents",
  baseMode: "dark",
  tier: "free",
  preview: { accentColor: "#89B4FA", backgroundColor: "#1E1E2E", foregroundColor: "#CDD6F4" },
  tokens: {
    background: "240 21% 15%", // #1e1e2e base
    foreground: "226 64% 88%", // #cdd6f4 text
    card: "240 21% 18%",
    cardForeground: "226 64% 88%",
    popover: "240 23% 12%", // #181825 mantle
    popoverForeground: "226 64% 88%",
    primary: "217 92% 76%", // #89b4fa blue
    primaryForeground: "240 21% 15%",
    secondary: "237 16% 23%", // #313244 surface0
    secondaryForeground: "226 64% 88%",
    muted: "237 16% 23%",
    mutedForeground: "227 35% 80%", // #bac2de subtext1
    accent: "267 84% 81%", // #cba6f7 mauve
    accentForeground: "240 21% 15%",
    destructive: "343 81% 75%", // #f38ba8 red
    destructiveForeground: "240 21% 15%",
    border: "234 13% 31%",
    borderSubtle: "237 16% 20%",
    input: "234 13% 31%",
    ring: "217 92% 76%",
    sidebar: "240 21% 15%",
  },
  diff: DARK_DIFF,
  status: DARK_STATUS,
};

// ─── Gruvbox (Light / Dark, medium contrast) ─────────────────────────────────
const gruvboxLight: ThemeDefinition = {
  id: "gruvbox-light",
  name: "Gruvbox",
  description: "Gruvbox medium light — warm parchment with retro accents",
  baseMode: "light",
  tier: "free",
  preview: { accentColor: "#076678", backgroundColor: "#FBF1C7", foregroundColor: "#3C3836" },
  tokens: {
    background: "47 87% 88%", // #fbf1c7
    foreground: "20 10% 22%", // #3c3836
    card: "47 87% 92%",
    cardForeground: "20 10% 22%",
    popover: "47 87% 92%",
    popoverForeground: "20 10% 22%",
    primary: "192 89% 25%", // #076678 blue
    primaryForeground: "47 87% 88%",
    secondary: "44 51% 83%", // #ebdbb2 bg1
    secondaryForeground: "20 10% 22%",
    muted: "44 51% 83%",
    mutedForeground: "20 8% 38%", // #7c6f64
    accent: "16 96% 35%", // #af3a03 orange
    accentForeground: "47 87% 88%",
    destructive: "1 71% 39%", // #9d0006
    destructiveForeground: "0 0% 100%",
    border: "44 38% 78%",
    borderSubtle: "44 51% 85%",
    input: "44 38% 78%",
    ring: "192 89% 25%",
    sidebar: "47 87% 88%",
  },
  diff: LIGHT_DIFF,
  status: LIGHT_STATUS,
};

const gruvboxDark: ThemeDefinition = {
  id: "gruvbox-dark",
  name: "Gruvbox",
  description: "Gruvbox medium dark — charcoal with cream text and warm accents",
  baseMode: "dark",
  tier: "free",
  preview: { accentColor: "#FE8019", backgroundColor: "#282828", foregroundColor: "#EBDBB2" },
  tokens: {
    background: "0 0% 16%", // #282828
    foreground: "43 59% 81%", // #ebdbb2
    card: "0 0% 19%",
    cardForeground: "43 59% 81%",
    popover: "0 0% 21%",
    popoverForeground: "43 59% 81%",
    primary: "24 99% 55%", // #fe8019 orange
    primaryForeground: "0 0% 16%",
    secondary: "0 0% 22%", // #3c3836 bg1
    secondaryForeground: "43 59% 81%",
    muted: "0 0% 22%",
    mutedForeground: "33 16% 56%", // #a89984
    accent: "92 25% 62%", // #8ec07c aqua
    accentForeground: "0 0% 16%",
    destructive: "6 96% 59%", // #fb4934
    destructiveForeground: "0 0% 100%",
    border: "0 0% 28%",
    borderSubtle: "0 0% 21%",
    input: "0 0% 28%",
    ring: "24 99% 55%",
    sidebar: "0 0% 16%",
  },
  diff: DARK_DIFF,
  status: DARK_STATUS,
};

// ─── Registry ────────────────────────────────────────────────────────────────

export const THEMES: Record<string, ThemeDefinition> = {
  notion,
  "notion-dark": notionDark,
  "github-light": githubLight,
  "github-dark": githubDark,
  "vscode-light": vscodeLight,
  "vscode-dark": vscodeDark,
  "one-light": oneLight,
  "one-dark": oneDark,
  "solarized-light": solarizedLight,
  "solarized-dark": solarizedDark,
  "tokyo-day": tokyoDay,
  "tokyo-night": tokyoNight,
  "catppuccin-latte": catppuccinLatte,
  "catppuccin-mocha": catppuccinMocha,
  "gruvbox-light": gruvboxLight,
  "gruvbox-dark": gruvboxDark,
};

export const DEFAULT_LIGHT_THEME = "notion";
export const DEFAULT_DARK_THEME = "notion-dark";

export const THEME_LIST = Object.values(THEMES);

// Old theme IDs that no longer exist in the registry, mapped to a sensible
// new equivalent. Layout-store consumes this in its v8 migration so persisted
// preferences from earlier registry shapes don't fall back to the wrong
// base mode. Keep keys here even after the migration ships — the resolver
// references this map at runtime as a defensive fallback.
export const REMOVED_THEME_IDS: Record<string, string> = {
  // Removed light themes → notion
  sepia: DEFAULT_LIGHT_THEME,
  rose: DEFAULT_LIGHT_THEME,
  champagne: DEFAULT_LIGHT_THEME,
  lavender: DEFAULT_LIGHT_THEME,
  ivory: DEFAULT_LIGHT_THEME,
  arctic: DEFAULT_LIGHT_THEME,
  // Removed dark themes → notion-dark
  dark: DEFAULT_DARK_THEME,
  nord: DEFAULT_DARK_THEME,
  forest: DEFAULT_DARK_THEME,
  ocean: DEFAULT_DARK_THEME,
  obsidian: DEFAULT_DARK_THEME,
  cyberpunk: DEFAULT_DARK_THEME,
  amethyst: DEFAULT_DARK_THEME,
  carbon: DEFAULT_DARK_THEME,
};

export function resolveThemeId(id: string | undefined | null): string {
  if (!id) return DEFAULT_LIGHT_THEME;
  if (THEMES[id]) return id;
  if (REMOVED_THEME_IDS[id]) return REMOVED_THEME_IDS[id];
  return DEFAULT_LIGHT_THEME;
}

export function getTheme(id: string): ThemeDefinition {
  return THEMES[resolveThemeId(id)];
}

export function getThemesByBaseMode(mode: "light" | "dark"): ThemeDefinition[] {
  return THEME_LIST.filter((t) => t.baseMode === mode);
}

export function isThemeFree(id: string): boolean {
  const theme = THEMES[id];
  return !theme || theme.tier === "free";
}

export function getFreeThemesByBaseMode(mode: "light" | "dark"): ThemeDefinition[] {
  return THEME_LIST.filter((t) => t.baseMode === mode && t.tier === "free");
}

export function getPremiumThemesByBaseMode(mode: "light" | "dark"): ThemeDefinition[] {
  return THEME_LIST.filter((t) => t.baseMode === mode && t.tier === "pro");
}
