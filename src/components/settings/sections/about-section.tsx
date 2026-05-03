"use client";

import { useTranslations } from "next-intl";
import { FlatCard, KVCell, SettingsSection } from "../settings-atoms";
import { APP_VERSION, APP_BUILD, APP_ENGINE, APP_CHANNEL } from "@/lib/app-meta";

export function AboutSection() {
  const t = useTranslations("settings");

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
        <FooterLink href="#">{t("aboutPrivacy")}</FooterLink>
        <FooterLink href="#">{t("aboutAcknowledgements")}</FooterLink>
        <FooterLink href="#">{t("aboutLicenses")}</FooterLink>
      </div>
    </SettingsSection>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className="border-b border-dotted border-muted-foreground/60 pb-px text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </a>
  );
}
