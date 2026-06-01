"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FlatCard, KVCell, SettingsSection } from "../settings-atoms";
import { APP_VERSION, APP_BUILD, APP_PROVIDER, APP_CHANNEL } from "@/lib/app-meta";
import { Modal, ModalHeader } from "@/components/ui/modal";

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
