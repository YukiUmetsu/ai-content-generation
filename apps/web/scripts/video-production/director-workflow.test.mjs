import assert from "node:assert/strict";
import test from "node:test";
import {directorStages,nextDirectorStage,resolveDirectorNavigation,
  shouldInvalidateDirectorReadiness} from "./director-workflow.mjs";

test("production stages follow the order a first-time creator expects",()=>{
  assert.deepEqual(directorStages.map(stage=>stage.id),["storyboard","assets","sound","preview"]);
  assert.equal(nextDirectorStage("storyboard"),"assets");
  assert.equal(nextDirectorStage("assets"),"sound");
  assert.equal(nextDirectorStage("sound"),"preview");
  assert.equal(nextDirectorStage("preview"),null);
});

test("navigation blocks an unsaved scene change without losing its current stage",()=>{
  assert.deepEqual(resolveDirectorNavigation({current:"storyboard",target:"sound",unsaved:true}),{
    stage:"storyboard",blocked:true,
    message:"Save or discard your scene edits before continuing. Your changes are still here."
  });
  assert.deepEqual(resolveDirectorNavigation({current:"storyboard",target:"storyboard",unsaved:true}),{
    stage:"storyboard",blocked:false,message:""
  });
});

test("a saved scene can move forward, backward or directly to preview",()=>{
  for(const target of ["assets","sound","preview"]){
    assert.deepEqual(resolveDirectorNavigation({current:"storyboard",target,unsaved:false}),{
      stage:target,blocked:false,message:""
    });
  }
  assert.deepEqual(resolveDirectorNavigation({current:"preview",target:"storyboard",unsaved:false}),{
    stage:"storyboard",blocked:false,message:""
  });
});

test("an unknown stage cannot hide all workspace content",()=>{
  assert.throws(()=>resolveDirectorNavigation({current:"storyboard",target:"unknown",unsaved:false}),/stage/i);
  assert.throws(()=>nextDirectorStage("unknown"),/stage/i);
});

test("returning to production from a creative stage requires a fresh readiness check",()=>{
  assert.equal(shouldInvalidateDirectorReadiness("sound","preview"),true);
  assert.equal(shouldInvalidateDirectorReadiness("assets","preview"),true);
  assert.equal(shouldInvalidateDirectorReadiness("storyboard","preview"),true);
  assert.equal(shouldInvalidateDirectorReadiness("preview","preview"),false);
  assert.equal(shouldInvalidateDirectorReadiness("preview","sound"),false);
});
