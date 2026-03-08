import type { FrameDefinition, FrameTier } from "./types";

// ─── None (Default) ─────────────────────────────────────────────────────────
const none: FrameDefinition = {
  id: "none",
  name: "None",
  nameZh: "无",
  description: "No avatar frame",
  tier: "free",
  background: "transparent",
  previewColors: [],
};

// ─── Subtle Ring (Free) ─────────────────────────────────────────────────────
const subtleRing: FrameDefinition = {
  id: "subtle-ring",
  name: "Subtle Ring",
  nameZh: "简约环",
  description: "A clean, minimal border",
  tier: "free",
  background: "hsl(var(--foreground) / 0.15)",
  previewColors: ["#888888"],
};

// ─── Golden Glow (Pro) ──────────────────────────────────────────────────────
const goldenGlow: FrameDefinition = {
  id: "golden-glow",
  name: "Golden Glow",
  nameZh: "金色光环",
  description: "Radiant gold gradient with warm glow",
  tier: "pro",
  background: "conic-gradient(from 0deg, #FFD700, #FFA500, #FF8C00, #DAA520, #FFD700)",
  glow: "0 0 8px rgba(255, 215, 0, 0.35)",
  previewColors: ["#FFD700", "#FFA500", "#FF8C00"],
};

// ─── Ocean Tide (Pro) ───────────────────────────────────────────────────────
const oceanTide: FrameDefinition = {
  id: "ocean-tide",
  name: "Ocean Tide",
  nameZh: "海洋潮汐",
  description: "Cool blue-to-teal gradient",
  tier: "pro",
  background: "conic-gradient(from 0deg, #3B82F6, #06B6D4, #0EA5E9, #2563EB, #3B82F6)",
  glow: "0 0 8px rgba(59, 130, 246, 0.3)",
  previewColors: ["#3B82F6", "#06B6D4", "#0EA5E9"],
};

// ─── Sunset Blaze (Pro) ─────────────────────────────────────────────────────
const sunsetBlaze: FrameDefinition = {
  id: "sunset-blaze",
  name: "Sunset Blaze",
  nameZh: "日落烈焰",
  description: "Warm orange-to-pink gradient",
  tier: "pro",
  background: "conic-gradient(from 0deg, #F97316, #EF4444, #EC4899, #F59E0B, #F97316)",
  glow: "0 0 8px rgba(249, 115, 22, 0.3)",
  previewColors: ["#F97316", "#EF4444", "#EC4899"],
};

// ─── Cherry Blossom (Pro) ───────────────────────────────────────────────────
const cherryBlossom: FrameDefinition = {
  id: "cherry-blossom",
  name: "Cherry Blossom",
  nameZh: "樱花绽放",
  description: "Soft sakura pink gradient",
  tier: "pro",
  background: "conic-gradient(from 0deg, #F9A8D4, #FBCFE8, #F472B6, #FDA4AF, #F9A8D4)",
  glow: "0 0 8px rgba(244, 114, 182, 0.3)",
  previewColors: ["#F9A8D4", "#F472B6", "#FBCFE8"],
};

// ─── Emerald Aura (Pro) ─────────────────────────────────────────────────────
const emeraldAura: FrameDefinition = {
  id: "emerald-aura",
  name: "Emerald Aura",
  nameZh: "翡翠光环",
  description: "Rich green gem tones",
  tier: "pro",
  background: "conic-gradient(from 0deg, #10B981, #059669, #14B8A6, #34D399, #10B981)",
  glow: "0 0 8px rgba(16, 185, 129, 0.3)",
  previewColors: ["#10B981", "#059669", "#14B8A6"],
};

// ─── Royal Amethyst (Pro) ───────────────────────────────────────────────────
const royalAmethyst: FrameDefinition = {
  id: "royal-amethyst",
  name: "Royal Amethyst",
  nameZh: "皇家紫晶",
  description: "Deep purple and violet gradient",
  tier: "pro",
  background: "conic-gradient(from 0deg, #8B5CF6, #7C3AED, #A78BFA, #6D28D9, #8B5CF6)",
  glow: "0 0 8px rgba(139, 92, 246, 0.3)",
  previewColors: ["#8B5CF6", "#7C3AED", "#A78BFA"],
};

// ─── Copper Forge (Pro) ─────────────────────────────────────────────────────
const copperForge: FrameDefinition = {
  id: "copper-forge",
  name: "Copper Forge",
  nameZh: "熔铜锻造",
  description: "Metallic copper and bronze gradient",
  tier: "pro",
  background: "conic-gradient(from 0deg, #D97706, #B45309, #F59E0B, #92400E, #D97706)",
  glow: "0 0 8px rgba(217, 119, 6, 0.3)",
  previewColors: ["#D97706", "#B45309", "#F59E0B"],
};

// ═════════════════════════════════════════════════════════════════════════════
// MAX TIER — Combined animations, stronger glow, more dramatic effects
// ═════════════════════════════════════════════════════════════════════════════

// ─── Neon Pulse (Max) ───────────────────────────────────────────────────────
const neonPulse: FrameDefinition = {
  id: "neon-pulse",
  name: "Neon Pulse",
  nameZh: "霓虹脉冲",
  description: "Electric cyan glow with pulse and breathe",
  tier: "max",
  background: "conic-gradient(from 0deg, #00E5FF, #00B8D4, #0097A7, #00E5FF)",
  glow: "0 0 14px rgba(0, 229, 255, 0.5)",
  animation: "frame-pulse 2s ease-in-out infinite, frame-breathe 3s ease-in-out infinite",
  previewColors: ["#00E5FF", "#00B8D4", "#0097A7"],
};

// ─── Prismatic (Max) ────────────────────────────────────────────────────────
const prismatic: FrameDefinition = {
  id: "prismatic",
  name: "Prismatic",
  nameZh: "棱镜幻彩",
  description: "Rainbow rotation with breathing pulse",
  tier: "max",
  background:
    "conic-gradient(from 0deg, #FF0000, #FF8000, #FFD700, #00FF00, #0080FF, #8000FF, #FF00FF, #FF0000)",
  glow: "0 0 12px rgba(168, 85, 247, 0.4)",
  animation: "frame-spin 4s linear infinite, frame-breathe 2.5s ease-in-out infinite",
  previewColors: ["#FF0000", "#FFD700", "#00FF00", "#0080FF", "#8000FF"],
};

// ─── Frost Crystal (Max) ────────────────────────────────────────────────────
const frostCrystal: FrameDefinition = {
  id: "frost-crystal",
  name: "Frost Crystal",
  nameZh: "冰霜水晶",
  description: "Ice-blue ring with shimmer and breathe",
  tier: "max",
  background: "linear-gradient(90deg, #93C5FD, #BFDBFE, #60A5FA, #93C5FD, #BFDBFE, #60A5FA)",
  glow: "0 0 12px rgba(147, 197, 253, 0.45)",
  animation: "frame-shimmer 3s linear infinite, frame-breathe 3s ease-in-out infinite",
  previewColors: ["#93C5FD", "#60A5FA", "#BFDBFE"],
};

// ─── Dragon Fire (Max) ──────────────────────────────────────────────────────
const dragonFire: FrameDefinition = {
  id: "dragon-fire",
  name: "Dragon Fire",
  nameZh: "龙焰",
  description: "Fierce crimson flames with intense pulse",
  tier: "max",
  background: "conic-gradient(from 0deg, #EF4444, #DC2626, #F97316, #B91C1C, #991B1B, #EF4444)",
  glow: "0 0 16px rgba(239, 68, 68, 0.6)",
  animation: "frame-pulse 1.5s ease-in-out infinite, frame-breathe 2s ease-in-out infinite",
  previewColors: ["#EF4444", "#DC2626", "#F97316"],
};

// ─── Aurora Borealis (Max) ──────────────────────────────────────────────────
const auroraBorealis: FrameDefinition = {
  id: "aurora-borealis",
  name: "Aurora Borealis",
  nameZh: "极光",
  description: "Northern lights sweep with breathing",
  tier: "max",
  background:
    "linear-gradient(90deg, #34D399, #06B6D4, #3B82F6, #8B5CF6, #EC4899, #34D399, #06B6D4, #3B82F6)",
  glow: "0 0 14px rgba(52, 211, 153, 0.45)",
  animation: "frame-shimmer 4s linear infinite, frame-breathe 3s ease-in-out infinite",
  previewColors: ["#34D399", "#06B6D4", "#3B82F6", "#8B5CF6", "#EC4899"],
};

// ─── Void Eclipse (Max) ─────────────────────────────────────────────────────
const voidEclipse: FrameDefinition = {
  id: "void-eclipse",
  name: "Void Eclipse",
  nameZh: "虚空日蚀",
  description: "Dark energy with pulsing glow",
  tier: "max",
  background: "conic-gradient(from 0deg, #581C87, #1E1B4B, #312E81, #4C1D95, #0F172A, #581C87)",
  glow: "0 0 16px rgba(88, 28, 135, 0.65)",
  animation: "frame-glow-pulse 3s ease-in-out infinite, frame-breathe 4s ease-in-out infinite",
  previewColors: ["#581C87", "#312E81", "#4C1D95"],
};

// ─── Sakura Storm (Max) ─────────────────────────────────────────────────────
const sakuraStorm: FrameDefinition = {
  id: "sakura-storm",
  name: "Sakura Storm",
  nameZh: "樱吹雪",
  description: "Swirling pink petals with rotation and pulse",
  tier: "max",
  background: "conic-gradient(from 0deg, #EC4899, #DB2777, #F472B6, #BE185D, #F9A8D4, #EC4899)",
  glow: "0 0 14px rgba(236, 72, 153, 0.55)",
  animation: "frame-spin 6s linear infinite, frame-pulse 2s ease-in-out infinite",
  previewColors: ["#EC4899", "#DB2777", "#F472B6"],
};

// ─── Inferno Vortex (Max) ───────────────────────────────────────────────────
const infernoVortex: FrameDefinition = {
  id: "inferno-vortex",
  name: "Inferno Vortex",
  nameZh: "炼狱旋涡",
  description: "Spinning fire vortex with intense breathing",
  tier: "max",
  background: "conic-gradient(from 0deg, #FF4500, #FF6347, #FF8C00, #DC143C, #8B0000, #FF4500)",
  glow: "0 0 18px rgba(255, 69, 0, 0.6)",
  animation:
    "frame-spin 3s linear infinite, frame-pulse 1.5s ease-in-out infinite, frame-breathe 2s ease-in-out infinite",
  previewColors: ["#FF4500", "#FF6347", "#DC143C"],
};

// ─── Lightning Surge (Max) ──────────────────────────────────────────────────
const lightningSurge: FrameDefinition = {
  id: "lightning-surge",
  name: "Lightning Surge",
  nameZh: "雷电涌动",
  description: "Electric flicker with crackling energy",
  tier: "max",
  background: "conic-gradient(from 0deg, #FACC15, #FDE68A, #FFFFFF, #EAB308, #A3E635, #FACC15)",
  glow: "0 0 16px rgba(250, 204, 21, 0.6)",
  animation: "frame-electric 1.5s ease-in-out infinite, frame-breathe 2.5s ease-in-out infinite",
  previewColors: ["#FACC15", "#FDE68A", "#A3E635"],
};

// ─── Cosmic Nebula (Max) ────────────────────────────────────────────────────
const cosmicNebula: FrameDefinition = {
  id: "cosmic-nebula",
  name: "Cosmic Nebula",
  nameZh: "星云",
  description: "Deep space colors with flowing shimmer",
  tier: "max",
  background:
    "linear-gradient(90deg, #7C3AED, #2563EB, #EC4899, #06B6D4, #7C3AED, #2563EB, #EC4899)",
  glow: "0 0 14px rgba(124, 58, 237, 0.5)",
  animation: "frame-shimmer 5s linear infinite, frame-breathe 3.5s ease-in-out infinite",
  previewColors: ["#7C3AED", "#2563EB", "#EC4899", "#06B6D4"],
};

// ─── Blood Moon (Max) ───────────────────────────────────────────────────────
const bloodMoon: FrameDefinition = {
  id: "blood-moon",
  name: "Blood Moon",
  nameZh: "血月",
  description: "Ominous dark red with slow breathing glow",
  tier: "max",
  background: "conic-gradient(from 0deg, #7F1D1D, #991B1B, #450A0A, #B91C1C, #DC2626, #7F1D1D)",
  glow: "0 0 18px rgba(185, 28, 28, 0.6)",
  animation: "frame-glow-pulse 4s ease-in-out infinite, frame-breathe 5s ease-in-out infinite",
  previewColors: ["#7F1D1D", "#B91C1C", "#DC2626"],
};

// ─── Registry ───────────────────────────────────────────────────────────────

export const FRAMES: Record<string, FrameDefinition> = {
  none,
  "subtle-ring": subtleRing,
  "golden-glow": goldenGlow,
  "ocean-tide": oceanTide,
  "sunset-blaze": sunsetBlaze,
  "cherry-blossom": cherryBlossom,
  "emerald-aura": emeraldAura,
  "royal-amethyst": royalAmethyst,
  "copper-forge": copperForge,
  "neon-pulse": neonPulse,
  prismatic,
  "frost-crystal": frostCrystal,
  "dragon-fire": dragonFire,
  "aurora-borealis": auroraBorealis,
  "void-eclipse": voidEclipse,
  "sakura-storm": sakuraStorm,
  "inferno-vortex": infernoVortex,
  "lightning-surge": lightningSurge,
  "cosmic-nebula": cosmicNebula,
  "blood-moon": bloodMoon,
};

export const FRAME_LIST = Object.values(FRAMES);

export function getFrame(id: string | null | undefined): FrameDefinition | null {
  if (!id || id === "none") return null;
  return FRAMES[id] ?? null;
}

export function isFrameAccessible(
  frameId: string,
  userPlan: "free" | "pro" | "max" | null | undefined
): boolean {
  const frame = FRAMES[frameId];
  if (!frame) return false;
  if (frame.tier === "free") return true;
  if (frame.tier === "pro") return userPlan === "pro" || userPlan === "max";
  if (frame.tier === "max") return userPlan === "max";
  return false;
}

export function getFramesByTier(tier: FrameTier): FrameDefinition[] {
  return FRAME_LIST.filter((f) => f.tier === tier);
}
