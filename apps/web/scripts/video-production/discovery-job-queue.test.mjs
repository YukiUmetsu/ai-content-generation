import { test } from "node:test";
import assert from "node:assert/strict";
import { createDiscoveryJobManager, selectDiscoveryQueries, isRelevantDiscoveryLead } from "./discovery-job-queue.mjs";

test("a session discovery allocates its run in the saved session before executing the existing research checkpoints",async()=>{
  const sessionId="session_"+"a".repeat(24),runId="discover_"+"b".repeat(24),routes=[];
  let status="queued";
  const manager=createDiscoveryJobManager({
    backend:async(_project,route,method,body)=>{
      routes.push(`${method} ${route}`);
      if(route===`sessions/${sessionId}/discover`)return {id:runId,status:"queued",stage:"queued",inputSnapshot:{version:1,
        projectName:"Margin Atlas",description:"Home costs",keywords:[],content:[],projectRevision:1}};
      if(route==="graph")return {nodes:[],sources:[],signals:[]};
      if(route==="graph/import-market")return {imported:0};
      if(route==="sources/captured")return {sources:[]};
      if(route.endsWith("checkpoint"))return {id:runId,status:"running"};
      if(route.endsWith("finish")){status=body.status;return {id:runId,status};}
      if(route.includes("/artifacts/"))return {artifact:null};
      throw Error(`Unexpected ${method} ${route}`);
    },
    searchEndpoint:()=>null,
  });
  const run=await manager.create({projectId:"brand-one",projectName:"Margin Atlas",description:"Home costs",sessionId},
    {model:"local",endpoint:"http://localhost:1234/v1/chat/completions"});
  assert.equal(run.id,runId);
  for(let i=0;i<35&&status==="queued";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(status,"insufficient_evidence");
  assert.equal(routes[0],`POST sessions/${sessionId}/discover`);
  assert.ok(routes.includes(`POST runs/${runId}/checkpoint`));
  assert.ok(routes.includes(`POST runs/${runId}/finish`));
  assert.equal(routes.includes("POST discover"),false,"Session launch must not create an unlinked legacy run");
});

test("session discovery rejects forged session identifiers before touching the research backend",async()=>{
  let calls=0;
  const manager=createDiscoveryJobManager({backend:async()=>{calls++;return null;}});
  await assert.rejects(()=>manager.create({projectId:"brand-one",projectName:"Margin Atlas",description:"Home costs",
    sessionId:"../other-brand"},{model:"local",endpoint:"http://localhost:1234/v1/chat/completions"}),
  /invalid|unsupported/iu);
  assert.equal(calls,0);
});

test("resuming a run from another saved session is refused before changing backend state",async()=>{
  const expected="session_"+"a".repeat(24),foreign="session_"+"b".repeat(24);
  const runId="discover_"+"c".repeat(24),calls=[];
  const manager=createDiscoveryJobManager({backend:async(_project,route,method)=>{
    calls.push(method+" "+route);
    if(route===`runs/${runId}`)return {id:runId,sessionId:foreign,status:"paused"};
    throw Error("Foreign run must not be resumed");
  }});
  await assert.rejects(manager.resume({projectId:"brand-one",projectName:"Costs",
    description:"Home costs",sessionId:expected},runId,{model:"local",
    endpoint:"http://localhost:1234/v1/chat/completions"}),/different discovery session/i);
  assert.deepEqual(calls,[`GET runs/${runId}`]);
});

test("Rust-owned market measurement is not paused or restarted by Node job polling",async()=>{
  const runId="discover_"+"9".repeat(24),sessionId="session_"+"8".repeat(24);
  const calls=[];
  const measuring={id:runId,sessionId,status:"running",stage:"measure_market_collecting"};
  const manager=createDiscoveryJobManager({backend:async(_project,route,method)=>{
    calls.push(`${method} ${route}`);
    if(route===`runs/${runId}`)return measuring;
    if(route===`sessions/${sessionId}/discover`)return measuring;
    if(route===`runs/${runId}/resume`)return {...measuring,stage:"measure_market"};
    throw Error("Rust collection must not be restarted by the Node candidate worker");
  }});
  const config={projectId:"brand-one",projectName:"Home Economics",description:"Household costs",sessionId};
  assert.equal((await manager.get("brand-one",runId)).stage,"measure_market_collecting");
  await manager.create(config,{model:"local",endpoint:"http://localhost:1234/v1/chat/completions"});
  await manager.resume(config,runId,{model:"local",endpoint:"http://localhost:1234/v1/chat/completions"});
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(calls,[`GET runs/${runId}`,`POST sessions/${sessionId}/discover`,
    `GET runs/${runId}`,`POST runs/${runId}/resume`]);
});

test("a saved session passes its bounded idea budget and frozen prior content to candidate generation",async()=>{
  const sessionId="session_"+"d".repeat(24),runId="discover_"+"e".repeat(24);
  const source={id:"public-video-1",title:"Annual insurance cost comparison",url:"https://example.org/watch",
    provider:"youtube-data-api",evidenceState:"lead_only",publishedAt:null,observedAt:123};
  let status="queued",candidateInput;
  const backend=async(_project,route,_method,body)=>{
    if(route===`sessions/${sessionId}/discover`)return {id:runId,status:"queued",inputSnapshot:{version:1,
      projectName:"Margin Atlas",description:"Frozen brand focus",keywords:[],
      content:[{name:"Already published cost explainer",stage:"published"}]}};
    if(route==="graph")return {nodes:[],sources:[source],signals:[{sourceId:source.id,
      provider:"youtube-data-api",metric:"views",value:100,unit:"count",collectedAt:123}]};
    if(route==="graph/import-market")return {imported:0};
    if(route==="sources/captured")return {sources:[]};
    if(route.endsWith("checkpoint"))return {id:runId,status:"running"};
    if(route.endsWith("finish")){status=body.status;return {id:runId,status};}
    if(route.includes("/artifacts/"))return {artifact:_method==="POST"?body.artifact:null};
    throw Error(`Unexpected ${route}`);
  };
  const manager=createDiscoveryJobManager({backend,searchEndpoint:()=>null,generate:async input=>{
    candidateInput=input;
    return [{title:"A New Insurance Ownership Question",hook:"Where is the premium going?",
      premise:"An original cost breakdown",whyNow:"Evergreen decision",
      angleKey:"homeowner-insurance-new-comparison",sourceIds:[source.id],confidence:"low"}];
  }});
  await manager.create({projectId:"brand-one",projectName:"Margin Atlas",description:"Unfrozen change",
    sessionId,resultBudget:18,content:[]},
  {model:"local",endpoint:"http://localhost:1234/v1/chat/completions"});
  for(let i=0;i<35&&status==="queued";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(status,"completed");
  assert.equal(candidateInput.resultBudget,18);
  assert.equal(candidateInput.description,"Frozen brand focus");
  assert.deepEqual(candidateInput.content,[{name:"Already published cost explainer",stage:"published"}]);
});

test("query selection favors project intent over arbitrary first generic keywords",()=>{
  const keywords=[
    {text:"math tricks",kind:"topic",active:true},
    {text:"house decoration",kind:"topic",active:true},
    {text:"home insurance premiums",kind:"query",active:true},
    {text:"property tax costs",kind:"topic",active:true},
    {text:"generic arithmetic",kind:"exclusion",active:true},
  ];
  assert.deepEqual(selectDiscoveryQueries(keywords,"House Math","Homeownership finances including insurance, taxes and recurring costs"),
    ["home insurance premiums","property tax costs"]);
});

test("a described project can search for evidence before accepting any AI keyword",()=>{
  const queries=selectDiscoveryQueries([],"House Math",
    "Understand homeowner insurance premiums, property tax reassessments and expensive roof repairs.");
  assert.ok(queries.length>=1);
  assert.match(queries[0],/insurance|property tax|roof/iu);
  assert.doesNotMatch(queries.join(" "),/House Math/iu,"A channel brand is not a useful search query");
});

test("discovery falls back to description search when accepted search phrases have no captured evidence",async()=>{
  const id="discover_"+"1".repeat(24),searched=[],imported=[];
  let run={id,status:"queued",candidates:[],providerHealth:{}},candidateInput=null;
  const passage="County assessors may reassess property values after a home purchase, changing annual tax bills.";
  const source={id:"source-captured",title:"Home property tax guide",url:"https://example.org/tax-assessments",
    provider:"searxng",evidenceState:"captured",publishedAt:null,observedAt:100};
  const backend=async(_project,route,_method,body)=>{
    if(route==="discover")return run;
    if(route==="keywords")return {keywords:[{text:"calculate total cost of ownership",kind:"query",origin:"manual",active:true}]};
    if(route==="graph")return {nodes:[],sources:imported.length?[source]:[],signals:[]};
    if(route==="graph/batches"||route==="graph/import-market")return {imported:0};
    if(route==="sources/import"){imported.push(...body.sources);return {imported:body.sources.length};}
    if(route==="sources/captured")return {sources:imported.length?[{...source,passage}]:[]};
    if(route.endsWith("checkpoint")){run={...run,status:"running",providerHealth:body.providerHealth??run.providerHealth};return run;}
    if(route.endsWith("finish")){run={...run,status:body.status,candidates:body.candidates};return run;}
    throw Error(`unexpected ${route}`);
  };
  const manager=createDiscoveryJobManager({backend,searchEndpoint:()=>"http://127.0.0.1:8080/search",
    search:async({viewerQuestion})=>{
      searched.push(viewerQuestion);
      return {results:searched.length===1?[]:[{url:source.url,title:source.title,
        snippet:"Property tax reassessments for a home purchase"}]};
    },capture:async()=>passage,extract:async()=>({nodes:[],edges:[]}),
    generate:async input=>{candidateInput=input;return [{title:"Why Property Taxes Jump After Buying a Home",
      hook:"What changes your bill?",premise:"Understand reassessments and annual property taxes",
      whyNow:"Evergreen ownership decision",angleKey:"tax-reassessment-after-purchase",
      sourceIds:[source.id],confidence:"medium"}];}});
  await manager.create({projectId:"house",projectName:"House Math",
    description:"Explaining homeownership costs, property tax reassessments, insurance premiums and maintenance."},
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  for(let i=0;i<40&&!(["completed","insufficient_evidence","failed"].includes(run.status));i++)
    await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(run.status,"completed");
  assert.ok(searched.length>=2,"After an empty query, the worker should try a distinct description-derived query");
  assert.ok(candidateInput?.graph.sources.some(item=>item.id===source.id));
});

test("discovery identifies SearXNG connection failure instead of claiming no search results",async()=>{
  let run={id:"discover_"+"2".repeat(24),status:"queued",providerHealth:{}};
  const backend=async(_id,route,_method,body)=>{
    if(route==="discover")return run;
    if(route==="keywords")return {keywords:[{text:"home insurance premiums",kind:"query",active:true}]};
    if(route==="graph")return {nodes:[],sources:[],signals:[]};
    if(route==="graph/batches"||route==="graph/import-market")return {imported:0};
    if(route==="sources/captured")return {sources:[]};
    if(route.endsWith("checkpoint")){run={...run,status:"running",providerHealth:body.providerHealth??run.providerHealth};return run;}
    if(route.endsWith("finish")){run={...run,status:body.status};return run;}
  };
  const manager=createDiscoveryJobManager({backend,searchEndpoint:()=>"http://127.0.0.1:8080/search",
    search:async()=>{throw Error("Local SearXNG is unavailable or JSON search is disabled.");},
    generate:async()=>{throw Error("No evidence to cite");}});
  await manager.create({projectId:"house",projectName:"House Math",description:"Homeownership costs"},
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  for(let i=0;i<40&&run.status!=="insufficient_evidence";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(run.status,"insufficient_evidence");
  assert.match(run.providerHealth.news,/unavailable|not running|disabled/iu);
  assert.match(run.providerHealth.news,/research:up/iu);
});

test("generic house tours and arithmetic videos are not relevant to homeowner insurance searches",()=>{
  assert.equal(isRelevantDiscoveryLead({title:"Amazing house tour",snippet:"Beautiful interior design"},"home insurance premiums",["arithmetic"]),false);
  assert.equal(isRelevantDiscoveryLead({title:"Mental arithmetic tricks",snippet:"How to calculate faster"},"property tax costs",["arithmetic"]),false);
  assert.equal(isRelevantDiscoveryLead({title:"Insurance premiums are rising",snippet:"Homeowner policy deductibles"},"home insurance premiums",["arithmetic"]),true);
  assert.equal(isRelevantDiscoveryLead({title:"Why property tax bills rose",snippet:"County assessment"},"property tax costs",[]),true);
});

test("previously captured evidence remains eligible after newer lead-only sources displace it from graph overview",async()=>{
  let run={id:"discover_"+"c".repeat(24),status:"queued"};
  let candidatesInput=null;
  const oldSource={id:"kg-older-capture",title:"Home insurance evidence",url:"https://example.org/insurance-evidence",
    provider:"captured-web",publishedAt:null,observedAt:100,evidenceState:"captured",
    passage:"The price of a home insurance policy depends on coverage, replacement costs and local hazards."};
  const backend=async(_project,route,_method,body)=>{
    if(route==="discover")return run;
    if(route==="keywords")return {keywords:[]};
    if(route==="graph")return {nodes:[],sources:[{id:"kg-new-lead",provider:"searxng",evidenceState:"lead_only"}],signals:[]};
    if(route==="sources/captured")return {sources:[oldSource]};
    if(route==="graph/import-market"||route==="graph/batches")return {imported:0};
    if(route.endsWith("checkpoint")){run={...run,status:"running"};return run;}
    if(route.endsWith("finish")){run={...run,status:body.status};return run;}
    throw Error(`Unexpected route: ${route}`);
  };
  const manager=createDiscoveryJobManager({backend,searchEndpoint:()=>null,
    extract:async()=>({nodes:[],edges:[]}),generate:async input=>{
      candidatesInput=input;
      return [{title:"Understanding Home Insurance Replacement Costs",hook:"What changes your quote?",
        premise:"Break down insured replacement value",whyNow:"Evergreen homeowner question",
        angleKey:"insurance-replacement-value",sourceIds:[oldSource.id],confidence:"medium"}];
    }});
  await manager.create({projectId:"house",projectName:"House Math",description:"Homeowner insurance costs"},
    {model:"local",endpoint:"http://localhost:1234/v1/chat/completions"});
  for(let i=0;i<35&&run.status!=="completed"&&run.status!=="insufficient_evidence";i++)
    await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(run.status,"completed");
  assert.deepEqual(candidatesInput.graph.sources.map(source=>source.id),[oldSource.id]);
});

test("a large local search result is bounded before the project source-import endpoint",async()=>{
  const id="discover_"+"9".repeat(24);
  let run={id,status:"queued"},imported=0;
  const backend=async(_project,route,_method,body)=>{
    if(route==="discover")return run;
    if(route==="keywords")return {keywords:[{text:"home insurance premiums",kind:"query",active:true}]};
    if(route==="graph")return {nodes:[],sources:[],signals:[]};
    if(route==="graph/batches"||route==="graph/import-market")return {imported:0};
    if(route==="sources/import"){imported+=body.sources.length;return {imported:body.sources.length};}
    if(route==="sources/captured")return {sources:[]};
    if(route.endsWith("checkpoint")){run={...run,status:"running"};return run;}
    if(route.endsWith("finish")){run={...run,status:body.status};return run;}
    throw Error(`unexpected ${route}`);
  };
  const manager=createDiscoveryJobManager({backend,searchEndpoint:()=>"http://127.0.0.1:8080/search",
    search:async()=>({results:Array.from({length:80},(_,index)=>({
      url:`https://example.org/insurance/${index}`,title:`Home insurance premiums guide ${index}`,snippet:"Premiums and insurance"}))}),
    capture:async()=>null,generate:async()=>{throw Error("No evidence permits model calls");}});
  await manager.create({projectId:"house",projectName:"House Math",description:"Homeowner insurance premiums"},
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  for(let i=0;i<40&&run.status!=="insufficient_evidence";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(run.status,"insufficient_evidence");
  assert.ok(imported>0&&imported<=20,`expected 20 or fewer sources, got ${imported}`);
});

test("no five-idea job exists before click; rapid duplicate clicks share run and result survives refresh", async () => {
  const runs = new Map(); let sequence = 0; let calls=0;
  const backend=async (_id,route,method,body)=>{
    if(route==="discover"&&method==="POST"){
      const active=[...runs.values()].find(x=>["queued","running"].includes(x.status));
      if(active)return structuredClone(active);
      const run={id:`discover_${String(++sequence).padStart(24,"0")}`,projectId:"house",status:"queued",stage:"queued",candidates:[],createdAt:1};runs.set(run.id,run);return structuredClone(run);
    }
    if(route==="keywords")return {keywords:[{text:"roof repair costs",active:true,kind:"topic"}]};
    if(route==="graph")return {nodes:[{id:"node1",kind:"topic",label:"roof repair costs"}],
      sources:[{id:"source1",title:"Roof material prices",url:"https://example.com/roof",provider:"youtube-data-api",evidenceState:"lead_only"}],
      signals:[{sourceId:"source1",metric:"views",value:15000,unit:"count",collectedAt:1760000000}]};
    if(route==="graph/import-market")return {imported:0};
    if(route==="graph/batches")return {imported:body.nodes.length};
    if(route==="sources/captured")return {sources:[]};
    const id=route.split("/")[1];const run=runs.get(id);
    if(route.endsWith("checkpoint")){run.stage=body.stage;run.status="running";return structuredClone(run);}
    if(route.endsWith("finish")){run.status=body.status;run.candidates=body.candidates;return structuredClone(run);}
    if(method==="GET")return structuredClone(run);
    throw Error(`unexpected ${route}`);
  };
  const manager=createDiscoveryJobManager({backend,generate:async()=>{calls++;return [{title:"How Much Does a New Roof Really Cost?",
    hook:"Where does the bill come from?",premise:"Materials, labor and lifespan",whyNow:"Public cost discussion",
    angleKey:"roof installation labor expenses",sourceIds:["source1"],confidence:"medium"}];}});
  assert.equal(runs.size,0);
  const settings={model:"local",endpoint:"http://localhost:1234/v1/chat/completions"};
  const first=await manager.create({projectId:"house",projectName:"House Math",description:"Home ownership economics"},settings);
  const second=await manager.create({projectId:"house",projectName:"House Math",description:"Home ownership economics"},settings);
  assert.equal(first.id,second.id);
  for(let i=0;i<30&&runs.get(first.id).status!=="completed";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(runs.get(first.id).status,"completed");
  assert.equal(calls,1);
  assert.equal((await manager.get("house",first.id)).candidates.length,1);
});

test("no evidence means an explicit insufficient_evidence outcome, no invented five cards", async () => {
  let run={id:"discover_zero",status:"queued",stage:"queued",candidates:[]};let modelCalls=0;
  const backend=async(_id,route,_method,body)=>{
    if(route==="discover")return {...run};
    if(route==="keywords")return {keywords:[]};
    if(route==="graph")return {nodes:[],sources:[]};
    if(route==="graph/import-market")return {imported:0};
    if(route.endsWith("checkpoint")){run={...run,status:"running",stage:body.stage};return run;}
    if(route.endsWith("finish")){run={...run,status:body.status,candidates:body.candidates};return run;}
  };
  const manager=createDiscoveryJobManager({backend,generate:async()=>{modelCalls++;return []}});
  await manager.create({projectId:"house",projectName:"House Math",description:"Costs of maintaining a home"},
    {model:"local",endpoint:"http://localhost:1234/v1/chat/completions"});
  for(let i=0;i<30&&run.status!=="insufficient_evidence";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(run.status,"insufficient_evidence"); assert.equal(modelCalls,0); assert.deepEqual(run.candidates,[]);
});

test("unverified search URLs without captured passages or measured observations cannot finish as evidence-backed ideas",async()=>{
  let run={id:"discover_dededededededededededede",status:"queued",candidates:[]},generated=0;
  const backend=async(_id,route,_method,body)=>{
    if(route==="discover")return run;
    if(route==="keywords")return {keywords:[{text:"home insurance",active:true,kind:"topic"}]};
    if(route==="graph")return {nodes:[],signals:[],sources:[{id:"lead",title:"Unverified story",provider:"searxng",evidenceState:"lead_only"}]};
    if(route==="graph/import-market")return {imported:0};
    if(route==="graph/batches")return {imported:body.nodes.length};
    if(route.endsWith("checkpoint")){run={...run,status:"running",stage:body.stage};return run;}
    if(route.endsWith("finish")){run={...run,status:body.status,candidates:body.candidates};return run;}
  };
  const manager=createDiscoveryJobManager({backend,generate:async()=>{generated++;return [];}});
  await manager.create({projectId:"house",projectName:"House Math",description:"Homeowner costs"},
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  for(let i=0;i<30&&run.status!=="insufficient_evidence";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(run.status,"insufficient_evidence");
  assert.equal(generated,0);
});

test("an explicit discovery click captures source passages and extracts bounded supported graph links",async()=>{
  let run={id:"discover_abcdefabcdefabcdefabcdef",status:"queued",stage:"queued",candidates:[]};
  const imported=[],edges=[];
  const backend=async(_id,route,_method,body)=>{
    if(route==="discover")return {...run};
    if(route==="keywords")return {keywords:[{text:"home insurance premiums",kind:"topic",active:true}]};
    if(route==="graph")return {nodes:[],sources:imported.map(source=>({...source,id:"kg-captured",evidenceState:"captured"})),signals:[]};
    if(route==="graph/import-market")return {imported:0};
    if(route==="sources/import"){imported.push(...body.sources);return {imported:body.sources.length};}
    if(route==="graph/batches"){edges.push(...body.edges);return {imported:body.nodes.length+body.edges.length};}
    if(route.endsWith("checkpoint")){run={...run,status:"running",stage:body.stage};return run;}
    if(route.endsWith("finish")){run={...run,status:body.status,candidates:body.candidates};return run;}
  };
  const passage="Home insurance premiums depend in part on replacement cost and severe weather exposure.";
  let extracted=0;
  const manager=createDiscoveryJobManager({backend,searchEndpoint:()=>"http://127.0.0.1:8080/search",
    search:async()=>({results:[{url:"https://www.example.org/insurance",title:"Insurance basics"}]}),
    capture:async()=>passage,
    extract:async input=>{extracted++;assert.equal(input.sources[0].passage,passage);return {nodes:[],edges:[{
      fromKind:"topic",fromLabel:"Home insurance premiums",toKind:"topic",toLabel:"Replacement cost",
      relation:"related_to",status:"supported",sourceId:"kg-captured",quote:passage}]};},
    generate:async()=>[{title:"Why Home Insurance Premiums Change",hook:"Where costs come from",premise:"Explore the factors behind premiums",
      whyNow:"A continuing homeowner concern",angleKey:"home-insurance-premium-factors",sourceIds:["kg-captured"],confidence:"medium"}]});
  await manager.create({projectId:"house",projectName:"House Math",description:"Home ownership economics"},
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  for(let i=0;i<30&&run.status!=="completed";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(run.status,"completed");
  assert.equal(imported[0].passage,passage);
  assert.equal(extracted,1);
  assert.equal(edges[0].status,"supported");
});

test("a later discovery click reuses the persisted source passage for graph extraction",async()=>{
  let run={id:"discover_"+"d".repeat(24),status:"queued"};
  const source={id:"stored-source",title:"Cost comparison",url:"https://example.org/insurance",
    provider:"searxng",evidenceState:"captured"};
  let calls=0;
  const backend=async(_id,route,_method,body)=>{
    if(route==="discover")return run;
    if(route==="keywords")return {keywords:[]};
    if(route==="graph")return {sources:[source],nodes:[],signals:[]};
    if(route==="sources/captured")return {sources:[{id:"stored-source",passage:"Home insurance replacement costs include material expenses and repair labor."}]};
    if(route==="graph/import-market")return {imported:0};
    if(route==="graph/batches")return {imported:body.nodes.length+body.edges.length};
    if(route.endsWith("checkpoint")){run={...run,status:"running"};return run;}
    if(route.endsWith("finish")){run={...run,status:body.status};return run;}
  };
  const manager=createDiscoveryJobManager({backend,searchEndpoint:()=>null,
    extract:async({sources})=>{calls++;assert.equal(sources[0].id,"stored-source");
      assert.match(sources[0].passage,/repair labor/);return {nodes:[],edges:[]};},
    generate:async()=>[]});
  await manager.create({projectId:"house",projectName:"House Math",description:"Homeowner costs"},
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  for(let i=0;i<30&&run.status!=="insufficient_evidence";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(calls,1);
});

test("cancel terminates in-flight discovery and persists a cancelled status",async()=>{
  const runId="discover_"+"c".repeat(24);
  let status="queued",cancelled=0,started;
  const entered=new Promise(resolve=>{started=resolve;});
  const backend=async(_id,route,_method,body)=>{
    if(route==="discover")return {id:runId,status};
    if(route==="keywords")return {keywords:[]};
    if(route==="graph")return {sources:[],nodes:[],signals:[]};
    if(route.endsWith("checkpoint")){
      if(status==="cancelled")throw Error("Terminal run cannot checkpoint");
      status="running";started();return {id:runId,status};
    }
    if(route.endsWith("cancel")){cancelled++;status="cancelled";return {id:runId,status};}
    if(route.endsWith("finish"))throw Error("Cancelled discovery cannot finish");
  };
  const manager=createDiscoveryJobManager({backend});
  await manager.create({projectId:"house",projectName:"House Math",description:"Home costs"},
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  await entered;
  const result=await manager.cancel("house",runId);
  assert.equal(result.status,"cancelled");
  assert.equal(cancelled,1);
  assert.equal(status,"cancelled");
});

test("a cancelled unresponsive worker cannot prevent a new explicit run for the same project",async()=>{
  const firstId="discover_"+"e".repeat(24),secondId="discover_"+"f".repeat(24);
  let clicks=0,secondStatus="queued";
  const backend=async(_projectId,route,_method,body)=>{
    if(route==="discover")return {id:++clicks===1?firstId:secondId,status:"queued"};
    if(route===`runs/${firstId}/checkpoint`)return new Promise(()=>{});
    if(route===`runs/${firstId}/cancel`)return {id:firstId,status:"cancelled"};
    if(route==="keywords")return {keywords:[]};
    if(route==="graph")return {sources:[],nodes:[],signals:[]};
    if(route==="graph/import-market")return {imported:0};
    if(route==="sources/captured")return {sources:[]};
    if(route===`runs/${secondId}/checkpoint`)return {id:secondId,status:"running"};
    if(route===`runs/${secondId}/finish`){secondStatus=body.status;return {id:secondId,status:secondStatus};}
  };
  const manager=createDiscoveryJobManager({backend});
  const input={projectId:"house",projectName:"House Math",description:"Homeowner costs"},
    settings={model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"};
  await manager.create(input,settings);
  await manager.cancel("house",firstId);
  await manager.create(input,settings);
  for(let i=0;i<30&&secondStatus!=="insufficient_evidence";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(secondStatus,"insufficient_evidence");
});

test("Resume uses frozen run inputs and completed stage artifacts without repeating search or AI",async()=>{
  const runId="discover_"+"a".repeat(24);
  const original={version:1,projectName:"Home Ownership Costs",description:"Homeowner insurance premium economics",
    content:[{name:"Old roof costs",stage:"published"}],keywords:[{text:"home insurance premiums",kind:"query",active:true}],
    graphRevision:1,researchFreshness:1};
  const savedCandidate={title:"Why Home Insurance Premiums Change",hook:"See the hidden factors",
    premise:"Repair costs and local risk",whyNow:"An evergreen question",angleKey:"home insurance premium changes",
    sourceIds:["captured1"],confidence:"medium"};
  let status="paused",searches=0,generations=0,extractions=0,finished=[];
  const artifacts=new Map([["source-query:0",{complete:true}],["graph-batch:0",{complete:true}],
    ["candidate-pool",[savedCandidate]]]);
  const backend=async(_id,route,method,body)=>{
    if(route===`runs/${runId}/resume`){status="queued";return {id:runId,status,inputSnapshot:original};}
    if(route==="keywords")return {keywords:[{text:"random math tricks",kind:"query",active:true}]};
    if(route==="graph")return {nodes:[],sources:[{id:"captured1",url:"https://example.org/home",provider:"searxng",evidenceState:"captured"}],signals:[]};
    if(route==="graph/import-market")return {imported:0};
    if(route==="graph/batches")return {imported:body.nodes.length+body.edges.length};
    if(route==="sources/captured")return {sources:[{id:"captured1",passage:"Premiums depend on the local cost of repairs and coverage."}]};
    if(route.endsWith("checkpoint")){status="running";return {id:runId,status};}
    if(route.endsWith("finish")){finished=body.candidates;status=body.status;return {id:runId,status,candidates:finished};}
    const key=route.split("/artifacts/")[1];
    if(key!==undefined){if(method==="GET")return {artifact:artifacts.get(key)??null};
      if(method==="POST"){if(!artifacts.has(key))artifacts.set(key,body.artifact);return {artifact:artifacts.get(key)};}}
    throw Error(`unexpected ${route}`);
  };
  const manager=createDiscoveryJobManager({backend,searchEndpoint:()=>"http://127.0.0.1:8080/search",
    search:async()=>{searches++;return {results:[]};},
    extract:async()=>{extractions++;return {nodes:[],edges:[]};},
    generate:async()=>{generations++;return [];}});
  await manager.resume({projectId:"house",projectName:"Changed name",description:"Mathematics facts",content:[]},runId,
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  for(let i=0;i<50&&status!=="completed";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(status,"completed");
  assert.deepEqual(finished,[savedCandidate]);
  assert.equal(searches,0);assert.equal(extractions,0);assert.equal(generations,0);
});

test("Resume reuses captured query results and saved graph proposals, then checkpoints the candidate pool",async()=>{
  const runId="discover_"+"b".repeat(24);
  const snapshot={version:1,projectName:"Homeownership Explained",description:"Home insurance premium economics",
    content:[{name:"Roof cost",stage:"published"}],keywords:[{text:"home insurance premiums",kind:"query",active:true}]};
  const savedSource={url:"https://example.org/home-insurance",title:"Insurance cost basics",provider:"searxng",
    publishedAt:null,observedAt:1,passage:"Repair costs and local exposures affect the cost of home insurance premiums."};
  const proposal={nodes:[],edges:[{fromKind:"topic",fromLabel:"Insurance",toKind:"topic",toLabel:"Repair costs",
    relation:"related_to",status:"supported",sourceId:"captured1",quote:savedSource.passage}]};
  const artifacts=new Map([["source-query:0",[savedSource]],["graph-proposal:0",proposal]]);
  let status="paused",searches=0,extractions=0,modelInputs=[],imported=0,graphImports=0;
  const backend=async(_id,route,method,body)=>{
    if(route===`runs/${runId}/resume`){status="queued";return {id:runId,status,inputSnapshot:snapshot};}
    if(route==="graph")return {nodes:[],sources:[{...savedSource,id:"captured1",evidenceState:"captured"}],signals:[]};
    if(route==="graph/import-market")return {imported:0};
    if(route==="graph/batches"){graphImports+=body.edges.length;return {imported:body.nodes.length+body.edges.length};}
    if(route==="sources/import"){imported+=body.sources.length;return {imported:body.sources.length};}
    if(route==="sources/captured")return {sources:[{id:"captured1",passage:savedSource.passage}]};
    if(route.endsWith("checkpoint")){status="running";return {id:runId,status};}
    if(route.endsWith("finish")){status=body.status;return {id:runId,status};}
    const key=route.split("/artifacts/")[1];
    if(key!==undefined){if(method==="GET")return {artifact:artifacts.get(key)??null};
      if(method==="POST"){if(!artifacts.has(key))artifacts.set(key,body.artifact);return {artifact:artifacts.get(key)};}}
    throw Error(`unexpected ${route}`);
  };
  const manager=createDiscoveryJobManager({backend,searchEndpoint:()=>"http://127.0.0.1:8080/search",
    search:async()=>{searches++;return {results:[]};},extract:async()=>{extractions++;return proposal;},
    generate:async input=>{modelInputs.push(input);return [{title:"Understanding Home Insurance Premiums",
      hook:"What drives premiums?",premise:"Explain repair costs and exposure",whyNow:"Evergreen topic",
      angleKey:"insurance premium cost drivers",sourceIds:["captured1"],confidence:"medium"}];}});
  await manager.resume({projectId:"house",projectName:"Changed",description:"Unrelated arithmetic",content:[]},runId,
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  for(let i=0;i<50&&status!=="completed";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(status,"completed");
  assert.equal(searches,0);assert.equal(extractions,0);
  assert.equal(imported,1);assert.equal(graphImports,1);
  assert.equal(modelInputs[0].projectName,"Homeownership Explained");
  assert.equal(modelInputs[0].description,"Home insurance premium economics");
  assert.equal(modelInputs[0].keywords[0].text,"home insurance premiums");
  assert.equal(modelInputs[0].content[0].name,"Roof cost");
  assert.equal(artifacts.get("graph-batch:0").complete,true);
  assert.equal(artifacts.get("candidate-pool")[0].sourceIds[0],"captured1");
});

test("Resume from a saved candidate-input skips source stages and checkpoints missing candidate batches",async()=>{
  const runId="discover_"+"5".repeat(24);
  const input={projectName:"Home Economics",description:"Home insurance and roofs",keywords:[],content:[],
    graph:{nodes:[],signals:[],sources:[{id:"captured-source",provider:"searxng",evidenceState:"captured"}]}};
  const candidate={title:"Home Insurance Repair Economics",hook:"Where does the cost go?",
    premise:"Explain household expense drivers",whyNow:"Evergreen explanation",angleKey:"home-insurance-repairs",
    sourceIds:["captured-source"],confidence:"medium"};
  const artifacts=new Map([["candidate-input",input],["candidate-batch:0",[candidate]]]);
  let status="paused",generated=0,searches=0;
  const backend=async(_project,route,method,body)=>{
    if(route.endsWith("/resume"))return {id:runId,status:"queued",inputSnapshot:{version:1}};
    if(route.endsWith("/checkpoint"))return {id:runId,status:"running"};
    if(route.endsWith("/finish")){status=body.status;return {id:runId,status};}
    const key=route.split("/artifacts/")[1];
    if(key!==undefined){if(method==="GET")return {artifact:artifacts.get(key)??null};
      if(method==="POST"){artifacts.set(key,body.artifact);return {artifact:body.artifact};}}
    throw Error(`Unexpected backend stage: ${route}`);
  };
  const manager=createDiscoveryJobManager({backend,search:async()=>{searches++;throw Error("Must not search");},
    generate:async(given,options)=>{generated++;
      assert.deepEqual(given,input);assert.deepEqual(await options.readBatch(0),[candidate]);
      await options.saveBatch(1,[]);return [candidate];}});
  await manager.resume({projectId:"house",projectName:"Changed",description:"Unrelated",content:[]},runId,
    {model:"local",endpoint:"http://127.0.0.1:11434/v1/chat/completions"});
  for(let i=0;i<50&&status!=="completed";i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(status,"completed");assert.equal(searches,0);assert.equal(generated,1);
  assert.deepEqual(artifacts.get("candidate-batch:1"),[]);
  assert.deepEqual(artifacts.get("candidate-pool"),[candidate]);
});

