import {afterEach,expect,it} from "vitest";
import {AUDIO_PROFILE_KEY,DEFAULT_AUDIO_SETTINGS,DEFAULT_FISH_ENGINE_REVISION,
  readAudioSettings,saveAudioSettings} from "./audio-settings";
import {DEFAULT_FISH_VOICE_ID,projectNarratorSettingsKey} from "./project-voice-favorites";

afterEach(()=>localStorage.clear());

it("initializes each new project's Fish voice with the editable fish-api-v1 engine",()=>{
  expect(readAudioSettings("first")).toMatchObject({provider:"fish",voiceId:DEFAULT_FISH_VOICE_ID,
    providerRevision:DEFAULT_FISH_ENGINE_REVISION});
  const edited={...readAudioSettings("first"),providerRevision:"fish-api-v2"};
  saveAudioSettings(edited,"first");
  expect(readAudioSettings("first").providerRevision).toBe("fish-api-v2");
  expect(readAudioSettings("second").providerRevision).toBe("fish-api-v1");
});

it("keeps provider IDs and engine revisions in the project, without persisting credentials or consent",()=>{
  saveAudioSettings({...DEFAULT_AUDIO_SETTINGS,provider:"fish",voiceId:"custom-fish",
    providerRevision:"my-engine",modelId:"",endpoint:"http://127.0.0.1:8765",
    ...({apiKey:"secret",voiceConsent:true,transmitText:true} as Record<string,unknown>)},"first");
  const saved=localStorage.getItem(projectNarratorSettingsKey("first"))??"";
  expect(saved).toContain("custom-fish");
  expect(saved).toContain("my-engine");
  expect(saved).not.toContain("secret");
  expect(saved).not.toContain("voiceConsent");
  expect(saved).not.toContain("transmitText");
  expect(readAudioSettings("second").voiceId).toBe(DEFAULT_FISH_VOICE_ID);
});

it("fills missing Fish revisions with fish-api-v1, while preserving local engine choices",()=>{
  localStorage.setItem(projectNarratorSettingsKey("first"),JSON.stringify({provider:"fish",voiceId:"fish-voice",providerRevision:""}));
  localStorage.setItem(projectNarratorSettingsKey("second"),JSON.stringify({provider:"local",voiceId:"local-voice",providerRevision:""}));
  expect(readAudioSettings("first").providerRevision).toBe("fish-api-v1");
  expect(readAudioSettings("second").providerRevision).toBe("");
});

it("migrates an old profile once, without leaking it to a different project",()=>{
  localStorage.setItem(AUDIO_PROFILE_KEY,JSON.stringify({provider:"local",voiceId:"old-local",modelId:"piper"}));
  expect(readAudioSettings("first")).toMatchObject({provider:"local",voiceId:"old-local",modelId:"piper"});
  expect(readAudioSettings("second")).toMatchObject({provider:"fish",voiceId:DEFAULT_FISH_VOICE_ID});
});

it("does not break setup when a project has corrupt JSON",()=>{
  localStorage.setItem(projectNarratorSettingsKey("first"),"{invalid");
  expect(readAudioSettings("first").provider).toBe("fish");
  expect(localStorage.getItem(projectNarratorSettingsKey("first"))).toBe("{invalid");
});
