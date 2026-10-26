import { describe, expect, it } from "vitest";
import { approveScriptDraft, createScriptDraft, fillScriptSection, insertScriptSection, type ScriptEvidence } from "./script-review-model";
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
  it("preserves an appended unsourced promotion as a separate unverified scene after the answer",()=>{
    const draft=insertScriptSection(approvedScript(),"closing","after",{heading:"FileQuell",role:"promotion",
      purpose:"Explain the FileQuell workflow and invite viewers to review the product.",text:"See whether FileQuell fits your accounting file preparation workflow."});
    const board=scriptToStoryboard(approveScriptDraft(draft),evidence);
    expect(board.beats).toHaveLength(6);
    expect(board.beats[5].narration).toContain("FileQuell");
    expect(board.beats[4].answersQuestion).toBe("script-central-question");
    expect(board.claims.find(claim=>board.beats[5].claimRefs.includes(claim.id))).toMatchObject({status:"unverified",sourceRefs:[]});
    expect(validateStoryboard(board).filter(issue=>issue.severity==="error")).toEqual([]);
  });

});


it("does not assign an unrelated captured source to an uncited section with a colliding placeholder ID",()=>{
  const draft=insertScriptSection(approvedScript(),"closing","after",{heading:"Manual note",purpose:"A manually written extra message for the audience.",text:"This manual paragraph has no supporting captured source."});
  const id=draft.sections.at(-1)!.id;
  const colliding={...evidence[0],claimId:`manual_${id}`};
  const board=scriptToStoryboard(approveScriptDraft(draft),[...evidence,colliding]);
  const claim=board.claims.find(item=>board.beats.at(-1)!.claimRefs.includes(item.id));
  expect(claim?.sourceRefs).toEqual([]);
});

it("keeps a sole main section's answer separate from a trailing promotion",()=>{
  const script=approvedScript();
  script.sections=[script.sections[4],{...script.sections[1],id:"section-promo",role:"promotion"}];
  const board=scriptToStoryboard(script,evidence);
  expect(board.beats[0].answersQuestion).toBe("script-central-question");
  expect(board.beats[0].namedEvents).toContain("script-answer-reveals");
  expect(board.beats[1].answersQuestion).toBeUndefined();
});
