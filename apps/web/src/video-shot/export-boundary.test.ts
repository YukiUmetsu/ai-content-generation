import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("video export boundary", () => {
  it("keeps Three.js and the offline bake out of the export page", () => {
    for (const file of sources(join(process.cwd(), "src/video-export"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from "three"/);
      expect(text, file).not.toMatch(/shot-bake|cinematic-camera-director|video-shot\//);
    }
  });
});
