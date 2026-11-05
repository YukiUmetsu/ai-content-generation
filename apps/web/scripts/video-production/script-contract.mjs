/** Shared browser/server authoring contract. Section identity is independent of narrative role. */
export const MAX_SCRIPT_SECTIONS=20;
export const SCRIPT_ROLES=Object.freeze(["hook","context","mechanism","practical","closing","custom","promotion"]);
/** The default outline of a new script. Each heading and purpose is a note for the author.
 * Neither is written for the viewer, so neither may be shown on screen as it stands. */
export const SCRIPT_OUTLINE=Object.freeze([
  {id:"hook",heading:"Opening hook",purpose:"Show a specific audience problem, immediate visual promise and central question."},
  {id:"context",heading:"Why it matters",purpose:"Establish relatable stakes, baseline and scope without repeating the hook."},
  {id:"mechanism",heading:"How it works",purpose:"Explain the causal mechanism with sourced examples, not a generic list."},
  {id:"practical",heading:"What changes the outcome",purpose:"Compare options, sensitivity or useful next steps with limitations."},
  {id:"closing",heading:"Answer and takeaway",purpose:"Resolve the opening question and make the caveats explicit."},
].map(section=>Object.freeze(section)));
const outlineKey=value=>String(value??"").replace(/\s+/gu," ").trim().toLocaleLowerCase().replace(/[\s.:：…]+$/u,"");
const OUTLINE_HEADINGS=new Set(SCRIPT_OUTLINE.map(section=>outlineKey(section.heading)));
/** A heading nobody wrote for the viewer: a default outline heading, or the "Section N" an import assigns. */
export function isOutlineHeading(value){
  const key=outlineKey(value);
  return OUTLINE_HEADINGS.has(key)||/^section \d{1,3}$/u.test(key);
}
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
