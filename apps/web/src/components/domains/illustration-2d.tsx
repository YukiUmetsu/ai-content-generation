/** Shared, dependency-free 2D illustration toolkit for domain object packs.
 *
 * Construction rules (applied by every primitive so all domains read as one
 * family):
 * - 240×200 artboard; art lives in a protected region (y 10–160), the title in
 *   a separate measured band (y 164–198). They never overlap.
 * - One light direction (top-left): material gradients run light → base →
 *   shade, bevel rims catch light on top edges, contact shadows sit below.
 * - Keylines use one stroke scale (`STROKE`), corners one radius scale
 *   (`RADIUS`). Colors come only from semantic `IllustrationTokens`.
 * - Gradient IDs are derived from React `useId`, so many instances can share a
 *   document or exported SVG without collisions.
 */
import {
  createContext,forwardRef,useCallback,useContext,useEffect,useId,useLayoutEffect,useRef,
  useState,useSyncExternalStore,
} from "react";
import type { CSSProperties, ReactNode, SVGProps } from "react";
import { domainRevealProgress } from "./domain-object-model";
import type { DomainObjectState } from "./domain-object-model";

/* ------------------------------------------------------------------ tokens */

/** Semantic color roles. Every value must be a six-digit hex color because
 * highlight/shade planes are derived from it. */
export interface IllustrationTokens {
  /** Surface the artwork is placed on (used for glow fade and galleries). */
  canvas:string;
  /** Title text. */
  text:string;
  /** Primary neutral material (paper, light metal, walls). */
  surface:string;
  /** Secondary, darker neutral material (housings, leather, steps). */
  deep:string;
  /** Keylines and fine dark detail. */
  ink:string;
  /** Primary brand-neutral accent. */
  accent:string;
  /** Warm secondary accent (coins, seals, warnings). */
  accent2:string;
  positive:string;
  negative:string;
  /** Display glass. */
  glass:string;
  highlight:string;
  shadow:string;
}
export type IllustrationThemeName="midnight"|"paper";
export const ILLUSTRATION_THEMES:Readonly<Record<IllustrationThemeName,IllustrationTokens>>={
  midnight:{
    canvas:"#0A1A26",text:"#E4EFF6",surface:"#D3E1EA",deep:"#456379",ink:"#06121B",
    accent:"#4CCDBD",accent2:"#F1B75E",positive:"#58CF92",negative:"#EE7480",
    glass:"#0F2B3C",highlight:"#FFFFFF",shadow:"#000000",
  },
  paper:{
    canvas:"#F4F8FB",text:"#1B3042",surface:"#FFFFFF",deep:"#AFC3D3",ink:"#1C3346",
    accent:"#3468CC",accent2:"#E6A136",positive:"#1F9A68",negative:"#D44A5C",
    glass:"#1A3246",highlight:"#FFFFFF",shadow:"#0B2030",
  },
};
export type IllustrationTone="surface"|"deep"|"accent"|"accent2"|"positive"|"negative"|"glass"|"ink";
/** Any token usable as a flat color. */
export type IllustrationColorRole=IllustrationTone|"highlight"|"shadow";
const TONES:readonly IllustrationTone[]=["surface","deep","accent","accent2","positive","negative","glass","ink"];
/** Keyline weights in artboard units. */
export const STROKE={outline:2,detail:1.6,fine:1.1} as const;
/** Corner radius scale in artboard units. */
export const RADIUS={xs:2,sm:3.5,md:6,lg:10,xl:16} as const;
export const ARTBOARD={width:240,height:200,artHeight:172,
  art:{x:12,y:10,width:216,height:150},title:{y:164,height:34,maxWidth:212}} as const;
const HEX=/^#[0-9A-Fa-f]{6}$/;

export function resolveIllustrationTokens(theme:IllustrationThemeName="midnight",
  overrides?:Partial<IllustrationTokens>,accent?:string):IllustrationTokens {
  const base=ILLUSTRATION_THEMES[theme];
  if(!base)throw new Error(`Unknown illustration theme ${JSON.stringify(theme)}.`);
  const tokens={...base,...overrides,...(accent?{accent}:{})};
  for(const [role,value] of Object.entries(tokens))
    if(typeof value!=="string"||!HEX.test(value))
      throw new Error(`Illustration token "${role}" must be a six-digit hex color.`);
  return tokens;
}
/** Linear sRGB-space blend of two six-digit hex colors. */
export function mixHexColor(a:string,b:string,t:number):string {
  const pa=parseInt(a.slice(1),16),pb=parseInt(b.slice(1),16);
  const channel=(shift:number)=>{
    const x=(pa>>shift)&255,y=(pb>>shift)&255;
    return Math.round(x+(y-x)*t).toString(16).padStart(2,"0");
  };
  return "#"+channel(16)+channel(8)+channel(0);
}

/* ----------------------------------------------------------------- context */

export interface IllustrationContextValue {
  uid:string;
  tokens:IllustrationTokens;
  /** Lit material gradient for a tone. */
  paint(tone:IllustrationTone):string;
  /** Horizontal cylindrical gradient for a tone. */
  side(tone:IllustrationTone):string;
  /** Flat color: positive `level` lightens toward highlight, negative shades. */
  color(role:IllustrationColorRole,level?:number):string;
  ref(name:"rim"|"glare"|"shadow"|"glow"):string;
  /** Pose resolver for named parts (from the frame's `parts` prop). */
  pose?:(part:PartRef)=>PartPose|undefined;
}
const IllustrationContext=createContext<IllustrationContextValue|null>(null);
export function useIllustration():IllustrationContextValue {
  const value=useContext(IllustrationContext);
  if(!value)throw new Error("Illustration primitives must be rendered inside <DomainIllustration>.");
  return value;
}
function createContextValue(uid:string,tokens:IllustrationTokens,parts?:PartPoses):IllustrationContextValue {
  const color=(tone:IllustrationColorRole,level=0)=>{
    const base=tokens[tone];
    return level>=0?mixHexColor(base,tokens.highlight,level):mixHexColor(base,tokens.shadow,-level);
  };
  const pose=parts===undefined?undefined:typeof parts==="function"?parts:(part:PartRef)=>parts[part.name];
  return {uid,tokens,color,pose,
    paint:tone=>`url(#${uid}-${tone})`,
    side:tone=>`url(#${uid}-${tone}-x)`,
    ref:name=>`url(#${uid}-${name})`};
}
function IllustrationDefs({c}:{c:IllustrationContextValue}){
  const t=c.tokens;
  return <defs>
    {TONES.map(tone=><linearGradient key={tone} id={`${c.uid}-${tone}`} x1="0" y1="0" x2=".42" y2="1">
      <stop offset="0" stopColor={c.color(tone,tone==="glass"?.1:.3)}/>
      <stop offset=".52" stopColor={c.color(tone)}/>
      <stop offset="1" stopColor={c.color(tone,-.26)}/>
    </linearGradient>)}
    {TONES.map(tone=><linearGradient key={tone} id={`${c.uid}-${tone}-x`} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stopColor={c.color(tone,-.2)}/>
      <stop offset=".3" stopColor={c.color(tone,.3)}/>
      <stop offset=".62" stopColor={c.color(tone)}/>
      <stop offset="1" stopColor={c.color(tone,-.34)}/>
    </linearGradient>)}
    <linearGradient id={`${c.uid}-rim`} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor={t.highlight} stopOpacity=".7"/>
      <stop offset=".42" stopColor={t.highlight} stopOpacity="0"/>
    </linearGradient>
    <linearGradient id={`${c.uid}-glare`} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={t.highlight} stopOpacity=".2"/>
      <stop offset="1" stopColor={t.highlight} stopOpacity="0"/>
    </linearGradient>
    <radialGradient id={`${c.uid}-shadow`}>
      <stop offset="0" stopColor={t.shadow} stopOpacity=".42"/>
      <stop offset=".6" stopColor={t.shadow} stopOpacity=".16"/>
      <stop offset="1" stopColor={t.shadow} stopOpacity="0"/>
    </radialGradient>
    <radialGradient id={`${c.uid}-glow`}>
      <stop offset="0" stopColor={t.accent} stopOpacity=".16"/>
      <stop offset=".7" stopColor={t.accent} stopOpacity=".05"/>
      <stop offset="1" stopColor={t.canvas} stopOpacity="0"/>
    </radialGradient>
  </defs>;
}

/* ------------------------------------------------------------------ parts */

/**
 * Shared vocabulary of animatable part names. Every domain pack tags its
 * moving pieces with these names, so one motion (spin every `gear`, blink
 * every `light`, flip every `card`) works across finance, business and
 * technology objects alike. Repeated pieces carry a 0-based `index`.
 */
export const DOMAIN_PART_NAMES=[
  // Automatic: tagged by the shared primitives themselves.
  "shadow","coin","coin-stack","screen","badge","arrow","keys","person","sparkle",
  // Structure and enclosures.
  "body","base","roof","door","window","lid","flap","drawer","slot","awning","sign","header","stand",
  "tower","house","chimney","table","board","tile","card","chip","unit","plug","cable","clip","handle","clasp",
  // Mechanisms and moving hardware.
  "dial","wheel","gear","roller","needle","hand","arm","platter","shackle","antenna","pointer","pen",
  // Signals, lights and flow.
  "light","signal","wave","rays","smoke","trail","route","connector","links","cursor","bell",
  // Paper, money and marks.
  "sheet","note","stack","band","ingot","bag","tie","ribbon","seal","stamp","signature","check",
  "total","rows","barcode","label","paper","cash","key","keyhole","shield",
  // Data and charts.
  "line","bar","pie","gauge","candles","volume","icons","node","commit","branch","die","pins",
  // Places, people and creatures.
  "flag","pin","globe","target","dart","path","step","calendar","day","clock","bulb","filament",
  "truck","box","cube","cloud","leaf","head","horn","ear","tail","leg","sleeve","hands","link",
  "endpoint","bubble",
] as const;
export type DomainPartName=typeof DOMAIN_PART_NAMES[number];
/** Artboard point a part rotates and scales about (drawing coordinates). */
export type PartPivot=readonly [number,number];
/** Identity of one rendered part, passed to a `parts` resolver. */
export interface PartRef { name:DomainPartName; index:number; pivot:PartPivot }
/**
 * Pose for a part, applied as an SVG transform about its pivot (so it is
 * deterministic, frame-addressable and survives static SVG export).
 * `className`/`style` let CSS keyframes drive the same group instead; the
 * pivot is already set as its `transform-origin`.
 */
export interface PartPose {
  /** Degrees, clockwise, about the pivot. */
  rotate?:number;
  /** Uniform or `[x, y]` scale about the pivot. */
  scale?:number|readonly [number,number];
  /** Artboard-unit offset applied after rotate/scale. */
  translate?:readonly [number,number];
  opacity?:number;
  className?:string;
  style?:CSSProperties;
}
/** Poses by part name (applies to every instance), or a resolver per instance. */
export type PartPoses=Partial<Record<DomainPartName,PartPose>>|((part:PartRef)=>PartPose|undefined);
/** Centre of the art region; the default pivot for whole-object parts. */
export const ART_CENTER:PartPivot=[120,88];

function partTransform(pose:PartPose|undefined,[px,py]:PartPivot):string|undefined {
  if(!pose)return undefined;
  const steps:string[]=[];
  if(pose.translate)steps.push(`translate(${round(pose.translate[0])} ${round(pose.translate[1])})`);
  const scale=pose.scale===undefined?undefined:typeof pose.scale==="number"?[pose.scale,pose.scale]:pose.scale;
  if(pose.rotate||scale){
    steps.push(`translate(${px} ${py})`);
    if(pose.rotate)steps.push(`rotate(${round(pose.rotate)})`);
    if(scale)steps.push(`scale(${round(scale[0])} ${round(scale[1])})`);
    steps.push(`translate(${-px} ${-py})`);
  }
  return steps.length?steps.join(" "):undefined;
}

/**
 * A named, animatable piece of an illustration. Renders a group tagged with
 * `data-km-part`, `data-km-part-index` and `data-km-pivot`, whose CSS
 * `transform-origin` is the pivot (so CSS or JS animation libraries rotate it
 * about the right point), and applies any pose from the frame's `parts` prop.
 * Parts nest: a `lid` can carry its own `screen`.
 */
export function Part({name,pivot=ART_CENTER,index=0,children}:{
  name:DomainPartName;pivot?:PartPivot;index?:number;children:ReactNode;
}){
  const c=useIllustration();
  const ref:PartRef={name,index,pivot};
  const pose=c.pose?.(ref);
  const [px,py]=pivot;
  const transform=partTransform(pose,pivot);
  // Browsers also apply CSS `transform-origin` to the SVG `transform`
  // attribute. A posed part already bakes its pivot into that attribute (so it
  // exports correctly without CSS), so its origin must be the user-space
  // origin; an unposed part exposes the pivot for CSS/JS animation instead.
  const origin=transform?"0px 0px":`${round(px)}px ${round(py)}px`;
  return <g data-km-part={name} data-km-part-index={index} data-km-pivot={`${round(px)} ${round(py)}`}
    transform={transform} opacity={pose?.opacity} className={pose?.className}
    style={{transformBox:"view-box",transformOrigin:origin,...pose?.style}}>
    {children}
  </g>;
}
/** Optional auto-part props carried by the shared primitives. */
export interface AutoPartProps {
  /** Rename this primitive's part, or `false` to leave it untagged. */
  part?:DomainPartName|false;
  partIndex?:number;
}
function autoPart(name:DomainPartName,{part,partIndex}:AutoPartProps,pivot:PartPivot,node:ReactNode){
  if(part===false)return node;
  return <Part name={part??name} index={partIndex} pivot={pivot}>{node}</Part>;
}

/** Everything a rendered illustration exposes for animation, read from the DOM. */
export interface IllustrationPartInfo { name:string; index:number; pivot:PartPivot; element:SVGGElement }
/** Lists the named parts inside an illustration (e.g. from a `ref`), in paint order. */
export function listIllustrationParts(root:Element):IllustrationPartInfo[] {
  return Array.from(root.querySelectorAll<SVGGElement>("g[data-km-part]")).map(element=>{
    const [x,y]=(element.dataset.kmPivot??"0 0").split(" ").map(Number);
    return {name:element.dataset.kmPart??"",index:Number(element.dataset.kmPartIndex??0),pivot:[x,y],element};
  });
}

/* -------------------------------------------------------------- primitives */

type Common={tone?:IllustrationTone;keyline?:boolean;weight?:number};
type RectLike=Omit<SVGProps<SVGRectElement>,"x"|"y"|"width"|"height">;

/** Lit rounded plate with keyline and a bevel rim along the top edge. */
export function Box({x,y,w,h,r=RADIUS.md,tone="surface",keyline=true,rim=true,
  cylinder=false,weight=STROKE.outline,...rest}:Common&RectLike&{
  x:number;y:number;w:number;h:number;r?:number;rim?:boolean;cylinder?:boolean;
}){
  const c=useIllustration();
  const inset=Math.min(1.7,w/4,h/4);
  return <g>
    <rect {...rest} x={x} y={y} width={w} height={h} rx={r}
      fill={cylinder?c.side(tone):c.paint(tone)}
      stroke={keyline?c.tokens.ink:"none"} strokeWidth={weight}/>
    {rim&&w>8&&h>8?<rect x={x+inset} y={y+inset} width={w-inset*2} height={h-inset*2}
      rx={Math.max(0,r-inset)} fill="none" stroke={c.ref("rim")} strokeWidth={1.2}/>:null}
  </g>;
}
/** Arbitrary lit shape. */
export function Shape({d,tone="surface",keyline=true,weight=STROKE.outline,cylinder=false,
  fill,...rest}:Common&Omit<SVGProps<SVGPathElement>,"d">&{d:string;cylinder?:boolean}){
  const c=useIllustration();
  return <path {...rest} d={d} fill={fill??(cylinder?c.side(tone):c.paint(tone))}
    stroke={keyline?c.tokens.ink:"none"} strokeWidth={weight} strokeLinejoin="round"/>;
}
/** Lit circle or ellipse with an optional top rim. */
export function Orb({cx,cy,r,ry,tone="surface",keyline=true,rim=true,weight=STROKE.outline,
  cylinder=false}:Common&{cx:number;cy:number;r:number;ry?:number;rim?:boolean;cylinder?:boolean}){
  const c=useIllustration();
  const ryy=ry??r;
  return <g>
    <ellipse cx={cx} cy={cy} rx={r} ry={ryy} fill={cylinder?c.side(tone):c.paint(tone)}
      stroke={keyline?c.tokens.ink:"none"} strokeWidth={weight}/>
    {rim&&r>6?<ellipse cx={cx} cy={cy} rx={r-1.7} ry={ryy-1.7} fill="none"
      stroke={c.ref("rim")} strokeWidth={1.2}/>:null}
  </g>;
}
/** Soft contact shadow; place under the object's footprint. */
export function Shadow({cx,cy,rx,ry,...auto}:{cx:number;cy:number;rx:number;ry?:number}&AutoPartProps){
  const c=useIllustration();
  return autoPart("shadow",auto,[cx,cy],
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry??Math.max(4,rx*.12)} fill={c.ref("shadow")}/>);
}
/** Open stroke in a tone (detail lines, arrows, scribbles). */
export function Stroke({d,tone="ink",level=0,w=STROKE.detail,opacity,cap="round",...rest}:
  Omit<SVGProps<SVGPathElement>,"d">&{d:string;tone?:IllustrationColorRole;level?:number;w?:number;
  cap?:"round"|"butt"|"square"}){
  const c=useIllustration();
  return <path {...rest} d={d} fill="none" stroke={c.color(tone,level)} strokeWidth={w}
    strokeLinecap={cap} strokeLinejoin="round" opacity={opacity}/>;
}
/** Placeholder text rows: rounded bars, never readable fake data. */
export function TextRows({x,y,widths,gap=9,h=3.6,tone="ink",level=0,opacity=.42,align="start"}:{
  x:number;y:number;widths:readonly number[];gap?:number;h?:number;tone?:IllustrationColorRole;
  level?:number;opacity?:number;align?:"start"|"end";
}){
  const c=useIllustration();
  return <g opacity={opacity}>{widths.map((w,i)=><rect key={i} x={align==="end"?x-w:x}
    y={y+i*gap} width={w} height={h} rx={h/2} fill={c.color(tone,level)}/>)}</g>;
}
/** Paper sheet with a folded corner and a lit left edge. */
export function Sheet({x,y,w,h,fold=16,tone="surface",r=RADIUS.sm}:{
  x:number;y:number;w:number;h:number;fold?:number;tone?:IllustrationTone;r?:number;
}){
  const c=useIllustration();
  const body=`M ${x+r} ${y} H ${x+w-fold} L ${x+w} ${y+fold} V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} `+
    `H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z`;
  return <g>
    <path d={body} fill={c.paint(tone)} stroke={c.tokens.ink} strokeWidth={STROKE.outline} strokeLinejoin="round"/>
    <path d={`M ${x+1.8} ${y+r+2} V ${y+h-r-2}`} stroke={c.tokens.highlight} strokeOpacity={.55} strokeWidth={1.2} strokeLinecap="round"/>
    <path d={`M ${x+w-fold} ${y} V ${y+fold-r} Q ${x+w-fold} ${y+fold} ${x+w-fold+r} ${y+fold} H ${x+w} Z`}
      fill={c.color(tone,-.16)} stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
  </g>;
}
/** Display glass with diagonal glare drawn above its content. */
export function Screen({x,y,w,h,r=RADIUS.sm,children,glare=true,...auto}:{
  x:number;y:number;w:number;h:number;r?:number;children?:ReactNode;glare?:boolean;
}&AutoPartProps){
  const c=useIllustration();
  const g1=x+w*.5,g2=x+w*.78;
  return autoPart("screen",auto,[x+w/2,y+h/2],<g>
    <rect x={x} y={y} width={w} height={h} rx={r} fill={c.paint("glass")}
      stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    {children}
    {glare?<path d={`M ${g1} ${y+1.5} H ${g2} L ${g2-w*.36} ${y+h-1.5} H ${g1-w*.36} Z`}
      fill={c.ref("glare")} pointerEvents="none"/>:null}
  </g>);
}
/** Front-facing coin with thickness, rim ring, catch-light and symbol. */
export function Coin({cx,cy,r,depth,tone="accent2",symbol,...auto}:{
  cx:number;cy:number;r:number;depth?:number;tone?:IllustrationTone;symbol?:string;
}&AutoPartProps){
  const c=useIllustration();
  const d=depth??Math.max(2.5,r*.16);
  return autoPart("coin",auto,[cx,cy],<g>
    <circle cx={cx} cy={cy+d} r={r} fill={c.color(tone,-.36)} stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    <circle cx={cx} cy={cy} r={r} fill={c.paint(tone)} stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    <circle cx={cx} cy={cy} r={r*.76} fill="none" stroke={c.color(tone,-.24)} strokeWidth={Math.max(1.1,r*.06)}/>
    <path d={arc(cx,cy,r*.88,200,290)} fill="none" stroke={c.tokens.highlight} strokeOpacity={.75}
      strokeWidth={Math.max(1.2,r*.07)} strokeLinecap="round"/>
    {symbol?<Glyph x={cx} y={cy} size={r*1.05} fill={c.color(tone,-.5)}>{symbol}</Glyph>:null}
  </g>);
}
/** Stack of coins seen in three-quarter view, drawn bottom-up. */
export function CoinStack({cx,base,count,w=34,tone="accent2",...auto}:{
  cx:number;base:number;count:number;w?:number;tone?:IllustrationTone;
}&AutoPartProps){
  const c=useIllustration();
  const ry=w*.2,step=w*.2;
  return autoPart("coin-stack",auto,[cx,base],<g>{Array.from({length:count},(_,i)=>{
    const y=base-i*step;
    return <g key={i}>
      <path d={`M ${cx-w/2} ${y-step} V ${y} A ${w/2} ${ry} 0 0 0 ${cx+w/2} ${y} V ${y-step}`}
        fill={c.side(tone)} stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
      <ellipse cx={cx} cy={y-step} rx={w/2} ry={ry} fill={c.paint(tone)} stroke={c.tokens.ink} strokeWidth={STROKE.detail}/>
      {i===count-1?<ellipse cx={cx} cy={y-step} rx={w*.32} ry={ry*.6} fill="none"
        stroke={c.color(tone,-.25)} strokeWidth={1.1}/>:null}
    </g>;
  })}</g>);
}
/** Vertical cylinder (database drums, rollers, columns). */
export function Cylinder({cx,y,w,h,ry,tone="surface",bands=0}:{
  cx:number;y:number;w:number;h:number;ry?:number;tone?:IllustrationTone;bands?:number;
}){
  const c=useIllustration();
  const e=ry??w*.18,l=cx-w/2,rr=cx+w/2;
  return <g>
    <path d={`M ${l} ${y} V ${y+h} A ${w/2} ${e} 0 0 0 ${rr} ${y+h} V ${y}`} fill={c.side(tone)}
      stroke={c.tokens.ink} strokeWidth={STROKE.outline} strokeLinejoin="round"/>
    {Array.from({length:bands},(_,i)=>{
      const by=y+h*(i+1)/(bands+1);
      return <path key={i} d={`M ${l} ${by} A ${w/2} ${e} 0 0 0 ${rr} ${by}`} fill="none"
        stroke={c.tokens.ink} strokeWidth={STROKE.detail}/>;
    })}
    <ellipse cx={cx} cy={y} rx={w/2} ry={e} fill={c.paint(tone)} stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    <ellipse cx={cx} cy={y} rx={w/2-2} ry={Math.max(0,e-1.6)} fill="none" stroke={c.ref("rim")} strokeWidth={1.2}/>
  </g>;
}
/** Single centered glyph (currency symbol, digit, mark). */
export function Glyph({x,y,size,fill,weight=800,children}:{
  x:number;y:number;size:number;fill:string;weight?:number;children:ReactNode;
}){
  return <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={size}
    fontWeight={weight} fill={fill} fontFamily="Geist, Inter, system-ui, sans-serif"
    style={{fontVariantNumeric:"tabular-nums"}}>{children}</text>;
}
/** Grid of key caps. `accent` lists indices drawn in the accent tone. */
export function Keys({x,y,cols,rows,kw,kh,gap=4,tone="surface",accent=[],accentTone="accent",...auto}:{
  x:number;y:number;cols:number;rows:number;kw:number;kh:number;gap?:number;
  tone?:IllustrationTone;accent?:readonly number[];accentTone?:IllustrationTone;
}&AutoPartProps){
  const c=useIllustration();
  const pivot:PartPivot=[x+(cols*(kw+gap)-gap)/2,y+(rows*(kh+gap)-gap)/2];
  return autoPart("keys",auto,pivot,<g>{Array.from({length:cols*rows},(_,i)=>{
    const kx=x+(i%cols)*(kw+gap),ky=y+Math.floor(i/cols)*(kh+gap);
    const tn=accent.includes(i)?accentTone:tone;
    return <g key={i}>
      <rect x={kx} y={ky+1.2} width={kw} height={kh} rx={RADIUS.xs} fill={c.color(tn,-.4)}/>
      <rect x={kx} y={ky} width={kw} height={kh} rx={RADIUS.xs} fill={c.paint(tn)}
        stroke={c.tokens.ink} strokeWidth={STROKE.fine}/>
    </g>;
  })}</g>);
}
/** Round status badge with an icon, used for kind-specific meaning. */
export function Badge({cx,cy,r=13,tone="accent",icon,...auto}:{
  cx:number;cy:number;r?:number;tone?:IllustrationTone;icon:IconName;
}&AutoPartProps){
  const c=useIllustration();
  return autoPart("badge",auto,[cx,cy],<g>
    <circle cx={cx+1} cy={cy+2} r={r} fill={c.tokens.shadow} opacity={.18}/>
    <Orb cx={cx} cy={cy} r={r} tone={tone}/>
    <Icon name={icon} cx={cx} cy={cy} size={r*.62} color={c.tokens.highlight} weight={Math.max(1.8,r*.17)}/>
  </g>);
}
/** Head-and-shoulders figure (team members, identities, partners). */
export function Person({cx,y,s=1,tone="accent",...auto}:{cx:number;y:number;s?:number;tone?:IllustrationTone}&AutoPartProps){
  const shoulders=`M ${cx-22*s} ${y+52*s} V ${y+44*s} Q ${cx-22*s} ${y+28*s} ${cx} ${y+28*s} `+
    `Q ${cx+22*s} ${y+28*s} ${cx+22*s} ${y+44*s} V ${y+52*s} Z`;
  // Pivot at the base of the shoulders: nods, bobs and greetings read naturally.
  return autoPart("person",auto,[cx,y+52*s],<g>
    <Shape d={shoulders} tone={tone}/>
    <Part name="head" pivot={[cx,y+26*s]}><Orb cx={cx} cy={y+13*s} r={12*s} tone="surface"/></Part>
  </g>);
}
/** Keylined connector pipe that stays visible on light and dark canvases. */
export function Pipe({d,tone="deep",w=3.4,level=.15}:{d:string;tone?:IllustrationColorRole;w?:number;level?:number}){
  const c=useIllustration();
  return <g fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} stroke={c.tokens.ink} strokeWidth={w+3}/>
    <path d={d} stroke={c.color(tone,level)} strokeWidth={w}/>
  </g>;
}
/** Isometric cube (top, left and right faces lit from the top-left). */
export function IsoCube({cx,cy,s,tone="accent",ribs=0}:{cx:number;cy:number;s:number;tone?:IllustrationTone;ribs?:number}){
  const c=useIllustration();
  const h=s*1.05;
  const face=(d:string,fill:string)=><path d={d} fill={fill} stroke={c.tokens.ink}
    strokeWidth={STROKE.outline} strokeLinejoin="round"/>;
  return <g>
    {face(`M ${cx-s} ${cy} L ${cx} ${cy+s/2} V ${cy+s/2+h} L ${cx-s} ${cy+h} Z`,c.paint(tone))}
    {face(`M ${cx} ${cy+s/2} L ${cx+s} ${cy} V ${cy+h} L ${cx} ${cy+s/2+h} Z`,c.color(tone,-.24))}
    {face(`M ${cx} ${cy-s/2} L ${cx+s} ${cy} L ${cx} ${cy+s/2} L ${cx-s} ${cy} Z`,c.color(tone,.22))}
    {Array.from({length:ribs},(_,i)=>{
      const t=(i+1)/(ribs+1);
      return <g key={i} stroke={c.tokens.ink} strokeOpacity={.28} strokeWidth={1.2}>
        <path d={`M ${cx-s+s*t} ${cy+s/2*t+3} V ${cy+s/2*t+h-3}`}/>
        <path d={`M ${cx+s*t} ${cy+s/2-s/2*t+3} V ${cy+s/2-s/2*t+h-3}`}/>
      </g>;
    })}
  </g>;
}
/** Smooth signature-like scribble inside a box. */
export function Scribble({x,y,w,tone="accent"}:{x:number;y:number;w:number;tone?:IllustrationTone}){
  const s=w/40;
  return <Stroke tone={tone} w={STROKE.detail+.4} d={`M ${x} ${y} q ${6*s} ${-12*s} ${10*s} ${-2*s} `+
    `t ${8*s} ${-2*s} ${8*s} ${2*s} ${8*s} ${-4*s} ${14*s} ${2*s}`}/>;
}


/* -------------------------------------------------------------- assemblies */

/** Thick keylined arrow: `d` is the shaft, `head` a closed arrowhead path. */
export function Arrow({d,head,tone="accent",w=6,pivot,...auto}:{d:string;head:string;tone?:IllustrationTone;w?:number;
  /** Pivot for rotate/scale poses; defaults to the arrowhead's first point. */
  pivot?:PartPivot}&AutoPartProps){
  const c=useIllustration();
  const headStart=head.match(/-?\d+(?:\.\d+)?/g)?.slice(0,2).map(Number);
  return autoPart("arrow",auto,pivot??(headStart?.length===2?[headStart[0],headStart[1]]:ART_CENTER),<g>
    <path d={d} fill="none" stroke={c.tokens.ink} strokeWidth={w+3.4} strokeLinecap="round" strokeLinejoin="round"/>
    <path d={d} fill="none" stroke={c.color(tone)} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"/>
    <path d={head} fill={c.paint(tone)} stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
  </g>);
}
/** Desktop monitor with stand; children draw on its glass. */
export function Monitor({x,y,w,h,children}:{x:number;y:number;w:number;h:number;children?:ReactNode}){
  const cx=x+w/2;
  return <g>
    <Box x={cx-9} y={y+h-2} w={18} h={16} r={1.5} tone="deep" cylinder rim={false}/>
    <Box x={cx-32} y={y+h+12} w={64} h={7} r={RADIUS.sm} tone="deep"/>
    <Box x={x} y={y} w={w} h={h} r={RADIUS.md} tone="deep"/>
    <Screen x={x+6} y={y+6} w={w-12} h={h-14} r={RADIUS.xs}>{children}</Screen>
  </g>;
}
/** Wall calendar with binder rings; children draw into its 5×3 day grid. */
export function CalendarBase({x=48,y=30,w=144,h=116,children}:{x?:number;y?:number;w?:number;h?:number;children?:ReactNode}){
  const c=useIllustration();
  return <g>
    <Shadow cx={x+w/2} cy={y+h+4} rx={w*.56}/>
    <Part name="calendar" pivot={[x+w/2,y]}>
    <Box x={x} y={y} w={w} h={h} r={RADIUS.lg}/>
    <path d={`M ${x+10} ${y} H ${x+w-10} Q ${x+w} ${y} ${x+w} ${y+10} V ${y+26} H ${x} V ${y+10} Q ${x} ${y} ${x+10} ${y} Z`}
      fill={c.paint("accent")} stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    {[x+w*.3,x+w*.7].map(rx=><Box key={rx} x={rx-4} y={y-8} w={8} h={17} r={4} tone="deep"/>)}
    {children}
    </Part>
  </g>;
}
export const CALENDAR_CELLS=Array.from({length:15},(_,i)=>({col:i%5,row:Math.floor(i/5)}));
/** Rectangle of day cell `i` (0–14) for a default-placed CalendarBase. */
export function calendarCell(i:number,x=48,y=30,w=144){
  const {col,row}=CALENDAR_CELLS[i];
  const cw=(w-24)/5;
  return {x:x+12+col*cw,y:y+36+row*24,w:cw-5,h:19};
}

/* ------------------------------------------------------------------- icons */

type IconPart={d:string;fill?:boolean};
const circle=(x:number,y:number,r:number)=>`M ${x-r} ${y} a ${r} ${r} 0 1 0 ${r*2} 0 a ${r} ${r} 0 1 0 ${-r*2} 0`;
/** Unit icons drawn in [-1, 1] and stroked with a non-scaling stroke. */
export const ICONS={
  check:[{d:"M -0.55 0.02 L -0.15 0.42 L 0.6 -0.4"}],
  plus:[{d:"M -0.55 0 H 0.55 M 0 -0.55 V 0.55"}],
  minus:[{d:"M -0.55 0 H 0.55"}],
  up:[{d:"M 0 0.6 V -0.55 M -0.45 -0.1 L 0 -0.58 L 0.45 -0.1"}],
  down:[{d:"M 0 -0.6 V 0.55 M -0.45 0.1 L 0 0.58 L 0.45 0.1"}],
  "trend-up":[{d:"M -0.7 0.45 L -0.2 -0.05 L 0.1 0.25 L 0.65 -0.35 M 0.22 -0.38 H 0.66 V 0.06"}],
  "trend-down":[{d:"M -0.7 -0.45 L -0.2 0.05 L 0.1 -0.25 L 0.65 0.35 M 0.22 0.38 H 0.66 V -0.06"}],
  percent:[{d:"M 0.52 -0.66 L -0.52 0.66"},{d:circle(-0.4,-0.4,0.2),fill:true},{d:circle(0.4,0.4,0.2),fill:true}],
  clock:[{d:circle(0,0,0.68)},{d:"M 0 -0.38 V 0 L 0.3 0.2"}],
  alert:[{d:"M 0 -0.6 V 0.15"},{d:circle(0,0.52,0.06),fill:true}],
  sync:[{d:"M 0.62 -0.1 A 0.62 0.62 0 0 0 -0.5 -0.36 M -0.62 0.1 A 0.62 0.62 0 0 0 0.5 0.36"},
    {d:"M -0.62 -0.62 L -0.5 -0.32 L -0.2 -0.44 M 0.62 0.62 L 0.5 0.32 L 0.2 0.44"}],
  lock:[{d:"M -0.5 -0.08 H 0.5 V 0.62 H -0.5 Z"},{d:"M -0.3 -0.08 V -0.32 A 0.3 0.3 0 0 1 0.3 -0.32 V -0.08"}],
  bank:[{d:"M -0.68 -0.22 L 0 -0.64 L 0.68 -0.22 Z"},{d:"M -0.46 -0.04 V 0.38 M -0.15 -0.04 V 0.38 M 0.15 -0.04 V 0.38 M 0.46 -0.04 V 0.38 M -0.7 0.6 H 0.7"}],
  user:[{d:circle(0,-0.3,0.28)},{d:"M -0.6 0.66 Q -0.6 0.08 0 0.08 Q 0.6 0.08 0.6 0.66"}],
  star:[{d:"M 0 -0.66 L 0.19 -0.22 L 0.66 -0.2 L 0.3 0.1 L 0.42 0.58 L 0 0.32 L -0.42 0.58 L -0.3 0.1 L -0.66 -0.2 L -0.19 -0.22 Z"}],
  contactless:[{d:"M -0.4 -0.3 Q -0.22 0 -0.4 0.3 M -0.06 -0.52 Q 0.24 0 -0.06 0.52 M 0.28 -0.72 Q 0.7 0 0.28 0.72"}],
  briefcase:[{d:"M -0.66 -0.3 H 0.66 V 0.56 H -0.66 Z"},{d:"M -0.24 -0.3 V -0.55 H 0.24 V -0.3 M -0.66 0.06 H 0.66"}],
  bag:[{d:"M -0.55 -0.22 H 0.55 L 0.62 0.62 H -0.62 Z"},{d:"M -0.25 -0.22 V -0.38 A 0.25 0.25 0 0 1 0.25 -0.38 V -0.22"}],
  link:[{d:"M -0.1 0.38 L -0.32 0.6 A 0.3 0.3 0 0 1 -0.74 0.18 L -0.44 -0.12 A 0.3 0.3 0 0 1 -0.04 -0.12"},
    {d:"M 0.1 -0.38 L 0.32 -0.6 A 0.3 0.3 0 0 1 0.74 -0.18 L 0.44 0.12 A 0.3 0.3 0 0 1 0.04 0.12"}],
  heart:[{d:"M 0 0.6 L -0.55 0.05 A 0.3 0.3 0 0 1 0 -0.42 A 0.3 0.3 0 0 1 0.55 0.05 Z"}],
  flag:[{d:"M -0.45 0.66 V -0.62"},{d:"M -0.45 -0.6 H 0.55 L 0.3 -0.3 L 0.55 0 H -0.45"}],
  bolt:[{d:"M 0.12 -0.7 L -0.42 0.08 H 0.02 L -0.12 0.7 L 0.42 -0.08 H -0.02 Z"}],
  shield:[{d:"M 0 -0.66 L 0.56 -0.42 V 0.02 Q 0.52 0.42 0 0.68 Q -0.52 0.42 -0.56 0.02 V -0.42 Z"}],
  key:[{d:circle(-0.34,0,0.3)},{d:"M -0.04 0 H 0.68 M 0.42 0 V 0.3 M 0.62 0 V 0.24"}],
  code:[{d:"M -0.3 -0.42 L -0.7 0 L -0.3 0.42 M 0.3 -0.42 L 0.7 0 L 0.3 0.42"}],
  play:[{d:"M -0.32 -0.5 L 0.5 0 L -0.32 0.5 Z"}],
  x:[{d:"M -0.45 -0.45 L 0.45 0.45 M 0.45 -0.45 L -0.45 0.45"}],
} satisfies Record<string,readonly IconPart[]>;
export type IconName=keyof typeof ICONS;
export function Icon({name,cx,cy,size,color,weight=STROKE.detail}:{
  name:IconName;cx:number;cy:number;size:number;color:string;weight?:number;
}){
  const parts:readonly IconPart[]=ICONS[name];
  if(!parts)throw new Error(`Unknown illustration icon ${JSON.stringify(name)}.`);
  return <g transform={`translate(${cx} ${cy}) scale(${size})`}>
    {parts.map((part,i)=><path key={i} d={part.d} fill={part.fill?color:"none"} stroke={color}
      strokeWidth={weight} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>)}
  </g>;
}
/** SVG arc path along a circle between two angles (degrees, 0 = east, clockwise). */
export function arc(cx:number,cy:number,r:number,from:number,to:number):string {
  const p=(deg:number)=>{const a=deg*Math.PI/180;return [cx+r*Math.cos(a),cy+r*Math.sin(a)];};
  const [x1,y1]=p(from),[x2,y2]=p(to);
  const large=Math.abs(to-from)>180?1:0;
  return `M ${round(x1)} ${round(y1)} A ${r} ${r} 0 ${large} 1 ${round(x2)} ${round(y2)}`;
}
const round=(v:number)=>Math.round(v*100)/100;

/* ------------------------------------------------------- reduced motion */

const MOTION_QUERY="(prefers-reduced-motion: reduce)";
function subscribeMotion(callback:()=>void){
  if(typeof window==="undefined"||typeof window.matchMedia!=="function")return ()=>{};
  const query=window.matchMedia(MOTION_QUERY);
  query.addEventListener?.("change",callback);
  return ()=>query.removeEventListener?.("change",callback);
}
const motionSnapshot=()=>typeof window!=="undefined"&&typeof window.matchMedia==="function"&&
  window.matchMedia(MOTION_QUERY).matches;
/** Live `prefers-reduced-motion` value; `false` during server rendering. */
export function usePrefersReducedMotion():boolean {
  return useSyncExternalStore(subscribeMotion,motionSnapshot,()=>false);
}
const useIsomorphicLayoutEffect=typeof window!=="undefined"?useLayoutEffect:useEffect;

/* ------------------------------------------------------------------ title */

const TITLE_STEPS:readonly FitTextStep[]=[{lines:1,size:14},{lines:2,size:13},{lines:2,size:12},{lines:2,size:11}];
/** Split at the word (or, for CJK, character) boundary that best balances. */
export function balanceTitle(title:string):[string,string] {
  const words=title.trim().split(/\s+/);
  if(words.length>1){
    let best:[string,string]=[title,""],score=Infinity;
    for(let i=1;i<words.length;i++){
      const a=words.slice(0,i).join(" "),b=words.slice(i).join(" ");
      const s=Math.max(a.length,b.length);
      if(s<score){score=s;best=[a,b];}
    }
    return best;
  }
  // A single Latin word is never broken mid-word.
  if(!CJK.test(title))return [title.trim(),""];
  const chars=Array.from(title.trim());
  let best=Math.ceil(chars.length/2),score=Infinity;
  for(let i=1;i<chars.length;i++){
    const s=Math.abs(i-chars.length/2)+cjkBreakPenalty(chars[i-1],chars[i]);
    if(s<score){score=s;best=i;}
  }
  return [chars.slice(0,best).join(""),chars.slice(best).join("")];
}
const KATAKANA=/[ァ-ヺー]/,KANJI=/[一-鿿々]/,HIRAGANA=/[ぁ-ゖ]/;
const CJK=/[぀-ヿ㐀-鿿가-힯豈-﫿]/;
/** Japanese-aware break cost between two characters: never start a line with
 * closing punctuation or small kana, avoid splitting katakana words and
 * kanji+okurigana, prefer breaking after particles and punctuation. */
function cjkBreakPenalty(before:string,after:string):number {
  if(/[、。，．・ー）」』】ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ]/.test(after))return 20;
  let penalty=0;
  if(KATAKANA.test(before)&&KATAKANA.test(after))penalty+=4;
  if(KANJI.test(before)&&HIRAGANA.test(after))penalty+=2.5;
  if(KANJI.test(before)&&KANJI.test(after))penalty+=1;
  if(/[のをにはがとでへもや、。]/.test(before))penalty-=2;
  return penalty;
}
export interface FitTextStep { readonly lines:1|2|3; readonly size:number }
/** Break text into `count` lines at word boundaries (or evenly between CJK
 * characters) choosing the break set with the shortest longest line. Only
 * chooses break positions; the rendered width is still measured. */
export function splitTextLines(text:string,count:1|2|3):string[] {
  const clean=text.trim();
  if(count===1)return [clean];
  if(count===2)return balanceTitle(clean).filter(Boolean);
  const words=clean.split(/\s+/);
  if(words.length>=3){
    let best=[clean],score=Infinity;
    for(let i=1;i<words.length-1;i++)for(let j=i+1;j<words.length;j++){
      const lines=[words.slice(0,i),words.slice(i,j),words.slice(j)].map(w=>w.join(" "));
      const s=Math.max(...lines.map(l=>l.length));
      if(s<score){score=s;best=lines;}
    }
    return best;
  }
  if(words.length===2)return words;
  if(!CJK.test(clean))return [clean];
  const chars=Array.from(clean);
  if(chars.length<3)return [clean];
  let best:[number,number]=[1,2],cost=Infinity;
  for(let i=1;i<chars.length-1;i++)for(let j=i+1;j<chars.length;j++){
    const s=Math.max(i,j-i,chars.length-j)+
      cjkBreakPenalty(chars[i-1],chars[i])+cjkBreakPenalty(chars[j-1],chars[j]);
    if(s<cost){cost=s;best=[i,j];}
  }
  return [chars.slice(0,best[0]),chars.slice(best[0],best[1]),chars.slice(best[1])].map(c=>c.join(""));
}
export const TEXT_FONT_STACK="Geist, Inter, system-ui, 'Hiragino Sans', 'Noto Sans JP', 'Noto Sans CJK JP', sans-serif";
export interface FitTextProps extends Omit<SVGProps<SVGTextElement>,"x"|"y"|"children"|"ref"> {
  text:string;
  x:number;
  /** Top of the reserved band. */
  y:number;
  /** Measured width budget in the SVG's user units. */
  maxWidth:number;
  /** Fallback ladder tried in order until the rendered text fits. */
  steps?:readonly FitTextStep[];
  /** Band height used when `valign` is "center". */
  bandHeight?:number;
  valign?:"top"|"center";
  lineGap?:number;
  /** Shared group floor (see `useFitTextGroup`): never use an earlier step. */
  minStep?:number;
  /** Reports the step this text needs, so a group can align sizes. */
  onStepChange?:(step:number)=>void;
}
/** Keeps a set of `FitText` labels on one shared ladder step, so sibling
 * labels (chart categories, values) render at one consistent size. The
 * group resets when `key` changes (e.g. new data or canvas size). */
export function useFitTextGroup(key:string):{minStep:number;onStepChange:(step:number)=>void} {
  const [state,setState]=useState({key,step:0});
  const minStep=state.key===key?state.step:0;
  const onStepChange=useCallback((step:number)=>setState(prev=>{
    const base=prev.key===key?prev.step:0;
    return step>base?{key,step}:prev.key===key?prev:{key,step:base};
  }),[key]);
  return {minStep,onStepChange};
}
/** Measured SVG text. After rendering (and again once web fonts load) it
 * measures real glyph widths and walks `steps` (single line → balanced two
 * lines → smaller sizes) until the text fits `maxWidth`. An unavoidable
 * overflow is flagged with `data-km-text-overflow`, never silently clipped or
 * ellipsized. Widths are never estimated from character counts. */
export function FitText(props:FitTextProps){
  return <FitTextInner key={`${props.text}|${props.maxWidth}`} {...props}/>;
}
function FitTextInner({text,x,y,maxWidth,steps=TITLE_STEPS,bandHeight=0,valign="top",lineGap=2,
  textAnchor="middle",minStep=0,onStepChange,...rest}:FitTextProps){
  const ref=useRef<SVGTextElement>(null);
  const [ownStep,setStep]=useState(0);
  const step=Math.min(Math.max(ownStep,minStep),steps.length-1);
  useEffect(()=>{onStepChange?.(ownStep);},[ownStep,onStepChange]);
  const [overflow,setOverflow]=useState(false);
  const [fontsTick,setFontsTick]=useState(0);
  useEffect(()=>{
    let live=true;
    if(typeof document!=="undefined"&&document.fonts?.ready)
      document.fonts.ready.then(()=>{if(live)setFontsTick(t=>t+1);});
    return ()=>{live=false;};
  },[]);
  const current=steps[step];
  const lines=splitTextLines(text,current.lines);
  useIsomorphicLayoutEffect(()=>{
    const node=ref.current;
    if(!node)return;
    const spans=Array.from(node.querySelectorAll("tspan"));
    if(!spans.every(span=>typeof span.getComputedTextLength==="function"))return;
    const widest=Math.max(...spans.map(span=>span.getComputedTextLength()));
    if(widest>maxWidth){
      if(step<steps.length-1)setStep(step+1);
      else setOverflow(true);
    }
  },[step,fontsTick,maxWidth,steps]);
  const lineHeight=current.size+lineGap;
  const top=valign==="center"?y+(bandHeight-lineHeight*lines.length)/2:y;
  return <text fontFamily={TEXT_FONT_STACK} {...rest} ref={ref} x={x} textAnchor={textAnchor}
    fontSize={current.size} data-km-text-lines={lines.length}
    data-km-text-overflow={overflow?"true":undefined}>
    {lines.map((line,i)=><tspan key={i} x={x} y={top+lineHeight*i+current.size*.82}>{line}</tspan>)}
  </text>;
}
/** Title in its reserved band, measured with `FitText`. */
function FitTitle({title,color,opacity}:{title:string;color:string;opacity:number}){
  return <FitText text={title} x={120} y={ARTBOARD.title.y} bandHeight={ARTBOARD.title.height}
    valign="center" maxWidth={ARTBOARD.title.maxWidth} fill={color} opacity={opacity}
    fontWeight={640} data-km-illustration-region="title"/>;
}

/* ------------------------------------------------------------------ frame */

export interface DomainIllustrationProps extends Omit<SVGProps<SVGSVGElement>,"children"|"ref"> {
  /** Absolute frame from the host player. Defaults to the completed state. */
  frame?:number;
  startFrame?:number;
  revealFrames?:number;
  /** `true` shows the completed state at `startFrame` with no scale/fade.
   * `"auto"` (default) follows `prefers-reduced-motion`. */
  reducedMotion?:boolean|"auto";
  theme?:IllustrationThemeName;
  /** Partial semantic token overrides on top of the theme. */
  tokens?:Partial<IllustrationTokens>;
  showTitle?:boolean;
  /** Soft accent glow behind the subject. */
  backdrop?:boolean;
  /**
   * Poses for named parts (`data-km-part`), applied as SVG transforms about
   * each part's pivot. Drive it from `frame` for deterministic animation, or
   * pass `className`/`style` to animate parts with CSS. See `DOMAIN_PART_NAMES`.
   */
  parts?:PartPoses;
}
interface DomainIllustrationFrameProps extends DomainIllustrationProps {
  title:string;
  accent?:string;
  state?:DomainObjectState;
  semanticId:string;
  data:Record<`data-${string}`,string>;
  children:ReactNode;
}
/** Shared wrapper: tokens + defs context, protected art region, measured
 * title band, accessible name, state ring and deterministic reveal. */
export const DomainIllustration=forwardRef<SVGSVGElement,DomainIllustrationFrameProps>(
  function DomainIllustration({title,accent,state,semanticId,data,children,
    frame=Number.MAX_SAFE_INTEGER,startFrame=0,revealFrames=20,reducedMotion="auto",
    theme="midnight",tokens:overrides,showTitle=true,backdrop=true,parts,...props},ref){
    const prefersReduced=usePrefersReducedMotion();
    const reduced=reducedMotion==="auto"?prefersReduced:reducedMotion;
    const eased=domainRevealProgress(frame,startFrame,revealFrames);
    const progress=reduced?(frame>=startFrame?1:0):eased;
    const tokens=resolveIllustrationTokens(theme,overrides,accent);
    const uid="km-illo-"+useId().replace(/[^a-zA-Z0-9_-]/g,"");
    const context=createContextValue(uid,tokens,parts);
    const height=showTitle?ARTBOARD.height:ARTBOARD.artHeight;
    const scale=.88+.12*progress;
    const label=state&&state!=="idle"?`${title} (${state})`:title;
    const labelled=props["aria-label"]===undefined&&props["aria-labelledby"]===undefined;
    return <svg {...data} {...props} ref={ref} viewBox={`0 0 ${ARTBOARD.width} ${height}`}
      width={props.width??480} height={props.height??(showTitle?400:344)} role="img"
      aria-labelledby={labelled?uid+"-title":props["aria-labelledby"]}
      data-semantic-id={semanticId} data-state={state} data-theme={theme}
      style={{display:"block",overflow:"visible",...props.style}}>
      <title id={uid+"-title"}>{label}</title>
      <IllustrationContext.Provider value={context}>
        <IllustrationDefs c={context}/>
        {backdrop?<circle cx={120} cy={88} r={96} fill={context.ref("glow")}/>:null}
        {state==="active"||state==="complete"
          ?<rect data-km-illustration-region="state" x={5} y={4} width={230} height={156} rx={22}
            fill="none" strokeWidth={2.5} opacity={.75*progress}
            stroke={tokens[state==="active"?"accent":"positive"]}/>:null}
        <g data-km-illustration-region="art" opacity={progress}
          transform={`translate(${120*(1-scale)} ${88*(1-scale)}) scale(${scale})`}>
          {children}
        </g>
      </IllustrationContext.Provider>
      {showTitle?<FitTitle title={title} color={tokens.text} opacity={progress}/>:null}
    </svg>;
  });

/** Closed gear outline with `teeth` trapezoid teeth. */
export function gearPath(cx:number,cy:number,outer:number,inner:number,teeth:number):string {
  const pts:string[]=[];
  for(let i=0;i<teeth;i++){
    const a=i*2*Math.PI/teeth,w=Math.PI/teeth;
    const at=(ang:number,r:number)=>`${round(cx+r*Math.cos(ang))} ${round(cy+r*Math.sin(ang))}`;
    pts.push(at(a-w*.62,inner),at(a-w*.36,outer),at(a+w*.36,outer),at(a+w*.62,inner));
  }
  return "M "+pts.join(" L ")+" Z";
}
