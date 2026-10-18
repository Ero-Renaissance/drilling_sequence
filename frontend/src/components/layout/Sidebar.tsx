import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  Calculator,
  FolderKanban,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";

const primaryNav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/projects", label: "Campaigns", icon: FolderKanban },
];

const adminNav = { to: "/admin", label: "Admin", icon: ShieldCheck };
const plannerNav = { to: "/optimizer", label: "Rig Optimization", icon: Calculator };

const COLLAPSED_KEY = "ds.sidebar-collapsed";

/** Starts as the user left it; on first visit, collapsed on narrow screens
 *  (small laptops, projectors) so the page keeps its width. */
function initialCollapsed(): boolean {
  try {
    const saved = window.localStorage.getItem(COLLAPSED_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    // storage unavailable — fall through to the screen-width default
  }
  return typeof window !== "undefined" && window.innerWidth < 1024;
}

function BrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("pb-3 pt-4", collapsed ? "px-2" : "px-4")}>
      <img
        src="/raec-logo.png"
        alt="Renaissance Africa Energy"
        className={cn(collapsed ? "h-7 w-full object-contain object-left" : "h-9 w-auto")}
      />
      {!collapsed && (
        <span className="mt-2 block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Drilling Sequence Planner
        </span>
      )}
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

function NavItem({
  to,
  label,
  icon: Icon,
  collapsed,
}: (typeof primaryNav)[number] & { collapsed: boolean }) {
  return (
    <NavLink
      to={to}
      // Collapsed: icon only — the label stays for screen readers and as a tooltip.
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-md py-2 text-sm font-medium transition-colors",
          collapsed ? "justify-center px-2" : "px-3",
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
          <span className={cn(collapsed && "sr-only")}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

/** The app's navigation. Collapses to an icon rail (remembered per browser) so
 *  the page gets the width back — for small screens and for presenting. */
export function Sidebar() {
  const isAdmin = useAuthStore((s) => s.user?.is_admin ?? false);
  const canPlan = useAuthStore((s) => s.user?.can_plan ?? false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const toggle = () =>
    setCollapsed((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable — the in-session choice still applies
      }
      return next;
    });
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border/70 bg-card/80 backdrop-blur-sm transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
      data-collapsed={collapsed}
    >
      <BrandMark collapsed={collapsed} />

      <nav className={cn("flex-1 py-2", collapsed ? "px-2" : "px-2.5")}>
        {!collapsed && <SectionLabel>Workspace</SectionLabel>}
        <div className="space-y-0.5">
          {primaryNav.map((item) => (
            <NavItem key={item.to} {...item} collapsed={collapsed} />
          ))}
          {(isAdmin || canPlan) && <NavItem {...plannerNav} collapsed={collapsed} />}
          {isAdmin && <NavItem {...adminNav} collapsed={collapsed} />}
        </div>
      </nav>

      <div className={cn("border-t border-border/60 py-2", collapsed ? "px-2" : "px-2.5")}>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex w-full items-center gap-3 rounded-md py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground",
            collapsed ? "justify-center px-2" : "px-3",
          )}
        >
          <ToggleIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
