/** Explicit-click, resumable discovery worker. Canonical run state lives in Rust SQLite. */
import { generateDiscoveryCandidates } from "./discovery-candidates.mjs";
import { searchStudioSources } from "./studio-search.mjs";
import { configuredSearchEndpoint } from "./local-search-config.mjs";
import { fetchPublicPage, extractPageText } from "./research-agent.mjs";
import { extractGraphBatch } from "./graph-extractor.mjs";
import { normalizeDiscoveryModels } from "./discovery-models.mjs";

const ID=/^[a-z0-9][a-z0-9-]{1,79}$/iu;
const RUN=/^discover_[a-f0-9]{24}$/u;
const SESSION=/^session_[a-f0-9]{24}$/u;
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
    Object.keys(input).some(x=>!["projectId","projectName","description","content","sessionId","resultBudget"].includes(x)))
    throw Error("Discovery request contains unsupported fields.");
  if(!ID.test(input.projectId)||typeof input.projectName!=="string"||input.projectName.length>160||
    typeof input.description!=="string"||input.description.length>2000||
    (input.content!==undefined&&(!Array.isArray(input.content)||input.content.length>2000))||
    (input.sessionId!==undefined&&!SESSION.test(input.sessionId))||
    (input.resultBudget!==undefined&&(!Number.isInteger(input.resultBudget)||input.resultBudget<3||input.resultBudget>30)))
    throw Error("Invalid project discovery request.");
  return {projectId:input.projectId,projectName:input.projectName,description:input.description,
    ...(input.sessionId?{sessionId:input.sessionId}:{}),
    ...(input.sessionId?{resultBudget:input.resultBudget??12}:{}),
    content:(input.content??[]).slice(0,300).map(c=>({name:String(c.name??"").slice(0,160),stage:String(c.stage??"").slice(0,40)}))};
}

function intentTerms(value){
  return new Set(String(value??"").toLowerCase().split(/[^\p{L}\p{N}]+/u)
    .filter(term=>term.length>=3&&!new Set(["the","and","for","with","that","this","about","including","costs"]).has(term))
    .map(term=>term.endsWith("ies")?term.slice(0,-3)+"y":term.endsWith("es")?term.slice(0,-2):
      term.endsWith("s")?term.slice(0,-1):term));
}

const SEARCH_STOP_WORDS=new Set(["a","about","an","and","are","at","by","can","content","covering","explain",
  "explaining","for","from","guide","how","including","into","is","of","on","or","the","their","this",
  "through","to","understand","understanding","video","videos","what","when","why","with"]);
function descriptionQueries(description){
  const words=String(description??"").match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu)??[];
  const terms=words.filter(word=>word.length>=3&&!SEARCH_STOP_WORDS.has(word.toLowerCase()));
  const keywordQuery=terms.slice(0,10).join(" ").slice(0,180).trim();
  const naturalQuery=String(description??"").replace(/\s+/gu," ").trim().slice(0,180);
  return [...new Set([keywordQuery,naturalQuery].filter(query=>query.length>=6))];
}

/** Project DESCRIPTION decides query relevance; brand names are not split into generic tokens. */
export function selectDiscoveryQueries(keywords,_projectName,description){
  const active=keywords.filter(keyword=>keyword.active&&keyword.kind!=="exclusion");
  const intent=intentTerms(description);
  const ranked=active.map((keyword,index)=>{
    const overlap=[...intentTerms(keyword.text)].filter(term=>intent.has(term)).length;
    return {keyword,index,overlap,score:overlap*10+(keyword.kind==="query"?2:0)+(keyword.origin==="manual"?1:0)};
  });
  const relevant=ranked.some(entry=>entry.overlap>0)?ranked.filter(entry=>entry.overlap>0):ranked;
  const selected=relevant.sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,2).map(entry=>entry.keyword.text);
  return selected.length?selected:descriptionQueries(description).slice(0,2);
}

export function isRelevantDiscoveryLead(lead,query,exclusions=[]){
  const text=intentTerms(`${lead.title??""} ${lead.snippet??""}`);
  if(exclusions.some(exclusion=>[...intentTerms(exclusion)].some(term=>text.has(term))))return false;
  const queryTerms=intentTerms(query);
  const overlap=[...queryTerms].filter(term=>text.has(term));
  const informative=overlap.filter(term=>!["home","house","cost","price","video","math","financial"].includes(term));
  return informative.length>=1||overlap.length>=2;
}

async function capturePublicLead(lead,signal){
  const page=await fetchPublicPage(lead.url,{signal});
  const text=extractPageText(page.html,page.type);
  return text.length>=60?text.slice(0,10000):null;
}

export function createDiscoveryJobManager({backend:callBackend=backend,generate=generateDiscoveryCandidates,
  search=searchStudioSources,capture=capturePublicLead,extract=extractGraphBatch,
  searchEndpoint=configuredSearchEndpoint}={}) {
  const active=new Map();
  const execute=async(input,run,models,controller)=>{
    const {projectId}=input,runId=run.id,signal=controller.signal;
    const checkpoint=(stage,providerHealth)=>callBackend(projectId,`runs/${runId}/checkpoint`,"POST",{stage,providerHealth},signal);
    const snapshot=run.inputSnapshot;
    const durable=snapshot?.version===1;
    const saved=async key=>durable?(await callBackend(projectId,`runs/${runId}/artifacts/${key}`,"GET",undefined,signal)).artifact:null;
    const preserve=async(key,artifact)=>durable?(await callBackend(projectId,`runs/${runId}/artifacts/${key}`,"POST",{artifact},signal)).artifact:artifact;
    const finishCandidates=async candidateInput=>{
      await checkpoint("analyze_evidence");
      let candidates=await generate(candidateInput,{modelSettings:models,signal,
        readBatch:async index=>saved(`candidate-batch:${index}`),
        saveBatch:async(index,rows)=>preserve(`candidate-batch:${index}`,rows)});
      candidates=await preserve("candidate-pool",candidates);
      await checkpoint("dedupe_rank");
      await callBackend(projectId,`runs/${runId}/finish`,"POST",{
        status:candidates.length?"completed":"insufficient_evidence",candidates,
      },signal);
    };
    try {
      if(snapshot?.version===0)throw Error("Discovery run predates immutable snapshots; start a new discovery run.");
      if(durable){
        input={...input,projectName:snapshot.projectName,description:snapshot.description,
          content:snapshot.content};
        const priorPool=await saved("candidate-pool");
        if(Array.isArray(priorPool)){
          await checkpoint("dedupe_rank");
          await callBackend(projectId,`runs/${runId}/finish`,"POST",{
            status:priorPool.length?"completed":"insufficient_evidence",candidates:priorPool,
          },signal);
          return;
        }
        const candidateInput=await saved("candidate-input");
        if(candidateInput){await finishCandidates(candidateInput);return;}
      }
      await checkpoint("select_topics");
      const [currentKeywords,initialGraph]=await Promise.all([
        durable?Promise.resolve({keywords:snapshot.keywords}):callBackend(projectId,"keywords","GET",undefined,signal),
        callBackend(projectId,"graph","GET",undefined,signal)]);
      const keywords=currentKeywords.keywords,graphAtStart=initialGraph;
      let graph=graphAtStart;
      const providerHealth={googleTrends:"unavailable: official API access not configured",
        youtube:"cached observations when linked watchlists have collected",
        news:"local SearXNG not configured (search leads would be unverified)"};
      await checkpoint("refresh_sources",providerHealth);
      const accepted=keywords.filter(keyword=>keyword.active&&keyword.kind!=="exclusion");
      const capturedThisRun=new Map();
      if(accepted.length)await callBackend(projectId,"graph/batches","POST",{
        nodes:accepted.slice(0,30).map(keyword=>({kind:keyword.kind==="query"?"question":"topic",label:keyword.text})),edges:[],
      },signal);
      await callBackend(projectId,"graph/import-market","POST",{},signal);
      const focusedQueries=selectDiscoveryQueries(keywords,input.projectName,input.description);
      const searchQueries=[...new Set([...focusedQueries,...descriptionQueries(input.description)])].slice(0,4);
      const exclusions=keywords.filter(keyword=>keyword.active&&keyword.kind==="exclusion").map(keyword=>keyword.text);
      if(searchEndpoint()&&searchQueries.length) {
        let imported=0,searchAttempts=0,relevantLeads=0,captureAttempts=0,successfulCaptures=0;
        let searchUnavailable=false;
        for(const [queryIndex,query] of searchQueries.entries()){
          // Broaden only when the first focused searches found no capturable passage.
          if(queryIndex>=focusedQueries.length&&capturedThisRun.size>0)break;
          if(imported>=20)break;
          try{
            const cacheKey=`source-query:${queryIndex}`;
            let sources=await saved(cacheKey);
            if(!sources){
              // Reserve the request before contacting a quota-limited provider.
              // If interrupted between reservation and capture, preserve prior
              // sources and report the uncertainty instead of silently rerunning.
              if(await saved(`source-attempt:${queryIndex}`)){
                providerHealth.news="Prior search was interrupted; restart with a new explicit discovery to retry.";
                continue;
              }
              await preserve(`source-attempt:${queryIndex}`,{query,started:true});
              searchAttempts++;
              const result=await search({title:input.projectName,viewerQuestion:query,audience:"Interested learners",
                locale:"en-US"},{signal});
              sources=[];
              const relevant=result.results.filter(item=>isRelevantDiscoveryLead(item,query,exclusions))
                .slice(0,Math.min(8,20-imported));
              relevantLeads+=relevant.length;
              for(const lead of relevant){
                let passage=null;
                // Explicit creator click only. Bounded HTTPS capture has SSRF,
                // redirect, timeout, content-type and response-size guards.
                if(captureAttempts<6&&successfulCaptures<2){
                  captureAttempts++;
                  try{passage=await capture(lead,signal);if(passage)successfulCaptures++;}
                  catch(error){
                    if(signal.aborted)throw error;
                    console.warn("[contentgen-discovery-capture]",JSON.stringify({runId,errorCode:safeError(error)}));
                  }
                }
                sources.push({url:lead.url,title:lead.title,provider:"searxng",
                  publishedAt:null,observedAt:Math.floor(Date.now()/1000),passage});
              }
              sources=await preserve(cacheKey,sources);
            }
            for(const source of sources)if(source.passage)capturedThisRun.set(source.url,source.passage);
            if(sources.length)await callBackend(projectId,"sources/import","POST",{sources},signal);
            imported+=sources.length;
          }catch(error){
            if(signal.aborted)throw error;
            console.warn("[contentgen-discovery-search]",JSON.stringify({runId,errorCode:safeError(error)}));
            if(/SearXNG.*(?:unavailable|disabled)|ECONNREFUSED|fetch failed/iu.test(String(error?.message??""))){
              searchUnavailable=true;
              break;
            }
          }
        }
        providerHealth.news=searchUnavailable?
          "local SearXNG unavailable or JSON search disabled. Run pnpm --dir apps/web research:up, then research:check.":
          `${searchAttempts} searches; ${relevantLeads} relevant leads; ${successfulCaptures} captured passages; ${imported} leads imported`;
      }
      await checkpoint("analyze_signals",providerHealth);
      graph=await callBackend(projectId,"graph","GET",undefined,signal);
      // The graph overview intentionally omits long passages. Fetch a bounded
      // local-only evidence snapshot so later explicit clicks can reuse prior
      // captures, including after the Node worker has restarted.
      const stored=await callBackend(projectId,"sources/captured","POST",{},signal);
      const storedCaptures=(stored?.sources??[]).filter(source=>
        typeof source.id==="string"&&typeof source.passage==="string"&&source.passage.length>=60).slice(0,8);
      const storedPassages=new Map(storedCaptures.map(source=>[source.id,source.passage.slice(0,10000)]));
      // The overview is paginated: an older verified capture can fall outside
      // its newest-source window. The protected captured-source endpoint also
      // returns its metadata so those passages remain useful after restart.
      const eligibleGraphSources=()=>{
        const seen=new Set();
        return [...storedCaptures.filter(source=>typeof source.url==="string"&&typeof source.title==="string"&&
          typeof source.provider==="string").map(({passage,...source})=>source),...(graph.sources??[])]
          .filter(source=>{if(seen.has(source.id))return false;seen.add(source.id);return true;});
      };
      const captured=eligibleGraphSources().map(source=>({...source,
        passage:capturedThisRun.get(source.url)??storedPassages.get(source.id)??null})).filter(source=>source.evidenceState==="captured"&&
        typeof source.passage==="string"&&source.passage.length>=60).slice(0,4);
      if(captured.length){
        await checkpoint("extract_graph",providerHealth);
        let extracted=0;
        for(let index=0;index<captured.length;index+=2){
          try{
            const indexKey=index/2;
            if(await saved(`graph-batch:${indexKey}`))continue;
            let batch=await saved(`graph-proposal:${indexKey}`);
            if(!batch){
              batch=await extract({projectName:input.projectName,description:input.description,
                sources:captured.slice(index,index+2)},{modelSettings:models,signal});
              batch=await preserve(`graph-proposal:${indexKey}`,batch);
            }
            if(batch.nodes.length||batch.edges.length){
              await callBackend(projectId,"graph/batches","POST",batch,signal);
              extracted+=batch.edges.length;
            }
            await preserve(`graph-batch:${indexKey}`,{complete:true});
          }catch(error){
            if(signal.aborted)throw error;
            console.warn("[contentgen-discovery-graph]",JSON.stringify({runId,errorCode:safeError(error)}));
          }
        }
        providerHealth.graphExtraction=`${extracted} source-linked relationships extracted from captured passages`;
        graph=await callBackend(projectId,"graph","GET",undefined,signal);
      }
      // Search links are leads, not citations. Only captured passages or actual
      // dated public video observations may support an opportunity candidate.
      const measured=new Set((graph.signals??[]).filter(observation=>observation.value!==null&&
        Number.isFinite(observation.value)&&observation.provider!=="searxng").map(observation=>observation.sourceId));
      const eligibleSources=eligibleGraphSources().filter(source=>source.evidenceState==="captured"||
        (source.provider==="youtube-data-api"&&measured.has(source.id)));
      if(!eligibleSources.length){
        providerHealth.evidence="Search leads alone are unverified; no captured passages or measured public video signals.";
        await checkpoint("analyze_evidence",providerHealth);
        await callBackend(projectId,`runs/${runId}/finish`,"POST",{status:"insufficient_evidence",candidates:[]},signal);
        return;
      }
      const selectedSources=eligibleSources.slice(0,input.sessionId?24:12);
      const sourceIds=new Set(selectedSources.map(source=>source.id));
      const candidateInput=await preserve("candidate-input",{projectName:input.projectName,
        description:input.description,keywords:keywords.filter(keyword=>keyword.active).slice(0,30),
        ...(input.sessionId?{sessionId:input.sessionId,resultBudget:input.resultBudget}:{}),
        graph:{nodes:(graph.nodes??[]).slice(0,40),sources:selectedSources,
          signals:(graph.signals??[]).filter(signal=>sourceIds.has(signal.sourceId)).slice(0,60)},
        content:input.content.slice(0,35)});
      // Each small model batch is checkpointed independently. The Rust server
      // still verifies every cited source and prior idea decision transactionally.
      await finishCandidates(candidateInput);
    } catch(error) {
      if(!signal.aborted) {
        const code=safeError(error);
        console.warn("[contentgen-discovery-job]",JSON.stringify({runId,stage:"failed",errorCode:code}));
        try{await callBackend(projectId,`runs/${runId}/fail`,"POST",{code});}catch{/* server may be offline */}
      }
    }
  };
  const start=(input,run,models)=>{
    // A brand may have multiple independent saved sessions in flight. Legacy
    // project-only runs retain their original single-worker behavior.
    const key=input.sessionId??input.projectId;
    const old=active.get(key);
    if(old?.id===run.id)return;
    if(old)old.controller.abort(Error("Superseded by a new explicit discovery run."));
    const controller=new AbortController();active.set(key,{id:run.id,controller});
    queueMicrotask(()=>{void execute(input,run,models,controller).finally(()=>{
      if(active.get(key)?.id===run.id)active.delete(key);
    });});
  };
  async function create(raw,modelSettings) {
    const input=validateInput(raw);
    const models=normalizeDiscoveryModels(modelSettings);
    const route=input.sessionId?`sessions/${input.sessionId}/discover`:"discover";
    const run=await callBackend(input.projectId,route,"POST",{inputRevision:new Date().toISOString()});
    if(["queued","running"].includes(run.status))start(input,run,models);
    return run;
  }
  async function get(projectId,runId) {
    if(!RUN.test(runId))throw Error("Invalid discovery run ID.");
    const run=await callBackend(projectId,`runs/${runId}`,"GET");
    if(["queued","running"].includes(run.status)&&![...active.values()].some(task=>task.id===runId)) {
      return callBackend(projectId,`runs/${runId}/pause`,"POST",{});
    }
    return run;
  }
  async function list(projectId) {return callBackend(projectId,"runs","GET");}
  async function resume(raw,runId,settings) {
    const input=validateInput(raw);
    if(!RUN.test(runId))throw Error("Invalid discovery run ID.");
    const model=normalizeDiscoveryModels(settings);
    if(input.sessionId){
      // Resume is keyed by run ID on the legacy Rust endpoint. Verify its
      // session ownership before that mutating call or a stale UI tab could
      // resume another session's work with the wrong budget and context.
      const existing=await callBackend(input.projectId,`runs/${runId}`,"GET");
      if(existing.sessionId!==input.sessionId)
        throw Error("This run belongs to a different discovery session. Reopen its original session.");
    }
    const run=await callBackend(input.projectId,`runs/${runId}/resume`,"POST",{});
    start(input,run,model);return run;
  }
  async function cancel(projectId,runId) {
    if(!ID.test(projectId)||!RUN.test(runId))throw Error("Invalid discovery cancellation target.");
    for(const task of active.values())if(task.id===runId)task.controller.abort(Error("Discovery cancelled by creator."));
    return callBackend(projectId,`runs/${runId}/cancel`,"POST",{});
  }
  return {create,get,list,resume,cancel};
}
export const discoveryJobManager=createDiscoveryJobManager();

