import {describe,it,expect} from "vitest";
import {HVAC_EXAMPLE} from "./hvac-example";
import {cloneStoryboard} from "./types";
import {serializeStoryboard,parseStoryboard} from "./serialize";
import {updateTeachingMechanic,duplicateBeat} from "./edit";
import {validateStoryboard} from "./validate";
import type {TeachingMechanicPlan} from "./types";

const teaching:TeachingMechanicPlan={sequenceId:"teach_hvac",phase:"problem",mechanic:{
  version:1,operator:"split",subjectId:"hvac-system",actors:[
    {id:"hvac-system",label:"HVAC installation",role:"subject",claimIds:["claim-equipment"]},
    {id:"equipment",label:"Heating equipment",role:"part",claimIds:["claim-equipment"]},
    {id:"labor",label:"Installation labor",role:"part",claimIds:["claim-equipment"]}],
  operands:["equipment","labor"],outcomeId:"hvac-system"}};

function linked(){
  const board=cloneStoryboard(HVAC_EXAMPLE);
  // Use whatever illustrative claim ID the fixture already declares.
  const claim=board.claims[0].id;
  for(let i=0;i<3;i++){
    board.beats[i].semanticObjects.push("hvac-system");
    board.beats[i].claimRefs.push(claim);
    board.beats[i].teachingMechanic={...teaching,
      phase:(["problem","mechanism","payoff"] as const)[i],
      mechanic:{...teaching.mechanic,actors:teaching.mechanic.actors.map(a=>({...a,claimIds:[claim]}))}};
  }
  return board;
}
describe("research mechanic editorial storyboard",()=>{
  it("round-trips the original mechanic, preserving phase, actor IDs, claims and order",()=>{
    const board=linked();const parsed=parseStoryboard(serializeStoryboard(board));
    expect(parsed.ok).toBe(true);
    if(parsed.ok)expect(parsed.board.beats.slice(0,3).map(x=>x.teachingMechanic)).toEqual(board.beats.slice(0,3).map(x=>x.teachingMechanic));
  });
  it("propagates one sequence edit to all phases and leaves source immutable",()=>{
    const board=linked();const next=structuredClone(board.beats[1].teachingMechanic!);
    next.mechanic.actors[1].label="Equipment unit";
    const updated=updateTeachingMechanic(board,board.beats[1].id,next);
    expect(updated.beats.slice(0,3).map(b=>b.teachingMechanic?.mechanic.actors[1].label)).toEqual(Array(3).fill("Equipment unit"));
    expect(board.beats[0].teachingMechanic?.mechanic.actors[1].label).toBe("Heating equipment");
    expect(updated.beats.slice(0,3).map(b=>b.teachingMechanic?.phase)).toEqual(["problem","mechanism","payoff"]);
    expect(duplicateBeat(board,board.beats[0].id).beats[1].teachingMechanic?.sequenceId).toBeUndefined();
  });
  it("blocks ungrounded claims, invalid operation mappings and sequence divergence",()=>{
    const bad=linked();bad.beats[1].teachingMechanic!.mechanic.actors[1].claimIds=["invented"];
    expect(validateStoryboard(bad).some(d=>d.code==="storyboard-mechanic-claim")).toBe(true);
    const invalid=linked();invalid.beats[0].teachingMechanic!.mechanic.operands=["hvac-system","labor"];
    expect(validateStoryboard(invalid).some(d=>d.code==="storyboard-mechanic-roles")).toBe(true);
    const divergent=linked();divergent.beats[1].teachingMechanic!.mechanic.outcomeId="labor";
    expect(validateStoryboard(divergent).some(d=>d.code==="storyboard-mechanic-diverged")).toBe(true);
  });
  it("rejects injected markup on JSON import without dropping the rest of the board",()=>{
    const board=linked(),raw=JSON.parse(serializeStoryboard(board));
    raw.beats[0].teachingMechanic.mechanic.actors[1].svg="<script/>";
    const result=parseStoryboard(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if(!result.ok)expect(result.errors.some(e=>e.path.includes("teachingMechanic"))).toBe(true);
  });
});
