/** Data-addressable finance/business SVG illustrations composed from the
 * shared `illustration-2d` toolkit. Every semantic kind has its own drawing
 * built on its archetype's sub-assembly (temple, document, card, …).
 * No asset downloads, brand logos, card numbers, fake account data or
 * dependency on Three.js.
 */
import { forwardRef } from "react";
import type { ReactNode } from "react";
import { ILLUSTRATIVE_MARKET_CANDLES, resolveFinanceObject } from "./finance-object-model";
import type { FinanceObjectKind, FinanceObjectSpec, FinancialCandle } from "./finance-object-model";
import {
  Arrow, Badge, Box, CALENDAR_CELLS, CalendarBase, Monitor, calendarCell, Coin, CoinStack, DomainIllustration, Glyph, Icon, Keys, Orb, Part, Person,
  RADIUS, STROKE, Scribble, Screen, Shadow, Shape, Sheet, Stroke, TextRows, arc, useIllustration,
} from "./illustration-2d";
import type { DomainIllustrationProps, IllustrationContextValue, IllustrationTone } from "./illustration-2d";

export interface FinanceObject2DProps extends DomainIllustrationProps {
  spec:FinanceObjectSpec;
  /** Currency mark used by generic cash/coin kinds (1–3 characters). The
   * `dollar` kind always shows "$". */
  currencySymbol?:string;
  /** Second mark for `currency-exchange` (1–3 characters). */
  secondaryCurrencySymbol?:string;
}
interface Art { symbol:string; alt:string; candles:readonly FinancialCandle[] }
type Draw=(o:Art,c:IllustrationContextValue)=>ReactNode;

/* ------------------------------------------------------- sub-assemblies */

function Temple({columns=4,dome=false,emblem}:{columns?:number;dome?:boolean;emblem:ReactNode}){
  const cw=columns>4?10:14,capital=cw+6;
  const xs=Array.from({length:columns},(_,i)=>60+i*(120/(columns-1)));
  return <g>
    <Shadow cx={120} cy={151} rx={98}/>
    <Box x={26} y={139} w={188} h={11} r={RADIUS.xs} tone="deep"/>
    <Box x={36} y={130} w={168} h={10} r={RADIUS.xs}/>
    {xs.map(x=><g key={x}>
      <Box x={x-cw/2} y={82} w={cw} h={48} r={1.5} cylinder rim={false}/>
      <Stroke d={`M ${x} 87 V 125`} opacity={.16} w={STROKE.fine}/>
      <Box x={x-capital/2} y={77} w={capital} h={6} r={1.5} rim={false}/>
      <Box x={x-capital/2} y={125} w={capital} h={6} r={1.5} rim={false}/>
    </g>)}
    <Box x={34} y={66} w={172} h={12} r={2.5}/>
    <Part name="roof" pivot={[120,66]}>{dome?<g>
      <Box x={112} y={13} w={16} h={9} r={RADIUS.xs} tone="accent"/>
      <Shape d="M 80 54 A 40 34 0 0 1 160 54 Z" tone="accent"/>
      <Stroke d="M 100 50 A 22 28 0 0 1 112 26" tone="highlight" opacity={.45} w={2.4}/>
      <Box x={74} y={53} w={92} h={13} r={RADIUS.xs}/>
      {[88,104,120,136,152].map(x=><Stroke key={x} d={`M ${x} 56 V 63`} opacity={.3}/>)}
    </g>:<g>
      <Shape d="M 28 67 L 120 24 L 212 67 Z" tone="accent"/>
      <Stroke d="M 52 61 L 120 32 L 188 61" tone="highlight" opacity={.4} w={1.4}/>
    </g>}</Part>
    {emblem}
  </g>;
}
function AccountPanel({children}:{children:ReactNode}){
  const c=useIllustration();
  return <g>
    <Shadow cx={120} cy={151} rx={84}/>
    <Box x={40} y={26} w={160} h={120} r={RADIUS.lg}/>
    <Part name="header" pivot={[120,40]}>
      <path d="M 50 26 H 190 Q 200 26 200 36 V 54 H 40 V 36 Q 40 26 50 26 Z" fill={c.paint("accent")}
        stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
      <Icon name="bank" cx={58} cy={40} size={8} color={c.tokens.highlight} weight={1.8}/>
      <TextRows x={74} y={35} widths={[56,32]} gap={8} h={3.6} tone="surface" level={1} opacity={.85}/>
    </Part>
    {children}
  </g>;
}
function CardFace({x,y,w=150,h=94,tone="accent",rotate=0,chip=true,index=0,children}:{
  x:number;y:number;w?:number;h?:number;tone?:IllustrationTone;rotate?:number;chip?:boolean;index?:number;children?:ReactNode;
}){
  const c=useIllustration();
  const r=11;
  return <Part name="card" index={index} pivot={[x+w/2,y+h/2]}><g transform={`rotate(${rotate} ${x+w/2} ${y+h/2})`}>
    <Box x={x} y={y} w={w} h={h} r={r} tone={tone}/>
    <path d={`M ${x+w*.42} ${y+h-1} Q ${x+w*.72} ${y+h*.38} ${x+w-1} ${y+h*.22} V ${y+h-r} `+
      `Q ${x+w-1} ${y+h-1} ${x+w-r} ${y+h-1} Z`} fill={c.tokens.highlight} opacity={.1}/>
    {chip?<Part name="chip" pivot={[x+28.5,y+37.5]}>
      <Box x={x+16} y={y+28} w={25} h={19} r={RADIUS.sm} tone="accent2" weight={STROKE.detail}/>
      <Stroke d={`M ${x+24.5} ${y+28} V ${y+47} M ${x+32.5} ${y+28} V ${y+47} M ${x+16} ${y+37.5} H ${x+41}`}
        tone="accent2" level={-.45} w={STROKE.fine}/>
    </Part>:null}
    {children}
  </g></Part>;
}
function CardNumberDots({x,y}:{x:number;y:number}){
  const c=useIllustration();
  return <g fill={c.tokens.highlight} opacity={.82}>
    {Array.from({length:16},(_,i)=><circle key={i} cx={x+i*5.2+Math.floor(i/4)*7} cy={y} r={1.6}/>)}
  </g>;
}
function Doc({x=64,y=18,w=112,h=132,children}:{x?:number;y?:number;w?:number;h?:number;children?:ReactNode}){
  return <g>
    <Shadow cx={x+w/2} cy={y+h+3} rx={w*.58}/>
    <Part name="sheet" pivot={[x+w/2,y+h]}>
      <Sheet x={x} y={y} w={w} h={h} fold={20}/>
      {children}
    </Part>
  </g>;
}
/** Tapered bullion bar in three-quarter view; (x, y) is the front-bottom-left corner. */
function Ingot({x,y,w=78,h=24,taper=8,dx=18,dy=-14,tone="accent2",index=0}:{
  x:number;y:number;w?:number;h?:number;taper?:number;dx?:number;dy?:number;tone?:IllustrationTone;index?:number;
}){
  const c=useIllustration();
  const t=taper,top=y-h;
  const face=(d:string,fill:string)=><path d={d} fill={fill} stroke={c.tokens.ink}
    strokeWidth={STROKE.outline} strokeLinejoin="round"/>;
  return <Part name="ingot" index={index} pivot={[x+w/2,y]}>
    {face(`M ${x+w} ${y} L ${x+w+dx} ${y+dy} L ${x+w-t+dx} ${top+dy} L ${x+w-t} ${top} Z`,c.color(tone,-.3))}
    {face(`M ${x+t} ${top} L ${x+w-t} ${top} L ${x+w-t+dx} ${top+dy} L ${x+t+dx} ${top+dy} Z`,c.color(tone,.28))}
    {face(`M ${x} ${y} L ${x+w} ${y} L ${x+w-t} ${top} L ${x+t} ${top} Z`,c.paint(tone))}
    <Stroke d={`M ${x+t+2} ${top+1.6} H ${x+w-t-2}`} tone="highlight" opacity={.7} w={1.3}/>
    <rect x={x+w*.3} y={top+h*.3} width={w*.4} height={h*.42} rx={1.5} fill="none"
      stroke={c.color(tone,-.34)} strokeWidth={STROKE.fine}/>
    <Stroke d={`M ${x+w*.36} ${top+h*.51} H ${x+w*.64}`} tone={tone} level={-.34} w={STROKE.fine}/>
  </Part>;
}
function Note({x,y,w=120,h=64,symbol,tone="positive",portrait=false,index=0}:{
  x:number;y:number;w?:number;h?:number;symbol?:string;tone?:IllustrationTone;portrait?:boolean;index?:number;
}){
  const c=useIllustration();
  const cx=portrait?x+w*.36:x+w/2,cy=y+h/2,mr=h*.3;
  return <Part name="note" index={index} pivot={[x+w/2,y+h/2]}>
    <Box x={x} y={y} w={w} h={h} r={RADIUS.sm} tone={tone}/>
    <rect x={x+5} y={y+5} width={w-10} height={h-10} rx={2} fill="none"
      stroke={c.color(tone,-.32)} strokeWidth={STROKE.fine}/>
    <path d={`M ${x+8} ${cy+mr*.9} q ${w*.12} ${-h*.24} ${w*.24} 0 t ${w*.24} 0 t ${w*.24} 0 t ${w*.18} -2`}
      fill="none" stroke={c.color(tone,.35)} strokeWidth={1} opacity={.7}/>
    <circle cx={cx} cy={cy} r={mr} fill={c.color(tone,.22)} stroke={c.color(tone,-.36)} strokeWidth={STROKE.fine}/>
    {portrait?<g fill={c.color(tone,-.3)}>
      <circle cx={cx} cy={cy-mr*.22} r={mr*.32}/>
      <path d={`M ${cx-mr*.62} ${cy+mr*.72} Q ${cx} ${cy-mr*.1} ${cx+mr*.62} ${cy+mr*.72} Z`}/>
    </g>:symbol?<Glyph x={cx} y={cy} size={mr*1.35} fill={c.color(tone,-.45)}>{symbol}</Glyph>:null}
    {symbol?<>
      <Glyph x={x+12} y={y+13} size={9} fill={c.color(tone,-.45)}>{symbol}</Glyph>
      <Glyph x={x+w-12} y={y+h-13} size={9} fill={c.color(tone,-.45)}>{symbol}</Glyph>
    </>:null}
    {portrait?<Orb cx={x+w*.76} cy={cy} r={mr*.62} tone={tone} rim={false} weight={STROKE.fine}/>:null}
  </Part>;
}
function ChartPanel({children}:{children:ReactNode}){
  const c=useIllustration();
  return <g>
    <Shadow cx={120} cy={152} rx={92}/>
    <Box x={32} y={28} w={176} h={120} r={RADIUS.lg}/>
    {[56,80,104,128].map(y=><path key={y} d={`M 46 ${y} H 194`} stroke={c.tokens.ink} opacity={.1} strokeWidth={1}/>)}
    <Stroke d="M 46 40 V 136 H 196" opacity={.55}/>
    {children}
  </g>;
}
function CandlePlot({x,y,w,h,candles}:{x:number;y:number;w:number;h:number;candles:readonly FinancialCandle[]}){
  const c=useIllustration();
  const lo=Math.min(...candles.map(k=>k.low)),hi=Math.max(...candles.map(k=>k.high));
  const span=hi-lo||1,step=w/candles.length,bw=Math.max(2.5,step*.56);
  const py=(v:number)=>y+h*(1-(v-lo)/span);
  return <Part name="candles" pivot={[x+w/2,y+h]}><g data-km-candles={candles.length}>{candles.map((k,i)=>{
    const cx=x+step*(i+.5),up=k.close>=k.open;
    const top=py(Math.max(k.open,k.close)),bottom=py(Math.min(k.open,k.close));
    const tone=up?"positive":"negative";
    return <g key={i}>
      <path d={`M ${cx} ${py(k.high)} V ${py(k.low)}`} stroke={c.color(tone,-.1)} strokeWidth={STROKE.fine} strokeLinecap="round"/>
      <rect x={cx-bw/2} y={top} width={bw} height={Math.max(1.5,bottom-top)} rx={.8}
        fill={c.paint(tone)} stroke={c.tokens.ink} strokeWidth={.8}/>
    </g>;
  })}</g></Part>;
}
function House({x=0,y=0,s=1}:{x?:number;y?:number;s?:number}){
  return <g transform={`translate(${x} ${y}) scale(${s})`}><Part name="house" pivot={[120,148]}>
    <Part name="chimney" pivot={[154,64]}><Box x={146} y={30} w={16} h={34} r={RADIUS.xs} tone="deep"/></Part>
    <Box x={52} y={78} w={136} h={70} r={RADIUS.xs}/>
    <Part name="roof" pivot={[120,90]}>
      <Shape d="M 34 84 L 120 22 L 206 84 Q 209 90 202 90 L 38 90 Q 31 90 34 84 Z" tone="accent"/>
      <Stroke d="M 58 78 L 120 34 L 182 78" tone="highlight" opacity={.35} w={1.4}/>
    </Part>
    <Part name="door" pivot={[104,126]}>
      <Box x={104} y={104} w={32} h={44} r={RADIUS.sm} tone="deep"/>
      <Orb cx={128} cy={127} r={2.4} tone="accent2" rim={false} weight={1}/>
    </Part>
    <Screen x={64} y={100} w={28} h={26} r={RADIUS.xs} part="window"/>
    <Screen x={148} y={100} w={28} h={26} r={RADIUS.xs} part="window" partIndex={1}/>
  </Part></g>;
}
function Shop({w=160,awning="accent",children}:{w?:number;awning?:IllustrationTone;children?:ReactNode}){
  const c=useIllustration();
  const x=120-w/2,stripes=8,sw=w/stripes;
  return <g>
    <Shadow cx={120} cy={151} rx={w*.6}/>
    <Box x={x+6} y={58} w={w-12} h={92} r={RADIUS.xs}/>
    <Part name="sign" pivot={[120,33]}><Box x={x+2} y={24} w={w-4} h={18} r={RADIUS.sm} tone="deep"/></Part>
    <Part name="awning" pivot={[120,42]}>{Array.from({length:stripes},(_,i)=><path key={i}
      d={`M ${x+i*sw} 42 H ${x+(i+1)*sw} V 58 A ${sw/2} ${sw/2.4} 0 0 1 ${x+i*sw} 58 Z`}
      fill={i%2?c.paint("surface"):c.paint(awning)} stroke={c.tokens.ink} strokeWidth={STROKE.detail}
      strokeLinejoin="round"/>)}</Part>
    {children}
  </g>;
}
function Tower({x,y,w,h,tone="glass",cols=3,index=0}:{x:number;y:number;w:number;h:number;tone?:"glass"|"surface"|"deep";cols?:number;index?:number}){
  const c=useIllustration();
  const rows=Math.floor((h-12)/12);
  return <Part name="tower" index={index} pivot={[x+w/2,y+h]}>
    {tone==="glass"?<Screen x={x} y={y} w={w} h={h} r={RADIUS.xs} part={false}/>:<Box x={x} y={y} w={w} h={h} r={RADIUS.xs} tone={tone}/>}
    {Array.from({length:rows*cols},(_,i)=>{
      const cw=(w-8)/cols;
      return <rect key={i} x={x+4+(i%cols)*cw+1.5} y={y+8+Math.floor(i/cols)*12} width={cw-3} height={7} rx={1}
        fill={tone==="glass"?c.tokens.accent:c.paint("glass")} opacity={tone==="glass"?.32:.85}/>;
    })}
  </Part>;
}
function Shield({tone="accent",icon}:{tone?:IllustrationTone;icon:"check"|"alert"}){
  const c=useIllustration();
  return <g>
    <Shadow cx={120} cy={154} rx={56}/>
    <Part name="shield" pivot={[120,156]}>
      <Shape d="M 120 18 L 184 42 V 88 Q 180 128 120 156 Q 60 128 56 88 V 42 Z" tone={tone}/>
      <path d="M 120 30 L 172 50 V 88 Q 169 120 120 143 Z" fill={c.color(tone,-.18)} opacity={.55}/>
      <Stroke d="M 120 30 L 68 50 V 88 Q 70 108 92 125" tone="highlight" opacity={.4} w={1.6}/>
      <Part name="check" pivot={[120,88]}>{icon==="check"
        ?<Stroke d="M 94 86 L 113 105 L 148 68" tone="highlight" w={9}/>
        :<g><Stroke d="M 120 58 V 98" tone="highlight" w={9}/><circle cx={120} cy={118} r={5.5} fill={c.tokens.highlight}/></g>}</Part>
    </Part>
  </g>;
}
function Tile({x,y,w=56,h=56,icon,tone="surface",iconTone="accent",index=0}:{
  x:number;y:number;w?:number;h?:number;icon:Parameters<typeof Icon>[0]["name"];tone?:IllustrationTone;iconTone?:IllustrationTone;index?:number;
}){
  const c=useIllustration();
  return <Part name="endpoint" index={index} pivot={[x+w/2,y+h/2]}>
    <Box x={x} y={y} w={w} h={h} r={RADIUS.lg} tone={tone}/>
    <Icon name={icon} cx={x+w/2} cy={y+h/2} size={w*.3} color={c.color(iconTone,-.1)} weight={3}/>
  </Part>;
}
function Head({tone,horns=false}:{tone:IllustrationTone;horns?:boolean}){
  const c=useIllustration();
  return horns?<Part name="head" pivot={[120,144]}>
    <Part name="horn" pivot={[82,62]}><Shape d="M 78 70 Q 42 64 30 30 Q 52 50 84 52 Z" tone="surface"/></Part>
    <Part name="horn" index={1} pivot={[158,62]}><Shape d="M 162 70 Q 198 64 210 30 Q 188 50 156 52 Z" tone="surface"/></Part>
    <Shape d="M 66 66 L 50 76 Q 60 88 76 84 Z" tone={tone}/>
    <Shape d="M 174 66 L 190 76 Q 180 88 164 84 Z" tone={tone}/>
    <Shape d="M 80 50 Q 120 38 160 50 L 156 104 Q 150 140 120 144 Q 90 140 84 104 Z" tone={tone}/>
    <Shape d="M 96 112 Q 120 102 144 112 Q 150 134 120 140 Q 90 134 96 112 Z" tone="surface" fill={c.color(tone,.35)}/>
    <ellipse cx={110} cy={124} rx={3.4} ry={4.4} fill={c.tokens.ink}/>
    <ellipse cx={130} cy={124} rx={3.4} ry={4.4} fill={c.tokens.ink}/>
    <path d="M 108 136 Q 120 148 132 136" fill="none" stroke={c.color("accent2")} strokeWidth={3.4} strokeLinecap="round"/>
    <circle cx={102} cy={82} r={4.6} fill={c.tokens.ink}/><circle cx={138} cy={82} r={4.6} fill={c.tokens.ink}/>
    <circle cx={103.6} cy={80.6} r={1.4} fill={c.tokens.highlight}/><circle cx={139.6} cy={80.6} r={1.4} fill={c.tokens.highlight}/>
  </Part>:<Part name="head" pivot={[120,144]}>
    <Part name="ear" pivot={[86,62]}><Orb cx={78} cy={50} r={17} tone={tone}/><circle cx={78} cy={50} r={8} fill={c.color(tone,.3)}/></Part>
    <Part name="ear" index={1} pivot={[154,62]}><Orb cx={162} cy={50} r={17} tone={tone}/><circle cx={162} cy={50} r={8} fill={c.color(tone,.3)}/></Part>
    <Orb cx={120} cy={92} r={56} ry={52} tone={tone}/>
    <Orb cx={120} cy={114} r={26} ry={20} tone="surface" rim={false}/>
    <path d="M 111 104 Q 120 98 129 104 Q 126 112 120 112 Q 114 112 111 104 Z" fill={c.tokens.ink}/>
    <path d="M 120 112 V 120 M 110 124 Q 120 130 130 124" fill="none" stroke={c.tokens.ink} strokeWidth={2.2} strokeLinecap="round"/>
    <circle cx={98} cy={82} r={5} fill={c.tokens.ink}/><circle cx={142} cy={82} r={5} fill={c.tokens.ink}/>
    <circle cx={99.6} cy={80.4} r={1.5} fill={c.tokens.highlight}/><circle cx={143.6} cy={80.4} r={1.5} fill={c.tokens.highlight}/>
  </Part>;
}

/* ---------------------------------------------------------------- kinds */

const temple:Draw=o=><Temple emblem={<Coin cx={120} cy={50} r={10} depth={2} symbol={o.symbol}/>}/>;
const ART:Record<FinanceObjectKind,Draw>={
  "bank":temple,
  "bank-branch":(_o,c)=><g>
    <Shadow cx={120} cy={151} rx={92}/>
    <Box x={42} y={60} w={156} h={88} r={RADIUS.xs}/>
    <Box x={34} y={50} w={172} h={13} r={RADIUS.sm} tone="deep"/>
    <Part name="sign" pivot={[120,50]}>
      <Box x={80} y={28} w={80} h={22} r={RADIUS.md} tone="accent"/>
      <Icon name="bank" cx={96} cy={39} size={7} color={c.tokens.highlight} weight={1.8}/>
      <TextRows x={108} y={34} widths={[42,28]} gap={7} h={3.4} tone="surface" level={1} opacity={.85}/>
    </Part>
    <Screen x={54} y={76} w={42} h={42} r={RADIUS.xs} part="window"/>
    <Screen x={144} y={76} w={42} h={42} r={RADIUS.xs} part="window" partIndex={1}/>
    <Part name="door" pivot={[120,148]}>
      <Screen x={104} y={88} w={32} h={60} r={RADIUS.xs} part={false}/>
      <path d="M 120 89 V 147" stroke={c.tokens.ink} strokeWidth={STROKE.detail}/>
    </Part>
    <Part name="slot" pivot={[75,136]}>
      <Box x={60} y={126} w={30} h={20} r={RADIUS.xs} tone="deep"/>
      <Box x={66} y={130} w={18} h={6} r={1} tone="glass" rim={false}/>
    </Part>
  </g>,
  "investment-bank":()=><g>
    <Temple columns={6} dome emblem={null}/>
    <Badge cx={196} cy={36} r={15} tone="positive" icon="trend-up"/>
  </g>,
  "bank-account":()=><AccountPanel>
    <TextRows x={56} y={68} widths={[40]} h={3.4}/>
    <TextRows x={56} y={77} widths={[86]} h={10} opacity={.78}/>
    <Stroke d="M 56 100 H 184" opacity={.18}/>
    {[108,120,132].map(y=><g key={y}>
      <TextRows x={56} y={y} widths={[60]} h={3.6}/>
      <TextRows x={184} y={y} widths={[24]} h={3.6} align="end"/>
    </g>)}
  </AccountPanel>,
  "checking-account":()=><AccountPanel>
    {[66,86,106,126].map((y,i)=>{
      const tone=i===1?"negative":"positive";
      return <g key={y}>
        <Badge cx={63} cy={y+5} r={7} tone={tone} icon={i===1?"down":"up"} partIndex={i}/>
        <TextRows x={78} y={y+3} widths={[62-i*6]} h={4}/>
        <TextRows x={184} y={y+3} widths={[26]} h={4} align="end" opacity={.6}/>
      </g>;
    })}
  </AccountPanel>,
  "savings-account":()=><AccountPanel>
    <CoinStack cx={72} base={136} count={2} w={26}/>
    <CoinStack cx={104} base={136} count={4} w={26} partIndex={1}/>
    <CoinStack cx={136} base={136} count={6} w={26} partIndex={2}/>
    <Arrow d="M 62 100 Q 104 96 150 68" head="M 156 60 L 158 76 L 145 70 Z" tone="positive" w={4}/>
    <Badge cx={176} cy={116} r={14} tone="accent2" icon="percent"/>
  </AccountPanel>,
  "credit-card":(_o,c)=><g>
    <Shadow cx={120} cy={150} rx={88}/>
    <CardFace x={66} y={30} tone="deep" rotate={9} chip={false}/>
    <CardFace x={42} y={52} rotate={-5} index={1}>
      <Part name="signal" pivot={[170,86]}><Icon name="contactless" cx={170} cy={86} size={8} color={c.tokens.highlight} weight={2}/></Part>
      <CardNumberDots x={58} y={116}/>
      <TextRows x={58} y={127} widths={[46]} h={3.4} tone="surface" level={1} opacity={.6}/>
    </CardFace>
  </g>,
  "debit-card":(_o,c)=><g>
    <Shadow cx={120} cy={148} rx={84}/>
    <CardFace x={45} y={40} w={150} h={94} tone="deep">
      <path d="M 46 104 H 194" stroke={c.tokens.shadow} strokeOpacity={.14} strokeWidth={14}/>
      <CardNumberDots x={61} y={104}/>
      <TextRows x={61} y={118} widths={[50]} h={3.4} tone="surface" level={1} opacity={.6}/>
    </CardFace>
    <Badge cx={190} cy={132} r={15} tone="accent" icon="bank"/>
  </g>,
  "gift-card":(_o,c)=><g>
    <Shadow cx={120} cy={148} rx={84}/>
    <CardFace x={45} y={42} tone="accent2" chip={false}>
      <rect x={136} y={43} width={14} height={92} fill={c.paint("negative")}/>
      <rect x={46} y={80} width={148} height={13} fill={c.paint("negative")}/>
      <path d="M 136 43 V 135 M 150 43 V 135 M 46 80 H 194 M 46 93 H 194" stroke={c.tokens.ink} strokeWidth={STROKE.fine} opacity={.5}/>
    </CardFace>
    <Part name="ribbon" pivot={[143,86]}>
      <Shape d="M 143 86 C 120 60 112 80 124 88 C 112 96 120 108 143 86 Z" tone="negative"/>
      <Shape d="M 143 86 C 166 60 174 80 162 88 C 174 96 166 108 143 86 Z" tone="negative"/>
      <Orb cx={143} cy={86} r={6} tone="negative"/>
    </Part>
    <TextRows x={60} y={112} widths={[48,30]} gap={8} h={3.6} tone="ink" opacity={.4}/>
  </g>,
  "atm":(_o,c)=><g>
    <Shadow cx={120} cy={152} rx={78}/>
    <Box x={58} y={30} w={124} h={120} r={RADIUS.md} tone="deep"/>
    <Box x={50} y={20} w={140} h={16} r={RADIUS.sm}/>
    <Screen x={70} y={44} w={64} h={44}>
      <TextRows x={78} y={53} widths={[34,46,26]} gap={9} h={3.6} tone="accent" opacity={.9}/>
    </Screen>
    <Keys x={144} y={46} cols={1} rows={4} kw={22} kh={7} gap={4}/>
    <Keys x={78} y={96} cols={3} rows={3} kw={13} kh={8} gap={3.5} accent={[8]} accentTone="positive" partIndex={1}/>
    <Part name="slot" pivot={[155,102]}>
      <Box x={140} y={98} w={30} h={8} r={RADIUS.xs} tone="ink" rim={false}/>
      <rect x={146} y={101} width={18} height={2} rx={1} fill={c.tokens.accent}/>
    </Part>
    <Part name="cash" pivot={[120,138]}><Box x={92} y={128} w={56} h={14} r={RADIUS.xs} tone="positive" weight={STROKE.detail}/></Part>
    <Box x={76} y={138} w={88} h={8} r={RADIUS.xs} tone="ink" rim={false}/>
  </g>,
  "payment-terminal":(_o,c)=><g>
    <Shadow cx={120} cy={154} rx={56}/>
    <CardFace x={88} y={14} w={64} h={40} chip={false}/>
    <Box x={78} y={36} w={84} h={116} r={RADIUS.xl} tone="deep"/>
    <Box x={92} y={34} w={56} h={6} r={3} tone="ink" rim={false}/>
    <Screen x={90} y={50} w={60} h={38}>
      <circle cx={120} cy={69} r={10} fill={c.paint("positive")}/>
      <Icon name="check" cx={120} cy={69} size={6} color={c.tokens.highlight} weight={2.4}/>
    </Screen>
    <Keys x={93} y={96} cols={3} rows={4} kw={15} kh={8} gap={3.5} accent={[11]} accentTone="positive"/>
    <Part name="signal" pivot={[176,64]}><Icon name="contactless" cx={176} cy={64} size={9} color={c.tokens.accent} weight={2.6}/></Part>
  </g>,
  "cash-register":()=><g>
    <Shadow cx={120} cy={152} rx={94}/>
    <Part name="drawer" pivot={[120,134]}>
      <Box x={34} y={118} w={172} h={32} r={RADIUS.sm} tone="deep"/>
      <Box x={104} y={130} w={32} h={6} r={3} tone="accent2" rim={false}/>
    </Part>
    <Shape d="M 46 119 L 60 70 H 180 L 194 119 Z" tone="surface"/>
    <Keys x={70} y={82} cols={6} rows={2} kw={13} kh={8} gap={4} accent={[5,11]} accentTone="accent"/>
    <Box x={66} y={56} w={42} h={16} r={RADIUS.sm}/>
    <Part name="paper" pivot={[87,57]}>
      <Shape d="M 74 57 V 30 L 78 34 L 82 30 L 86 34 L 90 30 L 94 34 L 98 30 L 100 33 V 57 Z" tone="surface"/>
      <TextRows x={79} y={40} widths={[16,12,16]} gap={5} h={2.4}/>
    </Part>
    <Box x={150} y={44} w={8} h={28} r={2} tone="deep" cylinder rim={false}/>
    <Screen x={130} y={24} w={48} h={22}>
      <TextRows x={138} y={33} widths={[32]} h={4} tone="accent" opacity={.95}/>
    </Screen>
  </g>,
  "loan":(o,c)=><Doc>
    <TextRows x={78} y={34} widths={[58]} h={6} tone="accent" opacity={.9}/>
    <TextRows x={78} y={52} widths={[82,70,76,40]} gap={10}/>
    <Box x={78} y={98} w={42} h={18} r={RADIUS.sm} tone="surface" rim={false} weight={STROKE.detail}/>
    <Icon name="percent" cx={99} cy={107} size={5.4} color={c.tokens.ink} weight={1.8}/>
    <Coin cx={164} cy={124} r={22} symbol={o.symbol}/>
    <Arrow d="M 128 148 Q 104 152 98 126" head="M 92 130 L 98 118 L 106 128 Z" tone="accent" w={3.6}/>
  </Doc>,
  "loan-agreement":o=><Doc>
    <TextRows x={78} y={34} widths={[64]} h={6} tone="accent" opacity={.9}/>
    <TextRows x={78} y={50} widths={[84,78,84,62]} gap={9}/>
    <Part name="signature" pivot={[80,118]}><Scribble x={80} y={118} w={30} tone="accent"/></Part>
    <Part name="signature" index={1} pivot={[128,118]}><Scribble x={128} y={118} w={30} tone="ink"/></Part>
    <Stroke d="M 78 124 H 114 M 126 124 H 162" opacity={.4} w={STROKE.fine}/>
    <Coin cx={164} cy={36} r={13} depth={2.5} symbol={o.symbol}/>
  </Doc>,
  "contract":(_o,c)=><Doc>
    <TextRows x={78} y={34} widths={[56]} h={6} tone="ink" opacity={.62}/>
    <TextRows x={78} y={50} widths={[84,80,84,70,84]} gap={9}/>
    <Part name="signature" pivot={[80,124]}><Scribble x={80} y={124} w={40} tone="accent"/></Part>
    <Stroke d="M 78 130 H 128" opacity={.4} w={STROKE.fine}/>
    <Part name="seal" pivot={[153,120]}>
    <Shape d="M 146 128 L 140 152 L 148 147 L 153 155 L 156 130 Z" tone="negative" weight={STROKE.detail}/>
    <Shape d="M 160 128 L 166 152 L 158 147 L 153 155 L 150 130 Z" tone="negative" weight={STROKE.detail}/>
    <path d={Array.from({length:16},(_,i)=>{const a=i*Math.PI/8,rr=i%2?13:16;
      return `${i?"L":"M"} ${153+rr*Math.cos(a)} ${120+rr*Math.sin(a)}`;}).join(" ")+" Z"}
      fill={c.paint("accent2")} stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
    <circle cx={153} cy={120} r={8} fill="none" stroke={c.color("accent2",-.35)} strokeWidth={1.4}/>
    </Part>
  </Doc>,
  "invoice":(_o,c)=><Doc>
    <Box x={78} y={30} w={18} h={18} r={RADIUS.sm} tone="accent"/>
    <TextRows x={102} y={32} widths={[36,24]} gap={8} h={4}/>
    <rect x={76} y={58} width={88} height={11} rx={2} fill={c.color("accent",.2)} opacity={.5}/>
    {[62,78,90,102].map((y,i)=><g key={y}>
      <TextRows x={80} y={y} widths={[i?42:30]} h={3.4} opacity={i?.42:.6}/>
      <TextRows x={160} y={y} widths={[18]} h={3.4} align="end" opacity={i?.42:.6}/>
    </g>)}
    <Stroke d="M 76 112 H 164" opacity={.3}/>
    <Part name="total" pivot={[138,126]}>
      <Box x={110} y={118} w={56} h={16} r={RADIUS.sm} tone="accent" rim={false} weight={STROKE.detail}/>
      <TextRows x={118} y={124} widths={[40]} h={4} tone="surface" level={1} opacity={.9}/>
    </Part>
  </Doc>,
  "receipt":(_o,c)=>{
    const teeth=Array.from({length:9},(_,i)=>`L ${160-i*8-4} 146 L ${160-(i+1)*8} 140`).join(" ");
    return <g>
      <Shadow cx={120} cy={152} rx={46}/>
      <Part name="paper" pivot={[124,20]}>
      <path d={`M 88 20 H 160 V 140 ${teeth} Z`}
        fill={c.paint("surface")} stroke={c.tokens.ink} strokeWidth={STROKE.outline} strokeLinejoin="round"/>
      <TextRows x={104} y={32} widths={[40]} h={4} opacity={.6}/>
      {[46,56,66,76,86].map(y=><g key={y}>
        <TextRows x={98} y={y} widths={[26]} h={3}/>
        <TextRows x={150} y={y} widths={[14]} h={3} align="end"/>
      </g>)}
      <path d="M 96 98 H 152" stroke={c.tokens.ink} strokeWidth={1.2} strokeDasharray="3 3" opacity={.4}/>
      <TextRows x={98} y={106} widths={[22]} h={5} opacity={.7}/>
      <TextRows x={150} y={106} widths={[22]} h={5} align="end" opacity={.7}/>
      <Part name="barcode" pivot={[124,126]}><g fill={c.tokens.ink} opacity={.5}>{[0,3,5,9,11,14,18,20,23,27,29,32,36,38,41,45].map((dx,i)=>
        <rect key={i} x={100+dx} y={120} width={i%3?1.4:2.4} height={12}/>)}</g></Part>
      </Part>
      <Box x={84} y={14} w={80} h={10} r={5} tone="deep"/>
    </g>;
  },
  "tax-return":(_o,c)=><Doc>
    <TextRows x={78} y={32} widths={[50]} h={6} tone="ink" opacity={.62}/>
    {[48,68,88].map(y=><g key={y}>
      <rect x={78} y={y} width={38} height={14} rx={2} fill="none" stroke={c.tokens.ink} strokeOpacity={.4} strokeWidth={1.2}/>
      <rect x={122} y={y} width={40} height={14} rx={2} fill="none" stroke={c.tokens.ink} strokeOpacity={.4} strokeWidth={1.2}/>
      <TextRows x={82} y={y+5} widths={[20]} h={3}/>
    </g>)}
    {[110,122].map((y,i)=><g key={y}>
      <rect x={78} y={y} width={8} height={8} rx={1.5} fill={c.paint("surface")} stroke={c.tokens.ink} strokeWidth={1.2}/>
      {i===0?<Part name="check" pivot={[82,y+4]}><Stroke d={`M 79.5 ${y+4} L 82 ${y+6.5} L 86.5 ${y+1}`} tone="accent" w={1.8}/></Part>:null}
      <TextRows x={92} y={y+2.5} widths={[40]} h={3}/>
    </g>)}
    <Part name="stamp" pivot={[156,126]}><g transform="rotate(-14 156 126)">
      <circle cx={156} cy={126} r={17} fill={c.color("negative",.1)} opacity={.16}/>
      <circle cx={156} cy={126} r={17} fill="none" stroke={c.color("negative")} strokeWidth={2.4}/>
      <circle cx={156} cy={126} r={12.5} fill="none" stroke={c.color("negative")} strokeWidth={1.2}/>
      <Icon name="percent" cx={156} cy={126} size={7} color={c.color("negative")} weight={2}/>
    </g></Part>
  </Doc>,
  "insurance-policy":(_o,c)=><Doc>
    <Part name="shield" pivot={[120,72]}>
      <path d="M 120 30 L 140 38 V 52 Q 138 64 120 72 Q 102 64 100 52 V 38 Z" fill={c.paint("accent")}
        stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
      <Stroke d="M 111 51 L 118 58 L 130 45" tone="highlight" w={3}/>
    </Part>
    <TextRows x={84} y={82} widths={[72]} h={5} opacity={.6}/>
    <TextRows x={80} y={96} widths={[80,76,80,52]} gap={9}/>
    <Part name="signature" pivot={[124,140]}><Scribble x={124} y={140} w={28} tone="accent"/></Part>
  </Doc>,
  "dollar":()=><g>
    <Shadow cx={120} cy={146} rx={86}/>
    <g transform="rotate(-4 120 92)"><Note x={44} y={50} w={152} h={84} symbol="$" portrait/></g>
  </g>,
  "banknote":o=><g>
    <Shadow cx={120} cy={146} rx={86}/>
    <g transform="rotate(5 120 80)"><Note x={50} y={34} w={146} h={78} tone="positive" /></g>
    <g transform="rotate(-3 120 100)"><Note x={44} y={58} w={152} h={82} symbol={o.symbol} index={1}/></g>
  </g>,
  "cash-stack":(o,c)=><g>
    <Shadow cx={120} cy={150} rx={92}/>
    <Part name="stack" pivot={[120,144]}>
      {[0,1,2,3,4].map(i=><Box key={i} x={40} y={124-i*9} w={160} h={20} r={RADIUS.sm} tone="positive" rim={false}
        weight={STROKE.detail}/>)}
      {[0,1,2,3,4].map(i=><path key={"e"+i} d={`M 44 ${136-i*9} H 196`} stroke={c.color("positive",-.3)} strokeWidth={1}/>)}
    </Part>
    <Note x={40} y={50} w={160} h={66} symbol={o.symbol}/>
    <Part name="band" pivot={[120,95]}><Box x={104} y={46} w={32} h={98} r={RADIUS.xs} tone="accent2" weight={STROKE.detail}/></Part>
  </g>,
  "coin":o=><g>
    <Shadow cx={120} cy={150} rx={56}/>
    <Coin cx={120} cy={86} r={54} depth={8} symbol={o.symbol}/>
    <Sparkle x={174} y={40} s={9}/>
  </g>,
  "coins":o=><g>
    <Shadow cx={120} cy={150} rx={92}/>
    <CoinStack cx={62} base={146} count={4} w={44}/>
    <CoinStack cx={176} base={146} count={6} w={44} partIndex={1}/>
    <CoinStack cx={118} base={146} count={2} w={44} partIndex={2}/>
    <Coin cx={118} cy={96} r={30} depth={5} symbol={o.symbol}/>
  </g>,
  "gold-bars":()=><g>
    <Shadow cx={124} cy={146} rx={94}/>
    <Ingot x={30} y={146}/>
    <Ingot x={116} y={146} index={1}/>
    <Ingot x={73} y={115} index={2}/>
    <Sparkle x={186} y={58} s={9}/>
  </g>,
  "interest":o=><g>
    <Shadow cx={120} cy={150} rx={88}/>
    <CoinStack cx={80} base={146} count={4} w={48}/>
    <CoinStack cx={140} base={146} count={7} w={48} partIndex={1}/>
    <Coin cx={80} cy={66} r={22} depth={4} symbol={o.symbol}/>
    <Arrow d="M 64 40 Q 120 10 178 46" head="M 186 40 L 182 56 L 170 46 Z" tone="positive" w={4}/>
    <Badge cx={186} cy={86} r={16} tone="accent" icon="percent"/>
  </g>,
  "wallet":(o,c)=><g>
    <Shadow cx={120} cy={152} rx={86}/>
    <g transform="rotate(-8 100 50)"><Note x={58} y={30} w={96} h={50} symbol={o.symbol}/></g>
    <CardFace x={98} y={30} w={86} h={54} rotate={10} chip={false}/>
    <Part name="body" pivot={[120,150]}>
      <Box x={38} y={58} w={164} h={92} r={RADIUS.xl} tone="deep"/>
      <rect x={45} y={65} width={150} height={78} rx={12} fill="none" stroke={c.tokens.highlight} strokeOpacity={.28}
        strokeWidth={1.2} strokeDasharray="4 3"/>
    </Part>
    <Part name="flap" pivot={[212,105]}>
      <Box x={132} y={82} w={80} h={46} r={RADIUS.lg} tone="deep"/>
      <Part name="clasp" pivot={[156,105]}><Orb cx={156} cy={105} r={8} tone="accent2"/></Part>
    </Part>
  </g>,
  "piggy-bank":(o,c)=><g>
    <Shadow cx={118} cy={154} rx={78}/>
    <Part name="body" pivot={[118,152]}>
    <Part name="leg" pivot={[85,128]}><Box x={76} y={128} w={18} h={24} r={RADIUS.sm} tone="accent"/></Part>
    <Part name="leg" index={1} pivot={[149,128]}><Box x={140} y={128} w={18} h={24} r={RADIUS.sm} tone="accent"/></Part>
    <Part name="tail" pivot={[46,92]}><Stroke d="M 46 92 q -14 -4 -10 -14 q 6 -8 10 2" tone="accent" level={-.2} w={4}/></Part>
    <Part name="ear" pivot={[84,58]}><Shape d="M 72 62 L 66 32 L 96 50 Z" tone="accent"/></Part>
    <Orb cx={116} cy={96} r={72} ry={50} tone="accent"/>
    <Part name="ear" index={1} pivot={[143,60]}>
      <Shape d="M 132 56 Q 136 34 146 28 Q 158 44 154 62 Z" tone="accent"/>
      <path d="M 138 54 Q 141 40 146 35 Q 152 46 150 58 Z" fill={c.color("accent",-.25)}/>
    </Part>
    <Orb cx={190} cy={104} r={17} ry={15} tone="accent"/>
    <ellipse cx={185} cy={104} rx={2.6} ry={3.6} fill={c.tokens.ink} opacity={.6}/>
    <ellipse cx={195} cy={104} rx={2.6} ry={3.6} fill={c.tokens.ink} opacity={.6}/>
    <circle cx={158} cy={78} r={4.6} fill={c.tokens.ink}/>
    <circle cx={159.6} cy={76.6} r={1.4} fill={c.tokens.highlight}/>
    <Part name="slot" pivot={[117,51]}><Box x={98} y={48} w={38} h={7} r={3.5} tone="ink" rim={false}/></Part>
    </Part>
    <Coin cx={117} cy={30} r={15} depth={3} symbol={o.symbol}/>
  </g>,
  "safe":(_o,c)=><g>
    <Shadow cx={120} cy={154} rx={78}/>
    <Box x={62} y={140} w={16} h={12} r={2} tone="ink" rim={false}/>
    <Box x={162} y={140} w={16} h={12} r={2} tone="ink" rim={false}/>
    <Box x={50} y={24} w={140} h={120} r={RADIUS.lg} tone="deep"/>
    <Part name="door" pivot={[58,84]}>
    <Box x={60} y={34} w={112} h={100} r={RADIUS.md} tone="surface"/>
    <Box x={54} y={50} w={8} h={20} r={2} tone="deep"/><Box x={54} y={98} w={8} h={20} r={2} tone="deep"/>
    <Part name="dial" pivot={[108,84]}>
    <Orb cx={108} cy={84} r={26} tone="deep"/>
    <Orb cx={108} cy={84} r={16} tone="surface"/>
    {Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;
      return <path key={i} d={`M ${108+20*Math.cos(a)} ${84+20*Math.sin(a)} L ${108+24*Math.cos(a)} ${84+24*Math.sin(a)}`}
        stroke={c.tokens.highlight} strokeWidth={1.4} opacity={.7}/>;})}
    <path d="M 108 72 V 80" stroke={c.color("accent2",-.1)} strokeWidth={2.4} strokeLinecap="round"/>
    </Part>
    <Part name="handle" pivot={[155,85]}><Box x={150} y={68} w={10} h={34} r={5} tone="accent2" cylinder/></Part>
    </Part>
  </g>,
  "vault":(_o,c)=><g>
    <Shadow cx={120} cy={154} rx={86}/>
    <Box x={36} y={20} w={168} h={134} r={RADIUS.lg} tone="deep"/>
    <Box x={186} y={58} w={14} h={22} r={2} tone="surface"/><Box x={186} y={96} w={14} h={22} r={2} tone="surface"/>
    <Part name="door" pivot={[193,87]}>
    <Orb cx={118} cy={87} r={58} tone="surface"/>
    <Orb cx={118} cy={87} r={46} tone="surface"/>
    {Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;
      return <Orb key={i} cx={118+52*Math.cos(a)} cy={87+52*Math.sin(a)} r={2.4} tone="deep" rim={false} weight={1}/>;})}
    <Part name="wheel" pivot={[118,87]}>
    <circle cx={118} cy={87} r={30} fill="none" stroke={c.tokens.ink} strokeWidth={STROKE.outline+5}/>
    <circle cx={118} cy={87} r={30} fill="none" stroke={c.color("accent2")} strokeWidth={5}/>
    {[0,60,120].map(a=><g key={a} transform={`rotate(${a} 118 87)`}>
      <path d="M 82 87 H 154" stroke={c.tokens.ink} strokeWidth={8.4} strokeLinecap="round"/>
      <path d="M 82 87 H 154" stroke={c.color("accent2")} strokeWidth={5} strokeLinecap="round"/>
    </g>)}
    <Orb cx={118} cy={87} r={10} tone="accent2"/>
    </Part>
    </Part>
  </g>,
  "house":()=><g><Shadow cx={120} cy={151} rx={92}/><House/></g>,
  "mortgage":()=><g>
    <Shadow cx={120} cy={152} rx={94}/>
    <Part name="sheet" pivot={[168,118]}>
      <Sheet x={130} y={22} w={76} h={96} fold={16}/>
      <TextRows x={142} y={36} widths={[36,48,44,30]} gap={9}/>
    </Part>
    <House x={-16} y={30} s={.8}/>
    <Badge cx={186} cy={124} r={18} tone="accent2" icon="percent"/>
  </g>,
  "storefront":(_o,c)=><Shop>
    <Screen x={56} y={74} w={66} h={52} r={RADIUS.xs} part="window"/>
    <Box x={52} y={126} w={74} h={8} r={RADIUS.xs} tone="deep"/>
    <Part name="door" pivot={[138,112]}>
      <Screen x={138} y={74} w={42} h={76} r={RADIUS.xs} part={false}/>
      <circle cx={172} cy={114} r={2.4} fill={c.tokens.accent2}/>
    </Part>
    <TextRows x={96} y={29} widths={[48]} h={6} tone="surface" level={1} opacity={.85}/>
  </Shop>,
  "business":()=><g>
    <Shadow cx={120} cy={152} rx={92}/>
    <Box x={44} y={40} w={152} h={110} r={RADIUS.xs}/>
    <Box x={38} y={32} w={164} h={12} r={RADIUS.sm} tone="deep"/>
    {Array.from({length:8},(_,i)=><Screen key={i} x={56+(i%4)*34} y={54+Math.floor(i/4)*30} w={26} h={20} r={RADIUS.xs} glare={false}
      part="window" partIndex={i}/>)}
    <Part name="awning" pivot={[120,114]}><Box x={92} y={114} w={56} h={8} r={RADIUS.xs} tone="accent"/></Part>
    <Screen x={102} y={122} w={36} h={28} r={RADIUS.xs} part="door"/>
    <Badge cx={196} cy={36} r={15} tone="accent" icon="briefcase"/>
  </g>,
  "retail-store":(_o,c)=><Shop w={176} awning="negative">
    <Screen x={46} y={72} w={92} h={56} r={RADIUS.xs}>
      <Shape d="M 58 104 H 80 L 82 126 H 56 Z" tone="accent" weight={STROKE.detail}/>
      <Stroke d="M 63 104 V 99 A 6 6 0 0 1 75 99 V 104" tone="surface" w={1.6}/>
      <Box x={88} y={108} w={20} h={18} r={RADIUS.xs} tone="accent2" weight={STROKE.detail}/>
      <Box x={112} y={98} w={18} h={28} r={RADIUS.xs} tone="surface" weight={STROKE.detail}/>
    </Screen>
    <Box x={42} y={128} w={100} h={8} r={RADIUS.xs} tone="deep"/>
    <Screen x={152} y={72} w={42} h={78} r={RADIUS.xs} part="door"/>
    <Icon name="bag" cx={120} cy={33} size={7} color={c.tokens.highlight} weight={2}/>
  </Shop>,
  "briefcase":(_o,c)=><g>
    <Shadow cx={120} cy={154} rx={88}/>
    <Part name="handle" pivot={[120,56]}>
      <Stroke d="M 94 56 V 40 Q 94 32 102 32 H 138 Q 146 32 146 40 V 56" tone="ink" w={10}/>
      <Stroke d="M 94 56 V 40 Q 94 32 102 32 H 138 Q 146 32 146 40 V 56" tone="deep" w={5.6}/>
    </Part>
    <Part name="body" pivot={[120,150]}>
    <Box x={38} y={54} w={164} h={96} r={RADIUS.lg} tone="deep"/>
    <path d="M 39 94 H 201" stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
    <path d="M 39 97 H 201" stroke={c.tokens.highlight} strokeOpacity={.2} strokeWidth={1.2}/>
    <Part name="clasp" pivot={[120,95]}><Box x={106} y={86} w={28} h={18} r={RADIUS.sm} tone="accent2"/></Part>
    <Box x={56} y={88} w={16} h={12} r={2} tone="accent2" weight={STROKE.detail}/>
    <Box x={168} y={88} w={16} h={12} r={2} tone="accent2" weight={STROKE.detail}/>
    </Part>
  </g>,
  "investment":o=><ChartPanel>
    <CoinStack cx={68} base={134} count={3} w={24}/>
    <CoinStack cx={100} base={134} count={5} w={24} partIndex={1}/>
    <CoinStack cx={132} base={134} count={7} w={24} partIndex={2}/>
    <Part name="leaf" pivot={[172,124]}>
      <Stroke d="M 172 124 Q 168 104 172 86" tone="positive" level={-.2} w={3.4}/>
      <Shape d="M 172 92 Q 150 86 152 66 Q 172 70 172 92 Z" tone="positive"/>
      <Shape d="M 172 100 Q 192 92 192 72 Q 172 78 172 100 Z" tone="positive"/>
    </Part>
    <Coin cx={172} cy={130} r={10} depth={2} symbol={o.symbol}/>
  </ChartPanel>,
  "stock":(_o,c)=><ChartPanel>
    <Part name="line" pivot={[50,135]}>
      <path d="M 50 118 L 72 104 L 90 110 L 112 84 L 132 92 L 154 64 L 176 72 L 192 50 V 135 H 50 Z" fill={c.color("accent")} opacity={.18}/>
      <Stroke d="M 50 118 L 72 104 L 90 110 L 112 84 L 132 92 L 154 64 L 176 72 L 192 50" tone="accent" w={3.4}/>
      {[[72,104],[112,84],[154,64],[192,50]].map(([x,y])=><Orb key={x} cx={x} cy={y} r={3.6} tone="accent" rim={false} weight={1.4}/>)}
    </Part>
    <Part name="badge" pivot={[61,39]}>
      <Box x={46} y={34} w={30} h={10} r={5} tone="positive" rim={false} weight={1.2}/>
      <Icon name="up" cx={53} cy={39} size={3.2} color={c.tokens.highlight} weight={1.6}/>
    </Part>
    <Part name="badge" index={1} pivot={[97,39]}>
      <Box x={82} y={34} w={30} h={10} r={5} tone="negative" rim={false} weight={1.2}/>
      <Icon name="down" cx={89} cy={39} size={3.2} color={c.tokens.highlight} weight={1.6}/>
    </Part>
  </ChartPanel>,
  "growth":()=><ChartPanel>
    {[[56,22],[86,40],[116,60],[146,84]].map(([x,h],i)=><Part key={x} name="bar" index={i} pivot={[x+10,135]}>
      <Box x={x} y={135-h} w={20} h={h} r={RADIUS.sm} tone="accent"/></Part>)}
    <Arrow d="M 52 108 Q 120 100 182 50" head="M 192 40 L 188 62 L 172 50 Z" tone="positive" w={6}/>
  </ChartPanel>,
  "profit":(o,c)=><ChartPanel>
    <Part name="line" pivot={[48,135]}>
      <path d="M 48 124 C 80 120 96 100 120 96 S 164 70 192 52 V 135 H 48 Z" fill={c.color("positive")} opacity={.2}/>
      <Stroke d="M 48 124 C 80 120 96 100 120 96 S 164 70 192 52" tone="positive" w={3.6}/>
    </Part>
    <Badge cx={186} cy={42} r={14} tone="positive" icon="plus"/>
    <Coin cx={70} cy={58} r={14} depth={3} symbol={o.symbol}/>
  </ChartPanel>,
  "loss":(o,c)=><ChartPanel>
    <Part name="line" pivot={[48,135]}>
      <path d="M 48 56 C 80 60 96 84 120 88 S 164 112 192 124 V 135 H 48 Z" fill={c.color("negative")} opacity={.2}/>
      <Stroke d="M 48 56 C 80 60 96 84 120 88 S 164 112 192 124" tone="negative" w={3.6}/>
    </Part>
    <Badge cx={186} cy={44} r={14} tone="negative" icon="minus"/>
    <Coin cx={70} cy={104} r={14} depth={3} symbol={o.symbol}/>
  </ChartPanel>,
  "calculator":()=><Calculator x={70} y={20}/>,
  "budget":(_o,c)=><g>
    <Shadow cx={112} cy={154} rx={84}/>
    <Box x={46} y={26} w={116} h={126} r={RADIUS.md} tone="deep"/>
    <Sheet x={54} y={36} w={100} h={110} fold={0} r={RADIUS.xs}/>
    <Part name="clip" pivot={[104,26]}><Box x={82} y={18} w={44} h={16} r={RADIUS.sm} tone="accent2"/></Part>
    <Part name="pie" pivot={[86,74]}>
    <circle cx={86} cy={74} r={22} fill={c.paint("accent")} stroke={c.tokens.ink} strokeWidth={STROKE.detail}/>
    <path d={`M 86 74 L 86 52 ${arc(86,74,22,-90,30).replace(/^M [^A]+/,"")} Z`} fill={c.paint("accent2")}
      stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
    <path d={`M 86 74 ${arc(86,74,22,30,110).replace(/^M/,"L")} Z`} fill={c.paint("positive")}
      stroke={c.tokens.ink} strokeWidth={STROKE.detail} strokeLinejoin="round"/>
    </Part>
    <TextRows x={116} y={62} widths={[26,20,24]} gap={9}/>
    <TextRows x={66} y={108} widths={[76,60,70]} gap={9}/>
    <g transform="translate(118 64) scale(.58)"><Calculator x={0} y={0} shadow={false}/></g>
  </g>,
  "insurance":()=><Shield icon="check"/>,
  "risk":(_o,c)=><g>
    <Shadow cx={120} cy={150} rx={86}/>
    <Box x={36} y={36} w={168} h={112} r={RADIUS.xl}/>
    <Part name="gauge" pivot={[120,118]}>
    {[["positive",180,234],["accent2",234,288],["negative",288,360]].map(([tone,a,b])=>
      <path key={tone as string} d={arc(120,118,58,a as number,b as number)} fill="none" stroke={c.color(tone as IllustrationTone)}
        strokeWidth={16}/>)}
    <path d={arc(120,118,67,180,360)} fill="none" stroke={c.tokens.ink} strokeWidth={STROKE.detail}/>
    <path d={arc(120,118,49,180,360)} fill="none" stroke={c.tokens.ink} strokeWidth={STROKE.detail}/>
    </Part>
    <Part name="needle" pivot={[120,118]}>
      <path d="M 120 118 L 160 82" stroke={c.tokens.ink} strokeWidth={6.4} strokeLinecap="round"/>
      <path d="M 120 118 L 160 82" stroke={c.color("deep",-.2)} strokeWidth={3.4} strokeLinecap="round"/>
    </Part>
    <Orb cx={120} cy={118} r={8} tone="deep"/>
    <Badge cx={186} cy={42} r={15} tone="accent2" icon="alert"/>
  </g>,
  "transfer":o=><g>
    <Shadow cx={120} cy={146} rx={92}/>
    <Tile x={30} y={62} w={62} h={62} icon="bank"/>
    <Tile x={148} y={62} w={62} h={62} icon="user" index={1}/>
    <Arrow d="M 96 76 Q 120 56 140 76" head="M 148 72 L 140 86 L 132 74 Z" tone="accent" w={4.4}/>
    <g transform="rotate(-6 120 112)"><Note x={98} y={98} w={46} h={28} symbol={o.symbol}/></g>
  </g>,
  "transaction":o=><g>
    <Shadow cx={120} cy={150} rx={92}/>
    <CardFace x={28} y={60} w={88} h={56} rotate={-8} chip>{null}</CardFace>
    <Coin cx={176} cy={88} r={28} depth={5} symbol={o.symbol}/>
    <Arrow d="M 104 52 Q 128 38 150 52" head="M 158 50 L 150 64 L 143 50 Z" tone="positive" w={4}/>
    <Arrow d="M 150 132 Q 126 146 104 132" head="M 96 134 L 104 120 L 111 134 Z" tone="accent" w={4} partIndex={1}/>
  </g>,
  "currency-exchange":o=><g>
    <Shadow cx={120} cy={150} rx={86}/>
    <Coin cx={86} cy={74} r={34} depth={5} symbol={o.symbol}/>
    <Coin cx={156} cy={108} r={34} depth={5} tone="surface" symbol={o.alt} partIndex={1}/>
    <Arrow d="M 148 34 Q 186 40 192 74" head="M 194 84 L 182 72 L 200 70 Z" tone="accent" w={4}/>
    <Arrow d="M 94 150 Q 56 146 48 112" head="M 46 102 L 58 114 L 40 116 Z" tone="accent" w={4} partIndex={1}/>
  </g>,
  "handshake":(_o,c)=><g>
    <Shadow cx={120} cy={150} rx={92}/>
    <Part name="sleeve" pivot={[22,129]}>
      <Shape d="M 10 116 L 48 82 L 72 108 L 34 142 Z" tone="deep"/>
      <Shape d="M 46 80 L 56 71 L 81 98 L 71 107 Z" tone="surface"/>
    </Part>
    <Part name="sleeve" index={1} pivot={[218,129]}>
      <Shape d="M 230 116 L 192 82 L 168 108 L 206 142 Z" tone="accent"/>
      <Shape d="M 194 80 L 184 71 L 159 98 L 169 107 Z" tone="surface"/>
    </Part>
    <Part name="hands" pivot={[120,96]}>
    <Shape d="M 58 74 Q 86 58 118 64 L 150 74 Q 160 80 152 90 L 128 116 Q 114 126 98 116 L 76 100 Z"
      tone="surface" fill={c.color("surface",-.08)}/>
    <Shape d="M 182 72 Q 162 60 138 68 L 116 82 Q 112 90 120 92 L 152 106 L 168 98 Z" tone="surface"/>
    {[0,1,2,3].map(i=>{
      const x=118+i*7.6,y=73+i*8.3,len=i===3?18:24-i;
      const d=`M ${x} ${y} L ${x-len*.74} ${y+len*.67}`;
      return <g key={i}>
        <path d={d} stroke={c.tokens.ink} strokeWidth={14.4} strokeLinecap="round"/>
        <path d={d} stroke={c.color("surface",-.03*i)} strokeWidth={11} strokeLinecap="round"/>
      </g>;
    })}
    <rect x={84} y={58} width={42} height={12} rx={6} transform="rotate(12 84 64)"
      fill={c.paint("surface")} stroke={c.tokens.ink} strokeWidth={STROKE.detail}/>
    </Part>
  </g>,
  "partnership":(_o,c)=><g>
    <Shadow cx={120} cy={150} rx={92}/>
    <Person cx={68} y={46} s={1.7} tone="accent"/>
    <Person cx={172} y={46} s={1.7} tone="accent2" partIndex={1}/>
    <Part name="link" pivot={[120,110]}><g transform="rotate(-20 120 110)">
      <rect x={96} y={102} width={30} height={16} rx={8} fill="none" stroke={c.tokens.ink} strokeWidth={7.4}/>
      <rect x={96} y={102} width={30} height={16} rx={8} fill="none" stroke={c.color("surface",-.08)} strokeWidth={4}/>
      <rect x={114} y={102} width={30} height={16} rx={8} fill="none" stroke={c.tokens.ink} strokeWidth={7.4}/>
      <rect x={114} y={102} width={30} height={16} rx={8} fill="none" stroke={c.color("surface",-.08)} strokeWidth={4}/>
    </g></Part>
  </g>,
  "repayment":(_o,c)=><CalendarBase>
    {CALENDAR_CELLS.map((_,i)=>{const r=calendarCell(i);
      const paid=i<8;
      return <g key={i}>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={3} fill={paid?c.color("positive",.0):c.color("ink")}
          opacity={paid?.2:.07}/>
        {paid?<Part name="check" index={i} pivot={[r.x+r.w/2,r.y+r.h/2]}>
          <Icon name="check" cx={r.x+r.w/2} cy={r.y+r.h/2} size={5} color={c.color("positive",-.1)} weight={2}/></Part>:null}
      </g>;})}
    <Badge cx={186} cy={138} r={16} tone="accent" icon="sync"/>
  </CalendarBase>,
  "payday":(o,c)=><g>
    <CalendarBase>
      {CALENDAR_CELLS.map((_,i)=>{const r=calendarCell(i);
        return i===8?null:<rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={3} fill={c.color("ink")} opacity={.07}/>;})}
      {(()=>{const r=calendarCell(8);
        return <Part name="day" pivot={[r.x+r.w/2,r.y+r.h/2]}><Box x={r.x-4} y={r.y-4} w={r.w+8} h={r.h+8} r={RADIUS.sm} tone="accent2"/>
          <Glyph x={r.x+r.w/2} y={r.y+r.h/2} size={14} fill={c.color("accent2",-.5)}>{o.symbol}</Glyph></Part>;})()}
    </CalendarBase>
    <CoinStack cx={194} base={156} count={4} w={34}/>
    <Coin cx={194} cy={112} r={15} depth={3} symbol={o.symbol}/>
  </g>,
  "stock-workstation":o=><g>
    <Shadow cx={120} cy={154} rx={98}/>
    <Monitor x={24} y={18} w={192} h={104}>
      <CandlePlot x={36} y={32} w={168} h={66} candles={o.candles}/>
    </Monitor>
    <Shape d="M 46 146 L 56 136 H 184 L 194 146 Z" tone="surface"/>
    <Keys x={62} y={138} cols={10} rows={1} kw={9} kh={4} gap={3}/>
  </g>,
  "stock-chart":(o,c)=><g>
    <Shadow cx={120} cy={152} rx={94}/>
    <Box x={28} y={22} w={184} h={126} r={RADIUS.lg}/>
    {[46,70,94].map(y=><path key={y} d={`M 40 ${y} H 200`} stroke={c.tokens.ink} opacity={.1}/>)}
    <CandlePlot x={40} y={34} w={160} h={76} candles={o.candles}/>
    <Stroke d="M 40 118 H 200" opacity={.25}/>
    <Part name="volume" pivot={[120,140]}>{o.candles.map((k,i)=>{const step=160/o.candles.length;
      const vh=4+Math.abs(k.close-k.open)/Math.max(1,...o.candles.map(q=>Math.abs(q.close-q.open)))*16;
      return <rect key={i} x={40+step*i+step*.22} y={140-vh} width={step*.56} height={vh} rx={.8}
        fill={c.color(k.close>=k.open?"positive":"negative")} opacity={.55}/>;})}</Part>
  </g>,
  "corporate-office":(_o,c)=><g>
    <Shadow cx={120} cy={152} rx={92}/>
    <Tower x={44} y={70} w={48} h={80} tone="surface" cols={2}/>
    <Tower x={92} y={28} w={64} h={122} index={1}/>
    <Tower x={156} y={84} w={44} h={66} tone="surface" cols={2} index={2}/>
    <Part name="awning" pivot={[124,131]}><Box x={100} y={128} w={48} h={6} r={2} tone="accent"/></Part>
    <Screen x={110} y={134} w={28} h={16} r={1} part="door"/>
    <Stroke d="M 124 28 V 8" w={2}/>
    <Part name="flag" pivot={[124,14]}>
      <path d="M 124 9 H 142 L 137 14 L 142 19 H 124 Z" fill={c.paint("accent")} stroke={c.tokens.ink} strokeWidth={1.4} strokeLinejoin="round"/>
    </Part>
  </g>,
  "corporate":()=><g>
    <Shadow cx={120} cy={152} rx={96}/>
    <Tower x={30} y={64} w={52} h={86} tone="deep" cols={3}/>
    <Tower x={150} y={46} w={56} h={104} tone="deep" cols={3} index={1}/>
    <Tower x={84} y={20} w={64} h={130} index={2}/>
    <Box x={26} y={146} w={188} h={7} r={RADIUS.xs} tone="deep"/>
  </g>,
  "money-printing-press":(o,c)=><g>
    <Shadow cx={112} cy={154} rx={98}/>
    <Box x={24} y={48} w={140} h={98} r={RADIUS.md} tone="deep"/>
    <Box x={32} y={32} w={124} h={20} r={RADIUS.sm}/>
    <Keys x={40} y={38} cols={4} rows={1} kw={10} kh={8} gap={4} accent={[3]} accentTone="positive"/>
    <Part name="light" pivot={[136,42]}><circle cx={136} cy={42} r={5} fill={c.paint("negative")} stroke={c.tokens.ink} strokeWidth={1.2}/></Part>
    {[60,96,132].map((x,i)=><Part key={x} name="roller" index={i} pivot={[x,88]}>
      <circle cx={x} cy={88} r={16} fill={c.side("surface")} stroke={c.tokens.ink} strokeWidth={STROKE.outline}/>
      <circle cx={x} cy={88} r={5} fill={c.paint("accent")} stroke={c.tokens.ink} strokeWidth={1.4}/>
      <path d={`M ${x} ${77} V ${83}`} stroke={c.tokens.ink} strokeOpacity={.35} strokeWidth={1.4} strokeLinecap="round"/>
    </Part>)}
    <Box x={34} y={114} w={120} h={8} r={2} tone="ink" rim={false}/>
    <g transform="rotate(-8 186 116)"><Note x={150} y={98} w={70} h={38} symbol={o.symbol}/></g>
    <Part name="stack" pivot={[192,148]}>{[0,1,2].map(i=><Box key={i} x={162} y={140-i*5} w={60} h={8} r={2} tone="positive" rim={false} weight={1.4}/>)}</Part>
  </g>,
  "money-bag":(o,c)=><g>
    <Shadow cx={120} cy={154} rx={74}/>
    <Part name="bag" pivot={[120,152]}>
      <Shape d="M 98 50 Q 62 80 54 120 Q 50 152 120 152 Q 190 152 186 120 Q 178 80 142 50 Z" tone="accent2"/>
      <Stroke d="M 92 64 Q 70 88 66 114" tone="highlight" opacity={.4} w={3}/>
      <Shape d="M 96 50 Q 84 26 100 22 Q 120 34 140 22 Q 156 26 144 50 Z" tone="accent2"/>
      <Part name="tie" pivot={[120,51]}><Box x={92} y={46} w={56} h={10} r={5} tone="accent"/></Part>
      <Glyph x={120} y={110} size={46} fill={c.color("accent2",-.5)}>{o.symbol}</Glyph>
    </Part>
    <Coin cx={184} cy={136} r={14} depth={3} symbol={o.symbol}/>
  </g>,
  "bank-check":(o,c)=><g>
    <Shadow cx={120} cy={150} rx={100}/>
    <Part name="sheet" pivot={[120,144]}><g transform="rotate(-3 120 94)">
      <Box x={20} y={44} w={200} h={100} r={RADIUS.sm}/>
      <path d="M 22 46 H 218 V 60 H 22 Z" fill={c.color("accent")} opacity={.85}/>
      <Icon name="bank" cx={34} cy={53} size={5} color={c.tokens.highlight} weight={1.4}/>
      <TextRows x={44} y={51} widths={[52]} h={3.4} tone="surface" level={1} opacity={.8}/>
      <TextRows x={176} y={70} widths={[30]} h={3.4} align="end"/>
      <Stroke d="M 34 92 H 156" opacity={.35} w={1.2}/>
      <TextRows x={34} y={84} widths={[60]} h={3.4}/>
      <rect x={164} y={80} width={44} height={18} rx={2} fill="none" stroke={c.tokens.ink} strokeOpacity={.5} strokeWidth={1.2}/>
      <Glyph x={174} y={89} size={11} fill={c.tokens.ink}>{o.symbol}</Glyph>
      <TextRows x={182} y={87} widths={[20]} h={3.4}/>
      <Stroke d="M 34 112 H 196" opacity={.35} w={1.2}/>
      <Stroke d="M 140 128 H 206" opacity={.35} w={1.2}/>
      <Part name="signature" pivot={[146,124]}><Scribble x={146} y={124} w={44} tone="accent"/></Part>
      <g fill={c.tokens.ink} opacity={.42}>{Array.from({length:9},(_,i)=><rect key={i} x={34+i*10} y={128} width={i%3===2?3:6} height={6} rx={1}/>)}</g>
    </g></Part>
  </g>,
  "bull-market":()=><g>
    <Shadow cx={120} cy={154} rx={60}/>
    <Head tone="deep" horns/>
    <Badge cx={196} cy={124} r={17} tone="positive" icon="trend-up"/>
  </g>,
  "bear-market":()=><g>
    <Shadow cx={120} cy={154} rx={60}/>
    <Head tone="deep"/>
    <Badge cx={190} cy={128} r={17} tone="negative" icon="trend-down"/>
  </g>,
  "financial-dashboard":(_o,c)=><g>
    <Shadow cx={120} cy={154} rx={92}/>
    <Monitor x={24} y={18} w={192} h={112}>
      <rect x={36} y={30} width={50} height={36} rx={3} fill={c.tokens.highlight} opacity={.07}/>
      <Part name="gauge" pivot={[61,48]}>
        <circle cx={61} cy={48} r={11} fill="none" stroke={c.tokens.highlight} strokeOpacity={.15} strokeWidth={5}/>
        <path d={arc(61,48,11,-90,150)} fill="none" stroke={c.tokens.accent} strokeWidth={5}/>
      </Part>
      <rect x={92} y={30} width={50} height={36} rx={3} fill={c.tokens.highlight} opacity={.07}/>
      {[0,1,2,3].map(i=><Part key={i} name="bar" index={i} pivot={[101.5+i*11,58]}>
        <rect x={98+i*11} y={58-(i+1)*6} width={7} height={(i+1)*6} rx={1} fill={c.tokens.accent2}/></Part>)}
      <rect x={148} y={30} width={56} height={36} rx={3} fill={c.tokens.highlight} opacity={.07}/>
      <TextRows x={154} y={38} widths={[24]} h={3} tone="surface" opacity={.5}/>
      <TextRows x={154} y={46} widths={[40]} h={8} tone="positive" opacity={.9}/>
      <rect x={36} y={72} width={168} height={42} rx={3} fill={c.tokens.highlight} opacity={.07}/>
      <Part name="line" pivot={[42,104]}>
        <path d="M 42 104 L 66 96 L 88 100 L 112 86 L 138 90 L 162 78 L 196 82" fill="none"
          stroke={c.tokens.positive} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round"/>
      </Part>
    </Monitor>
  </g>,
};
function Calculator({x,y,shadow=true}:{x:number;y:number;shadow?:boolean}){
  return <g>
    {shadow?<Shadow cx={x+50} cy={y+134} rx={58}/>:null}
    <Part name="body" pivot={[x+50,y+132]}>
      <Box x={x} y={y} w={100} h={132} r={RADIUS.lg} tone="deep"/>
      <Screen x={x+10} y={y+10} w={80} h={28} glare>
        <TextRows x={x+86} y={y+20} widths={[44]} h={8} tone="accent" opacity={.95} align="end"/>
      </Screen>
      <Keys x={x+11} y={y+48} cols={4} rows={4} kw={15} kh={14} gap={5.6} accent={[3,7,11,15]} accentTone="accent2"/>
    </Part>
  </g>;
}
function Sparkle({x,y,s}:{x:number;y:number;s:number}){
  const c=useIllustration();
  return <Part name="sparkle" pivot={[x,y]}>
    <path d={`M ${x} ${y-s} Q ${x} ${y} ${x+s} ${y} Q ${x} ${y} ${x} ${y+s} Q ${x} ${y} ${x-s} ${y} Q ${x} ${y} ${x} ${y-s} Z`}
      fill={c.tokens.highlight} opacity={.9}/>
  </Part>;
}

function FinanceArt({kind,art}:{kind:FinanceObjectKind;art:Art}){
  const c=useIllustration();
  const draw=ART[kind];
  if(!draw)throw new Error(`No 2D illustration registered for finance kind ${JSON.stringify(kind)}.`);
  return <>{draw(art,c)}</>;
}
const SYMBOL=/^.{1,3}$/u;
/** Accessible, themeable, frame-addressable finance object illustration. */
export const FinanceObject2D=forwardRef<SVGSVGElement,FinanceObject2DProps>(function FinanceObject2D(
  {spec,currencySymbol="$",secondaryCurrencySymbol="€",...props},ref){
  const object=resolveFinanceObject(spec);
  if(!SYMBOL.test(currencySymbol)||!SYMBOL.test(secondaryCurrencySymbol))
    throw new Error("Currency symbols must be 1–3 characters.");
  const art:Art={symbol:object.kind==="dollar"?"$":currencySymbol,alt:secondaryCurrencySymbol,
    candles:object.marketCandles??ILLUSTRATIVE_MARKET_CANDLES};
  return <DomainIllustration {...props} ref={ref} title={object.title} accent={object.accent}
    state={object.state} semanticId={object.id}
    data={{"data-km-finance-object-2d":object.kind,"data-km-archetype":object.archetype}}>
    <FinanceArt kind={object.kind} art={art}/>
  </DomainIllustration>;
});
