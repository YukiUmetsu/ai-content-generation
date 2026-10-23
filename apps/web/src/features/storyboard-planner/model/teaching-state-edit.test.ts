import {describe,expect,it} from "vitest";
import {HVAC_EXAMPLE} from "./hvac-example";
import {cloneStoryboard,type TeachingVisualState} from "./types";
import {duplicateBeat,updateTeachingState} from "./edit";
import {validateStoryboard} from "./validate";

const values={sequenceId:"teach_hvac",subjectId:"hvac-system",
  before:"Only the hardware quote is visible",action:"Reveal the installed cost categories",
  after:"The full price includes installation work"};
function linked(){
  const board=cloneStoryboard(HVAC_EXAMPLE);
  for (const beat of board.beats.slice(0,3)) {
    if (!beat.semanticObjects.includes(values.subjectId))
      beat.semanticObjects.push(values.subjectId);
  }
  board.beats[0].teachingState={...values,phase:"problem"};
  board.beats[1].teachingState={...values,phase:"mechanism"};
  board.beats[2].teachingState={...values,phase:"payoff"};
  return board;
}

describe("editable teaching sequence consistency",()=>{
  it("synchronizes shared explanatory labels without changing each beat's phase",()=>{
    const original=linked();
    const nextState:TeachingVisualState={...original.beats[1].teachingState!,after:"Installation adds labor and materials"};
    const next=updateTeachingState(original,original.beats[1].id,nextState);
    expect(next.beats.slice(0,3).map(b=>b.teachingState?.after)).toEqual([
      nextState.after,nextState.after,nextState.after]);
    expect(next.beats.slice(0,3).map(b=>b.teachingState?.phase)).toEqual([
      "problem","mechanism","payoff"]);
    expect(original.beats[0].teachingState?.after).toBe(values.after);
    expect(validateStoryboard(next).some(x=>x.code==="storyboard-teaching-state-diverged")).toBe(false);
  });
  it("catches out-of-sync imported phases and detaches copies from linked sequences",()=>{
    const board=linked();
    expect(validateStoryboard(board).some(x=>x.code==="storyboard-teaching-state-invalid")).toBe(false);
    board.beats[2].teachingState!.after="The third shot shows a different outcome";
    expect(validateStoryboard(board).some(x=>x.code==="storyboard-teaching-state-diverged")).toBe(true);
    const copied=duplicateBeat(linked(),linked().beats[0].id);
    expect(copied.beats[1].teachingState?.sequenceId).toBeUndefined();
  });
});
