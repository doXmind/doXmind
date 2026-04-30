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
import { ThemedToaster } from "@/components/themed-toaster";
import { ClientIntlProvider } from "@/i18n/intl-provider";

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
  title: "doXmind",
  description: "Local-first markdown writing studio.",
  icons: { icon: "/icon.svg" },
};

// Tauri sets `window.__TAURI_PLATFORM__` via an initialization script that
// runs at WKUserScriptInjectionTimeAtDocumentStart — i.e. before any HTML
// parsing. By the time this synchronous head <script> executes, the
// `<html>` element exists and the global is set, so we can flip the class
// on documentElement immediately. This is the layer that lets globals.css
// rules like `html.is-tauri-macos body { background: transparent }` apply
// before the first paint, which is essential for the NSVisualEffectView
// vibrancy below the webview to actually show through.
const tauriClassBootstrapScript = `(function(){
  try {
    var p = window.__TAURI_PLATFORM__;
    if (!p) return;
    var d = document.documentElement;
    d.classList.add('is-tauri', 'is-tauri-' + p);
    if (p === 'macos') d.classList.add('macos-vibrancy');
  } catch (_) {}
})();`;

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: tauriClassBootstrapScript }} />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <ClientIntlProvider>
          <Providers>
            <a href="#main-content" className="skip-to-content">
              Skip to content
            </a>
            {children}
            <ThemedToaster />
          </Providers>
        </ClientIntlProvider>
      </body>
    </html>
  );
}
