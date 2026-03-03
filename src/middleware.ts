import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that require authentication
const protectedRoutes = ["/editor"];

// Routes that are only for non-authenticated users
const authRoutes = ["/login", "/register", "/forgot-password", "/reset-password"];

// Skip auth check only if explicitly set to "true"
// Default: always require auth (both dev and prod)
const skipAuth = process.env.NEXT_PUBLIC_SKIP_AUTH === "true";

// i18n locale detection
const SUPPORTED_LOCALES = ["en", "zh"];
const DEFAULT_LOCALE = process.env.NEXT_PUBLIC_DEFAULT_LOCALE || "en";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  let response: NextResponse | undefined;

  // Allow public routes (no auth required)
  if (
    pathname.startsWith("/shared") ||
    pathname.startsWith("/demo") ||
    pathname.startsWith("/community") ||
    pathname.startsWith("/profile")
  ) {
    response = NextResponse.next();
  }

  // Skip auth only if explicitly configured
  if (!response && skipAuth) {
    response = NextResponse.next();
  }

  if (!response) {
    // Get token from cookie (set by auth store persist)
    const authCookie = request.cookies.get("doxmind_auth");
    const isAuthenticated = !!authCookie?.value;

    const isProtectedRoute = protectedRoutes.some((route) => pathname.startsWith(route));
    const isAuthRoute = authRoutes.some((route) => pathname.startsWith(route));

    if (isProtectedRoute && !isAuthenticated) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("redirect", pathname);
      response = NextResponse.redirect(loginUrl);
    }

    if (!response && isAuthRoute && isAuthenticated) {
      response = NextResponse.redirect(new URL("/", request.url));
    }
  }

  if (!response) {
    response = NextResponse.next();
  }

  // Set locale cookie if missing (for i18n)
  if (!request.cookies.get("NEXT_LOCALE")) {
    const acceptLang = request.headers.get("accept-language") || "";
    const preferred = acceptLang.split(",").map((s) => s.split(";")[0].trim().split("-")[0]);
    const detected = preferred.find((l) => SUPPORTED_LOCALES.includes(l)) || DEFAULT_LOCALE;
    response.cookies.set("NEXT_LOCALE", detected, {
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
      sameSite: "lax",
    });
  }

  return response;
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
