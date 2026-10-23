/**
 * Research-linked teaching sequences for story-first educational videos.
 *
 * ContentGen owns the instructional intent and narration; Kumiki owns all
 * rendered visuals and timelines. This module never calls an LLM or renderer.
 * The contract is additive to preproduction-plan/v1, so previously saved
 * plans remain readable. New LLM-produced plans must include a sequence.
 */
const isObject = v => v !== null && typeof v === "object" && !Array.isArray(v);
const nonempty = (v, n = 500) => typeof v === "string" && !!v.trim() &&
  v.length <= n && !/[\u0000-\u001f]/u.test(v);
const id = v => typeof v === "string" && /^[a-z][a-z0-9_-]{0,80}$/iu.test(v);
const phasesFor = mode => mode === "analogy"
  ? ["problem", "analogy", "mechanism", "payoff"]
  : ["problem", "mechanism", "payoff"];

export function validateTeachingSequences(plan, dossier) {
  const findings = [];
  const error = (code, path, message) => findings.push({ severity:"error", code, path, message });
  const extra = (object, allowed, path) => {
    if (!isObject(object)) { error("teaching-shape", path, "Expected a structured object."); return false; }
    for (const key of Object.keys(object))
      if (!allowed.includes(key)) error("teaching-unknown-field", path+"."+key, "Unexpected teaching field.");
    return true;
  };
  const strings = (value, path, max = 500) => {
    if (!nonempty(value,max)) error("teaching-text",path,"Nonempty bounded wording required.");
  };
  if (plan?.teachingSequences === undefined) return { ok:true, findings, legacy:true };
  if (!Array.isArray(plan.teachingSequences) || !plan.teachingSequences.length || plan.teachingSequences.length > 24) {
    error("teaching-sequences-required", "teachingSequences", "Provide 1–24 meaningful teaching sequences.");
    return { ok:false, findings };
  }
  const shots = Array.isArray(plan.shots) ? plan.shots : [];
  const shotMap = new Map(shots.filter(isObject).map((shot,index)=>[shot.id,{shot,index}]));
  const sounds = new Map((Array.isArray(plan.sound)?plan.sound:[]).filter(isObject).map(x=>[x.shotId,x]));
  const knownClaims = new Set((Array.isArray(dossier?.claims)?dossier.claims:[]).filter(isObject).map(x=>x.id));
  const seenSequences = new Set();
  const usedShots = new Set();
  let resolvesCentralQuestion = false;
  for (let n=0; n<plan.teachingSequences.length; n++) {
    const seq=plan.teachingSequences[n], p="teachingSequences["+n+"]";
    if (!extra(seq,["id","mode","question","technicalSubjectId","analogy","claimIds","phases","visualStates"],p)) continue;
    if (!id(seq.id)||seenSequences.has(seq.id)) error("teaching-id",p+".id","Stable unique sequence ID required.");
    seenSequences.add(seq.id);
    if (!["direct","analogy"].includes(seq.mode)) error("teaching-mode",p+".mode","Choose direct or analogy.");
    strings(seq.question,p+".question",320);
    if (!id(seq.technicalSubjectId)) error("teaching-subject",p+".technicalSubjectId","Stable technical subject ID required.");
    if (seq.visualStates !== undefined && extra(seq.visualStates,["before","action","after"],p+".visualStates")) {
      const labels=["before","action","after"].map(kind=>{
        const value=seq.visualStates[kind],at=p+".visualStates."+kind;
        const max=kind==="action"?90:48;
        if (!nonempty(value,max) || value.trim().length<8 || /[\r\n]/u.test(value))
          error("teaching-state-text",at,"Use an 8–"+max+" character, single-line visible state or action.");
        if (typeof value==="string" && /^(before|after|step\s*\d+|main idea|the problem|the answer|how it works|the process|something changes)$/iu.test(value.trim()))
          error("teaching-state-placeholder",at,"Replace a generic placeholder with a concrete visible state.");
        return typeof value==="string"?value.trim().toLocaleLowerCase():"";
      });
      if (labels.every(Boolean) && new Set(labels).size!==labels.length)
        error("teaching-state-repeat",p+".visualStates","Before, action and after must show distinct visible information.");
    }
    if (!Array.isArray(seq.claimIds) || !seq.claimIds.length || seq.claimIds.length>20 ||
      new Set(seq.claimIds).size!==seq.claimIds.length || seq.claimIds.some(x=>!id(x)||!knownClaims.has(x)))
      error("teaching-claims",p+".claimIds","Use non-duplicate claim IDs from the captured research dossier.");
    const analogy=seq.analogy;
    if (seq.mode==="direct") {
      if (analogy!==null) error("teaching-analogy",p+".analogy","Direct demonstrations must use analogy:null.");
    } else if (seq.mode==="analogy") {
      if (extra(analogy,["familiarSystem","technicalSystem","analogySubjectId","mappings","breaksAt"],p+".analogy")) {
        strings(analogy.familiarSystem,p+".analogy.familiarSystem",240);
        strings(analogy.technicalSystem,p+".analogy.technicalSystem",240);
        strings(analogy.breaksAt,p+".analogy.breaksAt",400);
        if (!id(analogy.analogySubjectId)||analogy.analogySubjectId===seq.technicalSubjectId)
          error("teaching-analogy-subject",p+".analogy.analogySubjectId","Use a distinct, visible analogy subject ID.");
        if (!Array.isArray(analogy.mappings)||analogy.mappings.length<2||analogy.mappings.length>8)
          error("teaching-mapping",p+".analogy.mappings","Give 2–8 explicit familiar-to-technical correspondences.");
        else {
          const familiar = new Set(),technical = new Set();
          for (let k=0;k<analogy.mappings.length;k++) {
            const m=analogy.mappings[k],at=p+".analogy.mappings["+k+"]";
            if (!extra(m,["familiar","technical"],at)) continue;
            strings(m.familiar,at+".familiar",160);strings(m.technical,at+".technical",160);
            if (familiar.has(m.familiar)||technical.has(m.technical))
              error("teaching-mapping-repeat",at,"Analogy correspondence labels must be distinct.");
            familiar.add(m.familiar);technical.add(m.technical);
          }
        }
      }
    }
    const expected=phasesFor(seq.mode);
    if (!Array.isArray(seq.phases) || seq.phases.length!==expected.length) {
      error("teaching-phases",p+".phases","Expected ordered phases: "+expected.join(" → "));
      continue;
    }
    let previousIndex=-1;
    const actual = [];
    const linkedClaims=new Set();
    for (let k=0;k<seq.phases.length;k++) {
      const phase=seq.phases[k],at=p+".phases["+k+"]";
      if (!extra(phase,["kind","shotId","visualAction","learningChange"],at)) continue;
      actual.push(phase.kind);
      strings(phase.visualAction,at+".visualAction",600);
      strings(phase.learningChange,at+".learningChange",400);
      if (!id(phase.shotId)) error("teaching-shot",at+".shotId","Stable shot reference required.");
      const linked=shotMap.get(phase.shotId);
      if (!linked) { error("teaching-shot",at+".shotId","Unknown shot ID.");continue; }
      if (linked.index<=previousIndex)error("teaching-shot-order",at+".shotId","Teaching shots must progress forward in video order.");
      previousIndex=linked.index;
      if (usedShots.has(phase.shotId))
        error("teaching-shot-reuse",at+".shotId","One shot cannot serve multiple teaching phases or sequences.");
      usedShots.add(phase.shotId);
      if (phase.visualAction?.trim().toLowerCase()===linked.shot.onScreenText?.trim().toLowerCase())
        error("teaching-decorative",at+".visualAction","A visual action must demonstrate change, not merely repeat a label.");
      const subjectNeeded=phase.kind==="analogy"?analogy?.analogySubjectId:seq.technicalSubjectId;
      if (id(subjectNeeded) && !linked.shot.subjectIds?.includes(subjectNeeded))
        error("teaching-subject-missing",at+".shotId","The shot must visibly retain its declared teaching subject.");
      for (const claim of linked.shot.claimIds??[]) linkedClaims.add(claim);
      if (!sounds.has(phase.shotId))error("teaching-voice-missing",at+".shotId","Each teaching phase needs shot narration.");
      if (phase.kind==="payoff" && linked.shot.explanationId===plan.story?.answerExplanationId)
        resolvesCentralQuestion=true;
    }
    if (actual.some((kind,i)=>kind!==expected[i]))
      error("teaching-phase-order",p+".phases","Teaching phases must follow "+expected.join(" → ")+".");
    for (const claim of Array.isArray(seq.claimIds)?seq.claimIds:[])
      if (!linkedClaims.has(claim))
        error("teaching-ungrounded",p+".claimIds","Claim "+claim+" is not visualized in the referenced shots.");
    if (seq.phases.every(isObject) && new Set(seq.phases.map(x=>String(x.visualAction).trim().toLowerCase())).size!==seq.phases.length)
      error("teaching-repeated-action",p+".phases","Each phase must show a distinct visual transformation.");
    if (seq.phases.every(isObject) && new Set(seq.phases.map(x=>String(x.learningChange).trim().toLowerCase())).size!==seq.phases.length)
      error("teaching-repeated-insight",p+".phases","Each phase must move viewer understanding forward.");
  }
  if (!resolvesCentralQuestion)
    error("teaching-no-final-payoff","teachingSequences","At least one teaching payoff must address the story's final answer explanation.");
  return { ok:!findings.some(x=>x.severity==="error"), findings, legacy:false };
}

/** Intent-only handoff. No Kumiki imports, timestamps, visual assets or renders fabricated. */
export function compileTeachingStoryboard(plan,dossier){
  const verdict=validateTeachingSequences(plan,dossier);
  if (!verdict.ok)throw Error("Teaching storyboard rejected: "+verdict.findings.map(x=>x.code).join(", "));
  const byShot=new Map(plan.shots.map(x=>[x.id,x]));
  const voice=new Map(plan.sound.map(x=>[x.shotId,x]));
  const transitions=new Map(plan.continuity.map(x=>[x.toShotId,x]));
  const beats=(plan.teachingSequences??[]).flatMap(seq=>seq.phases.map(phase=>{
    const shot=byShot.get(phase.shotId),sound=voice.get(phase.shotId),transition=transitions.get(phase.shotId);
    return {
      teachingSequenceId:seq.id,phase:phase.kind,shotId:shot.id,
      explanationId:shot.explanationId,visualFamily:shot.family,
      shotPurpose:shot.purpose,subjectIds:[...shot.subjectIds],claimIds:[...shot.claimIds],
      visualAction:phase.visualAction,learningChange:phase.learningChange,
      onScreenText:shot.onScreenText,narration:sound.narration,
      delivery:sound.delivery,energy:sound.energy,sfxIntent:sound.sfxIntent,
      entryTransition:transition?{technique:transition.technique,reason:transition.reason}:null
    };
  }));
  return {
    schemaVersion:1,kind:"visual-teaching-storyboard",researchId:dossier.id,
    storyQuestion:plan.story.question,teachingSequences:(plan.teachingSequences??[]).map(seq=>({
      id:seq.id,mode:seq.mode,question:seq.question,technicalSubjectId:seq.technicalSubjectId,
      claimIds:[...seq.claimIds],analogy:seq.analogy,
      ...(seq.visualStates?{visualStates:{...seq.visualStates}}:{})
    })),
    beats,
    advisory:"Intent and source IDs only. Requires editorial fact/analogy review, licensed assets and Kumiki scene compilation before media exists."
  };
}
