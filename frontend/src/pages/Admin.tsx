import { useCallback, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Ban,
  ClipboardList,
  KeyRound,
  UserPlus,
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
import { cn } from "@/lib/utils";
import type { AdminUser } from "@/types";

/** The page's two jobs, one tab each: who may do what, and the readiness
 *  catalog. The tab is kept in the link (`?tab=readiness`) so it can be shared;
 *  anything else in the link reads as Users. */
const TABS = [
  { key: "users", label: "Users", icon: Users },
  { key: "readiness", label: "Readiness checks", icon: ListChecks },
] as const;
type AdminTab = (typeof TABS)[number]["key"];

/** Shown only while pilot sign-in is on: says what it means and lets the admin
 *  add people to the list. The one place the app names the pilot. */
function PilotSignInCard({
  emailDomain,
  sessionDays,
  onAdded,
}: {
  emailDomain: string | null;
  sessionDays: number | null | undefined;
  onAdded: (user: AdminUser) => void;
}) {
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = username.trim() !== "" && name.trim() !== "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const added = await adminApi.addUser({ username: username.trim(), name: name.trim() });
      onAdded(added);
      setUsername("");
      setName("");
      toast.success(`${added.name} can now sign in`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add this person");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="pilot-sign-in-card"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <div className="flex items-center gap-2 font-semibold">
        <KeyRound className="h-4 w-4" />
        Pilot sign-in is on
      </div>
      <p className="mt-1 text-xs">
        Windows sign-in is not set up yet. Only the people listed below can sign in, with the part
        of their email before the @. Planners, readiness team editors and admins must also enter
        the pilot passcode. Submitting, signing and declining revisions are switched off —
        approvals are handled on paper.
        {sessionDays ? ` A sign-in lasts ${sessionDays} days.` : ""}
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={submit} noValidate>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Email
          <span className="flex items-center rounded-md border border-input bg-background text-foreground">
            <input
              className="w-44 bg-transparent px-2 py-1.5 text-sm outline-none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="firstname.lastname"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={64}
              aria-label="Email, the part before the @"
            />
            {emailDomain && (
              <span className="pr-2 text-xs text-muted-foreground">@{emailDomain}</span>
            )}
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Full name
          <input
            className="w-52 rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={256}
            aria-label="Full name"
          />
        </label>
        <Button type="submit" size="sm" disabled={!ready || busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
          Add person
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

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
  const signInOptions = useAuthStore((s) => s.options);
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: AdminTab = searchParams.get("tab") === "readiness" ? "readiness" : "users";

  const selectTab = (next: AdminTab) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "users") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  };

  // Left / Right move between the tabs, as a tab list should.
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: AdminTab = tab === "users" ? "readiness" : "users";
    selectTab(next);
    document.getElementById(`admin-tab-${next}`)?.focus();
  };

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

  async function toggleActive(user: AdminUser) {
    const allow = user.is_active === false;
    setPendingId(user.id);
    setError(null);
    try {
      const updated = await adminApi.setActive(user.id, allow);
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
      <h1 className="text-2xl font-semibold tracking-tight">Administration</h1>

      <div
        role="tablist"
        aria-label="Administration"
        className="flex items-center gap-1 border-b border-border/70"
      >
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              id={`admin-tab-${key}`}
              aria-selected={active}
              aria-controls={`admin-panel-${key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => selectTab(key)}
              onKeyDown={onTabKey}
              className={cn(
                "relative -mb-px flex items-center gap-2 rounded-t-md px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon
                className={cn("h-4 w-4", active ? "text-primary" : "text-muted-foreground/80")}
                strokeWidth={active ? 2.25 : 2}
              />
              {label}
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {tab === "users" && (
        <div
          role="tabpanel"
          id="admin-panel-users"
          aria-labelledby="admin-tab-users"
          className="space-y-6"
        >
          <div>
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

          {signInOptions.sign_in === "pilot" && (
            <PilotSignInCard
              emailDomain={signInOptions.email_domain}
              sessionDays={signInOptions.session_days}
              onAdded={(added) =>
                setUsers((prev) => [...prev, added].sort((a, b) => a.name.localeCompare(b.name)))
              }
            />
          )}

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
            collapsible={false}
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
                          {user.is_active === false && (
                            <Badge variant="destructive" className="gap-1 text-[10px]">
                              <Ban className="h-3 w-3" />
                              Blocked
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
                                ? "Add a readiness team on the Readiness checks tab to grant it"
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
                        variant="ghost"
                        size="sm"
                        className="shrink-0"
                        disabled={
                          pendingId === user.id ||
                          (user.is_active !== false && (isSelf || user.admin_via_allowlist))
                        }
                        title={
                          user.is_active === false
                            ? "Let this person sign in again"
                            : isSelf
                              ? "You cannot block your own sign-in"
                              : user.admin_via_allowlist
                                ? "Admin via the email allowlist — remove them from admin_emails to block"
                                : "Stop this person signing in. Their history is kept."
                        }
                        onClick={() => toggleActive(user)}
                      >
                        <Ban className="h-3.5 w-3.5" />
                        {user.is_active === false ? "Allow sign-in" : "Block sign-in"}
                      </Button>
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
        </div>
      )}

      {tab === "readiness" && (
        <div role="tabpanel" id="admin-panel-readiness" aria-labelledby="admin-tab-readiness">
          <ReadinessCatalogAdmin
            catalog={catalog}
            loading={catalogLoading}
            collapsible={false}
            onChanged={() => {
              loadCatalog();
              refreshLiveCatalog();
            }}
          />
        </div>
      )}

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
