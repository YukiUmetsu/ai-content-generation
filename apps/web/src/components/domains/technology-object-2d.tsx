/** Technology SVG illustrations composed from the shared `illustration-2d`
 * toolkit (same tokens, keylines, lighting and frame as the finance and
 * business packs). Vendor-neutral: no logos, product names or credentials.
 */
import { forwardRef } from "react";
import type { ReactNode } from "react";
import { resolveTechnologyObject } from "./technology-object-model";
import type { TechnologyObjectKind, TechnologyObjectSpec } from "./technology-object-model";
import {
  Arrow, Badge, Box, Cylinder, DomainIllustration, Glyph, IsoCube, Orb, Part, Person, Pipe, RADIUS,
  STROKE, Screen, Shadow, Shape, Stroke, TextRows, arc, gearPath, useIllustration,
} from "./illustration-2d";
import type { DomainIllustrationProps, IllustrationContextValue, IllustrationTone } from "./illustration-2d";

export interface TechnologyObject2DProps extends DomainIllustrationProps {
  spec:TechnologyObjectSpec;
}
type Draw=(c:IllustrationContextValue)=>ReactNode;

/* ------------------------------------------------------- sub-assemblies */

function Led({x,y,tone="positive",r=2.6,index=0}:{x:number;y:number;tone?:IllustrationTone;r?:number;index?:number}){
  const c=useIllustration();
  return <Part name="light" index={index} pivot={[x,y]}>
    <circle cx={x} cy={y} r={r+2.2} fill={c.color(tone)} opacity={.22}/>
    <circle cx={x} cy={y} r={r} fill={c.color(tone,.15)} stroke={c.tokens.ink} strokeWidth={.9}/>
  </Part>;
}
/** Placeholder code: indented, syntax-tinted rows (never real source). */
function CodeRows({x,y,rows}:{x:number;y:number;rows:readonly (readonly [number,number,IllustrationTone])[]}){
  // Each line is its own `rows` part, so typing-on reveals can stagger by index.
  return <g>{rows.map(([indent,w,tone],i)=><Part key={i} name="rows" index={i} pivot={[x+indent,y+i*11]}>
    <TextRows x={x+indent} y={y+i*11} widths={[w]} h={4.4} tone={tone} level={.15} opacity={.95}/></Part>)}</g>;
}
const CODE:readonly (readonly [number,number,IllustrationTone])[]=[
  [0,38,"accent"],[10,62,"surface"],[20,44,"accent2"],[20,30,"positive"],[10,52,"surface"],[0,22,"accent"]];
function Sparkle({x,y,s,tone="accent2",index=0}:{x:number;y:number;s:number;tone?:IllustrationTone;index?:number}){
  const c=useIllustration();
  return <Part name="sparkle" index={index} pivot={[x,y]}>
    <path d={`M ${x} ${y-s} Q ${x+s*.18} ${y-s*.18} ${x+s} ${y} Q ${x+s*.18} ${y+s*.18} ${x} ${y+s} `+
      `Q ${x-s*.18} ${y+s*.18} ${x-s} ${y} Q ${x-s*.18} ${y-s*.18} ${x} ${y-s} Z`}
      fill={c.paint(tone)} stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
  </Part>;
}
function Gear({cx,cy,outer,teeth,tone,index=0}:{cx:number;cy:number;outer:number;teeth:number;tone:IllustrationTone;index?:number}){
  const c=useIllustration();
  return <Part name="gear" index={index} pivot={[cx,cy]}>
    <path d={gearPath(cx,cy,outer,outer*.8,teeth)} fill={c.paint(tone)} stroke={c.tokens.ink}
      strokeWidth={STROKE.outline} strokeLinejoin="round"/>
    <circle cx={cx} cy={cy} r={outer*.62} fill="none" stroke={c.ref("rim")} strokeWidth={1.4}/>
    <Orb cx={cx} cy={cy} r={outer*.42} tone="surface"/>
    <circle cx={cx} cy={cy} r={outer*.2} fill={c.paint("deep")} stroke={c.tokens.ink} strokeWidth={STROKE.detail}/>
  </Part>;
}
const CLOUD="M 62 132 A 28 28 0 0 1 56 77 A 38 38 0 0 1 126 56 A 32 32 0 0 1 182 74 A 29 29 0 0 1 184 132 Z";

/* ---------------------------------------------------------------- kinds */

const ART:Record<TechnologyObjectKind,Draw>={
  "server-rack":c=><g>
    <Shadow cx={120} cy={154} rx={66}/>
    <Box x={78} y={146} w={14} h={8} r={2} tone="ink" rim={false}/><Box x={148} y={146} w={14} h={8} r={2} tone="ink" rim={false}/>
    <Box x={68} y={14} w={104} h={136} r={RADIUS.md} tone="deep"/>
    {[24,55,86,117].map((y,i)=><Part key={y} name="unit" index={i} pivot={[120,y+12.5]}>
      <Box x={78} y={y} w={84} h={25} r={RADIUS.sm}/>
      <Led x={88} y={y+12.5} tone={i===2?"accent2":"positive"} index={i*2}/>
      <Led x={98} y={y+12.5} tone="accent" r={2} index={i*2+1}/>
      {[0,1,2,3,4,5].map(k=><path key={k} d={`M ${118+k*6} ${y+7} V ${y+18}`} stroke={c.tokens.ink}
        strokeOpacity={.35} strokeWidth={2} strokeLinecap="round"/>)}
    </Part>)}
  </g>,
  "router":c=><g>
    <Shadow cx={120} cy={146} rx={94}/>
    <Part name="antenna" pivot={[66,84]}><Pipe d="M 66 84 V 30" tone="deep" w={6}/><Orb cx={66} cy={28} r={5} tone="deep" rim={false}/></Part>
    <Part name="antenna" index={1} pivot={[174,84]}><Pipe d="M 174 84 V 30" tone="deep" w={6}/><Orb cx={174} cy={28} r={5} tone="deep" rim={false}/></Part>
    <Part name="signal" pivot={[120,70]}>
      {[16,30].map((r,i)=><Part key={r} name="wave" index={i} pivot={[120,70]}><path d={arc(120,70,r,-140,-40)} fill="none" stroke={c.color("accent")}
        strokeWidth={4.4} strokeLinecap="round"/></Part>)}
      <circle cx={120} cy={70} r={4} fill={c.color("accent")}/>
    </Part>
    <path d="M 48 98 L 64 82 H 176 L 192 98 Z" fill={c.color("surface",.2)} stroke={c.tokens.ink}
      strokeWidth={STROKE.outline} strokeLinejoin="round"/>
    <Box x={38} y={96} w={164} h={40} r={RADIUS.lg}/>
    {[0,1,2,3].map(i=><Led key={i} x={58+i*14} y={116} tone={i===3?"accent2":"positive"} r={2.4} index={i}/>)}
    {[0,1,2].map(i=><Box key={i} x={140+i*16} y={110} w={11} h={10} r={1.5} tone="ink" rim={false} weight={1}/>)}
  </g>,
  "database":c=><g>
    <Shadow cx={120} cy={154} rx={64}/>
    <Part name="body" pivot={[120,150]}><Cylinder cx={120} y={32} w={112} h={112} ry={18} tone="accent" bands={2}/></Part>
    {[56,93,130].map((y,i)=><g key={y}>
      <Led x={84} y={y} tone="positive" r={2.6} index={i}/>
      <TextRows x={96} y={y-2} widths={[36]} h={4} tone="highlight" opacity={.5}/>
    </g>)}
    <path d="M 74 46 V 136" stroke={c.tokens.highlight} strokeOpacity={.35} strokeWidth={3} strokeLinecap="round"/>
  </g>,
  "storage-disk":c=><g>
    <Shadow cx={120} cy={152} rx={84}/>
    <Box x={42} y={22} w={156} h={126} r={RADIUS.lg} tone="deep"/>
    {[[52,32],[188,32],[52,138],[188,138]].map(([x,y])=><circle key={x+"-"+y} cx={x} cy={y} r={3}
      fill={c.paint("surface")} stroke={c.tokens.ink} strokeWidth={1}/>)}
    {/* Rotating the platter turns its tick, rings and catch-light about the spindle. */}
    <Part name="platter" pivot={[110,84]}>
      <Orb cx={110} cy={84} r={50} tone="surface"/>
      {[40,30,20].map(r=><circle key={r} cx={110} cy={84} r={r} fill="none" stroke={c.tokens.ink} strokeOpacity={.14} strokeWidth={1.2}/>)}
      <path d={arc(110,84,44,200,250)} fill="none" stroke={c.tokens.highlight} strokeOpacity={.85} strokeWidth={3} strokeLinecap="round"/>
      <path d="M 110 50 V 58" stroke={c.tokens.ink} strokeOpacity={.25} strokeWidth={2} strokeLinecap="round"/>
      <Orb cx={110} cy={84} r={9} tone="deep"/>
    </Part>
    <Part name="arm" pivot={[170,122]}>
      <g transform="rotate(40 170 122)">
        <Box x={126} y={116} w={52} h={12} r={6} tone="accent2"/>
        <Box x={120} y={114} w={14} h={16} r={3} tone="accent2" weight={STROKE.detail}/>
      </g>
      <Orb cx={170} cy={122} r={11} tone="accent2"/>
      <circle cx={170} cy={122} r={3.4} fill={c.tokens.ink}/>
    </Part>
  </g>,
  "cloud":()=><g>
    <Shadow cx={120} cy={150} rx={78}/>
    <Part name="cloud" pivot={[120,132]}>
      <Shape d={CLOUD} tone="surface"/>
      <Stroke d="M 70 84 A 30 30 0 0 1 100 64" tone="highlight" opacity={.8} w={3}/>
    </Part>
    <Arrow d="M 104 120 V 88" head="M 104 78 L 94 90 H 114 Z" tone="accent" w={5}/>
    <Arrow d="M 140 80 V 112" head="M 140 122 L 130 110 H 150 Z" tone="positive" w={5} partIndex={1}/>
  </g>,
  "api":()=><g>
    <Shadow cx={120} cy={146} rx={96}/>
    <Part name="cable" pivot={[30,94]}><Pipe d="M 30 94 Q 16 94 16 120 V 140" tone="deep" w={7}/></Part>
    <Part name="cable" index={1} pivot={[210,94]}><Pipe d="M 210 94 Q 224 94 224 120 V 140" tone="deep" w={7}/></Part>
    {/* Plug 0 slides right along x to mate with socket 1. */}
    <Part name="plug" pivot={[62,93]}>
      <Box x={92} y={74} w={20} h={8} r={2} tone="surface" weight={STROKE.detail}/>
      <Box x={92} y={104} w={20} h={8} r={2} tone="surface" weight={STROKE.detail}/>
      <Box x={28} y={64} w={68} h={58} r={RADIUS.lg} tone="accent"/>
    </Part>
    <Part name="plug" index={1} pivot={[169,93]}>
      <Box x={126} y={60} w={86} h={66} r={RADIUS.lg} tone="deep"/>
      <Box x={130} y={72} w={10} h={12} r={1.5} tone="ink" rim={false}/>
      <Box x={130} y={102} w={10} h={12} r={1.5} tone="ink" rim={false}/>
      <Led x={196} y={74} tone="positive"/>
    </Part>
    <Badge cx={120} cy={36} r={17} tone="accent2" icon="code"/>
  </g>,
  "laptop":c=><g>
    <Shadow cx={120} cy={150} rx={100}/>
    {/* The lid hinges at its bottom edge: scale-y from 0 to 1 opens the laptop. */}
    <Part name="lid" pivot={[120,122]}>
      <Box x={46} y={20} w={148} h={102} r={RADIUS.md} tone="deep"/>
      <Screen x={54} y={28} w={132} h={86}>
        <CodeRows x={66} y={40} rows={CODE}/>
      </Screen>
    </Part>
    <Part name="base" pivot={[120,147]}>
      <path d="M 26 126 H 214 L 204 142 Q 201 147 194 147 H 46 Q 39 147 36 142 Z" fill={c.paint("surface")}
        stroke={c.tokens.ink} strokeWidth={STROKE.outline} strokeLinejoin="round"/>
      <rect x={24} y={120} width={192} height={8} rx={3} fill={c.paint("surface")} stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
      <rect x={102} y={121.5} width={36} height={4} rx={2} fill={c.color("surface",-.25)}/>
      <rect x={98} y={133} width={44} height={8} rx={2} fill={c.color("surface",-.12)} stroke={c.tokens.ink} strokeOpacity={.4} strokeWidth={1}/>
    </Part>
  </g>,
  "mobile-phone":c=><g>
    <Shadow cx={120} cy={156} rx={48}/>
    <Box x={76} y={12} w={88} h={144} r={RADIUS.xl+2} tone="deep"/>
    <rect x={164} y={42} width={3} height={20} rx={1.5} fill={c.color("deep",-.2)} stroke={c.tokens.ink} strokeWidth={1}/>
    <Screen x={83} y={19} w={74} h={130} r={RADIUS.lg+2}>
      <Part name="icons" pivot={[120,82]}>
        {(["accent","accent2","positive","negative","surface","accent","positive","accent2","accent","negative","surface","positive"] as const)
          .map((tone,i)=><Box key={i} x={92+(i%3)*20} y={38+Math.floor(i/3)*22} w={14} h={14} r={4} tone={tone}
            weight={1} rim={false}/>)}
      </Part>
      <rect x={106} y={140} width={28} height={3} rx={1.5} fill={c.tokens.highlight} opacity={.6}/>
    </Screen>
    <Box x={108} y={23} w={24} h={7} r={3.5} tone="ink" rim={false} weight={1}/>
  </g>,
  "cpu":c=><g>
    <Shadow cx={120} cy={152} rx={70}/>
    <Part name="pins" pivot={[120,85]}>
    {[0,1,2,3,4,5].map(i=>{const o=44+i*16;
      return <g key={i} fill={c.paint("surface")} stroke={c.tokens.ink} strokeWidth={1.1}>
        <rect x={o+28} y={16} width={8} height={16} rx={1.5}/><rect x={o+28} y={138} width={8} height={16} rx={1.5}/>
        <rect x={50} y={o-6} width={16} height={8} rx={1.5}/><rect x={174} y={o-6} width={16} height={8} rx={1.5}/>
      </g>;})}
    </Part>
    <Part name="body" pivot={[120,85]}><Box x={62} y={28} w={116} h={114} r={RADIUS.lg} tone="deep"/></Part>
    <Part name="die" pivot={[120,85]}>
      <Box x={86} y={51} w={68} h={68} r={RADIUS.md} tone="accent2"/>
      <path d="M 98 63 H 142 V 107 H 98 Z M 120 63 V 107 M 98 85 H 142" fill="none" stroke={c.color("accent2",-.4)}
        strokeWidth={1.4} strokeOpacity={.7}/>
    </Part>
    <circle cx={74} cy={40} r={3.4} fill={c.tokens.highlight} opacity={.8}/>
  </g>,
  "ai-model":c=>{
    const layers=[[56,[60,96,132]],[120,[44,74,104,134]],[184,[72,118]]] as const;
    const tones:readonly IllustrationTone[]=["surface","accent","accent2"];
    return <g>
      <Shadow cx={120} cy={154} rx={86}/>
      <Part name="links" pivot={[120,88]}><g stroke={c.color("accent",.2)} strokeWidth={1.8} opacity={.55}>
        {layers.slice(0,-1).flatMap(([x1,ys1],l)=>ys1.flatMap(y1=>layers[l+1][1].map(y2=>
          <path key={`${l}-${y1}-${y2}`} d={`M ${x1} ${y1} L ${layers[l+1][0]} ${y2}`}/>)))}
      </g></Part>
      {/* Nodes are indexed layer by layer, so index order is signal order. */}
      {layers.flatMap(([x,ys],l)=>ys.map(y=>({x,y,l}))).map(({x,y,l},i)=><Part key={`${l}-${y}`} name="node" index={i} pivot={[x,y]}>
        <Orb cx={x} cy={y} r={l===1?11:12} tone={tones[l]}/></Part>)}
      <Sparkle x={196} y={30} s={13}/>
      <Sparkle x={216} y={56} s={7} tone="accent" index={1}/>
    </g>;
  },
  "padlock":c=><g>
    <Shadow cx={120} cy={156} rx={58}/>
    {/* The shackle pivots on its right leg: rotate it (~-30°) or lift it to unlock. */}
    <Part name="shackle" pivot={[148,80]}>
      <Pipe d="M 92 80 V 58 A 28 28 0 0 1 148 58 V 80" tone="surface" level={0} w={13}/>
      <Stroke d="M 97 74 V 58 A 23 23 0 0 1 112 36" tone="highlight" opacity={.6} w={2.4}/>
    </Part>
    <Part name="body" pivot={[120,154]}>
      <Box x={68} y={74} w={104} h={80} r={RADIUS.xl} tone="accent2"/>
      <Part name="keyhole" pivot={[120,112]}>
        <path d="M 120 100 m -9 0 a 9 9 0 1 0 18 0 a 9 9 0 1 0 -18 0 M 116 106 L 113 128 H 127 L 124 106 Z"
          fill={c.color("accent2",-.55)} stroke={c.tokens.ink} strokeWidth={1.2} strokeLinejoin="round"/>
      </Part>
      <Stroke d="M 80 88 V 140" tone="highlight" opacity={.35} w={3}/>
    </Part>
  </g>,
  "security-key":c=><g>
    <Shadow cx={124} cy={146} rx={92}/>
    <Part name="key" pivot={[76,88]}>
    <path d="M 40 88 a 36 36 0 1 0 72 0 a 36 36 0 1 0 -72 0 Z M 60 88 a 16 16 0 1 1 32 0 a 16 16 0 1 1 -32 0 Z"
      fillRule="evenodd" fill={c.paint("accent2")} stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    <path d={arc(76,88,30,200,280)} fill="none" stroke={c.tokens.highlight} strokeOpacity={.7} strokeWidth={2.4} strokeLinecap="round"/>
    <Shape d="M 110 80 H 204 Q 210 80 210 86 V 92 Q 210 98 204 98 H 196 V 114 H 184 V 106 H 174 V 118 H 160 V 98 H 110 Z" tone="accent2"/>
    <Stroke d="M 118 89 H 200" tone="accent2" level={-.45} w={1.6}/>
    </Part>
    <Badge cx={186} cy={46} r={17} tone="accent" icon="shield"/>
  </g>,
  "code-terminal":c=><g>
    <Shadow cx={120} cy={152} rx={96}/>
    <Box x={24} y={22} w={192} h={126} r={RADIUS.lg} tone="deep"/>
    {(["negative","accent2","positive"] as const).map((t,i)=><Part key={t} name="light" index={i} pivot={[38+i*11,32]}>
      <circle cx={38+i*11} cy={32} r={3.4} fill={c.color(t)} stroke={c.tokens.ink} strokeWidth={.8}/></Part>)}
    <Screen x={32} y={42} w={176} h={98} r={RADIUS.sm}>
      <Glyph x={48} y={58} size={15} fill={c.color("positive",.1)}>{"›"}</Glyph>
      <CodeRows x={58} y={55} rows={CODE.slice(0,5)}/>
      <Glyph x={48} y={124} size={15} fill={c.color("positive",.1)}>{"›"}</Glyph>
      <Part name="cursor" pivot={[62.5,124.5]}><rect x={58} y={118} width={9} height={13} rx={1.5} fill={c.color("accent",.1)}/></Part>
    </Screen>
  </g>,
  "container":()=><g>
    <Shadow cx={120} cy={154} rx={90}/>
    <Part name="cube" pivot={[86,166]}><IsoCube cx={86} cy={96} s={34} tone="deep" ribs={3}/></Part>
    <Part name="cube" index={1} pivot={[154,166]}><IsoCube cx={154} cy={96} s={34} tone="accent2" ribs={3}/></Part>
    <Part name="cube" index={2} pivot={[120,130]}><IsoCube cx={120} cy={60} s={34} tone="accent" ribs={3}/></Part>
  </g>,
  "user-identity":c=><g>
    <Shadow cx={120} cy={154} rx={96}/>
    <Part name="card" pivot={[120,94]}>
    <Box x={26} y={38} w={188} h={112} r={RADIUS.lg}/>
    <path d={`M 36 38 H 204 Q 214 38 214 48 V 58 H 26 V 48 Q 26 38 36 38 Z`} fill={c.paint("accent")}
      stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    <Box x={104} y={44} w={32} h={8} r={4} tone="deep" rim={false} weight={1.2}/>
    <Box x={40} y={70} w={60} h={66} r={RADIUS.md} tone="deep"/>
    <Person cx={70} y={80} s={1} tone="accent"/>
    <TextRows x={112} y={76} widths={[64]} h={7} opacity={.65}/>
    <TextRows x={112} y={94} widths={[82,70,54]} gap={11} h={4}/>
    </Part>
    <Badge cx={196} cy={36} r={16} tone="positive" icon="check"/>
  </g>,
  "settings":()=><g>
    <Shadow cx={112} cy={154} rx={70}/>
    <Gear cx={164} cy={52} outer={30} teeth={8} tone="accent2"/>
    <Gear cx={104} cy={96} outer={56} teeth={10} tone="deep" index={1}/>
  </g>,
  "bug":c=><g>
    <Shadow cx={120} cy={154} rx={56}/>
    {/* Legs pivot where they meet the shell: index 0–2 left (front to back), 3–5 right. */}
    {[-1,1].map((side,s)=>[0,1,2].map(i=><Part key={side+"-"+i} name="leg" index={s*3+i} pivot={[120+side*30,80+i*24]}>
      <Pipe tone="deep" w={4.4}
        d={`M ${120+side*30} ${80+i*24} L ${120+side*52} ${72+i*30} L ${120+side*60} ${84+i*32}`}/></Part>))}
    <Part name="antenna" pivot={[112,38]}><Pipe d="M 112 38 Q 100 20 86 18" tone="deep" w={3}/></Part>
    <Part name="antenna" index={1} pivot={[128,38]}><Pipe d="M 128 38 Q 140 20 154 18" tone="deep" w={3}/></Part>
    <Part name="head" pivot={[120,62]}><Orb cx={120} cy={48} r={20} ry={17} tone="deep"/>
      <circle cx={112} cy={46} r={3} fill={c.tokens.highlight}/><circle cx={128} cy={46} r={3} fill={c.tokens.highlight}/></Part>
    <Part name="body" pivot={[120,152]}>
    <Orb cx={120} cy={102} r={40} ry={50} tone="negative"/>
    <path d="M 120 54 V 151" stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    {[[102,88,7],[138,88,7],[100,120,6],[140,120,6]].map(([x,y,r])=><circle key={x+"-"+y} cx={x} cy={y} r={r}
      fill={c.color("negative",-.4)}/>)}
    <Stroke d="M 94 70 A 34 42 0 0 1 112 58" tone="highlight" opacity={.6} w={3}/>
    </Part>
  </g>,
  "git-branch":()=><g>
    <Shadow cx={120} cy={154} rx={76}/>
    <Part name="branch" pivot={[78,152]}><Pipe d="M 78 152 V 18" tone="accent" level={0} w={7}/></Part>
    <Part name="branch" index={1} pivot={[78,128]}><Pipe d="M 78 128 C 78 100 154 110 154 82 V 34" tone="accent2" level={0} w={7}/></Part>
    {/* Commits are indexed oldest to newest: main (128, 82, 36), then the branch (82, 34). */}
    {[128,82,36].map((y,i)=><Part key={y} name="commit" index={i} pivot={[78,y]}>
      <Orb cx={78} cy={y} r={12} tone="surface"/><Orb cx={78} cy={y} r={5} tone="accent" rim={false} weight={1}/></Part>)}
    <Part name="commit" index={3} pivot={[154,82]}><Orb cx={154} cy={82} r={11} tone="surface"/><Orb cx={154} cy={82} r={4.6} tone="accent2" rim={false} weight={1}/></Part>
    <Part name="commit" index={4} pivot={[154,34]}>
      <Orb cx={154} cy={34} r={15} tone="accent2"/>
      <Orb cx={154} cy={34} r={6} tone="surface" rim={false} weight={1.2}/>
    </Part>
  </g>,
};
function TechnologyArt({kind}:{kind:TechnologyObjectKind}){
  const c=useIllustration();
  const draw=ART[kind];
  if(!draw)throw new Error(`No 2D illustration registered for technology kind ${JSON.stringify(kind)}.`);
  return <>{draw(c)}</>;
}
/** Accessible, themeable, frame-addressable technology object illustration. */
export const TechnologyObject2D=forwardRef<SVGSVGElement,TechnologyObject2DProps>(function TechnologyObject2D(
  {spec,...props},ref){
  const object=resolveTechnologyObject(spec);
  return <DomainIllustration {...props} ref={ref} title={object.title} accent={object.accent}
    state={object.state} semanticId={object.id}
    data={{"data-km-technology-object-2d":object.kind,"data-km-archetype":object.archetype}}>
    <TechnologyArt kind={object.kind}/>
  </DomainIllustration>;
});
