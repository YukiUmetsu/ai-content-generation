import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProductionWorkspace } from "./production-workspace";
import type { StudioCatalog } from "./catalog-model";

const catalog:StudioCatalog = {
  version:1,activeProjectId:"project-demo",
  projects:[{id:"project-demo",name:"Heat pump installation",notes:"Explain the costs",
    createdAt:"2026-10-24T00:00:00Z"}],
  content:[],assets:[],products:[],
};
const noop=()=>{};
function show(){
  return render(<ProductionWorkspace locale="en" catalog={catalog} onSelectProject={noop}
    onOpenResearch={noop} onOpenStoryboard={noop}
    onOpenVisuals={noop} onOpenAudio={noop} onOpenExport={noop}
    onOpenNav={noop} onCreateStoryboard={()=>true} onUseVideo={()=>true}/>);
}
describe("guided production screen",()=>{
  it("shows the six honest steps and does not assume media is ready",()=>{
    show();
    expect(screen.getByRole("navigation",{name:"Production stages"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"Brief stage"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"Research stage"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"Storyboard stage"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"Visuals stage"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"Audio stage"})).toBeTruthy();
    expect(screen.getByRole("button",{name:"Preview & Export stage"})).toBeTruthy();
  });
  it("allows navigation to an unfinished step and exposes an actionable tool link",()=>{
    const open=vi.fn();
    render(<ProductionWorkspace locale="en" catalog={catalog} onSelectProject={noop}
      onOpenResearch={noop} onOpenStoryboard={noop}
      onOpenVisuals={open} onOpenAudio={noop} onOpenExport={noop}
      onOpenNav={noop} onCreateStoryboard={()=>true} onUseVideo={()=>true}/>);
    fireEvent.click(screen.getByRole("button",{name:"Visuals stage"}));
    fireEvent.click(screen.getByRole("button",{name:"Open visual tools"}));
    expect(open).toHaveBeenCalledOnce();
  });
});
