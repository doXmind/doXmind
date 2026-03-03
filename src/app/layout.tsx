import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import "./styles/editor.css";
import "./styles/diff-review.css";
import "./styles/text-review.css";
import "./styles/code-block.css";
import "./styles/math-mermaid.css";
import "./styles/presentation.css";
import "./styles/mobile.css";
import "./styles/components.css";
import { Providers } from "@/components/providers";
import { GlobalAgentOverlay } from "@/components/global-agent/global-agent-overlay";
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
    default: "doXmind - AI Writing Studio",
    template: "%s | doXmind",
  },
  description:
    "A minimalist AI-powered writing tool for markdown editing. Chat with AI, get suggestions, and write better content.",
  keywords: ["AI writing", "markdown editor", "writing assistant", "Claude AI", "content creation"],
  authors: [{ name: "doXmind Team" }],
  creator: "doXmind",
  metadataBase: new URL("https://beta.doxmind.com"),
  icons: {
    icon: "/icon.svg",
  },
  manifest: "/manifest.json",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: "doXmind",
    title: "doXmind - AI Writing Studio",
    description: "A minimalist AI-powered writing tool for markdown editing",
    images: [
      {
        url: "/icon.svg",
        width: 480,
        height: 480,
        alt: "doXmind AI Writing Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "doXmind - AI Writing Studio",
    description: "A minimalist AI-powered writing tool for markdown editing",
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
  description: "AI-powered writing assistant for markdown editing",
  applicationCategory: "Productivity",
  operatingSystem: "Web",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var c=localStorage.getItem('doxmind-theme-cache');if(!c)return;var t=JSON.parse(c);if(!t||!t.vars)return;var d=document.documentElement;if(t.mode==='dark'){d.classList.add('dark');d.style.colorScheme='dark'}else{d.classList.remove('dark');d.style.colorScheme='light'}localStorage.setItem('theme',t.mode);if(t.id)d.setAttribute('data-theme',t.id);var v=t.vars;for(var k in v){if(v.hasOwnProperty(k))d.style.setProperty(k,v[k])}}catch(e){}})();`,
          }}
        />
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
            <GlobalAgentOverlay />
            <Toaster position="bottom-right" richColors />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
