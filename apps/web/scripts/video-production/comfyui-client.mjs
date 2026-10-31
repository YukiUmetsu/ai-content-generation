/** Opt-in local ComfyUI API. No models are installed, downloaded or silently selected. */
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const assert = (condition, message) => { if (!condition) throw Error(`ComfyUI: ${message}`); };
const hex = (value) => createHash("sha256").update(value).digest("hex");
const MAX_WORKFLOW_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export function validateLocalComfyUrl(value) {
  const url = new URL(value);
  assert(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) &&
    !url.username && !url.password && (!url.pathname || url.pathname === "/") &&
    !url.search && !url.hash, "endpoint must be a local loopback HTTP origin");
  return url.origin;
}

/** API-format workflows only; UI workflow exports are deliberately rejected. */
export function validateComfyApiWorkflow(workflow) {
  assert(workflow && typeof workflow === "object" && !Array.isArray(workflow), "invalid API workflow");
  const ids = Object.keys(workflow);
  assert(ids.length >= 1 && ids.length <= 128, "workflow node count outside bounds");
  assert(ids.every((id) => /^\d{1,8}$/u.test(id) && typeof workflow[id]?.class_type === "string" &&
    workflow[id].class_type.length < 100 && workflow[id].inputs && typeof workflow[id].inputs === "object" &&
    !Array.isArray(workflow[id].inputs)), "expected ComfyUI API-format node inputs");
  const json = JSON.stringify(workflow);
  assert(Buffer.byteLength(json) <= MAX_WORKFLOW_BYTES, "workflow too large");
  return { json, workflowSha256: hex(json) };
}

function imageRef(image) {
  const filename = image?.filename, subfolder = image?.subfolder ?? "";
  assert(typeof filename === "string" && filename.length <= 180 &&
    /^[A-Za-z0-9][A-Za-z0-9_. -]*\.png$/iu.test(filename) && !filename.includes("..") &&
    typeof subfolder === "string" && subfolder.length <= 180 &&
    (subfolder === "" || /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u.test(subfolder)) &&
    image.type === "output", "unsafe or non-output ComfyUI image reference");
  return { filename, subfolder, type: "output" };
}

export function createComfyUiClient({ endpoint = "http://127.0.0.1:8188", fetchImpl = fetch, timeoutMs = 120000,
  pollIntervalMs = 500, signal } = {}) {
  const origin = validateLocalComfyUrl(endpoint);
  assert(Number.isInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 600000 &&
    Number.isInteger(pollIntervalMs) && pollIntervalMs >= 10 && pollIntervalMs <= 10000, "invalid time limits");
  const request = async (pathname, options = {}) => {
    const timeout = AbortSignal.timeout(Math.min(15000, timeoutMs));
    const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const response = await fetchImpl(`${origin}${pathname}`, { ...options, signal: combined, redirect: "error" });
    assert(response.ok, `HTTP ${response.status} at ${pathname.split("?")[0]}`);
    return response;
  };
  const health = async () => {
    const response = await request("/system_stats");
    const result = await response.json();
    assert(result && typeof result === "object" && Array.isArray(result.devices), "unexpected ComfyUI health response");
    return result;
  };
  const queue = async (workflow) => {
    const { json, workflowSha256 } = validateComfyApiWorkflow(workflow);
    const response = await request("/prompt", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: JSON.parse(json), client_id: randomUUID() }) });
    const result = await response.json();
    assert(typeof result.prompt_id === "string" && /^[a-f0-9-]{32,36}$/iu.test(result.prompt_id) &&
      !result.node_errors?.length && !(result.node_errors && Object.keys(result.node_errors).length),
    "ComfyUI rejected workflow or returned invalid prompt ID");
    return { promptId: result.prompt_id, workflowSha256 };
  };
  const history = async (promptId) => {
    assert(typeof promptId === "string" && /^[a-f0-9-]{32,36}$/iu.test(promptId), "invalid prompt ID");
    const response = await request(`/history/${encodeURIComponent(promptId)}`);
    const result = await response.json();
    return result?.[promptId] ?? null;
  };
  const waitForOutput = async (promptId) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (signal?.aborted) throw signal.reason ?? Error("ComfyUI cancelled");
      const result = await history(promptId);
      if (result) {
        assert(result.status?.status_str !== "error" && !result.status?.messages?.some((msg) => msg[0] === "execution_error"),
          "ComfyUI execution failed");
        if (result.status?.completed === true) return result.outputs ?? {};
      }
      await delay(Math.max(1, Math.min(pollIntervalMs, timeoutMs - (Date.now() - started))), undefined,
        signal ? { signal } : undefined);
    }
    throw Error("ComfyUI: timed out waiting for output");
  };
  const downloadImage = async (reference) => {
    const params = new URLSearchParams(imageRef(reference));
    const response = await request(`/view?${params}`);
    assert((response.headers.get("content-type") ?? "").startsWith("image/png"), "output must be PNG");
    const declared = Number(response.headers.get("content-length") ?? 0);
    assert(!declared || declared <= MAX_IMAGE_BYTES, "output image too large");
    const reader = response.body?.getReader();
    assert(reader, "missing image response stream");
    const chunks = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        assert(size <= MAX_IMAGE_BYTES, "output exceeds image byte budget");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks, size);
  };
  /** outputNodeIds maps logical layer roles to explicit SaveImage node IDs. */
  const generate = async ({ workflow, outputNodeIds }) => {
    assert(outputNodeIds && typeof outputNodeIds === "object" && !Array.isArray(outputNodeIds) &&
      Object.keys(outputNodeIds).length >= 1 && Object.keys(outputNodeIds).length <= 6 &&
      Object.values(outputNodeIds).every((value) => /^\d{1,8}$/u.test(String(value))), "invalid output node mapping");
    await health();
    const queued = await queue(workflow);
    const outputs = await waitForOutput(queued.promptId);
    const images = {};
    for (const [role, nodeId] of Object.entries(outputNodeIds)) {
      const nodeImages = outputs[String(nodeId)]?.images;
      assert(Array.isArray(nodeImages) && nodeImages.length === 1, `expected exactly one image for ${role}`);
      images[role] = await downloadImage(nodeImages[0]);
    }
    return { ...queued, images };
  };
  return { health, queue, history, waitForOutput, downloadImage, generate };
}
