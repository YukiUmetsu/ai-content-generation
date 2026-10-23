
import type { GeneralFrame } from "../../scripts/video-production/general-visual-plan.mjs";
import type { SemanticFrame } from "./semantic-scene-motion";
import { fitSvgText } from "../../scripts/video-production/text-layout.mjs";
import { entryFadeOpacity } from "../../scripts/video-production/scene-motion.mjs";

const paper="#F7F3EA",faint="#A7BDC4",cyan="#8ADBD3",amber="#EFC18B",navy="#111F2C";
const ease=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
const defaults=[
  {name:"Mortgage interest",description:"The cost of borrowing",tag:"IF FINANCED",symbol:"%"},
  {name:"Property tax",description:"A recurring local cost",tag:"ONGOING",symbol:"T"},
  {name:"Home insurance",description:"Protecting the property",tag:"ONGOING",symbol:"◆"},
  {name:"Maintenance",description:"Repairs and upkeep",tag:"AS NEEDED",symbol:"✦"}
];
function House({x,y,scale=1,drift=0}:{x:number;y:number;scale?:number;drift?:number}){
 return <g data-story-object="house" transform={`translate(${x} ${y+drift}) scale(${scale})`}>
   <ellipse cx="0" cy="225" rx="305" ry="48" fill="#060F17" opacity=".4"/>
   <path d="M-276 88 L-18 -99 L255 83 L255 213 L-276 213Z" fill="#F3E7D5" stroke="#CBBCA5" strokeWidth="5"/>
   <path d="M-315 90 L-13 -130 L296 90 L246 90 L-13 -66 L-262 107Z"
     fill="#CB8065" stroke="#EBAD8D" strokeWidth="7" strokeLinejoin="round"/>
   <path d="M-236 108 H-64 V171 H-236Z M95 108 H215 V171 H95Z"
     fill="#91D8DC" stroke="#3D7181" strokeWidth="8"/>
   <path d="M-148 108 V171 M156 108 V171" stroke="#3D7181" strokeWidth="6"/>
   <path d="M-27 97 H74 V213 H-27Z" fill="#416371" stroke="#253F4B" strokeWidth="8"/>
   <circle cx="54" cy="161" r="6" fill={amber}/>
   <rect x="-291" y="205" width="572" height="17" rx="8" fill="#BAC5AC"/>
   <path d="M8 223 V266 M-39 266 H89" stroke="#9B9C91" strokeWidth="8" strokeLinecap="round"/>
   <g transform="translate(-284 170)"><circle r="38" fill="#3E796E"/><circle cx="-23" cy="-10" r="27" fill="#5A9580"/></g>
   <g transform="translate(273 170)"><circle r="37" fill="#3D776A"/><circle cx="22" cy="-13" r="26" fill="#5A9580"/></g>
   <path d="M-190 12 L-190 -87 L-127 -87 L-127 -28" fill="#CB8065" stroke="#EDAE90" strokeWidth="8"/>
 </g>;
}
function Heading({state,x,y,maxWidth}:{state:GeneralFrame;x:number;y:number;maxWidth:number}){
 const fitted=fitSvgText(state.visual.headline,{maxWidthPx:maxWidth,preferredSize:75,minSize:39,maxLines:3});
 return <g data-story-headline="" opacity={state.enterProgress}
   transform={`translate(0 ${Math.round(25*(1-state.enterProgress))})`}>
   {fitted.lines.map((line,i)=><text key={i} x={x} y={y+i*93} fill={paper}
     fontSize={fitted.fontSize} fontWeight="820" letterSpacing="-2">{line}</text>)}
 </g>;
}
function Background({children}:{children:React.ReactNode}){
 return <g>
  <defs>
   <linearGradient id="home-bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stopColor="#101E2B"/><stop offset=".7" stopColor="#17313F"/><stop offset="1" stopColor="#172D3C"/>
   </linearGradient>
   <radialGradient id="home-glow"><stop offset="0" stopColor="#66B7AE" stopOpacity=".2"/>
    <stop offset="1" stopColor="#66B7AE" stopOpacity="0"/></radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="url(#home-bg)"/>
  <circle cx="1368" cy="535" r="604" fill="url(#home-glow)"/>
  <rect x="114" y="71" width="12" height="12" rx="4" fill={amber}/>
  <text x="144" y="85" fontSize="24" fontWeight="750" letterSpacing="5" fill={amber}>HOUSE MATH</text>
  <path d="M112 113 H1808" stroke="#45616F" opacity=".6" strokeWidth="2"/>
  {children}
 </g>;
}
function Question({state,motion}:{state:GeneralFrame;motion:SemanticFrame}){
 const t=motion.completion;
 return <g data-story-scene="question">
  <text x="133" y="207" fill={amber} fontSize="26" fontWeight="750" letterSpacing="3">THE $500,000 QUESTION</text>
  <Heading state={state} x={128} y={327} maxWidth={795}/>
  <text x="133" y="687" fill={faint} fontSize="30">The price tag is only the starting point.</text>
  <text x="133" y="735" fill={faint} fontSize="27">So where does the rest of the money go?</text>
  <g transform={`translate(${motion.cameraX} ${motion.cameraY})`}>
   <circle cx="1390" cy="527" r="324" fill="#29505A" opacity=".19"/>
   <circle cx="1390" cy="527" r="271" fill="none" stroke="#77AFA8" strokeDasharray="12 23"
     strokeWidth="2" opacity=".4" transform={`rotate(${motion.lightSweep*24} 1390 527)`}/>
   <House x={1390} y={530} scale={.94} drift={Math.sin(t*Math.PI*2)*5}/>
   <g data-story-price-tag="" transform={`translate(1154 ${778-14*ease(t)})`}>
    <rect width="474" height="122" rx="23" fill={amber}/>
    <text x="26" y="39" fill="#3F403C" fontSize="20" fontWeight="750" letterSpacing="2">HYPOTHETICAL ASKING PRICE</text>
    <text x="27" y="100" fill="#182B32" fontSize="57" fontWeight="840">$500,000</text>
   </g>
   {t>.18&&<g data-story-curiosity="" opacity={ease((t-.18)/.25)}>
     <text x="1034" y="391" fill={amber} fontSize="67">?</text>
     <text x="1686" y="485" fill={cyan} fontSize="67">?</text>
     <text x="1660" y="744" fill={paper} fontSize="58">?</text>
   </g>}
  </g>
 </g>;
}
function CostCard({x,y,item,index,opacity}:{x:number;y:number;item:typeof defaults[number];index:number;opacity:number}){
 if(opacity<=0)return null;
 const color=index%2?amber:cyan;
 return <g data-story-cost={index} opacity={opacity} transform={`translate(0 ${(1-opacity)*28})`}>
  <rect x={x} y={y} width="445" height="178" rx="24" fill="#203C47" stroke="#507580" strokeWidth="2"/>
  <rect x={x+22} y={y+26} width="78" height="78" rx="18" fill="#31565C"/>
  <text x={x+61} y={y+80} fill={color} fontSize="42" textAnchor="middle" fontWeight="800">{item.symbol}</text>
  <text x={x+121} y={y+59} fill={paper} fontSize="28" fontWeight="735">{item.name}</text>
  <text x={x+121} y={y+95} fill={faint} fontSize="20">{item.description}</text>
  <rect x={x+121} y={y+117} rx="16" width={Math.min(178,item.tag.length*14+25)} height="33" fill="#31535A"/>
  <text x={x+134} y={y+140} fill={color} fontWeight="750" fontSize="17" letterSpacing="1.5">{item.tag}</text>
 </g>;
}
function Mechanism({state,motion}:{state:GeneralFrame;motion:SemanticFrame}){
 const labels=state.visual.items.slice(1);
 return <g data-story-scene="mechanism">
  <text x="130" y="204" fill={amber} fontSize="24" fontWeight="750" letterSpacing="4">WHAT THE LISTING LEAVES OUT</text>
  <Heading state={state} x={130} y={300} maxWidth={640}/>
  <text x="133" y="545" fill={faint} fontSize="28">The house is the same.</text>
  <text x="133" y="587" fill={faint} fontSize="28">The bills keep arriving.</text>
  <g transform={`translate(${motion.cameraX} ${motion.cameraY})`}>
    <House x={406} y={789} scale={.66}/>
    <g transform="translate(170 926)">
      <rect width="469" height="71" rx="18" fill={amber}/>
      <text x="25" y="46" fill="#1B3038" fontSize="31" fontWeight="800">$500K ASKING PRICE</text>
    </g>
    <path d="M674 680 H757" stroke={cyan} strokeWidth="4" strokeDasharray="9 12"
      strokeDashoffset={Math.round(-motion.lightSweep*120)} opacity=".82"/>
  </g>
  {defaults.map((item,i)=><CostCard key={i} x={812+(i%2)*474} y={291+Math.floor(i/2)*222}
    item={{...item,name:labels[i]??item.name}} index={i}
    opacity={i+1<state.visibleItems?(motion.reveal[i+1]?.opacity??1):0}/>)}
  <text x="820" y="787" fill={faint} fontSize="22">Four categories. No invented forecast.</text>
 </g>;
}
function Payoff({state,motion}:{state:GeneralFrame;motion:SemanticFrame}){
 if(state.visibleItems===0)return <g data-story-scene="payoff" data-story-payoff-locked="true">
  <text x="132" y="508" fill={faint} fontSize="32" letterSpacing="3">PUT THE PIECES TOGETHER…</text>
 </g>;
 const labels=state.visual.items.slice(0,5);
 return <g data-story-scene="payoff">
  <text x="130" y="196" fill={amber} fontSize="25" fontWeight="750" letterSpacing="4">THE TAKEAWAY</text>
  <Heading state={state} x={128} y={290} maxWidth={1600}/>
  <text x="132" y="407" fill={faint} fontSize="27">Think in costs over time—not just the purchase price.</text>
  {labels.map((label,i)=>{
    if(i>=state.visibleItems)return null;
    const p=motion.reveal[i],y=466+i*96;
    return <g key={i} data-story-formula-item={i}
       opacity={p?.opacity??1} transform={`translate(0 ${p?.offset??0})`}>
      <rect x="142" y={y} width="631" height="75" rx="17" fill="#25434B"
        stroke={i===0?amber:cyan} strokeWidth="2"/>
      <circle cx="188" cy={y+38} r="23" fill="#365C60"/>
      <text x="188" y={y+47} textAnchor="middle" fill={i===0?amber:cyan}
        fontSize="28" fontWeight="780">{i===0?"1":"+"}</text>
      <text x="239" y={y+48} fill={paper} fontSize="30" fontWeight="730">{label}</text>
    </g>;
  })}
  <path d="M808 702 H967" stroke={amber} strokeWidth="6" strokeDasharray="18 16"
    strokeDashoffset={Math.round(-motion.lightSweep*100)}/>
  <path d="M946 683 L975 702 L946 720" fill="none" stroke={amber} strokeWidth="6"/>
  {state.visibleItems>=2&&<g data-story-takeaway="" opacity={ease((motion.completion-.14)/.28)}>
    <rect x="1005" y="485" width="750" height="370" rx="33" fill="#2B514E" stroke={cyan} strokeWidth="3"/>
    <text x="1071" y="562" fill={cyan} fontSize="24" fontWeight="730" letterSpacing="3">WHAT YOU MAY SPEND</text>
    <text x="1071" y="653" fill={paper} fontSize="61" fontWeight="830">MORE THAN</text>
    <text x="1071" y="733" fill={amber} fontSize="76" fontWeight="840">$500,000</text>
    <text x="1071" y="807" fill={paper} fontSize="23">When financed and ongoing costs are included</text>
  </g>}
  <text x="132" y="1024" fill={faint} fontSize="22">
    Depends on loan terms, location, repairs and years owned. Sale proceeds are not included.
  </text>
 </g>;
}
export function HomeCostStoryScene({state,motion,frames}:{state:GeneralFrame;motion:SemanticFrame;frames:number}){
 const scene=state.chapterIndex===0?"question":state.chapterIndex===1?"mechanism":"payoff";
 const fade=state.visual.motion?entryFadeOpacity(state.localFrame,frames,state.visual.motion):0;
 return <div data-general-export-frame="" data-home-cost-film="" style={{position:"relative",
   width:1920,height:1080,fontFamily:"Geist Variable, Geist, Arial, sans-serif"}}>
  <svg xmlns="http://www.w3.org/2000/svg" role="img"
    aria-label={`${state.visual.headline}: hypothetical home ownership cost illustration`}
    viewBox="0 0 1920 1080" width="1920" height="1080"
    style={{display:"block",fontFamily:"Geist Variable, Geist, Arial, sans-serif"}}>
   <Background>
    {scene==="question"?<Question state={state} motion={motion}/>:
     scene==="mechanism"?<Mechanism state={state} motion={motion}/>:
     <Payoff state={state} motion={motion}/>}
   </Background>
   {fade>0&&<rect data-scene-entry-fade="" width="1920" height="1080"
     fill={navy} opacity={fade} pointerEvents="none"/>}
  </svg>
 </div>;
}
