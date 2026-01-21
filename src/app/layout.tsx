import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "sonner";

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
  keywords: [
    "AI writing",
    "markdown editor",
    "writing assistant",
    "Claude AI",
    "content creation",
  ],
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <Providers>
          {/* Skip to Content - Accessibility feature for keyboard users */}
          <a
            href="#main-content"
            className="skip-to-content"
          >
            Skip to content
          </a>
          {children}
          <Toaster position="bottom-right" richColors />
        </Providers>
      </body>
    </html>
  );
}
