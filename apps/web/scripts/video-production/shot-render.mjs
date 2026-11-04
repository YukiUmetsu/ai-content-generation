/** Render one performance shot: compile intent, bake in Kumiki, render with kumiki-blender.
 * ContentGen owns identity and caching here. All Blender work stays in the external tool.
 */
import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { compilePerformance } from "./performance-compiler.mjs";

const exec = promisify(execFile);
const stable = (value) => JSON.stringify(value, (_, item) =>
  item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : 1)) : item);

/** A shot is reused only when everything that can change its pixels is the same. */
export function shotCacheKey({ intent, speechWindows, assetHashes, tools, render }) {
  return createHash("sha256").update(stable({ intent, speechWindows, assetHashes, tools, render })).digest("hex");
}

export function kumikiBlenderTool(env = process.env) {
  const root = env.KUMIKI_BLENDER_ROOT;
  if (!root) throw Error("Set KUMIKI_BLENDER_ROOT to a kumiki-blender checkout to render 3D shots.");
  return { python: join(root, ".venv/bin/python"), env: { ...env, PYTHONPATH: join(root, "src") } };
}

async function runTool({ python, env }, args, { signal, onEvent } = {}) {
  await new Promise((done, fail) => {
    const child = spawn(python, ["-m", "kumiki_blender", ...args], { env, stdio: ["ignore", "pipe", "pipe"], signal, killSignal: "SIGTERM" });
    let errors = "", buffer = "";
    child.stdout.on("data", chunk => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) if (line.startsWith('{"event"')) { try { onEvent?.(JSON.parse(line)); } catch { /* not progress */ } }
    });
    child.stderr.on("data", chunk => { errors = (errors + chunk).slice(-2000); });
    child.on("error", fail);
    child.on("close", code => code === 0 ? done() : fail(Error(`kumiki-blender ${args[0]} failed: ${errors.trim().split("\n").at(-1) ?? code}`)));
  });
}

export async function renderPerformanceShot({ root, intent, cast, grips, speechWindows, shotId, width = 1920, height = 1080,
  profile = "draft", look, output, signal, onEvent, saveBlend = true, lipSync },
{ tool = kumikiBlenderTool(), bakeEntry = fileURLToPath(new URL("../../dist-shot/bake-entry.mjs", import.meta.url)) } = {}) {
  const definitions = {}, rigs = {};
  for (const actor of cast) {
    definitions[actor.id] = JSON.parse(await readFile(join(root, actor.pack, "character.json"), "utf8"));
    rigs[actor.id] = JSON.parse(await readFile(join(root, actor.rig), "utf8"));
  }
  await access(bakeEntry).catch(() => { throw Error("Run pnpm build:shot before rendering a shot."); });
  const request = compilePerformance({ intent, rigs, definitions, grips, speechWindows, width, height, shotId, lipSync });
  const requestPath = join(root, `${shotId}.request.json`), bakePath = join(root, `${shotId}.bake.json`);
  await writeFile(requestPath, JSON.stringify(request));
  await exec(process.execPath, [bakeEntry, requestPath, bakePath], { signal, maxBuffer: 1 << 20 });
  const specPath = join(root, `${shotId}.shot.json`);
  await writeFile(specPath, JSON.stringify({ schema_version: 1, shot_id: shotId, set: "set.json", bake: `${shotId}.bake.json`,
    actors: cast.map(actor => ({ id: actor.id, pack: actor.pack, profile: actor.profile })),
    render: { profile, width, height }, ...(look ? { look } : {}) }));
  await runTool(tool, ["build-shot", "--spec", resolve(specPath), "--output", resolve(output), ...(saveBlend ? [] : ["--no-blend"])], { signal, onEvent });
  const { contacts } = JSON.parse(await readFile(bakePath, "utf8"));
  return { output, contacts, manifest: JSON.parse(await readFile(join(output, "shot-manifest.json"), "utf8")) };
}
