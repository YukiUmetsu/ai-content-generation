/** Convert a human-approved five-part script into an editable, explicitly
 * unverified Director draft. No model inference, rights clearance or rendering. */
import { createHash } from "node:crypto";
import { compilePreproductionBundle } from "./preproduction.mjs";

const roles=["hook","context","mechanism","practical","closing"];
const safeText=(value,max)=>typeof value==="string"&&value.trim().length>0&&
  value.length<=max&&!/[\u0000-\u001f]/u.test(value);
const safeNarration=(value,max)=>typeof value==="string"&&value.trim().length>0&&
  value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value);
const flat=value=>value.replace(/\s+/gu," ").trim();
function splitNarration(value){
  if(value.length<=2000)return [value];
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
export function compileApprovedScriptDirector({productionId,script,evidence,sources,storyboard}){
  if(!/^production-[a-f0-9]{24}$/u.test(productionId??"")||
    script?.status!=="approved"||script?.input?.productionId!==productionId||
    script?.input?.platform!=="youtube"||
    !Array.isArray(script?.sections)||script.sections.length!==5||
    script.sections.some((section,index)=>section?.id!==roles[index]))
    throw Error("Choose an approved YouTube script belonging to this production before opening Director.");
  const input=script.input;
  if(!safeText(input.title,200)||!safeText(input.viewerQuestion,240)||
    !safeText(input.audience,180)||!["en","ja"].includes(input.locale))
    throw Error("The approved script's title, question, language or audience is invalid.");
  if(storyboard!==undefined){
    if(!safeText(script.updatedAt,60)||!Array.isArray(storyboard?.assumptions)||
      !storyboard.assumptions.includes(`Approved script revision: ${script.updatedAt}.`)||
      !Array.isArray(storyboard.beats)||storyboard.beats.length!==5)
      throw Error("The storyboard no longer matches the approved script revision. Update its outline first.");
    for(let index=0;index<5;index++){
      const beat=storyboard.beats[index],section=script.sections[index];
      if(beat?.id!==`script-beat-${section.id}`||beat.narration!==section.text||
        !safeNarration(beat.visualObjective,650)||!safeNarration(beat.onScreenText,240)||
        !Array.isArray(beat.claimRefs)||
        JSON.stringify([...beat.claimRefs].sort())!==JSON.stringify([...section.claimRefs].sort()))
        throw Error("The edited storyboard conflicts with its approved narration or citations. Reconcile it before Director import.");
    }
  }
  if(!Array.isArray(evidence)||!evidence.length||!Array.isArray(sources)||!sources.length)
    throw Error("Captured evidence and source records are needed to build an editable Director draft.");
  if(evidence.length>40||sources.length>40)throw Error("Too many captured passages for one Director draft.");
  const bySource=new Map(sources.map(source=>[source.id,source]));
  const selectedClaims=new Map();const selectedSources=new Map();
  const claimIdentity=new Map(),sourceIdentity=new Map();
  const sectionClaims=[];
  for(const section of script.sections){
    if(!safeText(section.heading,240)||!safeText(section.purpose,400)||
      !safeNarration(section.text,6500)||!Array.isArray(section.claimRefs)||
      !Array.isArray(section.sourceRefs)||!section.claimRefs.length||
      section.claimRefs.length>40||section.sourceRefs.length>40)
      throw Error("Each approved script section needs narration and linked captured claims before Director import.");
    if(section.sourceRefs.length===0)throw Error("A script section has no source citations. Add captured references before Director import.");
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
  const dossier={schemaVersion:1,kind:"research-dossier",
    id:`script_${productionId.slice("production-".length)}`,
    topic:{title:input.title,viewerQuestion:input.viewerQuestion,
      audience:input.audience,locale:input.locale==="ja"?"ja-JP":"en-US"},
    evidence:[...selectedSources.values()],claims:[...selectedClaims.values()],assets:[],
    gaps:["Discovery excerpts and factual claims require independent editorial review before release."],
    review:{status:"draft"}};
  const acts=[{id:"act_setup",question:input.viewerQuestion,purpose:"Establish the audience problem and initial evidence.",payoff:"Explain what must be compared."},
    {id:"act_resolution",question:input.viewerQuestion,purpose:"Demonstrate the mechanism and practical answer.",payoff:"Resolve the audience question with caveats."}];
  const explanation=[],shots=[],sound=[];
  for(let index=0;index<script.sections.length;index++){
    const section=script.sections[index],explanationId=`explain_${index+1}`;
    const beat=storyboard?.beats[index];
    const chunks=splitNarration(flat(section.text));
    explanation.push({id:explanationId,actId:index<2?"act_setup":"act_resolution",
      claimIds:sectionClaims[index],before:`Question: ${input.viewerQuestion}`.slice(0,700),
      demonstration:section.purpose,after:section.heading});
    for(const [part,narration] of chunks.entries()){
      const id=`shot_${index+1}_${part+1}`;
      const opening=index===0&&part===0,ending=index===4&&part===chunks.length-1;
      shots.push({id,explanationId,family:opening?"question":ending?"summary":
        ["question","evidence","process","comparison","summary"][index],
        purpose:opening?"hook":ending?"answer":"explain",subjectIds:["topic_focus"],
        visualChange:flat(beat?.visualObjective??section.purpose),
        onScreenText:flat(beat?.onScreenText??section.heading),
        claimIds:sectionClaims[index],assetRefs:[]});
      sound.push({shotId:id,narration,delivery:opening?"curious":ending?"reflective":"conversational",
        energy:opening?"energetic":ending?"calm":"focused",pauseAfterMs:250,sfxIntent:null});
    }
  }
  if(shots.length>40)throw Error("The approved script exceeds Director's 40-shot limit. Shorten the script before import.");
  const continuity=shots.slice(1).map((shot,index)=>({fromShotId:shots[index].id,toShotId:shot.id,
    technique:"cut",subjectIds:["topic_focus"],reason:"Advance to the next sourced explanation."}));
  const indexes=[0,Math.floor((shots.length-1)/2),shots.length-1];
  const phases=["problem","mechanism","payoff"].map((kind,index)=>({kind,
    shotId:shots[indexes[index]].id,
    visualAction:["Reveal the core question and context.","Compare how the relevant factors change.","Reveal the supported takeaway and limitation."][index],
    learningChange:["Understand the decision to investigate.","Identify the mechanism and evidence.","Connect the answer to a practical conclusion."][index]}));
  const teachClaims=[...new Set(indexes.flatMap(index=>shots[index].claimIds))];
  const plan={schemaVersion:1,kind:"preproduction-plan",researchId:dossier.id,
    styleId:"cinematic-explainer-v1",story:{pattern:"investigation",premise:input.title,
      hook:script.sections[0].heading,question:input.viewerQuestion,
      answerExplanationId:"explain_5",acts},explanation,shots,continuity,sound,
    teachingSequences:[{id:"sequence_core",mode:"direct",question:input.viewerQuestion,
      technicalSubjectId:"topic_focus",analogy:null,claimIds:teachClaims,phases}]};
  return {dossier,bundle:compilePreproductionBundle(dossier,plan)};
}
