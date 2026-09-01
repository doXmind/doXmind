"use client";

/**
 * Client-side i18n provider for the static-exported Electron shell.
 *
 * The original setup used next-intl/server (request.ts + getLocale/getMessages
 * in the layout), which doesn't run for `output: 'export'`. We replace it with
 * a client provider that reads the NEXT_LOCALE cookie and ships both message
 * bundles in the JS payload (they're small, ~tens of KB).
 */

import { useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";
import { useLayoutStore } from "@/stores/layout-store";

const SUPPORTED = ["en", "zh"] as const;
type Locale = (typeof SUPPORTED)[number];

const MESSAGES: Record<Locale, Record<string, unknown>> = { en, zh };

const DEFAULT_LOCALE: Locale =
  (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale) === "zh" ? "zh" : "en";
const DEFAULT_TIME_ZONE = "UTC";

function readCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return (SUPPORTED as readonly string[]).includes(value) ? (value as Locale) : null;
}

export function ClientIntlProvider({ children }: { children: React.ReactNode }) {
  // Render with the default locale on first paint to keep server/static markup
  // and the initial client tree identical, then swap to the chosen locale.
  const [mounted, setMounted] = useState(false);
  const stored = useLayoutStore((state) => state.locale);

  useEffect(() => {
    setMounted(true);
    // A cold start paints before the persisted store has hydrated, so the cookie the settings
    // page also writes is what carries the choice across that gap.
    const cookieLocale = readCookieLocale();
    if (cookieLocale && cookieLocale !== useLayoutStore.getState().locale) {
      useLayoutStore.getState().setLocale(cookieLocale);
    }
  }, []);

  const locale: Locale = mounted ? stored : DEFAULT_LOCALE;

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      timeZone={DEFAULT_TIME_ZONE}
    >
      {children}
    </NextIntlClientProvider>
  );
}
