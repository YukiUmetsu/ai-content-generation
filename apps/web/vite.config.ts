import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { researchModelSettingsPlugin } from "./scripts/research-model-vite.mjs";
import { directorStudioPlugin } from "./scripts/director-studio-vite.mjs";
import { directorProductionPlugin } from "./scripts/director-production-vite.mjs";

export default defineConfig({
  plugins: [react(), tailwindcss(), researchModelSettingsPlugin(), directorStudioPlugin(), directorProductionPlugin()],
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
      // The public market collector lives in the Rust ContentGen server,
      // unlike the existing evidence Research service on port 8788.
      "/api/research/market": process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
      "/api/research": process.env.CONTENTGEN_RESEARCH_ORIGIN ?? "http://127.0.0.1:8788",
      "/api/jobs": process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
      "/api/settings": process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
      "/api/creative": process.env.CONTENTGEN_CREATIVE_ORIGIN ?? "http://127.0.0.1:8789",
      "/v1/creative": process.env.CONTENTGEN_CREATIVE_ORIGIN ?? "http://127.0.0.1:8789",
    },
  },
  preview: { host: "127.0.0.1" },
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
