"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FlatCard, KVCell, SettingsSection } from "../settings-atoms";
import { APP_VERSION, APP_BUILD, APP_PROVIDER, APP_CHANNEL } from "@/lib/app-meta";
import { Modal, ModalHeader } from "@/components/ui/modal";
import { useAppUpdate } from "@/hooks/use-app-update";

type AboutPanel = "privacy" | "acknowledgements";

export function AboutSection() {
  const t = useTranslations("settings");
  const [panel, setPanel] = useState<AboutPanel | null>(null);

  return (
    <SettingsSection id="about" title={t("about")} desc={t("aboutDesc")}>
      <FlatCard>
        <div className="grid grid-cols-2 border-b border-border/60">
          <KVCell label={t("aboutVersion")} value={APP_VERSION} mono borderRight />
          <KVCell label={t("aboutChannel")} value={APP_CHANNEL} />
          <KVCell label={t("aboutBuild")} value={APP_BUILD} mono borderTop borderRight />
          <KVCell label={t("aboutProvidedBy")} value={APP_PROVIDER} borderTop />
        </div>
      </FlatCard>
      <UpdateRow />
      <div className="mt-3.5 flex gap-3.5 text-[11.5px] text-muted-foreground">
        <FooterButton onClick={() => setPanel("privacy")}>{t("aboutPrivacy")}</FooterButton>
        <FooterButton onClick={() => setPanel("acknowledgements")}>
          {t("aboutAcknowledgements")}
        </FooterButton>
      </div>
      <AboutModal panel={panel} onClose={() => setPanel(null)} />
    </SettingsSection>
  );
}

/**
 * Live auto-update controls. Hidden entirely outside the packaged desktop
 * shell (`unsupported`); otherwise one button + one status line driven by
 * the main process's update-state pushes.
 */
function UpdateRow() {
  const t = useTranslations("settings");
  const { state, checkForUpdates, restartToUpdate } = useAppUpdate();

  if (state.status === "unsupported") return null;

  const busy = state.status === "checking" || state.status === "downloading";
  const staged = state.status === "downloaded";
  const version = state.availableVersion ? `v${state.availableVersion.replace(/^v/, "")}` : "";

  const statusText =
    state.status === "checking"
      ? t("aboutUpdateChecking")
      : state.status === "downloading"
        ? t("aboutUpdateDownloading")
        : state.status === "downloaded"
          ? t("aboutUpdateReady", { version })
          : state.status === "up-to-date"
            ? t("aboutUpToDate")
            : state.status === "error"
              ? t("aboutUpdateError")
              : "";

  return (
    <div className="mt-3.5 flex items-center gap-3" data-testid="about-update-row">
      <button
        type="button"
        disabled={busy}
        onClick={() => void (staged ? restartToUpdate() : checkForUpdates())}
        className={
          staged
            ? "rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-primary/20"
            : "rounded-md border border-border bg-background/40 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/40 disabled:cursor-default disabled:opacity-60"
        }
      >
        {staged ? t("aboutUpdateRestart") : t("aboutCheckUpdates")}
      </button>
      {statusText ? (
        <span className="text-[11.5px] text-muted-foreground">{statusText}</span>
      ) : null}
    </div>
  );
}

function FooterButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="border-b border-dotted border-muted-foreground/60 pb-px text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </button>
  );
}

function AboutModal({ panel, onClose }: { panel: AboutPanel | null; onClose: () => void }) {
  const t = useTranslations("settings");
  const open = panel !== null;
  const title =
    panel === "privacy"
      ? t("aboutPrivacyTitle")
      : panel === "acknowledgements"
        ? t("aboutAcknowledgementsTitle")
        : "";

  return (
    <Modal open={open} onClose={onClose} className="max-w-xl">
      <ModalHeader onClose={onClose}>{title}</ModalHeader>
      {panel === "privacy" && (
        <div className="space-y-3 text-[13px] leading-6 text-muted-foreground">
          <p>{t("aboutPrivacyBody1")}</p>
          <p>{t("aboutPrivacyBody2")}</p>
          <p>{t("aboutPrivacyBody3")}</p>
        </div>
      )}
      {panel === "acknowledgements" && (
        <div className="space-y-3 text-[13px] leading-6 text-muted-foreground">
          <p>{t("aboutAcknowledgementsBody1")}</p>
          <p>{t("aboutAcknowledgementsBody2")}</p>
          <p>{t("aboutAcknowledgementsBody3")}</p>
        </div>
      )}
    </Modal>
  );
}
