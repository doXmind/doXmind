export type ThemeBaseMode = "light" | "dark";

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
}

export interface ThemeStatusTokens {
  successBg: string;
  successBorder: string;
  errorBg: string;
  errorBorder: string;
  infoBg: string;
  infoBorder: string;
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
  preview: ThemePreview;
  tokens: ThemeTokens;
  status: ThemeStatusTokens;
}

export type ThemeId = string;
