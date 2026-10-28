import {afterEach,expect,it,vi} from "vitest";
import {defaultProjectVoices} from "@/app/project-voice-favorites";
import {loadSavedCharacterVoices,writeSavedCharacterVoices} from "./character-voice-bindings-api";
import {changeCharacterVoice,readCharacterVoiceBindings} from "./character-voice-bindings";

afterEach(()=>{vi.restoreAllMocks();localStorage.clear();});
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
const projectId="project-a";
const draft={id:"character-draft-"+"a".repeat(32),projectId,characterId:"pip",revision:"v1",
  archiveSha256:"e".repeat(64),sizeBytes:100,status:"unverified" as const,createdAt:"2026-10-28T00:00:00Z"};

it("round-trips pinned character voice metadata with server revisions and no synthesis request",async()=>{
  const empty=readCharacterVoiceBindings(projectId);
  const assigned=changeCharacterVoice(empty,draft,defaultProjectVoices(projectId).voices[0]);
  const calls:RequestInit[]=[];
  vi.spyOn(globalThis,"fetch").mockImplementation(async(url,init)=>{
    expect(String(url)).toContain("/api/character-voices/project-a");
    calls.push(init??{});
    if(init?.method==="PUT")return reply({revision:1,registry:assigned});
    return reply({revision:0,registry:null});
  });
  expect(await loadSavedCharacterVoices(projectId)).toEqual({revision:0,registry:null});
  const saved=await writeSavedCharacterVoices(projectId,0,assigned);
  expect(saved.registry?.bindings[0].voice.voiceId).toBe(defaultProjectVoices(projectId).voices[0].voiceId);
  expect(calls.map(init=>init.method)).toEqual(["GET","PUT"]);
  expect((calls[1].headers as Record<string,string>)["X-Contentgen-Character-Voices"]).toBe("local-only");
});

it("rejects forged cross-project responses, stale writes and offline failures",async()=>{
  const empty=readCharacterVoiceBindings(projectId);
  vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(reply({revision:2,registry:{...empty,projectId:"project-b"}}));
  await expect(loadSavedCharacterVoices(projectId)).rejects.toThrow(/incompatible/);
  vi.spyOn(globalThis,"fetch").mockResolvedValueOnce(reply({error:{message:"stale"}},409));
  await expect(writeSavedCharacterVoices(projectId,1,empty)).rejects.toThrow(/another editor/);
  vi.spyOn(globalThis,"fetch").mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(loadSavedCharacterVoices(projectId)).rejects.toThrow(/local Rust server/);
  expect(localStorage.length).toBe(0);
});
