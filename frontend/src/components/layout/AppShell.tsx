import { Outlet, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useAuthStore } from "@/store/auth";
import { useThemeStore } from "@/store/theme";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export function AppShell() {
  const { user, loading, fetchMe } = useAuthStore();
  const initTheme = useThemeStore((s) => s.init);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  useEffect(() => {
    return initTheme();
  }, [initTheme]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-64 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    // print: drop the fixed-height/overflow-hidden shell so the document flows
    // and paginates instead of being clipped to ~screen height.
    <div className="flex h-screen flex-col overflow-hidden bg-background print:block print:h-auto print:overflow-visible">
      {/* Renaissance brand accent strip */}
      <div
        className="h-[3px] w-full shrink-0 print:hidden"
        style={{
          background:
            "linear-gradient(90deg,#E5332A 0%,#F58220 34%,#FCD116 67%,#3CB44A 100%)",
        }}
      />
      <div className="flex flex-1 overflow-hidden print:block print:overflow-visible">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden print:block print:overflow-visible">
          <Header />
          <main className="flex-1 overflow-auto print:overflow-visible">
            <div className="mx-auto max-w-[1600px] p-6 lg:p-8 print:max-w-none print:p-0">
              <ErrorBoundary>
                <Outlet />
              </ErrorBoundary>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
