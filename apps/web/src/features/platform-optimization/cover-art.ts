/**
 * Thumbnail-first, brand-aware layouts built with Kumiki's MediaDocument.
 * Unlike the article's informational diagrams, these compositions optimize for
 * one short promise readable at thumbnail size. No invented prices or photos.
 */
import { createArtboard, createDocument, normalizeDocument } from "@/components/media/document";
import { documentToSvg } from "@/components/media/svg-export";
import { getOutputProfile } from "@/components/infographic/art-direction";
import type { FontAsset, Layer, MediaDocument } from "@/components/media/document";
import type { OutputProfileId } from "@/components/infographic/types";
import type { PlatformBrandColors, PlatformScriptSection } from "./model";
import type { GeneratedArtwork } from "./generated-art";

const fonts:Record<string,FontAsset>={
  display:{id:"display",family:"Geist Variable",weight:800,style:"normal",fallback:["Arial","Helvetica","sans-serif"],availability:"pinned",licenseId:"OFL-1.1"},
  body:{id:"body",family:"Geist Variable",weight:650,style:"normal",fallback:["Arial","Helvetica","sans-serif"],availability:"pinned",licenseId:"OFL-1.1"},
};

function geometry(id:string,name:string,kind:Layer["kind"],x:number,y:number,width:number,height:number,z:number){
  return {id,name,kind,transform:{x,y,width,height},z,visible:true,locked:false,opacity:1,blend:"normal" as const,clip:false};
}

function rect(id:string,x:number,y:number,w:number,h:number,fill:string,z:number,radius=0):Layer{
  return {...geometry(id,id,"shape",x,y,w,h,z),kind:"shape",shape:{kind:"rect",fill,radius}};
}
function ellipse(id:string,x:number,y:number,w:number,h:number,fill:string,z:number):Layer{
  return {...geometry(id,id,"shape",x,y,w,h,z),kind:"shape",shape:{kind:"ellipse",fill}};
}
function words(id:string,value:string,x:number,y:number,w:number,h:number,size:number,color:string,z:number,
  options:{font?:"body"|"display";maxLines?:number;minSize?:number;weight?:number}={}):Layer{
  return {...geometry(id,id,"text",x,y,w,h,z),kind:"text",summary:value,
    text:{spans:[{text:value,color}],fontId:options.font??"display",size,
      lineHeight:1.06,letterSpacing:-Math.min(3,size*0.028),align:"start",direction:"auto",language:"en",
      fit:"shrink",minSize:options.minSize??Math.max(24,size*0.58),maxSize:size,maxLines:options.maxLines??3,as:"h1"}};
}
function clipText(text:string,max=62){
  const normalized=text.replace(/\s+/gu," ").trim();
  if(normalized.length<=max)return normalized;
  const short=normalized.slice(0,max-1).replace(/\s+\S*$/u,"").trimEnd();
  return (short||normalized.slice(0,max-1))+"…";
}

type Palette={dark:string;cream:string;accent:string;secondary:string;ink:string};
function palette(colors:PlatformBrandColors|undefined):Palette{
  return {dark:colors?.primary??"#152D36",cream:colors?.background??"#F8F4EC",
    accent:colors?.accent??"#F6BB57",secondary:colors?.secondary??"#4D807A",ink:colors?.text??"#122A32"};
}

function landscape(variant:number,w:number,h:number,title:string,heads:string[],p:Palette):MediaDocument{
  const layers:Layer[]=[];
  const add=(...items:Layer[])=>layers.push(...items);
  const m=w*0.055;
  if(variant===0){
    // Cinematic promise: high-contrast text + a layered-paper visual metaphor.
    add(ellipse("halo",w*.68,h*.09,w*.48,w*.82,p.secondary,0));
    add(rect("page-back",w*.74,h*.28,w*.19,h*.46,p.cream,1,24),
      rect("page-mid",w*.715,h*.24,w*.19,h*.46,p.accent,2,24),
      rect("page-front",w*.69,h*.20,w*.19,h*.46,p.cream,3,24));
    add(rect("page-line-a",w*.72,h*.31,w*.13,h*.015,p.dark,4,6),
      rect("page-line-b",w*.72,h*.37,w*.10,h*.015,p.secondary,4,6),
      rect("page-line-c",w*.72,h*.43,w*.11,h*.015,p.secondary,4,6));
    add(rect("accent-rule",m,h*.12,w*.065,h*.015,p.accent,5,8));
    add(words("category","THE EXPLAINER",m,h*.07,w*.42,h*.06,h*.038,p.cream,6,{font:"body",maxLines:1}),
      words("headline",title,m,h*.24,w*.61,h*.43,h*.145,p.cream,6,{maxLines:3,minSize:h*.07}),
      rect("baseline",m,h*.75,w*.13,h*.009,p.accent,5,4),
      words("first-idea",heads[0]??"",m,h*.80,w*.60,h*.10,h*.052,p.cream,6,{font:"body",maxLines:2}));
  }else if(variant===1){
    // Bento: one large question and three script-derived takeaways.
    add(rect("hero-panel",m,h*.075,w-2*m,h*.44,p.dark,1,28),
      rect("hero-rule",m+w*.027,h*.14,w*.045,h*.013,p.accent,2,4),
      words("headline",title,m+w*.027,h*.21,w*.82,h*.26,h*.119,p.cream,3,{maxLines:2,minSize:h*.068}));
    const gap=w*.016,cell=(w-2*m-2*gap)/3;
    for(let i=0;i<3;i++){
      const x=m+i*(cell+gap);
      add(rect(`tile-${i}`,x,h*.55,cell,h*.32,i===1?p.accent:i===2?p.secondary:p.cream,1,18),
        words(`tile-title-${i}`,heads[i]??`Part ${i+1}`,x+cell*.065,h*.615,cell*.87,h*.20,h*.053,
          i===2?p.cream:p.ink,2,{font:"body",maxLines:3,minSize:h*.034}));
    }
  }else{
    // Editorial: high-impact typography balanced by a giant question mark.
    add(rect("side-panel",w*.70,0,w*.30,h,p.accent,0),
      ellipse("question-ring",w*.715,h*.15,w*.26,h*.56,p.dark,1),
      words("question","?",w*.77,h*.18,w*.22,h*.46,h*.39,p.cream,2,{maxLines:1,minSize:h*.25}));
    add(rect("top-rule",m,h*.12,w*.08,h*.012,p.accent,2,3),
      words("eyebrow","UNDER THE SURFACE",m,h*.055,w*.45,h*.07,h*.035,p.ink,3,{font:"body",maxLines:1}),
      words("headline",title,m,h*.22,w*.61,h*.45,h*.135,p.ink,3,{maxLines:3,minSize:h*.066}),
      rect("footer-rule",m,h*.78,w*.54,h*.006,p.ink,2),
      words("first-idea",heads[0]??"",m,h*.82,w*.57,h*.10,h*.051,p.ink,3,{font:"body",maxLines:2}));
  }
  return normalizeDocument(createDocument({id:`production-cover-${variant}`,artboard:createArtboard({width:w,height:h,
    background:variant===0?p.dark:p.cream}),fonts,layers}));
}

function upright(variant:number,w:number,h:number,title:string,heads:string[],p:Palette):MediaDocument{
  const layers:Layer[]=[];
  const add=(...items:Layer[])=>layers.push(...items);
  const m=w*.075;
  if(variant===0){
    add(rect("upper-accent",m,h*.08,w*.10,h*.011,p.accent,1,5),
      words("category","THE EXPLAINER",m,h*.11,w*.80,h*.07,w*.047,p.cream,2,{font:"body",maxLines:1}),
      words("headline",title,m,h*.22,w-2*m,h*.34,w*.132,p.cream,2,{maxLines:4,minSize:w*.065}),
      ellipse("halo",w*.13,h*.64,w*.74,w*.74,p.secondary,0),
      rect("page-back",w*.38,h*.69,w*.44,h*.19,p.cream,1,16),
      rect("page-front",w*.20,h*.66,w*.44,h*.19,p.accent,2,16),
      words("first-idea",heads[0]??"",m,h*.90,w-2*m,h*.06,w*.041,p.cream,3,{font:"body",maxLines:2}));
  }else if(variant===1){
    add(rect("hero",m,h*.07,w-2*m,h*.39,p.dark,1,24),
      words("headline",title,m+w*.05,h*.14,w*.74,h*.25,w*.111,p.cream,2,{maxLines:4,minSize:w*.055}));
    for(let i=0;i<3;i++){
      const y=h*(.49+i*.151);
      add(rect(`tile-${i}`,m,y,w-2*m,h*.135,i===1?p.accent:i===2?p.secondary:p.cream,1,16),
        words(`idea-${i}`,heads[i]??`Part ${i+1}`,m+w*.045,y+h*.034,w*.73,h*.065,w*.051,
          i===2?p.cream:p.ink,2,{font:"body",maxLines:2}));
    }
  }else{
    add(rect("top-rule",m,h*.11,w*.12,h*.009,p.accent,1,4),
      words("eyebrow","UNDER THE SURFACE",m,h*.14,w*.82,h*.07,w*.042,p.ink,2,{font:"body",maxLines:1}),
      words("headline",title,m,h*.27,w-2*m,h*.34,w*.122,p.ink,2,{maxLines:4,minSize:w*.064}),
      ellipse("question-ring",w*.29,h*.69,w*.42,w*.42,p.accent,1),
      words("question","?",w*.42,h*.71,w*.28,h*.18,w*.23,p.dark,2,{maxLines:1,minSize:w*.18}));
  }
  return normalizeDocument(createDocument({id:`production-cover-${variant}`,artboard:createArtboard({width:w,height:h,
    background:variant===0?p.dark:p.cream}),fonts,layers}));
}

export function createCoverArtwork(title:string,sections:readonly PlatformScriptSection[],profile:OutputProfileId,
  colors:PlatformBrandColors|undefined,target:string,filenameBase:string):GeneratedArtwork[]{
  if(!sections.length)return [];
  const {width,height}=getOutputProfile(profile);
  const p=palette(colors),portrait=height>=width;
  const heads=sections.slice(0,3).map(section=>clipText(section.heading,45));
  const ids=["","-tiles","-editorial"] as const;
  const labels=["Story layout","Tile layout","Editorial layout"] as const;
  return ids.map((suffix,index)=>{
    const media=portrait?upright(index,width,height,clipText(title,110),heads,p):landscape(index,width,height,clipText(title,110),heads,p);
    const output=documentToSvg(media);
    if(output.diagnostics.some(d=>d.severity==="error"))return null;
    return {id:`cover-${target}${suffix}`,filename:`${filenameBase}-${target}${suffix||"-cover"}.png`,label:labels[index],
      description:"Kumiki thumbnail: editable headline, approved-script section headings, no unsourced photos or figures.",
      media,svg:output.svg,width:output.size.width,height:output.size.height,
      preview:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(output.svg)}`};
  }).filter((result):result is NonNullable<typeof result>=>result!==null);
}
