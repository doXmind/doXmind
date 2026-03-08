export type ThemeBaseMode = "light" | "dark";
export type ThemeTier = "free" | "pro";

export interface ThemeTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  borderSubtle: string;
  input: string;
  ring: string;
  sidebar: string;
  chatCursorColor: string;
}

export interface ThemeDiffTokens {
  deletedBg: string;
  deletedBgHover: string;
  deletedBorder: string;
  deletedText: string;
  insertedBg: string;
  insertedBgHover: string;
  insertedBorder: string;
  insertedAccent: string;
  focusRing: string;
  focusBorder: string;
  toolbarBg: string;
  toolbarBorder: string;
  toolbarShadow: string;
  btnAcceptBg: string;
  btnAcceptFg: string;
  btnAcceptHover: string;
  btnRejectBg: string;
  btnRejectFg: string;
  btnRejectHover: string;
}

export interface ThemeStatusTokens {
  successBg: string;
  successBorder: string;
  errorBg: string;
  errorBorder: string;
  infoBg: string;
  infoBorder: string;
  thinkingBg: string;
  thinkingBorder: string;
  warningBg: string;
  warningBorder: string;
}

export interface ThemePreview {
  accentColor: string;
  backgroundColor: string;
  foregroundColor: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  baseMode: ThemeBaseMode;
  tier: ThemeTier;
  preview: ThemePreview;
  tokens: ThemeTokens;
  diff: ThemeDiffTokens;
  status: ThemeStatusTokens;
}

export type ThemeId = string;
