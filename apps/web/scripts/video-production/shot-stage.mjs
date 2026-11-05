#!/usr/bin/env node
/** Stage a performance fixture into an owned shot folder: set, cast, printed pages, rig reports.
 * Private rig packs and licensed textures come from outside the repository and are never committed.
 */
import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { promisify } from "node:util";
import { kumikiBlenderTool } from "./shot-render.mjs";

const exec = promisify(execFile);

export async function stageShot({ fixture, root, packs, assets }, { tool = kumikiBlenderTool() } = {}) {
  await mkdir(join(root, "cast"), { recursive: true });
  await mkdir(join(root, "faces"), { recursive: true });
  const run = (args) => exec(tool.python, ["-m", "kumiki_blender", ...args], { env: tool.env, maxBuffer: 1 << 22 });
  await copyFile(join(fixture, "set.json"), join(root, "set.json"));
  await cp(assets, join(root, "assets"), { recursive: true, force: false, errorOnExist: false });
  for (const file of await readdir(join(fixture, "documents"))) {
    await run(["render-document", "--spec", join(fixture, "documents", file), "--output", join(root, "faces", `${basename(file, ".json")}.png`)]);
  }
  for (const file of await readdir(join(fixture, "cast"))) {
    const id = basename(file, ".json");
    await copyFile(join(fixture, "cast", file), join(root, "cast", file));
    await cp(join(packs, id), join(root, "packs", id), { recursive: true });
    const { stdout } = await run(["describe-actor", "--pack", join(root, "packs", id), "--profile", join(root, "cast", file)]);
    const report = stdout.split("\n").find(line => line.startsWith("{"));
    if (!report) throw Error(`describe-actor returned no report for ${id}`);
    await writeFile(join(root, "cast", `${id}.rig.json`), report);
  }
  return root;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { fixture: { type: "string" }, root: { type: "string" }, packs: { type: "string" }, assets: { type: "string" } } });
  console.log(await stageShot({ fixture: resolve(values.fixture), root: resolve(values.root), packs: resolve(values.packs), assets: resolve(values.assets) }));
}
