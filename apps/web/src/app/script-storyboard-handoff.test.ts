import { describe, expect, it } from "vitest";
import { approveScriptDraft, createScriptDraft, fillScriptSection, type ScriptEvidence } from "./script-review-model";
import { scriptToStoryboard } from "./script-storyboard-handoff";
import { validateStoryboard } from "@/features/storyboard-planner/model/validate";

const evidence:ScriptEvidence[]=[{claimId:"claim_1",claimText:"Captured claim passage",sourceId:"source_1",
  sourceUrl:"https://example.org/report",quote:"Captured claim passage",reviewStatus:"unverified"}];

function approvedScript(){
  let draft=createScriptDraft({productionId:"production_123456789012345678901234",projectId:"project-demo",
    platform:"youtube",locale:"en",title:"Why home insurance costs more",viewerQuestion:"Why is the premium rising?",
    audience:"Homeowners",angle:"The hidden pressure on prices",brandVoice:"Calm, factual",evidenceSnapshotId:"sources-x"});
  for(const section of draft.sections){
    draft=fillScriptSection(draft,section.id,{narration:`${section.heading} explains the insurance topic with evidence and limits so viewers understand how to investigate.`,
      claimRefs:["claim_1"],sourceRefs:["source_1"]},0);
  }
  return approveScriptDraft(draft);
}

describe("script-to-storyboard editable handoff",()=>{
  it("turns an approved script into a validated outline with exact narration and unverified claims",()=>{
    const script=approvedScript();
    const board=scriptToStoryboard(script,evidence);
    expect(board.beats).toHaveLength(script.sections.length);
    expect(board.beats.map(b=>b.narration)).toEqual(script.sections.map(s=>s.text));
    expect(board.claims[0]).toMatchObject({id:"claim_1",status:"unverified",sourceRefs:["source_1"]});
    expect(board.beats[0].role).toBe("hook");
    expect(board.beats.at(-1)?.role).toBe("takeaway");
    expect(validateStoryboard(board).filter(issue=>issue.severity==="error")).toEqual([]);
  });

  it("refuses to replace anything from an unapproved or empty script",()=>{
    expect(()=>scriptToStoryboard({...approvedScript(),status:"draft",approvedAt:null},evidence)).toThrow(/approve a complete script/i);
  });
});

