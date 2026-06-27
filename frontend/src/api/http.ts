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
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    /* no body, or non-JSON — use the fallback */
  }
  throw new ApiError(resp.status, detail ?? fallback);
}
