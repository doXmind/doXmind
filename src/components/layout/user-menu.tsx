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
  EyeOff,
  BarChart3,
  Palette,
  HelpCircle,
  Globe,
  CreditCard,
  X,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-device-type";
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
import { useBillingStore } from "@/stores/billing-store";
import { APISettings } from "@/components/settings/api-settings";
import { TypographySettings } from "@/components/settings/typography-settings";
import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { TelemetrySettings } from "@/components/settings/telemetry-settings";
import { UsageSettings } from "@/components/settings/usage-settings";
import { SessionManager } from "@/components/settings/session-manager";
import { PlanSettings } from "@/components/settings/plan-settings";
import { PricingModal } from "@/components/billing/pricing-modal";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useTranslations, useLocale } from "next-intl";

type SettingsTab = "api" | "usage" | "plan" | "appearance" | "typography" | "privacy" | "security";

const SETTINGS_TAB_IDS: { id: SettingsTab; labelKey: string; icon: React.ReactNode }[] = [
  { id: "appearance", labelKey: "appearance", icon: <Palette className="h-4 w-4" /> },
  { id: "typography", labelKey: "typography", icon: <Type className="h-4 w-4" /> },
  { id: "plan", labelKey: "plan", icon: <CreditCard className="h-4 w-4" /> },
  { id: "usage", labelKey: "usage", icon: <BarChart3 className="h-4 w-4" /> },
  { id: "security", labelKey: "security", icon: <Shield className="h-4 w-4" /> },
  { id: "privacy", labelKey: "privacy", icon: <EyeOff className="h-4 w-4" /> },
  { id: "api", labelKey: "api", icon: <Key className="h-4 w-4" /> },
];

const LOCALES = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
] as const;

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { user, logout, deleteAccount } = useAuthStore();
  const t = useTranslations("userMenu");
  const ts = useTranslations("settings");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { plan, openPricingModal } = useBillingStore();
  const isMobile = useIsMobile();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("relative rounded-full", compact ? "h-7 w-7" : "h-8 w-8")}
          aria-label={t("userMenu")}
        >
          <UserAvatar
            avatarUrl={user?.avatar_url}
            username={user?.username || user?.email}
            size={compact ? 28 : 32}
            frame={user?.avatar_frame}
            plan={plan}
          />
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
        className="max-w-3xl"
      >
        {isMobile ? (
          <>
            <ModalHeader onClose={() => setShowSettingsModal(false)}>
              <span className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                {t("settings")}
              </span>
            </ModalHeader>
            {/* Mobile: horizontal tab bar */}
            <div className="mb-4 flex overflow-x-auto border-b border-border">
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
                </button>
              ))}
            </div>
            <div className="h-[65vh] overflow-y-auto">
              {settingsTab === "api" && <APISettings />}
              {settingsTab === "usage" && <UsageSettings />}
              {settingsTab === "plan" && (
                <PlanSettings
                  onOpenPricing={() => {
                    setShowSettingsModal(false);
                    openPricingModal();
                  }}
                />
              )}
              {settingsTab === "appearance" && <AppearanceSettings />}
              {settingsTab === "typography" && <TypographySettings />}
              {settingsTab === "security" && <SessionManager />}
              {settingsTab === "privacy" && <TelemetrySettings />}
            </div>
          </>
        ) : (
          <div className="flex h-[540px]">
            {/* Desktop: sidebar navigation */}
            <div className="flex w-[180px] shrink-0 flex-col border-r border-border pr-4">
              <h2 className="mb-4 text-lg font-semibold">{t("settings")}</h2>
              <nav className="flex flex-col gap-0.5">
                {SETTINGS_TAB_IDS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setSettingsTab(tab.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                      settingsTab === tab.id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    {tab.icon}
                    {ts(
                      tab.labelKey as
                        | "api"
                        | "usage"
                        | "plan"
                        | "appearance"
                        | "typography"
                        | "security"
                        | "privacy"
                    )}
                  </button>
                ))}
              </nav>
            </div>
            {/* Desktop: content area */}
            <div className="flex min-w-0 flex-1 flex-col pl-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-base font-medium">
                  {ts(
                    settingsTab as
                      | "api"
                      | "usage"
                      | "plan"
                      | "appearance"
                      | "typography"
                      | "security"
                      | "privacy"
                  )}
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowSettingsModal(false)}
                  className="h-8 w-8"
                  aria-label="Close dialog"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto">
                {settingsTab === "api" && <APISettings />}
                {settingsTab === "usage" && <UsageSettings />}
                {settingsTab === "plan" && (
                  <PlanSettings
                    onOpenPricing={() => {
                      setShowSettingsModal(false);
                      openPricingModal();
                    }}
                  />
                )}
                {settingsTab === "appearance" && <AppearanceSettings />}
                {settingsTab === "typography" && <TypographySettings />}
                {settingsTab === "security" && <SessionManager />}
                {settingsTab === "privacy" && <TelemetrySettings />}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <PricingModal />
    </DropdownMenu>
  );
}
