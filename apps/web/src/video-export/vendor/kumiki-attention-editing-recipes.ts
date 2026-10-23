/**
 * Attention-editing recipes.
 *
 * These are deterministic, data-first editorial plans. They deliberately compose
 * existing scene renderers, MotionDirector, CutDirector, CaptionPerformer,
 * AudioVisualCue and FrameAccurateClip rather than creating another renderer or clock.
 */
export type FrameRate = { num: number; den: number };
export type RecipeDiagnostic = { code: string; severity: "warning" | "error"; message: string; frame?: number };
export type Beat = {
  id: string;
  startFrame: number;
  endFrame: number;
  purpose: "interrupt" | "question" | "reveal" | "explain" | "compare" | "payoff" | "hold";
  subjectIds: string[];
  cueIds?: string[];
};
export type RecipePlan = {
  id: string;
  fps: FrameRate;
  durationFrames: number;
  beats: Beat[];
  diagnostics: RecipeDiagnostic[];
  metadata: Record<string, string | number | boolean>;
};
const validFrame = (n: number) => Number.isSafeInteger(n) && n >= 0;
function validateBase(id: string, fps: FrameRate, durationFrames: number): RecipeDiagnostic[] {
  const out: RecipeDiagnostic[] = [];
  if (!id.trim()) out.push({ code: "recipe-id-empty", severity: "error", message: "A stable recipe id is required." });
  if (!validFrame(durationFrames) || durationFrames < 1) out.push({ code: "recipe-duration-invalid", severity: "error", message: "durationFrames must be a positive safe integer." });
  if (!Number.isSafeInteger(fps.num) || !Number.isSafeInteger(fps.den) || fps.num <= 0 || fps.den <= 0)
    out.push({ code: "recipe-fps-invalid", severity: "error", message: "FPS must be a positive rational number." });
  return out;
}
function makePlan(input: Omit<RecipePlan, "diagnostics">, extra: RecipeDiagnostic[] = []): RecipePlan {
  const diagnostics = [...validateBase(input.id, input.fps, input.durationFrames), ...extra];
  for (const beat of input.beats) {
    if (!validFrame(beat.startFrame) || !validFrame(beat.endFrame) || beat.endFrame <= beat.startFrame || beat.endFrame > input.durationFrames)
      diagnostics.push({ code: "recipe-beat-range-invalid", severity: "error", frame: beat.startFrame, message: `Beat "${beat.id}" must have a non-empty in-range [start,end) frame interval.` });
  }
  return { ...input, diagnostics };
}
function proportionalBeats(id: string, fps: FrameRate, durationFrames: number, subjects: string[], definitions: Array<[string, number, Beat["purpose"]]>, metadata: RecipePlan["metadata"] = {}, extra: RecipeDiagnostic[] = []) {
  let cursor = 0;
  const beats = definitions.map(([name, proportion, purpose], index) => {
    const end = index === definitions.length - 1 ? durationFrames : Math.max(cursor + 1, Math.round(durationFrames * proportion));
    const beat = { id: `${id}/${name}`, startFrame: cursor, endFrame: Math.min(durationFrames, end), purpose, subjectIds: subjects };
    cursor = beat.endFrame;
    return beat;
  });
  if (cursor < durationFrames && beats.length) beats[beats.length - 1].endFrame = durationFrames;
  return makePlan({ id, fps, durationFrames, beats, metadata }, extra);
}

export type HookVariant = {
  id: string;
  strategy: "action-first" | "unexpected-reveal" | "impact-statistic" | "transformation" | "evidence-question";
  claimId: string;
  subjectIds: string[];
  payoffId: string;
  surprise?: string;
  sourceId?: string;
};
export function compileHookVariant(input: HookVariant & { fps: FrameRate; durationFrames: number }): RecipePlan {
  const errors: RecipeDiagnostic[] = [];
  if (!input.claimId) errors.push({ code: "hook-claim-missing", severity: "error", message: "Hook must reference a claim." });
  if (!input.payoffId) errors.push({ code: "hook-payoff-missing", severity: "error", message: "Hook must reference a later payoff." });
  if (!input.subjectIds.length) errors.push({ code: "hook-subject-missing", severity: "error", message: "Hook must name at least one visible subject." });
  if (input.durationFrames < 3) errors.push({ code: "hook-duration-too-short", severity: "error", message: "Hook requires at least three frames." });
  if (input.strategy === "unexpected-reveal" && !input.surprise?.trim()) errors.push({ code: "hook-surprise-missing", severity: "error", message: "Unexpected-reveal hooks require a concrete reveal description." });
  return makePlan({ id: input.id, fps: input.fps, durationFrames: input.durationFrames,
    beats: [
      { id: `${input.id}/open`, startFrame: 0, endFrame: Math.max(1, Math.floor(input.durationFrames * .32)), purpose: "interrupt", subjectIds: input.subjectIds },
      { id: `${input.id}/question`, startFrame: Math.floor(input.durationFrames * .32), endFrame: Math.max(2, Math.floor(input.durationFrames * .66)), purpose: "question", subjectIds: input.subjectIds, cueIds: ["narration-question"] },
      { id: `${input.id}/handoff`, startFrame: Math.floor(input.durationFrames * .66), endFrame: input.durationFrames, purpose: "reveal", subjectIds: input.subjectIds, cueIds: ["body-handoff"] },
    ], metadata: { strategy: input.strategy, claimId: input.claimId, payoffId: input.payoffId, ...(input.sourceId ? { sourceId: input.sourceId } : {}) }
  }, errors);
}

export type CaptionImpactStyle = "snap" | "overshoot" | "wipe" | "word-highlight" | "count-up";
export function compileImpactTypography(input: { id: string; fps: FrameRate; durationFrames: number; targetId: string; text: string; style: CaptionImpactStyle; emphasis?: string[]; safeZoneId: string }): RecipePlan {
  const diagnostics: RecipeDiagnostic[] = [];
  if (!input.text.trim()) diagnostics.push({ code: "impact-text-empty", severity: "error", message: "Typography needs non-empty text." });
  if (!input.targetId || !input.safeZoneId) diagnostics.push({ code: "impact-anchor-missing", severity: "error", message: "A target and safe-zone reference are required." });
  if (input.durationFrames < 4) diagnostics.push({ code: "impact-too-short", severity: "error", message: "Impact typography needs at least four frames." });
  return makePlan({ id: input.id, fps: input.fps, durationFrames: input.durationFrames, beats: [
    { id: `${input.id}/enter`, startFrame: 0, endFrame: Math.max(1, Math.floor(input.durationFrames * .22)), purpose: "interrupt", subjectIds: [input.targetId] },
    { id: `${input.id}/read`, startFrame: Math.max(1, Math.floor(input.durationFrames * .22)), endFrame: input.durationFrames, purpose: "hold", subjectIds: [input.targetId] },
  ], metadata: { style: input.style, text: input.text, targetId: input.targetId, safeZoneId: input.safeZoneId, emphasis: (input.emphasis ?? []).join("|"), reducedMotionFallback: "static" } }, diagnostics);
}

export type BeatMarker = { id: string; frame: number };
export function compileBeatMontage(input: { id: string; fps: FrameRate; durationFrames: number; subjectIds: string[]; beats: BeatMarker[]; minShotFrames?: number }): RecipePlan {
  const diagnostics: RecipeDiagnostic[] = [];
  const minShot = input.minShotFrames ?? 8;
  const sorted = [...input.beats].sort((a,b) => a.frame - b.frame);
  if (sorted.some((b,i) => !validFrame(b.frame) || b.frame >= input.durationFrames || (i > 0 && b.frame === sorted[i-1].frame)))
    diagnostics.push({ code: "beat-markers-invalid", severity: "error", message: "Beat markers must be unique, non-negative frames within the montage." });
  const cuts = [0, ...sorted.map(b=>b.frame).filter(f=>validFrame(f)&&f>0&&f<input.durationFrames).filter((f,i,a)=>i===0||f!==a[i-1]), input.durationFrames];
  const beats: Beat[] = [];
  for (let i=0;i<cuts.length-1;i++) {
    const startFrame=cuts[i], endFrame=cuts[i+1];
    if (endFrame-startFrame < minShot) diagnostics.push({ code: "montage-shot-too-short", severity: "warning", frame: startFrame, message: `Shot lasts ${endFrame-startFrame} frames; minimum configured duration is ${minShot}.` });
    beats.push({ id: `${input.id}/shot-${i+1}`, startFrame, endFrame, purpose: i===0 ? "interrupt" : "explain", subjectIds: input.subjectIds, cueIds: sorted.find(b=>b.frame===startFrame)?.id ? [sorted.find(b=>b.frame===startFrame)!.id] : [] });
  }
  return makePlan({ id: input.id, fps: input.fps, durationFrames: input.durationFrames, beats, metadata: { kind: "beat-montage", minShotFrames: minShot } }, diagnostics);
}

export type SpeedKey = { frame: number; sourceFrame: number; easing?: "linear" | "ease-in" | "ease-out" | "ease-in-out" };
/** Resolve a source frame from authored keyframes; evaluation is pure and seek-safe. */
export function resolveSpeedRampFrame(keys: SpeedKey[], frame: number): number {
  if (!validFrame(frame) || keys.length === 0) throw new Error("A non-negative frame and at least one speed key are required.");
  const sorted=[...keys].sort((a,b)=>a.frame-b.frame);
  if (sorted.some((k,i)=>!validFrame(k.frame)||!Number.isFinite(k.sourceFrame)||(i>0&&k.frame===sorted[i-1].frame))) throw new Error("Speed-ramp keys must have unique non-negative frames and finite source frames.");
  if(frame<=sorted[0].frame) return sorted[0].sourceFrame;
  for(let i=0;i<sorted.length-1;i++){
    const a=sorted[i],b=sorted[i+1];
    if(frame<=b.frame){
      let t=(frame-a.frame)/(b.frame-a.frame);
      const easing=b.easing??"linear";
      if(easing==="ease-in") t=t*t;
      else if(easing==="ease-out") t=1-(1-t)*(1-t);
      else if(easing==="ease-in-out") t=t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
      return a.sourceFrame+(b.sourceFrame-a.sourceFrame)*t;
    }
  }
  const last=sorted[sorted.length-1]; return last.sourceFrame;
}
export function compileSpeedRamp(input: { id: string; fps: FrameRate; durationFrames: number; clipId: string; keys: SpeedKey[] }): RecipePlan {
  const diagnostics: RecipeDiagnostic[] = [];
  if (!input.clipId) diagnostics.push({ code: "speed-ramp-clip-missing", severity: "error", message: "Speed ramp must target a frame-accurate clip." });
  if (input.keys.length < 2) diagnostics.push({ code: "speed-ramp-keys-insufficient", severity: "error", message: "Speed ramp requires at least two source-time keys." });
  if (input.keys.some(k=>k.frame>=input.durationFrames||k.sourceFrame<0)) diagnostics.push({code:"speed-ramp-out-of-bounds",severity:"error",message:"Remap keys must be within the output clip and source frames must be non-negative."});
  try { resolveSpeedRampFrame(input.keys, 0); } catch (e) { diagnostics.push({ code: "speed-ramp-keys-invalid", severity: "error", message: e instanceof Error ? e.message : "Invalid speed-ramp keys." }); }
  return makePlan({ id: input.id, fps: input.fps, durationFrames: input.durationFrames, beats: [
    { id: `${input.id}/ramp`, startFrame: 0, endFrame: input.durationFrames, purpose: "reveal", subjectIds: [input.clipId] },
  ], metadata: { kind: "speed-ramp", clipId: input.clipId, keyCount: input.keys.length, mapping: "resolveSpeedRampFrame" } }, diagnostics);
}

export function compileSplitScreen(input: { id: string; fps: FrameRate; durationFrames: number; leftSubjectId: string; rightSubjectId: string; comparisonId: string }): RecipePlan {
  const diagnostics: RecipeDiagnostic[] = [];
  if (!input.leftSubjectId || !input.rightSubjectId || input.leftSubjectId===input.rightSubjectId) diagnostics.push({ code: "split-subjects-invalid", severity: "error", message: "Comparison needs two distinct subject IDs." });
  if (!input.comparisonId) diagnostics.push({ code: "split-comparison-label-missing", severity: "error", message: "Comparison must name the shared metric or dimension." });
  return proportionalBeats(input.id,input.fps,input.durationFrames,[input.leftSubjectId,input.rightSubjectId],[["establish",.25,"compare"],["compare",.72,"explain"],["conclude",1,"payoff"]],{kind:"split-screen",comparisonId:input.comparisonId},diagnostics);
}
export function compileValueCascade(input: { id: string; fps: FrameRate; durationFrames: number; totalId: string; contributorIds: string[]; unit: string; sourceId: string }): RecipePlan {
  const diagnostics: RecipeDiagnostic[] = [];
  if (!input.unit.trim()) diagnostics.push({ code: "cascade-unit-missing", severity: "error", message: "Quantitative animation requires explicit units." });
  if (!input.sourceId) diagnostics.push({ code: "cascade-source-missing", severity: "error", message: "Quantitative claims require a source reference." });
  if (!input.contributorIds.length) diagnostics.push({ code: "cascade-contributors-missing", severity: "error", message: "At least one contributor is required." });
  return proportionalBeats(input.id,input.fps,input.durationFrames,[input.totalId,...input.contributorIds],[["total",.2,"interrupt"],["contributors",.78,"explain"],["sum",1,"payoff"]],{kind:"value-cascade",unit:input.unit,sourceId:input.sourceId},diagnostics);
}
export function compileEvidenceSpotlight(input: { id: string; fps: FrameRate; durationFrames: number; evidenceId: string; focusId: string; sourceId: string; claimId: string }): RecipePlan {
  const diagnostics: RecipeDiagnostic[] = [];
  for(const [key,value] of Object.entries({evidenceId:input.evidenceId,focusId:input.focusId,sourceId:input.sourceId,claimId:input.claimId})) if(!value) diagnostics.push({code:`evidence-${key}-missing`,severity:"error",message:`Evidence spotlight requires ${key}.`});
  return proportionalBeats(input.id,input.fps,input.durationFrames,[input.evidenceId,input.focusId],[["question",.25,"question"],["spotlight",.7,"reveal"],["claim",1,"payoff"]],{kind:"evidence-spotlight",sourceId:input.sourceId,claimId:input.claimId},diagnostics);
}
export function compileVisualContradiction(input: { id: string; fps: FrameRate; durationFrames: number; familiarId: string; contradictionId: string; claimId: string; payoffId: string }): RecipePlan {
  const diagnostics: RecipeDiagnostic[] = [];
  if(!input.familiarId||!input.contradictionId) diagnostics.push({code:"contradiction-subject-missing",severity:"error",message:"A familiar subject and a contrasting state are required."});
  if(!input.claimId||!input.payoffId) diagnostics.push({code:"contradiction-payoff-missing",severity:"error",message:"Contradiction must link to a claim and later payoff."});
  return proportionalBeats(input.id,input.fps,input.durationFrames,[input.familiarId,input.contradictionId],[["familiar",.28,"interrupt"],["contradiction",.65,"reveal"],["question",1,"question"]],{kind:"visual-contradiction",claimId:input.claimId,payoffId:input.payoffId},diagnostics);
}
export function compileLoopBridge(input: { id: string; fps: FrameRate; durationFrames: number; firstSubjectId: string; lastSubjectId: string; firstFrameSignature: string; lastFrameSignature: string }): RecipePlan {
  const diagnostics: RecipeDiagnostic[] = [];
  if(!input.firstSubjectId||!input.lastSubjectId) diagnostics.push({code:"loop-subject-missing",severity:"error",message:"Loop bridge requires first and last subject IDs."});
  if(input.firstFrameSignature!==input.lastFrameSignature) diagnostics.push({code:"loop-frame-mismatch",severity:"warning",message:"Declared first/last frame signatures differ; visual continuity requires review."});
  return makePlan({id:input.id,fps:input.fps,durationFrames:input.durationFrames,beats:[
    {id:`${input.id}/opening`,startFrame:0,endFrame:Math.max(1,Math.floor(input.durationFrames*.1)),purpose:"interrupt",subjectIds:[input.firstSubjectId]},
    {id:`${input.id}/body`,startFrame:Math.max(1,Math.floor(input.durationFrames*.1)),endFrame:Math.max(2,Math.floor(input.durationFrames*.9)),purpose:"explain",subjectIds:[input.firstSubjectId,input.lastSubjectId]},
    {id:`${input.id}/bridge`,startFrame:Math.max(2,Math.floor(input.durationFrames*.9)),endFrame:input.durationFrames,purpose:"hold",subjectIds:[input.lastSubjectId]},
  ],metadata:{kind:"loop-bridge",firstFrameSignature:input.firstFrameSignature,lastFrameSignature:input.lastFrameSignature}},diagnostics);
}
