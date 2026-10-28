import { describe, expect, it } from "vitest";
import { DEFAULT_FISH_VOICE_ID, defaultProjectVoices } from "@/app/project-voice-favorites";
import type { CharacterDraft } from "./character-drafts-api";
import { changeCharacterVoice, readCharacterVoiceBindings, saveCharacterVoiceBindings } from "./character-voice-bindings";

const draft = (projectId: string, characterId: string, suffix: string): CharacterDraft => ({
  id: "character-draft-" + suffix.repeat(32),projectId,characterId,revision:"1",
  archiveSha256:"a".repeat(64),sizeBytes:100,status:"unverified",createdAt:"2026-10-28T00:00:00Z",
});
function storage() {
  const values = new Map<string,string>();
  return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},values};
}

describe("revision-pinned character voice choices", () => {
  it("saves one character voice independently of another character and project", () => {
    const memory=storage(), pip=draft("project-a","pip","a"), quill=draft("project-a","quill","b");
    const initial=readCharacterVoiceBindings("project-a",memory);
    const fish=defaultProjectVoices("project-a").voices[0];
    expect(fish.voiceId).toBe(DEFAULT_FISH_VOICE_ID);
    const assigned=changeCharacterVoice(initial,pip,fish);
    saveCharacterVoiceBindings(assigned,initial,memory);
    expect(readCharacterVoiceBindings("project-a",memory).bindings).toEqual([
      {draftId:pip.id,characterId:"pip",revision:"1",voice:fish},
    ]);
    expect(readCharacterVoiceBindings("project-b",memory).bindings).toEqual([]);
    const withQuill=changeCharacterVoice(assigned,quill,{...fish,voiceId:"b".repeat(32),name:"Quill voice"});
    saveCharacterVoiceBindings(withQuill,assigned,memory);
    expect(readCharacterVoiceBindings("project-a",memory).bindings).toHaveLength(2);
    const withoutPip=changeCharacterVoice(withQuill,pip,null);
    saveCharacterVoiceBindings(withoutPip,withQuill,memory);
    expect(readCharacterVoiceBindings("project-a",memory).bindings.map(item=>item.characterId)).toEqual(["quill"]);
  });

  it("rejects stale-tab writes, corrupt data and forged project ownership without overwriting it", () => {
    const memory=storage(), pip=draft("project-a","pip","a"),fish=defaultProjectVoices("project-a").voices[0];
    const initial=readCharacterVoiceBindings("project-a",memory);
    const next=changeCharacterVoice(initial,pip,fish);
    saveCharacterVoiceBindings(next,initial,memory);
    expect(()=>saveCharacterVoiceBindings(next,initial,memory)).toThrow(/another tab/);
    expect(()=>changeCharacterVoice(next,draft("project-b","pip","b"),fish)).toThrow(/different project/);
    const before=[...memory.values.values()][0];
    memory.setItem("contentgen:character-voices:v1:project-a",JSON.stringify({
      ...next,bindings:[...next.bindings,...next.bindings],
    }));
    expect(()=>readCharacterVoiceBindings("project-a",memory)).toThrow(/duplicate/);
    expect([...memory.values.values()][0]).not.toBe(before);
  });
});
