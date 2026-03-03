"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Modal, ModalHeader, ModalFooter } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface ProfileEditModalProps {
  open: boolean;
  onClose: () => void;
}

export function ProfileEditModal({ open, onClose }: ProfileEditModalProps) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const [username, setUsername] = useState(user?.username || "");
  const [bio, setBio] = useState(user?.bio || "");
  const [website, setWebsite] = useState(user?.website || "");
  const [github, setGithub] = useState(user?.social_links?.github || "");
  const [twitter, setTwitter] = useState(user?.social_links?.twitter || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updatedUser = await api.updateProfile({
        username: username || undefined,
        bio: bio || undefined,
        website: website || undefined,
        social_links:
          github || twitter
            ? {
                ...(github ? { github } : {}),
                ...(twitter ? { twitter } : {}),
              }
            : undefined,
      });

      setUser(updatedUser);
      toast.success(t("profileUpdated"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("failedToUpdateProfile"));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader onClose={onClose}>{t("editProfile")}</ModalHeader>

      <div className="space-y-5 py-2">
        <FieldGroup label={t("username")}>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("usernamePlaceholder")}
            className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/10"
          />
        </FieldGroup>

        <FieldGroup label={t("bio")}>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t("bioPlaceholder")}
            rows={3}
            maxLength={500}
            className="w-full resize-none rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/10"
          />
          <p className="mt-1 text-right text-[11px] text-muted-foreground/50">{bio.length}/500</p>
        </FieldGroup>

        <FieldGroup label={t("website")}>
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder={t("websitePlaceholder")}
            className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/10"
          />
        </FieldGroup>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldGroup label={t("github")}>
            <input
              value={github}
              onChange={(e) => setGithub(e.target.value)}
              placeholder={t("usernamePlaceholder")}
              className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/10"
            />
          </FieldGroup>

          <FieldGroup label={t("twitter")}>
            <input
              value={twitter}
              onChange={(e) => setTwitter(e.target.value)}
              placeholder={t("usernamePlaceholder")}
              className="h-9 w-full rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-foreground/20 focus:outline-none focus:ring-1 focus:ring-foreground/10"
            />
          </FieldGroup>
        </div>
      </div>

      <ModalFooter>
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {tc("cancel")}
        </button>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="h-9 rounded-lg px-5 text-[13px]"
        >
          {isSaving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          {t("saveChanges")}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}
