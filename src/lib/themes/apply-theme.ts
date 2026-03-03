import type { ThemeDefinition } from "./types";

const TOKEN_TO_CSS_VAR: Record<string, string> = {
  background: "--background",
  foreground: "--foreground",
  card: "--card",
  cardForeground: "--card-foreground",
  popover: "--popover",
  popoverForeground: "--popover-foreground",
  primary: "--primary",
  primaryForeground: "--primary-foreground",
  secondary: "--secondary",
  secondaryForeground: "--secondary-foreground",
  muted: "--muted",
  mutedForeground: "--muted-foreground",
  accent: "--accent",
  accentForeground: "--accent-foreground",
  destructive: "--destructive",
  destructiveForeground: "--destructive-foreground",
  border: "--border",
  borderSubtle: "--border-subtle",
  input: "--input",
  ring: "--ring",
  sidebar: "--sidebar",
  chatCursorColor: "--chat-cursor-color",
};

const DIFF_TO_CSS_VAR: Record<string, string> = {
  deletedBg: "--diff-deleted-bg",
  deletedBgHover: "--diff-deleted-bg-hover",
  deletedBorder: "--diff-deleted-border",
  deletedText: "--diff-deleted-text",
  insertedBg: "--diff-inserted-bg",
  insertedBgHover: "--diff-inserted-bg-hover",
  insertedBorder: "--diff-inserted-border",
  insertedAccent: "--diff-inserted-accent",
  focusRing: "--diff-focus-ring",
  focusBorder: "--diff-focus-border",
  toolbarBg: "--diff-toolbar-bg",
  toolbarBorder: "--diff-toolbar-border",
  toolbarShadow: "--diff-toolbar-shadow",
  btnAcceptBg: "--diff-btn-accept-bg",
  btnAcceptFg: "--diff-btn-accept-fg",
  btnAcceptHover: "--diff-btn-accept-hover",
  btnRejectBg: "--diff-btn-reject-bg",
  btnRejectFg: "--diff-btn-reject-fg",
  btnRejectHover: "--diff-btn-reject-hover",
};

const STATUS_TO_CSS_VAR: Record<string, string> = {
  successBg: "--status-success-bg",
  successBorder: "--status-success-border",
  errorBg: "--status-error-bg",
  errorBorder: "--status-error-border",
  infoBg: "--status-info-bg",
  infoBorder: "--status-info-border",
  thinkingBg: "--status-thinking-bg",
  thinkingBorder: "--status-thinking-border",
  warningBg: "--status-warning-bg",
  warningBorder: "--status-warning-border",
};

const ALL_CSS_VARS = [
  ...Object.values(TOKEN_TO_CSS_VAR),
  ...Object.values(DIFF_TO_CSS_VAR),
  ...Object.values(STATUS_TO_CSS_VAR),
];

export function applyTheme(theme: ThemeDefinition): void {
  const root = document.documentElement;

  root.setAttribute("data-theme", theme.id);

  const vars: Record<string, string> = {};

  // Apply core tokens
  for (const [key, cssVar] of Object.entries(TOKEN_TO_CSS_VAR)) {
    const value = theme.tokens[key as keyof typeof theme.tokens];
    if (value) {
      root.style.setProperty(cssVar, value);
      vars[cssVar] = value;
    }
  }

  // Apply diff tokens
  for (const [key, cssVar] of Object.entries(DIFF_TO_CSS_VAR)) {
    const value = theme.diff[key as keyof typeof theme.diff];
    if (value) {
      root.style.setProperty(cssVar, value);
      vars[cssVar] = value;
    }
  }

  // Apply status tokens
  for (const [key, cssVar] of Object.entries(STATUS_TO_CSS_VAR)) {
    const value = theme.status[key as keyof typeof theme.status];
    if (value) {
      root.style.setProperty(cssVar, value);
      vars[cssVar] = value;
    }
  }

  // Cache theme for blocking script to restore on next page load
  try {
    localStorage.setItem(
      "doxmind-theme-cache",
      JSON.stringify({ id: theme.id, mode: theme.baseMode, vars })
    );
  } catch {
    // localStorage may be unavailable; silently ignore
  }
}

export function clearThemeOverrides(): void {
  const root = document.documentElement;
  root.removeAttribute("data-theme");
  for (const cssVar of ALL_CSS_VARS) {
    root.style.removeProperty(cssVar);
  }
  try {
    localStorage.removeItem("doxmind-theme-cache");
  } catch {
    // silently ignore
  }
}
