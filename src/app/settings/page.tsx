"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { APISettings } from "@/components/settings/api-settings";
import { TypographySettings } from "@/components/settings/typography-settings";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/editor"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to editor
        </Link>
      </div>

      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium">API key & model</h2>
        <APISettings />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium">Typography</h2>
        <TypographySettings />
      </section>
    </div>
  );
}
