import {MAX_SCRIPT_SECTIONS,SCRIPT_ROLES} from "../../scripts/video-production/script-contract.mjs";
import {manualScriptSection,validateScriptDraft,scriptDraftKey,saveScriptDraft,MAX_SCRIPT_DRAFT_BYTES,
  type ScriptDraft,type ScriptEvidence,type ScriptPlatform,type ScriptRole,type NewScriptSection} from "./script-review-model";
export const MAX_SCRIPT_IMPORT_BYTES=512*1024;
export type ScriptImportSection=NewScriptSection;
const bytes=(value:string)=>new TextEncoder().encode(value).length;
function safeString(value:unknown,label:string,max:number,min=1):string {
  if(typeof value!=="string"||value.trim().length<min||value.length>max||[...value].some(char=>{const code=char.charCodeAt(0);return code<=8||code===11||code===12||(code>=14&&code<=31);}))
    throw Error(`${label} must contain ${min}–${max} safe characters.`);
  return value.trim();
}
function references(value:unknown):string[]{
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>40||value.some(id=>typeof id!=="string"||!/^[a-z0-9][a-z0-9_-]{0,100}$/iu.test(id))||new Set(value).size!==value.length)
    throw Error("Citations must be a list of distinct existing reference IDs.");
  return value;
}
function jsonSection(value:unknown,index:number):ScriptImportSection {
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error(`Section ${index+1} must be an object.`);
  const row=value as Record<string,unknown>;
  if(Object.keys(row).some(key=>!["heading","purpose","role","text","narration","claimRefs","sourceRefs"].includes(key)))throw Error(`Section ${index+1} has unsupported fields.`);
  if(row.text!==undefined&&row.narration!==undefined)throw Error("Use text or narration, not both.");
  const heading=safeString(row.heading??`Section ${index+1}`,"Heading",140);
  const role=row.role??"custom";
  if(!SCRIPT_ROLES.includes(role as ScriptRole))throw Error(`Section ${index+1} has an invalid role.`);
  return {heading,role:role as ScriptRole,purpose:safeString(row.purpose??`Explain the content of ${heading}.`,"Purpose",400,10),
    text:safeString(row.text??row.narration,"Narration",6500),claimRefs:references(row.claimRefs),sourceRefs:references(row.sourceRefs)};
}
/** Parse only: no persistence, AI inference, citation invention or owner/approval import. */
export function parseScriptImport(raw:string):ScriptImportSection[] {
  if(bytes(raw)>MAX_SCRIPT_IMPORT_BYTES)throw Error("Script import exceeds 512 KB.");
  const source=raw.replace(/^\uFEFF/u,"").replace(/\r\n?/gu,"\n").trim();
  if(!source)throw Error("Paste JSON or numbered [1], [2] script blocks.");
  let rows:ScriptImportSection[];
  if(/^\[\d+\]/u.test(source)) {
    const markers=[...source.matchAll(/^\[(\d+)\][ \t]?(.*)$/gmu)];
    if(!markers.length)throw Error("Use numbered section markers at the beginning of a line.");
    rows=markers.map((match,index)=>{
      if(Number(match[1])!==index+1)throw Error("Numbered sections must be consecutive: [1], [2], [3]…");
      const start=match.index!+match[0].length,end=markers[index+1]?.index??source.length;
      const body=[match[2],source.slice(start,end)].join("").trim();
      return jsonSection({heading:`Section ${index+1}`,text:body},index);
    });
  } else {
    let value:unknown;
    try{value=JSON.parse(source);}catch{throw Error("Invalid JSON. Use a sections array, or start numbered text with [1].");}
    if(value&&typeof value==="object"&&!Array.isArray(value)){
      const document=value as Record<string,unknown>;
      if(Object.keys(document).some(key=>!["sections","version"].includes(key))||(document.version!==undefined&&document.version!==1))
        throw Error("Expected {sections:[...]} with optional version:1; identity and approval fields cannot be imported.");
      value=document.sections;
    }
    if(!Array.isArray(value))throw Error("JSON must contain a sections array.");
    rows=value.map(jsonSection);
  }
  if(rows.length<1||rows.length>MAX_SCRIPT_SECTIONS)throw Error(`Import between 1 and ${MAX_SCRIPT_SECTIONS} sections.`);
  return rows;
}
export function applyScriptImport(draft:ScriptDraft,rows:readonly ScriptImportSection[],evidence:readonly ScriptEvidence[],now=new Date().toISOString()):ScriptDraft {
  if(rows.length<1||rows.length>MAX_SCRIPT_SECTIONS)throw Error("Invalid imported section count.");
  const sections=rows.map(row=>{
    const claims=row.claimRefs??[],sources=row.sourceRefs??[];
    if(claims.some(id=>!evidence.some(item=>item.claimId===id&&sources.includes(item.sourceId)))||
      sources.some(id=>!evidence.some(item=>item.sourceId===id&&claims.includes(item.claimId)))||Boolean(claims.length)!==Boolean(sources.length))
      throw Error("Imported citation references must match the current production's captured evidence.");
    return manualScriptSection(row,undefined,now);
  });
  return validateScriptDraft({...draft,sections,pending:{},status:"draft",approvedAt:null,updatedAt:now});
}
const backupKey=(id:string,platform:ScriptPlatform)=>scriptDraftKey(id,platform)+":before-replacement";
export function saveScriptReplacement(next:ScriptDraft,previous:ScriptDraft):void {
  const checked=validateScriptDraft(next),old=validateScriptDraft(previous);
  if(checked.input.productionId!==old.input.productionId||checked.input.projectId!==old.input.projectId||checked.input.platform!==old.input.platform)
    throw Error("Cannot replace a different script output.");
  const raw=JSON.stringify(old);
  if(bytes(raw)>MAX_SCRIPT_DRAFT_BYTES)throw Error("Previous script exceeds backup limit.");
  // Write the recovery copy first; if storage fails, never overwrite the active draft.
  const key=backupKey(old.input.productionId,old.input.platform);
  const priorBackup=localStorage.getItem(key);
  localStorage.setItem(key,raw);
  try {saveScriptDraft(checked);}
  catch(problem){
    // A failed restore must not replace the only recovery copy with the active script.
    if(priorBackup===null)localStorage.removeItem(key);
    else localStorage.setItem(key,priorBackup);
    throw problem;
  }
}
export function loadScriptBackup(id:string,platform:ScriptPlatform):ScriptDraft|null {
  const raw=localStorage.getItem(backupKey(id,platform));
  if(!raw)return null;
  if(bytes(raw)>MAX_SCRIPT_DRAFT_BYTES)throw Error("Saved script backup exceeds its limit.");
  const draft=validateScriptDraft(JSON.parse(raw));
  if(draft.input.productionId!==id||draft.input.platform!==platform)throw Error("Script backup identity mismatch.");
  return draft;
}
