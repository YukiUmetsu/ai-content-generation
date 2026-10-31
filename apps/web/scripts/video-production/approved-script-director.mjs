/** Convert completed YouTube narration into an editable, explicitly unverified
 * Director draft. Approval and factual review belong to publication, not preview. */
import { createHash } from "node:crypto";
import { compilePreproductionBundle } from "./preproduction.mjs";
import { SCRIPT_SCENE_MOTION, scriptSceneVisuals } from "./script-scene-visuals.mjs";

import {MAX_SCRIPT_SECTIONS,SCRIPT_ROLES,isScriptSectionId,scriptSectionRole,scriptAnswerIndex,scriptStoryboardClaimRefs} from "./script-contract.mjs";
const safeText=(value,max)=>typeof value==="string"&&value.trim().length>0&&
  value.length<=max&&!/[\u0000-\u001f]/u.test(value);
const safeNarration=(value,max)=>typeof value==="string"&&value.trim().length>0&&
  value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const flat=value=>value.replace(/\s+/gu," ").trim();
function splitNarration(value){
  if(value.length<=1600)return [value];
  // Both Director's 2000-character contract and the headless exporter’s
  // stricter 1600-character per-beat contract must accept every split.
  const words=value.split(/\s+/u),chunks=[];
  let chunk="";
  for(const word of words){
    if(word.length>1500)throw Error("An unbroken script passage exceeds the renderer's 1600-character narration limit. Split it into sentences first.");
    if(chunk&&chunk.length+word.length+1>1500){chunks.push(chunk);chunk="";}
    chunk+=(chunk?" ":"")+word;
  }
  if(chunk)chunks.push(chunk);
  // The current renderer cannot deliver meaningful shots with tiny narration.
  if(chunks.at(-1)?.length<20&&chunks.length>1){
    const tail=chunks.pop();chunks[chunks.length-1]+=" "+tail;
  }
  if(chunks.some(part=>part.length>1600||part.length<20))
    throw Error("Split short fragments into complete narration sentences before opening Director.");
  return chunks;
}
function splitShortNarration(value,count){
  const narration=flat(value);
  const boundaries=[...narration.matchAll(/[。！？]|\s+/gu)].map(match=>match.index+match[0].length);
  const divide=(start,remaining)=>{
    const rest=narration.slice(start).trim();
    if(rest.length<20*remaining)return null;
    if(remaining===1)return [rest];
    const target=start+(narration.length-start)/remaining;
    const cuts=boundaries.filter(at=>at>start&&narration.slice(start,at).trim().length>=20&&narration.slice(at).trim().length>=20*(remaining-1))
      .sort((a,b)=>Math.abs(a-target)-Math.abs(b-target));
    for(const at of cuts){const tail=divide(at,remaining-1);if(tail)return [narration.slice(start,at).trim(),...tail];}
    return null;
  };
  return divide(0,count);
}
export function compileApprovedScriptDirector({productionId,script,evidence,sources,storyboard}){
  if(!/^production-[a-f0-9]{24}$/u.test(productionId??"")||
    !["draft","approved"].includes(script?.status)||script?.input?.productionId!==productionId||
    script?.input?.platform!=="youtube"||
    !Array.isArray(script?.sections)||script.sections.length<1||script.sections.length>MAX_SCRIPT_SECTIONS||
    script.sections.some(section=>!isScriptSectionId(section?.id)||(section.role!==undefined&&!SCRIPT_ROLES.includes(section.role)))||new Set(script.sections.map(section=>section.id)).size!==script.sections.length)
    throw Error("Complete the YouTube script for this production before generating a draft.");
  const input=script.input;
  if(!safeText(input.title,200)||!safeText(input.viewerQuestion,240)||
    !safeText(input.audience,180)||!["en","ja"].includes(input.locale))
    throw Error("The approved script's title, question, language or audience is invalid.");
  if(storyboard!==undefined){
    if(!safeText(script.updatedAt,60)||!Array.isArray(storyboard?.assumptions)||
      ![ `Script revision: ${script.updatedAt}.`, `Approved script revision: ${script.updatedAt}.` ]
        .some(note=>storyboard.assumptions.includes(note))||
      !Array.isArray(storyboard.beats)||storyboard.beats.length!==script.sections.length)
      throw Error("The storyboard no longer matches the approved script revision. Update its outline first.");
    for(let index=0;index<script.sections.length;index++){
      const beat=storyboard.beats[index],section=script.sections[index];
      if(beat?.id!==`script-beat-${section.id}`||beat.narration!==section.text||
        !safeNarration(beat.visualObjective,650)||!safeNarration(beat.onScreenText,240)||
        !Array.isArray(beat.claimRefs)||
        JSON.stringify([...beat.claimRefs].sort())!==JSON.stringify([...scriptStoryboardClaimRefs(section,evidence)].sort()))
        throw Error("The edited storyboard conflicts with its approved narration or citations. Reconcile it before Director import.");
    }
  }
  if(!Array.isArray(evidence)||!Array.isArray(sources))
    throw Error("Invalid research metadata. Retry with the saved script.");
  if(evidence.length>40||sources.length>40)throw Error("Too many captured passages for one Director draft.");
  const bySource=new Map(sources.map(source=>[source.id,source]));
  const selectedClaims=new Map();const selectedSources=new Map();
  const claimIdentity=new Map(),sourceIdentity=new Map();
  const sectionClaims=[];
  let hasManualClaims=false;
  for(const section of script.sections){
    if(!safeText(section.heading,240)||!safeText(section.purpose,400)||
      !safeNarration(section.text,6500)||!Array.isArray(section.claimRefs)||
      !Array.isArray(section.sourceRefs)||
      section.claimRefs.length>40||section.sourceRefs.length>40)
      throw Error("Each approved script section needs narration and linked captured claims before Director import.");
    if(!section.claimRefs.length&&!section.sourceRefs.length||!evidence.length||!sources.length){
      const claimId=`cl_manual_${sectionClaims.length+1}`;
      selectedClaims.set(claimId,{id:claimId,text:`Uncited manual narration requires factual review: ${flat(section.text).slice(0,1000)}`,status:"unverified",sourceRefs:[]});
      sectionClaims.push([claimId]);hasManualClaims=true;continue;
    }
    if(!section.claimRefs.length||!section.sourceRefs.length)throw Error("A script section has incomplete source citations. Link its captured claims and sources before Director import.");
    const claims=[];
    for(const ref of section.claimRefs){
      const passage=evidence.find(item=>item.claimId===ref&&section.sourceRefs.includes(item.sourceId));
      const source=passage&&bySource.get(passage.sourceId);
      if(!passage||!source||!safeNarration(passage.claimText,1200)||!safeNarration(passage.quote,30000)||
        !safeText(source.title,240)||!Number.isSafeInteger(source.observedAt)||
        source.observedAt<946684800||source.observedAt>4102444800)
        throw Error("A script claim has no complete captured evidence, source title or observation date.");
      try{
        const url=new URL(source.url);
        if(url.protocol!=="https:"||url.username||url.password||!url.hostname||
          source.url!==passage.sourceUrl)throw Error();
      }catch{throw Error("A script source must be a matching, credential-free HTTPS citation.");}
      const sourceKey=source.id+"\u0000"+passage.quote;
      if(!sourceIdentity.has(sourceKey))sourceIdentity.set(sourceKey,`src_${sourceIdentity.size+1}`);
      const sourceId=sourceIdentity.get(sourceKey);
      if(!selectedSources.has(sourceId))selectedSources.set(sourceId,{
        id:sourceId,title:source.title,sourceUri:source.url,
        retrievedAt:new Date(source.observedAt*1000).toISOString(),
        passageLocator:"Captured passage from discovery evidence",
        snapshotSha256:createHash("sha256").update(passage.quote,"utf8").digest("hex")});
      if(!claimIdentity.has(ref))claimIdentity.set(ref,`cl_${claimIdentity.size+1}`);
      const claimId=claimIdentity.get(ref);
      if(!selectedClaims.has(claimId))selectedClaims.set(claimId,{
        id:claimId,text:flat(passage.claimText),
        // A script approval is not a factual verification.
        status:"unverified",sourceRefs:[sourceId]});
      else {
        if(selectedClaims.get(claimId).text!==flat(passage.claimText))
          throw Error("Captured passages disagree about the same claim; reconcile the evidence before Director import.");
        if(!selectedClaims.get(claimId).sourceRefs.includes(sourceId))
          selectedClaims.get(claimId).sourceRefs.push(sourceId);
      }
      claims.push(claimId);
    }
    sectionClaims.push([...new Set(claims)]);
  }
  // The dossier still needs real captured research context. An uncited manual
  // paragraph gets no invented source link, even when this context is available.
  if(!selectedSources.size&&evidence.length&&sources.length){
    const passage=evidence.find(item=>typeof item?.quote==="string"&&item.quote.length>=10&&bySource.has(item.sourceId));
    const source=passage&&bySource.get(passage.sourceId);
    if(!source||!safeText(source.title,240)||!Number.isSafeInteger(source.observedAt)||source.observedAt<946684800||source.observedAt>4102444800)
      throw Error("Capture a real research source before opening an imported script in Director.");
    try{const url=new URL(source.url);if(url.protocol!=="https:"||url.username||url.password||source.url!==passage.sourceUrl)throw Error();}
    catch{throw Error("The captured source must have a matching credential-free HTTPS URL.");}
    selectedSources.set("src_context",{id:"src_context",title:source.title,sourceUri:source.url,
      retrievedAt:new Date(source.observedAt*1000).toISOString(),passageLocator:"Captured context; not a citation for the manual narration",
      snapshotSha256:createHash("sha256").update(passage.quote,"utf8").digest("hex")});
  }
  const originalAnswerIndex=scriptAnswerIndex(script.sections);
  const units=script.sections.map((section,index)=>({section,originalIndex:index,claimIds:sectionClaims[index],beat:storyboard?.beats[index]}));
  // Director needs distinct problem, mechanism and payoff shots. Short imported
  // outlines are split at speech boundaries; no words or factual claims are added.
  while(units.filter(unit=>unit.originalIndex<=originalAnswerIndex).length<3){
    const eligible=units.map((unit,index)=>({unit,index})).filter(({unit})=>unit.originalIndex<=originalAnswerIndex)
      .sort((a,b)=>b.unit.section.text.length-a.unit.section.text.length);
    let divided=false;
    for(const {unit,index} of eligible){
      const needed=4-units.filter(item=>item.originalIndex<=originalAnswerIndex).length;
      const parts=splitShortNarration(unit.section.text,needed);
      if(!parts)continue;
      units.splice(index,1,...parts.map(text=>({...unit,section:{...unit.section,text}})));
      divided=true;break;
    }
    if(!divided)throw Error("Director needs enough narration for three distinct shots before the answer. Add complete sentences or sections, then approve again.");
  }
  const answerIndex=units.findLastIndex(unit=>unit.originalIndex===originalAnswerIndex);
  const dossier={schemaVersion:1,kind:"research-dossier",
    id:`script_${productionId.slice("production-".length)}`,
    topic:{title:input.title,viewerQuestion:input.viewerQuestion,
      audience:input.audience,locale:input.locale==="ja"?"ja-JP":"en-US"},
    evidence:[...selectedSources.values()],claims:[...selectedClaims.values()],assets:[],
    gaps:["Discovery excerpts and factual claims require independent editorial review before release.",
      ...(hasManualClaims?["Uncited manual or imported sections need supporting sources and factual review before release."]:[])],
    review:{status:"draft"}};
  const acts=[{id:"act_setup",question:input.viewerQuestion,purpose:"Establish the audience problem and initial evidence.",payoff:"Explain what must be compared."},
    {id:"act_resolution",question:input.viewerQuestion,purpose:"Demonstrate the mechanism and practical answer.",payoff:"Resolve the audience question with caveats."}];
  const explanation=[],shots=[],sound=[];
  for(let index=0;index<units.length;index++){
    const {section,claimIds,beat}=units[index],explanationId=`explain_${index+1}`;
    const chunks=splitNarration(flat(section.text));
    explanation.push({id:explanationId,actId:index<2?"act_setup":"act_resolution",
      claimIds,before:`Question: ${input.viewerQuestion}`.slice(0,700),
      demonstration:section.purpose,after:section.heading});
    for(const [part,narration] of chunks.entries()){
      const id=`shot_${index+1}_${part+1}`;
      const opening=index===0&&part===0,ending=index===answerIndex&&part===chunks.length-1;
      const postscript=index>answerIndex;
      const visuals=scriptSceneVisuals(narration);
      shots.push({id,explanationId,family:opening?"question":ending||postscript?"summary":
        ({hook:"question",context:"evidence",mechanism:"process",practical:"comparison",closing:"summary",custom:"process",promotion:"summary"}[scriptSectionRole(section)]),
        purpose:opening?"hook":ending?"answer":postscript?"postscript":"explain",subjectIds:["topic_focus"],
        visualChange:flat(beat?.visualObjective??section.purpose),
        onScreenText:flat(beat?.onScreenText??section.heading),
        ...(visuals?{visualElements:visuals}:{}),
        motion:{...SCRIPT_SCENE_MOTION},
        claimIds,assetRefs:[]});
      sound.push({shotId:id,narration,delivery:opening?"curious":ending?"reflective":"conversational",
        energy:opening?"energetic":ending?"calm":"focused",pauseAfterMs:250,sfxIntent:null});
    }
  }
  if(shots.length>40)throw Error("The approved script exceeds Director's 40-shot limit. Shorten the script before import.");
  const continuity=shots.slice(1).map((shot,index)=>({fromShotId:shots[index].id,toShotId:shot.id,
    technique:"cut",subjectIds:["topic_focus"],reason:"Advance to the next sourced explanation."}));
  const answerShot=shots.findLastIndex(shot=>shot.explanationId===`explain_${answerIndex+1}`);
  const payoff=answerShot;
  const indexes=[0,Math.floor(payoff/2),payoff];
  const phases=["problem","mechanism","payoff"].map((kind,index)=>{
    const shot=shots[indexes[index]];
    const spoken=sound.find(item=>item.shotId===shot.id)?.narration??shot.onScreenText;
    const lead=spoken.split(/[,、.!?。！？]/u).map(part=>part.trim()).find(part=>part.length>=12)??spoken;
    return {kind,shotId:shot.id,
      visualAction:`Show ${shot.onScreenText}: ${lead}`.replace(/\s+/gu," ").trim().slice(0,300),
      learningChange:`${shot.onScreenText}: ${lead}`.replace(/\s+/gu," ").trim().slice(0,220)};
  });
  const teachClaims=[...new Set(indexes.flatMap(index=>shots[index].claimIds))];
  const plan={schemaVersion:1,kind:"preproduction-plan",researchId:dossier.id,
    styleId:"cinematic-explainer-v1",story:{pattern:"investigation",premise:input.title,
      hook:script.sections[0].heading,question:input.viewerQuestion,
      answerExplanationId:`explain_${answerIndex+1}`,acts},explanation,shots,continuity,sound,
    teachingSequences:[{id:"sequence_core",mode:"direct",question:input.viewerQuestion,
      technicalSubjectId:"topic_focus",analogy:null,claimIds:teachClaims,phases}]};
  return {dossier,bundle:compilePreproductionBundle(dossier,plan)};
}
