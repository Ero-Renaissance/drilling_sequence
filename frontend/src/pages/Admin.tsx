import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, Loader2, Users } from "lucide-react";
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
import { adminApi } from "@/api/admin";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
        <p className="text-sm text-muted-foreground">
          Grant or revoke global admin access. Admins can view and manage every project.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Admins granted via the email allowlist (marked) or an Azure AD role can&apos;t be revoked
          here — update the allowlist or the AD role instead.
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

      <div className="rounded-xl border border-border/70 bg-card shadow-soft-sm">
        <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">
            Users
            <span className="ml-2 font-normal text-muted-foreground">
              {loading ? "" : users.length}
            </span>
          </h2>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {users.map((user) => {
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
                    <div className="flex items-center gap-2">
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
                      {user.is_admin && user.admin_via_allowlist && (
                        <span
                          className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          title="Admin granted by the email allowlist — revoke by editing admin_emails"
                        >
                          via allowlist
                        </span>
                      )}
                      {isSelf && (
                        <span className="text-[10px] text-muted-foreground">(you)</span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{user.email}</div>
                  </div>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {user.project_count} project{user.project_count !== 1 ? "s" : ""}
                  </span>
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
      </div>

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
