"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogOut,
  User,
  Settings,
  Trash2,
  AlertTriangle,
  Key,
  Type,
  Shield,
  BarChart3,
  Palette,
  GraduationCap,
  HelpCircle,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { APISettings } from "@/components/settings/api-settings";
import { TypographySettings } from "@/components/settings/typography-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { TelemetrySettings } from "@/components/settings/telemetry-settings";
import { UsageSettings } from "@/components/settings/usage-settings";
import { SessionManager } from "@/components/settings/session-manager";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { cn } from "@/lib/utils";
import { useTranslations, useLocale } from "next-intl";

type SettingsTab = "api" | "usage" | "appearance" | "typography" | "privacy" | "security";

const SETTINGS_TAB_IDS: { id: SettingsTab; labelKey: string; icon: React.ReactNode }[] = [
  { id: "api", labelKey: "api", icon: <Key className="h-4 w-4" /> },
  { id: "usage", labelKey: "usage", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "appearance", labelKey: "appearance", icon: <Palette className="h-4 w-4" /> },
  { id: "typography", labelKey: "typography", icon: <Type className="h-4 w-4" /> },
  { id: "security", labelKey: "security", icon: <Shield className="h-4 w-4" /> },
  { id: "privacy", labelKey: "privacy", icon: <Shield className="h-4 w-4" /> },
];

const LOCALES = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
] as const;

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { user, logout, deleteAccount } = useAuthStore();
  const { onboardingCompleted, resetOnboarding, startOnboarding, tutorialFileId } =
    useOnboardingStore();
  const t = useTranslations("userMenu");
  const ts = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("api");
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      // This now shows animation and waits internally
      await logout();
      router.push("/login");
    } catch (error) {
      console.error("Logout failed:", error);
      toast.error(t("logoutFailed"));
      setIsLoggingOut(false);
    }
  };

  const handleRestartTour = () => {
    resetOnboarding();
    startOnboarding(tutorialFileId ?? undefined);
    router.push("/");
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    try {
      await deleteAccount();
      router.push("/login");
    } catch (error) {
      console.error("Failed to delete account:", error);
      toast.error(t("deleteAccountFailed"));
      setIsDeleting(false);
    }
  };

  // Get initials for avatar
  const getInitials = () => {
    if (user?.username) {
      return user.username.slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return "U";
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative rounded-full", compact ? "h-7 w-7" : "h-8 w-8")}
          aria-label={t("userMenu")}
        >
          {user?.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.avatar_url}
              alt={user.username || user.email}
              className={cn("rounded-full object-cover", compact ? "h-7 w-7" : "h-8 w-8")}
            />
          ) : (
            <div
              className={cn(
                "flex items-center justify-center rounded-full bg-primary/10 font-medium text-primary",
                compact ? "h-7 w-7 text-xs" : "h-8 w-8 text-xs"
              )}
            >
              {getInitials()}
            </div>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">{user?.username || tc("user")}</p>
            <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => user?.id && router.push(`/profile/${user.id}`)}
          disabled={!user?.id}
        >
          <User className="mr-2 h-4 w-4" />
          {t("profile")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShowSettingsModal(true)}>
          <Settings className="mr-2 h-4 w-4" />
          {t("settings")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/help")}>
          <HelpCircle className="mr-2 h-4 w-4" />
          {t("help")}
        </DropdownMenuItem>
        {onboardingCompleted && (
          <DropdownMenuItem onClick={handleRestartTour}>
            <GraduationCap className="mr-2 h-4 w-4" />
            {t("restartTour")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            const nextLocale = locale === "en" ? "zh" : "en";
            document.cookie = `NEXT_LOCALE=${nextLocale};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
            window.location.reload();
          }}
        >
          <Globe className="mr-2 h-4 w-4" />
          {LOCALES.find((l) => l.code !== locale)?.label}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout} disabled={isLoggingOut}>
          <LogOut className="mr-2 h-4 w-4" />
          {isLoggingOut ? t("loggingOut") : t("logOut")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setShowDeleteDialog(true)}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t("deleteAccount")}
        </DropdownMenuItem>
      </DropdownMenuContent>

      {/* Delete Account Confirmation Dialog */}
      <Modal open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)}>
        <ModalHeader onClose={() => setShowDeleteDialog(false)}>
          <span className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {t("deleteAccountTitle")}
          </span>
        </ModalHeader>
        <div className="space-y-4 text-sm">
          <p>{t("deleteAccountConfirm")}</p>
          <p className="text-muted-foreground">{t("deleteAccountData")}</p>
          <ul className="list-inside list-disc space-y-1 text-muted-foreground">
            <li>{t("deleteAccountDocs")}</li>
            <li>{t("deleteAccountHistory")}</li>
            <li>{t("deleteAccountProfile")}</li>
          </ul>
        </div>
        <ModalFooter>
          <Button
            variant="outline"
            onClick={() => setShowDeleteDialog(false)}
            disabled={isDeleting}
          >
            {tc("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDeleteAccount} disabled={isDeleting}>
            {isDeleting ? t("deleting") : t("deleteMyAccount")}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Settings Modal */}
      <Modal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        className="max-w-2xl"
      >
        <ModalHeader onClose={() => setShowSettingsModal(false)}>
          <span className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {t("settings")}
          </span>
        </ModalHeader>

        {/* Tab navigation */}
        <div className="mb-4 flex overflow-x-auto border-b border-border md:-mx-6 md:px-6">
          {SETTINGS_TAB_IDS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSettingsTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2 text-sm transition-colors",
                settingsTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.icon}
              <span className="hidden sm:inline">
                {ts(
                  tab.labelKey as
                    | "api"
                    | "usage"
                    | "appearance"
                    | "typography"
                    | "security"
                    | "privacy"
                )}
              </span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="h-[65vh] overflow-y-auto md:h-[500px]">
          {settingsTab === "api" && <APISettings />}
          {settingsTab === "usage" && <UsageSettings />}
          {settingsTab === "appearance" && <AppearanceSettings />}
          {settingsTab === "typography" && <TypographySettings />}
          {settingsTab === "security" && <SessionManager />}
          {settingsTab === "privacy" && <TelemetrySettings />}
        </div>
      </Modal>
    </DropdownMenu>
  );
}
