import {afterEach,describe,it,expect,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProjectDiscoveryPanel} from "./project-discovery-panel";
import {ProjectKnowledgePanel} from "./project-knowledge-panel";
import {DiscoveryIdeasPanel} from "./discovery-ideas-panel";

afterEach(()=>vi.restoreAllMocks());

describe("Project discovery author controls",()=>{
  it("makes an unavailable local search service actionable without implying an empty search",async()=>{
    const run={id:"discover_"+"e".repeat(24),projectId:"project-local",inputRevision:"snapshot",
      status:"insufficient_evidence",stage:"completed",createdAt:1760000000,updatedAt:1760000000,
      errorCode:null,providerHealth:{news:"local SearXNG unavailable or JSON search disabled. Run pnpm --dir apps/web research:up, then research:check.",
        evidence:"No captured passages or measured video signals."},candidates:[]};
    vi.spyOn(globalThis,"fetch").mockImplementation(async input=>{
      const path=String(input);
      if(!path.endsWith("/runs"))throw Error(`Unexpected discovery route: ${path}`);
      return new Response(JSON.stringify({runs:[run]}),{status:200});
    });
    render(<DiscoveryIdeasPanel project={{id:"project-local",name:"House Math",notes:"Homeowner economics",createdAt:"2026-10-24T00:00:00Z"}}
      content={[]} locale="en" syncStatus="synced" sources={[]} onSaveIdea={()=>true} onRunFinished={()=>{}}/>);
    expect(await screen.findByText(/Search service is unavailable/iu)).toBeInTheDocument();
    expect(screen.getByText("pnpm --dir apps/web research:up",{selector:"code"})).toBeInTheDocument();
  });
  it("lets a creator reject an AI relationship and add and remove a topic alias",async()=>{
    const sourceNodes=[{id:"topic-insurance",kind:"topic",label:"Home insurance"},
      {id:"topic-roof",kind:"topic",label:"Roof repairs"}];
    let relationship="hypothesized",alias="";
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input,options)=>{
      const path=String(input),method=options?.method??"GET";
      if(path.includes("/correction")&&method==="PATCH")relationship=JSON.parse(String(options?.body)).status;
      if(path.endsWith("/aliases")&&method==="POST")alias=JSON.parse(String(options?.body)).alias;
      if(path.endsWith("/aliases")&&method==="DELETE")alias="";
      const body=path.endsWith("/graph")?{
        nodes:sourceNodes,edges:[{id:"edge-insurance",fromNodeId:sourceNodes[0].id,toNodeId:sourceNodes[1].id,
          relation:"related_to",status:relationship}],edgeEvidence:[],aliases:alias?[{nodeId:sourceNodes[0].id,alias}]:[],
        sources:[],signals:[],topicCount:2,sourceCount:0,supportedEdgeCount:0,
      }:path.endsWith("/watchlists")?{watchlistIds:[],watchlists:[]}:{saved:true};
      return new Response(JSON.stringify(body),{status:200});
    });
    const user=userEvent.setup();
    render(<ProjectKnowledgePanel projectId="project-local" locale="en" syncStatus="synced" revision={0} onGraph={()=>{}}/>);
    await user.click(await screen.findByRole("button",{name:"Reject relation"}));
    await waitFor(()=>expect(relationship).toBe("rejected"));
    await user.type(screen.getByRole("textbox",{name:"Alias for Home insurance"}),"Homeowners coverage");
    await user.click(screen.getByRole("button",{name:"Add alias to Home insurance"}));
    expect(await screen.findByText("Homeowners coverage")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Remove alias Homeowners coverage"}));
    await waitFor(()=>expect(alias).toBe(""));
  });
  it("shows the exact evidence quote and public source beside a supported graph link",async()=>{
    const from={id:"node-a",kind:"topic",label:"Home insurance"},to={id:"node-b",kind:"topic",label:"Replacement cost"};
    const edge={id:"edge-one",fromNodeId:from.id,toNodeId:to.id,relation:"related_to",status:"supported"};
    const source={id:"source-one",provider:"searxng",title:"Insurance source",url:"https://example.org/insurance",
      publishedAt:null,observedAt:1760000000,evidenceState:"captured"};
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>{
      const path=String(input),body=path.endsWith("/graph")?{
        nodes:[from,to],edges:[edge],edgeEvidence:[{edgeId:edge.id,sourceId:source.id,
          assessment:"supports",quote:"Home insurance premiums vary with replacement costs."}],
        sources:[source],signals:[],topicCount:2,sourceCount:1,supportedEdgeCount:1,
      }:path.endsWith("/watchlists")?{watchlistIds:[],watchlists:[]}:null;
      if(!body)throw Error(`Unexpected route ${path}`);
      return new Response(JSON.stringify(body),{status:200});
    });
    render(<ProjectKnowledgePanel projectId="project-local" locale="en" syncStatus="synced" revision={0} onGraph={()=>{}}/>);
    expect(await screen.findByText(/Home insurance premiums vary with replacement costs/)).toBeInTheDocument();
    expect(screen.getAllByRole("link",{name:"Insurance source"})[0]).toHaveAttribute("href",source.url);
  });

  it("lets the author explicitly verify a quoted noncausal relationship",async()=>{
    const from={id:"node-a",kind:"topic",label:"Home insurance"},to={id:"node-b",kind:"topic",label:"Replacement cost"};
    let status="hypothesized";
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input,options)=>{
      const path=String(input);
      if(path.endsWith("/correction")&&options?.method==="PATCH")status=JSON.parse(String(options.body)).status;
      const body=path.endsWith("/graph")?{nodes:[from,to],edges:[{id:"edge-one",fromNodeId:from.id,
        toNodeId:to.id,relation:"related_to",status}],edgeEvidence:[{edgeId:"edge-one",sourceId:"source-1",
          assessment:"supports",quote:"The insured replacement cost is a factor in home insurance pricing."}],
        aliases:[],sources:[],signals:[],topicCount:2,sourceCount:0,supportedEdgeCount:0}
        :path.endsWith("/watchlists")?{watchlistIds:[],watchlists:[]}:{saved:true};
      return new Response(JSON.stringify(body),{status:200});
    });
    render(<ProjectKnowledgePanel projectId="project-local" locale="en" syncStatus="synced" revision={0} onGraph={()=>{}}/>);
    await userEvent.setup().click(await screen.findByRole("button",{name:"Approve sourced relation"}));
    await waitFor(()=>expect(status).toBe("supported"));
  });

  it("shows a cancel action for an active discovery job and persists its terminal state",async()=>{
    const runId=`discover_${"a".repeat(24)}`;
    const run={id:runId,projectId:"project-local",inputRevision:"snapshot",status:"running",stage:"extract_graph",
      createdAt:1760000000,updatedAt:1760000000,errorCode:null,providerHealth:{},candidates:[]};
    let cancelled=false;
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input,options)=>{
      const path=String(input);
      const body=path.endsWith("/graph")?{nodes:[],edges:[],sources:[],signals:[],topicCount:0,sourceCount:0,supportedEdgeCount:0}
        :path.endsWith("/keywords")?{keywords:[]}
          :path.endsWith("/watchlists")?{watchlistIds:[],watchlists:[]}
            :path.endsWith("/runs")?{runs:[run]}
              :path.endsWith("/cancel")&&options?.method==="POST"?(cancelled=true,{...run,status:"cancelled"})
                :path.endsWith(`/runs/${runId}`)?{...run,status:cancelled?"cancelled":"running"}:null;
      if(!body)throw Error(`Unexpected discovery route: ${path}`);
      return new Response(JSON.stringify(body),{status:200});
    });
    render(<ProjectDiscoveryPanel project={{id:"project-local",name:"House Math",notes:"Homeowner economics",createdAt:"2026-10-20T00:00:00Z"}}
      content={[]} locale="en" syncStatus="synced" onSaveIdea={()=>true}/>);
    await userEvent.setup().click(await screen.findByRole("button",{name:"Cancel run"}));
    await waitFor(()=>expect(cancelled).toBe(true));
    expect(await screen.findByText("cancelled")).toBeInTheDocument();
  });

  it("hands the selected idea and matching source leads to Research when requested",async()=>{
    const source={id:"source-one",provider:"searxng",title:"Homeowner policy explanation",url:"https://example.com/policy",
      publishedAt:null,observedAt:1760000000,evidenceState:"lead_only"};
    const idea={id:"idea-one",rank:1,title:"Why Home Insurance Premiums Change",hook:"What's behind your premium?",
      premise:"Explain replacement costs and local risks",whyNow:"Evergreen",angleKey:"premium-explained",sourceIds:[source.id],confidence:"low",decision:null};
    const run={id:"discover-one",projectId:"project-local",inputRevision:"one",status:"completed",stage:"completed",
      createdAt:1760000000,updatedAt:1760000000,errorCode:null,providerHealth:{},candidates:[idea]};
    let persistedDecision="";
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input,options)=>{
      const path=String(input);
      if(path.endsWith("/decision")){
        persistedDecision=JSON.parse(String(options?.body)).decision;
        return new Response(JSON.stringify({saved:true}),{status:200});
      }
      const body=path.endsWith("/keywords")?{keywords:[]}:path.endsWith("/graph")?{
        nodes:[],edges:[],sources:[source],signals:[],topicCount:0,sourceCount:1,supportedEdgeCount:0
      }:path.endsWith("/watchlists")?{watchlists:[],watchlistIds:[]}:path.endsWith("/runs")?{runs:[run]}:null;
      if(!body)throw Error(`Unexpected route ${path}`);
      return new Response(JSON.stringify(body),{status:200});
    });
    let received:unknown=null;
    render(<ProjectDiscoveryPanel project={{id:"project-local",name:"House Math",notes:"Homeowner economics",createdAt:"2026-10-20T00:00:00Z"}}
      content={[]} locale="en" syncStatus="synced" onSaveIdea={(item,openResearch,sources)=>{
        received={item,openResearch,sources};return true;
      }}/>);
    await userEvent.setup().click(await screen.findByRole("button",{name:"Save & research"}));
    await waitFor(()=>expect(received).toEqual({item:idea,openResearch:true,sources:[source]}));
    await waitFor(()=>expect(persistedDecision).toBe("saved"));
  });

  it("shows clickable sources imported by a finished discovery run without manual refresh",async()=>{
    let complete=false;
    const source={id:"source-new",provider:"searxng",title:"Rising homeowner premiums",url:"https://example.com/insurance",
      publishedAt:null,observedAt:1760000000,evidenceState:"lead_only"};
    const run={id:"discover-demo",projectId:"project-local",inputRevision:"one",status:"completed",stage:"completed",
      createdAt:1760000000,updatedAt:1760000000,errorCode:null,providerHealth:{googleTrends:"unavailable"},candidates:[{
        id:"idea-demo",rank:1,title:"Why Home Insurance Premiums Rise",hook:"See what drives premiums",premise:"Explain rate changes for homeowners",
        whyNow:"Evergreen homeowner cost topic",angleKey:"insurance-premium-mechanism",sourceIds:[source.id],confidence:"low",decision:null}]};
    const fetchMock=vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>{
      const path=String(input);
      const body=path.endsWith("/graph")?{nodes:[],edges:[],sources:complete?[source]:[],signals:[],topicCount:0,sourceCount:complete?1:0,supportedEdgeCount:0}
        :path.endsWith("/keywords")?{keywords:[]}
          :path.endsWith("/watchlists")?{watchlists:[],watchlistIds:[]}
            :path.endsWith("/runs")?{runs:[]}
              :path.endsWith("/project-discovery")?{...run,status:"queued",stage:"select_topics",candidates:[]}
                :path.endsWith("/runs/discover-demo")?(complete=true,run):null;
      if(!body)throw Error(`Unexpected discovery route: ${path}`);
      return new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
    });
    const user=userEvent.setup();
    render(<ProjectDiscoveryPanel project={{id:"project-local",name:"House Math",notes:"Home ownership costs",createdAt:"2026-10-20T00:00:00Z"}}
      content={[]} locale="en" syncStatus="synced" onSaveIdea={()=>true}/>);
    await screen.findByRole("button",{name:"Discover 5 Ideas"});
    await waitFor(()=>expect(fetchMock.mock.calls.some(([url])=>String(url).endsWith("/graph"))).toBe(true));
    await user.click(screen.getByRole("button",{name:"Discover 5 Ideas"}));
    await waitFor(()=>expect(screen.getAllByRole("link",{name:/Rising homeowner premiums/}).some(link=>
      link.getAttribute("href")===source.url&&link.textContent?.includes("searxng"))).toBe(true),{timeout:6500});
  },8000);

  it("keeps suggested keywords pending until accepted and never modifies localStorage",async()=>{
    localStorage.clear();
    const writes:unknown[]=[];
    const mock=vi.spyOn(globalThis,"fetch").mockImplementation(async(input,options)=>{
      const path=String(input);
      if(path.endsWith("/keywords")&&options?.method==="PATCH"){
        const body=JSON.parse(String(options.body)) as unknown;
        writes.push(body);
        return new Response(JSON.stringify({keywords:[{id:"keyword-1",text:"Home insurance premium growth",
          kind:"topic",origin:"model",active:true,manualLock:false}]}),{status:200});
      }
      if(path.endsWith("/keywords"))return new Response(JSON.stringify({keywords:[]}),{status:200});
      if(path.endsWith("project-keyword-suggestions/stream")){
        const suggestions=[{text:"Home insurance premium growth",kind:"topic",rationale:"Relevant homeowner cost concern"}];
        const quality={modelRequests:1,batches:1,proposed:1,rejected:0,partial:true,evidence:"unverified"};
        return new Response(`${JSON.stringify({type:"batch",suggestions,quality,step:1,totalSteps:6})}\n${JSON.stringify({type:"done",quality})}\n`,
          {status:200,headers:{"Content-Type":"application/x-ndjson"}});
      }
      if(path.endsWith("/graph"))return new Response(JSON.stringify({nodes:[],edges:[],sources:[],signals:[],
        topicCount:0,sourceCount:0,supportedEdgeCount:0}),{status:200});
      if(path.endsWith("/watchlists"))return new Response(JSON.stringify({watchlists:[],watchlistIds:[]}),{status:200});
      if(path.endsWith("/runs"))return new Response(JSON.stringify({runs:[]}),{status:200});
      return new Response("{}",{status:200});
    });
    const user=userEvent.setup();
    render(<ProjectDiscoveryPanel project={{id:"project-local",name:"House Math",notes:"Home ownership costs",createdAt:"2026-10-20T00:00:00Z"}}
      content={[]} locale="en" syncStatus="synced" onSaveIdea={()=>true}/>);
    await user.click(await screen.findByRole("button",{name:"Suggest Keywords with Local AI"}));
    expect(await screen.findByText("Home insurance premium growth")).toBeInTheDocument();
    expect(writes).toHaveLength(0);
    await user.click(screen.getByRole("button",{name:"Accept"}));
    expect(writes).toHaveLength(1);
    expect(localStorage.length).toBe(0);
    mock.mockRestore();
  });

  it("marks locally generated keyword suggestions as unverified and explains quality filtering",async()=>{
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>{
      const path=String(input);
      const body=path.endsWith("/keywords")?{keywords:[]}
        :path.endsWith("/graph")?{nodes:[],edges:[],sources:[],signals:[],topicCount:0,sourceCount:0,supportedEdgeCount:0}
            :path.endsWith("/watchlists")?{watchlists:[],watchlistIds:[]}
              :path.endsWith("/runs")?{runs:[]}:null;
      if(path.endsWith("project-keyword-suggestions/stream")){
        const suggestions=[{text:"Why homeowner insurance premiums increase",kind:"query",rationale:"Explains renewal costs"}];
        const quality={modelRequests:5,batches:3,proposed:9,rejected:8,partial:true,evidence:"unverified"};
        return new Response(`${JSON.stringify({type:"batch",suggestions,quality,step:3,totalSteps:6})}\n${JSON.stringify({type:"done",quality})}\n`,
          {status:200,headers:{"Content-Type":"application/x-ndjson"}});
      }
      if(!body)throw Error(`Unexpected route ${path}`);
      return new Response(JSON.stringify(body),{status:200});
    });
    render(<ProjectDiscoveryPanel project={{id:"project-local",name:"House Math",notes:"Homeowner costs",createdAt:"2026-10-20T00:00:00Z"}}
      content={[]} locale="en" syncStatus="synced" onSaveIdea={()=>true}/>);
    await userEvent.setup().click(await screen.findByRole("button",{name:"Suggest Keywords with Local AI"}));
    expect(await screen.findByText("Why homeowner insurance premiums increase")).toBeInTheDocument();
    expect(screen.getByText(/unverified.*search volume/i)).toBeInTheDocument();
    expect(screen.getByText(/5 local AI requests.*8.*filtered/i)).toBeInTheDocument();
    expect(screen.getByText(/partial.*no fabricated/i)).toBeInTheDocument();
  });

  it("shows the first keyword batch during generation and Stop keeps it available for acceptance",async()=>{
    const writes:unknown[]=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input,options)=>{
      const path=String(input);
      if(path.endsWith("/project-keyword-suggestions/stream")){
        const quality={modelRequests:1,batches:1,proposed:2,rejected:0,partial:true,evidence:"unverified"};
        const frame=JSON.stringify({type:"batch",suggestions:[{
          text:"Why home insurance renewal costs rise",kind:"query",rationale:"Explains annual policy changes"}],
          quality,step:1,totalSteps:6})+"\n";
        const body=new ReadableStream({start(controller){
          controller.enqueue(new TextEncoder().encode(frame));
          options?.signal?.addEventListener("abort",()=>controller.error(Error("cancelled")),{once:true});
        }});
        return new Response(body,{status:200,headers:{"Content-Type":"application/x-ndjson"}});
      }
      if(path.endsWith("/keywords")&&options?.method==="PATCH"){
        writes.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({keywords:[{id:"key-new",text:"Why home insurance renewal costs rise",
          kind:"query",origin:"model",active:true,manualLock:false}]}),{status:200});
      }
      const response=path.endsWith("/keywords")?{keywords:[]}
        :path.endsWith("/graph")?{nodes:[],edges:[],sources:[],signals:[],topicCount:0,sourceCount:0,supportedEdgeCount:0}
          :path.endsWith("/watchlists")?{watchlists:[],watchlistIds:[]}
            :path.endsWith("/runs")?{runs:[]}:null;
      if(!response)throw Error(`Unexpected route: ${path}`);
      return new Response(JSON.stringify(response),{status:200});
    });
    const user=userEvent.setup();
    render(<ProjectDiscoveryPanel project={{id:"project-local",name:"House Math",notes:"Homeowner costs",createdAt:"2026-10-20T00:00:00Z"}}
      content={[]} locale="en" syncStatus="synced" onSaveIdea={()=>true}/>);
    await user.click(await screen.findByRole("button",{name:"Suggest Keywords with Local AI"}));
    expect(await screen.findByText("Why home insurance renewal costs rise")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Stop keyword generation"})).toBeEnabled();
    expect(screen.getByRole("button",{name:"Accept"})).toBeEnabled();
    expect(writes).toHaveLength(0);
    await user.click(screen.getByRole("button",{name:"Stop keyword generation"}));
    expect(screen.getByText("Why home insurance renewal costs rise")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Accept"}));
    expect(writes).toHaveLength(1);
  });

  it("keeps Projects visible and explains a malformed discovery start response",async()=>{
    vi.spyOn(globalThis,"fetch").mockImplementation(async(input)=>{
      const path=String(input);
      const body=path.endsWith("/keywords")?{keywords:[]}
        :path.endsWith("/graph")?{nodes:[],edges:[],sources:[],signals:[],topicCount:0,sourceCount:0,supportedEdgeCount:0}
          :path.endsWith("/watchlists")?{watchlists:[],watchlistIds:[]}
            :path.endsWith("/runs")?{runs:[]}
              :path.endsWith("/project-discovery")?{id:"discover_"+"b".repeat(24),status:"queued",stage:"queued",createdAt:1760000000}
                :null;
      if(!body)throw Error(`Unexpected route: ${path}`);
      return new Response(JSON.stringify(body),{status:200});
    });
    render(<ProjectDiscoveryPanel project={{id:"project-local",name:"House Math",notes:"Housing costs",createdAt:"2026-10-20T00:00:00Z"}}
      content={[]} locale="en" syncStatus="synced" onSaveIdea={()=>true}/>);
    await userEvent.setup().click(await screen.findByRole("button",{name:"Discover 5 Ideas"}));
    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid discovery run response/i);
    expect(screen.getByRole("heading",{name:"Discover 5 Ideas"})).toBeInTheDocument();
  });
});
