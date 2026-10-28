import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewVideoSetup } from "./new-video-setup";
afterEach(()=>vi.restoreAllMocks());
describe("topic-first production workflow",()=>{
  it("researches and creates a sourced draft in one action, but requires a separate editor handoff",async()=>{
    const dossier={kind:"research-dossier",id:"local-research",topic:{title:"What drives costs?",audience:"Homeowners"},
      evidence:[{id:"s1",title:"Example authoritative source",sourceUri:"https://example.org/source",
        passageLocator:"captured-text:[0,200)"}],
      claims:[{id:"c1",text:"The sourced claim still needs review.",status:"unverified",sourceRefs:["s1"]}],
      gaps:["Check applicable assumptions"]};
    const quotePreviews=[{claimId:"c1",sourceId:"s1",quote:"The exact captured passage for review."}];
    const bundle={kind:"preproduction-bundle",researchId:"local-research",status:"draft-needs-review",
      plan:{shots:[{id:"one",onScreenText:"Separate the costs",visualChange:"The cost categories appear in sequence",
        claimIds:["c1"]}],sound:[{shotId:"one",narration:"Here is why the cost changes."}]}};
    const calls:Array<{path:string;body:Record<string,unknown>}>=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async(path,options)=>{
      const body=JSON.parse(String(options?.body)) as Record<string,unknown>;
      calls.push({path:String(path),body});
      if(String(path).endsWith("/research"))return new Response(JSON.stringify({dossier,quotePreviews,warnings:[]}),{status:200});
      if(String(path).endsWith("/story"))return new Response(JSON.stringify({bundle}),{status:200});
      throw Error("Unexpected call");
    });
    const created=vi.fn();
    const user=userEvent.setup();
    render(<NewVideoSetup onGenerated={created}/>);
    const research=screen.getByRole("button",{name:"Research & generate draft"});
    expect(research).toBeDisabled();
    await user.type(screen.getByRole("textbox",{name:"New video topic"}),"Why do roofs cost so much?");
    await user.click(screen.getByRole("checkbox",{name:"Allow public web research"}));
    await user.click(research);
    expect(await screen.findByText(/Example authoritative source/)).toBeInTheDocument();
    expect(await screen.findByText(/Separate the costs/)).toBeInTheDocument();
    expect(screen.getByText(/The exact captured passage for review/)).toBeInTheDocument();
    expect(screen.getByText(/The cost categories appear in sequence/)).toBeInTheDocument();
    expect(screen.getByText(/Check applicable assumptions/)).toBeInTheDocument();
    expect(screen.getByText(/Draft — not approved/)).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
    expect(calls[0].body.allowNetwork).toBe(true);
    expect(calls.map(c=>c.path)).toEqual(["/api/contentgen-video/research","/api/contentgen-video/story"]);
    await user.click(screen.getByRole("button",{name:"Open editable storyboard"}));
    expect(created).toHaveBeenCalledWith(dossier,bundle,"topic");
    await user.clear(screen.getByRole("textbox",{name:"New video topic"}));
    expect(screen.queryByText(/Separate the costs/)).not.toBeInTheDocument();
  });
  it("keeps captured evidence if story generation fails, then retries without recapturing",async()=>{
    const dossier={kind:"research-dossier",id:"r1",topic:{title:"Cost",audience:"Homeowners"},
      evidence:[{id:"s1",title:"Public reference",sourceUri:"https://example.org/a",passageLocator:"captured-text:[0,20)"}],
      claims:[{id:"c1",text:"Candidate fact",status:"unverified",sourceRefs:["s1"]}],gaps:[]};
    const bundle={kind:"preproduction-bundle",researchId:"r1",status:"draft-needs-review",
      plan:{shots:[{id:"one",visualChange:"Shows a flow",onScreenText:"A useful flow",claimIds:["c1"]}],sound:[]}};
    let researchCalls=0,storyCalls=0;
    vi.spyOn(globalThis,"fetch").mockImplementation(async(path)=>{
      if(String(path).endsWith("/research")){researchCalls++;return new Response(JSON.stringify({dossier}),{status:200});}
      if(String(path).endsWith("/story")){
        storyCalls++;
        return storyCalls===1
          ? new Response(JSON.stringify({error:"Local model unavailable"}),{status:422})
          : new Response(JSON.stringify({bundle}),{status:200});
      }
      throw Error("Unexpected request");
    });
    const created=vi.fn(),user=userEvent.setup();
    render(<NewVideoSetup onGenerated={created}/>);
    await user.type(screen.getByRole("textbox",{name:"New video topic"}),"Roof costs");
    await user.click(screen.getByRole("checkbox",{name:"Allow public web research"}));
    await user.click(screen.getByRole("button",{name:"Research & generate draft"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Local model unavailable");
    expect(screen.getByText(/Public reference/)).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button",{name:"Retry storyboard generation"}));
    expect(await screen.findByText(/A useful flow/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(researchCalls).toBe(1);
    expect(storyCalls).toBe(2);
  });
  it("does not overlap local research when the topic changes during an in-flight request",async()=>{
    const dossier={kind:"research-dossier",id:"fresh",topic:{title:"Windows",audience:"Homeowners"},
      evidence:[],claims:[],gaps:[]};
    const bundle={kind:"preproduction-bundle",researchId:"fresh",status:"draft-needs-review",
      plan:{shots:[{id:"one",visualChange:"A comparison",onScreenText:"New topic",claimIds:[]}],sound:[]}};
    let finishFirstResearch:((response:Response)=>void)|undefined;
    const firstResearch=new Promise<Response>(resolve=>{finishFirstResearch=resolve;});
    let researchCalls=0,storyCalls=0;
    vi.spyOn(globalThis,"fetch").mockImplementation(async path=>{
      if(String(path).endsWith("/research")){
        researchCalls++;
        if(researchCalls===1)return firstResearch;
        return new Response(JSON.stringify({dossier}),{status:200});
      }
      if(String(path).endsWith("/story")){
        storyCalls++;
        return new Response(JSON.stringify({bundle}),{status:200});
      }
      throw Error("Unexpected request");
    });
    const created=vi.fn(),user=userEvent.setup();
    render(<NewVideoSetup onGenerated={created}/>);
    const topic=screen.getByRole("textbox",{name:"New video topic"});
    const start=screen.getByRole("button",{name:"Research & generate draft"});
    await user.type(topic,"Roofs");
    await user.click(screen.getByRole("checkbox",{name:"Allow public web research"}));
    await user.click(start);
    expect(researchCalls).toBe(1);
    await user.clear(topic);
    await user.type(topic,"Windows");
    expect(start).toBeDisabled();
    await user.click(start);
    expect(researchCalls).toBe(1);
    await act(async()=>{finishFirstResearch?.(new Response(JSON.stringify({dossier}),{status:200}));});
    await waitFor(()=>expect(start).toBeEnabled());
    expect(screen.queryByText(/New topic/)).not.toBeInTheDocument();
    expect(storyCalls).toBe(0);
    await user.click(start);
    expect(await screen.findByText(/New topic/)).toBeInTheDocument();
    expect(researchCalls).toBe(2);
    expect(storyCalls).toBe(1);
    expect(created).not.toHaveBeenCalled();
  });
  it("holds the local request lock until an outdated storyboard request settles",async()=>{
    const dossier={kind:"research-dossier",id:"old",topic:{title:"Roofs",audience:"Homeowners"},
      evidence:[],claims:[],gaps:[]};
    let finishStory:((response:Response)=>void)|undefined;
    const pendingStory=new Promise<Response>(resolve=>{finishStory=resolve;});
    let storyCalls=0;
    vi.spyOn(globalThis,"fetch").mockImplementation(async path=>{
      if(String(path).endsWith("/research"))return new Response(JSON.stringify({dossier}),{status:200});
      if(String(path).endsWith("/story")){
        storyCalls++;
        return pendingStory;
      }
      throw Error("Unexpected request");
    });
    const created=vi.fn(),user=userEvent.setup();
    render(<NewVideoSetup onGenerated={created}/>);
    const topic=screen.getByRole("textbox",{name:"New video topic"});
    const start=screen.getByRole("button",{name:"Research & generate draft"});
    await user.type(topic,"Roofs");
    await user.click(screen.getByRole("checkbox",{name:"Allow public web research"}));
    await user.click(start);
    await waitFor(()=>expect(storyCalls).toBe(1));
    await user.clear(topic);
    await user.type(topic,"Windows");
    expect(start).toBeDisabled();
    await act(async()=>{finishStory?.(new Response(JSON.stringify({bundle:{kind:"preproduction-bundle",
      researchId:"old",status:"draft-needs-review",plan:{shots:[{id:"one"}]}}}),{status:200}));});
    await waitFor(()=>expect(start).toBeEnabled());
    expect(screen.queryByRole("button",{name:"Open editable storyboard"})).not.toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  });
});

describe("zero-setup sample onboarding",()=>{
  it("opens a conversation-and-narration video template in one click without a research model",async()=>{
    const sample={dossier:{kind:"research-dossier",id:"demo",topic:{title:"Example",audience:"Everyone"}},
      bundle:{kind:"preproduction-bundle",researchId:"demo",plan:{shots:[{id:"hook"}],sound:[{
        shotId:"hook",speechTurns:[{id:"pip-question"},{id:"quill-reply"},{id:"narrator-explains"}]}]}}};
    const calls:string[]=[];
    vi.spyOn(globalThis,"fetch").mockImplementation(async url=>{
      calls.push(String(url));
      if(String(url).endsWith("/demo-conversation"))return new Response(JSON.stringify(sample),{status:200});
      throw Error("Conversation template attempted unexpected network requests");
    });
    const create=vi.fn(),user=userEvent.setup();
    render(<NewVideoSetup onGenerated={create}/>);
    await user.click(screen.getByRole("button",{name:"Open conversation video template"}));
    expect(create).toHaveBeenCalledWith(sample.dossier,sample.bundle,"sample");
    expect(calls).toEqual(["/api/contentgen-video/demo-conversation"]);
  });
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
