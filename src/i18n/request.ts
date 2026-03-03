import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

const SUPPORTED_LOCALES = ["en", "zh"] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

const DEFAULT_LOCALE: Locale = (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale) || "en";

function isLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

function detectLocale(cookieLocale?: string, acceptLang?: string): Locale {
  if (cookieLocale && isLocale(cookieLocale)) return cookieLocale;
  if (acceptLang) {
    const preferred = acceptLang.split(",").map((s) => s.split(";")[0].trim().split("-")[0]);
    for (const lang of preferred) {
      if (isLocale(lang)) return lang;
    }
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = detectLocale(
    cookieStore.get("NEXT_LOCALE")?.value,
    headerStore.get("accept-language") || undefined
  );
  return {
    locale,
    messages: (await import(`@/messages/${locale}.json`)).default,
  };
});
