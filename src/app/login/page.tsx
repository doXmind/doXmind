"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Logo } from "@/components/ui/logo";
import { useAuthStore } from "@/stores/auth-store";
import { api } from "@/lib/api";

type View = "login" | "register" | "verify" | "forgot";

function LoginContent() {
  const router = useRouter();
  const { login, register, verifyEmail, resendCode, loginWithGoogle, isLoading } = useAuthStore();
  const searchParams = useSearchParams();

  const [view, setView] = useState<View>("login");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sessionMessage, setSessionMessage] = useState("");

  // Form fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState(["", "", "", "", "", ""]);

  // Resend timer
  const [resendTimer, setResendTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Show session expired message if redirected from auth guard
  useEffect(() => {
    const reason = searchParams.get("reason");
    if (reason === "session_expired") {
      setSessionMessage("Your session has expired. Please sign in again.");
      window.history.replaceState({}, "", "/login");
    }
  }, [searchParams]);

  // Resend countdown timer
  useEffect(() => {
    if (resendTimer > 0) {
      timerRef.current = setInterval(() => {
        setResendTimer((prev) => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [resendTimer]);

  const clearMessages = () => {
    setError("");
    setSuccess("");
    setSessionMessage("");
  };

  const switchView = (newView: View) => {
    clearMessages();
    setView(newView);
  };

  // === Login ===
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    if (!email || !password) {
      setError("Please enter your email and password.");
      return;
    }
    try {
      await login(email, password);
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    }
  };

  // === Register ===
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    if (!email || !username || !password) {
      setError("Please fill in all fields.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    try {
      await register(email, username, password);
      setCode(["", "", "", "", "", ""]);
      setResendTimer(60);
      setView("verify");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Registration failed";
      setError(message);
    }
  };

  // === Verify Email ===
  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    const codeStr = code.join("");
    if (codeStr.length !== 6) {
      setError("Please enter the 6-digit code.");
      return;
    }
    try {
      await verifyEmail(email, codeStr);
      router.push("/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed";
      setError(message);
    }
  };

  // === Resend Code ===
  const handleResend = async () => {
    clearMessages();
    try {
      await resendCode(email);
      setResendTimer(60);
      setSuccess("A new code has been sent to your email.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to resend code";
      setError(message);
    }
  };

  // === Forgot Password ===
  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    if (!email) {
      setError("Please enter your email address.");
      return;
    }
    try {
      await api.forgotPassword(email);
      setSuccess("If an account exists with this email, you will receive a password reset link.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send reset email";
      setError(message);
    }
  };

  // === Google OAuth ===
  const handleGoogleLogin = async () => {
    clearMessages();
    try {
      await loginWithGoogle();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google login failed";
      setError(message);
    }
  };

  // === Code input handling ===
  const codeInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleCodeChange = useCallback(
    (index: number, value: string) => {
      if (value.length > 1) value = value[value.length - 1];
      if (value && !/^\d$/.test(value)) return;

      const newCode = [...code];
      newCode[index] = value;
      setCode(newCode);

      // Auto-focus next input
      if (value && index < 5) {
        codeInputRefs.current[index + 1]?.focus();
      }
    },
    [code]
  );

  const handleCodeKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === "Backspace" && !code[index] && index > 0) {
        codeInputRefs.current[index - 1]?.focus();
      }
    },
    [code]
  );

  const handleCodePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length > 0) {
      const newCode = [...Array(6)].map((_, i) => pasted[i] || "");
      setCode(newCode);
      const nextEmpty = newCode.findIndex((c) => !c);
      codeInputRefs.current[nextEmpty >= 0 ? nextEmpty : 5]?.focus();
    }
  }, []);

  // === Google Icon ===
  const GoogleIcon = (
    <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="space-y-2 text-center">
          <Link href="/" className="inline-block">
            <Logo size="lg" />
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {view === "login" && "Welcome back"}
            {view === "register" && "Create your account"}
            {view === "verify" && "Check your email"}
            {view === "forgot" && "Reset password"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {view === "login" && "Sign in to continue to doXmind"}
            {view === "register" && "Sign up to get started with doXmind"}
            {view === "verify" && (
              <>
                We sent a 6-digit code to{" "}
                <span className="font-medium text-foreground">{email}</span>
              </>
            )}
            {view === "forgot" && "Enter your email to receive a reset link"}
          </p>
        </div>

        {/* Messages */}
        {sessionMessage && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-600 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            {sessionMessage}
          </div>
        )}
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}
        {success && (
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-600 dark:border-green-800 dark:bg-green-950/30 dark:text-green-400">
            {success}
          </div>
        )}

        {/* === LOGIN VIEW === */}
        {view === "login" && (
          <>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="h-11"
              />
              <Input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-11"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => switchView("forgot")}
                >
                  Forgot password?
                </button>
              </div>
              <Button type="submit" className="h-11 w-full text-base" disabled={isLoading}>
                {isLoading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-11 w-full text-base"
              onClick={handleGoogleLogin}
              disabled={isLoading}
            >
              {GoogleIcon}
              Continue with Google
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{" "}
              <button
                type="button"
                className="font-medium text-foreground hover:underline"
                onClick={() => switchView("register")}
              >
                Sign up
              </button>
            </p>
          </>
        )}

        {/* === REGISTER VIEW === */}
        {view === "register" && (
          <>
            <form onSubmit={handleRegister} className="space-y-4">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="h-11"
              />
              <Input
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="h-11"
              />
              <Input
                type="password"
                placeholder="Password (8+ characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="h-11"
              />
              <Button type="submit" className="h-11 w-full text-base" disabled={isLoading}>
                {isLoading ? "Creating account..." : "Create Account"}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-11 w-full text-base"
              onClick={handleGoogleLogin}
              disabled={isLoading}
            >
              {GoogleIcon}
              Continue with Google
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <button
                type="button"
                className="font-medium text-foreground hover:underline"
                onClick={() => switchView("login")}
              >
                Sign in
              </button>
            </p>
          </>
        )}

        {/* === VERIFY VIEW === */}
        {view === "verify" && (
          <>
            <form onSubmit={handleVerify} className="space-y-4">
              <div className="flex justify-center gap-2" onPaste={handleCodePaste}>
                {code.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      codeInputRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleCodeChange(i, e.target.value)}
                    onKeyDown={(e) => handleCodeKeyDown(i, e)}
                    className="h-12 w-11 rounded-md border border-input bg-transparent text-center text-lg font-semibold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    autoFocus={i === 0}
                  />
                ))}
              </div>
              <Button type="submit" className="h-11 w-full text-base" disabled={isLoading}>
                {isLoading ? "Verifying..." : "Verify Email"}
              </Button>
            </form>

            <div className="text-center">
              {resendTimer > 0 ? (
                <p className="text-sm text-muted-foreground">Resend code in {resendTimer}s</p>
              ) : (
                <button
                  type="button"
                  className="text-sm font-medium text-foreground hover:underline"
                  onClick={handleResend}
                  disabled={isLoading}
                >
                  Resend code
                </button>
              )}
            </div>

            <p className="text-center text-sm text-muted-foreground">
              <button
                type="button"
                className="hover:underline"
                onClick={() => switchView("register")}
              >
                &larr; Back to sign up
              </button>
            </p>
          </>
        )}

        {/* === FORGOT PASSWORD VIEW === */}
        {view === "forgot" && (
          <>
            <form onSubmit={handleForgot} className="space-y-4">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="h-11"
              />
              <Button type="submit" className="h-11 w-full text-base" disabled={isLoading}>
                {isLoading ? "Sending..." : "Send Reset Link"}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground">
              <button type="button" className="hover:underline" onClick={() => switchView("login")}>
                &larr; Back to sign in
              </button>
            </p>
          </>
        )}

        {/* Terms & Privacy */}
        <p className="text-center text-xs text-muted-foreground">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          Loading...
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
