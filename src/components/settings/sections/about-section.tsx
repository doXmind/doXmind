"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FlatCard, KVCell, SettingsSection } from "../settings-atoms";
import { APP_VERSION, APP_BUILD, APP_ENGINE, APP_CHANNEL } from "@/lib/app-meta";
import { Modal, ModalHeader } from "@/components/ui/modal";

type AboutPanel = "privacy" | "acknowledgements" | "licenses";

const THIRD_PARTY_LICENSES = [
  { name: "Tauri", license: "Apache-2.0 OR MIT" },
  { name: "Next.js", license: "MIT" },
  { name: "React", license: "MIT" },
  { name: "TipTap / ProseMirror", license: "MIT" },
  { name: "Zustand", license: "MIT" },
  { name: "Tailwind CSS", license: "MIT" },
  { name: "Lucide React", license: "ISC" },
  { name: "FastAPI", license: "MIT" },
  { name: "SQLAlchemy", license: "MIT" },
  { name: "PyMuPDF", license: "AGPL-3.0" },
  { name: "PDF.js", license: "Apache-2.0" },
  { name: "Mermaid", license: "MIT" },
  { name: "KaTeX", license: "MIT" },
  { name: "Chart.js", license: "MIT" },
];

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
          <KVCell label={t("aboutEngine")} value={APP_ENGINE} borderTop />
        </div>
      </FlatCard>
      <div className="mt-3.5 flex gap-3.5 text-[11.5px] text-muted-foreground">
        <FooterButton onClick={() => setPanel("privacy")}>{t("aboutPrivacy")}</FooterButton>
        <FooterButton onClick={() => setPanel("acknowledgements")}>
          {t("aboutAcknowledgements")}
        </FooterButton>
        <FooterButton onClick={() => setPanel("licenses")}>{t("aboutLicenses")}</FooterButton>
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
        : panel === "licenses"
          ? t("aboutLicensesTitle")
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
      {panel === "licenses" && (
        <div className="space-y-4">
          <div className="space-y-3 text-[13px] leading-6 text-muted-foreground">
            <p>{t("aboutLicensesBody1")}</p>
            <p>{t("aboutLicensesBody2")}</p>
          </div>
          <div className="max-h-[280px] overflow-auto border-y border-border/60">
            {THIRD_PARTY_LICENSES.map((item) => (
              <div
                key={item.name}
                className="grid grid-cols-[1fr_auto] gap-6 border-b border-border/40 py-2.5 text-[12.5px] last:border-b-0"
              >
                <span className="text-foreground">{item.name}</span>
                <span className="font-mono text-muted-foreground">{item.license}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
