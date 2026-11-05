/** Business operations SVG illustrations composed from the shared
 * `illustration-2d` toolkit (same tokens, keylines, lighting and frame as
 * the finance and technology packs). Generic, brand-free and data-free.
 */
import { forwardRef } from "react";
import type { ReactNode } from "react";
import { resolveBusinessObject } from "./business-object-model";
import type { BusinessObjectKind, BusinessObjectSpec } from "./business-object-model";
import {
  Arrow, Badge, Box, CALENDAR_CELLS, CalendarBase, DomainIllustration, Glyph, Icon, Orb, Part, Person, Pipe,
  RADIUS, STROKE, Screen, Shadow, Shape, Sheet, Stroke, TextRows, arc, calendarCell, gearPath,
  useIllustration,
} from "./illustration-2d";
import type { DomainIllustrationProps, IllustrationContextValue, IllustrationTone } from "./illustration-2d";

export interface BusinessObject2DProps extends DomainIllustrationProps {
  spec:BusinessObjectSpec;
}
type Draw=(c:IllustrationContextValue)=>ReactNode;

/* ------------------------------------------------------- sub-assemblies */

function OrgNode({x,y,tone="surface",index=0}:{x:number;y:number;tone?:IllustrationTone;index?:number}){
  return <Part name="node" index={index} pivot={[x+26,y+20]}>
    <Box x={x} y={y} w={52} h={40} r={RADIUS.md} tone={tone}/>
    <Person cx={x+15} y={y+7} s={.55} tone={tone==="accent"?"accent2":"accent"} partIndex={index}/>
    <TextRows x={x+28} y={y+14} widths={[17,12]} gap={8} h={3.6} opacity={.5}/>
  </Part>;
}
function Flag({x,y,tone="accent",s=1,index=0}:{x:number;y:number;tone?:IllustrationTone;s?:number;index?:number}){
  // Pivot on the pole at the flag's leading edge: a small rotate or x-scale reads as waving.
  return <g>
    <Pipe d={`M ${x} ${y} V ${y-30*s}`} tone="surface" w={2}/>
    <Part name="flag" index={index} pivot={[x+1,y-23*s]}>
      <Shape d={`M ${x+1} ${y-30*s} H ${x+22*s} L ${x+16*s} ${y-23*s} L ${x+22*s} ${y-16*s} H ${x+1} Z`} tone={tone}
        weight={STROKE.detail}/>
    </Part>
  </g>;
}
function Clock({cx,cy,r}:{cx:number;cy:number;r:number}){
  const c=useIllustration();
  return <Part name="clock" pivot={[cx,cy+r*1.05]}>
    <Pipe d={`M ${cx-r*.55} ${cy+r*.7} L ${cx-r*.8} ${cy+r*1.05} M ${cx+r*.55} ${cy+r*.7} L ${cx+r*.8} ${cy+r*1.05}`} tone="deep" w={3}/>
    <Part name="bell" pivot={[cx-r*.62,cy-r*.62]}><Shape d={`M ${cx-r*.95} ${cy-r*.62} A ${r*.42} ${r*.42} 0 0 1 ${cx-r*.36} ${cy-r*1.06} Z`} tone="accent2"/></Part>
    <Part name="bell" index={1} pivot={[cx+r*.62,cy-r*.62]}><Shape d={`M ${cx+r*.95} ${cy-r*.62} A ${r*.42} ${r*.42} 0 0 0 ${cx+r*.36} ${cy-r*1.06} Z`} tone="accent2"/></Part>
    <Orb cx={cx} cy={cy} r={r} tone="negative"/>
    <Orb cx={cx} cy={cy} r={r*.78} tone="surface"/>
    {Array.from({length:12},(_,i)=>{const a=i*Math.PI/6,r1=r*(i%3?.66:.6);
      return <path key={i} d={`M ${cx+r1*Math.cos(a)} ${cy+r1*Math.sin(a)} L ${cx+r*.7*Math.cos(a)} ${cy+r*.7*Math.sin(a)}`}
        stroke={c.tokens.ink} strokeWidth={i%3?1:1.8} opacity={.6}/>;})}
    {/* Hands are separate parts about the centre: index 0 = minute, 1 = hour. */}
    <Part name="hand" pivot={[cx,cy]}><Stroke d={`M ${cx} ${cy} V ${cy-r*.48}`} w={2.6}/></Part>
    <Part name="hand" index={1} pivot={[cx,cy]}><Stroke d={`M ${cx} ${cy} L ${cx+r*.34} ${cy+r*.18}`} w={2.6}/></Part>
    <circle cx={cx} cy={cy} r={2.6} fill={c.color("negative")}/>
  </Part>;
}
function MiniBox({x,y,s=1,index=0}:{x:number;y:number;s?:number;index?:number}){
  const c=useIllustration();
  return <g transform={`translate(${x} ${y}) scale(${s})`}><Part name="box" index={index} pivot={[15,24]}>
    <Box x={0} y={0} w={30} h={24} r={RADIUS.xs} tone="accent2" weight={STROKE.detail}/>
    <rect x={12} y={1} width={6} height={22} fill={c.color("accent2",.35)}/>
  </Part></g>;
}

/* ---------------------------------------------------------------- kinds */

const ART:Record<BusinessObjectKind,Draw>={
  "org-chart":()=><g>
    <Shadow cx={120} cy={150} rx={98}/>
    <Part name="connector" pivot={[120,78]}><Pipe d="M 120 56 V 78 M 54 78 H 186 M 54 78 V 100 M 120 78 V 100 M 186 78 V 100"/></Part>
    <OrgNode x={94} y={16} tone="accent"/>
    <OrgNode x={28} y={100} index={1}/><OrgNode x={94} y={100} index={2}/><OrgNode x={160} y={100} index={3}/>
  </g>,
  "team":()=><g>
    <Shadow cx={120} cy={150} rx={92}/>
    <Person cx={70} y={48} s={1.42} tone="deep"/>
    <Person cx={170} y={48} s={1.42} tone="accent2" partIndex={1}/>
    <Person cx={120} y={54} s={1.8} tone="accent" partIndex={2}/>
  </g>,
  "meeting":c=><g>
    <Shadow cx={120} cy={152} rx={98}/>
    <Person cx={66} y={62} s={1.2} tone="deep"/>
    <Person cx={174} y={62} s={1.2} tone="accent2" partIndex={1}/>
    <Person cx={120} y={54} s={1.3} tone="accent" partIndex={2}/>
    <Part name="table" pivot={[120,126]}>
      <Orb cx={120} cy={126} r={92} ry={20} tone="deep"/>
      <path d="M 30 128 Q 120 154 210 128 V 136 Q 120 162 30 136 Z" fill={c.color("deep",-.35)} stroke={c.tokens.ink}
        strokeWidth={STROKE.detail}/>
      <Part name="sheet" pivot={[90,121]}><Sheet x={78} y={114} w={24} h={14} fold={0} r={1}/></Part>
      <Part name="sheet" index={1} pivot={[152,123]}><Sheet x={140} y={116} w={24} h={14} fold={0} r={1}/></Part>
    </Part>
    <Part name="bubble" pivot={[180,56]}>
      <Shape d="M 172 18 H 214 Q 222 18 222 26 V 40 Q 222 48 214 48 H 190 L 180 56 L 182 48 H 172 Q 164 48 164 40 V 26 Q 164 18 172 18 Z" tone="surface"/>
      {[180,193,206].map((x,i)=><Part key={x} name="light" index={i} pivot={[x,33]}><circle cx={x} cy={33} r={2.8} fill={c.color("accent",-.1)}/></Part>)}
    </Part>
  </g>,
  "presentation":()=><g>
    <Shadow cx={128} cy={152} rx={94}/>
    <Pipe d="M 143 108 L 122 150 M 143 108 L 164 150 M 143 108 V 150" tone="deep" w={3}/>
    <Part name="board" pivot={[143,110]}>
      <Box x={72} y={16} w={142} h={94} r={RADIUS.md}/>
      <Box x={68} y={12} w={150} h={10} r={RADIUS.sm} tone="deep"/>
      {[[88,26],[110,42],[132,34],[154,58]].map(([x,h],i)=><Part key={x} name="bar" index={i} pivot={[x+8,96]}>
        <Box x={x} y={96-h} w={16} h={h} r={RADIUS.xs} tone="accent" weight={STROKE.detail}/></Part>)}
      <Part name="line" pivot={[86,70]}>
        <Stroke d="M 86 70 L 118 52 L 140 60 L 196 32" tone="accent2" level={-.1} w={3}/>
        <Orb cx={196} cy={32} r={4} tone="accent2" rim={false} weight={1.2}/>
      </Part>
      <Stroke d="M 84 98 H 204" opacity={.4}/>
    </Part>
    <Person cx={42} y={72} s={1.42} tone="accent2"/>
    <Part name="pointer" pivot={[58,104]}><Pipe d="M 58 104 L 92 70" tone="surface" w={2}/></Part>
  </g>,
  "kpi-dashboard":c=><g>
    <Shadow cx={120} cy={152} rx={96}/>
    <Box x={24} y={20} w={192} h={128} r={RADIUS.lg}/>
    <path d="M 34 20 H 206 Q 216 20 216 30 V 36 H 24 V 30 Q 24 20 34 20 Z" fill={c.paint("deep")} stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    {(["negative","accent2","positive"] as const).map((t,i)=><Part key={t} name="light" index={i} pivot={[36+i*10,28]}>
      <circle cx={36+i*10} cy={28} r={3} fill={c.color(t)}/></Part>)}
    {[34,96,158].map((x,i)=><Part key={x} name="tile" index={i} pivot={[x+25,64]}>
      <Box x={x} y={46} w={50} h={36} r={RADIUS.sm} tone="surface" weight={STROKE.detail}/>
      <TextRows x={x+8} y={54} widths={[20]} h={3}/>
      <TextRows x={x+8} y={63} widths={[i===1?22:26]} h={8} tone={i===2?"negative":"ink"} opacity={.75}/>
      {i===0?<Icon name="up" cx={x+41} cy={67} size={5} color={c.color("positive")} weight={2.4}/>:null}
      {i===1?<g><circle cx={x+38} cy={64} r={7.5} fill="none" stroke={c.color("ink")} strokeOpacity={.12} strokeWidth={3.4}/>
        <path d={arc(x+38,64,7.5,-90,170)} fill="none" stroke={c.color("accent")} strokeWidth={3.4}/></g>:null}
      {i===2?<Icon name="down" cx={x+41} cy={67} size={5} color={c.color("negative")} weight={2.4}/>:null}
    </Part>)}
    <Part name="line" pivot={[36,136]}>
      <path d="M 36 136 L 36 120 Q 60 104 84 112 T 132 100 T 180 94 T 204 88 V 136 Z" fill={c.color("accent")} opacity={.22}/>
      <Stroke d="M 36 120 Q 60 104 84 112 T 132 100 T 180 94 T 204 88" tone="accent" w={2.8}/>
    </Part>
  </g>,
  "target":c=><g>
    <Shadow cx={112} cy={152} rx={70}/>
    <Part name="stand" pivot={[112,150]}><Pipe d="M 96 130 L 82 150 M 128 130 L 142 150" tone="deep" w={4}/></Part>
    <Part name="target" pivot={[112,86]}>
      {[60,46,32,18].map((r,i)=><Orb key={r} cx={112} cy={86} r={r} tone={i%2?"surface":"negative"} rim={i===0}/>)}
      <Orb cx={112} cy={86} r={6} tone="negative" rim={false}/>
    </Part>
    {/* The dart pivots at its tip, so a translate along (82, -54) flies it in. */}
    <Part name="dart" pivot={[114,84]}>
      <path d="M 114 84 L 196 30" stroke={c.tokens.ink} strokeWidth={6.6} strokeLinecap="round"/>
      <path d="M 114 84 L 196 30" stroke={c.color("deep",.25)} strokeWidth={3.2} strokeLinecap="round"/>
      <Shape d="M 186 36 L 196 16 L 204 22 L 198 34 Z" tone="accent" weight={STROKE.detail}/>
      <Shape d="M 190 40 L 212 36 L 214 46 L 200 44 Z" tone="accent" weight={STROKE.detail}/>
    </Part>
  </g>,
  "milestone":c=><g>
    <Shadow cx={112} cy={152} rx={92}/>
    <Part name="path" pivot={[22,150]}>
    <path d="M 22 150 C 70 150 70 108 116 104 S 170 78 176 58" fill="none" stroke={c.tokens.ink} strokeWidth={28} strokeLinecap="round"/>
    <path d="M 22 150 C 70 150 70 108 116 104 S 170 78 176 58" fill="none" stroke={c.paint("deep")} strokeWidth={24} strokeLinecap="round"/>
    <path d="M 22 150 C 70 150 70 108 116 104 S 170 78 176 58" fill="none" stroke={c.tokens.highlight}
      strokeOpacity={.7} strokeWidth={2} strokeDasharray="7 7"/>
    </Part>
    <Flag x={58} y={120} tone="accent" s={.8}/>
    <Flag x={124} y={88} tone="accent" s={.8} index={1}/>
    <Flag x={180} y={52} tone="accent2" s={1.05} index={2}/>
    <Badge cx={204} cy={96} r={15} tone="positive" icon="check"/>
  </g>,
  "deadline":c=><g>
    <CalendarBase x={34} y={26}>
      {CALENDAR_CELLS.map((_,i)=>{const r=calendarCell(i,34,26);
        return <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={3} fill={c.color("ink")}
          opacity={i<9?.18:.07}/>;})}
      {(()=>{const r=calendarCell(9,34,26);
        return <Part name="day" pivot={[r.x+r.w/2,r.y+r.h/2]}><rect x={r.x-3} y={r.y-3} width={r.w+6} height={r.h+6} rx={6} fill="none"
          stroke={c.color("negative")} strokeWidth={3}/></Part>;})()}
    </CalendarBase>
    <Clock cx={180} cy={112} r={32}/>
  </g>,
  "workflow":c=><g>
    <Shadow cx={120} cy={150} rx={96}/>
    <Arrow d="M 52 74 Q 56 108 88 112" head="M 98 112 L 86 104 L 86 120 Z" tone="accent" w={4}/>
    <Arrow d="M 152 112 Q 186 112 188 80" head="M 188 70 L 180 82 L 196 82 Z" tone="positive" w={4} partIndex={1}/>
    <Part name="step" pivot={[54,53]}>
      <Box x={22} y={34} w={64} h={38} r={19} tone="accent"/>
      <Icon name="play" cx={54} cy={53} size={8} color={c.tokens.highlight} weight={2.2}/>
    </Part>
    <Part name="step" index={1} pivot={[120,112]}>
      <Shape d="M 120 82 L 150 112 L 120 142 L 90 112 Z" tone="accent2"/>
      <Glyph x={120} y={113} size={22} fill={c.color("accent2",-.5)}>?</Glyph>
    </Part>
    <Part name="step" index={2} pivot={[186,50]}>
      <Box x={154} y={30} w={64} h={40} r={RADIUS.md} tone="positive"/>
      <Icon name="check" cx={186} cy={50} size={9} color={c.tokens.highlight} weight={3}/>
    </Part>
  </g>,
  "checklist":c=><g>
    <Shadow cx={116} cy={154} rx={74}/>
    <Box x={56} y={24} w={116} h={128} r={RADIUS.md} tone="deep"/>
    <Sheet x={66} y={36} w={96} h={108} fold={0} r={RADIUS.xs}/>
    <Part name="clip" pivot={[114,24]}><Box x={92} y={16} w={44} h={16} r={RADIUS.sm} tone="accent2"/></Part>
    {[52,74,96,118].map((y,i)=><g key={y}>
      <rect x={76} y={y} width={13} height={13} rx={3} fill={c.paint(i<3?"positive":"surface")} stroke={c.tokens.ink} strokeWidth={STROKE.fine}/>
      {i<3?<Part name="check" index={i} pivot={[82.5,y+6.5]}><Icon name="check" cx={82.5} cy={y+6.5} size={5} color={c.tokens.highlight} weight={2}/></Part>:null}
      <TextRows x={96} y={y+4.5} widths={[i===3?40:52]} h={4} opacity={i<3?.3:.55}/>
    </g>)}
    <Part name="pen" pivot={[132,124]}><g transform="rotate(-48 176 124)">
      <Box x={146} y={118} w={50} h={12} r={1.5} tone="accent2" weight={STROKE.detail}/>
      <Box x={196} y={118} w={8} h={12} r={1} tone="surface" weight={STROKE.detail} rim={false}/>
      <Box x={204} y={118} w={9} h={12} r={3} tone="negative" weight={STROKE.detail} rim={false}/>
      <Shape d="M 146 118 L 132 124 L 146 130 Z" tone="surface" weight={STROKE.detail}/>
      <path d="M 136 122.2 L 132 124 L 136 125.8 Z" fill={c.tokens.ink}/>
    </g></Part>
  </g>,
  "idea":c=><g>
    <Shadow cx={120} cy={154} rx={36}/>
    <Part name="rays" pivot={[120,68]}>{[[-90],[-40],[-140],[0],[180]].map(([a])=>{const r1=54,r2=66,rad=a*Math.PI/180;
      return <path key={a} d={`M ${120+r1*Math.cos(rad)} ${68+r1*Math.sin(rad)} L ${120+r2*Math.cos(rad)} ${68+r2*Math.sin(rad)}`}
        stroke={c.color("accent2")} strokeWidth={4.4} strokeLinecap="round"/>;})}</Part>
    <Part name="bulb" pivot={[120,118]}>
      <Shape d="M 98 108 Q 80 94 80 68 A 40 40 0 0 1 160 68 Q 160 94 142 108 L 140 118 H 100 Z" tone="accent2"/>
      <Stroke d="M 96 54 A 26 26 0 0 1 114 38" tone="highlight" opacity={.75} w={4}/>
      <Part name="filament" pivot={[120,100]}>
        <Stroke d="M 110 116 V 98 L 104 84 Q 112 76 120 84 Q 128 76 136 84 L 130 98 V 116" tone="accent2" level={-.5} w={2.2}/>
      </Part>
    </Part>
    <Box x={98} y={116} w={44} h={24} r={RADIUS.sm} tone="deep"/>
    <Stroke d="M 99 124 H 141 M 99 132 H 141" opacity={.5}/>
    <Box x={108} y={138} w={24} h={10} r={5} tone="deep"/>
  </g>,
  "megaphone":c=><g>
    <Shadow cx={112} cy={152} rx={80}/>
    <Part name="body" pivot={[64,90]}>
      <Part name="handle" pivot={[110,110]}><Shape d="M 98 108 L 104 146 H 120 L 118 112 Z" tone="deep"/></Part>
      <Box x={34} y={70} w={30} h={40} r={RADIUS.md} tone="deep"/>
      <Shape d="M 60 74 L 160 30 Q 170 26 170 38 V 142 Q 170 154 160 150 L 60 106 Z" tone="accent"/>
      <Orb cx={166} cy={90} r={14} ry={58} tone="accent" rim={false}/>
      <ellipse cx={168} cy={90} rx={8} ry={46} fill={c.color("accent",-.4)}/>
      <Stroke d="M 72 82 L 156 44" tone="highlight" opacity={.45} w={3}/>
    </Part>
    <Part name="wave" pivot={[168,90]}><path d={arc(168,90,46,-32,32)} fill="none" stroke={c.color("accent2")} strokeWidth={4.4} strokeLinecap="round"/></Part>
    <Part name="wave" index={1} pivot={[168,90]}><path d={arc(168,90,60,-26,26)} fill="none" stroke={c.color("accent2")} strokeWidth={4.4} strokeLinecap="round"/></Part>
  </g>,
  "global-market":c=><g>
    <Shadow cx={116} cy={154} rx={66}/>
    <Part name="globe" pivot={[116,86]}>
    <Orb cx={116} cy={86} r={62} tone="accent"/>
    <g opacity={.95}>
      <Shape d="M 72 52 Q 92 40 108 50 Q 116 62 104 70 Q 98 84 84 80 Q 70 74 72 52 Z" tone="positive" weight={STROKE.detail}/>
      <Shape d="M 120 64 Q 138 56 150 66 Q 160 84 146 96 Q 140 116 126 112 Q 118 96 124 86 Q 114 76 120 64 Z" tone="positive" weight={STROKE.detail}/>
      <Shape d="M 80 104 Q 96 98 102 110 Q 98 126 86 128 Q 74 118 80 104 Z" tone="positive" weight={STROKE.detail}/>
    </g>
    <ellipse cx={116} cy={86} rx={28} ry={62} fill="none" stroke={c.tokens.highlight} strokeOpacity={.25} strokeWidth={1.4}/>
    <path d="M 54 86 H 178 M 62 56 H 170 M 62 116 H 170" stroke={c.tokens.highlight} strokeOpacity={.25} strokeWidth={1.4}/>
    </Part>
    <Part name="route" pivot={[141,40]}><Pipe d="M 92 58 Q 150 20 190 60" tone="accent2" w={2.4}/></Part>
    <Pin x={92} y={58}/><Pin x={190} y={60} index={1}/><Pin x={138} y={100} index={2}/>
  </g>,
  "delivery-truck":c=><g>
    <Shadow cx={120} cy={150} rx={104}/>
    <Part name="trail" pivot={[22,84]}><Pipe d="M 12 66 H 22 M 8 84 H 22 M 12 102 H 22" tone="surface" w={3}/></Part>
    <Part name="truck" pivot={[120,149]}>
    <Box x={26} y={40} w={124} h={86} r={RADIUS.md}/>
    <rect x={27} y={96} width={122} height={11} fill={c.paint("accent")}/>
    <path d="M 27 96 H 149 M 27 107 H 149" stroke={c.tokens.ink} strokeWidth={STROKE.fine}/>
    <MiniBox x={72} y={58} s={1.1}/>
    <Shape d="M 150 66 H 186 Q 194 66 198 74 L 216 102 V 126 H 150 Z" tone="accent"/>
    <path d="M 160 76 H 184 L 200 100 H 160 Z" fill={c.paint("glass")} stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
    <Box x={146} y={120} w={74} h={9} r={RADIUS.sm} tone="deep"/>
    <Box x={206} y={106} w={10} h={7} r={2} tone="accent2" rim={false} weight={1.2}/>
    {[56,118,184].map((x,i)=><Part key={x} name="wheel" index={i} pivot={[x,134]}>
      <Orb cx={x} cy={134} r={15} tone="deep"/><Orb cx={x} cy={134} r={6} tone="surface" rim={false}/>
      <path d={`M ${x} ${122} V ${127}`} stroke={c.tokens.highlight} strokeOpacity={.45} strokeWidth={2} strokeLinecap="round"/>
    </Part>)}
    </Part>
  </g>,
  "shipping-box":c=><g>
    <Shadow cx={120} cy={152} rx={78}/>
    <Part name="box" pivot={[120,150]}>
    <path d="M 54 58 L 120 86 V 150 L 54 122 Z" fill={c.paint("accent2")} stroke={c.tokens.ink} strokeWidth={STROKE.outline} strokeLinejoin="round"/>
    <path d="M 120 86 L 186 58 V 122 L 120 150 Z" fill={c.color("accent2",-.22)} stroke={c.tokens.ink} strokeWidth={STROKE.outline} strokeLinejoin="round"/>
    <path d="M 120 30 L 186 58 L 120 86 L 54 58 Z" fill={c.color("accent2",.18)} stroke={c.tokens.ink} strokeWidth={STROKE.outline} strokeLinejoin="round"/>
    <path d="M 80 47 L 146 75 L 160 69 L 94 41 Z" fill={c.color("accent2",.45)} stroke={c.tokens.ink} strokeWidth={STROKE.fine} strokeLinejoin="round"/>
    <path d="M 146 75 V 98 L 160 92 V 69 Z" fill={c.color("accent2",.2)} stroke={c.tokens.ink} strokeWidth={STROKE.fine} strokeLinejoin="round"/>
    <Part name="label" pivot={[82,112]}>
      <path d="M 64 94 L 100 109 V 130 L 64 115 Z" fill={c.paint("surface")} stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
      <path d="M 70 104 L 92 113 M 70 111 L 86 118" stroke={c.tokens.ink} strokeOpacity={.4} strokeWidth={2} strokeLinecap="round"/>
    </Part>
    <Stroke d="M 158 112 V 98 M 154 102 L 158 98 L 162 102 M 170 107 V 93 M 166 97 L 170 93 L 174 97" tone="accent2" level={-.5} w={1.8}/>
    </Part>
  </g>,
  "warehouse":c=><g>
    <Shadow cx={120} cy={152} rx={102}/>
    <Box x={34} y={72} w={172} h={78} r={RADIUS.xs}/>
    <Part name="roof" pivot={[120,78]}>
    <Shape d="M 26 78 Q 120 6 214 78 Z" tone="deep"/>
    {[.2,.35,.5,.65,.8].map(t=>{
      const x=(1-t)**2*26+2*t*(1-t)*120+t*t*214,y=(1-t)**2*78+2*t*(1-t)*6+t*t*78;
      return <path key={t} d={`M ${x} ${y+2} V 76`} stroke={c.tokens.ink} strokeOpacity={.3} strokeWidth={1.2}/>;
    })}
    </Part>
    {/* Roller door: scale-y about its top (y 88) rolls it up. */}
    <Part name="door" pivot={[120,88]}>
      <Box x={84} y={88} w={72} h={62} r={RADIUS.xs} tone="deep"/>
      {[98,108,118,128,138].map(y=><path key={y} d={`M 86 ${y} H 154`} stroke={c.tokens.ink} strokeOpacity={.35} strokeWidth={1.2}/>)}
    </Part>
    <Box x={100} y={80} w={40} h={6} r={3} tone="accent2" rim={false} weight={1.2}/>
    <MiniBox x={40} y={124}/><MiniBox x={46} y={100} s={.9} index={1}/>
    <MiniBox x={168} y={124} index={2}/>
  </g>,
  "factory":c=><g>
    <Shadow cx={120} cy={152} rx={100}/>
    <Part name="smoke" pivot={[170,22]}><Orb cx={170} cy={22} r={9} tone="surface" rim={false} keyline={false}/></Part>
    <Part name="smoke" index={1} pivot={[184,14]}><Orb cx={184} cy={14} r={6} tone="surface" rim={false} keyline={false}/></Part>
    <Part name="chimney" pivot={[169,86]}>
      <Box x={160} y={30} w={18} h={56} r={RADIUS.xs} tone="deep" cylinder rim={false}/>
      <rect x={161} y={40} width={16} height={5} fill={c.color("accent2")}/>
    </Part>
    <Part name="chimney" index={1} pivot={[193,86]}><Box x={186} y={46} w={14} h={40} r={RADIUS.xs} tone="deep" cylinder rim={false}/></Part>
    <Box x={26} y={84} w={188} h={66} r={RADIUS.xs}/>
    {[26,72,118].map(x=><g key={x}>
      <path d={`M ${x} 86 V 50 L ${x+46} 86 Z`} fill={c.paint("deep")} stroke={c.tokens.ink} strokeWidth={STROKE.outline} strokeLinejoin="round"/>
      <path d={`M ${x+3} 55 L ${x+38} 82`} stroke={c.tokens.highlight} strokeOpacity={.3} strokeWidth={1.4}/>
      <rect x={x+2.5} y={56} width={8} height={27} rx={1} fill={c.paint("glass")} stroke={c.tokens.ink} strokeWidth={1.2}/>
      <path d={`M ${x+4} 60 L ${x+9} 58`} stroke={c.tokens.accent} strokeOpacity={.6} strokeWidth={1.4}/>
    </g>)}
    {[40,74,108].map((x,i)=><Screen key={x} x={x} y={100} w={24} h={18} r={RADIUS.xs} glare={false} part="window" partIndex={i}/>)}
    <Part name="door" pivot={[160,150]}><Box x={144} y={110} w={32} h={40} r={RADIUS.xs} tone="deep"/></Part>
    <Part name="gear" pivot={[194,118]}>
      <path d={gearPath(194,118,13,10,9)} fill={c.paint("accent2")} stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
      <circle cx={194} cy={118} r={4} fill={c.paint("surface")} stroke={c.tokens.ink} strokeWidth={1.2}/>
    </Part>
  </g>,
};
function Pin({x,y,index=0}:{x:number;y:number;index?:number}){
  const c=useIllustration();
  // Pivot at the tip: a drop-in translate or a scale lands it on its spot.
  return <Part name="pin" index={index} pivot={[x,y+4]}>
    <path d={`M ${x} ${y+4} C ${x-10} ${y-6} ${x-10} ${y-20} ${x} ${y-20} C ${x+10} ${y-20} ${x+10} ${y-6} ${x} ${y+4} Z`}
      fill={c.paint("accent2")} stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
    <circle cx={x} cy={y-12} r={3} fill={c.tokens.highlight}/>
  </Part>;
}
function BusinessArt({kind}:{kind:BusinessObjectKind}){
  const c=useIllustration();
  const draw=ART[kind];
  if(!draw)throw new Error(`No 2D illustration registered for business kind ${JSON.stringify(kind)}.`);
  return <>{draw(c)}</>;
}
/** Accessible, themeable, frame-addressable business object illustration. */
export const BusinessObject2D=forwardRef<SVGSVGElement,BusinessObject2DProps>(function BusinessObject2D(
  {spec,...props},ref){
  const object=resolveBusinessObject(spec);
  return <DomainIllustration {...props} ref={ref} title={object.title} accent={object.accent}
    state={object.state} semanticId={object.id}
    data={{"data-km-business-object-2d":object.kind,"data-km-archetype":object.archetype}}>
    <BusinessArt kind={object.kind}/>
  </DomainIllustration>;
});
