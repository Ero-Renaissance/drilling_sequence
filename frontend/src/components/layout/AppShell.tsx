import { Outlet, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useAuthStore } from "@/store/auth";
import { useThemeStore } from "@/store/theme";
import { Skeleton } from "@/components/ui/skeleton";

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
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-[1600px] p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
