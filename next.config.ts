import type { NextConfig } from "next";

const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",
  experimental: {
    // Enable React 19 features
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
        source: "/api/edit/:path*",
        destination: `${backendUrl}/api/edit/:path*`,
      },
      {
        source: "/api/autocomplete/:path*",
        destination: `${backendUrl}/api/autocomplete/:path*`,
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
      // Health check
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
