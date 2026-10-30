import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { App } from "@/App";

// Exercise the real Shell navigation with a small stateful editor stand-in:
// the contract under test is retaining its DOM instance across Jobs, not TTS.
vi.mock("./production-workspace", () => ({
  ProductionWorkspace: ({directorEntry,onOpenDraft,onOpenJobs,onDirectorDirtyChange,workspaceId}:
    {directorEntry?:{projectId:string}|null;onOpenDraft:()=>void;onOpenJobs:()=>void;
      onDirectorDirtyChange?:(dirty:boolean)=>void;workspaceId?:string|null}) => {
    const [scene,setScene]=useState("Original scene");
    return <section id={workspaceId??undefined} aria-label="Guided production">
      <label htmlFor="scene-test">Scene draft</label>
      <input id="scene-test" value={scene} onChange={event=>setScene(event.target.value)}/>
      <button onClick={onOpenDraft}>Open inline editor</button>
      <button onClick={onOpenJobs}>Inspect in Jobs</button>
      <button onClick={()=>onDirectorDirtyChange?.(true)}>Mark unsaved</button>
      <button onClick={()=>onDirectorDirtyChange?.(false)}>Mark saved</button>
      <span>{directorEntry?"Director mounted":"No director"}</span>
    </section>;
  },
}));
vi.mock("./jobs-workspace",()=>({
  JobsWorkspace:()=> <section id="workspace" aria-label="Jobs & QA">Tracked production jobs</section>,
}));

describe("Production ↔ Jobs continuity",()=>{
  it("keeps the same editor input and visible skip-link target after a Jobs roundtrip",()=>{
    render(<App/>);
    fireEvent.click(screen.getByRole("button",{name:"Open inline editor"}));
    const field=screen.getByRole("textbox",{name:"Scene draft"});
    fireEvent.change(field,{target:{value:"Saved scene context"}});
    fireEvent.click(screen.getByRole("button",{name:"Inspect in Jobs"}));
    expect(screen.getByRole("region",{name:"Jobs & QA"})).toBeInTheDocument();
    expect(document.getElementById("workspace")).toHaveAttribute("aria-label","Jobs & QA");
    expect(field).toHaveValue("Saved scene context");
    expect(field.closest("[inert]")).toHaveAttribute("aria-hidden","true");
    fireEvent.click(screen.getByRole("link",{name:"Production"}));
    expect(screen.getByRole("textbox",{name:"Scene draft"})).toBe(field);
    expect(field).toHaveValue("Saved scene context");
    expect(screen.getByText("Director mounted")).toBeInTheDocument();
    expect(document.getElementById("workspace")).toHaveAttribute("aria-label","Guided production");
  });

  it("allows Jobs while a scene is dirty, then blocks routes that would actually unmount the editor",()=>{
    render(<App/>);
    fireEvent.click(screen.getByRole("button",{name:"Open inline editor"}));
    const field=screen.getByRole("textbox",{name:"Scene draft"});
    fireEvent.change(field,{target:{value:"Unsaved line"}});
    fireEvent.click(screen.getByRole("button",{name:"Mark unsaved"}));
    fireEvent.click(screen.getByRole("link",{name:"Jobs & QA"}));
    expect(screen.getByText("Tracked production jobs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link",{name:"Research"}));
    expect(screen.getByRole("alert")).toHaveTextContent(/Save or discard the edited scene/);
    expect(screen.getByText("Tracked production jobs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link",{name:"Production"}));
    expect(screen.getByRole("textbox",{name:"Scene draft"})).toBe(field);
    expect(field).toHaveValue("Unsaved line");
    fireEvent.click(screen.getByRole("link",{name:"Research"}));
    expect(screen.getByRole("alert")).toHaveTextContent(/Save or discard the edited scene/);
    expect(screen.queryByText("Tracked production jobs")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Mark saved"}));
    fireEvent.click(screen.getByRole("link",{name:"Research"}));
    expect(screen.queryByRole("textbox",{name:"Scene draft"})).not.toBeInTheDocument();
  });
});
