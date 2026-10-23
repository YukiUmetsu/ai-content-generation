/** Generic research-linked visible change. Same React/SVG scene in preview and MP4.
 * Shows a persistent subject and a real before/change/after disclosure; arbitrary
 * 3D and unsourced measurements remain outside this renderer's capabilities.
 */
import type {GeneralFrame} from "../../scripts/video-production/general-visual-plan.mjs";
import {fitSvgText} from "../../scripts/video-production/text-layout.mjs";
import {sampleTeachingTransition} from "../../scripts/video-production/teaching-state-transition.mjs";
import type {SemanticFrame} from "./semantic-scene-motion";

const paper="#F4F3EE",muted="#A9BEC8",cyan="#8CDAD2",gold="#EFC08B";
const geometry={left:1080,right:1490,width:310,top:386,height:267,actionLeft:1090,
  actionTop:713,actionWidth:700,actionHeight:160};

function Lines({copy,x,y,width,preferred=29,min=19,max=4,leading=41,color=paper}:{
  copy:string;x:number;y:number;width:number;preferred?:number;min?:number;
  max?:number;leading?:number;color?:string;
}){
  const fitting=fitSvgText(copy,{maxWidthPx:width,preferredSize:preferred,minSize:min,maxLines:max});
  return <g>{fitting.lines.map((line,index)=><text key={index} x={x} y={y+index*leading}
    fontSize={fitting.fontSize} fill={color} fontWeight="700">{line}</text>)}</g>;
}

export function TeachingStateScene({state,motion}:{state:GeneralFrame;motion:SemanticFrame}){
  const direction=state.visual.direction;
  const values=direction?.transformation;
  if(!direction||!values||!["problem","mechanism","payoff"].includes(direction.phase))return null;
  const phase=direction.phase as "problem"|"mechanism"|"payoff";
  const display=sampleTeachingTransition({phase,progress:motion.completion,
    payoffLocked:phase==="payoff"&&motion.isPayoffPending});
  const subject=values.subjectId.replace(/[-_]+/gu," ");
  const connectorStart=geometry.left+geometry.width+14;
  const connectorEnd=geometry.right-17;
  const centerY=geometry.top+125;
  return <g data-teaching-state-stage={phase}
    data-teaching-safe-bounds="1040,230,1820,920"
    data-teaching-payoff-locked={phase==="payoff"&&motion.isPayoffPending?"true":"false"}
    data-teaching-travel-progress={display.travelProgress}
    transform={`translate(${motion.cameraX} ${motion.cameraY})`}>
    {display.beforeVisible&&<g opacity={display.beforeOpacity} data-teaching-subject={values.subjectId}
      role="group" aria-label={values.before}>
      <text x="1078" y="290" fill={gold} fontSize="22" letterSpacing="3" fontWeight="700">SAME SUBJECT</text>
      <Lines copy={subject} x={1078} y={334} width={702} preferred={35} min={22} max={2}
        leading={42} color={paper}/>
      <rect x={geometry.left} y={geometry.top} width={geometry.width} height={geometry.height}
        rx="26" fill="#1E3D48" stroke={cyan} strokeWidth="3"/>
      <rect x={geometry.left+19} y={geometry.top+19} width="14" height="14" rx="4" fill={cyan}/>
      <text x={geometry.left+45} y={geometry.top+35} fontSize="19" letterSpacing="2.4"
        fill={cyan} fontWeight="800">BEFORE</text>
      <Lines copy={values.before} x={geometry.left+26} y={geometry.top+110}
        width={geometry.width-52}/>
    </g>}
    {display.beforeVisible&&<g>
      <path d={`M${connectorStart} ${centerY} H${connectorEnd}`} stroke="#597783"
        strokeWidth="5" strokeDasharray="12 13" strokeLinecap="round" opacity=".75"/>
      {display.travelProgress>0&&<path d={`M${connectorStart} ${centerY} H${connectorStart+(connectorEnd-connectorStart)*display.travelProgress}`}
        stroke={gold} strokeWidth="6" strokeLinecap="round" data-teaching-change-path=""/>}
      {display.actionVisible&&<circle data-teaching-moving-subject="" cx={connectorStart+(connectorEnd-connectorStart)*display.travelProgress}
        cy={centerY} r="11" fill={gold} stroke="#172936" strokeWidth="3"/>}
      {display.afterVisible?<g opacity={display.afterOpacity} data-teaching-result=""
        role="group" aria-label={values.after}>
        <rect x={geometry.right} y={geometry.top} width={geometry.width} height={geometry.height}
          rx="26" fill="#285650" stroke={gold} strokeWidth="3"/>
        <rect x={geometry.right+19} y={geometry.top+19} width="14" height="14" rx="4" fill={gold}/>
        <text x={geometry.right+45} y={geometry.top+35} fontSize="19" letterSpacing="2.4"
          fill={gold} fontWeight="800">AFTER</text>
        <Lines copy={values.after} x={geometry.right+26} y={geometry.top+110}
          width={geometry.width-52}/>
      </g>:<g data-teaching-result-hidden="">
        <rect x={geometry.right} y={geometry.top} width={geometry.width} height={geometry.height}
          rx="26" fill="#1B3240" fillOpacity=".7" stroke="#4A6D76" strokeWidth="2"
          strokeDasharray="9 13"/>
        <text x={geometry.right+geometry.width/2} y={geometry.top+151} fontSize="84"
          fill={muted} textAnchor="middle" opacity=".7">?</text>
      </g>}
    </g>}
    {display.actionVisible&&<g opacity={display.actionOpacity} data-teaching-operation=""
      role="group" aria-label={values.action}>
      <rect x={geometry.actionLeft} y={geometry.actionTop} width={geometry.actionWidth}
        height={geometry.actionHeight} rx="22" fill="#213E49" stroke="#527D7E" strokeWidth="2"/>
      <text x={geometry.actionLeft+25} y={geometry.actionTop+36} fill={gold}
        fontSize="19" letterSpacing="2.5" fontWeight="800">WHAT CHANGES</text>
      <Lines copy={values.action} x={geometry.actionLeft+25} y={geometry.actionTop+80}
        width={geometry.actionWidth-50} preferred={26} min={20} max={3} leading={31}/>
    </g>}
  </g>;
}
