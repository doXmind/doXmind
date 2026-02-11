"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, User, Settings, Trash2, AlertTriangle } from "lucide-react";
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
import { TelemetrySettings } from "@/components/settings/telemetry-settings";

export function UserMenu() {
  const router = useRouter();
  const { user, logout, deleteAccount } = useAuthStore();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleLogout = () => {
    logout();
    router.push("/login");
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
          className="relative h-8 w-8 rounded-full"
          aria-label="User menu"
        >
          {user?.avatar_url ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={user.avatar_url}
              alt={user.username || user.email}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-medium text-primary">
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
      <Modal open={showSettingsModal} onClose={() => setShowSettingsModal(false)}>
        <ModalHeader onClose={() => setShowSettingsModal(false)}>
          <span className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Settings
          </span>
        </ModalHeader>
        <div className="space-y-6">
          <APISettings />
          <hr />
          <TelemetrySettings />
        </div>
      </Modal>
    </DropdownMenu>
  );
}
