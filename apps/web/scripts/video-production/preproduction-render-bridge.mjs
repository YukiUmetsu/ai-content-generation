/** Honest, deterministic bridge from research-linked preproduction to the supported general renderer.
 * No LLMs, network calls, rights elevation or guessed production assets.
 */
import { createHash } from "node:crypto";
import { parseResearchDossier, parsePreproductionPlan } from "./preproduction.mjs";
import { createManualVideoDraft } from "./manual-draft.mjs";
import { parseVideoProductionJob } from "./job.mjs";

const hash=o=>createHash("sha256").update(JSON.stringify(o)).digest("hex");
const safe=(v,n)=>{
  if(typeof v!=="string"||!v.trim())throw Error("A required scene label is missing.");
  const out=v.trim().replace(/\s+/gu," ").replace(/[\u0000-\u001f]/gu," ");
  return out.length<=n?out:out.slice(0,n-1).trimEnd()+"…";
};
const label=id=>safe(id.replace(/[-_]+/gu," ").replace(/\b[a-z]/gu,c=>c.toUpperCase()),44);
const mapFamily={
  question:"general-flow",process:"general-flow",mechanism:"general-flow",
  comparison:"general-comparison","cost-breakdown":"general-breakdown",
  evidence:"general-breakdown",summary:"general-flow"
};

export function compilePreproductionRenderJob(dossier,bundle,{platform="youtube"}={}) {
  if(!dossier||!bundle||bundle.kind!=="preproduction-bundle"||
    bundle.schemaVersion!==1||bundle.plan?.kind!=="preproduction-plan"||
    bundle.researchId!==dossier.id ||
    bundle.researchSha256!==hash(dossier)||
    bundle.planSha256!==hash(bundle.plan))
    throw Error("Select a research dossier and its matching untampered preproduction bundle.");
  const research=parseResearchDossier(dossier);
  const planCheck=parsePreproductionPlan(bundle.plan,dossier);
  if(!research.ok||!planCheck.ok)
    throw Error("Research or preproduction is invalid: "+
      [...research.findings,...planCheck.findings].filter(f=>f.severity==="error").slice(0,5).map(f=>f.code).join(", "));
  const plan=bundle.plan;
  if(plan.shots.length<3||plan.shots.length>40)
    throw Error("Video export requires 3–40 authored shots. Split or combine shots before rendering.");
  if(platform!=="youtube")throw Error("The Studio integration currently supports YouTube 1920×1080. Other platforms need separate visual playback QA.");
  // The illustrated demo intentionally displays a hypothetical $500,000 tag.
  // Never reuse it for different research or an incomplete number of scenes.
  if(plan.shots.some(s=>s.sceneRecipe==="home-cost-story-v1")&&
    (plan.shots.length!==3||
     !plan.shots.every(s=>s.sceneRecipe==="home-cost-story-v1"&&
       ["house","mortgage_interest","property_tax","home_insurance","maintenance"].every(id=>s.subjectIds.includes(id)))||
     !dossier.claims.some(c=>c.status==="illustrative"&&/\$500,000/u.test(c.text))))
    throw Error("home-cost-story-v1 requires three matched scenes and an explicitly illustrative $500,000 home-cost scenario; choose the general renderer for other projects.");

  const sound=new Map(plan.sound.map(s=>[s.shotId,s]));
  const phases=new Map((plan.teachingSequences??[]).flatMap(x=>x.phases).map(x=>[x.shotId,x]));
  const sequenceByShot=new Map((plan.teachingSequences??[]).flatMap(seq=>seq.phases.map(phase=>[phase.shotId,seq])));
  const warnings=[];
  const scenes=plan.shots.map((shot,i)=>{
    const phase=phases.get(shot.id),voice=sound.get(shot.id);
    if(!voice||voice.narration.trim().length<20)
      throw Error("Shot "+shot.id+" needs at least 20 characters of narration for the current renderer.");
    if(!phase)warnings.push("Shot "+shot.id+" is not linked to a teaching phase.");
    const headline=safe(shot.onScreenText,68);
    const subhead=safe(phase?.learningChange||shot.visualChange,115);
    if(shot.onScreenText.trim().length>68)
      warnings.push("Shot "+shot.id+": long screen title shortened to fit the exporter.");
    if((phase?.learningChange||shot.visualChange).trim().length>115)
      warnings.push("Shot "+shot.id+": long supporting text shortened to fit the exporter.");
    const subjects=[...new Set(shot.subjectIds.map(label))].slice(0,5);
    const sequence=plan.teachingSequences?.find(x=>x.phases.some(p=>p.shotId===shot.id));
    const mappings=phase?.kind==="analogy" ? sequence?.analogy?.mappings??[] : [];
    const visualLabels=mappings.length?
      mappings.flatMap(m=>[safe(m.familiar,44),safe(m.technical,44)]) : subjects;
    const unique=[...new Set(visualLabels)].slice(0,5);
    while(unique.length<2)unique.push(unique.length?"How it changes":"Main idea");
    const intent=mapFamily[shot.family]??"general-flow";
    if(!shot.sceneRecipe&&!sequenceByShot.get(shot.id)?.visualStates &&
      ["mechanism","process","question"].includes(shot.family) && (phase?.visualAction||"").trim())
      warnings.push("Shot "+shot.id+": detailed motion intent is represented by a schematic flow, not a custom 2D/3D scene.");
    if(voice.sfxIntent)warnings.push("Shot "+shot.id+": requested SFX '"+safe(voice.sfxIntent,60)+
      "' is not rendered automatically; only the existing test-only payoff chime is supported.");
    return {intent,items:unique,headline,subhead,
      narration:voice.narration,emphasis:safe(i===0?"THE QUESTION":i===plan.shots.length-1?"THE ANSWER":phase?.kind??shot.purpose,28)};
  });
  const authored=createManualVideoDraft({
    title:safe(dossier.topic.title,180),viewerQuestion:safe(plan.story.question,240),
    audience:safe(dossier.topic.audience,160),locale:dossier.topic.locale,platform,
    length:"smoke",scenes,hookStrategy:"action-first",typographyStyle:"wipe"
  });
  const job=structuredClone(authored.job);
  const stable=hash({researchId:dossier.id,kind:"contentgen-research-video/v1"}).slice(0,20);
  job.id="research-"+stable;
  job.references.storyboard={id:"research-"+stable,revision:1};
  job.references.selectedPackagingId="research-storyboard";
  job.evidence=structuredClone(dossier.evidence);
  job.claims=structuredClone(dossier.claims);
  const known=new Set(dossier.claims.map(x=>x.id));
  for(let i=0;i<job.beats.length;i++){
    const shot=plan.shots[i];
    const phase=phases.get(shot.id);
    if(shot.motion)job.beats[i].visual.motion=structuredClone(shot.motion);
    if(shot.sceneRecipe)job.beats[i].visual.sceneRecipe=shot.sceneRecipe;
    job.beats[i].visual.direction={
      phase:phase?.kind??"none",
      subjectIds:shot.subjectIds.slice(0,5),
      visualAction:(phase?.visualAction??shot.visualChange).slice(0,650),
      learningChange:(phase?.learningChange??shot.visualChange).slice(0,650)
    };
    const sequence=sequenceByShot.get(shot.id);
    if(!shot.sceneRecipe && sequence?.visualStates && phase &&
      ["problem","mechanism","payoff"].includes(phase.kind) &&
      shot.subjectIds.includes(sequence.technicalSubjectId))
      job.beats[i].visual.direction.transformation={
        subjectId:sequence.technicalSubjectId,
        ...sequence.visualStates
      };
    if(!shot.sceneRecipe && sequence?.visualMechanic && phase &&
      ["problem","mechanism","payoff"].includes(phase.kind) &&
      shot.subjectIds.includes(sequence.technicalSubjectId))
      job.beats[i].visual.direction.visualMechanic=structuredClone(sequence.visualMechanic);
    const refs=plan.shots[i].claimIds.filter(id=>known.has(id));
    if(!refs.length)throw Error("Shot "+plan.shots[i].id+" must reference at least one research claim.");
    job.beats[i].claimRefs=refs;
  }
  // One sparse, original transition accent for the first substantial visual
  // change. Its cue is sample-domain anchored at the beginning of that beat,
  // while the existing answer chime remains owned by the payoff event.
  // This does NOT claim to fulfill arbitrary editor-requested SFX.
  let accentIndex=job.beats.findIndex((beat,i)=>i>0 && i<job.beats.length-1 &&
    ["general-comparison","general-breakdown"].includes(beat.visualIntent));
  if(accentIndex<0)accentIndex=plan.shots.findIndex((shot,i)=>i>0 &&
    i<plan.shots.length-1 && phases.get(shot.id)?.kind==="mechanism");
  if(accentIndex>0){
    const eventId="contentgen-first-visual-reveal";
    job.events.push({id:eventId,beatId:job.beats[accentIndex].id});
    job.beats[accentIndex].eventIds.push(eventId);
    job.sounds.push({id:"contentgen-soft-tick",eventId,category:"visual.reveal",
      assetRef:"self-authored-test-soft-tick",licenseStatus:"test-only"});
  }
  // Output is ALWAYS editorial/test-only, never rights-cleared or fact-checked.
  job.approval="test-only";
  job.policy={commercialRightsVerified:false,reviewerApproved:false,maxCostUsd:0};
  const parsed=parseVideoProductionJob(job);
  if(!parsed.ok)throw Error("Renderer cannot accept bridged draft: "+
    parsed.findings.filter(f=>f.severity==="error").slice(0,8).map(f=>f.code).join(", "));
  if(dossier.review.status!=="human-reviewed")
    warnings.unshift("Research has not been human-reviewed. Export is strictly an unverified test draft.");
  if(dossier.gaps.length)warnings.push("Research dossier has "+dossier.gaps.length+" unresolved gap(s).");
  warnings.unshift("Validated semantic mechanics, when present, animate in Kumiki's 2D stage. Legacy visible teaching states remain a text-based fallback; other generic shots remain schematic. Arbitrary 3D assets and per-shot SFX are not compiled.");
  return {
    schemaVersion:1,kind:"research-to-render-job/v1",job,
    sourceResearchSha256:bundle.researchSha256,sourcePlanSha256:bundle.planSha256,
    shotMap:plan.shots.map((s,i)=>({shotId:s.id,beatId:job.beats[i].id,
      family:s.family,visualAction:phases.get(s.id)?.visualAction??s.visualChange})),
    warnings,editorialStatus:"unverified-test-draft",renderable:true
  };
}
