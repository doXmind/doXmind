import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  async rewrites() {
    // Local document/data routes are proxied to the FastAPI sidecar.
    return [
      { source: "/api/files", destination: `${backendUrl}/api/files/` },
      { source: "/api/files/:path*", destination: `${backendUrl}/api/files/:path*` },
      { source: "/api/versions/:path*", destination: `${backendUrl}/api/versions/:path*` },
      { source: "/api/export/:path*", destination: `${backendUrl}/api/export/:path*` },
      { source: "/api/import/:path*", destination: `${backendUrl}/api/import/:path*` },
      { source: "/api/images/:path*", destination: `${backendUrl}/api/images/:path*` },
      { source: "/api/databases", destination: `${backendUrl}/api/databases/` },
      { source: "/api/databases/:path*", destination: `${backendUrl}/api/databases/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
