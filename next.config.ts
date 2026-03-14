import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL || "";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",
  experimental: {
    // Tree-shake barrel re-exports for commonly used icon/animation libraries
    optimizePackageImports: ["lucide-react", "framer-motion"],
    // Allow file import uploads through proxy (default 10MB; multipart adds overhead)
    // @ts-expect-error -- proxyClientMaxBodySize exists at runtime but not yet in stable types
    proxyClientMaxBodySize: "15mb",
  },
  async headers() {
    return [
      {
        // Security headers for all pages
        source: "/((?!demo).*)",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              `connect-src 'self' ${backendUrl} ${publicApiUrl} https://api.anthropic.com https://api.languagetool.org`.replace(
                /\s+/g,
                " "
              ),
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
      {
        // Allow demo page to be embedded in iframes from doxmind.com
        source: "/demo",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://doxmind.com https://www.doxmind.com https://app.doxmind.com http://localhost:* http://127.0.0.1:*",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // Note: /api/chat/stream is handled by Next.js API route for proper streaming
      // Other API routes are proxied to the backend
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
        source: "/api/chat/messages",
        destination: `${backendUrl}/api/chat/messages`,
      },
      {
        source: "/api/chat/messages/:path*",
        destination: `${backendUrl}/api/chat/messages/:path*`,
      },
      {
        source: "/api/edit/:path*",
        destination: `${backendUrl}/api/edit/:path*`,
      },
      {
        source: "/api/autocomplete/:path*",
        destination: `${backendUrl}/api/autocomplete/:path*`,
      },
      {
        source: "/api/files",
        destination: `${backendUrl}/api/files/`,
      },
      {
        source: "/api/files/:path*",
        destination: `${backendUrl}/api/files/:path*`,
      },
      {
        source: "/api/versions/:path*",
        destination: `${backendUrl}/api/versions/:path*`,
      },
      // Auth routes
      {
        source: "/api/auth/:path*",
        destination: `${backendUrl}/api/auth/:path*`,
      },
      // Knowledge base routes
      {
        source: "/api/kb/:path*",
        destination: `${backendUrl}/api/kb/:path*`,
      },
      // Data files routes (for code execution)
      {
        source: "/api/data-files/:path*",
        destination: `${backendUrl}/api/data-files/:path*`,
      },
      // Review routes
      {
        source: "/api/review/:path*",
        destination: `${backendUrl}/api/review/:path*`,
      },
      // Export routes
      {
        source: "/api/export/:path*",
        destination: `${backendUrl}/api/export/:path*`,
      },
      // Import routes
      {
        source: "/api/import",
        destination: `${backendUrl}/api/import/`,
      },
      {
        source: "/api/import/:path*",
        destination: `${backendUrl}/api/import/:path*`,
      },
      // Skills routes
      {
        source: "/api/skills/:path*",
        destination: `${backendUrl}/api/skills/:path*`,
      },
      // Telemetry routes - for user behavior tracking
      {
        source: "/api/telemetry/:path*",
        destination: `${backendUrl}/api/telemetry/:path*`,
      },
      // User settings routes - for API key and model preferences
      {
        source: "/api/user-settings",
        destination: `${backendUrl}/api/user-settings/`,
      },
      {
        source: "/api/user-settings/:path*",
        destination: `${backendUrl}/api/user-settings/:path*`,
      },
      // Image upload and serving
      {
        source: "/api/images/:path*",
        destination: `${backendUrl}/api/images/:path*`,
      },
      // Shares routes
      {
        source: "/api/shares",
        destination: `${backendUrl}/api/shares/`,
      },
      {
        source: "/api/shares/:path*",
        destination: `${backendUrl}/api/shares/:path*`,
      },
      // Community routes
      {
        source: "/api/community/:path*",
        destination: `${backendUrl}/api/community/:path*`,
      },
      // Comments routes
      {
        source: "/api/comments/:path*",
        destination: `${backendUrl}/api/comments/:path*`,
      },
      // Usage analytics
      {
        source: "/api/usage/:path*",
        destination: `${backendUrl}/api/usage/:path*`,
      },
      // Billing
      {
        source: "/api/billing/:path*",
        destination: `${backendUrl}/api/billing/:path*`,
      },
      // Global agent
      {
        source: "/api/global-agent/:path*",
        destination: `${backendUrl}/api/global-agent/:path*`,
      },
      // Notifications
      {
        source: "/api/notifications/:path*",
        destination: `${backendUrl}/api/notifications/:path*`,
      },
      // Databases
      {
        source: "/api/databases",
        destination: `${backendUrl}/api/databases/`,
      },
      {
        source: "/api/databases/:path*",
        destination: `${backendUrl}/api/databases/:path*`,
      },
      // Bookmarks (URL unfurling)
      {
        source: "/api/bookmarks/:path*",
        destination: `${backendUrl}/api/bookmarks/:path*`,
      },
      // Health check
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
