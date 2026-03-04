import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

const SUPPORTED_LOCALES = ["en", "zh"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

const DEFAULT_LOCALE: Locale = (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale) || "en";

function isLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

function detectLocale(cookieLocale?: string): Locale {
  // CN deployment: always use zh, no language switching
  if (DEFAULT_LOCALE === "zh") return "zh";
  // Main site: allow cookie-based locale switching
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = detectLocale(cookieStore.get("NEXT_LOCALE")?.value);
  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
