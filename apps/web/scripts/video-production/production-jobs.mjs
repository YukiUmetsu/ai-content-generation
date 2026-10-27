/** Thin worker adapter over Rust's persisted Jobs DAG. This module owns no
 * scheduler, queue, or database: SQLite remains the source of truth. */
import {createHash} from "node:crypto";

export const PRODUCTION_NODES=["scene-plan","visual-planning","narration","timeline",
  "sound-mix","scene-render","final-mux","technical-qa","export-package"];
const phases={"browser-preflight":"visual-planning",narration:"narration",timeline:"timeline",
  audio:"sound-mix",rendering:"scene-render",mux:"final-mux",qa:"technical-qa",review:"export-package"};

export function createProductionJobTracker({origin=process.env.CONTENTGEN_JOBS_ORIGIN??"http://127.0.0.1:8787",
  fetcher=globalThis.fetch}={}){
  const server=new URL(origin);
  if(!["localhost","127.0.0.1"].includes(server.hostname)||server.protocol!=="http:"||
    server.username||server.password||server.pathname!=="/"||server.search||server.hash)
    throw Error("Production jobs require the local Rust server. Set CONTENTGEN_JOBS_ORIGIN to a loopback address.");
  let jobId=null,nodes=[],active=-1,attemptId=null,terminal=null;
  async function request(path,body){
    let response;
    try{
      response=await fetcher(new URL(path,server),{method:body===undefined?"GET":"POST",
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
        headers:{"Content-Type":"application/json","X-Contentgen-Worker":"local-only"},
        signal:AbortSignal.timeout(15_000)});
    }catch(error){throw Error("Jobs service unavailable. Start the local Rust ContentGen server and retry. "+String(error?.message??""));}
    let data;
    try{data=await response.json();}catch{throw Error("Jobs service returned an unreadable response.");}
    if(!response.ok)throw Error(typeof data.error==="string"?data.error:
      data.error?.message??`Jobs service returned HTTP ${response.status}.`);
    return data;
  }
  async function begin(index){
    const node=nodes[index];
    if(!node)throw Error(`Missing production step ${PRODUCTION_NODES[index]}.`);
    const data=await request(`/api/jobs/${jobId}/nodes/${node.id}/start`,{});
    if(typeof data.attempt?.id!=="string")throw Error("Jobs service did not reserve a step attempt.");
    active=index;attemptId=data.attempt.id;
  }
  async function succeed(){
    const node=nodes[active];
    if(!node||!attemptId)throw Error("No production step is reserved.");
    await request(`/api/jobs/${jobId}/nodes/${node.id}/succeed`,{attemptId,output:{completed:true}});
    attemptId=null;
  }
  return {
    get jobId(){return jobId;},
    async start({productionId,revision,runId}){
      if(jobId)throw Error("Production job already started.");
      if(!/^production-[a-f0-9]{24}$/u.test(productionId)||!revision||!runId)
        throw Error("Production job requires a saved production, revision and run identity.");
      const key="video-production:"+createHash("sha256").update(JSON.stringify({productionId,revision})).digest("hex");
      const data=await request("/api/jobs",{jobKind:"video-production",idempotencyKey:key,
        nodes:PRODUCTION_NODES.map((nodeKey,index)=>({nodeKey,nodeKind:`video.${nodeKey}`,
          // The renderer is one synchronous execution. No worker exists to
          // claim an auto-retried attempt after it exits; mark failure terminal
          // instead of leaving a READY node and a permanently RUNNING job.
          maxAttempts:1,input:{productionId,revision},
          dependsOn:index?[PRODUCTION_NODES[index-1]]:[]}))});
      if(data.created!==true)throw Error(data.job?.state==="SUCCEEDED"?
        "A video for this revision already exists. Review its saved MP4 or edit the script to regenerate.":
        "This video is already running or waiting in Jobs. Open Jobs to review or cancel it.");
      if(typeof data.job?.id!=="string"||!Array.isArray(data.nodes)||data.nodes.length!==PRODUCTION_NODES.length)
        throw Error("Jobs service did not return the expected production steps.");
      jobId=data.job.id;nodes=data.nodes;
      await begin(0);
      return jobId;
    },
    async advance(phase){
      if(terminal)throw Error(`Production job has ${terminal}.`);
      const target=PRODUCTION_NODES.indexOf(phases[phase]);
      if(target<0||target<=active)return;
      if(active<0)throw Error("Production job was not started.");
      while(active<target){await succeed();await begin(active+1);}
    },
    async complete(){
      if(terminal)throw Error(`Production job has ${terminal}.`);
      if(active<0)throw Error("Production job was not started.");
      while(active<PRODUCTION_NODES.length-1){await succeed();await begin(active+1);}
      await succeed();terminal="completed";
    },
    async fail(code="render_failed",detail="Video rendering failed"){
      if(terminal||!attemptId)return;
      terminal="failed";
      await request(`/api/jobs/${jobId}/nodes/${nodes[active].id}/fail`,{
        attemptId,errorCode:code.slice(0,80),errorDetail:detail.slice(0,240)});
    },
    async cancel(){
      if(terminal||!jobId)return;
      terminal="cancelled";
      await request(`/api/jobs/${jobId}/cancel`,{});
    },
  };
}
