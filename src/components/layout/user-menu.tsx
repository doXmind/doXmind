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
  GraduationCap,
  HelpCircle,
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
import { TelemetrySettings } from "@/components/settings/telemetry-settings";
import { useOnboardingStore } from "@/stores/onboarding-store";
import { cn } from "@/lib/utils";

type SettingsTab = "api" | "typography" | "privacy";

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "api", label: "API", icon: <Key className="h-4 w-4" /> },
  { id: "typography", label: "Typography", icon: <Type className="h-4 w-4" /> },
  { id: "privacy", label: "Privacy", icon: <Shield className="h-4 w-4" /> },
];

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { user, logout, deleteAccount } = useAuthStore();
  const { onboardingCompleted, resetOnboarding, startOnboarding, tutorialFileId } =
    useOnboardingStore();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("api");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleLogout = () => {
    logout();
    router.push("/login");
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
      toast.error("Failed to delete account");
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
          aria-label="User menu"
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
            <p className="text-sm font-medium leading-none">{user?.username || "User"}</p>
            <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <User className="mr-2 h-4 w-4" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShowSettingsModal(true)}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/help")}>
          <HelpCircle className="mr-2 h-4 w-4" />
          Help
        </DropdownMenuItem>
        {onboardingCompleted && (
          <DropdownMenuItem onClick={handleRestartTour}>
            <GraduationCap className="mr-2 h-4 w-4" />
            Restart Tour
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setShowDeleteDialog(true)}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete account
        </DropdownMenuItem>
      </DropdownMenuContent>

      {/* Delete Account Confirmation Dialog */}
      <Modal open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)}>
        <ModalHeader onClose={() => setShowDeleteDialog(false)}>
          <span className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Delete Account
          </span>
        </ModalHeader>
        <div className="space-y-4 text-sm">
          <p>
            Are you sure you want to delete your account? This action is{" "}
            <strong>permanent and cannot be undone</strong>.
          </p>
          <p className="text-muted-foreground">
            All your data will be permanently deleted, including:
          </p>
          <ul className="list-inside list-disc space-y-1 text-muted-foreground">
            <li>All your documents and files</li>
            <li>All conversation history</li>
            <li>Your profile and settings</li>
          </ul>
        </div>
        <ModalFooter>
          <Button
            variant="outline"
            onClick={() => setShowDeleteDialog(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDeleteAccount} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete my account"}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Settings Modal */}
      <Modal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        className="max-w-lg"
      >
        <ModalHeader onClose={() => setShowSettingsModal(false)}>
          <span className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </span>
        </ModalHeader>

        {/* Tab navigation */}
        <div className="-mx-6 mb-4 flex border-b border-border px-6">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSettingsTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 pb-2 text-sm transition-colors",
                settingsTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-[280px]">
          {settingsTab === "api" && <APISettings />}
          {settingsTab === "typography" && <TypographySettings />}
          {settingsTab === "privacy" && <TelemetrySettings />}
        </div>
      </Modal>
    </DropdownMenu>
  );
}
