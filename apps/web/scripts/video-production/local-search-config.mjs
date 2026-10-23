/** Shared ContentGen local search configuration. .env is ignored and contains the private secret. */
import { randomBytes, randomInt } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const COMPOSE_FILE = fileURLToPath(new URL("../../../../tools/searxng/compose.yaml", import.meta.url));
export const SECRET_FILE = resolve(dirname(COMPOSE_FILE), ".env");
export function parseLocalSearchConfig(source) {
  if (typeof source !== "string") throw Error("Missing local search configuration.");
  const values = new Map();
  for (const line of source.trim().split("\n")) {
    const match = /^(SEARXNG_SECRET|SEARXNG_PORT)=([a-zA-Z0-9]+)$/u.exec(line);
    if (!match || values.has(match[1])) throw Error("Invalid local search .env; inspect it manually.");
    values.set(match[1], match[2]);
  }
  if (!/^[a-f0-9]{64}$/u.test(values.get("SEARXNG_SECRET") ?? ""))
    throw Error("Local search secret is invalid.");
  const port = Number(values.get("SEARXNG_PORT"));
  if (!Number.isInteger(port) || port < 20000 || port > 60999)
    throw Error("Local search port is missing or invalid; run pnpm research:up.");
  return { port, endpoint: "http://127.0.0.1:" + port + "/search" };
}
export function configuredSearchEndpoint(file = SECRET_FILE) {
  try { return parseLocalSearchConfig(readFileSync(file, "utf8")).endpoint; }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
export function localSearchUrl(config) { return "http://127.0.0.1:" + config.port; }
export async function portIsAvailable(port) {
  return await new Promise(resolve => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
export async function chooseLocalPort({ random = randomInt, available = portIsAvailable } = {}) {
  for (let i = 0; i < 30; i++) {
    const candidate = random(20000, 61000);
    if (Number.isInteger(candidate) && candidate >= 20000 && candidate <= 60999 &&
      await available(candidate)) return candidate;
  }
  throw Error("Could not find a free local search port.");
}
/** Never silently replace the secret or move an existing search service. */
export async function ensureLocalSearchConfig({ file = SECRET_FILE, random = randomBytes, pickPort = chooseLocalPort } = {}) {
  try {
    const data = await readFile(file, "utf8");
    try { return { ...parseLocalSearchConfig(data), created: false }; }
    catch {
      // Migrate pre-port .env created by the earlier SearXNG setup; preserve its secret.
      const legacy = /^SEARXNG_SECRET=([a-f0-9]{64})\n$/u.exec(data);
      if (!legacy) throw Error("Existing local search .env is unexpected; inspect it manually.");
      const port = await pickPort();
      try {
        await writeFile(file, "SEARXNG_SECRET=" + legacy[1] + "\nSEARXNG_PORT=" + port + "\n", { mode: 0o600, flag: "w" });
      } catch (error) { throw Error("Unable to migrate search config: " + error.message); }
      return { port, endpoint: "http://127.0.0.1:" + port + "/search", created: false };
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const secret = random(32).toString("hex");
  if (!/^[a-f0-9]{64}$/u.test(secret)) throw Error("Invalid generated secret.");
  const port = await pickPort();
  try {
    await writeFile(file, "SEARXNG_SECRET=" + secret + "\nSEARXNG_PORT=" + port + "\n", { flag: "wx", mode: 0o600 });
    return { port, endpoint: "http://127.0.0.1:" + port + "/search", created: true };
  } catch (error) {
    if (error.code === "EEXIST") return ensureLocalSearchConfig({ file, random, pickPort });
    throw error;
  }
}
