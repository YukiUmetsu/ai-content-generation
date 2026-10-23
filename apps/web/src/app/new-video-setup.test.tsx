import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewVideoSetup } from "./new-video-setup";
afterEach(()=>vi.restoreAllMocks());
describe("topic-first production workflow",()=>{
  it("requires explicit public-source permission, reviews evidence, then opens an editable storyboard",async()=>{
    const dossier={kind:"research-dossier",id:"local-research",topic:{title:"What drives costs?",audience:"Homeowners"},
      evidence:[{id:"s1",title:"Example authoritative source",sourceUri:"https://example.org/source",
        passageLocator:"captured-text:[0,200)"}],
      claims:[{id:"c1",text:"The sourced claim still needs review.",status:"unverified",sourceRefs:["s1"]}],
      gaps:["Check applicable assumptions"]};
    const bundle={kind:"preproduction-bundle",researchId:"local-research",plan:{shots:[{id:"one"}]}};
    const calls:Array<{path:string;body:Record<string,unknown>}>=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(path,options)=>{
      const body=JSON.parse(String(options?.body)) as Record<string,unknown>;
      calls.push({path:String(path),body});
      if(String(path).endsWith("/research"))return new Response(JSON.stringify({dossier,warnings:[]}),{status:200});
      if(String(path).endsWith("/story"))return new Response(JSON.stringify({bundle}),{status:200});
      throw Error("Unexpected call");
    });
    const created=vi.fn();
    const user=userEvent.setup();
    render(<NewVideoSetup onGenerated={created}/>);
    const research=screen.getByRole("button",{name:"Research this topic"});
    expect(research).toBeDisabled();
    await user.type(screen.getByRole("textbox",{name:"New video topic"}),"Why do roofs cost so much?");
    await user.click(screen.getByRole("checkbox",{name:"Allow public web research"}));
    await user.click(research);
    expect(await screen.findByText(/Example authoritative source/)).toBeInTheDocument();
    expect(screen.getByText(/UNVERIFIED:/)).toBeInTheDocument();
    expect(calls[0].body.allowNetwork).toBe(true);
    await user.click(screen.getByRole("button",{name:"Generate editable storyboard"}));
    expect(created).toHaveBeenCalledWith(dossier,bundle,"topic");
    expect(calls[1].path).toMatch(/\/story$/);
  });
});

describe("zero-setup sample onboarding",()=>{
  it("loads the built-in sample with one click and requires no files, voice or research settings",async()=>{
    const sample={dossier:{kind:"research-dossier",id:"demo",topic:{title:"Example",audience:"Everyone"}},
      bundle:{kind:"preproduction-bundle",researchId:"demo",plan:{shots:[{id:"hook"}]}}};
    const calls:string[]=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async url=>{
      calls.push(String(url));
      if(String(url).endsWith("/demo"))return new Response(JSON.stringify(sample),{status:200});
      throw Error("Sample attempted an unexpected network/service request");
    });
    const create=vi.fn(),user=userEvent.setup();
    render(<NewVideoSetup onGenerated={create}/>);
    const start=screen.getByRole("button",{name:"Open interactive sample"});
    expect(start).toBeEnabled();
    await user.click(start);
    expect(create).toHaveBeenCalledWith(sample.dossier,sample.bundle,"sample");
    expect(calls).toEqual(["/api/contentgen-video/demo"]);
  });
  it("reports a missing/broken sample clearly instead of leaving an empty editor",async()=>{
    vi.spyOn(globalThis,"fetch").mockResolvedValue(
      new Response(JSON.stringify({error:"Demo unavailable"}),{status:422}));
    const create=vi.fn(),user=userEvent.setup();
    render(<NewVideoSetup onGenerated={create}/>);
    await user.click(screen.getByRole("button",{name:"Open interactive sample"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Demo unavailable");
    expect(create).not.toHaveBeenCalled();
  });
});
