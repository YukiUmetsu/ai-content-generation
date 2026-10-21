/**
 * Local creative-fixture server for the packaging panel.
 *
 * The set served from `fixtures/packaging-set.json` is illustrative and
 * synthetic. It is derived from the documented house-cost scenario, is not a
 * market observation, and must never be presented as a published performance
 * claim. The current backend registers `GET /api/creative/packaging` but
 * answers 501, so this server exists only for local QA.
 *
 * Dependency-free Node HTTP server; loopback only.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HOST = process.env.FIXTURE_HOST ?? "127.0.0.1";
const PORT = Number.parseInt(process.env.FIXTURE_PORT ?? "8789", 10);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

if (!LOOPBACK_HOSTS.has(HOST)) {
  console.error(
    `Refusing to bind ${HOST}: the fixture server is loopback-only.`,
  );
  process.exit(1);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Invalid FIXTURE_PORT: ${process.env.FIXTURE_PORT}`);
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "..", "fixtures", "packaging-set.json");

let body;
try {
  body = readFileSync(fixturePath, "utf8");
  JSON.parse(body);
} catch (error) {
  console.error(`Could not read the packaging fixture at ${fixturePath}:`, error);
  process.exit(1);
}

function sendJson(response, status, payload) {
  const text = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${HOST}`);
  if (url.pathname !== "/api/creative/packaging") {
    sendJson(response, 404, {
      error: {
        code: "not_found",
        message: "The local fixture server only serves the creative packaging set.",
      },
    });
    return;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, {
      error: {
        code: "method_not_allowed",
        message: "The local fixture server only answers GET for this route.",
      },
    });
    return;
  }
  response.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
});

server.on("error", (error) => {
  console.error(
    `Fixture server could not listen on ${HOST}:${PORT}: ${error.message}`,
  );
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(
    `Creative packaging fixture (illustrative, synthetic) on http://${HOST}:${PORT}/api/creative/packaging`,
  );
});
