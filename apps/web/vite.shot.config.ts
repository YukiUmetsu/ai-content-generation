import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/** Node-only bundle for the offline shot bake. Three.js stays external and out of the export page. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    ssr: "src/video-shot/bake-entry.ts", outDir: "dist-shot", emptyOutDir: true, sourcemap: false,
    rollupOptions: { output: { entryFileNames: "bake-entry.mjs" } },
  },
});
