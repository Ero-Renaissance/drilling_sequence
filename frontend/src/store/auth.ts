import { create } from "zustand";
import type { User } from "@/types";
import { api } from "@/api/client";
import { UNAUTHENTICATED_EVENT } from "@/lib/session-events";

/** How this deployment signs people in (GET /api/auth/options, public). */
export interface SignInOptions {
  /** "sso": Windows sign-in at the proxy. "pilot": name (+ passcode to edit).
   *  "dev": the backend injects a dev user. */
  sign_in: "sso" | "pilot" | "dev";
  /** Shown after the name box in pilot mode. */
  email_domain: string | null;
  /** False hides submit / sign / decline; the server refuses them as well. */
  approvals_enabled: boolean;
  /** How long a pilot sign-in lasts. Absent outside pilot mode. */
  session_days?: number | null;
}

/** Until the server says otherwise: Windows sign-in, approvals available. */
export const DEFAULT_SIGN_IN_OPTIONS: SignInOptions = {
  sign_in: "sso",
  email_domain: null,
  approvals_enabled: true,
};

interface AuthState {
  user: User | null;
  loading: boolean;
  options: SignInOptions;
  optionsLoaded: boolean;
  loadOptions: () => Promise<void>;
  fetchMe: () => Promise<void>;
  /** Pilot sign-in. Rejects with the server's message (ApiError) when refused. */
  signIn: (username: string, passcode?: string) => Promise<void>;
  /** End the pilot session on the server, then forget the user here. */
  signOut: () => Promise<void>;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  options: DEFAULT_SIGN_IN_OPTIONS,
  optionsLoaded: false,

  loadOptions: async () => {
    if (get().optionsLoaded) return;
    try {
      const options = await api.get<SignInOptions>("/api/auth/options");
      set({ options, optionsLoaded: true });
    } catch {
      /* keep the defaults; the next call tries again */
    }
  },

  fetchMe: async () => {
    // Options first: the sign-in screen needs them even when nobody is signed in.
    await get().loadOptions();
    try {
      const user = await api.get<User>("/api/auth/me");
      set({ user, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },

  signIn: async (username, passcode) => {
    const body: { username: string; passcode?: string } = { username };
    if (passcode) body.passcode = passcode;
    const user = await api.post<User>("/api/auth/sign-in", body);
    set({ user, loading: false });
  },

  signOut: async () => {
    try {
      await api.post<void>("/api/auth/sign-out", {});
    } catch {
      /* the cookie may already be gone; signing out locally is still right */
    }
    set({ user: null, loading: false });
  },

  clear: () => set({ user: null, loading: false }),
}));

// A pilot session ends on its own (30 days, or an admin blocks the person). The
// next API call then answers 401: forget the user so the shell shows sign-in,
// rather than a page of failed requests. Windows sign-in has no session to
// expire, so it is left alone.
if (typeof window !== "undefined") {
  window.addEventListener(UNAUTHENTICATED_EVENT, () => {
    const state = useAuthStore.getState();
    if (state.options.sign_in === "pilot" && state.user) state.clear();
  });
}
