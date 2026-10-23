import { useCallback, useEffect, useState } from "react";
import {
  ClipboardList,
  ShieldCheck,
  ShieldOff,
  Loader2,
  Users,
  ListChecks,
  ChevronDown,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { SearchInput } from "@/components/ui/search-input";
import { toast } from "@/components/ui/toaster";
import { ReadinessCatalogAdmin } from "@/components/admin/ReadinessCatalogAdmin";
import { useRefreshReadinessCatalog } from "@/components/readiness/catalog";
import { adminApi, type AdminReadinessCatalog } from "@/api/admin";
import { useAuthStore } from "@/store/auth";
import type { AdminUser } from "@/types";

function initials(value: string): string {
  return value
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Admin() {
  const currentUser = useAuthStore((s) => s.user);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmUser, setConfirmUser] = useState<AdminUser | null>(null);
  const [search, setSearch] = useState("");
  const [privilegedOnly, setPrivilegedOnly] = useState(false);
  const [catalog, setCatalog] = useState<AdminReadinessCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const refreshLiveCatalog = useRefreshReadinessCatalog();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await adminApi.listUsers());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await adminApi.readinessCatalog());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load the readiness catalog");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Teams a user can be granted: active, grant-edited (the project gates belong
  // to campaign planners, not a grant).
  const grantableTeams = (catalog?.teams ?? []).filter(
    (t) => t.editor_source === "team_grant" && t.is_active,
  );
  const teamName = (code: string) => catalog?.teams.find((t) => t.code === code)?.name ?? code;

  async function toggleTeam(user: AdminUser, team: string, on: boolean) {
    const current = user.teams ?? [];
    const next = on ? [...current, team] : current.filter((t) => t !== team);
    setPendingId(user.id);
    setError(null);
    try {
      const { teams } = await adminApi.setTeams(user.id, next);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, teams } : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update readiness teams");
    } finally {
      setPendingId(null);
    }
  }

  async function toggleAdmin(user: AdminUser) {
    setPendingId(user.id);
    setError(null);
    try {
      const updated = await adminApi.setAdmin(user.id, !user.is_admin);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setPendingId(null);
    }
  }

  async function toggleCanPlan(user: AdminUser) {
    setPendingId(user.id);
    setError(null);
    try {
      const updated = await adminApi.setCanPlan(user.id, !user.can_plan);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    } finally {
      setPendingId(null);
    }
  }

  // Client-side filter: the org can be large (thousands of read-only users),
  // but the payload per row is tiny, so one fetch + local search stays snappy.
  const query = search.trim().toLowerCase();
  const filtered = users.filter(
    (u) =>
      (!privilegedOnly || u.is_admin || u.can_plan || (u.teams?.length ?? 0) > 0) &&
      (!query ||
        u.name.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query)),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>
        <p className="text-sm text-muted-foreground">
          Grant or revoke global access. Admins can view and manage every campaign; planners
          can create campaigns and manage the plans they hold the planner role on. A readiness
          team grant lets a user update that team&apos;s readiness checks in every campaign —
          nothing else.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Admins granted via the allowlist (marked) — the user&apos;s email or Windows
          username in <code>ADMIN_EMAILS</code> — can&apos;t be revoked here; update the
          allowlist instead.
        </p>
      </div>

      {error && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      <CollapsibleSection
        title="Users"
        icon={Users}
        storageKey="ds.admin-section.users"
        count={
          loading
            ? ""
            : filtered.length === users.length
              ? users.length
              : `${filtered.length} of ${users.length}`
        }
        actions={
          <>
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={privilegedOnly}
                onChange={(e) => setPrivilegedOnly(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Privileged only
            </label>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search name or email…"
              ariaLabel="Search users"
              testId="admin-user-search"
            />
          </>
        }
      >
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No users match{search ? ` “${search}”` : " the filter"}.
              </li>
            )}
            {filtered.map((user) => {
              const isSelf = currentUser?.id === user.id;
              const revokeLocked = user.is_admin && (isSelf || user.admin_via_allowlist);
              const lockReason = !revokeLocked
                ? undefined
                : isSelf
                  ? "You cannot revoke your own admin access"
                  : "Admin via the email allowlist — remove them from admin_emails to revoke";
              return (
                <li key={user.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary/15 text-xs text-primary">
                      {initials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 leading-tight">
                    {/* Wraps: with the Teams menu the name column can get narrow,
                        and badges must never overlap the project count. */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-medium text-foreground">{user.name}</span>
                      {user.is_admin && (
                        <Badge
                          variant="secondary"
                          className="gap-1 text-[10px] text-primary"
                        >
                          <ShieldCheck className="h-3 w-3" />
                          Admin
                        </Badge>
                      )}
                      {user.can_plan && (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <ClipboardList className="h-3 w-3" />
                          Planner
                        </Badge>
                      )}
                      {user.is_admin && user.admin_via_allowlist && (
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          title="Admin granted by the email allowlist — revoke by editing admin_emails"
                        >
                          via allowlist
                        </span>
                      )}
                      {(user.teams ?? []).map((t) => (
                        <Badge key={t} variant="info" className="gap-1 text-[10px]">
                          <ListChecks className="h-3 w-3" />
                          {teamName(t)}
                        </Badge>
                      ))}
                      {isSelf && (
                        <span className="text-[10px] text-muted-foreground">(you)</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                  </div>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {user.project_count} project{user.project_count !== 1 ? "s" : ""}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        disabled={
                          pendingId === user.id ||
                          (grantableTeams.length === 0 && (user.teams ?? []).length === 0)
                        }
                        title={
                          grantableTeams.length === 0
                            ? "Add a readiness team below to grant it"
                            : "Readiness teams this user can update in every campaign"
                        }
                      >
                        <ListChecks className="h-3.5 w-3.5" />
                        Teams
                        {(user.teams ?? []).length > 0 && ` (${(user.teams ?? []).length})`}
                        <ChevronDown className="h-3 w-3 opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="text-xs">Readiness team grants</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {grantableTeams.map((t) => (
                        <DropdownMenuCheckboxItem
                          key={t.code}
                          checked={(user.teams ?? []).includes(t.code)}
                          onCheckedChange={(on) => toggleTeam(user, t.code, on === true)}
                        >
                          {t.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                      {/* A grant for a since-deactivated team can still be revoked. */}
                      {(user.teams ?? [])
                        .filter((code) => !grantableTeams.some((t) => t.code === code))
                        .map((code) => (
                          <DropdownMenuCheckboxItem
                            key={code}
                            checked
                            onCheckedChange={() => toggleTeam(user, code, false)}
                          >
                            {teamName(code)} (inactive)
                          </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant={user.can_plan ? "ghost" : "outline"}
                    size="sm"
                    className="shrink-0"
                    disabled={pendingId === user.id}
                    title={
                      user.can_plan
                        ? "Remove the planner grant — they immediately lose planning rights on every campaign"
                        : "Grant planner — they can create campaigns and be added as a campaign planner"
                    }
                    onClick={() => toggleCanPlan(user)}
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                    {user.can_plan ? "Revoke planner" : "Make planner"}
                  </Button>
                  <Button
                    variant={user.is_admin ? "ghost" : "outline"}
                    size="sm"
                    className="shrink-0"
                    disabled={pendingId === user.id || revokeLocked}
                    title={lockReason}
                    onClick={() => setConfirmUser(user)}
                  >
                    {pendingId === user.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : user.is_admin ? (
                      <ShieldOff className="h-3.5 w-3.5" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    {user.is_admin ? "Revoke admin" : "Make admin"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleSection>

      {/* Configuration sections start folded so the page opens on the people;
          each remembers being opened. */}
      <ReadinessCatalogAdmin
        catalog={catalog}
        loading={catalogLoading}
        defaultOpen={false}
        storageKey="ds.admin-section.readiness"
        onChanged={() => {
          loadCatalog();
          refreshLiveCatalog();
        }}
      />

      <Dialog open={!!confirmUser} onOpenChange={(o) => !o && setConfirmUser(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmUser?.is_admin ? "Revoke admin access?" : "Make this user an admin?"}
            </DialogTitle>
            <DialogDescription>
              {confirmUser?.is_admin ? (
                <>
                  Remove global admin from <strong>{confirmUser?.name}</strong>. They&apos;ll lose
                  access to every campaign they aren&apos;t a member of.
                </>
              ) : (
                <>
                  <strong>{confirmUser?.name}</strong> will be able to view and manage every
                  campaign. Grant global admin only when needed.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmUser(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmUser?.is_admin ? "destructive" : "default"}
              onClick={() => {
                if (confirmUser) toggleAdmin(confirmUser);
                setConfirmUser(null);
              }}
            >
              {confirmUser?.is_admin ? "Revoke admin" : "Make admin"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
