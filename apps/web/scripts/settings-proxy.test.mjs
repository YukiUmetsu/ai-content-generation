import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer as createViteServer, loadConfigFromFile } from "vite";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const configPath = fileURLToPath(new URL("../vite.config.ts", import.meta.url));

test("settings proxy retains browser Host and Origin for the Rust credential guard", async () => {
  const upstream = createHttpServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ host: request.headers.host, origin: request.headers.origin }));
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");

  let vite;
  try {
    const upstreamPort = upstream.address().port;
    const previousTarget = process.env.CONTENTGEN_JOBS_ORIGIN;
    let loaded;
    try {
      process.env.CONTENTGEN_JOBS_ORIGIN = `http://127.0.0.1:${upstreamPort}`;
      loaded = await loadConfigFromFile(
        { command: "serve", mode: "test" },
        configPath,
        webRoot,
      );
    } finally {
      if (previousTarget === undefined) delete process.env.CONTENTGEN_JOBS_ORIGIN;
      else process.env.CONTENTGEN_JOBS_ORIGIN = previousTarget;
    }
    assert.ok(loaded, "Vite config must load");

    vite = await createViteServer({
      configFile: false,
      root: webRoot,
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        port: 0,
        proxy: { "/api/settings": loaded.config.server.proxy["/api/settings"] },
      },
    });
    await vite.listen();
    const browserOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const response = await fetch(`${browserOrigin}/api/settings/session`, {
      method: "PUT",
      headers: { Origin: browserOrigin },
    });
    assert.equal(response.status, 200);
    const forwarded = await response.json();
    assert.equal(forwarded.host, new URL(browserOrigin).host);
    assert.equal(forwarded.origin, browserOrigin);
  } finally {
    if (vite) await vite.close();
    upstream.close();
    await once(upstream, "close");
  }
});

test("discovery proxy retains browser Host and Origin for the Rust local API guard", async () => {
  const upstream = createHttpServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ host: request.headers.host, origin: request.headers.origin }));
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");

  let vite;
  try {
    const upstreamPort = upstream.address().port;
    const previousTarget = process.env.CONTENTGEN_RESEARCH_ORIGIN;
    let loaded;
    try {
      process.env.CONTENTGEN_RESEARCH_ORIGIN = `http://127.0.0.1:${upstreamPort}`;
      loaded = await loadConfigFromFile(
        { command: "serve", mode: "test" }, configPath, webRoot,
      );
    } finally {
      if (previousTarget === undefined) delete process.env.CONTENTGEN_RESEARCH_ORIGIN;
      else process.env.CONTENTGEN_RESEARCH_ORIGIN = previousTarget;
    }
    assert.ok(loaded);

    vite = await createViteServer({
      configFile: false,
      root: webRoot,
      logLevel: "silent",
      server: {
        host: "127.0.0.1",
        port: 0,
        proxy: { "/api/research": loaded.config.server.proxy["/api/research"] },
      },
    });
    await vite.listen();
    const browserOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const response = await fetch(`${browserOrigin}/api/research/discovery/projects/sample/sync`, {
      method: "POST",
      headers: { Origin: browserOrigin, "Content-Type": "application/json", "X-Contentgen-Discovery": "local-only" },
      body: JSON.stringify({ id: "sample" }),
    });
    assert.equal(response.status, 200);
    const forwarded = await response.json();
    assert.equal(forwarded.host, new URL(browserOrigin).host);
    assert.equal(forwarded.origin, browserOrigin);
  } finally {
    if (vite) await vite.close();
    upstream.close();
    await once(upstream, "close");
  }
});
