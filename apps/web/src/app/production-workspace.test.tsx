import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneStoryboard } from "@/features/storyboard-planner/model/types";
import { HVAC_EXAMPLE } from "@/features/storyboard-planner/model/hvac-example";
import { loadProjectStoryboard, saveProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProductionWorkspace } from "./production-workspace";
import type { StudioCatalog } from "./catalog-model";
import { loadScriptDraft } from "./script-review-model";
import { productionMediaSource } from "./production-lineage";

const catalog:StudioCatalog={version:1,activeProjectId:"project-demo",
  projects:[{id:"project-demo",name:"Margin Atlas",notes:"Explain housing costs",
    createdAt:"2026-10-24T00:00:00Z"}],content:[],assets:[],products:[]};
const noop=()=>{};
const props={locale:"en" as const,catalog,onSelectProject:noop,onOpenResearch:noop,
  onOpenStoryboard:noop,onOpenVisuals:noop,onOpenAudio:noop,onOpenDraft:noop,onOpenExport:noop,
  onOpenNav:noop,onCreateStoryboard:()=>true,onUseVideo:()=>true};
const stageButton=(label:string)=>within(screen.getByRole("navigation",{name:"Production stages"}))
  .getByRole("button",{name:new RegExp(label,"i")});
describe("Production eight-step workspace",()=>{
  afterEach(()=>{localStorage.clear();sessionStorage.clear();vi.unstubAllGlobals();});

  it("always exposes every stage, highlights the current one and starts with Project",()=>{
    render(<ProductionWorkspace {...props}/>);
    expect(screen.getByRole("navigation",{name:"Production stages"})).toBeInTheDocument();
    expect(screen.getByRole("navigation",{name:"Production stages"})).toHaveAttribute("data-km-stepper");
    expect(stageButton("Setup")).toHaveAttribute("aria-current","step");
    for(const name of ["Discover","Select Idea","Script","Plan Scenes","Create Video","Publish Kit","Export"]){
      expect(stageButton(name)).toBeInTheDocument();
    }
    expect(screen.getByRole("combobox",{name:"Project / brand"})).toHaveValue("project-demo");
    expect(screen.getByRole("group",{name:"Target platforms"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"YouTube Shorts"})).toBeInTheDocument();
    expect(screen.queryByText(/From discovery to export · eight connected steps/)).not.toBeInTheDocument();
  });

  it("restores the selected session's real discovery state even when Select Idea is opened directly",async()=>{
    localStorage.setItem("contentgen:production-flow:v2:project-demo",JSON.stringify({
      platforms:["youtube"],sessionId:"session-1",production:null}));
    localStorage.setItem("contentgen:production-step:v1:project-demo","select");
    const run={id:"run-1",projectId:"project-demo",inputRevision:"revision",status:"running",
      stage:"source-search",createdAt:1760000000,updatedAt:1760000000,errorCode:null,
      providerHealth:{},candidates:[]};
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const path=String(input);
      if(path.endsWith("/sessions/session-1"))
        return new Response(JSON.stringify({id:"session-1",projectId:"project-demo",name:"Test",
          platforms:["youtube"],settingsSnapshot:{},status:"running",createdAt:1760000000,
          updatedAt:1760000000,archivedAt:null,ideaCount:0,lastRun:run}),{status:200});
      if(path.endsWith("/sessions/session-1/ideas"))return new Response(JSON.stringify({ideas:[]}),{status:200});
      if(path.endsWith("/api/productions")||path.includes("/api/productions?"))
        return new Response(JSON.stringify({productions:[]}),{status:200});
      return new Response(JSON.stringify({productions:[],items:[]}),{status:200});
    }));
    render(<ProductionWorkspace {...props}/>);
    expect(stageButton("Select Idea")).toHaveAttribute("aria-current","step");
    await waitFor(()=>expect(within(stageButton("Discover"))
      .getByText("Running")).toBeInTheDocument());
  });

  it("allows a return to any stage without clearing target platforms",()=>{
    render(<ProductionWorkspace {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:"TikTok"}));
    expect(screen.getByRole("button",{name:"TikTok"})).toHaveAttribute("aria-pressed","true");
    fireEvent.click(stageButton("Export"));
    expect(stageButton("Export")).toHaveAttribute("aria-current","step");
    fireEvent.click(stageButton("Setup"));
    expect(screen.getByRole("button",{name:"TikTok"})).toHaveAttribute("aria-pressed","true");
  });
  it("presents failed stage status through the accessible Kumiki stepper",()=>{
    render(<ProductionWorkspace {...props}/>);
    const discover=stageButton("Discover");
    expect(discover).toHaveAccessibleName(/Discover/);
    expect(discover).not.toHaveAttribute("aria-current");
    fireEvent.click(discover);
    expect(discover).toHaveAttribute("aria-current","step");
  });

  it("keeps the private Publish Kit editor available when the local rendered-file lookup fails",async()=>{
    const production={id:"production-"+"e".repeat(24),projectId:"project-demo",sessionId:"session-1",ideaId:"idea-1",
      platforms:["youtube"],brief:{title:"The hidden cost of a home",topic:"Home cost",angle:"Explain costs",
        description:"Private production",keywords:[],platforms:["youtube"]}};
    localStorage.setItem("contentgen:production-flow:v2:project-demo",JSON.stringify({
      platforms:["youtube"],sessionId:"session-1",production}));
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      if(String(input).includes("/api/contentgen-video/assets/"))return Response.json({message:"offline"},{status:503});
      return Response.json({productions:[production],ideas:[],snapshot:null});
    }));
    render(<ProductionWorkspace {...props}/>);
    fireEvent.click(stageButton("Publish Kit"));
    expect(await screen.findByRole("heading",{name:"Thumbnail designer"})).toBeInTheDocument();
    expect(await screen.findByText(/Saved video files could not be checked/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Retry file lookup"})).toBeEnabled();
  });

  it("links an existing storyboard to the correct owner key and flags repeated scenes",()=>{
    const board=cloneStoryboard(HVAC_EXAMPLE);
    board.beats[2].onScreenText="Equipment is only part of the installed quote";
    board.beats[1].onScreenText="Equipment is only part of the installed quote";
    saveProjectStoryboard("project-demo",board);
    const open=vi.fn();
    render(<ProductionWorkspace {...props} onOpenStoryboard={open}/>);
    fireEvent.click(stageButton("Plan Scenes"));
    expect(screen.getByRole("heading",{name:"Review your scenes"})).toBeInTheDocument();
    expect(screen.getByText(/1 potentially repeated scene/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Edit scene 3"}));
    expect(sessionStorage.getItem("contentgen:storyboard-focus-beat:v1:project-demo")).toBe("beat-installation");
    expect(open).toHaveBeenCalledWith("project-demo");
    expect(screen.getByRole("button",{name:/Looks good · Create video/})).toBeInTheDocument();
  });
  it("collects missing source evidence from Script and starts real section requests without rerunning discovery", async()=>{
    const production={id:"production-"+"a".repeat(24),projectId:"project-demo",sessionId:"session-1",ideaId:"idea-1",
      platforms:["youtube"],brief:{title:"Why insurance premiums change",topic:"Why insurance premiums change",angle:"Detailed evidence and narration direction. ".repeat(25),description:"",keywords:[],platforms:["youtube"]}};
    localStorage.setItem("contentgen:production-flow:v2:project-demo",JSON.stringify({platforms:["youtube"],sessionId:"session-1",production}));
    localStorage.setItem("contentgen:production-step:v1:"+production.id,"script");
    const evidence=[{claimId:"claim_1",claimText:"Insurance premiums change with rebuilding costs.",sourceId:"source_1",
      sourceUrl:"https://example.org/insurance",quote:"Insurance premiums change with rebuilding costs.",reviewStatus:"unverified"}];
    const sources=[{id:"source_1",title:"Insurance costs",url:evidence[0].sourceUrl,provider:"captured-web",observedAt:1792929600}];
    const calls:string[]=[];
    const generatedSections:string[]=[];
    let registeredAssets:Array<Record<string,string>>=[];
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const path=String(input);calls.push((init?.method??"GET")+" "+path);
      if(path.includes("/api/contentgen-video/assets/"))return Response.json({assets:registeredAssets});
      if(path.includes("/production-evidence/"))return Response.json({snapshot:init?.method==="POST"?
        {version:1,productionId:production.id,projectId:production.projectId,ideaId:production.ideaId,evidence,sources,warnings:[]}:null});
      if(path.endsWith("/ideas"))return Response.json({ideas:[{id:"idea-1",sessionId:"session-1",runId:"run-1",title:production.brief.title,sources:[],evidence:[]}]});
      if(path.includes("/assets/"))return Response.json({assets:[]});
      if(path.endsWith("/script-generate")) {generatedSections.push(JSON.parse(String(init?.body)).sectionId);return Response.json({narration:"Insurance premiums reflect rebuilding costs and changes in insured risks.",claimRefs:["claim_1"],sourceRefs:["source_1"]});}
      return Response.json({productions:[production]});
    }));
    render(<ProductionWorkspace {...props} catalog={{...catalog,projects:catalog.projects.map(project=>
      ({...project,notes:"A detailed project audience description and calm editorial voice. ".repeat(25)}))}}/>);
    const collect=await screen.findByRole("button",{name:"Collect sources and draft script"});
    fireEvent.click(collect);
    await waitFor(()=>expect(screen.getByText("5/5 sections")).toBeInTheDocument(),{timeout:5000});
    expect(generatedSections).toEqual(["hook","context","mechanism","practical","closing"]);
    expect(calls.some(path=>path.startsWith("POST ")&&path.includes("/production-evidence/"))).toBe(true);
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the factual claims/}));
    fireEvent.click(screen.getByRole("button",{name:"Approve script & continue"}));
    expect(await screen.findByRole("heading",{name:"Review your scenes"})).toBeInTheDocument();
    const reviewed=await screen.findByRole("button",{name:"I reviewed this claim and its sources"});
    expect(screen.getByText(evidence[0].quote,{selector:"blockquote"})).toBeInTheDocument();
    fireEvent.click(reviewed);
    expect(screen.getByText("Reviewed locally")).toBeInTheDocument();
    fireEvent.click(stageButton("Create Video"));
    expect(screen.getByRole("button",{name:/Generate draft video/i})).toBeEnabled();
    expect(screen.getByRole("button",{name:"Edit video scenes"})).toBeEnabled();
    const approved=loadScriptDraft(production.id,"youtube").draft;
    const outline=loadProjectStoryboard(production.id).board;
    expect(approved?.updatedAt).toBeTruthy();
    expect(outline).toBeTruthy();
    registeredAssets=[{id:"video-current",kind:"video",platform:"youtube",filename:"saved-draft.mp4",
      sourceRevision:productionMediaSource(approved!.updatedAt,outline!),
      downloadUrl:"/api/contentgen-video/media/run-1/video.mp4"}];
    fireEvent.click(await screen.findByRole("button",{name:"Refresh files"}));
    expect(await screen.findByRole("button",{name:"Watch & export MP4"})).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Watch & export MP4"}));
    expect(screen.getByLabelText("Saved ContentGen video draft")).toHaveAttribute("src","/api/contentgen-video/media/run-1/video.mp4");
  });

});

