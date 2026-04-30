import type { NextConfig } from "next";

// Note: we deliberately do *not* use `next-intl/plugin` here. The plugin is
// designed to wire next-intl's server-side request config (cookies, headers,
// async getRequestConfig), but the desktop build is a static export and our
// i18n runs entirely on the client (see src/i18n/intl-provider.tsx). Keeping
// the plugin tripped a Next.js 15.5.x bug ("Expected clientReferenceManifest
// to be defined") during static export. Without it `useTranslations` /
// `useLocale` keep working because messages are passed through
// NextIntlClientProvider on the client.

const isProd = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Static export so Tauri can serve the frontend from the bundled `out/`
  // directory. All API traffic goes directly to the FastAPI sidecar at the
  // URL injected as window.__TAURI_BACKEND_URL__ (see src/lib/api/client.ts).
  //
  // Only enable for production builds. In dev, `output: "export"` makes Next's
  // dev server reject any catch-all route param that isn't listed in
  // generateStaticParams() — which breaks `/editor/<uuid>` because file IDs
  // are runtime-only. Skipping it in dev lets the dynamic segment resolve
  // normally; the SPA still runs the same client-side routing in production.
  ...(isProd ? { output: "export" as const } : {}),
  trailingSlash: true,
  images: { unoptimized: true },
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
};

export default nextConfig;
