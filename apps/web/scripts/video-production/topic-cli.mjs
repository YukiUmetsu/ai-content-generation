/** Generate an inspectable video-production-job JSON; this command does not synthesize or publish media. */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { generateTopicDraft } from "./topic-generator.mjs";

export function parseTopicCli(argv) {
  const { values } = parseArgs({ args: argv, options: {
    help: { type: "boolean", default: false },
    topic: { type: "string" }, question: { type: "string" }, audience: { type: "string" }, notes: { type: "string" },
    model: { type: "string" }, endpoint: { type: "string", default: "http://127.0.0.1:11434/v1/chat/completions" },
    mode: { type: "string", default: "smoke" }, locale: { type: "string", default: "en-US" }, out: { type: "string" },
  }, strict: true, allowPositionals: false });
  if (values.help) return { help: true };
  if (!["smoke", "youtube-long"].includes(values.mode)) throw new Error("--mode must be smoke or youtube-long; portrait is a separate milestone");
  if (!values.out || !values.out.endsWith(".json")) throw new Error("--out must name a new .json job file");
  return { topic: values.topic, viewerQuestion: values.question, audience: values.audience,
    notes: values.notes, mode: values.mode, locale: values.locale, model: values.model,
    endpoint: values.endpoint, out: resolve(values.out) };
}

export async function runTopicCli(argv, { generate = generateTopicDraft, logger = console.log } = {}) {
  const { out, help, ...brief } = parseTopicCli(argv);
  if (help) {
    logger("Usage: pnpm video:topic -- --topic TEXT --audience TEXT --model INSTALLED_MODEL --out NEW_FILE.json [--question TEXT] [--notes TEXT] [--mode smoke|youtube-long] [--locale en-US|ja-JP] [--endpoint http://127.0.0.1:11434/v1/chat/completions]");
    logger("Generates an unverified editable draft with your already-running loopback text model; no TTS, model download or publication.");
    return null;
  }
  const draft = await generate(brief);
  // Never overwrite an edited storyboard or a previously generated job.
  await writeFile(out, JSON.stringify(draft.job, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  logger(`Wrote an unverified editorial draft: ${out}`);
  logger("Review claims, rights and narrated beats before running video:produce. No audio or publishing API was called.");
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runTopicCli(process.argv.slice(2)).catch((error) => { console.error(String(error.message ?? error)); process.exitCode = 1; });
}
