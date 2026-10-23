
import type { ReactNode } from "react";
import type { GeneralFrame } from "../../scripts/video-production/general-visual-plan.mjs";
import type { SemanticFrame } from "./semantic-scene-motion";

type NodeRenderer=(args:{x:number;y:number;width:number;height:number;label:string;note?:string;index:number;highlight?:boolean})=>ReactNode;
export interface SceneDiagramsProps {state:GeneralFrame;motion:SemanticFrame;renderNode:NodeRenderer;}
const gold="#EFC08B", sea="#8CDAD2", ghost="#8AA8B5", white="#F5F2EB";
function AnimatedNode({label,note,index,x,y,width,height,motion,renderNode}:{
  label:string;note?:string;index:number;x:number;y:number;width:number;height:number;
  motion:SemanticFrame;renderNode:NodeRenderer
}){
  const item=motion.reveal[index];
  if(!item.visible)return null;
  const tx=x+width/2,ty=y+height/2;
  return <g data-semantic-node={index} data-semantic-focus={item.focused?"true":"false"}
    opacity={item.opacity} transform={`translate(0 ${item.offset}) translate(${tx} ${ty}) scale(${item.scale}) translate(${-tx} ${-ty})`}>
    {renderNode({x,y,width,height,label,note,index,highlight:item.focused})}
  </g>;
}
function IntroLens({state,motion,renderNode}:SceneDiagramsProps){
  const all=state.visual.items;
  const spin=motion.lightSweep*55;
  return <g data-semantic-layout="question-lens" data-semantic-pending="true">
    <circle cx="1426" cy="520" r="228" fill="#8CDAD2" fillOpacity=".035"/>
    <circle cx="1426" cy="520" r="210" fill="none" stroke="#72929F" strokeWidth="2"
      strokeDasharray="14 21" opacity=".5" transform={`rotate(${spin} 1426 520)`}/>
    <circle cx="1426" cy="520" r="176" fill="none" stroke={gold} strokeOpacity=".45"
      strokeDasharray="5 16" strokeWidth="2" transform={`rotate(${-spin/2} 1426 520)`}/>
    <path d="M1125 520 H1060 M1726 520 H1790" stroke={sea} strokeWidth="2" opacity=".45"/>
    <g transform={`translate(0 ${-motion.completion*20})`}>
      <AnimatedNode label={all[0]} note={state.visual.itemNotes?.[0]} index={0} x={1110} y={447} width={640} height={146} motion={motion} renderNode={renderNode}/>
    </g>
    {all.slice(1).map((label,i)=>{
      const others=all.length-1,twoColumns=others>=3,cols=twoColumns?2:1;
      const width=twoColumns?304:610;
      const rows=Math.ceil(others/cols),col=i%cols,row=Math.floor(i/cols);
      const y=rows>1?654+row*115:681,x=twoColumns?1085+col*370:1128;
      return <AnimatedNode key={i} label={label} note={state.visual.itemNotes?.[i+1]} index={i+1} x={x} y={y}
        width={width} height={93} motion={motion} renderNode={renderNode}/>;
    })}
    <g opacity={1-motion.completion*.7}>
      <rect x="1354" y="304" width="145" height="47" rx="23" fill="#233743" stroke={gold} strokeWidth="2" />
      <text x="1426" y="335" fill={gold} textAnchor="middle" fontSize="22" fontWeight="750" letterSpacing="2">QUESTION</text>
    </g>
  </g>;
}
function Contrast({state,motion,renderNode}:SceneDiagramsProps){
  const all=state.visual.items,compact=all.length>3;
  const gap=all.length===3?25:40,width=all.length===3?220:325;
  return <g data-semantic-layout="contrast">
    <path d="M1050 425 H1800 M1050 698 H1800" stroke="#668391" strokeWidth="1.5" opacity=".5"/>
    <rect x={1052+motion.lightSweep*660} y="421" width="70" height="3" rx="2" fill={sea} fillOpacity=".8"/>
    {all.map((label,index)=>{
      const x=compact?1052+(index%2)*387:1060+index*(width+gap);
      const y=compact?325+Math.floor(index/2)*170:470;
      return <AnimatedNode key={index} label={label} note={state.visual.itemNotes?.[index]} index={index} x={x} y={y}
        width={compact?348:width} height={compact?132:165} motion={motion} renderNode={renderNode}/>;
    })}
    {!compact&&all.slice(1).map((_,i)=>{
      const item=motion.reveal[i+1];if(!item.visible)return null;
      return <text key={i} x={1040+(i+1)*(width+gap)} y={560}
        opacity={item.opacity} fill={gold} textAnchor="middle" fontSize="24" fontWeight="800">VS</text>;
    })}
    <text x="1422" y={compact?903:772} textAnchor="middle" fill={ghost} fontSize="20" letterSpacing="3">
      QUALITATIVE COMPARISON
    </text>
  </g>;
}
function Decomposition({state,motion,renderNode}:SceneDiagramsProps){
  const all=state.visual.items,height=94,gap=18;
  const startY=540-(all.length*height+(all.length-1)*gap)/2;
  return <g data-semantic-layout="decomposition" data-general-breakdown="qualitative">
    <path d={`M1048 ${startY+47} V${startY+(all.length-1)*(height+gap)+47}`}
      stroke={sea} strokeWidth="4" strokeOpacity=".45" strokeLinecap="round"/>
    {all.map((label,index)=>{
      const y=startY+index*(height+gap),pointY=y+height/2,item=motion.reveal[index];
      return <g key={index}>
        {item.visible&&<g opacity={item.opacity}>
          <circle cx="1048" cy={pointY} r={item.focused?12:8} fill={item.focused?gold:sea}/>
          <path d={`M1055 ${pointY} H1077`} stroke={gold} strokeWidth="2"
            strokeDasharray="22" strokeDashoffset={22*(1-item.opacity)}/>
        </g>}
        <AnimatedNode label={label} note={state.visual.itemNotes?.[index]} index={index} x={1077} y={y} width={680} height={height}
          motion={motion} renderNode={renderNode}/>
      </g>;
    })}
    <text x="1417" y={startY+all.length*height+(all.length-1)*gap+44}
      fontSize="20" fill={ghost} letterSpacing="2" textAnchor="middle">QUALITATIVE · NOT TO SCALE</text>
    <g transform={`translate(${1700-motion.lightSweep*240} 0)`} opacity=".22">
      <path d={`M0 ${startY-17} v${all.length*(height+gap)-gap+20}`} stroke={gold} strokeWidth="2"/>
    </g>
  </g>;
}
function Synthesis({state,motion,renderNode}:SceneDiagramsProps){
  const all=state.visual.items;
  if(motion.isPayoffPending)return <g data-semantic-layout="synthesis" data-payoff-locked="true"/>;
  const height=100,gap=all.length===5?12:23;
  const top=all.length===5?218:285;
  const base=top+(all.length-1)*(height+gap);
  const targetY=Math.min(877,base+height+74);
  return <g data-semantic-layout="synthesis" data-semantic-pending="false">
    {all.map((label,index)=>{
      const y=top+index*(height+gap),mid=y+height/2,item=motion.reveal[index];
      return <g key={index}>
        {item.visible&&<path d={`M1728 ${mid} Q1770 ${mid} 1680 ${targetY}`}
          fill="none" stroke={index===all.length-1?gold:sea} strokeWidth="2"
          strokeDasharray="7 12" strokeDashoffset={Math.round((1-motion.connectorProgress)*60)}
          strokeOpacity={item.opacity*.55}/>}
        <AnimatedNode label={label} note={state.visual.itemNotes?.[index]} index={index} x={1102} y={y} width={625} height={height}
          motion={motion} renderNode={renderNode}/>
      </g>;
    })}
    {motion.connectorProgress>.1&&<g data-semantic-conclusion=""
      opacity={motion.connectorProgress} transform={`translate(0 ${(1-motion.connectorProgress)*24})`}>
      <rect x="1258" y={targetY-31} width="338" height="54" rx="27" fill="#2D5154"
        stroke={gold} strokeWidth="2"/>
      <text x="1427" y={targetY+5} textAnchor="middle" fill={white}
        fontSize="24" fontWeight="750" letterSpacing="3">THE CONNECTION</text>
    </g>}
  </g>;
}
export function SemanticDiagram(props:SceneDiagramsProps){
  const {state,motion}=props;
  const perspective=`translate(${motion.cameraX} ${motion.cameraY}) translate(1420 565) scale(${motion.cameraScale}) translate(-1420 -565)`;
  return <g data-semantic-scene={motion.style} data-teaching-phase={motion.phase}
    data-semantic-subjects={state.visual.direction?.subjectIds.join(",")??undefined}
    transform={perspective}>
    {state.intent==="general-intro"?<IntroLens {...props}/>:
      state.intent==="general-comparison"?<Contrast {...props}/>:
      state.intent==="general-breakdown"?<Decomposition {...props}/>:
      state.intent==="general-payoff"?<Synthesis {...props}/>:null}
  </g>;
}
