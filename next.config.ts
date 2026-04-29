import type { NextConfig } from "next";

// Note: we deliberately do *not* use `next-intl/plugin` here. The plugin is
// designed to wire next-intl's server-side request config (cookies, headers,
// async getRequestConfig), but the desktop build is a static export and our
// i18n runs entirely on the client (see src/i18n/intl-provider.tsx). Keeping
// the plugin tripped a Next.js 15.5.x bug ("Expected clientReferenceManifest
// to be defined") during static export. Without it `useTranslations` /
// `useLocale` keep working because messages are passed through
// NextIntlClientProvider on the client.

const nextConfig: NextConfig = {
  // Static export so Tauri can serve the frontend from the bundled `out/`
  // directory. All API traffic goes directly to the FastAPI sidecar at the
  // URL injected as window.__TAURI_BACKEND_URL__ (see src/lib/api/client.ts).
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
};

export default nextConfig;
