export type FrameTier = "free" | "pro" | "max";

export interface FrameDefinition {
  id: string;
  name: string;
  nameZh: string;
  description: string;
  tier: FrameTier;
  /** CSS gradient/solid for the ring background */
  background: string;
  /** Optional box-shadow glow */
  glow?: string;
  /** Optional CSS animation name (defined in globals.css) */
  animation?: string;
  /** Preview gradient colors for selection UI */
  previewColors: string[];
}
