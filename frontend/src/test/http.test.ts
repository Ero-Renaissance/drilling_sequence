import { describe, it, expect } from "vitest";

import { ApiError, throwApiError } from "@/api/http";

function resp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("throwApiError", () => {
  it("surfaces the server's detail message with its status", async () => {
    const err = await throwApiError(
      resp(423, { detail: "This activity is part of a revision awaiting approval and cannot be modified." }),
      "fallback",
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(423);
    expect(err.message).toMatch(/awaiting approval/);
  });

  it("falls back when there is no string detail", async () => {
    const err = await throwApiError(resp(500, {}), "Failed to save").catch((e) => e);
    expect(err.message).toBe("Failed to save");
  });

  it("falls back when the body is not JSON", async () => {
    const err = await throwApiError(new Response("not json", { status: 500 }), "Failed to save").catch(
      (e) => e,
    );
    expect(err.message).toBe("Failed to save");
  });

  it("surfaces a nested detail.message object (e.g. revision-create conflicts)", async () => {
    const err = await throwApiError(
      resp(409, { detail: { message: "Only the submitter can approve this revision." } }),
      "fallback",
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/Only the submitter/);
  });
});
