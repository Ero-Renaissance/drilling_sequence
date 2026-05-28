import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getViewers, type Viewer } from "@/api/viewers";

const POLL_INTERVAL_MS = 60_000;

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const AVATAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-emerald-500",
  "bg-amber-500", "bg-rose-500", "bg-cyan-500",
];

function avatarColor(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

interface ViewerStripProps {
  projectId: string;
}

export function ViewerStrip({ projectId }: ViewerStripProps) {
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await getViewers(projectId);
      setViewers(data);
    } catch {
      // presence is best-effort — silently ignore failures
    }
  }, [projectId]);

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [poll]);

  if (viewers.length === 0) return null;

  // Show up to 4 avatars; stack them with negative margin
  const visible = viewers.slice(0, 4);
  const overflow = viewers.length - visible.length;

  return (
    <div className="flex items-center gap-1.5" title={viewers.map((v) => v.user_name).join(", ")}>
      <div className="flex -space-x-2">
        {visible.map((v) => (
          <Avatar key={v.user_id} className="h-6 w-6 ring-2 ring-white">
            <AvatarFallback className={`text-[9px] font-bold text-white ${avatarColor(v.user_id)}`}>
              {initials(v.user_name)}
            </AvatarFallback>
          </Avatar>
        ))}
        {overflow > 0 && (
          <Avatar className="h-6 w-6 ring-2 ring-white">
            <AvatarFallback className="bg-slate-400 text-[9px] font-bold text-white">
              +{overflow}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
      <span className="text-xs text-slate-400">
        {viewers.length === 1 ? "1 viewer" : `${viewers.length} viewing`}
      </span>
    </div>
  );
}
