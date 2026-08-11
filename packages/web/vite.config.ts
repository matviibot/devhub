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
    },
  },
});
