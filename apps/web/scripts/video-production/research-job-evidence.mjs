/** Deterministic, model-free source capture and provisional evidence for resumable Studio jobs. */
import { createHash } from "node:crypto";
import { extractPageText, fetchPublicPage, publicSourceUrl, validateExtractedClaims } from "./research-agent.mjs";
import { parseResearchDossier } from "./preproduction.mjs";

const sha=value=>createHash("sha256").update(value).digest("hex");
const JP_STOP=new Set(["です","ます","する","した","して","いる","ある","こと","もの","ため","から","そして","どう","いつ","どこ","どれ","これ","それ","あれ","では","ので","でしょう","によって"]);
const words=(value,locale="en-US")=>{
  const source=String(value).toLocaleLowerCase();
  const terms=new Set(source.match(/[\p{L}\p{N}]{3,}/gu)??[]);
  // Japanese/Chinese/Korean text has no reliable whitespace boundaries. Rank by
  // adjacent ideographs/kana words, without treating common hiragana particles
  // as useful evidence of topical relevance.
  for(const span of source.match(/[\p{Script=Han}\p{Script=Katakana}\p{Script=Hangul}\u30fc]{2,}/gu)??[]){
    for(let index=0;index<span.length-1;index++)terms.add(span.slice(index,index+2));
  }
  if(/^(ja|zh|ko)(?:-|$)/iu.test(locale)){
    const segmenter=new Intl.Segmenter(locale,{granularity:"word"});
    for(const {segment,isWordLike} of segmenter.segment(source)){
      if(isWordLike&&segment.length>=2&&!JP_STOP.has(segment)&&
        /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(segment))terms.add(segment);
    }
  }
  return terms;
};
const STOP=new Set(["what","why","when","where","which","does","that","this","the","for","are","how","and","can","with","from","into","your","you","home","high","cost","costs","lifetime"]);

/** A failed page is a source gap, not a citation. Preserve the successful captures. */
export async function captureSavedSources(savedSearch,brief,{fetchPage=fetchPublicPage,signal,maxSources=4,now=()=>new Date()}={}){
  if(!Array.isArray(savedSearch?.results)||!savedSearch.results.length)throw Error("Saved search contains no source leads.");
  const captures=[],gaps=[],seen=new Set();
  for(const lead of savedSearch.results.slice(0,10)){
    if(captures.length>=Math.min(6,Math.max(1,maxSources)))break;
    if(signal?.aborted)throw signal.reason??Error("Capture cancelled.");
    let url;
    try{url=publicSourceUrl(lead.url);}catch{continue;}
    if(seen.has(url)||typeof lead.title!=="string"||!lead.title.trim()||lead.title.length>240)continue;
    seen.add(url);
    try{
      const page=await fetchPage(url,{signal});
      const contents=extractPageText(page.html,page.type);
      if(contents.length<150)throw Error("Insufficient usable source text.");
      captures.push({id:"source_"+String(captures.length+1).padStart(2,"0"),url,title:lead.title,
        text:contents,retrievedAt:now().toISOString()});
    }catch(error){
      if(signal?.aborted)throw signal.reason??Error("Capture cancelled.");
      gaps.push("Unable to capture "+new URL(url).hostname+": "+String(error?.message??"Source unavailable").slice(0,100));
    }
  }
  if(!captures.length)throw Error("No public source pages could be captured; saved search remains available.");
  return {captures,gaps:gaps.slice(0,30)};
}

/** Passages are exact contiguous substrings; lexical ranking does not verify their factual truth. */
export function buildDeterministicDossier(brief,captures,gaps=[]){
  if(!Array.isArray(captures)||!captures.length)throw Error("Research requires captured evidence.");
  const terms=[...words(brief.viewerQuestion+" "+brief.title,brief.locale)].filter(term=>!STOP.has(term));
  const candidates=captures.flatMap(capture=>{
    const sentences=capture.text.match(/[^.!?。！？]+[.!?。！？]?/gu)??[];
    return sentences.flatMap(sentence=>{
      const quote=sentence.trim();
      const japanese=brief.locale?.startsWith("ja")||brief.locale?.startsWith("zh")||brief.locale?.startsWith("ko");
      if(quote.length<(japanese?12:35)||quote.length>300||/\b(cookie|privacy policy|subscribe|javascript|advertisement)\b/iu.test(quote))return [];
      const found=words(quote,brief.locale),matched=terms.filter(term=>found.has(term));
      const score=matched.length;
      // One shared two-character word (e.g. 日本) is too weak to cite an
      // unrelated Japanese page. An exact longer term or two independent
      // overlaps are stronger evidence of topical relevance.
      const relevant=japanese?(score>=2||matched.some(term=>term.length>=3)):score>0;
      return relevant?[{sourceId:capture.id,quote,score}]:[];
    });
  }).sort((a,b)=>b.score-a.score||b.quote.length-a.quote.length||a.sourceId.localeCompare(b.sourceId));
  const perSource=new Map();
  const selected=candidates.filter(item=>{
    const current=perSource.get(item.sourceId)??0;
    if(current>=2)return false;
    perSource.set(item.sourceId,current+1);return true;
  }).slice(0,12);
  if(!selected.length)throw Error("No relevant source excerpts could be captured for this question; revise the search or select different sources.");
  const extracted=validateExtractedClaims({claims:selected.map(item=>({text:item.quote,
    support:[{sourceId:item.sourceId,quote:item.quote}]})),gaps:[
    "Source excerpts are automatically selected by relevance, not verified. Review them in context before publication.",
    ...gaps,
  ].slice(0,20)},captures);
  const id="research_"+sha(JSON.stringify({brief,captures:captures.map(c=>[c.url,sha(c.text)])})).slice(0,16);
  const dossier={schemaVersion:1,kind:"research-dossier",id,
    topic:{title:brief.title,viewerQuestion:brief.viewerQuestion,audience:brief.audience,locale:brief.locale??"en-US"},
    evidence:extracted.evidence,claims:extracted.claims,assets:[],gaps:extracted.gaps,review:{status:"draft"}};
  const verdict=parseResearchDossier(dossier);
  if(!verdict.ok)throw Error("Deterministic dossier rejected: "+verdict.findings.map(x=>x.code).join(", "));
  return {dossier,quotes:extracted.quotePreviews,captures,warnings:["All claims are unverified direct source excerpts."]};
}

export function selectEvidenceForScene(dossier,quotes,selectedClaimIds){
  const known=new Set(selectedClaimIds);
  return dossier.claims.filter(claim=>known.has(claim.id)).slice(0,4).map(claim=>({
    claimId:claim.id,text:claim.text,quotes:quotes.filter(q=>q.claimId===claim.id).slice(0,2)
      .map(q=>({sourceId:q.sourceId,quote:q.quote.slice(0,320)})),
  }));
}
