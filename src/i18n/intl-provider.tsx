"use client";

/**
 * Client-side i18n provider for the static-exported Tauri shell.
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

const SUPPORTED = ["en", "zh"] as const;
type Locale = (typeof SUPPORTED)[number];

const MESSAGES: Record<Locale, Record<string, unknown>> = { en, zh };

const DEFAULT_LOCALE: Locale =
  (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale) === "zh" ? "zh" : "en";

function readCookieLocale(): Locale | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  if (!match) return null;
  const value = decodeURIComponent(match[1]);
  return (SUPPORTED as readonly string[]).includes(value) ? (value as Locale) : null;
}

export function ClientIntlProvider({ children }: { children: React.ReactNode }) {
  // Render with the default locale on first paint to keep server/static markup
  // and the initial client tree identical, then swap to the cookie's locale.
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const cookieLocale = readCookieLocale();
    if (cookieLocale && cookieLocale !== locale) setLocale(cookieLocale);
    // intentional: only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      {children}
    </NextIntlClientProvider>
  );
}
