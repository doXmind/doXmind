import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./styles/editor.css";
import "./styles/code-block.css";
import "./styles/math-mermaid.css";
import "./styles/presentation.css";
import "./styles/mobile.css";
import "./styles/components.css";
import { Providers } from "@/components/providers";
import { Toaster } from "sonner";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

// Prevent auto-zoom on input focus on mobile (iOS/Chrome)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "doXmind - Local Writing Studio",
    template: "%s | doXmind",
  },
  description: "A minimalist local-first writing tool for markdown editing.",
  keywords: ["markdown editor", "local writing app", "document editor", "content creation"],
  authors: [{ name: "doXmind Team" }],
  creator: "doXmind",
  metadataBase: new URL("https://app.doxmind.com"),
  icons: {
    icon: "/icon.svg",
  },
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "doXmind",
    title: "doXmind - Local Writing Studio",
    description: "A minimalist local-first writing tool for markdown editing",
    images: [
      {
        url: "/icon.svg",
        width: 480,
        height: 480,
        alt: "doXmind Local Writing Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "doXmind - Local Writing Studio",
    description: "A minimalist local-first writing tool for markdown editing",
    images: ["/icon.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "doXmind",
  description: "Local-first markdown writing and document editing",
  applicationCategory: "Productivity",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

const themeBootstrapScript = `(function(){
  try {
    var d = document.documentElement;
    var darkIds = { dark: 1, nord: 1, forest: 1, ocean: 1, obsidian: 1, cyberpunk: 1, amethyst: 1, carbon: 1 };
    var parse = function(raw){
      if(!raw) return null;
      try { return JSON.parse(raw); } catch(_) { return null; }
    };

    var cache = parse(localStorage.getItem('doxmind-theme-cache'));
    var prefs = parse(localStorage.getItem('doxmind-theme-prefs'));
    var layout = parse(localStorage.getItem('doxmind-layout'));
    var state = layout && layout.state ? layout.state : (layout && typeof layout === 'object' ? layout : null);

    var stateThemeId = state && typeof state.themeId === 'string' ? state.themeId : null;
    var stateLight = state && typeof state.preferredLightTheme === 'string' ? state.preferredLightTheme : 'notion';
    var stateDark = state && typeof state.preferredDarkTheme === 'string' ? state.preferredDarkTheme : 'dark';
    var stateSystem = state && typeof state.systemThemeEnabled === 'boolean' ? state.systemThemeEnabled : null;

    var prefThemeId = prefs && typeof prefs.themeId === 'string' ? prefs.themeId : null;
    var prefLight = prefs && typeof prefs.preferredLightTheme === 'string' ? prefs.preferredLightTheme : stateLight;
    var prefDark = prefs && typeof prefs.preferredDarkTheme === 'string' ? prefs.preferredDarkTheme : stateDark;
    var prefSystem = prefs && typeof prefs.systemThemeEnabled === 'boolean' ? prefs.systemThemeEnabled : stateSystem;

    // Canonical source is dedicated theme prefs. Layout state is legacy fallback only.
    var themeId = prefThemeId || stateThemeId || (cache && cache.id ? cache.id : null);
    var systemEnabled = prefSystem;
    var mode = cache && cache.mode ? cache.mode : null;

    if (systemEnabled === true && window.matchMedia) {
      var isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      mode = isDark ? 'dark' : 'light';
      themeId = isDark ? prefDark : prefLight;
    } else if (systemEnabled === false && themeId) {
      mode = darkIds[themeId] ? 'dark' : 'light';
    }

    if (mode === 'dark') {
      d.classList.add('dark');
      d.style.colorScheme = 'dark';
    } else if (mode === 'light') {
      d.classList.remove('dark');
      d.style.colorScheme = 'light';
    }

    if (mode) {
      localStorage.setItem('doxmind-next-theme', mode);
    }
    if (themeId) {
      d.setAttribute('data-theme', themeId);
    }

    if (cache && cache.vars && typeof cache.vars === 'object') {
      for (var k in cache.vars) {
        if (Object.prototype.hasOwnProperty.call(cache.vars, k)) {
          d.style.setProperty(k, cache.vars[k]);
        }
      }
    }
  } catch (_) {}
})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: themeBootstrapScript,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
            {/* Skip to Content - Accessibility feature for keyboard users */}
            <a href="#main-content" className="skip-to-content">
              Skip to content
            </a>
            {children}
            <Toaster position="bottom-right" richColors />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
