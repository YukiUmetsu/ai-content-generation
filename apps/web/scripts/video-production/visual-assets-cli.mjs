#!/usr/bin/env node
/** Local visual factory. Generate candidates first; a human review is required for packs. */
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createComfyUiClient } from "./comfyui-client.mjs";
import { createVisualAssetPackV1, validateVisualBriefV1, visualBriefHash } from "./visual-asset-factory.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const args = process.argv.slice(2), action = args.shift();
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  if (!/^--[a-z-]+$/u.test(args[i]) || !args[i + 1] || args[i + 1].startsWith("--"))
    throw Error(`expected --name value, got ${args[i]}`);
  flags[args[i].slice(2)] = args[i + 1];
}
const required = (name) => {
  if (!flags[name]) throw Error(`Missing --${name}`);
  return flags[name];
};
const load = async (path) => JSON.parse(await readFile(resolve(path), "utf8"));
const safeOutput = (value) => {
  const path = resolve(value);
  if (["/", "/tmp", "/workspace", process.cwd(), resolve(process.cwd(), "..")].includes(path))
    throw Error("Use a narrow, job-owned output directory");
  return path;
};

try {
  if (action === "health") {
    const stats = await createComfyUiClient({ endpoint: flags.endpoint }).health();
    console.log(JSON.stringify({ ok: true, devices: stats.devices.map((device) => device.name) }));
  } else if (action === "generate") {
    const brief = validateVisualBriefV1(await load(required("brief")));
    const workflow = await load(required("workflow"));
    const outputNodeIds = await load(required("nodes"));
    if (Object.keys(outputNodeIds).sort().join(",") !== [...brief.assetRoles].sort().join(","))
      throw Error("Every brief role must map to exactly one ComfyUI SaveImage output node");
    const model = required("model"), seed = Number(required("seed"));
    if (!model.trim() || !Number.isSafeInteger(seed) || seed < 0)
      throw Error("An explicit checkpoint name and nonnegative workflow seed are required");
    const nodes = Object.values(workflow);
    if (!nodes.some((node) => ["ckpt_name", "unet_name", "model_name"].some((key) => node?.inputs?.[key] === model)) ||
      !nodes.some((node) => ["seed", "noise_seed"].some((key) => node?.inputs?.[key] === seed)))
      throw Error("Declared model and seed must match concrete API-workflow node inputs");
    const client = createComfyUiClient({ endpoint: flags.endpoint });
    const result = await client.generate({ workflow, outputNodeIds });
    const out = safeOutput(required("out"));
    await mkdir(join(out, "candidates"), { recursive: true, mode: 0o700 });
    const layers = [];
    for (const [role, bytes] of Object.entries(result.images)) {
      const sha256 = digest(bytes), file = `candidates/${sha256}.png`;
      const path = join(out, file);
      try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
      catch (error) {
        if (error.code !== "EEXIST" || digest(await readFile(path)) !== sha256) throw error;
      }
      layers.push({ role, sha256, file });
    }
    const manifest = { kind: "contentgen-visual-candidates", schemaVersion: 1,
      beatId: brief.beatId, briefSha256: visualBriefHash(brief),
      workflowSha256: result.workflowSha256, promptId: result.promptId, model, seed,
      reviewStatus: "pending", layers };
    await writeFile(join(out, "generation.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: "candidates-need-review", output: out, layers: layers.length }));
  } else if (action === "pack") {
    const brief = validateVisualBriefV1(await load(required("brief")));
    const candidateRoot = safeOutput(required("candidates"));
    const generation = await load(join(candidateRoot, "generation.json"));
    const reviews = await load(required("reviews"));
    if (generation.kind !== "contentgen-visual-candidates" || generation.schemaVersion !== 1 ||
      generation.beatId !== brief.beatId || generation.briefSha256 !== visualBriefHash(brief) ||
      !Array.isArray(generation.layers) || generation.layers.length !== brief.assetRoles.length ||
      !Array.isArray(reviews) || reviews.length !== generation.layers.length)
      throw Error("generation/brief/review mismatch");
    const layers = [];
    for (const candidate of generation.layers) {
      if (!brief.assetRoles.includes(candidate.role) || !/^[a-f0-9]{64}$/u.test(candidate.sha256 ?? "") ||
        candidate.file !== `candidates/${candidate.sha256}.png`)
        throw Error("Invalid candidate file identity");
      const review = reviews.find((item) => item.role === candidate.role);
      if (!review || review.reviewStatus !== "approved" || !["self-created", "verified-licensed"].includes(review.rights))
        throw Error(`Layer ${candidate.role} needs explicit rights and quality approval`);
      const path = join(candidateRoot, candidate.file), stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw Error("Candidate is not a regular file");
      const bytes = await readFile(path);
      if (digest(bytes) !== candidate.sha256) throw Error("Candidate changed since generation");
      layers.push({ id: review.id, role: candidate.role, bytes,
        anchor: review.anchor, depth: review.depth, rights: review.rights,
        reviewStatus: review.reviewStatus,
        provenance: { generator: "ComfyUI", model: generation.model,
          workflowSha256: generation.workflowSha256, seed: generation.seed } });
    }
    const out = safeOutput(required("out"));
    const pack = await createVisualAssetPackV1({ brief, layers, outputDir: out });
    await writeFile(join(out, "visual-brief.json"), JSON.stringify(brief, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await writeFile(join(out, "visual-asset-pack.json"), JSON.stringify(pack, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ status: "reviewed-pack", output: out, layers: pack.assets.length }));
  } else {
    throw Error("Usage: visual-assets-cli.mjs health|generate|pack --flag value (see docs/23-visual-quality-foundation.md)");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
