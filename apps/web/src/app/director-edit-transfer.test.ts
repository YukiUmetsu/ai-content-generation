import {describe,expect,it} from "vitest";
import {transferableDirectorEdits} from "./director-edit-transfer";

const digest="a".repeat(64);
const base={kind:"preproduction-bundle",researchId:"research-1",researchSha256:digest,planSha256:"b".repeat(64),plan:{
  shots:[{id:"hook",purpose:"opening",family:"question",onScreenText:"Question",visualChange:"A house"},
    {id:"middle",purpose:"explanation",family:"process",onScreenText:"Cost breakdown",visualChange:"Three costs"},
    {id:"end",purpose:"closing",family:"summary",onScreenText:"Takeaway",visualChange:"Summary"}],
  sound:[{shotId:"hook",narration:"Opening",sfxIntent:null,pauseAfterMs:160},
    {shotId:"middle",narration:"Property costs add up",sfxIntent:null,pauseAfterMs:160},
    {shotId:"end",narration:"Remember the total",sfxIntent:null,pauseAfterMs:160}],
  teachingSequences:[{phases:[{shotId:"hook",visualAction:"Question"},
    {shotId:"middle",visualAction:"Reveal costs"},
    {shotId:"end",visualAction:"Summarize"}]}]
}};

describe("Director edit transfer across script regenerations",()=>{
  it("keeps only deliberate edits whose original fields are unchanged",()=>{
    const edited=structuredClone(base);
    edited.plan.shots[1].onScreenText="All the hidden costs";
    edited.plan.sound[1].narration="Your additional bills matter";
    edited.plan.sound[1].pauseAfterMs=900;
    const next=structuredClone(base);
    next.planSha256="c".repeat(64);
    next.plan.sound[1].narration="The regenerated voiceover changed";
    const result=transferableDirectorEdits(base,edited,next);
    expect(result).toEqual({patches:[{shotId:"middle",changes:{onScreenText:"All the hidden costs",pauseAfterMs:900}}],skipped:1});
    expect(next.plan.sound[1].narration).toBe("The regenerated voiceover changed");
    expect(base.plan.shots[1].onScreenText).toBe("Cost breakdown");
  });
  it("does not copy choices to repurposed scenes or a different research source",()=>{
    const edited=structuredClone(base);
    edited.plan.shots[1].onScreenText="Adjusted";
    const repurposed=structuredClone(base);
    repurposed.plan.shots[1].purpose="different story beat";
    expect(transferableDirectorEdits(base,edited,repurposed)).toEqual({patches:[],skipped:1});
    const unrelated=structuredClone(base);
    unrelated.researchSha256="d".repeat(64);
    expect(transferableDirectorEdits(base,edited,unrelated)).toEqual({patches:[],skipped:0});
  });
  it("rejects malformed sessions and duplicate scene identifiers",()=>{
    const edited=structuredClone(base);
    edited.plan.shots[1].onScreenText="Adjusted";
    const invalid=structuredClone(base);
    invalid.plan.shots[2].id="middle";
    expect(transferableDirectorEdits(base,edited,invalid).patches).toEqual([]);
    expect(transferableDirectorEdits({},edited,base).patches).toEqual([]);
    expect(transferableDirectorEdits(base,{...edited,researchId:"wrong"},base).patches).toEqual([]);
  });
  it("does not override generated new values or reapply a choice already present",()=>{
    const edited=structuredClone(base);
    edited.plan.shots[1].onScreenText="Edited title";
    const next=structuredClone(base);
    next.plan.shots[1].onScreenText="Edited title";
    expect(transferableDirectorEdits(base,edited,next)).toEqual({patches:[],skipped:0});
    next.plan.shots[1].onScreenText="New title";
    expect(transferableDirectorEdits(base,edited,next)).toEqual({patches:[],skipped:1});
  });
});
