import test from "node:test";
import assert from "node:assert/strict";
import {sampleTeachingTransition} from "./teaching-state-transition.mjs";

test("problem establishes its initial state without spoiling the result",()=>{
  const state=sampleTeachingTransition({phase:"problem",progress:0.65});
  assert.equal(state.beforeVisible,true);
  assert.equal(state.actionVisible,false);
  assert.equal(state.afterVisible,false);
  assert.equal(state.travelProgress,0);
});
test("mechanism moves the same subject toward an unrevealed conclusion",()=>{
  const start=sampleTeachingTransition({phase:"mechanism",progress:0});
  const middle=sampleTeachingTransition({phase:"mechanism",progress:0.52});
  const end=sampleTeachingTransition({phase:"mechanism",progress:1});
  assert.equal(start.actionVisible,false);
  assert.equal(middle.actionVisible,true);
  assert.ok(middle.travelProgress>0&&middle.travelProgress<1);
  assert.equal(end.travelProgress,1);
  assert.equal(end.afterVisible,false);
  assert.deepEqual(sampleTeachingTransition({phase:"mechanism",progress:0.52}),middle);
});
test("payoff event frame stays hidden, then visibly answers the teaching question",()=>{
  const locked=sampleTeachingTransition({phase:"payoff",progress:0,payoffLocked:true});
  assert.equal(locked.beforeVisible,false);
  assert.equal(locked.afterVisible,false);
  assert.equal(locked.actionVisible,false);
  const revealed=sampleTeachingTransition({phase:"payoff",progress:0.42,payoffLocked:false});
  assert.equal(revealed.beforeVisible,true);
  assert.equal(revealed.afterVisible,true);
  assert.ok(revealed.afterOpacity>0);
});
test("invalid clocks and unknown phases cannot reach rendered SVG",()=>{
  assert.throws(()=>sampleTeachingTransition({phase:"flying",progress:0.5}),/phase/);
  assert.throws(()=>sampleTeachingTransition({phase:"problem",progress:2}),/progress/);
});
