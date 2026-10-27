/** Private, ephemeral static host for the built Kumiki capture page and a validated plan. */
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2",
};

const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
};

/** Fingerprint the actual built HTML and assets a capture page can consume. */
export async function fingerprintBuiltStage(distRoot) {
  const root = await realpath(resolve(distRoot));
  const entries = ["video-export.html"];
  const walk = async (relativePath) => {
    let children;
    try { children = await readdir(join(root, relativePath), { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of children) {
      const file = join(relativePath, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && mime[extname(entry.name).toLowerCase()]) entries.push(file);
    }
  };
  await walk("assets");
  entries.sort();
  if (entries.length > 512) throw new Error("The scene build contains too many served assets.");
  const hash = createHash("sha256");
  let sum = 0;
  for (const file of entries) {
    const actual = await realpath(join(root, file));
    const relativeFile = relative(root, actual);
    if (relativeFile.startsWith("..") || relativeFile.startsWith("/")) throw new Error("Scene build asset escapes the configured directory.");
    const metadata = await stat(actual);
    if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024) throw new Error("Scene build asset is not a bounded file.");
    sum += metadata.size;
    if (sum > 128 * 1024 * 1024) throw new Error("Scene build exceeds its bounded asset budget.");
    hash.update(file.replaceAll("\\", "/") + "\0").update(await readFile(actual));
  }
  return hash.digest("hex");
}

/**
 * @param {{distRoot:string,validatedPlan:object,host?:'127.0.0.1'}} options
 * @returns {Promise<{url:string,close:()=>Promise<void>}>}
 */
export async function startLocalStageServer({ distRoot, validatedPlan, approvedMedia = [], host = "127.0.0.1" }) {
  if (host !== "127.0.0.1") throw new Error("Export stage must bind a loopback-only host.");
  if (typeof distRoot !== "string" || !distRoot.trim() || !validatedPlan || typeof validatedPlan !== "object") {
    throw new Error("A built page directory and validated plan are required.");
  }
  const root = await realpath(resolve(distRoot));
  if (!Array.isArray(approvedMedia) || approvedMedia.length > 60) throw Error("Invalid approved scene media list.");
  const media = new Map();
  for (const asset of approvedMedia) {
    const extension = asset?.assetType === "photo" ? "jpg" : asset?.assetType === "video" ? "mp4" : null;
    if (!extension || !/^[a-f0-9]{64}$/u.test(asset?.sha256 ?? "") ||
      asset.url !== `/__video_media/${asset.sha256}.${extension}` ||
      typeof asset.path !== "string" || !asset.path.startsWith("/") || media.has(asset.url))
      throw Error("Invalid or duplicate approved scene media path.");
    media.set(asset.url, { ...asset, verifiedKey: null });
  }
  const buildHash = await fingerprintBuiltStage(root);
  const entry = await stat(join(root, "video-export.html"));
  if (!entry.isFile()) throw new Error("Built video-export.html is required before starting capture.");
  const json = JSON.stringify(validatedPlan);
  if (Buffer.byteLength(json) > 4 * 1024 * 1024) throw new Error("Export plan exceeds the 4 MiB page data limit.");
  const server = createServer(async (request, response) => {
    const send = (status, data = "Not found", type = "text/plain; charset=utf-8") => {
      response.writeHead(status, { ...securityHeaders, "Content-Type": type });
      response.end(data);
    };
    if (request.method !== "GET") { send(405, "GET only"); return; }
    let pathname;
    try { pathname = new URL(request.url, "http://127.0.0.1").pathname; }
    catch { send(400, "Malformed path"); return; }
    if (pathname === "/__video_job") { send(200, json, mime[".json"]); return; }
    if (pathname === "/__video_build") { send(200, JSON.stringify({ sha256: buildHash }), mime[".json"]); return; }
    if (pathname.startsWith("/__video_media/")) {
      const asset = media.get(pathname);
      if (!asset) { send(404); return; }
      try {
        const metadata = await lstat(asset.path, { bigint: true });
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 12n ||
          metadata.size > 80n * 1024n * 1024n) { send(404); return; }
        const key = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`;
        if (key !== asset.verifiedKey) {
          // Frozen files are immutable during capture. Recheck their checksum
          // only if inode, size or nanosecond modification/change time moves;
          // hashing an 80 MB MP4 for every 30-fps frame is prohibitively slow.
          const contents = await readFile(asset.path);
          if (createHash("sha256").update(contents).digest("hex") !== asset.sha256) { send(404); return; }
          asset.verifiedKey = key;
        }
        const size = Number(metadata.size);
        const type = asset.assetType === "photo" ? "image/jpeg" : "video/mp4";
        let start = 0, end = size - 1, code = 200;
        if (request.headers.range !== undefined) {
          const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range);
          const suffix = /^bytes=-(\d+)$/u.exec(request.headers.range);
          if ((!range && !suffix) || (range && (!Number.isSafeInteger(Number(range[1])) ||
            (range[2] && !Number.isSafeInteger(Number(range[2]))))) ||
            (suffix && (!Number.isSafeInteger(Number(suffix[1])) || Number(suffix[1]) < 1))) {
            response.writeHead(416, { ...securityHeaders, "Content-Range": `bytes */${size}` });
            response.end(); return;
          }
          if (suffix) start = Math.max(0, size - Number(suffix[1]));
          else { start = Number(range[1]); end = range[2] ? Math.min(size - 1, Number(range[2])) : end; }
          if (start > end) {
            response.writeHead(416, { ...securityHeaders, "Content-Range": `bytes */${size}` });
            response.end(); return;
          }
          code = 206;
        }
        response.writeHead(code, { ...securityHeaders, "Content-Type": type, "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
          ...(code === 206 ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) });
        // Stream just the requested portion rather than copying the whole MP4
        // into every response. Errors abort capture instead of serving a
        // truncated, apparently successful video asset.
        createReadStream(asset.path, { start, end }).on("error", () => response.destroy()).pipe(response);
      } catch { send(404); }
      return;
    }
    if (!/^\/(?:assets\/[A-Za-z0-9._/-]+|video-export\.html)$/.test(pathname) || pathname.includes("..")) {
      send(404); return;
    }
    const path = join(root, pathname.slice(1));
    const type = mime[extname(path).toLowerCase()];
    if (!type) { send(404); return; }
    try {
      const actual = await realpath(path);
      const within = relative(root, actual);
      if (within.startsWith("..") || within.startsWith("/") || !within) { send(404); return; }
      const file = await stat(actual);
      if (!file.isFile() || file.size > 32 * 1024 * 1024) { send(404); return; }
      send(200, await readFile(actual), type);
    } catch { send(404); }
  });
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, host, () => { server.off("error", rejectListen); resolveListen(); });
    });
  } catch (error) { server.close(); throw error; }
  const address = server.address();
  return {
    url: `http://${host}:${address.port}/video-export.html`,
    buildHash,
    close: () => new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose())),
  };
}
