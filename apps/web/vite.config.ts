import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { researchModelSettingsPlugin } from "./scripts/research-model-vite.mjs";
import { directorStudioPlugin } from "./scripts/director-studio-vite.mjs";
import { directorProductionPlugin } from "./scripts/director-production-vite.mjs";
import { assetDiscoveryPlugin } from "./scripts/asset-discovery-vite.mjs";

export default defineConfig({
  plugins: [react(), tailwindcss(), researchModelSettingsPlugin(), directorStudioPlugin(), directorProductionPlugin(), assetDiscoveryPlugin()],
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
      // Evidence search, market observations, jobs and saved packaging all
      // live in the Rust ContentGen server (default 127.0.0.1:8787).
      // The director and model-setting Vite plugins expose their own routes.
      "/api/research/market": process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
      // Discovery and graph APIs enforce the same loopback Host/Origin match
      // as Settings; keep the browser's Host when forwarding mutations.
      "/api/research": {
        target: process.env.CONTENTGEN_RESEARCH_ORIGIN ?? process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
      // Productions belong to the same Rust persistence boundary as saved discovery
      // sessions. Keep the browser Host for loopback Origin enforcement.
      "/api/productions": {
        target: process.env.CONTENTGEN_RESEARCH_ORIGIN ?? process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
      "/api/jobs": process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
      // Preserve the browser Host for the Rust credential Origin guard.
      // Vite URL-string proxy shorthand otherwise rewrites Host to :8787.
      "/api/settings": {
        target: process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
      "/api/creative": process.env.CONTENTGEN_CREATIVE_ORIGIN ?? process.env.CONTENTGEN_JOBS_ORIGIN ?? "http://127.0.0.1:8787",
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
