/**
 * App logger — use this instead of raw `console.*` in components (see CLAUDE.md
 * LOGGING & OBSERVABILITY).
 *
 * Dev: readable console output. Prod: errors route to the configured monitoring
 * sink — none is wired yet (propose Azure App Insights / OpenTelemetry before
 * adding the dependency), so prod errors fall back to `console.error` rather than
 * being lost, and lower levels are dropped. Never pass PII / tokens as context.
 */
type LogContext = Record<string, unknown>;
type LogLevel = "debug" | "info" | "warn" | "error";

const isDev: boolean = import.meta.env.DEV;

function emit(level: LogLevel, message: string, context?: LogContext): void {
  if (isDev) {
    const fn = level === "debug" ? "log" : level;
    // The one sanctioned console call (this is the logger).
    console[fn](`[${level}] ${message}`, context ?? "");
    return;
  }
  // Production: route to the monitoring sink here once one is configured. Until then,
  // surface errors to console.error (so they aren't lost); drop lower levels.
  if (level === "error") {
    console.error(`[error] ${message}`, context ?? "");
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
