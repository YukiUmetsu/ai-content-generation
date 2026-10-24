import { describe, expect, it } from "vitest";
import { countBySeverity, validateStoryboard } from "@/features/storyboard-planner/model/validate";
import { researchToStoryboard, type ResearchDraftResult } from "./researched-storyboard";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ScenePreview } from "@/features/storyboard-planner/components/ScenePreview";

export const researchedFixture: ResearchDraftResult = {
  snapshotId:"research_home",warnings:["Claims need factual review"],
  dossier:{schemaVersion:1,kind:"research-dossier",id:"research_home",topic:{title:"Why insulation saves energy",viewerQuestion:"Why does insulation help?",audience:"Homeowners",locale:"en-US"},
    evidence:[{id:"source_01",title:"Energy research",sourceUri:"https://www.energy.gov/energysaver/insulation",retrievedAt:"2026-10-23T00:00:00.000Z",passageLocator:"captured-text:[40,80)",snapshotSha256:"a".repeat(64)}],
    claims:[{id:"claim_01",text:"Insulation resists heat flow.",status:"unverified",sourceRefs:["source_01"]}],gaps:["Savings vary by region."],review:{status:"draft"}},
  quotes:[{claimId:"claim_01",sourceId:"source_01",quote:"Insulation resists the flow of heat"}],
  plan:{schemaVersion:1,kind:"preproduction-plan",researchId:"research_home",story:{pattern:"mechanism",premise:"Show the actual heat flow",hook:"Why does your wall leak heat?",question:"Why does insulation help?",answerExplanationId:"explain_02",acts:[{id:"act_01",question:"Where does heat go?",purpose:"Teach transfer",payoff:"Heat moves"},{id:"act_02",question:"What slows it?",purpose:"Mechanism",payoff:"Insulation resistance"}]},
    explanation:[{id:"explain_01",actId:"act_01",claimIds:["claim_01"],before:"Warm room",demonstration:"Heat escapes",after:"Temperature falls"},{id:"explain_02",actId:"act_02",claimIds:["claim_01"],before:"Heat escapes",demonstration:"Add insulation to resist flow",after:"Heat flows more slowly"}],
    shots:[{id:"shot_01",explanationId:"explain_01",family:"question",purpose:"hook",subjectIds:["wall"],visualChange:"Reveal heat escaping through wall",onScreenText:"Where does heat go?",claimIds:["claim_01"],assetRefs:[]},
      {id:"shot_02",explanationId:"explain_02",family:"process",purpose:"explain",subjectIds:["wall"],visualChange:"Insulation fills cavity and fewer heat arrows cross",onScreenText:"Insulation slows heat",claimIds:["claim_01"],assetRefs:[]},
      {id:"shot_03",explanationId:"explain_02",family:"summary",purpose:"answer",subjectIds:["wall"],visualChange:"Compare wall before and after insulation",onScreenText:"Slower heat transfer",claimIds:["claim_01"],assetRefs:[]}],
    sound:[{shotId:"shot_01",narration:"Your wall may be losing heat. Why?",delivery:"curious",energy:"focused",pauseAfterMs:0,sfxIntent:null},
      {shotId:"shot_02",narration:"Insulation resists heat flowing through the wall.",delivery:"measured",energy:"focused",pauseAfterMs:200,sfxIntent:"Soft reveal"},
      {shotId:"shot_03",narration:"When heat moves more slowly, heating needs can change.",delivery:"confident",energy:"calm",pauseAfterMs:0,sfxIntent:null}],
    teachingSequences:[{id:"teach_01",mode:"direct",question:"How?",technicalSubjectId:"wall",claimIds:["claim_01"],visualStates:{before:"Heat moves freely through the wall",action:"Add insulation that resists heat flow",after:"Less heat passes through the insulated wall"},phases:[{kind:"problem",shotId:"shot_01",visualAction:"Animate heat leakage",learningChange:"Heat leaks"},{kind:"mechanism",shotId:"shot_02",visualAction:"Show resistance reducing flow",learningChange:"Insulation slows flow"},{kind:"payoff",shotId:"shot_03",visualAction:"Compare before and after",learningChange:"Less heat transfer"}]}]
  }
};

describe("research to editable semantic storyboard",()=>{
  it("carries real researched mechanic through editable beats and shows a non-HVAC planning still",()=>{
    const fixture=structuredClone(researchedFixture);
    fixture.plan.teachingSequences[0].visualMechanic={version:1,operator:"split",subjectId:"wall",
      actors:[{id:"wall",label:"Wall structure",role:"subject",claimIds:["claim_01"]},
        {id:"insulation",label:"Insulation layer",role:"part",claimIds:["claim_01"]},
        {id:"surface",label:"Wall surface",role:"part",claimIds:["claim_01"]}],
      operands:["insulation","surface"],outcomeId:"wall"};
    const board=researchToStoryboard(fixture,"project-operator","en");
    expect(board.beats.map(x=>x.teachingMechanic?.phase)).toEqual(["problem","mechanism","payoff"]);
    expect(board.beats[1].teachingMechanic?.mechanic.operator).toBe("split");
    expect(countBySeverity(validateStoryboard(board)).errors).toBe(0);
    const preview=renderToStaticMarkup(createElement(ScenePreview,{board,beat:board.beats[1],locale:"en"}));
    expect(preview).toContain('data-source-derived-mechanic="split"');
    expect(preview).toContain("Insulation layer");
    expect(preview).not.toContain("$12,400");
  });
  it("uses actual sourced claim IDs, meaningful shot narration and semantic teaching changes",()=>{
    const board=researchToStoryboard(researchedFixture,"project-research","en");
    expect(board.claims).toEqual([{id:"claim_01",status:"unverified",note:expect.stringContaining("Insulation resists"),sourceRefs:["source_01"]}]);
    expect(board.beats.map(x=>x.narration)).toEqual([
      "Your wall may be losing heat. Why?", "Insulation resists heat flowing through the wall.",
      "When heat moves more slowly, heating needs can change.",
    ]);
    expect(board.beats[1].visualObjective).toMatch(/resistance reducing flow|fewer heat arrows/i);
    expect(board.beats.every(x=>x.claimRefs.includes("claim_01"))).toBe(true);
    expect(board.beats[0].opensQuestion).toBe(board.beats.at(-1)?.answersQuestion);
    expect(board.assumptions.join(" ")).toContain("https://www.energy.gov/energysaver/insulation");
    expect(board.assumptions.join(" ")).toContain("research_home");
    expect(board.beats.map(x=>x.teachingState?.phase)).toEqual(["problem","mechanism","payoff"]);
    expect(board.beats[1].teachingState).toEqual({phase:"mechanism",subjectId:"wall",sequenceId:"teach_01",
      before:"Heat moves freely through the wall",action:"Add insulation that resists heat flow",
      after:"Less heat passes through the insulated wall"});
    expect(countBySeverity(validateStoryboard(board)).errors).toBe(0);
  });
  it("shows research-specific before/action/after and never unrelated HVAC dollar amounts",()=>{
    const board=researchToStoryboard(researchedFixture,"project-preview","en");
    const shown=renderToStaticMarkup(createElement(ScenePreview,{board,beat:board.beats[1],locale:"en"}));
    expect(shown).toContain("Add insulation that resists heat flow");
    expect(shown).toContain("Heat moves freely through the wall");
    expect(shown).not.toContain("Less heat passes through the insulated wall");
    expect(shown).not.toContain("$12,400");
    expect(shown).not.toContain("$7,100");
    const payoff=renderToStaticMarkup(createElement(ScenePreview,{board,beat:board.beats[2],locale:"en"}));
    expect(payoff).toContain("Less heat passes through the insulated wall");
  });
  it("keeps older researched plans safe and schematic without invented numbers",()=>{
    const fixture=structuredClone(researchedFixture);
    delete fixture.plan.teachingSequences[0].visualStates;
    const board=researchToStoryboard(fixture,"project-old","en");
    expect(board.beats.every(x=>x.teachingState===undefined)).toBe(true);
    const shown=renderToStaticMarkup(createElement(ScenePreview,{board,beat:board.beats[0],locale:"en"}));
    expect(shown).toContain("wall");
    expect(shown).not.toContain("$12,400");
  });
  it("accepts descriptive source-backed visual states beyond the former 48/90-character targets",()=>{
    const fixture=structuredClone(researchedFixture);
    fixture.plan.teachingSequences[0].visualStates={
      before:"A house with older insulation loses heat through visible gaps in its exterior walls.",
      action:"Add insulation into each wall cavity as animated heat-flow arrows slow down and fewer arrows pass through.",
      after:"The same house now has insulated walls with visibly fewer heat-flow arrows escaping outside.",
    };
    const board=researchToStoryboard(fixture,"project-long-states","en");
    expect(board.beats.map(beat=>beat.teachingState?.before)).toEqual(Array(3).fill(fixture.plan.teachingSequences[0].visualStates.before));
    expect(countBySeverity(validateStoryboard(board)).errors).toBe(0);
  });
  it("still rejects pathological visual-state descriptions rather than truncating them",()=>{
    const fixture=structuredClone(researchedFixture);
    fixture.plan.teachingSequences[0].visualStates!.before="x".repeat(501);
    expect(()=>researchToStoryboard(fixture,"project-oversized-states","en"))
      .toThrow(/storyboard-teaching-state-invalid/);
  });
  it("rejects plans referencing unsupported claims or unrelated dossiers",()=>{
    const unrelated=structuredClone(researchedFixture);unrelated.plan.researchId="wrong";
    expect(()=>researchToStoryboard(unrelated,"project-new","en")).toThrow(/research/i);
    const invented=structuredClone(researchedFixture);invented.plan.shots[1].claimIds=["claim_fake"];
    expect(()=>researchToStoryboard(invented,"project-new","en")).toThrow(/claim/i);
  });
});
