import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth";
import { useThemeStore } from "@/store/theme";
import { msalInstance, loginRequest } from "@/lib/auth";

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" className={className} aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading, fetchMe, clear } = useAuthStore();
  const initTheme = useThemeStore((s) => s.init);
  const isDev = import.meta.env.VITE_DEV_MODE === "true";
  // Dev-only: /login?preview lets you view this page without dev mode auto
  // signing you in and bouncing to the dashboard.
  const previewMode = isDev && searchParams.has("preview");

  useEffect(() => {
    return initTheme();
  }, [initTheme]);

  useEffect(() => {
    if (previewMode) {
      clear(); // render the login UI (no user, not loading) instead of auto-signing in
    } else if (isDev) {
      fetchMe();
    }
  }, [fetchMe, clear, isDev, previewMode]);

  useEffect(() => {
    if (!loading && user && !previewMode) navigate("/dashboard", { replace: true });
  }, [user, loading, navigate, previewMode]);

  const handleLogin = async () => {
    if (isDev) {
      await fetchMe();
    } else {
      await msalInstance?.loginRedirect(loginRequest);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Renaissance brand accent strip — full width across both panels */}
      <div
        className="h-1 w-full shrink-0"
        style={{
          background:
            "linear-gradient(90deg,#E5332A 0%,#F58220 34%,#FCD116 67%,#3CB44A 100%)",
        }}
      />
      <div className="grid flex-1 lg:grid-cols-[1.1fr_1fr]">
        {/* Brand panel */}
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0c2a18] via-[#08160d] to-[#04100a] p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 20%, rgba(60, 180, 74, 0.20), transparent 50%), radial-gradient(circle at 80% 80%, rgba(60, 180, 74, 0.08), transparent 60%)",
          }}
        />
        <div className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <img
          src="/raec-logo.png"
          alt="Renaissance Africa Energy"
          className="relative h-10 w-auto self-start"
        />

        <div className="relative space-y-3">
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">
            Plan, sequence, and approve every drilling campaign in one place.
          </h2>
          <p className="max-w-md text-sm text-white/60">
            Coordinate rigs, track readiness checks, and capture formal sign-off — all
            with full revision history.
          </p>
        </div>

        <div className="relative flex items-center gap-2 text-xs text-white/50">
          <ShieldCheck className="h-4 w-4" />
          Secured with Microsoft single sign-on
        </div>
      </aside>

      {/* Login form panel */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile brand */}
          <div className="flex justify-center lg:hidden">
            <img
              src="/raec-logo.png"
              alt="Renaissance Africa Energy"
              className="h-9 w-auto"
            />
          </div>

          <div className="space-y-1.5 text-center lg:text-left">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground">
              Sign in to access your drilling campaigns
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              <Button className="w-full" size="lg" onClick={handleLogin}>
                {!isDev && <MicrosoftIcon className="mr-2 h-4 w-4" />}
                {isDev ? "Continue as Dev User" : "Sign in with Microsoft"}
              </Button>
              {isDev && (
                <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground/90 dark:text-warning">
                  Development mode — auth is bypassed.
                </div>
              )}
            </div>
          )}

          <p className="text-center text-xs text-muted-foreground lg:text-left">
            Access is restricted to authorised company personnel.
          </p>
        </div>
      </div>
      </div>
    </div>
  );
}
