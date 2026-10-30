import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {withSceneClipJob} from "./scene-clip-jobs.mjs";

const input=()=>({shotId:"scene-2",sourceHash:"e".repeat(64),runId:randomUUID()});
function fakeJobs({heartbeatAlive=true}={}){
  const calls=[];
  const fetcher=async (url,opts)=>{
    const path=new URL(url).pathname,body=JSON.parse(opts.body);
    calls.push({path,body});
    const response=path==="/api/jobs"?{created:true,job:{id:"preview-1",state:"RUNNING"},
      nodes:[{id:"node-1",nodeKey:"scene-preview",state:"READY"}]}:
      path.endsWith("/start")?{attempt:{id:"claim-1"}}:
      path.endsWith("/heartbeat")?{alive:heartbeatAlive}:{success:true};
    return {ok:true,json:async()=>response};
  };
  return {calls,fetcher};
}
test("a single storyboard clip has an independently owned, hashed Rust Jobs attempt",async()=>{
  const {calls,fetcher}=fakeJobs();
  const result=await withSceneClipJob(input(),async()=>({shotId:"scene-2",
    sha256:"a".repeat(64),sizeBytes:320}),{fetcher});
  assert.equal(result.jobId,"preview-1");
  assert.equal(calls[0].body.jobKind,"video-render-segment");
  assert.equal(calls[0].body.nodes[0].maxAttempts,3);
  assert.equal(calls[0].body.nodes[0].input.projectId,"unsaved-project");
  assert.equal(calls[0].body.nodes[0].input.shotId,"scene-2");
  assert.ok(calls.some(call=>call.path.endsWith("/start")));
  const complete=calls.find(call=>call.path.endsWith("/succeed"));
  assert.equal(complete.body.attemptId,"claim-1");
  assert.equal(complete.body.output.sha256,"a".repeat(64));
});
test("failed preview records a safe retryable error in Jobs",async()=>{
  const {calls,fetcher}=fakeJobs();
  await assert.rejects(withSceneClipJob(input(),async()=>{throw Error("provider-secret-never-store");},
    {fetcher}),/provider-secret-never-store/u);
  const failed=calls.find(call=>call.path.endsWith("/fail"));
  assert.equal(failed.body.errorCode,"scene_preview_failed");
  assert.doesNotMatch(failed.body.errorDetail,/provider-secret/u);
});
test("cancelling scene preview uses the Rust cancellation transition",async()=>{
  const {calls,fetcher}=fakeJobs(),abort=new AbortController();
  await assert.rejects(withSceneClipJob({...input(),signal:abort.signal},async()=>{
    abort.abort(Error("editor cancelled"));
    throw abort.signal.reason;
  },{fetcher}),/editor cancelled/u);
  assert.ok(calls.some(call=>call.path.endsWith("/cancel")));
  assert.equal(calls.some(call=>call.path.endsWith("/succeed")),false);
});
test("heartbeat loss aborts the clip and never claims an obsolete attempt's success",async()=>{
  const {calls,fetcher}=fakeJobs({heartbeatAlive:false});
  await assert.rejects(withSceneClipJob(input(),async({signal})=>new Promise((_ok,reject)=>{
    signal.addEventListener("abort",()=>reject(signal.reason),{once:true});
  }),{fetcher,heartbeatMs:10}),/lost its Jobs claim/u);
  assert.ok(calls.some(call=>call.path.endsWith("/heartbeat")));
  assert.equal(calls.some(call=>call.path.endsWith("/succeed")),false);
});
