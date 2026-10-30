import assert from "node:assert/strict";
import test from "node:test";
import { planRigQaCoverage } from "./rig-qa-coverage.mjs";

const chapters=[
  {id:"question",startFrame:0,endFrame:56},
  {id:"steps",startFrame:56,endFrame:95},
  {id:"compare",startFrame:95,endFrame:131}
];

test("spoken MP4 and a separate blink MP4 cover the actual seeded blink frame",()=>{
  assert.deepEqual(planRigQaCoverage({chapters,spokenChapterId:"question",
    blinkStartFrame:77,blinkDurationFrames:4}),{
    spokenChapterId:"question",blinkChapterId:"steps",blinkReviewFrames:[76,77,81]
  });
});

test("one MP4 suffices only if it also includes the entire blink transition",()=>{
  assert.deepEqual(planRigQaCoverage({chapters,spokenChapterId:"steps",
    blinkStartFrame:77,blinkDurationFrames:4}),{
    spokenChapterId:"steps",blinkChapterId:null,blinkReviewFrames:[76,77,81]
  });
});

test("rejects missing blink frames instead of publishing a misleading QA video",()=>{
  assert.throws(()=>planRigQaCoverage({chapters,spokenChapterId:"question",
    blinkStartFrame:94,blinkDurationFrames:4}),/blink.*scene|scene.*blink/i);
  assert.throws(()=>planRigQaCoverage({chapters,spokenChapterId:"question",
    blinkStartFrame:77,blinkDurationFrames:0}),/duration/i);
  assert.throws(()=>planRigQaCoverage({chapters,spokenChapterId:"missing",
    blinkStartFrame:77,blinkDurationFrames:4}),/spoken.*scene/i);
});
