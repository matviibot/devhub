import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const daemonPort = process.env.DEVHUB_PORT ?? "4317";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/ws": {
        target: `ws://localhost:${daemonPort}`,
        ws: true,
      },
      // Project artwork and the agent/resource endpoints are served by the
      // daemon. Keep development on the same-origin contract as production
      // so images do not silently fall back to initials under Vite.
      "/api": {
        target: `http://localhost:${daemonPort}`,
      },
    },
  },
});
