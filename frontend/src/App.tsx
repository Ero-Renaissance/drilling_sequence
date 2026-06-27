import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { ProjectList } from "@/pages/ProjectList";
import {
  ProjectDetail,
  OverviewTab,
  ChartTab,
  DataTab,
  ReadinessTab,
  CompareTab,
  SignaturesTab,
  ActivityLogTab,
} from "@/pages/ProjectDetail";
import { RevisionDetail } from "@/pages/RevisionDetail";
import { Admin } from "@/pages/Admin";
import ChartFixtures from "@/dev/ChartFixtures";
import { useAuthStore } from "@/store/auth";
import { Toaster } from "@/components/ui/toaster";

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user?.is_admin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/login" element={<Login />} />

        {/* Dev-only chart harness — auth-free, fixture-driven, dropped from prod
            builds (import.meta.env.DEV is statically false there). */}
        {import.meta.env.DEV && <Route path="/dev/fixtures" element={<ChartFixtures />} />}

        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/projects" element={<ProjectList />} />
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />
          <Route path="/projects/:projectId" element={<ProjectDetail />}>
            <Route index element={<Navigate to="overview" replace />} />
            <Route path="overview" element={<OverviewTab />} />
            <Route path="chart" element={<ChartTab />} />
            <Route path="data" element={<DataTab />} />
            <Route path="readiness" element={<ReadinessTab />} />
            <Route path="compare" element={<CompareTab />} />
            <Route path="signatures" element={<SignaturesTab />} />
            <Route path="activity" element={<ActivityLogTab />} />
            <Route path="revisions/:revisionId" element={<RevisionDetail />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
