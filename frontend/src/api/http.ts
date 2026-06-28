import { logger } from "@/lib/logger";

/** A failed API call, carrying the HTTP status and the server's human-readable
 *  message so the UI can show it (e.g. the 423 "revision awaiting approval" lock
 *  explanation) instead of a generic fallback. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Read a failed response's FastAPI `detail` and throw it as an {@link ApiError},
 * so callers surface the server's actual message. Falls back to `fallback` when
 * the body has no string detail.
 */
export async function throwApiError(resp: Response, fallback: string): Promise<never> {
  let detail: string | undefined;
  try {
    const body = await resp.json();
    // FastAPI returns a string `detail`; some endpoints return `detail: { message }`.
    if (typeof body?.detail === "string") detail = body.detail;
    else if (typeof body?.detail?.message === "string") detail = body.detail.message;
    // FastAPI validation errors carry the reason in detail[].msg; Pydantic prefixes
    // custom-validator messages with "Value error, " — strip it for a clean toast.
    else if (Array.isArray(body?.detail) && typeof body.detail[0]?.msg === "string")
      detail = body.detail[0].msg.replace(/^Value error,\s*/, "");
  } catch {
    /* no body, or non-JSON — use the fallback */
  }
  const message = detail ?? fallback;
  // Centralised HTTP-error logging (see CLAUDE.md): 5xx as error, expected 4xx as
  // warn; attach where the user was. The detail is the server's safe message.
  logger[resp.status >= 500 ? "error" : "warn"]("API request failed", {
    status: resp.status,
    url: resp.url,
    path: typeof window !== "undefined" ? window.location.pathname : undefined,
    detail: message,
  });
  throw new ApiError(resp.status, message);
}
