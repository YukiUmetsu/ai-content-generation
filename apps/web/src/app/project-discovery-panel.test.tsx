import {afterEach,describe,it,expect,vi} from "vitest";
import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProjectDiscoveryPanel} from "./project-discovery-panel";

afterEach(()=>vi.restoreAllMocks());

describe("Project discovery author controls",()=>{
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
      if(path.endsWith("project-keyword-suggestions"))return new Response(JSON.stringify({suggestions:[{
        text:"Home insurance premium growth",kind:"topic",rationale:"Relevant homeowner cost concern"}]}),{status:200});
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
});
