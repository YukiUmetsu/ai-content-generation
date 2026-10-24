/** One SVG mechanism, one existing ContentGen/Kumiki frame clock, no DOM animation. */
import type {VisualMechanicV1} from "../../scripts/video-production/semantic-mechanic.mjs";
import {fitSvgText} from "../../scripts/video-production/text-layout.mjs";
import {compileSemanticMechanic} from "./semantic-mechanic-compiler";
import type {SemanticActorPose,SemanticScenePose} from "./semantic-mechanic-compiler";
import type {SemanticFrame} from "./semantic-scene-motion";
import type {RationalFps} from "@/components/motion/types";

const palette={subject:"#8DDDD0",part:"#F0C48B",source:"#93C6E7",destination:"#B6D5A6",result:"#DFC3F3"};
const titles={split:"ONE SYSTEM · DISTINCT PARTS",assemble:"PARTS FORM A SYSTEM",
  transfer:"SAME OBJECT · NEW LOCATION",accumulate:"CONTRIBUTIONS COME TOGETHER",
  compare:"SIDE BY SIDE · NO IMPLIED RANK",reveal:"THE HIDDEN LAYER"};

function Actor({actor}:{actor:SemanticActorPose}){
  const color=palette[actor.role];
  const {x,y,width,height,opacity}=actor;
  const centerX=x+width/2,centerY=y+height/2;
  const text=fitSvgText(actor.label,{maxWidthPx:width-24,preferredSize:24,minSize:13,maxLines:2});
  // Assembly's physical subcomponents shrink into compact pieces. Fade their
  // explanatory copy before it could wrap into illegible syllables.
  const labelOpacity=actor.role==="part"?Math.max(0,Math.min(1,(width-99)/42)):1;
  return <g data-semantic-actor={actor.id} data-semantic-role={actor.role} data-semantic-rect={`${x},${y},${width},${height}`}
    role="group" aria-label={opacity>.015?actor.label:undefined} opacity={opacity}>
    {actor.role==="source"||actor.role==="destination"
      ? <>
        <circle cx={centerX} cy={centerY} r={Math.min(width,height)*.42} fill="#213947" stroke={color} strokeWidth={actor.emphasis?5:3}/>
        <circle cx={centerX} cy={centerY} r={Math.min(width,height)*.25} fill="none" stroke={color} strokeWidth="1.5" opacity=".65"/>
        <circle cx={centerX} cy={centerY} r="7" fill={color}/>
      </>
      : actor.role==="subject"
      ? <>
        <rect x={x} y={y} width={width} height={height} rx="25" fill="#173948" stroke={color} strokeWidth={actor.emphasis?5:3}/>
        <path d={`M${x+19} ${y+19} h${width-38}`} stroke={color} strokeWidth="5" strokeLinecap="round" opacity=".85"/>
        <path d={`M${x+27} ${y+height-26} h${width-54}`} stroke={color} strokeWidth="2" strokeDasharray="8 11" opacity=".45"/>
      </>
      : actor.role==="result"
      ? <>
        <rect x={x} y={y} width={width} height={height} rx="20" fill="#36404D" stroke={color} strokeWidth="3"/>
        <path d={`M${x+20} ${y+12} h${width-40}`} stroke={color} strokeWidth="5" strokeLinecap="round"/>
      </>
      : <>
        <rect x={x} y={y} width={width} height={height} rx="14" fill="#324755" stroke={color} strokeWidth="2.5"/>
        <path d={`M${x+12} ${y+13} h${Math.min(38,width-24)}`} stroke={color} strokeWidth="5" strokeLinecap="round"/>
        <rect x={x+12} y={y+22} width="11" height="11" rx="3" fill={color} opacity=".75"/>
      </>}
    {opacity>.015&&labelOpacity>.02&&text.lines.map((line,index)=><text key={index} x={centerX}
      y={centerY+(index-(text.lines.length-1)/2)*Math.min(29,text.fontSize*1.3)+text.fontSize*.31}
      textAnchor="middle" fontSize={text.fontSize} fontWeight="680" fill="#F8F6F1"
      stroke="#20323B" strokeWidth="2.8" opacity={labelOpacity} paintOrder="stroke">{line}</text>)}
  </g>;
}

function Paths({pose}:{pose:SemanticScenePose}){
  const byId=new Map(pose.actors.map(actor=>[actor.id,actor]));
  const midpoint=(id:string)=>{const a=byId.get(id);return a?{x:a.x+a.width/2,y:a.y+a.height/2}:{x:1430,y:560};};
  const center=midpoint(pose.subjectId),outcome=midpoint(pose.outcomeId);
  if(pose.operator==="transfer"){
    const source=midpoint(pose.operands[0]),destination=midpoint(pose.operands[1]);
    return <g data-semantic-path="transfer" fill="none" strokeLinecap="round">
      <path d={`M${source.x+73} ${source.y} H${destination.x-73}`} stroke="#79A8B8" strokeWidth="7" strokeDasharray="4 16" opacity=".6"/>
      <path d={`M${source.x+73} ${source.y} H${source.x+73+Math.max(0,destination.x-source.x-146)*pose.progress}`}
        stroke="#EFC08B" strokeWidth="5"/>
    </g>;
  }
  if(pose.operator==="split"||pose.operator==="assemble")return <g data-semantic-path={pose.operator}>
    {pose.operands.map(id=>{const p=midpoint(id);return <path key={id} d={`M${center.x} ${center.y} Q${(center.x+p.x)/2} ${center.y-74} ${p.x} ${p.y}`}
      fill="none" stroke="#81B6B7" strokeWidth="2.4" strokeDasharray="8 12" opacity={Math.max(.12,pose.progress*.68)}/>;})}
  </g>;
  if(pose.operator==="accumulate")return <g data-semantic-path="accumulate">
    <path d="M1430 320 V861" fill="none" stroke="#5B8E9C" strokeWidth="3" strokeDasharray="7 12" opacity=".5"/>
    {pose.showOutcome&&<path d={`M${outcome.x} 730 V${outcome.y-54}`} stroke="#DFC3F3" strokeWidth="3"/>}
  </g>;
  if(pose.operator==="compare")return <g data-semantic-path="comparison" fill="none" stroke="#86A4B1" strokeWidth="2">
    <path d="M1070 607 H1790" strokeDasharray="6 15" opacity=".75"/>
    <path d="M1070 614 V597 M1790 614 V597" strokeWidth="4"/>
  </g>;
  if(pose.operator==="reveal")return <g data-semantic-path="reveal">
    <rect x="1260" y="410" width="360" height="210" rx="25" fill="none" stroke="#83C9C0" strokeWidth="2" strokeDasharray="11 13"/>
    <path d="M1280 629 H1600" stroke="#81C4BF" strokeWidth="5" strokeLinecap="round"/>
  </g>;
  return null;
}

export function SemanticMechanicScene({mechanic,phase,motion,reducedMotion=false,localFrame,durationFrames,fps}:{
  mechanic:VisualMechanicV1;phase:"problem"|"mechanism"|"payoff";
  motion:SemanticFrame;reducedMotion?:boolean;localFrame?:number;durationFrames?:number;fps?:RationalFps;
}){
  const pose=compileSemanticMechanic(mechanic,{
    phase,progress:motion.completion,payoffLocked:motion.isPayoffPending,reducedMotion,
    localFrame,durationFrames,fps
  });
  return <g data-semantic-operator={pose.operator} data-semantic-phase={phase}
    data-semantic-safe-bounds="1040,230,1820,920" data-kumiki-vt1={pose.kumikiBacked?"true":"false"}
    data-semantic-payoff-locked={motion.isPayoffPending?"true":"false"}>
    <defs><clipPath id="contentgen-semantic-safe"><rect x="1040" y="230" width="780" height="690"/></clipPath></defs>
    <g clipPath="url(#contentgen-semantic-safe)">
      <rect x="1053" y="250" width="754" height="638" rx="32" fill="#132C39" fillOpacity=".48" stroke="#3D6570" strokeWidth="2"/>
      <text x="1090" y="305" fill="#B9D7D8" fontSize="21" letterSpacing="2" fontWeight="750">{titles[pose.operator]}</text>
      {pose.operator==="transfer"&&<text x="1100" y="830" fill="#AFC9D2" fontSize="25" fontWeight="650">
        {mechanic.actors.find(a=>a.id===mechanic.subjectId)?.label}
      </text>}
      <Paths pose={pose}/>
      {pose.actors.map(actor=><Actor key={actor.id} actor={actor}/>)}
    </g>
  </g>;
}
