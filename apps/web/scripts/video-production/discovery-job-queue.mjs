/** Explicit-click, resumable discovery worker. Canonical run state lives in Rust SQLite. */
import { generateDiscoveryCandidates } from "./discovery-candidates.mjs";
import { validateResearchModelSettings } from "./research-model-settings.mjs";
import { searchStudioSources } from "./studio-search.mjs";
import { configuredSearchEndpoint } from "./local-search-config.mjs";

const ID=/^[a-z0-9][a-z0-9-]{1,79}$/iu;
const RUN=/^discover_[a-f0-9]{24}$/u;
const defaultApi=process.env.CONTENTGEN_LOCAL_API_URL??"http://127.0.0.1:8787";
function endpoint() {
  const parsed=new URL(defaultApi);
  if(parsed.protocol!=="http:"||!["localhost","127.0.0.1","[::1]"].includes(parsed.hostname)||
    parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=="/")
    throw Error("Discovery API must be an HTTP loopback server.");
  return parsed.origin;
}
async function backend(projectId,route,method="GET",body,signal) {
  if(!ID.test(projectId)||route.includes(".."))throw Error("Invalid discovery project identifier.");
  const response=await fetch(`${endpoint()}/api/research/discovery/projects/${encodeURIComponent(projectId)}/${route}`,{
    method,headers:{...(method==="GET"?{}:{"X-Contentgen-Discovery":"local-only","Content-Type":"application/json"})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok)throw Error(data?.error?.message??`Local discovery API returned HTTP ${response.status}.`);
  return data;
}
function safeError(error) {
  const detail=String(error?.message??"");
  return /timed out|timeout|aborted/iu.test(detail)?"model_timeout":
    /invalid|schema|json|structured|source|candidate/iu.test(detail)?"invalid_output":
      /429|50\d|ECONN|fetch failed|network/iu.test(detail)?"provider_unavailable":"stage_failed";
}
function validateInput(input) {
  if(!input||typeof input!=="object"||Array.isArray(input)||
    Object.keys(input).some(x=>!["projectId","projectName","description","content"].includes(x)))
    throw Error("Discovery request contains unsupported fields.");
  if(!ID.test(input.projectId)||typeof input.projectName!=="string"||input.projectName.length>160||
    typeof input.description!=="string"||input.description.length>2000||
    (input.content!==undefined&&(!Array.isArray(input.content)||input.content.length>2000)))
    throw Error("Invalid project discovery request.");
  return {projectId:input.projectId,projectName:input.projectName,description:input.description,
    content:(input.content??[]).slice(0,300).map(c=>({name:String(c.name??"").slice(0,160),stage:String(c.stage??"").slice(0,40)}))};
}

export function createDiscoveryJobManager({backend:callBackend=backend,generate=generateDiscoveryCandidates,
  search=searchStudioSources,searchEndpoint=configuredSearchEndpoint}={}) {
  const active=new Map();
  const execute=async(input,runId,models,controller)=>{
    const {projectId}=input,signal=controller.signal;
    const checkpoint=(stage,providerHealth)=>callBackend(projectId,`runs/${runId}/checkpoint`,"POST",{stage,providerHealth},signal);
    try {
      await checkpoint("select_topics");
      let [{keywords},graph]=await Promise.all([
        callBackend(projectId,"keywords","GET",undefined,signal),
        callBackend(projectId,"graph","GET",undefined,signal)]);
      const providerHealth={googleTrends:"unavailable: official API access not configured",
        youtube:"cached observations when linked watchlists have collected",
        news:"local SearXNG not configured (search leads would be unverified)"};
      await checkpoint("refresh_sources",providerHealth);
      const accepted=keywords.filter(keyword=>keyword.active&&keyword.kind!=="exclusion");
      if(accepted.length)await callBackend(projectId,"graph/batches","POST",{
        nodes:accepted.slice(0,30).map(keyword=>({kind:keyword.kind==="query"?"question":"topic",label:keyword.text})),edges:[],
      },signal);
      await callBackend(projectId,"graph/import-market","POST",{},signal);
      const focusedQueries=keywords.filter(keyword=>keyword.active&&keyword.kind!=="exclusion")
        .slice(0,2).map(keyword=>keyword.text);
      if(searchEndpoint()&&focusedQueries.length) {
        let imported=0;
        for(const query of focusedQueries){
          try{
            const snapshot=await search({title:input.projectName,viewerQuestion:query,audience:"Interested learners",
              locale:"en-US"},{signal});
            const sources=snapshot.results.map(result=>({url:result.url,title:result.title,provider:"searxng",
              publishedAt:null,observedAt:Math.floor(Date.now()/1000),passage:null}));
            if(sources.length)await callBackend(projectId,"sources/import","POST",{sources},signal);
            imported+=sources.length;
          }catch(error){
            console.warn("[contentgen-discovery-search]",JSON.stringify({runId,errorCode:safeError(error)}));
          }
        }
        providerHealth.news=imported?`found ${imported} unverified public search leads`:
          "local SearXNG returned no usable results";
      }
      await checkpoint("analyze_signals",providerHealth);
      graph=await callBackend(projectId,"graph","GET",undefined,signal);
      // Nothing generated without real source metadata. No quota calls or fake signals.
      if(!graph.sources?.length) {
        await callBackend(projectId,`runs/${runId}/finish`,"POST",{status:"insufficient_evidence",candidates:[]},signal);
        return;
      }
      await checkpoint("analyze_evidence");
      const candidates=await generate({projectName:input.projectName,description:input.description,
        keywords:keywords.filter(keyword=>keyword.active),graph,content:input.content},
        {modelSettings:models,signal});
      await checkpoint("dedupe_rank");
      // Rust verifies each source ID, semantic coverage and prior decisions transactionally.
      await callBackend(projectId,`runs/${runId}/finish`,"POST",{
        status:candidates.length?"completed":"insufficient_evidence",candidates,
      },signal);
    } catch(error) {
      if(!signal.aborted) {
        const code=safeError(error);
        console.warn("[contentgen-discovery-job]",JSON.stringify({runId,stage:"failed",errorCode:code}));
        try{await callBackend(projectId,`runs/${runId}/fail`,"POST",{code});}catch{/* server may be offline */}
      }
    }
  };
  const start=(input,run,models)=>{
    if(active.has(input.projectId))return;
    const controller=new AbortController();active.set(input.projectId,{id:run.id,controller});
    queueMicrotask(()=>{void execute(input,run.id,models,controller).finally(()=>active.delete(input.projectId));});
  };
  async function create(raw,modelSettings) {
    const input=validateInput(raw);
    if(!modelSettings?.model)throw Error("Choose an installed local research model in Settings.");
    const models=validateResearchModelSettings({...modelSettings,version:1});
    const run=await callBackend(input.projectId,"discover","POST",{inputRevision:new Date().toISOString()});
    if(["queued","running"].includes(run.status))start(input,run,models);
    return run;
  }
  async function get(projectId,runId) {
    if(!RUN.test(runId))throw Error("Invalid discovery run ID.");
    const run=await callBackend(projectId,`runs/${runId}`,"GET");
    if(["queued","running"].includes(run.status)&&!active.has(projectId)) {
      return callBackend(projectId,`runs/${runId}/pause`,"POST",{});
    }
    return run;
  }
  async function list(projectId) {return callBackend(projectId,"runs","GET");}
  async function resume(raw,runId,settings) {
    const input=validateInput(raw);
    if(!RUN.test(runId))throw Error("Invalid discovery run ID.");
    const model=validateResearchModelSettings({...settings,version:1});
    const run=await callBackend(input.projectId,`runs/${runId}/resume`,"POST",{});
    start(input,run,model);return run;
  }
  return {create,get,list,resume};
}
export const discoveryJobManager=createDiscoveryJobManager();
