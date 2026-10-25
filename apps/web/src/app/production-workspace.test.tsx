import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneStoryboard } from "@/features/storyboard-planner/model/types";
import { HVAC_EXAMPLE } from "@/features/storyboard-planner/model/hvac-example";
import { saveProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ProductionWorkspace } from "./production-workspace";
import type { StudioCatalog } from "./catalog-model";

const catalog:StudioCatalog={version:1,activeProjectId:"project-demo",
  projects:[{id:"project-demo",name:"Margin Atlas",notes:"Explain housing costs",
    createdAt:"2026-10-24T00:00:00Z"}],content:[],assets:[],products:[]};
const noop=()=>{};
const props={locale:"en" as const,catalog,onSelectProject:noop,onOpenResearch:noop,
  onOpenStoryboard:noop,onOpenVisuals:noop,onOpenAudio:noop,onOpenExport:noop,
  onOpenNav:noop,onCreateStoryboard:()=>true,onUseVideo:()=>true};
describe("Production eight-step workspace",()=>{
  afterEach(()=>{localStorage.clear();sessionStorage.clear();vi.unstubAllGlobals();});

  it("always exposes every stage, highlights the current one and starts with Project",()=>{
    render(<ProductionWorkspace {...props}/>);
    expect(screen.getByRole("navigation",{name:"Production stages"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Setup stage"})).toHaveAttribute("aria-current","step");
    for(const name of ["Discover","Select Idea","Script","Storyboard","Produce","Optimize","Export"]){
      expect(screen.getByRole("button",{name:`${name} stage`})).toBeInTheDocument();
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
    expect(screen.getByRole("button",{name:"Select Idea stage"})).toHaveAttribute("aria-current","step");
    await waitFor(()=>expect(within(screen.getByRole("button",{name:"Discover stage"}))
      .getByText("Running")).toBeInTheDocument());
  });

  it("allows a return to any stage without clearing target platforms",()=>{
    render(<ProductionWorkspace {...props}/>);
    fireEvent.click(screen.getByRole("button",{name:"TikTok"}));
    expect(screen.getByRole("button",{name:"TikTok"})).toHaveAttribute("aria-pressed","true");
    fireEvent.click(screen.getByRole("button",{name:"Export stage"}));
    expect(screen.getByRole("button",{name:"Export stage"})).toHaveAttribute("aria-current","step");
    fireEvent.click(screen.getByRole("button",{name:"Setup stage"}));
    expect(screen.getByRole("button",{name:"TikTok"})).toHaveAttribute("aria-pressed","true");
  });

  it("links an existing storyboard to the correct owner key and flags repeated scenes",()=>{
    const board=cloneStoryboard(HVAC_EXAMPLE);
    board.beats[2].onScreenText="Equipment is only part of the installed quote";
    board.beats[1].onScreenText="Equipment is only part of the installed quote";
    saveProjectStoryboard("project-demo",board);
    const open=vi.fn();
    render(<ProductionWorkspace {...props} onOpenStoryboard={open}/>);
    fireEvent.click(screen.getByRole("button",{name:"Storyboard stage"}));
    expect(screen.getByRole("heading",{name:"Review your scenes"})).toBeInTheDocument();
    expect(screen.getByText(/1 potentially repeated scene/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Edit scene 3"}));
    expect(sessionStorage.getItem("contentgen:storyboard-focus-beat:v1:project-demo")).toBe("beat-installation");
    expect(open).toHaveBeenCalledWith("project-demo");
    expect(screen.getByRole("button",{name:"Continue to production"})).toBeInTheDocument();
  });
});

