/**
 * Deterministic, offline animatic timing from approved preproduction *intent*.
 *
 * This is a rough-cut preview, NOT final Kumiki media: timings are estimates
 * until actual Fish/local audio is synthesized and sample-aligned.
 */
import { createHash } from "node:crypto";
import { compileTeachingStoryboard } from "./visual-pedagogy.mjs";

const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const words = s => String(s).trim().split(/\s+/u).filter(Boolean).length;
const ID = /^[a-z][a-z0-9_-]{0,80}$/iu;

export function compileAnimatic(bundle,{ fps=30, spokenWpm=145 }={}) {
  if (!bundle || bundle.kind!=="preproduction-bundle" || bundle.schemaVersion!==1 ||
      bundle.plan?.kind!=="preproduction-plan" || !ID.test(bundle.researchId??"") ||
      !Number.isInteger(fps) || fps<12 || fps>60 ||
      !Number.isFinite(spokenWpm) || spokenWpm<95 || spokenWpm>210)
    throw Error("Expected bounded preproduction-bundle/v1, FPS and narration pace.");
  const planHash=createHash("sha256").update(JSON.stringify(bundle.plan)).digest("hex");
  if(bundle.planSha256!==planHash)throw Error("Preproduction plan changed after bundle validation; recompile the reviewed bundle.");
  if (bundle.researchId!==bundle.plan.researchId || !Array.isArray(bundle.plan.teachingSequences) ||
      !bundle.plan.teachingSequences.length)
    throw Error("Animatic requires research-linked teaching sequences; regenerate or author the teaching plan.");
  // The source-backed bundle was validated at the preproduction boundary.
  // Re-check every reference in the plan before making the portable preview.
  const compiled=compileTeachingStoryboard(bundle.plan,{
    id:bundle.researchId, claims:(bundle.plan.teachingSequences??[]).flatMap(x=>x.claimIds).filter((x,i,a)=>a.indexOf(x)===i).map(id=>({id}))
  });
  if (!compiled.beats.length) throw Error("No directed teaching phases to preview.");
  const planned=new Map(bundle.plan.shots.map((shot,i)=>[shot.id,{shot,index:i}]));
  const notes=new Map(bundle.plan.sound.map(x=>[x.shotId,x]));
  const seqs=new Map(bundle.plan.teachingSequences.map(x=>[x.id,x]));
  let cursor=0;
  const shots=compiled.beats.map((beat,index)=>{
    const declared=planned.get(beat.shotId);
    if (!declared)throw Error("Unknown teaching shot in animatic.");
    const voice=notes.get(beat.shotId);
    if (!voice?.narration)throw Error("Each teaching phase needs narration.");
    const next=compiled.beats[index+1];
    if (next && planned.get(next.shotId).index<=declared.index)
      throw Error("Teaching shots must follow source storyboard order.");
    const seconds=Math.max(2.5,(words(voice.narration)/spokenWpm)*60+((voice.pauseAfterMs??0)/1000));
    if (seconds>90)throw Error("Shot narration is too long for an animatic beat; split the explanation.");
    const frames=Math.max(12,Math.round(seconds*fps));
    const seq=seqs.get(beat.teachingSequenceId);
    const mapping=seq.mode==="analogy" && seq.analogy
      ? seq.analogy.mappings.map(x=>({familiar:x.familiar,technical:x.technical})) : [];
    const result={
      shotId:beat.shotId, sequenceId:beat.teachingSequenceId, phase:beat.phase,
      family:beat.visualFamily, startFrame:cursor, endFrame:cursor+frames,
      learningChange:beat.learningChange, visualAction:beat.visualAction,
      onScreenText:beat.onScreenText, technicalSubject:seq.technicalSubjectId,
      analogySubject:seq.analogy?.analogySubjectId??null,
      analogyLimit:beat.phase==="payoff" ? seq.analogy?.breaksAt??null : null,
      mapping:beat.phase==="analogy"?mapping:[],
      narration:voice.narration, sfxIntent:voice.sfxIntent,
      claimIds:[...beat.claimIds], subjectIds:[...beat.subjectIds],
      transition:beat.entryTransition?.technique??"cut",
      revealFrames:[0.18,0.43,0.70].map(p=>cursor+Math.round(frames*p)),
    };
    cursor+=frames;
    return result;
  });
  if (cursor>fps*60*30)throw Error("Animatic exceeds the 30-minute review limit.");
  const soundCues=shots.flatMap(shot=>shot.sfxIntent
    ? [{frame:shot.revealFrames[0],shotId:shot.shotId,kind:"reveal"},
       {frame:shot.revealFrames[2],shotId:shot.shotId,kind:"settle"}] : []);
  return {
    schemaVersion:1,kind:"progressive-teaching-animatic",
    researchId:bundle.researchId, fps, totalFrames:cursor,
    storyQuestion:compiled.storyQuestion, shots, soundCues,
    timingBasis:"Estimated from text at "+spokenWpm+" WPM. Replace with measured speech timings before production.",
    reviewStatus:"EDITORIAL DRAFT · Not fact-checked or licensed for publication",
    caveat:"Visuals and gentle synthesized sound cues are provisional, not final Kumiki scenes, licensed SFX, speech audio, or rendered video."
  };
}

/** Pure frame sample to support scrubbing, still comparisons and deterministic QA. */
export function sampleAnimatic(animatic,frame) {
  if (animatic?.kind!=="progressive-teaching-animatic" ||
      !Number.isSafeInteger(frame) || frame<0 || frame>=animatic.totalFrames)
    throw Error("Animatic frame must be an integer within its manifest.");
  const shot=animatic.shots.find(s=>frame>=s.startFrame&&frame<s.endFrame);
  if (!shot)throw Error("Animatic frame is not covered by a shot.");
  const progress=(frame-shot.startFrame)/Math.max(1,shot.endFrame-shot.startFrame-1);
  const revealed=shot.revealFrames.filter(at=>frame>=at).length;
  // Motion is always derived from absolute frame: no CSS animation clocks.
  const time=(frame-shot.startFrame)/animatic.fps;
  const wave=Math.sin(time*2.1)*0.5+0.5;
  return {frame,shot,progress,revealed,
    subjectDrift:Math.sin(time*0.82)*7,
    highlightPulse:0.68+0.16*Math.sin(time*2.6),
    movingMarker:clamp((progress*1.12)%1,0,1),
    trailProgress:clamp((progress-0.04)*1.2,0,1),
    revealAlpha:shot.revealFrames.map(f=>clamp((frame-f)/Math.max(1,animatic.fps*0.28),0,1)),
    ambientWave:wave
  };
}
