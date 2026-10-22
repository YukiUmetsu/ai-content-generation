/** Loopback-only browser harness for the real video-production worker. */
import { randomBytes, createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { inspectProduction } from "./cli.mjs";
import { localSpeechEndpoint } from "./local.mjs";
import { produceVideo } from "./produce.mjs";
import { findChromium } from "./try.mjs";

const exec = promisify(execFile);
const appRoot = fileURLToPath(new URL("../..", import.meta.url));
const uiRoot = fileURLToPath(new URL("./studio-ui", import.meta.url));
const fixtures = Object.freeze({
  smoke: JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-smoke.json", import.meta.url), "utf8")),
  long: JSON.parse(readFileSync(new URL("../../../../examples/video-production-house-math-long.json", import.meta.url), "utf8")),
});
const mediaFiles = new Map([
  ["video.mp4", "video/mp4"], ["master.wav", "audio/wav"], ["voice.wav", "audio/wav"],
  ["captions.srt", "text/plain; charset=utf-8"], ["qa-report.json", "application/json; charset=utf-8"],
  ["render-manifest.json", "application/json; charset=utf-8"],
]);
const headers = {
  "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
};

class ClientError extends Error {
  constructor(message, code = 400) { super(message); this.status = code; }
}

function textValue(value, label, max = 180) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\r\n\0]/.test(value)) {
    throw new ClientError(`${label} is required (maximum ${max} characters).`);
  }
  return value.trim();
}

function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ClientError("Choose a valid video configuration.");
  if (!["smoke", "long"].includes(input.mode)) throw new ClientError("Choose a smoke or long-form example.");
  if (!["fish", "local"].includes(input.provider)) throw new ClientError("Choose Fish Audio or local TTS.");
  const voiceId = textValue(input.voiceId, "Authorized voice ID");
  const providerRevision = textValue(input.providerRevision, "TTS engine revision");
  if (input.provider === "fish") {
    if (input.voiceConsent !== true || input.transmitText !== true) {
      throw new ClientError("Confirm permission to use the Fish voice and transmit the script text.");
    }
    if (input.apiKey !== undefined && (typeof input.apiKey !== "string" || input.apiKey.length > 4096)) {
      throw new ClientError("Invalid Fish API key input.");
    }
    return { mode: input.mode, provider: "fish", voiceId, providerRevision,
      apiKey: input.apiKey?.trim() || "", voiceConsent: true, transmitText: true };
  }
  if (input.localVoiceAuthorized !== true) throw new ClientError("Confirm authorization for the local voice.");
  const modelId = textValue(input.modelId, "Installed local model ID");
  const endpoint = textValue(input.endpoint, "Local TTS endpoint", 240);
  try { localSpeechEndpoint(endpoint); }
  catch { throw new ClientError("The local TTS endpoint must be a bare HTTP loopback origin and port."); }
  return { mode: input.mode, provider: "local", voiceId, modelId, providerRevision, endpoint, localVoiceAuthorized: true };
}

/** Only the known fixture fields are reused; browser input cannot mutate policy or assets. */
export function createStudioJob(input) {
  const config = validateConfig(input);
  const job = structuredClone(fixtures[config.mode]);
  job.voice = config.provider === "fish"
    ? { ...job.voice, provider: "fish", modelId: "s2.1-pro-free", voiceId: config.voiceId, licenseStatus: "unknown" }
    : { ...job.voice, provider: "local", modelId: config.modelId, voiceId: config.voiceId,
      endpoint: config.endpoint, licenseStatus: "unknown" };
  return job;
}

function signature(config, env) {
  const { apiKey: _ignored, ...nonSecret } = config;
  const credentialHash = config.provider === "fish"
    ? createHash("sha256").update(config.apiKey || env.FISH_AUDIO_API_KEY || "").digest("hex") : "not-applicable";
  return createHash("sha256").update(JSON.stringify({ ...nonSecret, credentialHash })).digest("hex");
}

function json(res, status, payload) {
  res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function bodyJson(req) {
  if (Number(req.headers["content-length"] || 0) > 16 * 1024) throw new ClientError("Request exceeds 16 KB.", 413);
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 16 * 1024) throw new ClientError("Request exceeds 16 KB.", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ClientError("The request must contain valid JSON."); }
}

function authorize(req, token, url) {
  const host = req.headers.host ?? "";
  if (!/^((127\.0\.0\.1|localhost):\d+)$/.test(host)) throw new ClientError("Only local access is permitted.", 403);
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) throw new ClientError("A different origin cannot control video production.", 403);
  if (req.headers["sec-fetch-site"] === "cross-site") throw new ClientError("Cross-site requests are not allowed.", 403);
  if (req.method === "POST" && req.headers["x-contentgen-studio-token"] !== token) throw new ClientError("Studio token required.", 403);
  if (req.method === "POST" && !["/api/preflight", "/api/render", "/api/cancel"].includes(url.pathname)) {
    throw new ClientError("Unknown action.", 404);
  }
}

async function defaultBuild() {
  await exec("pnpm", ["build"], { cwd: appRoot, timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
}

function artifactName(name) {
  if (mediaFiles.has(name)) return name;
  if (/^stills\/frame-\d{6}\.png$/.test(name)) return name;
  return null;
}

async function serveArtifact(req, res, releaseDir, filename) {
  if (!releaseDir || !artifactName(filename)) throw new ClientError("Artifact not found.", 404);
  const path = join(releaseDir, filename);
  let size;
  try { const file = await stat(path); if (!file.isFile()) throw new Error("not a file"); size = file.size; }
  catch { throw new ClientError("Artifact not found.", 404); }
  const range = req.headers.range;
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) throw new ClientError("Invalid byte range.", 416);
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= size) {
      throw new ClientError("Byte range unavailable.", 416);
    }
    status = 206;
  }
  res.writeHead(status, { ...headers, "Accept-Ranges": "bytes", "Content-Length": end - start + 1,
    "Content-Type": mediaFiles.get(filename) || (extname(filename) === ".png" ? "image/png" : "application/octet-stream"),
    ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
  });
  createReadStream(path, { start, end }).on("error", () => res.destroy()).pipe(res);
}

async function listArtifacts(dir, token) {
  const stills = (await readdir(join(dir, "stills")).catch(() => []))
    .filter((name) => /^frame-\d{6}\.png$/.test(name)).sort()
    .map((name) => `/artifact/${token}/stills/${name}`);
  const link = (name) => `/artifact/${token}/${name}`;
  return { video: link("video.mp4"), master: link("master.wav"), voice: link("voice.wav"),
    captions: link("captions.srt"), qa: link("qa-report.json"), manifest: link("render-manifest.json"), stills };
}

/** Start one ephemeral, token-protected local test server; injectable for offline tests. */
export async function startVideoStudio({ port = 8788, outputRoot = join(homedir(), "Movies", "ContentGen"),
  build = defaultBuild, inspect = inspectProduction, produce = produceVideo, findBrowser = findChromium,
  env = process.env } = {}) {
  const token = randomBytes(24).toString("hex");
  let busy = false, validatedSignature = "", abort = null, activeKey = "", releaseDir = null;
  let snapshot = { status: "idle", phase: "idle", message: "Choose a test and check readiness.",
    findings: [], report: null, progress: null, artifacts: null, qa: null, outputDir: null };
  const update = (patch) => { snapshot = { ...snapshot, ...patch }; };
  const publicStatus = () => snapshot;
  const handlePreflight = async (req, res) => {
    if (busy) throw new ClientError("A test operation is already running.", 409);
    const config = validateConfig(await bodyJson(req));
    const job = createStudioJob(config);
    busy = true;
    validatedSignature = "";
    update({ status: "checking", phase: "building", message: "Building the video scene locally…", report: null, findings: [], progress: null });
    try {
      await build();
      update({ phase: "preflight", message: "Checking media tools, browser and voice permissions…" });
      let browserExecutable = "";
      try { browserExecutable = await findBrowser(env); }
      catch { /* inspectProduction exposes the missing browser as an actionable finding. */ }
      const report = await inspect(job, {
        out: join(outputRoot, "preflight-owned-check"), provider: config.provider,
        providerRevision: config.providerRevision, browserExecutable, allowTestAssets: true,
        budgetUsd: 0, allowNetwork: config.provider === "fish", voiceReferenceConsent: config.voiceConsent === true,
        textTransmissionApproved: config.transmitText === true, localVoiceAuthorized: config.localVoiceAuthorized === true,
        localEndpoint: config.endpoint,
        env: { ...env, FISH_AUDIO_API_KEY: config.apiKey || env.FISH_AUDIO_API_KEY || "" },
      });
      const safeReport = JSON.parse(JSON.stringify(report).replaceAll(config.apiKey || "\u0000", "[redacted]"));
      if (report.ready) validatedSignature = signature(config, env);
      update({ status: report.ready ? "ready" : "blocked", phase: "preflight", report: safeReport,
        findings: safeReport.findings || [], message: report.ready ? "Ready to render. No TTS provider was called." : "Readiness blocked; resolve the findings below." });
      json(res, 200, { ready: report.ready, report: safeReport });
    } catch (error) {
      update({ status: "failed", phase: "preflight", message: "Preflight failed. Confirm pnpm dependencies and the export build.",
        findings: [{ code: "preflight-error", severity: "error", message: "Could not build or inspect the local video renderer." }] });
      json(res, 500, { error: "Could not build/check the renderer. Run pnpm install --frozen-lockfile and retry." });
    } finally { busy = false; }
  };
  const handleRender = async (req, res) => {
    if (busy) throw new ClientError("A test operation is already running.", 409);
    const input = await bodyJson(req);
    const config = validateConfig(input);
    if (input.confirmRender !== true) throw new ClientError("Confirm this one test render explicitly.");
    if (snapshot.status !== "ready" || signature(config, env) !== validatedSignature) {
      throw new ClientError("Run Check readiness with these exact settings before rendering.", 409);
    }
    const job = createStudioJob(config);
    const out = join(resolve(outputRoot), `${config.mode}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(5).toString("hex")}`);
    const controller = new AbortController();
    busy = true;
    abort = controller;
    activeKey = config.apiKey || env.FISH_AUDIO_API_KEY || "";
    validatedSignature = "";
    releaseDir = null;
    update({ status: "rendering", phase: "starting", message: "Starting actual media production…",
      progress: null, artifacts: null, qa: null, outputDir: out, findings: [] });
    json(res, 202, { started: true });
    void (async () => {
      try {
        await mkdir(out, { recursive: true });
        await writeFile(join(out, "job.json"), JSON.stringify(job, null, 2) + "\n", { mode: 0o600, flag: "wx" });
        const browserExecutable = await findBrowser(env);
        const result = await produce(job, {
          out, provider: config.provider, providerRevision: config.providerRevision,
          apiKey: activeKey, browserExecutable, budgetUsd: 0, allowTestAssets: true,
          allowNetwork: config.provider === "fish", voiceReferenceConsent: config.voiceConsent === true,
          textTransmissionApproved: config.transmitText === true, localVoiceAuthorized: config.localVoiceAuthorized === true,
          localEndpoint: config.endpoint, signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) update({ phase: progress.phase, progress,
              message: progress.completedFrames !== undefined
                ? `Captured ${progress.completedFrames.toLocaleString()} of ${progress.totalFrames.toLocaleString()} verified frames.`
                : (progress.message || "Producing the draft video…") });
          },
        });
        if (controller.signal.aborted) throw new Error("cancelled");
        releaseDir = result.releaseDir;
        const qa = result.qa;
        update({ status: "completed", phase: "review", message: "Draft exported. Watch and listen before any publishing decision.",
          artifacts: await listArtifacts(releaseDir, token),
          qa: { technicalPass: qa.technicalPass, commercialReady: false, releaseStatus: qa.releaseStatus,
            durationSeconds: qa.durationSeconds, frameCount: qa.frameCount, findings: qa.findings || [] } });
      } catch (error) {
        const cancelled = controller.signal.aborted;
        const sanitized = String(error?.message || "The production worker failed").replaceAll(activeKey || "\u0000", "[redacted]");
        update({ status: cancelled ? "cancelled" : "failed", phase: cancelled ? "cancelled" : "failed",
          message: cancelled ? "Render cancelled. No draft release was published." : sanitized.slice(0, 260), artifacts: null, qa: null });
      } finally { activeKey = ""; busy = false; abort = null; }
    })();
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      authorize(req, token, url);
      if (req.method === "GET" && url.pathname === "/api/status") return json(res, 200, publicStatus());
      if (req.method === "GET" && url.pathname === "/api/fixtures") return json(res, 200,
        Object.fromEntries(Object.entries(fixtures).map(([mode, job]) => [mode, { title: job.topic.title,
          mode: job.mode, beats: job.beats.length, minimumSeconds: job.destination.minimumDurationSeconds || null }])));
      if (req.method === "POST" && url.pathname === "/api/preflight") return await handlePreflight(req, res);
      if (req.method === "POST" && url.pathname === "/api/render") return await handleRender(req, res);
      if (req.method === "POST" && url.pathname === "/api/cancel") {
        if (!busy || !abort) throw new ClientError("No active render to cancel.", 409);
        abort.abort(new Error("User requested cancellation"));
        update({ phase: "cancelling", message: "Stopping the current production worker…" });
        return json(res, 202, { cancelling: true });
      }
      if (req.method === "GET" && url.pathname === "/") {
        const template = await readFile(join(uiRoot, "index.html"), "utf8");
        res.writeHead(200, { ...headers, "Content-Type": "text/html; charset=utf-8" });
        return res.end(template.replace("STUDIO_TOKEN_PLACEHOLDER", token));
      }
      if (req.method === "GET" && ["/studio.css", "/studio.js"].includes(url.pathname)) {
        const name = url.pathname === "/studio.css" ? "app.css" : "app.js";
        res.writeHead(200, { ...headers, "Content-Type": name.endsWith("css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8" });
        return res.end(await readFile(join(uiRoot, name)));
      }
      const mediaMatch = req.method === "GET" ? /^\/artifact\/([\w-]+)\/(.+)$/.exec(url.pathname) : null;
      if (mediaMatch) {
        if (mediaMatch[1] !== token) throw new ClientError("Invalid artifact token.", 403);
        return await serveArtifact(req, res, releaseDir, mediaMatch[2]);
      }
      json(res, 404, { error: "Not found." });
    } catch (error) {
      if (!res.headersSent) json(res, error instanceof ClientError ? error.status : 500,
        { error: error instanceof ClientError ? error.message : "The local studio encountered an error." });
      else res.destroy();
    }
  });
  await new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolveStart(); });
  });
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}`, token, close: () => new Promise((resolveClose, reject) => {
    if (abort) abort.abort(new Error("Studio shutting down"));
    server.close((error) => error ? reject(error) : resolveClose());
  }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const studio = await startVideoStudio();
    process.stdout.write(`\nContentGen Video Test Studio\nOpen ${studio.url}\nPress Ctrl-C to stop. Draft/test-only; no remote call until Render.\n\n`);
  } catch (error) {
    process.stderr.write(`Could not start local studio: ${error.message}\n`);
    process.exitCode = 1;
  }
}
