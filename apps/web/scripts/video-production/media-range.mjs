/** Serve a local MP4 to the Studio's video player, with byte ranges for seeking. */
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";

/** Stream a regular, non-empty file (never a link) as video/mp4; a bad range is a JSON 416. */
export async function sendVideo(req, res, path, headers = {}) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size === 0) throw Error("Video output is missing.");
  const refuse = (error) => {
    res.writeHead(416, { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Range": `bytes */${info.size}` });
    res.end(JSON.stringify({ error }));
  };
  let start = 0, end = info.size - 1, code = 200;
  if (req.headers.range) {
    const match = /^bytes=(\d+)-(\d*)$/u.exec(req.headers.range);
    if (!match) { refuse("Unsupported video byte range."); return; }
    start = Number(match[1]); end = match[2] ? Number(match[2]) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= info.size) { refuse("Video byte range outside file."); return; }
    code = 206;
  }
  res.writeHead(code, { ...headers, "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
    "Content-Length": end - start + 1, ...(code === 206 ? { "Content-Range": `bytes ${start}-${end}/${info.size}` } : {}) });
  createReadStream(path, { start, end }).on("error", () => res.destroy()).pipe(res);
}
