/**
 * App logger — use this instead of raw `console.*` in components (see CLAUDE.md
 * LOGGING & OBSERVABILITY).
 *
 * Dev: readable console output. Prod: errors go to `console.error` (for any
 * attached devtools) AND to the configured sink. The default sink ships them to
 * the backend (`POST /api/client-logs`), so on an internal deployment browser
 * errors land in the same structured log stream as the server — no external
 * service required. Swap the sink via {@link setLogSink} to add/replace it with an
 * external collector later. Never pass PII / tokens as context.
 */
import { getAccessToken } from "@/lib/auth";

type LogContext = Record<string, unknown>;
type LogLevel = "debug" | "info" | "warn" | "error";

/** Receives prod error events. Replace via {@link setLogSink} to route elsewhere. */
export type LogSink = (level: LogLevel, message: string, context?: LogContext) => void;

const isDev: boolean = import.meta.env.DEV;

let sink: LogSink = defaultSink;

/** Install a custom log sink (e.g. an external collector). Pass `null` to restore
 *  the default backend sink. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? defaultSink;
}

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (isDev) {
    const fn = level === "debug" ? "log" : level;
    // The one sanctioned console call (this is the logger).
    console[fn](`[${level}] ${message}`, context ?? "");
  } else if (level === "error") {
    // Surface errors to the console too, so attached devtools still show them.
    console.error(`[error] ${message}`, context ?? "");
  }
  // Errors are the signal worth keeping off-device. The sink is best-effort and
  // must never throw into the caller.
  if (level === "error") {
    try {
      sink(level, message, context);
    } catch {
      /* a broken sink must not break the app */
    }
  }
}

/** Default sink: ship errors to the backend in prod; no-op in dev. */
function defaultSink(level: LogLevel, message: string, context?: LogContext): void {
  if (isDev) return;
  void shipToBackend(level, message, context);
}

async function shipToBackend(
  level: LogLevel,
  message: string,
  context?: LogContext,
): Promise<void> {
  // Fire-and-forget. Uses bare fetch (never the api wrappers) and swallows all
  // failures, so a dropped log can neither surface to the user nor recurse back
  // into logger.*. `keepalive` lets it complete during page unload.
  try {
    const token = await getAccessToken();
    await fetch("/api/client-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ level, message, context: scrubContext(context) }),
      keepalive: true,
    });
  } catch {
    /* best-effort: logging must never break the app */
  }
}

/** Flatten context to scalar values — the backend accepts a flat scalar map, so
 *  stringify anything else rather than have the whole log entry rejected. */
function scrubContext(
  context?: LogContext,
): Record<string, string | number | boolean | null> | undefined {
  if (!context) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] =
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
        ? value
        : String(value);
  }
  return out;
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
