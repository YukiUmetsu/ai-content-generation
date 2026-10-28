/** Regenerate both same-origin starter ZIPs, offline, using ffmpeg + zip.
 * node --experimental-strip-types scripts/video-production/build-starter-character-packs.mjs
 * ZIPs are checked in; neither FFmpeg nor model/network access is required by the browser.
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rename, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { PIP_RIG, QUILL_RIG } from "../../src/video-export/pip-quill-rigs.ts";

const exec = promisify(execFile);
const outputRoot = resolve(fileURLToPath(new URL("../../public/starter-characters/", import.meta.url)));
const archiveTimestamp = new Date("1980-01-01T00:00:00.000Z");
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const paint = (value, palette) => value?.startsWith("$") ? palette[value.slice(1)] : value;

function assetSvg(asset, palette) {
  const shapes = asset.shapes.map(shape => {
    const attrs = Object.entries(shape).filter(([name]) => name !== "type").map(([name, value]) =>
      `${name === "strokeWidth" ? "stroke-width" : name}="${escape(typeof value === "string" ? paint(value, palette) : value)}"`).join(" ");
    return `<${shape.type} ${attrs}/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}" viewBox="0 0 ${asset.width} ${asset.height}">${shapes}</svg>`;
}

async function build(definition) {
  const root = await mkdtemp(join(tmpdir(), `contentgen-${definition.characterId}-`));
  const layers = join(root, "layers");
  try {
    await mkdir(layers);
    const assets = {};
    const paths = [];
    for (const [key, source] of Object.entries(definition.assets)) {
      if (source.kind !== "shapes" || !/^[a-zA-Z0-9_-]+$/u.test(key))
        throw Error(`Bundled ${definition.characterId} asset ${key} must be safe vector artwork`);
      const relative = `layers/${key}.png`;
      const svg = join(root, `${key}.svg`), png = join(root, relative);
      await writeFile(svg, assetSvg(source, definition.palette), {flag: "wx"});
      await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", svg,
        "-frames:v", "1", "-pix_fmt", "rgba", png], {timeout: 30000});
      await utimes(png,archiveTimestamp,archiveTimestamp);
      const bytes = await readFile(png);
      assets[key] = {kind: "image", uri: relative, mediaType: "image/png", width: source.width,
        height: source.height, sha256: createHash("sha256").update(bytes).digest("hex"),
        provenance: source.provenance};
      paths.push(relative);
    }
    await writeFile(join(root, "character.json"), JSON.stringify({...definition, assets}, null, 2) + "\n", {flag: "wx"});
    await utimes(join(root,"character.json"),archiveTimestamp,archiveTimestamp);
    await mkdir(outputRoot, { recursive: true });
    const archive = join(outputRoot, `${definition.characterId}.zip`);
    // `zip` updates an existing destination; remove only the explicitly generated
    // same-name file after building into a fresh, private temp path instead.
    const staging = join(root, `${definition.characterId}.zip`);
    await exec("zip", ["-q", "-X", "-0", staging, "character.json", ...paths],
      { cwd: root, env: {...process.env,TZ:"UTC"},timeout: 30000 });
    const zip = await readFile(staging);
    // A unique file in the destination directory makes replacement atomic on
    // that filesystem and leaves other invocations' staging files untouched.
    const stagedOutput=join(outputRoot,`.${definition.characterId}.${randomUUID()}.staging`);
    try {
      await writeFile(stagedOutput, zip, {flag: "wx"});
      await rename(stagedOutput,archive);
    } finally {
      await unlink(stagedOutput).catch(error=>{if(error.code!=="ENOENT")throw error;});
    }
    return {id: definition.characterId, bytes: zip.length, sha256: createHash("sha256").update(zip).digest("hex")};
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

for (const rig of [PIP_RIG, QUILL_RIG]) console.log(await build(rig));
