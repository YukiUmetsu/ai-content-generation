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
    expect(created).toHaveBeenCalledWith(dossier,bundle);
    expect(calls[1].path).toMatch(/\/story$/);
  });
});
