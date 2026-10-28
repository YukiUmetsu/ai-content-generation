/** Safe three-way carry-forward of per-scene authoring choices after a new
 * script is compiled. Changed source fields and scene identities are never
 * overwritten just because an older tab saved an edit with the same shot ID.
 * The caller must submit the proposed changes to the validating Rust/Node
 * Director API; this module never mutates a production plan.
 */
type Plain=Record<string,unknown>;
type ScenePlan={shots:Plain[];sound:Plain[];teachingSequences:Array<{phases:Plain[]}>};
type SceneBundle={kind:string;researchId:string;researchSha256:string;planSha256:string;plan:ScenePlan};
type Patch={shotId:string;changes:Record<string,unknown>};
const sha=/^[a-f0-9]{64}$/u;
const fields={
  shot:["onScreenText","visualChange","family","visualElements","motion"],
  sound:["narration","sfxIntent","pauseAfterMs"],
  phase:["visualAction"]
} as const;

function asPlan(value:unknown):SceneBundle|null{
  if(!value||typeof value!=="object")return null;
  const b=value as SceneBundle;
  if(b.kind!=="preproduction-bundle"||typeof b.researchId!=="string"||
    !sha.test(b.researchSha256)||!sha.test(b.planSha256)||
    !Array.isArray(b.plan?.shots)||!Array.isArray(b.plan.sound)||
    !Array.isArray(b.plan.teachingSequences)||b.plan.shots.length>60||
    b.plan.shots.length===0||b.plan.sound.length>60||
    b.plan.teachingSequences.length>60||
    b.plan.teachingSequences.some(seq=>!Array.isArray(seq?.phases)||seq.phases.length>60))return null;
  for(const list of [b.plan.shots,b.plan.sound,...b.plan.teachingSequences.map(seq=>seq.phases)]){
    if(list.some(entry=>!entry||typeof entry!=="object"||Array.isArray(entry)))return null;
  }
  return b;
}

const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const indexed=(items:Plain[],key:string)=>{
  const entries=new Map<string,Plain>();
  for(const item of items){
    const id=item[key];
    if(typeof id!=="string"||!/^[a-z0-9][a-z0-9._:-]{0,127}$/iu.test(id)||entries.has(id))return null;
    entries.set(id,item);
  }
  return entries;
};
const phases=(plan:ScenePlan)=>indexed(plan.teachingSequences.flatMap(seq=>seq.phases),"shotId");

/** Only field-level edits whose original value survived regeneration move to
 * the next script. Other edits stay available in the prior saved version. */
export function transferableDirectorEdits(baseInput:unknown,editedInput:unknown,nextInput:unknown):
  {patches:Patch[];skipped:number}{
  const base=asPlan(baseInput),edited=asPlan(editedInput),next=asPlan(nextInput);
  if(!base||!edited||!next||base.researchId!==edited.researchId||
    base.researchId!==next.researchId||base.researchSha256!==edited.researchSha256||
    base.researchSha256!==next.researchSha256)return {patches:[],skipped:0};
  const indexes=[base,edited,next].map(bundle=>({
    shot:indexed(bundle.plan.shots,"id"),sound:indexed(bundle.plan.sound,"shotId"),
    phase:phases(bundle.plan)
  }));
  if(indexes.some(x=>!x.shot||!x.sound||!x.phase))return {patches:[],skipped:0};
  const patches:Patch[]=[];
  let skipped=0;
  for(const source of base.plan.shots){
    const id=source.id as string;
    const original=indexes[0].shot!.get(id),saved=indexes[1].shot!.get(id),incoming=indexes[2].shot!.get(id);
    if(!original||!saved)continue;
    // Never assume scene IDs still refer to the same story beat.
    const identityMatches=!!incoming&&original.purpose===saved.purpose&&
      original.purpose===incoming.purpose&&original.sceneRecipe===incoming.sceneRecipe;
    const changes:Record<string,unknown>={};
    for(const [group,names] of Object.entries(fields) as Array<[keyof typeof fields,readonly string[]]>){
      const before=indexes[0][group]!.get(id),after=indexes[1][group]!.get(id),now=indexes[2][group]!.get(id);
      if(!before||!after)continue;
      for(const field of names){
        if(equal(before[field],after[field]))continue;
        if(after[field]===undefined){skipped++;continue;}
        if(!identityMatches||!now||(!equal(now[field],before[field])&&!equal(now[field],after[field]))){
          skipped++;continue;
        }
        if(equal(now[field],after[field]))continue;
        if(group==="shot"&&field==="family"&&
          (id===next.plan.shots[0]?.id||id===next.plan.shots.at(-1)?.id||incoming?.sceneRecipe)){
          skipped++;continue;
        }
        changes[field]=structuredClone(after[field]);
      }
    }
    if(Object.keys(changes).length)patches.push({shotId:id,changes});
  }
  return {patches,skipped};
}
