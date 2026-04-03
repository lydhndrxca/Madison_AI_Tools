import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8420",
        ws: true,
        timeout: 600000,
        configure: (proxy) => {
          proxy.on("proxyReq", (_proxyReq, _req, _res) => {
            // keep-alive so long AI generation requests don't get dropped
            _proxyReq.setHeader("Connection", "keep-alive");
          });
        },
      },
      "/ws": { target: "ws://127.0.0.1:8420", ws: true },
    },
    hmr: { overlay: false },
  },
  base: "./",
});
