import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/** Node-only bundle for the offline shot bake and the story check. Three.js stays external and out of the export page. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    ssr: true, outDir: "dist-shot", emptyOutDir: true, sourcemap: false,
    rollupOptions: { input: { "bake-entry": "src/video-shot/bake-entry.ts", "story-entry": "src/video-shot/story-entry.ts" }, output: { entryFileNames: "[name].mjs" } },
  },
});
