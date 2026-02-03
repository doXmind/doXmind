import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that require authentication
const protectedRoutes = ["/editor"];

// Routes that are only for non-authenticated users
const authRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];

// Skip auth check only if explicitly set to "true"
// Default: always require auth (both dev and prod)
const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes (no auth required)
  if (pathname.startsWith("/shared") || pathname.startsWith("/demo")) {
    return NextResponse.next();
  }

  // Skip auth only if explicitly configured
  if (skipAuth) {
    return NextResponse.next();
  }

  // Get token from cookie (set by auth store persist)
  // Note: We check localStorage token via cookie since middleware runs on server
  const authCookie = request.cookies.get("doxmind_auth");
  const isAuthenticated = !!authCookie?.value;

  // Check if this is a protected route
  const isProtectedRoute = protectedRoutes.some((route) => pathname.startsWith(route));

  // Check if this is an auth route (login, register, etc.)
  const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

  // If trying to access protected route without auth, redirect to login
  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // If authenticated user tries to access auth routes, redirect to editor
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL("/editor", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, icon.svg (favicon files)
     * - public folder files
     */
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)",
  ],
};
