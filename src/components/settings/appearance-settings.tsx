"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Crown, Lock, Monitor, Palette, Frame } from "lucide-react";
import { toast } from "sonner";
import { useThemeManager } from "@/hooks/use-theme-manager";
import { useAuthStore } from "@/stores/auth-store";
import { useBillingStore } from "@/stores/billing-store";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { FRAME_LIST, isFrameAccessible } from "@/lib/frames/registry";
import type { FrameDefinition } from "@/lib/frames/types";
import type { ThemeDefinition } from "@/lib/themes/types";

function ThemeCard({
  theme,
  isActive,
  isLocked,
  onSelect,
}: {
  theme: ThemeDefinition;
  isActive: boolean;
  isLocked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-lg border p-1.5 transition-all",
        isActive
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-foreground/30"
      )}
    >
      {/* Mini preview */}
      <div
        className={cn(
          "relative h-[68px] w-full overflow-hidden rounded-md",
          isLocked && "opacity-50 grayscale-[40%]"
        )}
        style={{ backgroundColor: theme.preview.backgroundColor }}
      >
        {/* Sidebar accent strip */}
        <div
          className="absolute bottom-0 left-0 top-0 w-1 rounded-l-md"
          style={{ backgroundColor: theme.preview.accentColor }}
        />
        {/* Fake text lines */}
        <div className="flex flex-col gap-[5px] p-2.5 pl-3.5">
          <div
            className="h-[5px] w-3/5 rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.7,
            }}
          />
          <div
            className="h-[3px] w-full rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.35,
            }}
          />
          <div
            className="h-[3px] w-5/6 rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.35,
            }}
          />
          <div
            className="h-[3px] w-2/3 rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.35,
            }}
          />
          <div
            className="h-[3px] w-4/5 rounded-full"
            style={{
              backgroundColor: theme.preview.foregroundColor,
              opacity: 0.25,
            }}
          />
        </div>
        {/* Active checkmark */}
        {isActive && !isLocked && (
          <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
            <Check className="h-2.5 w-2.5 text-primary-foreground" />
          </div>
        )}
        {/* Lock icon for premium */}
        {isLocked && (
          <div className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground/60">
            <Lock className="h-2.5 w-2.5 text-background" />
          </div>
        )}
      </div>
      {/* Theme name */}
      <span
        className={cn(
          "text-[11px] font-medium leading-tight",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {theme.name}
      </span>
    </button>
  );
}

function FrameCard({
  frame,
  isActive,
  isLocked,
  avatarUrl,
  username,
  plan,
  onSelect,
}: {
  frame: FrameDefinition;
  isActive: boolean;
  isLocked: boolean;
  avatarUrl?: string | null;
  username?: string | null;
  plan?: "free" | "pro" | "max" | null;
  onSelect: () => void;
}) {
  const isNone = frame.id === "none";
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-all",
        isActive
          ? "border-primary ring-2 ring-primary/20"
          : "border-border hover:border-foreground/30"
      )}
    >
      <div
        className={cn(
          "relative flex h-[52px] items-center justify-center",
          isLocked && "opacity-50 grayscale-[40%]"
        )}
      >
        <UserAvatar
          avatarUrl={avatarUrl}
          username={username}
          size={40}
          frame={isNone ? null : frame.id}
          plan={plan}
        />
        {isActive && !isLocked && (
          <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary">
            <Check className="h-2.5 w-2.5 text-primary-foreground" />
          </div>
        )}
        {isLocked && (
          <div className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-muted-foreground/60">
            <Lock className="h-2.5 w-2.5 text-background" />
          </div>
        )}
      </div>
      <span
        className={cn(
          "text-[10px] font-medium leading-tight",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {frame.name}
      </span>
    </button>
  );
}

export function AppearanceSettings() {
  const t = useTranslations("settings");
  const [activeTab, setActiveTab] = useState<"theme" | "frame">("theme");
  const {
    currentThemeId,
    selectTheme,
    canAccessTheme,
    isSystemMode,
    setSystemMode,
    freeLightThemes,
    freeDarkThemes,
    premiumLightThemes,
    premiumDarkThemes,
  } = useThemeManager();

  const user = useAuthStore((s) => s.user);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const plan = useBillingStore((s) => s.plan);
  const currentFrame = user?.avatar_frame || "none";

  const freeThemes = [...freeLightThemes, ...freeDarkThemes];
  const proThemes = [...premiumLightThemes, ...premiumDarkThemes];

  const freeFrames = FRAME_LIST.filter((f) => f.tier === "free");
  const proFrames = FRAME_LIST.filter((f) => f.tier === "pro");
  const maxFrames = FRAME_LIST.filter((f) => f.tier === "max");

  const handleFrameSelect = async (frameId: string) => {
    if (!isFrameAccessible(frameId, plan)) {
      toast(t("premiumFrameRequired"), {
        action: {
          label: t("upgradeNow"),
          onClick: () => {
            window.location.href = "/pricing";
          },
        },
      });
      return;
    }
    await updateProfile({ avatar_frame: frameId === "none" ? "" : frameId });
  };

  const handleThemeSelect = (themeId: string) => {
    if (!canAccessTheme(themeId)) {
      toast(t("premiumThemeRequired"), {
        action: {
          label: t("upgradeNow"),
          onClick: () => {
            window.location.href = "/pricing";
          },
        },
      });
      return;
    }
    selectTheme(themeId);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("chooseTheme")}</p>

      <div className="rounded-lg border p-4">
        {/* Tabs */}
        <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
          <button
            onClick={() => setActiveTab("theme")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
              activeTab === "theme"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Palette className="h-3.5 w-3.5" />
            {t("themeTab")}
          </button>
          <button
            onClick={() => setActiveTab("frame")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all",
              activeTab === "frame"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Frame className="h-3.5 w-3.5" />
            {t("avatarFrame")}
          </button>
        </div>

        {/* Theme Tab */}
        {activeTab === "theme" && (
          <div className="space-y-4">
            {/* Free themes (Notion + Midnight together) */}
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2">
                {freeThemes.map((theme) => (
                  <ThemeCard
                    key={theme.id}
                    theme={theme}
                    isActive={currentThemeId === theme.id}
                    isLocked={false}
                    onSelect={() => handleThemeSelect(theme.id)}
                  />
                ))}
              </div>
            </div>

            {/* Pro themes (light-themed first, then dark-themed) */}
            {proThemes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-medium uppercase tracking-wider text-amber-500">
                    {t("proThemes")}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {proThemes.map((theme) => (
                    <ThemeCard
                      key={theme.id}
                      theme={theme}
                      isActive={currentThemeId === theme.id}
                      isLocked={!canAccessTheme(theme.id)}
                      onSelect={() => handleThemeSelect(theme.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Follow System Toggle */}
            <div className="flex items-center justify-between border-t pt-3">
              <div className="flex items-center gap-2">
                <Monitor className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-sm font-medium">{t("followSystem")}</span>
                  <p className="text-xs text-muted-foreground">{t("autoSwitch")}</p>
                </div>
              </div>
              <button
                onClick={() => setSystemMode(!isSystemMode)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors",
                  isSystemMode ? "bg-primary" : "bg-muted"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-sm ring-0 transition-transform",
                    isSystemMode ? "translate-x-[18px]" : "translate-x-[2px]",
                    "mt-[2px]"
                  )}
                />
              </button>
            </div>
          </div>
        )}

        {/* Frame Tab */}
        {activeTab === "frame" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("avatarFrameDescription")}</p>

            {/* Free frames */}
            <div className="space-y-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("freeFrames")}
              </span>
              <div className="grid grid-cols-5 gap-2">
                {freeFrames.map((frame) => (
                  <FrameCard
                    key={frame.id}
                    frame={frame}
                    isActive={currentFrame === frame.id || (frame.id === "none" && !currentFrame)}
                    isLocked={false}
                    avatarUrl={user?.avatar_url}
                    username={user?.username}
                    plan={plan}
                    onSelect={() => handleFrameSelect(frame.id)}
                  />
                ))}
              </div>
            </div>

            {/* Pro frames */}
            {proFrames.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-xs font-medium uppercase tracking-wider text-amber-500">
                    {t("proFrames")}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {proFrames.map((frame) => (
                    <FrameCard
                      key={frame.id}
                      frame={frame}
                      isActive={currentFrame === frame.id}
                      isLocked={!isFrameAccessible(frame.id, plan)}
                      avatarUrl={user?.avatar_url}
                      username={user?.username}
                      onSelect={() => handleFrameSelect(frame.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Max frames */}
            {maxFrames.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5 text-purple-500" />
                  <span className="text-xs font-medium uppercase tracking-wider text-purple-500">
                    {t("maxFrames")}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {maxFrames.map((frame) => (
                    <FrameCard
                      key={frame.id}
                      frame={frame}
                      isActive={currentFrame === frame.id}
                      isLocked={!isFrameAccessible(frame.id, plan)}
                      avatarUrl={user?.avatar_url}
                      username={user?.username}
                      onSelect={() => handleFrameSelect(frame.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
