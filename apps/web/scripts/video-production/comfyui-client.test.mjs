import test from "node:test";
import assert from "node:assert/strict";
import { createComfyUiClient, validateComfyApiWorkflow, validateLocalComfyUrl } from "./comfyui-client.mjs";

const promptId = "01234567-89ab-cdef-0123-456789abcdef";
const workflow = { "9": { inputs: { filename_prefix: "contentgen" }, class_type: "SaveImage" } };

test("ComfyUI API workflow is explicit and endpoint is loopback-only", () => {
  assert.equal(validateLocalComfyUrl("http://127.0.0.1:8188"), "http://127.0.0.1:8188");
  for (const endpoint of ["https://example.com", "http://192.168.1.2:8188", "file:///tmp/comfy", "http://127.0.0.1:8188/foo"])
    assert.throws(() => validateLocalComfyUrl(endpoint), /loopback/);
  assert.match(validateComfyApiWorkflow(workflow).workflowSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => validateComfyApiWorkflow({ nodes: [{ id: 9 }] }), /API-format/);
});

test("client discovers the exact image through prompt history and /view", async () => {
  const requests = [];
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(input);
    requests.push({ path: url.pathname + url.search, method: options.method ?? "GET", body: options.body });
    if (url.pathname === "/system_stats") return Response.json({ devices: [{ name: "M4" }] });
    if (url.pathname === "/prompt") return Response.json({ prompt_id: promptId });
    if (url.pathname === `/history/${promptId}`) return Response.json({ [promptId]: {
      status: { completed: true }, outputs: { "9": { images: [{ filename: "desk_00001.png", subfolder: "assets", type: "output" }] } },
    } });
    if (url.pathname === "/view") return new Response(Buffer.from("mock image bytes"), { headers: { "Content-Type": "image/png" } });
    return new Response("Not found", { status: 404 });
  };
  const client = createComfyUiClient({ fetchImpl, pollIntervalMs: 10 });
  const result = await client.generate({ workflow, outputNodeIds: { background: "9" } });
  assert.equal(result.promptId, promptId);
  assert.equal(result.images.background.toString(), "mock image bytes");
  const view = new URL(`http://127.0.0.1${requests.find((r) => r.path.startsWith("/view?")).path}`);
  assert.equal(view.searchParams.get("filename"), "desk_00001.png");
  assert.equal(view.searchParams.get("subfolder"), "assets");
  assert.equal(JSON.parse(requests.find((r) => r.path === "/prompt").body).prompt["9"].class_type, "SaveImage");
  await assert.rejects(client.downloadImage({ filename: "../secrets.png", type: "output" }), /unsafe/);
});

test("failed or unfinished generations never return a reviewed visual", async () => {
  const fetchImpl = async () => Response.json({ [promptId]: { status: { completed: false } } });
  const client = createComfyUiClient({ fetchImpl, timeoutMs: 110, pollIntervalMs: 20 });
  await assert.rejects(client.waitForOutput(promptId), /timed out/);
});
