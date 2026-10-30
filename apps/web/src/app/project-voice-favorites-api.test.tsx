import {afterEach,expect,it,vi} from "vitest";
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProjectVoiceFavoritesPanel} from "./project-voice-favorites-panel";
import {addVoiceFavorite,defaultProjectVoices,readProjectVoices,saveProjectVoices} from "./project-voice-favorites";
import {loadSavedProjectVoices,writeSavedProjectVoices} from "./project-voice-favorites-api";

afterEach(()=>{localStorage.clear();vi.restoreAllMocks();});
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});
const extra={provider:"local" as const,voiceId:"two",name:"Conversation",gender:"female" as const,situation:"dialogue",language:"en"};

it("seeds SQLite on first use, promotes browser favorites and persists edits with revision compare",async()=>{
  const remote:{current:{revision:number;library:unknown}|null}={current:null};
  vi.spyOn(globalThis,"fetch").mockImplementation(async(_url,init)=>{
    if(init?.method!=="PUT")return response(remote.current??{revision:0,library:null});
    const body=JSON.parse(String(init.body)) as {revision:number;library:unknown};
    if(body.revision!==(remote.current?.revision??0))return response({error:{message:"stale"}},409);
    remote.current={revision:body.revision+1,library:body.library};return response(remote.current);
  });
  saveProjectVoices(addVoiceFavorite(defaultProjectVoices("project-one"),extra));
  const user=userEvent.setup();
  render(<ProjectVoiceFavoritesPanel projectId="project-one" selectedVoice={{provider:"fish",voiceId:"6ab4c6b0f37f4243a99046478647be94"}} onUseVoice={vi.fn()}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Add voice"})).toBeEnabled());
  expect(remote.current?.revision).toBe(1);
  expect(remote.current?.library).toEqual(readProjectVoices("project-one"));
  await user.click(screen.getByRole("button",{name:"Make primary"}));
  await waitFor(()=>expect(readProjectVoices("project-one").voices[0].voiceId).toBe("two"));
  expect(remote.current?.revision).toBe(2);
});

it("does not silently overwrite differing browser or server favorites; requires explicit reconciliation",async()=>{
  const remoteLibrary=addVoiceFavorite(defaultProjectVoices("project-one"),extra);
  saveProjectVoices(defaultProjectVoices("project-one"));
  vi.spyOn(globalThis,"fetch").mockImplementation(async(_url,init)=>{
    if(init?.method!=="PUT")return response({revision:3,library:remoteLibrary});
    throw Error("No write was authorized");
  });
  const user=userEvent.setup();
  render(<ProjectVoiceFavoritesPanel projectId="project-one" selectedVoice={{provider:"fish",voiceId:"6ab4c6b0f37f4243a99046478647be94"}} onUseVoice={vi.fn()}/>);
  expect(await screen.findByRole("alert")).toHaveTextContent(/different saved voices/i);
  expect(screen.getByRole("button",{name:"Add voice"})).toBeDisabled();
  expect(readProjectVoices("project-one").voices).toHaveLength(1);
  await user.click(screen.getByRole("button",{name:"Use server favorites"}));
  expect(readProjectVoices("project-one").voices).toHaveLength(2);
  expect(screen.getByRole("button",{name:"Add voice"})).toBeEnabled();
});

it("preserves local voices on HTTP failure, reports the error and does not allow editing",async()=>{
  vi.spyOn(globalThis,"fetch").mockResolvedValue(response({error:{message:"Storage offline"}},503));
  render(<ProjectVoiceFavoritesPanel projectId="project-one" selectedVoice={{provider:"fish",voiceId:"6ab4c6b0f37f4243a99046478647be94"}} onUseVoice={vi.fn()}/>);
  expect(await screen.findByRole("alert")).toHaveTextContent(/503/);
  expect(screen.getByRole("button",{name:"Add voice"})).toBeDisabled();
  expect(screen.getByRole("button",{name:"Retry sync"})).toBeEnabled();
  expect(readProjectVoices("project-one")).toEqual(defaultProjectVoices("project-one"));
});

it("rejects malformed remote documents and stale server revisions without changing browser data",async()=>{
  vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(response({revision:1,library:{...defaultProjectVoices("project-one"),projectId:"other"}}));
  await expect(loadSavedProjectVoices("project-one")).rejects.toThrow(/incompatible/);
  vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(response({error:{message:"stale"}},409));
  await expect(writeSavedProjectVoices("project-one",1,defaultProjectVoices("project-one"))).rejects.toThrow(/another editor/);
  expect(localStorage.length).toBe(0);
});
