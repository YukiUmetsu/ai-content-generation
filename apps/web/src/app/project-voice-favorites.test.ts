import {afterEach,describe,expect,it} from "vitest";
import {addVoiceFavorite,clearProjectVoiceData,DEFAULT_FISH_VOICE_ID,defaultProjectVoices,projectNarratorSettingsKey,
  rankVoiceFavorite,readProjectVoices,removeVoiceFavorite,saveProjectVoices,updateVoiceFavorite,
  voiceFavoritesKey} from "./project-voice-favorites";

afterEach(()=>localStorage.clear());
const second={provider:"fish" as const,voiceId:"b".repeat(32),name:"Guide",gender:"female" as const,
  situation:"conversation",language:"en"};

describe("project-scoped voice favorites",()=>{
  it("seeds the requested Fish ID first without claiming a gender or verified language",()=>{
    expect(readProjectVoices("project-one")).toEqual(defaultProjectVoices("project-one"));
    expect(readProjectVoices("project-one").voices[0]).toMatchObject({provider:"fish",voiceId:DEFAULT_FISH_VOICE_ID,
      gender:"unspecified",language:"und",situation:"narration"});
    expect(localStorage.length).toBe(0);
  });

  it("persists tags, primary/secondary rank and project isolation across reload",()=>{
    const a=addVoiceFavorite(defaultProjectVoices("project-one"),second);
    const updated=updateVoiceFavorite(a,second,{...second,situation:"character",language:"ja"});
    const ranked=rankVoiceFavorite(updated,updated.voices[1],0);
    saveProjectVoices(ranked);
    expect(readProjectVoices("project-one").voices.map(voice=>voice.voiceId)).toEqual([second.voiceId,DEFAULT_FISH_VOICE_ID]);
    expect(readProjectVoices("project-one").voices[0]).toMatchObject({situation:"character",language:"ja"});
    expect(readProjectVoices("project-two").voices[0].voiceId).toBe(DEFAULT_FISH_VOICE_ID);
    expect(removeVoiceFavorite(readProjectVoices("project-one"),second).voices).toHaveLength(1);
  });

  it("rejects duplicate provider IDs, bad Fish IDs and unknown priorities",()=>{
    const list=addVoiceFavorite(defaultProjectVoices("project-one"),second);
    expect(()=>addVoiceFavorite(list,second)).toThrow(/already saved/);
    expect(()=>addVoiceFavorite(list,{...second,voiceId:"not-a-fish-voice"})).toThrow(/invalid/);
    expect(()=>rankVoiceFavorite(list,second,999)).toThrow(/priority/);
    expect(()=>updateVoiceFavorite(list,second,{...second,voiceId:DEFAULT_FISH_VOICE_ID})).toThrow(/twice/);
  });

  it("does not silently replace a corrupted or wrong-project saved library",()=>{
    const key=voiceFavoritesKey("project-one");
    localStorage.setItem(key,"{broken-json");
    expect(()=>readProjectVoices("project-one")).toThrow(/Original|saved data/i);
    expect(localStorage.getItem(key)).toBe("{broken-json");
    localStorage.setItem(key,JSON.stringify(defaultProjectVoices("project-two")));
    expect(()=>readProjectVoices("project-one")).toThrow(/incompatible/);
    expect(()=>saveProjectVoices({...defaultProjectVoices("project-one"),voices:[
      {...second,language:"invalid locale!!"}]})).toThrow(/language/);
  });

  it("propagates quota/storage write errors without changing old records",()=>{
    const list=defaultProjectVoices("project-one");
    const store={getItem:()=>null,setItem:()=>{throw Error("Quota exceeded");}};
    expect(()=>saveProjectVoices(list,store)).toThrow(/Quota exceeded/);
    expect(localStorage.getItem(voiceFavoritesKey("project-one"))).toBeNull();
  });

  it("rejects a stale tab write instead of erasing newer project voice edits",()=>{
    const original=defaultProjectVoices("project-one");
    saveProjectVoices(original);
    saveProjectVoices(addVoiceFavorite(original,second),localStorage,original);
    expect(()=>saveProjectVoices(original,localStorage,original)).toThrow(/another tab/);
    expect(readProjectVoices("project-one").voices).toHaveLength(2);
  });

  it("deletes only the confirmed project's favorite and narrator keys",()=>{
    saveProjectVoices(defaultProjectVoices("project-one"));
    saveProjectVoices(defaultProjectVoices("project-two"));
    localStorage.setItem(projectNarratorSettingsKey("project-one"),"saved-voice-choice");
    clearProjectVoiceData("project-one");
    expect(localStorage.getItem(voiceFavoritesKey("project-one"))).toBeNull();
    expect(localStorage.getItem(projectNarratorSettingsKey("project-one"))).toBeNull();
    expect(localStorage.getItem(voiceFavoritesKey("project-two"))).not.toBeNull();
  });
});
