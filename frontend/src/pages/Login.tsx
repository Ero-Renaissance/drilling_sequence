import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Gauge, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/auth";
import { useThemeStore } from "@/store/theme";
import { msalInstance, loginRequest } from "@/lib/auth";

export function Login() {
  const navigate = useNavigate();
  const { user, loading, fetchMe } = useAuthStore();
  const initTheme = useThemeStore((s) => s.init);
  const isDev = import.meta.env.VITE_DEV_MODE === "true";

  useEffect(() => {
    return initTheme();
  }, [initTheme]);

  useEffect(() => {
    if (isDev) {
      fetchMe();
    }
  }, [fetchMe, isDev]);

  useEffect(() => {
    if (!loading && user) navigate("/dashboard", { replace: true });
  }, [user, loading, navigate]);

  const handleLogin = async () => {
    if (isDev) {
      await fetchMe();
    } else {
      await msalInstance.loginRedirect(loginRequest);
    }
  };

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-10 text-white lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 20%, rgba(245, 158, 11, 0.18), transparent 50%), radial-gradient(circle at 80% 80%, rgba(245, 158, 11, 0.08), transparent 60%)",
          }}
        />
        <div className="pointer-events-none absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-amber-600 shadow-lg shadow-amber-500/20">
            <Gauge className="h-6 w-6 text-zinc-950" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-semibold">Drilling Sequence</span>
            <span className="text-[10px] uppercase tracking-[0.18em] text-white/50">
              Planner
            </span>
          </div>
        </div>

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
          <div className="flex flex-col items-center gap-3 lg:hidden">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-amber-600 shadow-soft-md">
              <Gauge className="h-6 w-6 text-primary-foreground" strokeWidth={2.5} />
            </div>
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
  );
}
