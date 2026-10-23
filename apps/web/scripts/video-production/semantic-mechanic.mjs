/**
 * ContentGen's bounded, evidence-linked *authoring intent* for Kumiki scenes.
 * No pixels, scripts, URLs, timings, easing, assets or frame clocks come from AI.
 */
export const VISUAL_OPERATORS=Object.freeze(["split","assemble","transfer","accumulate","compare","reveal"]);
const roles=new Set(["subject","part","source","destination","result"]);
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const id=value=>typeof value==="string"&&/^[a-z][a-z0-9_-]{0,63}$/u.test(value);
const label=value=>typeof value==="string"&&value.length>=2&&value.length<=42&&value.trim()===value&&
  !/[\p{C}<>`{}\\]/u.test(value)&&!/https?:|www\.|data:|javascript:|\/\//iu.test(value);
// Qualitative grammar cannot imply an unverified price, count, percentage or scale.
const quantity=value=>typeof value==="string"&&/[\p{N}$€£¥%]/u.test(value);
const keys=(value,allowed,at,add)=>{if(!object(value)){add("mechanic-shape",at,"Structured visual mechanic object required.");return false;}
  for(const key of Object.keys(value))if(!allowed.includes(key))add("mechanic-unknown-field",`${at}.${key}`,"Unexpected field; visual code and coordinates are forbidden.");
  return true;
};

/**
 * @param {unknown} mechanic
 * @param {{technicalSubjectId?:string,knownClaimIds?:ReadonlySet<string>,knownAssetKeys?:ReadonlySet<string>}} context
 * @returns {{ok:boolean,findings:Array<{severity:'error',code:string,path:string,message:string}>}}
 */
export function validateVisualMechanic(mechanic,context={}){
  const findings=[];
  const add=(code,path,message)=>findings.push({severity:"error",code,path,message});
  if(!keys(mechanic,["version","operator","subjectId","actors","operands","outcomeId"],"visualMechanic",add))
    return {ok:false,findings};
  if(mechanic.version!==1)add("mechanic-version","visualMechanic.version","Only version 1 is supported.");
  if(!VISUAL_OPERATORS.includes(mechanic.operator))
    add("mechanic-operator","visualMechanic.operator","Choose a supported semantic operation.");
  if(!id(mechanic.subjectId)||context.technicalSubjectId&&mechanic.subjectId!==context.technicalSubjectId)
    add("mechanic-subject","visualMechanic.subjectId","Use the existing technicalSubjectId unchanged.");
  const actors=mechanic.actors;
  if(!Array.isArray(actors)||actors.length<2||actors.length>12)
    add("mechanic-actors","visualMechanic.actors","Provide 2–12 distinct named actors.");
  const ids=new Set(),byId=new Map();
  for(const [i,actor] of (Array.isArray(actors)?actors:[]).entries()){
    const path=`visualMechanic.actors[${i}]`;
    if(!keys(actor,["id","label","role","assetKey","claimIds"],path,add))continue;
    if(!id(actor.id))add("mechanic-actor-id",path+".id","Use a stable lowercase actor ID.");
    if(ids.has(actor.id))add("mechanic-duplicate-id",path+".id","Actor IDs must be unique.");
    ids.add(actor.id);byId.set(actor.id,actor);
    if(!label(actor.label))add("mechanic-label",path+".label","Use a short printable visible noun, without markup or URLs.");
    if(quantity(actor.label))add("mechanic-quantity",path+".label","Numbers, prices, ratios and scaling require a separately verified chart.");
    if(!roles.has(actor.role))add("mechanic-role",path+".role","Unrecognized actor role.");
    if(actor.assetKey!==undefined&&(!id(actor.assetKey)||!context.knownAssetKeys?.has(actor.assetKey)))
      add("mechanic-asset",path+".assetKey","Select a locally registered, reviewed asset key; remote URLs are not allowed.");
    if(!Array.isArray(actor.claimIds)||!actor.claimIds.length||actor.claimIds.length>12||
      new Set(actor.claimIds).size!==actor.claimIds.length||
      actor.claimIds.some(claim=>!id(claim)||!context.knownClaimIds?.has(claim)))
      add("mechanic-claim",path+".claimIds","Each actor must cite existing research/illustrative claim IDs.");
  }
  const operands=mechanic.operands;
  if(!Array.isArray(operands)||operands.length<2||operands.length>6||new Set(operands).size!==operands.length)
    add("mechanic-operands","visualMechanic.operands","Provide 2–6 distinct ordered actor IDs.");
  for(const [i,ref] of (Array.isArray(operands)?operands:[]).entries())
    if(!id(ref)||!byId.has(ref))add("mechanic-actor-ref",`visualMechanic.operands[${i}]`,"Operand must name an existing actor.");
  if(!id(mechanic.outcomeId)||!byId.has(mechanic.outcomeId))
    add("mechanic-actor-ref","visualMechanic.outcomeId","Outcome must name an existing actor.");
  if(!byId.has(mechanic.subjectId)||byId.get(mechanic.subjectId)?.role!=="subject")
    add("mechanic-subject","visualMechanic.actors","A subject actor with the technical subject ID is required.");
  if(VISUAL_OPERATORS.includes(mechanic.operator)&&Array.isArray(operands)){
    const opRoles=operands.map(key=>byId.get(key)?.role);
    const result=byId.get(mechanic.outcomeId)?.role;
    const parts=opRoles.every(role=>role==="part");
    let valid=false;
    switch(mechanic.operator){
      case "split":valid=parts&&mechanic.outcomeId===mechanic.subjectId;break;
      case "assemble":case "accumulate":valid=parts&&result==="result"&&!operands.includes(mechanic.outcomeId);break;
      case "compare":valid=parts&&mechanic.outcomeId===mechanic.subjectId;break;
      case "transfer":valid=operands.length===2&&opRoles[0]==="source"&&opRoles[1]==="destination"&&mechanic.outcomeId===mechanic.subjectId;break;
      case "reveal":valid=operands.length===2&&opRoles[0]==="source"&&opRoles[1]==="part"&&mechanic.outcomeId===operands[1];break;
    }
    if(!valid)add("mechanic-roles","visualMechanic","The chosen operation must use a meaningful, ordered actor/role relationship.");
  }
  return {ok:findings.length===0,findings};
}
