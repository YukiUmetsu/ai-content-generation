import {afterEach,describe,it,expect,vi} from "vitest";
import {parseScriptImport,applyScriptImport,saveScriptReplacement,loadScriptBackup} from "./script-import";
import {createScriptDraft,loadScriptDraft,saveScriptDraft} from "./script-review-model";
const input={productionId:"production-one",projectId:"project-one",platform:"youtube" as const,locale:"en" as const,
  title:"Accounting file preparation",viewerQuestion:"How can accountants prepare files?",audience:"Accountants",angle:"Local workflow",brandVoice:"Clear",evidenceSnapshotId:"sources"};
afterEach(()=>{localStorage.clear();vi.restoreAllMocks();});
describe("full script import",()=>{
  it("preserves numbered block inline text, paragraphs and all six sections",()=>{
    const source=Array.from({length:6},(_,i)=>`[${i+1}]Narration ${i+1}\n\nAnother paragraph ${i+1}.`).join("\n\n");
    const preview=parseScriptImport(source);
    expect(preview).toHaveLength(6);
    expect(preview[0].text).toBe("Narration 1\n\nAnother paragraph 1.");
    const next=applyScriptImport(createScriptDraft(input),preview,[]);
    expect(next.sections).toHaveLength(6);expect(next.sections[5].text).toContain("Narration 6");
    expect(next.sections.every(section=>!section.claimRefs.length&&section.history[0].origin==="manual")).toBe(true);
    expect(next.status).toBe("draft");
  });
  it("supports JSON headings, roles and multiline narration without importing identity or approval",()=>{
    const preview=parseScriptImport(JSON.stringify({sections:[{heading:"FileQuell",role:"promotion",text:"Prepare files locally.\nReview the relevant features."}]}));
    const next=applyScriptImport(createScriptDraft(input),preview,[]);
    expect(next.sections[0]).toMatchObject({heading:"FileQuell",role:"promotion"});
    expect(next.input).toEqual(input);
    expect(()=>parseScriptImport('{"status":"approved","sections":[]}')).toThrow();
  });
  it("rejects broken numbering, empty blocks, oversized text and unknown citations without changing storage",()=>{
    const original=createScriptDraft(input);saveScriptDraft(original);
    for(const source of ["[1]First\n[3]Third","[1]\n[2]Second","[1]"+"x".repeat(6501)])expect(()=>parseScriptImport(source)).toThrow();
    const preview=parseScriptImport('{"sections":[{"heading":"Source claim","text":"This needs a real source.","claimRefs":["invented"],"sourceRefs":["fake"]}]}');
    expect(()=>applyScriptImport(original,preview,[])).toThrow(/citation|reference|source/i);
    expect(loadScriptDraft(input.productionId,input.platform).draft).toEqual(original);
  });
  it("backs up the previous script before a successful replacement and refuses replacement when backup fails",()=>{
    const original=createScriptDraft(input);saveScriptDraft(original);
    const next=applyScriptImport(original,parseScriptImport("[1]An imported script that stays editable."),[]);
    saveScriptReplacement(next,original);
    expect(loadScriptBackup(input.productionId,input.platform)).toEqual(original);
    expect(loadScriptDraft(input.productionId,input.platform).draft).toEqual(next);
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("Storage full");});
    expect(()=>saveScriptReplacement(original,next)).toThrow(/Storage full/);
    expect(loadScriptDraft(input.productionId,input.platform).draft).toEqual(next);
  });
});

it("retains the original recovery copy if the active write fails during restore",()=>{
  const original=createScriptDraft(input);saveScriptDraft(original);
  const next=applyScriptImport(original,parseScriptImport("[1]My next version of the imported script."),[]);
  saveScriptReplacement(next,original);
  const write=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(function(this:Storage,key,value){
    if(key.endsWith(":youtube"))throw Error("Active write failed");
    write.call(this,key,value);
  });
  expect(()=>saveScriptReplacement(original,next)).toThrow("Active write failed");
  expect(loadScriptDraft(input.productionId,input.platform).draft).toEqual(next);
  expect(loadScriptBackup(input.productionId,input.platform)).toEqual(original);
});
