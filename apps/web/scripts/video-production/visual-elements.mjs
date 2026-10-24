// Compact semantic on-screen teaching elements; rejects generic empty labels.
const isText=(s,max)=>typeof s==="string"&&s.trim()&&s.length<=max&&
  !/[\u0000-\u001f<>]/u.test(s)&&!/\s{3,}/u.test(s);
const generic=/^(?:house|categories|main idea|how it changes|step\s*\d+|item\s*\d+|node\s*\d+|thing|topic|concept|answer|problem|summary)$/iu;
export function isVisualElements(value){
 if(!Array.isArray(value)||value.length<2||value.length>5)return false;
 const labels=new Set();
 for(const element of value){
   if(!element||typeof element!=="object"||Array.isArray(element)||
     Object.keys(element).length!==2||!Object.hasOwn(element,"label")||!Object.hasOwn(element,"detail")||
     !isText(element.label,44)||!isText(element.detail,44)||generic.test(element.label.trim()))return false;
   const normalized=element.label.trim().toLocaleLowerCase();
   if(labels.has(normalized)||element.detail.trim().toLocaleLowerCase()===normalized)return false;
   labels.add(normalized);
 }
 return true;
}
export function normalizeVisualElements(value){
 if(!isVisualElements(value))throw Error("Add 2–5 specific visible elements with unique labels and meaningful short explanations, not placeholder words.");
 return value.map(({label,detail})=>({label:label.trim(),detail:detail.trim()}));
}
