/**
 * Shared, frame-exact primitives for scene-template stages. Pure functions of
 * props: no timers, transitions or React state, so every frame can be seeked
 * and exported. Stages in this folder import from here, never from
 * scene-templates-react, so the renderer can import them without a cycle.
 */
import { createContext, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ImageAsset, SceneTemplateFrame } from "../scene-templates";
import type { AnnotationBeats, AnnotationPoint, AnnotationState, AnnotationTiming } from "../subject-annotations";

/** Runtime-only renderer slot. The persisted recipe remains pure JSON. */
export type SceneAssetRenderer = (asset:ImageAsset,frame:SceneTemplateFrame) => ReactNode;
export const AssetRendererContext=createContext<{ render:SceneAssetRenderer;frame:SceneTemplateFrame }|null>(null);
/** Host-only animated overlay, drawn with the same beat timing and subject mapping as annotations. */
export interface SceneOverlayContext {
  frame:SceneTemplateFrame; width:number; height:number; beats:AnnotationBeats;
  /** Called once per space: "subject" rides the camera and crop, "stage" is fixed to the frame. */
  space:"subject"|"stage";
  /** Normalized point → stage pixels in this space. */
  toStage:(point:AnnotationPoint)=>AnnotationPoint;
  /** Resolves timing exactly like a declarative annotation. */
  state:(timing:AnnotationTiming)=>AnnotationState;
}
export type SceneOverlayRenderer=(context:SceneOverlayContext)=>ReactNode;
export const OverlayRendererContext=createContext<SceneOverlayRenderer|undefined>(undefined);

export const clamp01=(n:number)=>Math.max(0,Math.min(1,n));
export const cinematicEase=(n:number)=>{const t=clamp01(n);return 1-Math.pow(1-t,3);};
/** Smooth start and stop, for camera moves that must not lurch. */
export const easeInOut=(n:number)=>{const t=clamp01(n);return t*t*t*(t*(t*6-15)+10);};
export const expoOut=(n:number)=>n>=1?1:1-Math.pow(2,-10*clamp01(n));
/** Linear 0..1 that ignores reduced motion; for honest visibility windows. */
export const span01=(t:number,start:number,end:number)=>clamp01((t-start)/Math.max(1,end-start));
export const motionAt=(f:SceneTemplateFrame,start:number,end:number)=>
  f.reducedMotion?1:cinematicEase((f.frame-start)/Math.max(1,end-start));
/** Reduced motion settles a beat on its frame instead of animating towards it. */
export const beatAt=(f:SceneTemplateFrame,start:number,end:number,ease:(n:number)=>number=cinematicEase)=>
  f.reducedMotion?(f.frame>=start?1:0):ease((f.frame-start)/Math.max(1,end-start));
export const cueAt=(f:SceneTemplateFrame,n:0|1|2)=>
  // Cue defaults are a quarter, halfway and three quarters, matching ST1.
  f.cueFrames?.[n] ?? [0.25,0.5,0.75][n]*f.durationFrames;

export const coverImage:CSSProperties={ width:"100%", height:"100%", objectFit:"cover", minHeight:0, borderRadius:".35em" };
export function Asset({asset, style}: {asset?:ImageAsset;style?:CSSProperties}) {
  const slot=useContext(AssetRendererContext);
  if(asset && slot) return <div role="img" aria-label={asset.alt} data-km-asset-id={asset.id}
    style={{...coverImage,...style}}>{slot.render(asset,slot.frame)}</div>;
  return asset
    ? <img data-km-asset-id={asset.id} src={asset.src} alt={asset.alt} draggable={false} style={{...coverImage,...style}} />
    : <div aria-hidden="true" style={{width:"100%",height:"100%",border:"1px dashed rgba(245,251,255,.25)",borderRadius:".4em"}} />;
}

/** Real luminance film grain; tile it and offset it per frame for drift. */
export const filmGrain=`url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1"/></filter><rect width="160" height="160" filter="url(#n)"/></svg>')}")`;
/** Vignette plus drifting grain, the shared film finish of the premium stages. */
export function FilmFinish({frame,reduced,grain=1,vignette=1,vignetteStrength=.42}:{
  frame:number;reduced:boolean;grain?:number;vignette?:number;vignetteStrength?:number}) {
  return <>
    <div aria-hidden="true" style={{position:"absolute",inset:0,pointerEvents:"none",
      background:`radial-gradient(ellipse 84% 80% at 50% 46%,transparent 48%,rgba(2,4,7,${vignette*vignetteStrength}) 100%)`}}/>
    <div aria-hidden="true" data-km-film-grain="" style={{position:"absolute",inset:0,pointerEvents:"none",
      backgroundImage:filmGrain,mixBlendMode:"overlay",opacity:.3*grain,
      backgroundPosition:reduced?"0 0":`${(frame*67)%160}px ${(frame*113)%160}px`}}/>
  </>;
}

/** Display units: space-separated words, but CJK breaks per character (it has no spaces). */
const cjk="⺀-鿿가-힯豈-﫿＀-￯";
export const displayUnits=(text:string)=>[...text.matchAll(new RegExp(`[${cjk}][、。，．！？」』）]*|[^\\s${cjk}]+`,"g"))]
  .map(m=>({word:m[0],index:m.index,spaced:/\s/.test(text[m.index+m[0].length]??"")}));
/** Estimated advance of a run in em: CJK glyphs are full width, Latin averages about .54em. */
const runWidth=(run:string)=>[...run].reduce((sum,ch)=>sum+(new RegExp(`[${cjk}]`).test(ch)?1:.54),0);
/** Caps a display size so the longest unbreakable word fits `widthCqw` of the stage.
 * `whole` treats the entire text as one unit, for short titles that must stay on one line. */
export const fitLongestWord=(text:string,em:number,widthCqw:number,whole=false)=>{
  const longest=whole?runWidth(text):Math.max(...displayUnits(text).map(unit=>runWidth(unit.word)));
  return `min(${em}em, ${(widthCqw/longest).toFixed(3)}cqw)`;
};
/** Masked word rises. Emphasis takes the accent and a marker sweep once the line settles. */
export function KineticWords({text,emphasis,start,stagger=2.5,length=15,reduced,frame,accent=false,marker="question"}:{
  text:string;emphasis?:string;start:number;stagger?:number;length?:number;reduced:boolean;frame:number;accent?:boolean;
  /** data-km-*-word attribute stem, so tests can find each stage's words. */
  marker?:string;
}) {
  const at=emphasis?text.indexOf(emphasis):-1;
  const words=displayUnits(text).map(({word,index,spaced})=>
    ({word,spaced,emphasized:accent||(at>=0&&index<at+emphasis!.length&&index+word.length>at)}));
  const settled=start+(words.length-1)*stagger+length;
  return <>{words.map(({word,spaced,emphasized},i)=>{
    const p=reduced?(frame>=start?1:0):expoOut((frame-start-i*stagger)/length);
    const sweep=reduced?1:cinematicEase((frame-settled-i*2)/12);
    return <span key={i}>
      {/* The clip window is padded so descenders survive the mask. */}
      <span style={{display:"inline-block",overflow:"hidden",verticalAlign:"bottom",whiteSpace:"nowrap",
        padding:".04em .06em .14em",margin:"-.04em -.06em -.14em"}}>
        <span {...{[`data-km-${marker}-word`]:emphasized?"emphasis":""}} style={{display:"inline-block",
          transform:`translate3d(0,${(1-p)*108}%,0) rotate(${(1-p)*4}deg)`,transformOrigin:"0 100%",
          color:emphasized?"var(--km-accent, #9fd9ce)":undefined,
          backgroundImage:emphasized&&!accent?"linear-gradient(var(--km-accent, #9fd9ce),var(--km-accent, #9fd9ce))":undefined,
          backgroundRepeat:"no-repeat",backgroundPosition:"0 100%",backgroundSize:`${sweep*100}% .07em`}}>{word}</span>
      </span>{spaced?" ":""}
    </span>;
  })}</>;
}
/** A line of secondary copy that rises and settles once; reduced motion cuts it in on its beat. */
export function RiseIn({frame,start,length=16,reduced,children,style,name}:{
  frame:number;start:number;length?:number;reduced:boolean;children:ReactNode;style?:CSSProperties;name?:string}) {
  const p=reduced?(frame>=start?1:0):cinematicEase((frame-start)/length);
  return <div data-km-rise={name} style={{...style,opacity:p,transform:`translate3d(0,${(1-p)*.5}em,0)`}}>{children}</div>;
}
/** Visually hidden but announced copy, so motion never hides the canonical text from assistive tech. */
export const srOnly:CSSProperties={position:"absolute",width:1,height:1,margin:-1,overflow:"hidden",clip:"rect(0 0 0 0)",whiteSpace:"nowrap"};
