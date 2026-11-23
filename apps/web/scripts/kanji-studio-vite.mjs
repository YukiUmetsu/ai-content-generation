/**
 * Vite-only, same-origin local API for the Studio's Kanji shorts page. It previews shorts, edits
 * the settings file (data/kanji-shorts/config.json), makes shorts one run at a time, and plays the
 * release videos.
 * - Runs are cancellable, and each short is tracked in Jobs when the local Rust server runs.
 * - The page is the CLI's equal: the same config, preview and producer as `pnpm video:kanji`.
 * - Nothing is sent anywhere until the person presses Make, which is their consent for that run.
 */
import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, join, sep } from "node:path";
import { createReadStream } from "node:fs";
import { DEFAULT_CONFIG, nextOutputDir, readKanjiConfig } from "./video-production/kanji-config.mjs";
import { KANJI_STUDIO_SETTINGS, applyKanjiStudioSettings, kanjiCatalog, kanjiQaSummary, kanjiReleases, kanjiStudioSettings,
  previewKanjiShorts, readKanjiStudio, releaseChar, releaseFolder, saveKanjiConfig } from "./video-production/kanji-studio.mjs";
import { produceKanjiShort } from "./video-production/kanji-short-producer.mjs";
import { kanjiShortContent } from "./video-production/kanji-short.mjs";
import { sendVideo } from "./video-production/media-range.mjs";
import { productionProviderKey } from "./video-production/provider-keychain.mjs";
import { findChromium } from "./video-production/try.mjs";
import { JobsUnavailableError, withWorkerJob } from "./video-production/worker-job.mjs";
import { MAX_TAKE, kanjiTakes, recordKanjiTake, takeMeasure, takeText } from "./video-production/kanji-takes.mjs";

export const KANJI_STUDIO_PREFIX = "/api/contentgen-kanji";
/** The most kanji one run makes: each is a few minutes of rendering. */
export const MAX_KANJI_PER_RUN = 10;
const RUNS = Symbol.for("contentgen.kanji-studio.runs");
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const respond = (res, status, body) => {
  res.writeHead(status, { ...headers, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
const clip = (message, max = 400) => String(message ?? "").slice(0, max);
const errorText = (error) => clip(error?.message ?? error);

function authorize(req, res) {
  const host = String(req.headers.host ?? ""), origin = req.headers.origin;
  if (!/^(127\.0\.0\.1|localhost):\d+$/u.test(host) || (origin && origin !== `http://${host}`) || req.headers["sec-fetch-site"] === "cross-site" ||
    req.method === "POST" && (origin !== `http://${host}` || req.headers["x-contentgen-kanji"] !== "local-only")) {
    respond(res, 403, { error: "Available only to the same-origin local Studio." });
    return false;
  }
  return true;
}

async function readBody(req, limit = 64 * 1024) {
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw Error("The request is too large.");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}

/** The kanji named in a text, as the CLI reads its arguments: each character once; letters, digits and marks are refused. */
export function kanjiFromText(text) {
  if (typeof text !== "string") throw Error("Name the kanji to make, for example 水火.");
  const chars = [...new Set([...text].filter(char => char.trim() && char !== "," && char !== "、"))];
  if (!chars.length) throw Error("Name the kanji to make, for example 水火.");
  if (chars.some(char => /[\p{ASCII}\p{P}\p{S}]/u.test(char))) throw Error("Each character must be one your data has, such as a kanji.");
  if (chars.length > MAX_KANJI_PER_RUN) throw Error(`One run makes at most ${MAX_KANJI_PER_RUN} kanji.`);
  return chars;
}

/** A text setting without any key for this text (the config compares keys trimmed and in Unicode NFC). */
const sameText = (a, b) => a.normalize("NFC").trim() === b.normalize("NFC").trim();
const withoutText = (settings, text) => Object.fromEntries(Object.entries(settings ?? {}).filter(([key]) => !sameText(key, text)));
const VERSION = /^v\d{1,5}$/u, STILL = /^frame-\d{6}\.png$/u;

/**
 * The page's API. `deps` replace the config path, the producer, the key, the browser and the
 * Jobs options in tests.
 */
export function createKanjiStudioApi(deps = {}) {
  const configPath = deps.configPath ?? process.env.CONTENTGEN_KANJI_CONFIG ?? DEFAULT_CONFIG;
  // The run is the process's, not this API object's: when Vite restarts its server in the same process,
  // the new API still reports a run in progress and refuses a second one. Tests pass their own holder.
  const runs = deps.runs ?? (globalThis[RUNS] ??= { run: null, controller: null });
  let saving = Promise.resolve();

  /** What the page shows of the current or last run. */
  const runView = () => runs.run && structuredClone(runs.run);

  async function loadStudio() {
    try { return { studio: await readKanjiStudio(configPath) }; }
    catch (error) {
      if (error?.code === "ENOENT" && error.path === configPath) return { problem: `There is no settings file yet. Make ${configPath} (see docs/how-to-make-kanji-shorts.md).` };
      return { problem: errorText(error) };
    }
  }

  async function state() {
    const { studio, problem } = await loadStudio();
    if (!studio) return { configured: false, configPath, problem, run: runView() };
    const made = new Map((await kanjiReleases(studio.config.outputRoot)).map(release => [release.char, release.versions.length]));
    return {
      configured: true, configPath, revision: studio.revision, provider: studio.config.voice.provider ?? "fish", outputRoot: studio.config.outputRoot,
      settings: kanjiStudioSettings(studio.raw), settingPaths: KANJI_STUDIO_SETTINGS,
      catalog: kanjiCatalog(studio.entries, { names: studio.config.names }).map(kanji => ({ ...kanji, versions: made.get(kanji.char) ?? 0 })),
      run: runView(),
    };
  }

  async function makeShorts(current, abort, studio, { apiKey, browserExecutable, consent }) {
    const signal = abort.signal;
    for (const item of current.items) {
      if (signal.aborted) { item.state = "cancelled"; continue; }
      item.state = "running"; item.phase = "preflight"; item.message = "Starting…";
      let made = null;
      try {
        const out = await nextOutputDir(studio.config.outputRoot, item.char);
        item.folder = releaseFolder(item.char); item.version = Number(basename(out).slice(1));
        const produce = (jobSignal) => {
          if (jobSignal.aborted) throw jobSignal.reason ?? Error("Cancelled.");
          return (deps.produce ?? produceKanjiShort)({
            char: item.char, config: studio.config, out, apiKey, browserExecutable,
            allowNetwork: consent.allowNetwork === true, voiceReferenceConsent: consent.voiceConsent === true,
            textTransmissionApproved: consent.transmitText === true, localVoiceAuthorized: consent.localVoice === true,
            signal: jobSignal, onProgress: (event) => { if (event.phase) item.phase = event.phase; if (event.message) item.message = clip(event.message, 200); },
          }).then(result => (made = result));
        };
        try {
          const { jobId } = await withWorkerJob({
            name: "Kanji short", signal, jobKind: "video-kanji-short", idempotencyKey: `video-kanji-short:${current.id}:${item.char}`,
            nodeKey: "kanji-short", nodeKind: "video.kanji-short", input: { char: item.char, runId: current.id, folder: item.folder, version: item.version },
            // A short that was made is recorded as made, even if Cancel came as it finished.
            keepFinishedWork: true,
            output: () => ({ char: item.char, folder: item.folder, version: item.version }),
            failure: { errorCode: "kanji_short_failed", errorDetail: "The kanji short stopped. Its error is shown on the Kanji shorts page; make it again from there." },
          }, ({ signal: jobSignal }) => produce(jobSignal), deps.jobs);
          item.jobId = jobId; item.tracked = true;
        } catch (error) {
          if (!(error instanceof JobsUnavailableError)) throw error;
          item.tracked = false;
          await produce(signal);
        }
        item.state = "done";
      } catch (error) {
        // A short that was made stays made, even if Jobs could not record it.
        if (made) { item.state = "done"; item.note = `Made, but Jobs could not record it: ${errorText(error)}`; }
        else if (error?.code === "JOBS_LEASE_LOST") {
          item.state = "cancelled";
          item.error = "Stopped in Jobs: cancelled on the Jobs page, or the Jobs server stopped. Make it again here.";
        } else { item.state = signal.aborted ? "cancelled" : "failed"; item.error = errorText(error); }
      }
      if (made) { item.qa = kanjiQaSummary(made.qa); item.phase = "done"; item.message = "Ready for review"; }
    }
    current.state = signal.aborted ? "cancelled" : "finished";
    current.finishedAt = new Date().toISOString();
  }

  async function start(body) {
    if (runs.controller) return [409, { error: "A run is already making shorts. Wait for it, or cancel it.", run: runView() }];
    if (body?.confirm !== true) return [400, { error: "Confirm the run to make shorts." }];
    const chars = kanjiFromText(body.kanji);
    // Claimed before any wait, so a second Make (another tab) is refused, never run alongside.
    const abort = new AbortController();
    runs.controller = abort;
    const release = () => { if (runs.controller === abort) runs.controller = null; };
    try {
      const { studio, problem } = await loadStudio();
      if (!studio) { release(); return [422, { error: problem }]; }
      const missing = chars.filter(char => !studio.entries.has(char));
      if (missing.length) { release(); return [422, { error: `Not in the kanji data: ${missing.join(" ")}` }]; }
      const consent = body.consent ?? {};
      const provider = studio.config.voice.provider ?? "fish";
      if (provider === "fish" && !(consent.allowNetwork === true && consent.voiceConsent === true && consent.transmitText === true)) {
        release(); return [400, { error: "Making shorts with Fish sends the narration text to Fish Audio: confirm the network, the voices and the text." }];
      }
      if (provider === "local" && consent.localVoice !== true) { release(); return [400, { error: "Confirm the local voice to make shorts." }]; }
      let apiKey;
      if (provider === "fish") {
        apiKey = await (deps.providerKey ?? productionProviderKey)("fish", { env: process.env }).catch(() => undefined);
        if (!apiKey) { release(); return [422, { error: "No Fish Audio key. Add it in Settings → Connections, then make the shorts again." }]; }
      }
      let browserExecutable;
      try { browserExecutable = await (deps.findBrowser ?? findChromium)(process.env); }
      catch (error) { release(); return [422, { error: errorText(error) }]; }
      const current = { id: randomUUID(), state: "running", startedAt: new Date().toISOString(), finishedAt: null,
        items: chars.map(char => ({ char, state: "queued", phase: null, message: null })) };
      runs.run = current;
      const started = makeShorts(current, abort, studio, { apiKey, browserExecutable, consent }).catch(error => {
        current.state = "finished"; current.error = errorText(error); current.finishedAt = new Date().toISOString();
      }).finally(release);
      deps.onRun?.(started);
      return [202, { run: runView() }];
    } catch (error) { release(); throw error; }
  }

  /**
   * Record one more take of a text. Pressing the button is the consent for that one request, as
   * Make is for a run; one take at a time.
   */
  let recording = false;
  async function recordTake(body) {
    if (recording) return [409, { error: "A take is being recorded. Wait for it." }];
    const part = takeText(body);
    recording = true;
    try {
      const { studio, problem } = await loadStudio();
      if (!studio) return [422, { error: problem }];
      const provider = studio.config.voice.provider ?? "fish", consent = body.consent ?? {};
      if (provider === "fish" && !(consent.allowNetwork === true && consent.voiceConsent === true && consent.transmitText === true))
        return [400, { error: "Recording a take with Fish sends this text to Fish Audio: confirm the network, the voice and the text." }];
      if (provider === "local" && consent.localVoice !== true) return [400, { error: "Confirm the local voice to record a take." }];
      let apiKey;
      if (provider === "fish") {
        apiKey = await (deps.providerKey ?? productionProviderKey)("fish", { env: process.env }).catch(() => undefined);
        if (!apiKey) return [422, { error: "No Fish Audio key. Add it in Settings → Connections, then record again." }];
      }
      const made = await recordKanjiTake(studio.config, part, { apiKey, ...(deps.synthesize ? { synthesize: deps.synthesize } : {}) });
      return [200, { take: made.take, ...(await takeMeasure(made.wavPath)) }];
    } finally { recording = false; }
  }

  /** A release file the page shows: the video, or its last still as the poster. Only real files under the output root. */
  async function releaseFile(outputRoot, folder, version, file) {
    if (!releaseChar(folder) || !VERSION.test(version)) return null;
    const releaseDir = join(outputRoot, folder, version, "release");
    let path = join(releaseDir, "video.mp4");
    if (file === "poster.png") {
      const stills = (await readdir(join(releaseDir, "stills")).catch(() => [])).filter(name => STILL.test(name)).sort();
      if (!stills.length) return null;
      path = join(releaseDir, "stills", stills.at(-1));
    } else if (file !== "video.mp4") return null;
    const [root, real] = await Promise.all([realpath(outputRoot), realpath(path).catch(() => null)]);
    if (!real || !real.startsWith(root + sep)) return null;
    const info = await lstat(path);
    return info.isFile() && !info.isSymbolicLink() ? path : null;
  }

  async function handle(req, res) {
    if (!authorize(req, res)) return;
    const url = new URL(req.url ?? "/", "http://local"), route = url.pathname;
    try {
      if (req.method === "GET" && route === "/state") return respond(res, 200, await state());
      if (req.method === "GET" && route === "/status") return respond(res, 200, { run: runView() });
      if (req.method === "GET" && route === "/releases") {
        const { studio, problem } = await loadStudio();
        if (!studio) return respond(res, 422, { error: problem });
        const chars = kanjiFromText(url.searchParams.get("kanji") ?? "");
        return respond(res, 200, { releases: await kanjiReleases(studio.config.outputRoot, { chars }) });
      }
      if (req.method === "GET" && route === "/takes") {
        const { studio, problem } = await loadStudio();
        if (!studio) return respond(res, 422, { error: problem });
        const part = takeText({ text: url.searchParams.get("text") ?? "", locale: url.searchParams.get("locale") ?? "" });
        const takes = await kanjiTakes(studio.config, part);
        return respond(res, 200, { takes: await Promise.all(takes.map(async take => ({ take: take.take, ...(await takeMeasure(take.wavPath).catch(() => ({ seconds: 0, pitch: [], shape: null, rise: null, fall: null, unreadable: true }))) }))) });
      }
      if (req.method === "GET" && route === "/take-audio") {
        const { studio, problem } = await loadStudio();
        if (!studio) return respond(res, 422, { error: problem });
        const part = takeText({ text: url.searchParams.get("text") ?? "", locale: url.searchParams.get("locale") ?? "" });
        const number = Number(url.searchParams.get("take"));
        const found = Number.isInteger(number) && number >= 1 && number <= MAX_TAKE ? (await kanjiTakes(studio.config, part)).find(take => take.take === number) : null;
        if (!found) return respond(res, 404, { error: "That take does not exist." });
        const info = await lstat(found.wavPath);
        res.writeHead(200, { ...headers, "Content-Type": "audio/wav", "Content-Length": info.size });
        createReadStream(found.wavPath).on("error", () => res.destroy()).pipe(res);
        return;
      }
      if (req.method === "POST" && route === "/takes") {
        const body = await readBody(req);
        const [status, payload] = await recordTake(body);
        return respond(res, status, payload);
      }
      if (req.method === "POST" && route === "/takes/use") {
        const body = await readBody(req);
        const part = takeText({ text: body.text, locale: "ja" });
        if (!(Number.isInteger(body.take) && body.take >= 1 && body.take <= MAX_TAKE)) return respond(res, 400, { error: `A take is a whole number from 1 to ${MAX_TAKE}.` });
        // The choice is a retake in the settings file: take 1 is the first recording, so no entry.
        const saved = saving.then(async () => {
          const { studio, problem } = await loadStudio();
          if (!studio) return [422, { error: problem }];
          const retakes = withoutText(studio.raw.narration?.retakes, part.text);
          // Take 1 needs no entry, unless a key that names fields ({labels.kun}、) would choose another take for it.
          const named = Object.keys(retakes).some(key => /\{[^}]*\}/u.test(key));
          if (body.take > 1 || named) retakes[part.text] = body.take;
          const next = applyKanjiStudioSettings(studio.raw, { "narration.retakes": Object.keys(retakes).length ? retakes : null }, configPath);
          const revision = await saveKanjiConfig(configPath, next, studio.revision);
          return [200, { revision, settings: kanjiStudioSettings(next) }];
        });
        saving = saved.catch(() => {});
        const [status, payload] = await saved;
        return respond(res, status, payload);
      }
      if (req.method === "POST" && route === "/name") {
        const body = await readBody(req);
        if (typeof body.char !== "string" || [...body.char].length !== 1 || typeof body.kana !== "string" || body.kana.length > 20)
          return respond(res, 400, { error: "Send a kanji and the reading, in kana, it is called by (empty for its default name)." });
        // The name in the settings file (names); an empty reading goes back to the data's default.
        const saved = saving.then(async () => {
          const { studio, problem } = await loadStudio();
          if (!studio) return [422, { error: problem }];
          const names = { ...(studio.raw.names ?? {}) };
          if (body.kana.trim()) names[body.char] = body.kana.trim(); else delete names[body.char];
          // A reading the kanji does not have is refused here, before the file changes; clearing a name always works.
          if (body.kana.trim()) {
            const entry = studio.entries.get(body.char);
            if (!entry) return [422, { error: `${body.char} is not in the kanji data.` }];
            kanjiShortContent(entry, { name: names[body.char] });
          }
          const next = structuredClone(studio.raw);
          if (Object.keys(names).length) next.names = names; else delete next.names;
          readKanjiConfig(next, configPath);
          const revision = await saveKanjiConfig(configPath, next, studio.revision);
          return [200, { revision, settings: kanjiStudioSettings(next) }];
        });
        saving = saved.catch(() => {});
        const [status, payload] = await saved;
        return respond(res, status, payload);
      }
      if (req.method === "POST" && route === "/speech") {
        const body = await readBody(req);
        const part = takeText({ text: body.text, locale: "ja" });
        if (typeof body.as !== "string" || body.as.length > 40) return respond(res, 400, { error: "Send what the voice reads instead, up to 40 characters, or nothing to read the part as written." });
        // "Spoken as" in the settings file: an empty text reads the part as written again.
        const saved = saving.then(async () => {
          const { studio, problem } = await loadStudio();
          if (!studio) return [422, { error: problem }];
          const speech = withoutText(studio.raw.narration?.speech, part.text);
          if (body.as.trim() && body.as.trim() !== part.text.trim()) speech[part.text] = body.as.trim();
          const next = applyKanjiStudioSettings(studio.raw, { "narration.speech": Object.keys(speech).length ? speech : null }, configPath);
          const revision = await saveKanjiConfig(configPath, next, studio.revision);
          return [200, { revision, settings: kanjiStudioSettings(next) }];
        });
        saving = saved.catch(() => {});
        const [status, payload] = await saved;
        return respond(res, status, payload);
      }
      const media = /^\/media\/([^/]+)\/([^/]+)\/(video\.mp4|poster\.png)$/u.exec(route);
      if (req.method === "GET" && media) {
        const { studio, problem } = await loadStudio();
        if (!studio) return respond(res, 422, { error: problem });
        const path = await releaseFile(studio.config.outputRoot, decodeURIComponent(media[1]), media[2], media[3]);
        if (!path) return respond(res, 404, { error: "That release file does not exist." });
        if (media[3] === "video.mp4") return await sendVideo(req, res, path, headers);
        res.writeHead(200, { ...headers, "Content-Type": "image/png" });
        createReadStream(path).on("error", () => res.destroy()).pipe(res);
        return;
      }
      if (req.method === "POST" && route === "/preview") {
        const body = await readBody(req);
        const { studio, problem } = await loadStudio();
        if (!studio) return respond(res, 422, { error: problem });
        return respond(res, 200, { previews: await previewKanjiShorts(studio, kanjiFromText(body.kanji), deps.preview) });
      }
      if (req.method === "POST" && route === "/settings") {
        const body = await readBody(req);
        // One save at a time: the second of two saves on the same revision sees the first's file and is refused.
        const saved = saving.then(async () => {
          const { studio, problem } = await loadStudio();
          if (!studio) return [422, { error: problem }];
          if (body.revision !== studio.revision) return [409, { error: "The settings file changed since this page loaded it. Reload, then make the change again." }];
          const next = applyKanjiStudioSettings(studio.raw, body.changes, configPath);
          const revision = await saveKanjiConfig(configPath, next, studio.revision);
          return [200, { revision, settings: kanjiStudioSettings(next) }];
        });
        saving = saved.catch(() => {});
        const [status, payload] = await saved;
        return respond(res, status, payload);
      }
      if (req.method === "POST" && route === "/start") {
        const [status, payload] = await start(await readBody(req));
        return respond(res, status, payload);
      }
      if (req.method === "POST" && route === "/cancel") {
        if (!runs.controller) return respond(res, 409, { error: "No run is making shorts.", run: runView() });
        runs.controller.abort(Error("Cancelled on the Kanji shorts page."));
        return respond(res, 200, { run: runView() });
      }
      respond(res, 404, { error: "Unknown kanji shorts route." });
    } catch (error) {
      if (!res.headersSent) respond(res, 422, { error: errorText(error) });
      else res.destroy();
    }
  }
  return { handle };
}

export function kanjiStudioPlugin() {
  const api = createKanjiStudioApi();
  // configureServer must return nothing here: a returned function would run as a post-middleware hook.
  const mount = (server) => { server.middlewares.use(KANJI_STUDIO_PREFIX, (req, res) => { void api.handle(req, res); }); };
  return { name: "contentgen-kanji-studio", configureServer: mount, configurePreviewServer: mount };
}
