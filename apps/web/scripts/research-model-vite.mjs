/** Vite-only same-origin localhost Settings API. No Docker/model starts or paid requests. */
import { readResearchModelSettings, saveResearchModelSettings, discoverResearchModels,
  DEFAULT_MODEL_ENDPOINT } from "./video-production/research-model-settings.mjs";
import { readModelProfiles, saveModelProfiles, modelForTask } from "./video-production/model-profiles.mjs";
import { configuredSearchEndpoint } from "./video-production/local-search-config.mjs";
import { checkLocalSearch } from "./video-production/searxng-docker.mjs";
import { inspectResearchReadiness } from "./research-readiness.mjs";

const PREFIX = "/api/local-research-model";
function output(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(body));
}
async function requestBody(req) {
  const chunks=[]; let bytes=0;
  for await (const c of req) {
    bytes += c.length;
    if (bytes > 8192) throw Error("Settings request exceeds 8 KiB.");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function handleResearchSettings(req, res, deps = {}) {
  const { read = readResearchModelSettings, save = saveResearchModelSettings,
    readProfiles = readModelProfiles, saveProfiles = saveModelProfiles,
    models = discoverResearchModels, searchEndpoint = configuredSearchEndpoint,
    selectModel = modelForTask, probeSearch = checkLocalSearch } = deps;
  const host = req.headers.host ?? "";
  const origin = req.headers.origin;
  if (!/^(127\.0\.0\.1|localhost):\d+$/u.test(host) ||
      (origin && origin !== "http://" + host) || req.headers["sec-fetch-site"] === "cross-site") {
    output(res, 403, { error: "Settings API is only available from this local Studio." });
    return;
  }
  if (req.method === "POST" && (origin !== "http://" + host ||
      req.headers["x-contentgen-settings"] !== "local-only")) {
    output(res, 403, { error: "Same-origin Settings action required." });
    return;
  }
  const route = (req.url ?? "/").split("?")[0];
  try {
    if (req.method === "GET" && route === "/") {
      const settings = await read();
      output(res, 200, {
        settings: settings ?? { version: 1, endpoint: DEFAULT_MODEL_ENDPOINT, model: "" },
        configured: !!settings, searchEndpoint: searchEndpoint(),
      });
    } else if (req.method === "GET" && route === "/profiles") {
      output(res, 200, { profiles: await readProfiles(), searchEndpoint: searchEndpoint() });
    } else if (req.method === "GET" && route === "/readiness") {
      output(res, 200, await inspectResearchReadiness({
        profiles: await readProfiles(), endpoint: searchEndpoint(), modelForTask: selectModel,
        checkSearch: probeSearch, listModels: models,
      }));
    } else if (req.method === "POST" && route === "/profiles/save") {
      const profiles = await saveProfiles(await requestBody(req));
      output(res, 200, { profiles, saved: true });
    } else if (req.method === "POST" && route === "/models") {
      const { endpoint } = await requestBody(req);
      const ids = await models(endpoint);
      output(res, 200, { models: ids });
    } else if (req.method === "POST" && route === "/save") {
      const settings = await save(await requestBody(req));
      output(res, 200, { settings, saved: true });
    } else output(res, 404, { error: "Unknown local settings route." });
  } catch (error) {
    output(res, 422, { error: String(error?.message ?? "Configuration could not be checked.").slice(0, 300) });
  }
}
export function researchModelSettingsPlugin() {
  return {
    name: "contentgen-local-research-model-settings",
    configureServer(server) {
      server.middlewares.use(PREFIX, (req, res) => { void handleResearchSettings(req, res); });
    },
    configurePreviewServer(server) {
      server.middlewares.use(PREFIX, (req, res) => { void handleResearchSettings(req, res); });
    },
  };
}
