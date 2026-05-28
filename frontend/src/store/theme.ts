import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "ds.theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStored(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const resolved = theme === "system" ? getSystemTheme() : theme;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

interface ThemeState {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  init: () => () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readStored(),
  resolved: readStored() === "system" ? getSystemTheme() : (readStored() as "light" | "dark"),

  setTheme: (theme) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }
    applyTheme(theme);
    set({ theme, resolved: theme === "system" ? getSystemTheme() : theme });
  },

  init: () => {
    applyTheme(get().theme);

    if (typeof window === "undefined") return () => {};
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (get().theme === "system") {
        applyTheme("system");
        set({ resolved: getSystemTheme() });
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  },
}));
