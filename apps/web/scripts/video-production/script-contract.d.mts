export const MAX_SCRIPT_SECTIONS: 20;
export const SCRIPT_ROLES: readonly ["hook","context","mechanism","practical","closing","custom","promotion"];
type Role=typeof SCRIPT_ROLES[number];
export function isScriptSectionId(value:unknown):value is string;
export function scriptSectionRole(section:{id?:string;sectionId?:string;role?:Role}):Role;
export function scriptAnswerIndex(sections:readonly {id?:string;role?:Role}[]):number;
export function scriptStoryboardClaimRefs(section:{id:string;claimRefs:string[]},evidence:readonly {claimId:string}[]):string[];
