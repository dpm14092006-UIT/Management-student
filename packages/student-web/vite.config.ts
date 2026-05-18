import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? "http://localhost:4000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["cache-control"] = "no-store";
            delete proxyRes.headers["etag"];
            delete proxyRes.headers["last-modified"];
          });
        }
      },
      "/socket.io": {
        target: process.env.VITE_API_URL ?? "http://localhost:4000",
        ws: true
      },
      "/static": {
        target: process.env.VITE_API_URL ?? "http://localhost:4000",
        changeOrigin: true
      }
    }
  }
});
