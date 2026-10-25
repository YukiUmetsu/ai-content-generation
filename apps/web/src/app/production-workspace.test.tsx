import { afterEach, describe, expect, it, vi } from "vitest";
import { cloneStoryboard } from "@/features/storyboard-planner/model/types";
import { HVAC_EXAMPLE } from "@/features/storyboard-planner/model/hvac-example";
import { saveProjectStoryboard } from "@/features/storyboard-planner/model/project-storage";
import { fireEvent, render, screen } from "@testing-library/react";
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
