import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { http, HttpResponse } from "msw";

import { server } from "./mocks/server";
import { Login } from "@/pages/Login";
import { RevisionList } from "@/components/revisions/RevisionList";
import { DEFAULT_SIGN_IN_OPTIONS, useAuthStore } from "@/store/auth";
import { UNAUTHENTICATED_EVENT } from "@/lib/session-events";
import type { User } from "@/types";

const PILOT = { sign_in: "pilot", email_domain: "renaissanceafrica.com", approvals_enabled: false };
const VIEWER: User = {
  id: "u-1",
  name: "J Okoro",
  email: "j.okoro@renaissanceafrica.com",
  is_admin: false,
  can_plan: false,
};
const PROJECT_ID = "cccccccc-0000-0000-0000-000000000001";

function resetStore() {
  useAuthStore.setState({
    user: null,
    loading: true,
    options: DEFAULT_SIGN_IN_OPTIONS,
    optionsLoaded: false,
  });
}

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<div>Dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("pilot sign-in", () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  it("asks for the name and signs a viewer in without a passcode", async () => {
    let sent: unknown = null;
    server.use(
      http.get("/api/auth/options", () => HttpResponse.json(PILOT)),
      http.get("/api/auth/me", () => HttpResponse.json({ detail: "Not authenticated" }, { status: 401 })),
      http.post("/api/auth/sign-in", async ({ request }) => {
        sent = await request.json();
        return HttpResponse.json(VIEWER);
      }),
    );
    renderLogin();

    const name = await screen.findByLabelText("Your email");
    expect(screen.getByText("@renaissanceafrica.com")).toBeInTheDocument();
    expect(screen.queryByText(/windows single sign-on/i)).not.toBeInTheDocument();
    // Nothing on the sign-in screen calls it a pilot.
    expect(screen.queryByText(/pilot/i)).not.toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "Sign in" });
    expect(submit).toBeDisabled();
    await userEvent.type(name, " j.okoro ");
    await userEvent.click(submit);

    expect(await screen.findByText("Dashboard page")).toBeInTheDocument();
    expect(sent).toEqual({ username: "j.okoro" }); // no blank passcode is sent
    expect(useAuthStore.getState().user?.email).toBe(VIEWER.email);
  });

  it("sends the passcode when one is typed and shows the server's refusal", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.get("/api/auth/options", () => HttpResponse.json(PILOT)),
      http.get("/api/auth/me", () => HttpResponse.json({ detail: "Not authenticated" }, { status: 401 })),
      http.post("/api/auth/sign-in", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ detail: "Sign-in failed. Check your name." }, { status: 401 });
      }),
    );
    renderLogin();

    await userEvent.type(await screen.findByLabelText("Your email"), "p.lanner");
    await userEvent.type(screen.getByLabelText(/passcode/i), "wrong-one");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-in failed. Check your name.");
    expect(bodies).toEqual([{ username: "p.lanner", passcode: "wrong-one" }]);
    expect(useAuthStore.getState().user).toBeNull();
    // The form is usable again.
    expect(screen.getByRole("button", { name: "Sign in" })).not.toBeDisabled();
  });

  it("keeps the Windows sign-in screen when the deployment is not a pilot", async () => {
    server.use(
      http.get("/api/auth/options", () => HttpResponse.json(DEFAULT_SIGN_IN_OPTIONS)),
      http.get("/api/auth/me", () => HttpResponse.json({ detail: "Not authenticated" }, { status: 401 })),
    );
    renderLogin();
    // The label depends on the build (dev user / retry); the form must not appear.
    expect(
      await screen.findByRole("button", { name: /retry sign-in|continue as dev user/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Your email")).not.toBeInTheDocument();
    expect(screen.getByText(/windows single sign-on/i)).toBeInTheDocument();
  });

  it("returns to sign-in when a pilot session ends, and only in a pilot", () => {
    useAuthStore.setState({ user: VIEWER, loading: false, options: DEFAULT_SIGN_IN_OPTIONS });
    window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    expect(useAuthStore.getState().user).not.toBeNull(); // Windows sign-in: left alone

    useAuthStore.setState({ options: PILOT as typeof DEFAULT_SIGN_IN_OPTIONS });
    window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT));
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("signs out on the server and forgets the user", async () => {
    let called = false;
    server.use(
      http.post("/api/auth/sign-out", () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    useAuthStore.setState({ user: VIEWER, loading: false });
    await useAuthStore.getState().signOut();
    expect(called).toBe(true);
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe("approvals switched off", () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  function renderList() {
    return render(
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/signatures`]}>
        <Routes>
          <Route
            path="/projects/:projectId/signatures"
            element={<RevisionList projectId={PROJECT_ID} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("hides Create Revision, and nothing else", async () => {
    useAuthStore.setState({ options: PILOT as typeof DEFAULT_SIGN_IN_OPTIONS });
    renderList();
    await waitFor(() => expect(screen.getByText("Rev. 01")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /create revision/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeInTheDocument();
  });

  it("offers Create Revision when approvals are on", () => {
    renderList();
    expect(screen.getByRole("button", { name: /create revision/i })).toBeInTheDocument();
  });
});
