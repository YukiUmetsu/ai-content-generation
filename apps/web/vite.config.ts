import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  input: {
    studio: fileURLToPath(new URL("./index.html", import.meta.url)),
    headlessVideo: fileURLToPath(new URL("./video-export.html", import.meta.url)),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
    proxy: {
      "/api/research": process.env.CONTENTGEN_RESEARCH_ORIGIN ?? "http://127.0.0.1:8788",
      "/api/jobs": process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
      "/api/creative": process.env.CONTENTGEN_CREATIVE_ORIGIN ?? "http://127.0.0.1:8789",
      "/v1/creative": process.env.CONTENTGEN_CREATIVE_ORIGIN ?? "http://127.0.0.1:8789",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
