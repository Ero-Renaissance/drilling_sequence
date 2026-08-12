import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  // Opt-in local SSO simulation: when VITE_FAKE_REMOTE_USER is set, the dev
  // proxy injects it as X-Remote-User on every /api call — playing the role IIS
  // has in production so the real header-auth path is testable in the browser.
  // Dev-only by construction: this proxy doesn't exist in a production build.
  const fakeUser = loadEnv(mode, __dirname).VITE_FAKE_REMOTE_USER;

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      // PORT lets a second instance (e.g. a tooling preview) run beside the
      // dev server without fighting over 5173.
      port: Number(process.env.PORT) || 5173,
      proxy: {
        "/api": {
          target: "http://localhost:8000",
          changeOrigin: true,
          ...(fakeUser ? { headers: { "X-Remote-User": fakeUser } } : {}),
        },
        "/ws": { target: "ws://localhost:8000", ws: true },
      },
    },
  };
});
