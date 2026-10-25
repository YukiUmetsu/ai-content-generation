import {afterEach,expect,it,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProductionPanel} from "./video-production-panel";

afterEach(()=>vi.restoreAllMocks());

it("invalidates old production readiness after other editing steps without forgetting voice setup",async()=>{
  const dossier={id:"research",topic:{title:"Why repairs cost more",audience:"Homeowners"}};
  const bundle={kind:"preproduction-bundle",researchId:"research",plan:{
    shots:[{id:"shot1",onScreenText:"Hidden costs"}]
  }};
  vi.spyOn(globalThis,"fetch").mockImplementation(async (input)=>{
    const endpoint=String(input);
    if(endpoint.endsWith("/plan"))return new Response(JSON.stringify({
      schemaVersion:1,kind:"preview",job:{beats:[]},shotMap:[],warnings:[],editorialStatus:"draft"
    }),{status:200});
    if(endpoint.endsWith("/check"))return new Response(JSON.stringify({
      report:{ready:true,findings:[]}
    }),{status:200});
    throw Error("Unexpected production request: "+endpoint);
  });
  const user=userEvent.setup();
  const view=render(<ProductionPanel dossier={dossier} bundle={bundle} recheckToken={0}/>);
  await user.click(screen.getByRole("button",{name:/review renderable scenes/i}));
  await screen.findByRole("textbox",{name:"Production voice ID"});
  await user.type(screen.getByRole("textbox",{name:"Production voice ID"}),"licensed-voice");
  await user.click(screen.getByRole("button",{name:"Check readiness"}));
  await waitFor(()=>expect(screen.getByRole("button",{name:/render unverified draft mp4/i})).toBeEnabled());

  view.rerender(<ProductionPanel dossier={dossier} bundle={bundle} recheckToken={1}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:/render unverified draft mp4/i})).toBeDisabled());
  expect(screen.getByRole("textbox",{name:"Production voice ID"})).toHaveValue("licensed-voice");
  expect(screen.queryByText("Local media tools ready")).not.toBeInTheDocument();
});
