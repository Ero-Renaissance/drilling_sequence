import { NavLink } from "react-router-dom";
import { LayoutDashboard, FolderKanban, Settings, Gauge, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";

const primaryNav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Projects", icon: FolderKanban },
];

const adminNav = { to: "/admin", label: "Admin", icon: ShieldCheck };

const secondaryNav = [
  { to: "/settings", label: "Settings", icon: Settings },
];

function BrandMark() {
  return (
    <div className="flex h-16 items-center gap-3 px-5">
      <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-amber-600 shadow-soft-md">
        <Gauge className="h-5 w-5 text-primary-foreground" strokeWidth={2.25} />
        <span className="absolute inset-0 rounded-lg ring-1 ring-inset ring-white/15" />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-[13px] font-semibold tracking-tight text-foreground">
          Drilling Sequence
        </span>
        <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Planner
        </span>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
      {children}
    </div>
  );
}

function NavItem({ to, label, icon: Icon }: (typeof primaryNav)[number]) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cn(
              "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-all",
              isActive
                ? "bg-primary opacity-100"
                : "bg-transparent opacity-0 group-hover:opacity-50 group-hover:bg-muted-foreground/30",
            )}
          />
          <Icon
            className={cn(
              "h-[18px] w-[18px] shrink-0 transition-colors",
              isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
            )}
            strokeWidth={isActive ? 2.25 : 2}
          />
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const isAdmin = useAuthStore((s) => s.user?.is_admin ?? false);
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border/70 bg-card/80 backdrop-blur-sm">
      <BrandMark />

      <nav className="flex-1 px-2.5 py-2">
        <SectionLabel>Workspace</SectionLabel>
        <div className="space-y-0.5">
          {primaryNav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
          {isAdmin && <NavItem {...adminNav} />}
        </div>
      </nav>

      <div className="px-2.5 pb-3">
        <div className="space-y-0.5">
          {secondaryNav.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </div>
      </div>
    </aside>
  );
}
