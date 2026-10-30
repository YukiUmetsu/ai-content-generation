/** Real pinned Kumiki MediaDocument -> SVG -> FFmpeg PNG thumbnail export.
 * This uses no browser mocks, API credentials, network traffic or paid service.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {readFileSync} from "node:fs";
import {mkdir,mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {promisify} from "node:util";
import {generateProductionThumbnails} from "./premium-thumbnails.mjs";

const run=promisify(execFile);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const root=await mkdtemp(join(tmpdir(),"contentgen-real-thumbnails-"));
try{
  const job=JSON.parse(readFileSync(new URL("../../../../examples/video-production-general-smoke.json",import.meta.url)));
  await Promise.all(["first","second"].map(name=>mkdir(join(root,name),{mode:0o700})));
  const first=await generateProductionThumbnails(job,{outputDir:join(root,"first"),
    cacheDir:join(root,"cache")});
  assert.equal(first.length,3);
  assert.equal(new Set(first.map(item=>item.sha256)).size,3,
    "the three concepts must produce visually distinct PNG byte streams");
  assert.equal(new Set(first.map(item=>item.headline)).size,3,
    "the three concepts need different script-grounded messages");
  for(const concept of first){
    const bytes=await readFile(join(root,"first",concept.file));
    assert.equal(bytes.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(bytes.readUInt32BE(16),1280);
    assert.equal(bytes.readUInt32BE(20),720);
    assert.equal(sha(bytes),concept.sha256);
    const source=await readFile(join(root,"first",concept.source));
    assert.equal(sha(source),concept.sourceSha256);
    const {stdout}=await run("ffprobe",["-v","error","-select_streams","v:0",
      "-show_entries","stream=codec_name,width,height","-of","json",
      join(root,"first",concept.file)],{timeout:30000});
    const stream=JSON.parse(stdout).streams?.[0];
    assert.equal(stream?.width,1280);
    assert.equal(stream?.height,720);
  }
  // A retry independently exports verified prior concepts without rendering
  // again or depending on another draft's output directory.
  const second=await generateProductionThumbnails(job,{outputDir:join(root,"second"),
    cacheDir:join(root,"second-cache"),reuseCacheDir:join(root,"cache"),
    convert:()=>{throw Error("A verified cached concept must not be rerendered.");}});
  assert.deepEqual(second.map(item=>item.sha256),first.map(item=>item.sha256));
  process.stdout.write("PASS: three distinct real Kumiki thumbnail PNGs (1280x720), SVG hashes, FFprobe and SHA-verified reuse.\n");
}finally{await rm(root,{recursive:true,force:true});}
