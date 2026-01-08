import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enable React 19 features
  },
  async rewrites() {
    return [
      // Note: /api/chat/stream is handled by Next.js API route for proper streaming
      // Other API routes are proxied to the backend
      {
        source: "/api/chat/simple",
        destination: "http://localhost:8000/api/chat/simple",
      },
      {
        source: "/api/chat/conversations",
        destination: "http://localhost:8000/api/chat/conversations",
      },
      {
        source: "/api/chat/conversations/:path*",
        destination: "http://localhost:8000/api/chat/conversations/:path*",
      },
      {
        source: "/api/chat/messages",
        destination: "http://localhost:8000/api/chat/messages",
      },
      {
        source: "/api/edit/:path*",
        destination: "http://localhost:8000/api/edit/:path*",
      },
      {
        source: "/api/autocomplete/:path*",
        destination: "http://localhost:8000/api/autocomplete/:path*",
      },
      {
        source: "/api/files/:path*",
        destination: "http://localhost:8000/api/files/:path*",
      },
      {
        source: "/api/versions/:path*",
        destination: "http://localhost:8000/api/versions/:path*",
      },
    ];
  },
};

export default nextConfig;
