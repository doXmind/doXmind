import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "framer-motion"],
    // @ts-expect-error -- proxyClientMaxBodySize exists at runtime but not yet in stable types
    proxyClientMaxBodySize: "60mb",
  },
  async rewrites() {
    // All /api/* routes (except a couple of in-process Next.js handlers) are
    // proxied to the local FastAPI sidecar.
    return [
      {
        source: "/api/chat/simple",
        destination: `${backendUrl}/api/chat/simple`,
      },
      {
        source: "/api/chat/conversations",
        destination: `${backendUrl}/api/chat/conversations`,
      },
      {
        source: "/api/chat/conversations/:path*",
        destination: `${backendUrl}/api/chat/conversations/:path*`,
      },
      {
        source: "/api/chat/messages/:path*",
        destination: `${backendUrl}/api/chat/messages/:path*`,
      },
      { source: "/api/files", destination: `${backendUrl}/api/files/` },
      { source: "/api/files/:path*", destination: `${backendUrl}/api/files/:path*` },
      { source: "/api/versions/:path*", destination: `${backendUrl}/api/versions/:path*` },
      { source: "/api/review/:path*", destination: `${backendUrl}/api/review/:path*` },
      { source: "/api/export/:path*", destination: `${backendUrl}/api/export/:path*` },
      { source: "/api/import/:path*", destination: `${backendUrl}/api/import/:path*` },
      { source: "/api/global-agent/:path*", destination: `${backendUrl}/api/global-agent/:path*` },
      { source: "/api/kb/:path*", destination: `${backendUrl}/api/kb/:path*` },
      { source: "/api/data-files", destination: `${backendUrl}/api/data-files` },
      { source: "/api/data-files/:path*", destination: `${backendUrl}/api/data-files/:path*` },
      { source: "/api/skills/:path*", destination: `${backendUrl}/api/skills/:path*` },
      { source: "/api/inline/:path*", destination: `${backendUrl}/api/inline/:path*` },
      { source: "/api/autocomplete/:path*", destination: `${backendUrl}/api/autocomplete/:path*` },
      {
        source: "/api/user-settings",
        destination: `${backendUrl}/api/user-settings/`,
      },
      {
        source: "/api/user-settings/:path*",
        destination: `${backendUrl}/api/user-settings/:path*`,
      },
      { source: "/api/oauth/:path*", destination: `${backendUrl}/api/oauth/:path*` },
      { source: "/api/images/:path*", destination: `${backendUrl}/api/images/:path*` },
      { source: "/api/databases", destination: `${backendUrl}/api/databases/` },
      { source: "/api/databases/:path*", destination: `${backendUrl}/api/databases/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
