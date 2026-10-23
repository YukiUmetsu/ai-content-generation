import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { compilePreproductionBundle } from "./preproduction.mjs";
import { compileAnimatic, sampleAnimatic } from "./animatic.mjs";
import { renderAnimaticHtml } from "./animatic-player.mjs";
import { parseAnimaticArgs, runAnimaticCli } from "./animatic-cli.mjs";

const fixture = name => JSON.parse(readFileSync(new URL("../../../../examples/"+name,import.meta.url),"utf8"));
const prepared = () => compilePreproductionBundle(
  fixture("preproduction-research-smoke.json"),fixture("preproduction-plan-smoke.json"));

test("produces real frame-timed instructional arcs without voice or final rendering",()=>{
  const bundle=prepared(),a=compileAnimatic(bundle);
  assert.equal(a.kind,"progressive-teaching-animatic");
  assert.equal(a.shots.length,3);
  assert.deepEqual(a.shots.map(s=>s.phase),["problem","mechanism","payoff"]);
  assert.equal(a.shots[0].startFrame,0);
  assert.equal(a.shots[1].startFrame,a.shots[0].endFrame);
  assert.equal(a.shots[2].startFrame,a.shots[1].endFrame);
  assert.equal(a.shots.at(-1).endFrame,a.totalFrames);
  assert.match(a.timingBasis,/Estimated from text/);
  assert.match(a.reviewStatus,/DRAFT/);
  assert.match(a.caveat,/not final Kumiki scenes/);
  assert.ok(a.soundCues.length>0);
  assert.ok(a.soundCues.every(cue=>a.shots.some(s=>s.shotId===cue.shotId&&cue.frame>=s.startFrame&&cue.frame<s.endFrame)));
  assert.equal(a.shots[0].revealFrames.length,3);
  assert.deepEqual(a.shots[0].claimIds,["claim_illustrative"]);
});

test("reveal timing and continuous motion are deterministic at any absolute frame",()=>{
  const a=compileAnimatic(prepared(),{fps:30});
  const shot=a.shots[1],before=sampleAnimatic(a,shot.startFrame);
  const after=sampleAnimatic(a,shot.revealFrames[0]+10);
  assert.equal(before.revealed,0);
  assert.ok(after.revealed>=1);
  assert.equal(after.revealAlpha[0],1);
  assert.notEqual(sampleAnimatic(a,shot.startFrame+20).subjectDrift,
    sampleAnimatic(a,shot.startFrame+24).subjectDrift);
  const arbitrary=sampleAnimatic(a,shot.startFrame+26);
  assert.deepEqual(arbitrary,sampleAnimatic(a,shot.startFrame+26));
  assert.ok(arbitrary.trailProgress>=0&&arbitrary.trailProgress<=1);
  assert.throws(()=>sampleAnimatic(a,-1),/within/);
  assert.throws(()=>sampleAnimatic(a,a.totalFrames),/within/);
});

test("cannot render an obsolete, invented or tampered source plan",()=>{
  const b=prepared();
  const h=createHash("sha256").update(JSON.stringify(b.plan)).digest("hex");
  assert.equal(b.planSha256,h);
  b.plan.shots[0].onScreenText="An unsupported replacement promise";
  assert.throws(()=>compileAnimatic(b),/changed after bundle validation/);
  const b2=prepared();delete b2.plan.teachingSequences;
  b2.planSha256=createHash("sha256").update(JSON.stringify(b2.plan)).digest("hex");
  assert.throws(()=>compileAnimatic(b2),/requires research-linked teaching sequences/);
  const b3=prepared();b3.kind="unvalidated-video";
  assert.throws(()=>compileAnimatic(b3),/Expected bounded/);
  assert.throws(()=>compileAnimatic(prepared(),{spokenWpm:15}),/Expected bounded/);
});

test("single-file HTML is offline, bounded, escaped and contains usable accessibility controls",()=>{
  const a=compileAnimatic(prepared());
  a.shots[0].learningChange='</script><img src=x onerror=alert(1)>';
  const html=renderAnimaticHtml(a);
  assert.match(html,/<svg id="frame"/);
  assert.match(html,/type="application\/json" id="animatic-data"/);
  assert.match(html,/requestAnimationFrame\(tick\)/);
  assert.match(html,/Web Audio cues are placeholders/);
  assert.match(html,/aria-label="Seek animatic frame"/);
  assert.match(html,/prefers-reduced-motion/);
  assert.doesNotMatch(html,/<img src=x onerror=/);
  assert.doesNotMatch(html,/<script src=/);
  assert.match(html,/\\u003c\/script\\u003e/);
  assert.doesNotMatch(html,/https:\/\/.*src=/);
});

test("portable browser animatic can scrub to a different phase and shows original narration",()=>{
  const a=compileAnimatic(prepared());
  const errors=[];
  const console=new VirtualConsole();
  console.on("jsdomError",e=>errors.push(String(e)));
  const dom=new JSDOM(renderAnimaticHtml(a),{runScripts:"dangerously",pretendToBeVisual:true,
    virtualConsole:console,url:"http://127.0.0.1:9999/"});
  try{
    const {document,Event}=dom.window;
    assert.ok(document.querySelector("#frame svg")==null);
    assert.equal(document.querySelectorAll("#shots button").length,3);
    assert.match(document.querySelector("#phase").textContent,/PROBLEM/);
    assert.equal(document.querySelector("#narration").textContent,a.shots[0].narration);
    const first=document.querySelector("#frame").innerHTML;
    const range=document.getElementById("scrub");
    range.value=String(a.shots[1].startFrame+20);
    range.dispatchEvent(new Event("input",{bubbles:true}));
    assert.match(document.querySelector("#phase").textContent,/MECHANISM/);
    assert.equal(document.querySelector("#narration").textContent,a.shots[1].narration);
    const later=document.querySelector("#frame").innerHTML;
    assert.notEqual(first,later);
    range.value="0";range.dispatchEvent(new Event("input",{bubbles:true}));
    assert.equal(document.querySelector("#frame").innerHTML,first);
    assert.equal(document.querySelector("#sound").getAttribute("aria-pressed"),"false");
    document.querySelectorAll("#shots button")[2].click();
    assert.match(document.querySelector("#phase").textContent,/PAYOFF/);
    assert.deepEqual(errors,[]);
  } finally {dom.window.close();}
});

test("CLI writes one private preview and never overwrites old review files",async t=>{
  const dir=await mkdtemp(join(tmpdir(),"contentgen-animatic-"));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const src=join(dir,"bundle.json"),out=join(dir,"preview.html");
  await writeFile(src,JSON.stringify(prepared()));
  assert.deepEqual(parseAnimaticArgs(["--help"]),{help:true});
  assert.throws(()=>parseAnimaticArgs(["--bundle",src,"--out",src]),/html/);
  assert.throws(()=>parseAnimaticArgs(["--bundle",src,"--out",out,"--fps","0"]),/12–60/);
  const result=await runAnimaticCli(["--bundle",src,"--out",out],{log:()=>{}});
  assert.equal(result.animatic.shots.length,3);
  const content=await readFile(out,"utf8");
  assert.match(content,/visual story animatic/i);
  assert.match(content,/SFX off/);
  await assert.rejects(runAnimaticCli(["--bundle",src,"--out",out],{log:()=>{}}),/EEXIST/);
  assert.equal(await readFile(out,"utf8"),content);
});
