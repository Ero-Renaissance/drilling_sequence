import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
  msalInstance: { getAllAccounts: () => [], logoutRedirect: vi.fn() },
  loginRequest: {},
}));

import { http, HttpResponse } from "msw";
import { RenameCampaignDialog } from "@/components/projects/RenameCampaignDialog";
import { server } from "./mocks/server";

function projectResponse(id: string, name: string) {
  return {
    id,
    name,
    field: null,
    region: null,
    status: "active",
    review_policy: "optional",
    created_by: "u1",
    created_at: "2026-01-01T00:00:00Z",
    members: [],
  };
}

describe("RenameCampaignDialog", () => {
  it("sends the trimmed new name in a PATCH and signals the caller", async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      http.patch("/api/projects/:projectId", async ({ request, params }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          projectResponse(String(params.projectId), String((patched as { name: string }).name)),
        );
      }),
    );

    const onRenamed = vi.fn();
    render(
      <RenameCampaignDialog projectId="proj-001" currentName="Bonga Q2" onRenamed={onRenamed} />,
    );

    // The pencil trigger opens the dialog, pre-seeded with the current name.
    await userEvent.click(screen.getByRole("button", { name: /rename campaign/i }));
    const input = screen.getByLabelText(/campaign name/i);
    expect(input).toHaveValue("Bonga Q2");

    // Surrounding whitespace is trimmed before it goes to the server.
    await userEvent.clear(input);
    await userEvent.type(input, "  Bonga Q3  ");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(patched).not.toBeNull());
    expect(patched).toMatchObject({ name: "Bonga Q3" });
    await waitFor(() => expect(onRenamed).toHaveBeenCalled());
  });

  it("disables Save when the name is empty or unchanged", async () => {
    render(<RenameCampaignDialog projectId="proj-001" currentName="Bonga Q2" />);
    await userEvent.click(screen.getByRole("button", { name: /rename campaign/i }));

    const save = screen.getByRole("button", { name: /^save$/i });
    // Unchanged name → nothing to persist.
    expect(save).toBeDisabled();

    const input = screen.getByLabelText(/campaign name/i);
    await userEvent.clear(input);
    // Empty → still disabled (mirrors the server's non-empty rule).
    expect(save).toBeDisabled();

    await userEvent.type(input, "New Name");
    expect(save).toBeEnabled();
  });
});
