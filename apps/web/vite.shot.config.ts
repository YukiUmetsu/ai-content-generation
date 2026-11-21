import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/** Node-only bundle for the offline shot bake, the story check and kanji card planning. Three.js stays external and out of the export page. */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    ssr: true, outDir: "dist-shot", emptyOutDir: true, sourcemap: false,
    rollupOptions: { input: { "bake-entry": "src/video-shot/bake-entry.ts", "story-entry": "src/video-shot/story-entry.ts", "kanji-entry": "src/video-shot/kanji-entry.ts" }, output: { entryFileNames: "[name].mjs" } },
  },
});
