/** Shared browser/server authoring contract. Section identity is independent of narrative role. */
export const MAX_SCRIPT_SECTIONS=20;
export const SCRIPT_ROLES=Object.freeze(["hook","context","mechanism","practical","closing","custom","promotion"]);
export function isScriptSectionId(value){
  return typeof value==="string"&&/^[a-z][a-z0-9_-]{1,47}$/u.test(value)&&
    !["constructor","prototype","tostring","hasownproperty","valueof"].includes(value.toLowerCase());
}
export function scriptSectionRole(section){
  return section.role??(SCRIPT_ROLES.includes(section.id??section.sectionId)?section.id??section.sectionId:"custom");
}
export function scriptAnswerIndex(sections){
  const closing=sections.findLastIndex(section=>scriptSectionRole(section)==="closing");
  if(closing>=0)return closing;
  const lastContent=sections.findLastIndex(section=>scriptSectionRole(section)!=="promotion");
  return lastContent>=0?lastContent:sections.length-1;
}
/** Keep uncited narration separate even if captured evidence uses the same ID. */
export function scriptStoryboardClaimRefs(section,evidence){
  if(section.claimRefs.length)return section.claimRefs;
  const occupied=new Set(evidence.map(item=>item.claimId));
  const base=`manual_${section.id}`;
  let id=base,index=0;
  while(occupied.has(id))id=`${base}_${++index}`;
  return [id];
}
