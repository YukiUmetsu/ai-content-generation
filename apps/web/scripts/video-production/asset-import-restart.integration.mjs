/** Optional real Rust/SQLite restart integration fixture.
 * Run with CONTENTGEN_RUST_BIN=/path/to/contentgen-server node this-file.mjs
 * Local loopback sockets and FFmpeg are required; no provider network is used.
 */
import assert from "node:assert/strict";
import {spawn,execFile} from "node:child_process";
import {once} from "node:events";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {promisify} from "node:util";
import {pathToFileURL} from "node:url";
import {fileURLToPath} from "node:url";
import {withPexelsAssetImportJob} from "./asset-import-jobs.mjs";
import {importDownloadedPexelsAsset,listApprovedAssets} from "./asset-discovery.mjs";

if(!process.env.CONTENTGEN_RUST_BIN){
  process.stderr.write("Set CONTENTGEN_RUST_BIN to the built Rust server for this optional integration test.\n");
  process.exitCode=2;
}else{
  const rust=resolve(process.env.CONTENTGEN_RUST_BIN),root=await mkdtemp(join(tmpdir(),"contentgen-asset-kill-e2e-"));
  const db=join(root,"jobs.sqlite"),assetRoot=join(root,"assets"),jpg=join(root,"original.jpg");
  const serverPort=await new Promise((ok,bad)=>{
    const listener=createServer();listener.on("error",bad);
    listener.listen(0,"127.0.0.1",()=>{const port=listener.address().port;
      listener.close(error=>error?bad(error):ok(port));});
  });
  const origin=`http://127.0.0.1:${serverPort}`;
  let server=null,worker=null;
  const start=async()=>{
    server=spawn(rust,[],{cwd:root,env:{...process.env,CONTENTGEN_DB:db,CONTENTGEN_BIND:`127.0.0.1:${serverPort}`},
      stdio:["ignore","pipe","pipe"]});
    const until=Date.now()+12000;
    while(Date.now()<until){
      if(server.exitCode!==null)throw Error(`Rust server exited prematurely: ${server.exitCode}`);
      try{const response=await fetch(origin+"/healthz",{signal:AbortSignal.timeout(500)});
        if(response.ok)return;}
      catch{/* Wait for SQLite migration and listener. */}
      await new Promise(ok=>setTimeout(ok,60));
    }
    throw Error("Rust server did not start within 12 seconds.");
  };
  const stop=async child=>{
    if(!child||child.exitCode!==null||child.signalCode!==null)return;
    child.kill("SIGTERM");
    await once(child,"exit",{signal:AbortSignal.timeout(5000)});
  };
  const plan=shotId=>({projectId:"project-1",shotId,assetType:"photo",confirmRights:true,
    sourceUrl:`https://www.pexels.com/photo/sample-${shotId==="scene-a"?123456:654321}/`});
  const lookup=metadata=>listApprovedAssets({projectId:metadata.projectId},{root:assetRoot});
  const importer=async(input)=>importDownloadedPexelsAsset(input,await readFile(jpg),{root:assetRoot});
  try{
    await promisify(execFile)("ffmpeg",["-hide_banner","-loglevel","error","-f","lavfi","-i",
      "color=c=blue:s=1280x720","-frames:v","1","-threads","1","-y",jpg],{timeout:30000});
    await start();
    const done=await withPexelsAssetImportJob(plan("scene-a"),{origin,lookup,importer});
    assert.equal(done.reused,false);

    // Kill a *separate* Node worker after its Rust claim, before it writes
    // any media or acknowledges completion. No guessed process-id killing.
    const moduleUrl=pathToFileURL(fileURLToPath(new URL("./asset-import-jobs.mjs",import.meta.url))).href;
    const source=String.raw`import {withPexelsAssetImportJob} from ${JSON.stringify(moduleUrl)};
      const input=JSON.parse(process.env.CONTENTGEN_TEST_INPUT);
      await withPexelsAssetImportJob(input,{origin:process.env.CONTENTGEN_TEST_ORIGIN,
        lookup:async()=>[],importer:async()=>{process.send?.("claimed");await new Promise(()=>{});}});`;
    worker=spawn(process.execPath,["--input-type=module","-e",source],{
      cwd:root,env:{...process.env,CONTENTGEN_TEST_INPUT:JSON.stringify(plan("scene-b")),
        CONTENTGEN_TEST_ORIGIN:origin},stdio:["ignore","pipe","pipe","ipc"]});
    await new Promise((ok,bad)=>{
      const timer=setTimeout(()=>finish(Error("Import worker did not claim within 10 seconds.")),10000);
      const onMessage=message=>{if(message==="claimed")finish();};
      const onExit=()=>finish(Error("Import worker exited before acquiring its claim."));
      function finish(error){clearTimeout(timer);worker.off("message",onMessage);worker.off("exit",onExit);
        if(error)bad(error);else ok();}
      worker.on("message",onMessage);worker.once("exit",onExit);
    });
    const pending=await (await fetch(origin+"/api/jobs")).json();
    assert.equal(pending.jobs.filter(job=>job.jobKind==="video-asset-download"&&job.state==="RUNNING").length,1);
    worker.kill("SIGKILL");await once(worker,"exit");worker=null;
    await stop(server);server=null;
    await start();

    let reusedCalls=0;
    const earlier=await withPexelsAssetImportJob(plan("scene-a"),{origin,lookup,
      importer:async()=>{reusedCalls++;throw Error("Completed work must never redownload");}});
    assert.equal(earlier.reused,true);assert.equal(reusedCalls,0);
    const resumed=await withPexelsAssetImportJob(plan("scene-b"),{origin,lookup,importer});
    assert.equal(resumed.reused,false);
    const jobs=await(await fetch(origin+"/api/jobs")).json();
    const interrupted=jobs.jobs.find(job=>job.id===resumed.jobId);
    assert.equal(interrupted.state,"SUCCEEDED");
    const details=await(await fetch(origin+`/api/jobs/${resumed.jobId}`)).json();
    assert.equal(details.attempts.length,2);
    assert.ok(details.attempts.some(attempt=>attempt.state==="FAILED"&&attempt.errorCode==="orphaned_after_restart"));
    assert.ok(details.attempts.some(attempt=>attempt.state==="SUCCEEDED"));
    const assets=await lookup({projectId:"project-1"});
    assert.equal(assets.length,2);
    assert.equal(assets.find(asset=>asset.shotId==="scene-a").sha256,done.sha256);
    console.log("PASS: worker SIGKILL, Rust restart, verified successful asset reuse, interrupted attempt recovery and two SHA-verified media artifacts.");
  }finally{
    if(worker)await stop(worker).catch(()=>{});
    if(server)await stop(server).catch(()=>{});
    await rm(root,{recursive:true,force:true});
  }
}
