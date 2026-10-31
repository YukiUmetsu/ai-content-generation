import { createContext, forwardRef, useContext } from "react";
import { Asset, AssetRendererContext, OverlayRendererContext, KineticWords, cinematicEase, clamp01, cueAt, expoOut, filmGrain, fitLongestWord, motionAt, span01 } from "./stages/stage-kit";
import type { SceneAssetRenderer, SceneOverlayRenderer } from "./stages/stage-kit";
export type { SceneAssetRenderer, SceneOverlayContext, SceneOverlayRenderer } from "./stages/stage-kit";
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { evaluateSceneTemplate } from "./scene-templates";
import { sampleEnvironmentFrame } from "./environment-parallax";
import type { ImageAsset, LabeledAsset, DataPoint, SceneRecipeId, SceneTemplateFrame, SceneTemplateSpec, FocusRegion, QuestionAnswerStep } from "./scene-templates";
import { annotationState, coverPoint } from "./subject-annotations";
import type { AnnotationBeats } from "./subject-annotations";
import { SubjectAnnotationLayer } from "./subject-annotations-react";
import { PlaceShapedImageRevealStage } from "./stages/place-shaped-image-reveal-stage";
import { ReliefMapExpeditionStage } from "./stages/relief-map-expedition-stage";
import { NatureWorldIdentityRevealStage } from "./stages/nature-world-identity-reveal-stage";
import { IllustratedBookStage } from "./stages/illustrated-book-stage";
import { FollowSubjectThroughSectionsStage } from "./stages/follow-subject-through-sections-stage";
import { TimelineJourneyStage } from "./stages/timeline-journey-stage";
import { PageTurnStoryStage } from "./stages/page-turn-story-stage";
import { OrbitWorldStage } from "./stages/orbit-world-stage";

const PortraitContext=createContext(false);
const styles = {
  stage: { position:"relative", overflow:"hidden", isolation:"isolate", display:"flex", flexDirection:"column",
    boxSizing:"border-box", width:"100%", containerType:"inline-size", color:"var(--km-text-primary, #f6f4ed)",
    background:"var(--km-surface-canvas, #102133)", padding:"4.5%", fontFamily:"var(--km-font-body, system-ui, sans-serif)",
    fontSize:"clamp(13px, 2cqw, 31px)", lineHeight:1.36 } satisfies CSSProperties,
  title:{ fontSize:"1.72em", fontWeight:760, letterSpacing:"-0.035em", lineHeight:1.12, margin:"0 0 0.55em",
    maxWidth:"26ch", textWrap:"balance" } as CSSProperties,
  label:{ fontSize:".65em", fontWeight:650, textTransform:"uppercase", letterSpacing:".12em", opacity:.75 } as CSSProperties,
  deck:{ display:"flex",flex:1,minHeight:0,alignItems:"stretch",gap:"2.2%",width:"100%" } as CSSProperties,
  tile:{minWidth:0, flex:"1 1 0", border:"1px solid rgba(236,243,250,.22)", borderRadius:".8em",
    background:"rgba(16,36,54,.72)",padding:"1.4em",boxSizing:"border-box",display:"flex",flexDirection:"column",gap:".5em",
    justifyContent:"center",overflow:"hidden"} as CSSProperties,
  note:{fontSize:".83em", opacity:.86, lineHeight:1.45,overflowWrap:"anywhere"} as CSSProperties,
  feature:{ fontSize:"1.15em",fontWeight:720,margin:0,overflowWrap:"anywhere"} as CSSProperties,
  image:{ width:"100%", height:"100%", objectFit:"cover", minHeight:0, borderRadius:".35em" } as CSSProperties,
  line:{ height:2,background:"var(--km-accent, #9fd9ce)",opacity:.8,margin:"1em 0" } as CSSProperties,
} as const;
/**
 * Frame-exact editorial motion helpers. Seekable and interruptible by design:
 * no CSS transitions, no timers, no React state, no dependence on frame history.
 * Each recipe chooses its own meaningful visual motion instead of sharing slides.
 */
function EditorialMotion({frame,start=0,end=22,fromX=0,fromY=0,scaleFrom=1,tilt=0,minOpacity=0,children,
  style={},name}: {frame:SceneTemplateFrame;start?:number;end?:number;fromX?:number;fromY?:number;
  scaleFrom?:number;tilt?:number;minOpacity?:number;children:ReactNode;style?:CSSProperties;name?:string}) {
  const p=motionAt(frame,start,end);
  return <div data-km-motion={name} data-km-motion-progress={p.toFixed(4)} style={{
    ...style,opacity:minOpacity+(1-minOpacity)*p,transform:`translate3d(${fromX*(1-p)}%,${fromY*(1-p)}%,0) scale(${scaleFrom+(1-scaleFrom)*p}) rotate(${tilt*(1-p)}deg)`,
    transformOrigin:"center center",willChange:"transform, opacity"
  }}>{children}</div>;
}
function KineticMedia({asset,frame,focus,highlight=false,zoom=1.14,name,overlays,rounded=true}:{
  asset:ImageAsset;frame:SceneTemplateFrame;focus?:FocusRegion;highlight?:boolean;zoom?:number;name?:string;
  rounded?:boolean;
  /** Rendered inside the same camera transform, so authored regions cannot drift. */
  overlays?:ReactNode;
}) {
  const start=cueAt(frame,0),end=cueAt(frame,2);
  const p=motionAt(frame,start,end);
  const centerX=focus?focus.x+focus.width*.5:.5,centerY=focus?focus.y+focus.height*.5:.5;
  // Physical push-in towards the subject. Do not expose blank image edges when
  // the authored focus is close to the frame boundary.
  const scale=1+(zoom-1)*p;
  const desiredX=(.5-centerX)*100*p,desiredY=(.5-centerY)*100*p;
  const maxX=centerX*(scale-1)*100,minX=-(1-centerX)*(scale-1)*100;
  const maxY=centerY*(scale-1)*100,minY=-(1-centerY)*(scale-1)*100;
  const x=Math.max(minX,Math.min(maxX,desiredX));
  const y=Math.max(minY,Math.min(maxY,desiredY));
  return <div data-km-cinematic-media={name} data-km-camera-progress={p.toFixed(4)}
    data-km-camera-zoom={scale.toFixed(4)}
    style={{width:"100%",height:"100%",position:"relative",overflow:"hidden",borderRadius:rounded?".4em":0}}>
    <div style={{width:"100%",height:"100%",
      transform:`translate3d(${x}%,${y}%,0) scale(${scale})`,
      transformOrigin:`${centerX*100}% ${centerY*100}%`,willChange:"transform"}}>
      <Asset asset={asset}/>
      {focus&&<Focus region={focus} emphasized={highlight&&frame.frame>=cueAt(frame,0)}/>}
      {overlays}
    </div>
  </div>;
}
function ScanBeam({frame,color="var(--km-accent, #9fd9ce)"}:{frame:SceneTemplateFrame;color?:string}){
  const p=motionAt(frame,cueAt(frame,0),cueAt(frame,2));
  return <div aria-hidden="true" data-km-scan-beam="" style={{position:"absolute",inset:0,pointerEvents:"none",
    background:`linear-gradient(90deg,transparent 0%,${color} 50%,transparent 100%)`,
    width:"12%",height:"100%",filter:"blur(.6em)",mixBlendMode:"screen",
    transform:`translateX(${p*850}%)`,opacity:frame.reducedMotion?0:.33*(1-p)}}/>;
}
/** A layered, real backdrop-sampling frosted panel (not raytraced glass).
 * Its border and interior specular rays use only the host's absolute frame.
 * Text stays above all decorative optical effects for stable contrast.
 */
function GlassLensPane({panel,material,frame,index}:{
  panel:{id:string;label:string;text:string};
  material?:{tint:string;opacity:number;blurPx:number;borderColor?:string;
    rimIntensity?:number;causticIntensity?:number};
  frame:SceneTemplateFrame;index:number;
}) {
  const reduced=frame.reducedMotion;
  const rim=material?.rimIntensity??.62,caustic=material?.causticIntensity??.46;
  const progress=motionAt(frame,cueAt(frame,0)+index*7,cueAt(frame,2)+index*7+8);
  const sweep=-45+170*progress;
  const clearColor=material
    ?`color-mix(in srgb,${material.tint} ${Math.round(material.opacity*100)}%,rgba(11,37,52,.55))`
    :"rgba(125,183,208,.20)";
  return <div data-km-glass-lens={panel.id} data-km-glass-ray={progress.toFixed(4)}
    style={{...styles.tile,flex:1,position:"relative",isolation:"isolate",
      overflow:"hidden",justifyContent:"center",minWidth:0,
      padding:"1.3em",gap:".45em",
      background:reduced?"rgba(12,34,50,.97)":clearColor,
      backdropFilter:reduced?"none":`blur(${material?.blurPx??12}px) saturate(1.38) contrast(1.09)`,
      border:"1px solid "+(material?.borderColor??"rgba(233,249,255,.67)"),
      borderRadius:".95em",
      boxShadow:reduced?"0 1em 1.5em rgba(2,11,22,.25)":
        "0 1.3em 2.5em rgba(1,12,30,.28),inset .1em .1em .22em rgba(246,255,254,.17)",
    }}>
    <div aria-hidden="true" data-km-glass-fresnel="" style={{
      position:"absolute",inset:0,pointerEvents:"none",
      borderRadius:"inherit",
      background:`linear-gradient(133deg,rgba(247,255,255,${.34*rim}) 0%,transparent 24%,transparent 72%,rgba(128,215,235,${.19*rim}) 100%)`,
      boxShadow:`inset 1px 1px 0 rgba(255,255,255,${.7*rim}),inset -2px -3px 6px rgba(6,35,59,${.45*rim})`,
    }}/>
    {!reduced&&<div aria-hidden="true" data-km-glass-caustic="" style={{
      position:"absolute",top:"-27%",bottom:"-27%",left:sweep+"%",
      width:"19%",pointerEvents:"none",
      transform:"skewX(-22deg)",
      opacity:caustic*(.4+.6*Math.sin(progress*Math.PI)),
      background:"linear-gradient(90deg,transparent 0%,rgba(212,255,250,.1) 29%,rgba(243,255,255,.58) 46%,rgba(124,218,243,.13) 65%,transparent 100%)",
      filter:"blur(.35em)",mixBlendMode:"screen",
    }}/>}
    <div aria-hidden="true" style={{position:"absolute",inset:"2% 3%",
      border:"1px solid rgba(224,255,247,.12)",borderRadius:".72em",pointerEvents:"none"}}/>
    <div style={{zIndex:1,position:"relative",textShadow:"0 1px 8px rgba(3,21,37,.7)"}}>
      <Label>{panel.label}</Label>
    </div>
    <div style={{zIndex:1,position:"relative",fontSize:"1.08em",fontWeight:750,
      letterSpacing:"-.015em",lineHeight:1.3,
      textShadow:"0 2px 12px rgba(1,21,38,.88)",overflowWrap:"anywhere"}}>
      {panel.text}
    </div>
  </div>;
}
function Word({children,small=false}: {children:ReactNode;small?:boolean}) {
  return <span style={small?styles.note:styles.feature}>{children}</span>;
}
function Tile({children,style}: {children:ReactNode;style?:CSSProperties}) {
  return <div style={{...styles.tile,...style}}>{children}</div>;
}
function ImageTile({asset,title,note,style}: {asset?:ImageAsset;title?:string;note?:string;style?:CSSProperties}) {
  return <Tile style={style}>{title&&<Word>{title}</Word>}{asset&&<div style={{minHeight:0,flex:1}}><Asset asset={asset}/></div>}{note&&<span style={styles.note}>{note}</span>}</Tile>;
}
function Label({children}: {children:ReactNode}) { return <span style={styles.label}>{children}</span>; }
function Chevron({char="→"}:{char?:string}) {return <span aria-hidden="true" style={{alignSelf:"center",fontSize:"1.65em",opacity:.8}}>{char}</span>;}
function Head({eyebrow,title,detail}: {eyebrow:string;title:string;detail?:string}) {
  return <header style={{flex:"0 0 auto",paddingBottom:"1.25%",minWidth:0}}>
    <Label>{eyebrow}</Label><h2 style={styles.title}>{title}</h2>{detail&&<p style={{...styles.note,margin:"0 0 .4em"}}>{detail}</p>}
  </header>;
}
function Chain({items,shown,final,frame}: {items:string[];shown:number;final?:string;frame:SceneTemplateFrame}) {
  const portrait=useContext(PortraitContext);
  const visible=items.slice(0,Math.max(0,shown));
  return <div style={{...styles.deck,alignItems:"center",flexDirection:portrait?"column":"row"}}>
    {visible.map((text,i)=><div key={i} style={{display:"contents"}}>
      {i>0&&<Chevron/>}<EditorialMotion frame={frame} start={cueAt(frame,0)+(i*6)} end={cueAt(frame,0)+(i*6)+13} fromY={18} scaleFrom={.94} style={{flex:"1 1 0",display:"flex"}} name="causal-step"><Tile><Label>Step {i+1}</Label><Word>{text}</Word></Tile></EditorialMotion>
    </div>)}
    {final&&shown>=items.length&&<><Chevron/><EditorialMotion frame={frame} start={cueAt(frame,2)} end={cueAt(frame,2)+14} fromX={15} style={{flex:"1 1 0",display:"flex"}} name="causal-outcome"><Tile style={{borderColor:"var(--km-accent, #9fd9ce)"}}><Label>Outcome</Label><Word>{final}</Word></Tile></EditorialMotion></>}
  </div>;
}
function ChartBars({data,unit,shown,baseline,frame}: {data:DataPoint[];unit:string;shown:number;baseline?:number;frame:SceneTemplateFrame}) {
  const values=data.map(x=>x.value);
  const min=Math.min(0,baseline??0,...values),max=Math.max(0,baseline??0,...values);
  const span=Math.max(1e-9,max-min);
  // Explicit shared zero axis. Negative values must extend downward, not
  // turn into an unsigned bar that reverses the supplied insight.
  const zeroBottom=18+72*(0-min)/span;
  return <div style={{display:"flex",position:"relative",height:"100%",width:"100%",gap:"2.5%",padding:"3% 2% 1%",
    boxSizing:"border-box"}}>
    <div data-km-zero-baseline="" aria-hidden="true" style={{position:"absolute",left:"2%",right:"2%",
      bottom:zeroBottom+"%",borderTop:"1px solid rgba(245,251,255,.48)",pointerEvents:"none"}}/>
    {data.map((d,i)=>{
      const grow=i<shown?motionAt(frame,cueAt(frame,0)+i*5,cueAt(frame,1)+i*5+14):0;
      const barHeight=Math.abs(d.value)/span*72*grow;
      const bottom=d.value>=0?zeroBottom:zeroBottom-barHeight;
      return <div key={d.id} style={{position:"relative",height:"100%",minWidth:0,flex:1,
        display:"flex",flexDirection:"column",justifyContent:"flex-end"}}>
        <span style={{position:"absolute",top:0,width:"100%",textAlign:"center",
          fontSize:".66em",opacity:i<shown?1:.28,overflowWrap:"anywhere"}}>
          {i<shown?(Math.abs(d.value*grow)<1?d.value*grow:Math.round(d.value*grow*100)/100).toLocaleString()+" "+unit:""}
        </span>
        <div data-km-chart-bar={d.id} aria-hidden="true" style={{position:"absolute",left:"18%",width:"64%",
          bottom:bottom+"%",height:barHeight+"%",
          background:"var(--km-accent, #9fd9ce)",opacity:d.value<0?.56:.9,
          borderRadius:".2em"}}/>
        <span style={{position:"absolute",bottom:0,left:0,right:0,textAlign:"center",fontSize:".64em",
          overflowWrap:"anywhere",opacity:i<shown?1:.36}}>{d.label}</span>
      </div>;
    })}
  </div>;
}
function Focus({region,emphasized=true}:{region:FocusRegion;emphasized?:boolean}) {
  return emphasized?<div aria-hidden="true" data-km-inspection-target="" style={{position:"absolute",
    left:(region.x*100)+"%",top:(region.y*100)+"%",width:(region.width*100)+"%",height:(region.height*100)+"%",
    border:".16em solid var(--km-accent, #9fd9ce)",boxShadow:"0 0 0 999px rgba(10,22,38,.14), 0 0 .8em rgba(154,221,212,.35)",
    borderRadius:".3em",boxSizing:"border-box"}}/>:null;
}
function TimeStrip({items,active,spacing="equal",frame}:{
  items:{id:string;label:string;date?:string;image?:ImageAsset}[];
  active:number;spacing?:"equal"|"elapsed";frame?:SceneTemplateFrame;
}) {
  const selected=Math.min(active,items.length-1);
  if(spacing==="elapsed" && items.length>1 && items.every(item=>item.date)) {
    const times=items.map(item=>Date.parse(item.date!));
    const min=Math.min(...times),max=Math.max(...times),range=Math.max(1,max-min);
    const x=frame?5+90*frame.frame/Math.max(1,frame.durationFrames-1):5+90*(times[selected]-min)/range;
    return <div style={{position:"relative",height:"100%",width:"100%"}}>
      <div aria-hidden="true" style={{position:"absolute",height:"2px",background:"rgba(245,251,255,.46)",
        top:"55%",left:"5%",right:"5%"}}/>
      {items.map((item,i)=>{
        const x=5+90*(times[i]-min)/range;
        return <div key={item.id} data-km-timeline-event={item.id} data-km-event-x={x}
          style={{position:"absolute",left:x+"%",top:"55%",transform:"translate(-50%,-5%)",
            display:"flex",flexDirection:"column",gap:".2em",alignItems:"center",textAlign:"center",
            width:Math.min(22,88/items.length)+"%",opacity:i>active?.3:1}}>
          <span aria-hidden="true" style={{height:".6em",width:".6em",borderRadius:"50%",
            background:"var(--km-accent, #9fd9ce)",boxShadow:"0 0 0 .2em #17334b"}}/>
          <Label>{item.date}</Label><span style={{fontSize:".77em",overflowWrap:"anywhere"}}>{item.label}</span>
          {item.image&&<div style={{height:"4em",width:"100%"}}><Asset asset={item.image}/></div>}
        </div>;
      })}
      {frame&&<div data-km-timeline-playhead="" data-km-playhead-x={x.toFixed(2)} aria-hidden="true"
        style={{position:"absolute",left:x+"%",top:"51%",width:".72em",height:".72em",
          borderRadius:"50%",background:"var(--km-accent, #9fd9ce)",
          boxShadow:"0 0 1.4em rgba(140,236,224,.84)",transform:"translateX(-50%)",pointerEvents:"none"}}/>}
    </div>;
  }
  return <div style={{...styles.deck,alignItems:"center",gap:"1%",position:"relative"}}>
    {items.map((item,i)=><div key={item.id} data-km-timeline-event={item.id} style={{flex:1,
      opacity:i>active?.35:1,minWidth:0,
      borderTop:"3px solid "+(i<=active?"var(--km-accent, #9fd9ce)":"rgba(251,255,255,.28)"),
      display:"flex",paddingTop:".75em",flexDirection:"column",gap:".4em"}}>
      {item.date&&<Label>{item.date}</Label>}<Word>{item.label}</Word>
      {item.image&&<div style={{height:"5em",minHeight:0}}><Asset asset={item.image}/></div>}
    </div>)}
    {frame&&<div data-km-timeline-playhead="" aria-hidden="true" style={{position:"absolute",
      top:0,left:(frame?Math.max(0,Math.min(100,100*frame.frame/Math.max(1,frame.durationFrames-1))):((selected+.5)/Math.max(1,items.length))*100)+"%",
      width:".6em",height:".6em",transform:"translate(-50%,-40%)",
      borderRadius:"50%",background:"var(--km-accent, #9fd9ce)",
      boxShadow:"0 0 1.2em rgba(129,238,220,.8)",pointerEvents:"none"}}/>}
  </div>;
}
function GeometryGraph({nodes,edges,visible,frame}:{nodes:LabeledAsset[];edges:{from:string;to:string;label?:string}[];visible:number;frame:SceneTemplateFrame}) {
  const portrait=useContext(PortraitContext);
  const count=nodes.length,points=nodes.map((node,i)=>({
    id:node.id,
    x:portrait?50:13+74*(count===1?0.5:i/(count-1)),
    y:portrait?12+76*(count===1?0.5:i/(count-1)):44+16*Math.sin(i*2.4),
  }));
  return <div style={{position:"relative",height:"100%",width:"100%"}}>
    <svg viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none"
      style={{position:"absolute",width:"100%",height:"100%",inset:0,overflow:"visible"}}>
      {edges.slice(0,Math.max(0,visible-nodes.length)).map((e,i)=>{
        const a=points.find(p=>p.id===e.from),b=points.find(p=>p.id===e.to);
        return a&&b?<line key={i} data-km-animated-connection={i}
          x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke="var(--km-accent, #9fd9ce)" strokeWidth=".6"
          pathLength={1} strokeDasharray={1}
          strokeDashoffset={1-motionAt(frame,cueAt(frame,1)+i*5,cueAt(frame,1)+i*5+16)}/>:null;
      })}
    </svg>
    {nodes.map((node,i)=><div key={node.id} data-km-semantic-id={node.id} style={{
      position:"absolute",left:points[i].x+"%",top:points[i].y+"%",transform:"translate(-50%,-50%)",
      width:Math.min(25,72/Math.max(2,count))+"%",minHeight:"20%",
       opacity:i<visible?motionAt(frame,4+i*5,23+i*5):.12,
       scale:i<visible?String(.8+.2*motionAt(frame,4+i*5,23+i*5)):"0.8",
      display:"flex",justifyContent:"center",alignItems:"center",textAlign:"center",
      border:"2px solid var(--km-accent, #9fd9ce)",background:"var(--km-surface-canvas, #102133)",
      borderRadius:".7em",padding:".4em",boxSizing:"border-box",fontSize:".76em",overflowWrap:"anywhere"}}>
      {node.label}
    </div>)}
  </div>;
}
/**
 * Question Reveal is graded like a film plate rather than laid out like a slide:
 * full-bleed subject, kinetic question that docks into an anamorphic bar while
 * tension builds, answer beats tied to authored frames, and force vectors that
 * ride the camera so they stay attached to the subject through the push-in.
 */
const markerPaths={up:"M6 1.5L10 6H7.4v4.5H4.6V6H2z",down:"M6 10.5L10 6H7.4V1.5H4.6V6H2z",
  left:"M1.5 6L6 2v2.6h4.5v2.8H6V10z",right:"M10.5 6L6 2v2.6H1.5v2.8H6V10z"} as const;
function StepGlyph({marker="dot"}:{marker?:QuestionAnswerStep["marker"]}) {
  if(marker==="none") return null;
  return <span aria-hidden="true" data-km-step-marker={marker} style={{flex:"0 0 auto",width:"1.15em",height:"1.15em",borderRadius:"50%",
    display:"inline-flex",alignItems:"center",justifyContent:"center",alignSelf:"center",
    background:"var(--km-accent, #9fd9ce)",color:"#0b0f14"}}>
    <svg viewBox="0 0 12 12" width="62%" height="62%">{marker==="dot"
      ?<circle cx="6" cy="6" r="2.4" fill="currentColor"/>
      :<path d={markerPaths[marker]} fill="currentColor"/>}</svg>
  </span>;
}
function QuestionRevealStage({spec,f}:{spec:SceneTemplateSpec<"question-reveal">;f:SceneTemplateFrame}) {
  const c=spec.content,w=spec.width,h=spec.height,portrait=h>w,t=f.frame,reduced=f.reducedMotion;
  const dock=cueAt(f,0),reveal=cueAt(f,1),show=f.phaseIndex>=2,final=f.phaseIndex===3;
  const asset=show&&c.answerVisual?c.answerVisual:c.subject;
  const steps=(c.answerSteps??[]).map(step=>({...step,at:step.frame??reveal}));
  const firstAnswer=steps.length?steps[0].at:reveal;
  const answerVisible=t>=firstAnswer;
  // Camera: a slow tension push between dock and reveal, then a decaying kick on impact.
  const since=t-reveal,impact=c.revealImpact??"none";
  const kick=reduced||since<0||impact!=="kick"?0:Math.exp(-since/6.5);
  const push=reduced?0:.075*cinematicEase(span01(t,dock,reveal));
  const shakeX=kick*(1.1*Math.sin(since*1.9)+.45*Math.sin(since*4.3+1)),shakeY=kick*.8*Math.sin(since*2.6+.4);
  const flash=reduced||since<0||impact==="none"?0:.62*Math.exp(-since/4);
  // Anamorphic bars close with the dock (landscape only) and hold the docked question.
  const heroOut=reduced?(t>=dock?1:0):cinematicEase(span01(t,dock,dock+14));
  const dockIn=reduced?(t>=dock?1:0):expoOut(span01(t,dock+6,dock+26));
  const exposure=reduced?1:.6+.4*cinematicEase(span01(t,0,22));
  // Bright payoff plates flatten under a vignette; lift contrast as the answer lands.
  const graded=reduced?(show?1:0):span01(t,reveal,reveal+12);
  const look=c.look??{},letterbox=!portrait&&(look.letterbox??true);
  const bar=letterbox?9*(reduced?1:cinematicEase(span01(t,dock-4,dock+18))):0;
  const beats:AnnotationBeats={dock,reveal,resolve:cueAt(f,2),durationFrames:f.durationFrames,
    steps:Object.fromEntries(steps.map(step=>[step.id,step.at]))};
  const overlay=useContext(OverlayRendererContext);
  const marks=(space:"subject"|"stage")=><>
    {c.annotations&&<SubjectAnnotationLayer annotations={c.annotations} beats={beats} subject={asset}
      width={w} height={h} frame={t} reducedMotion={reduced} space={space}/>}
    {overlay?.({frame:f,width:w,height:h,beats,space,
      toStage:p=>space==="stage"?{x:p.x*w,y:p.y*h}:coverPoint(p,asset,w,h),
      state:timing=>annotationState(timing,beats,t,reduced)})}
  </>;  const camera:CSSProperties={position:"absolute",inset:0,transformOrigin:"50% 46%",willChange:"transform",
    transform:`translate3d(${shakeX}%,${shakeY}%,0) scale(${1+push+.045*kick}) rotate(${kick*.35*Math.sin(since*1.3)}deg)`};
  return <div style={{position:"absolute",inset:0,overflow:"hidden",background:"#05070a",
    fontSize:portrait?"clamp(13px, 3.5cqw, 44px)":"clamp(13px, 2cqw, 40px)"}}>
    <div data-km-cinematic-media="question-push-in" data-km-camera-zoom={(1+push).toFixed(4)} style={camera}>
      <div style={{position:"absolute",inset:0,filter:`brightness(${exposure}) saturate(${1.08+.12*graded}) contrast(${1.06+.08*graded})`}}>
        <Asset asset={asset} style={{borderRadius:0}}/>
      </div>
    </div>
    {/* Grade: vignette deepens with tension; grain keeps the plate filmic. */}
    <div aria-hidden="true" style={{position:"absolute",inset:0,pointerEvents:"none",
      background:`radial-gradient(ellipse 82% 78% at 50% 45%,transparent 50%,rgba(3,5,8,${(look.vignette??1)*(.28+.2*span01(t,dock,reveal)-.12*graded)}) 100%)`}}/>
    <div aria-hidden="true" style={{position:"absolute",inset:0,pointerEvents:"none",
      background:portrait
        ?`linear-gradient(0deg,rgba(4,6,10,${.82*Math.max(1-heroOut*.35,answerVisible?1:0)}) 0%,rgba(4,6,10,.5) 26%,transparent 46%)`
        :`linear-gradient(90deg,rgba(4,6,10,${.78*(1-heroOut)}) 0%,rgba(4,6,10,${.45*(1-heroOut)}) 38%,transparent 64%),linear-gradient(0deg,rgba(4,6,10,${answerVisible?.62+.16*graded:0}) ${bar}%,transparent 52%)`}}/>
    <div aria-hidden="true" data-km-film-grain="" style={{position:"absolute",inset:0,pointerEvents:"none",
      backgroundImage:filmGrain,mixBlendMode:"overlay",opacity:.32*(look.grain??1),
      backgroundPosition:reduced?"0 0":`${(t*67)%160}px ${(t*113)%160}px`}}/>
    <div aria-hidden="true" data-km-reveal-flash="" style={{position:"absolute",inset:0,pointerEvents:"none",
      opacity:flash,mixBlendMode:"screen",
      background:"radial-gradient(circle at 50% 55%,#fff6e4 0%,rgba(255,226,180,.85) 35%,rgba(255,200,140,.3) 75%)"}}/>
    {/* Marks ride a second camera layer above the grade so flash and vignette never wash them out. */}
    <div data-km-subject-overlay="" style={{...camera,pointerEvents:"none"}}>{marks("subject")}</div>
    <div data-km-stage-overlay="" style={{position:"absolute",inset:0,pointerEvents:"none"}}>{marks("stage")}</div>
    {letterbox&&<>
      <div aria-hidden="true" data-km-letterbox="top" style={{position:"absolute",left:0,right:0,top:0,height:bar+"%",background:"#040507"}}/>
      <div aria-hidden="true" data-km-letterbox="bottom" style={{position:"absolute",left:0,right:0,bottom:0,height:bar+"%",background:"#040507"}}/>
    </>}
    <h2 data-km-question-hero="" style={{...styles.title,position:"absolute",margin:0,maxWidth:"none",
      left:portrait?"7%":"6%",width:portrait?"86%":"54%",top:portrait?"54%":"26%",
      fontSize:fitLongestWord(c.question,portrait?2.7:3.05,portrait?86:54),fontWeight:780,letterSpacing:"-.042em",lineHeight:1.03,
      textShadow:"0 .04em .5em rgba(0,0,0,.45)",opacity:1-heroOut,
      transform:`translate3d(0,${-12*heroOut}%,0) scale(${1-.04*heroOut})`,transformOrigin:"0 0",
      filter:heroOut>0&&heroOut<1?`blur(${heroOut*5}px)`:undefined}}>
      <KineticWords text={c.question} emphasis={c.questionEmphasis} start={-3} frame={t} reduced={reduced}/>
    </h2>
    <div aria-hidden="true" data-km-question-dock="" style={{position:"absolute",display:"flex",
      flexDirection:portrait?"column":"row",alignItems:portrait?"flex-start":"center",gap:portrait?".25em":".6em",
      left:portrait?"7%":"6%",right:portrait?"7%":"6%",top:portrait?"5.5%":letterbox?`${bar/2}%`:"6%",
      transform:letterbox?"translateY(-50%)":undefined,fontSize:portrait?"1.1em":".98em",fontWeight:650,letterSpacing:"-.01em",
      opacity:t>=dock?1:0,clipPath:`inset(-20% ${100*(1-dockIn)}% -20% 0)`,textShadow:letterbox?undefined:"0 1px 10px rgba(0,0,0,.6)"}}>
      {(c.questionLabel??"Question")!==""&&<span style={{flex:"0 0 auto",fontSize:".72em",fontWeight:760,letterSpacing:".14em",textTransform:"uppercase",
        color:"var(--km-accent, #9fd9ce)"}}>{c.questionLabel??"Question"}</span>}
      {!portrait&&(c.questionLabel??"Question")!==""&&<span style={{flex:"0 0 auto",width:"1px",alignSelf:"stretch",background:"rgba(246,244,237,.35)"}}/>}
      <span style={{minWidth:0,opacity:.92}}>{c.question}</span>
    </div>
    <div data-km-answer-lane="" style={{position:"absolute",left:portrait?"7%":"6%",
      width:portrait?"86%":"35%",bottom:portrait?"5%":`calc(${bar}% + 5.5%)`}}>
      <div data-km-reveal-anticipation="" aria-hidden="true" style={{position:"absolute",top:0,left:0,
        height:".16em",width:"100%",background:"var(--km-accent, #9fd9ce)",transformOrigin:"left center",
        opacity:!reduced&&!show&&t>=reveal-48?.7:0,
        transform:`scaleX(${clamp01((t-(reveal-48))/48)})`}}/>
      <div data-km-motion="question-answer" aria-hidden={!show} style={{
        minWidth:0,overflowWrap:"anywhere",visibility:show||answerVisible?"visible":"hidden",
        opacity:firstAnswer<reveal?(answerVisible?1:0):show?motionAt(f,reveal,reveal+16):0}}>
        <div data-km-answer-accent="" aria-hidden="true" style={{height:".16em",width:"100%",
          background:"var(--km-accent, #9fd9ce)",transformOrigin:"left center",
          transform:`scaleX(${show?motionAt(f,reveal,reveal+16):0})`}}/>
        {steps.length===0
          ?<div style={{fontSize:portrait?"1.45em":"1.5em",fontWeight:720,letterSpacing:"-.02em",lineHeight:1.15,paddingTop:".45em",
              clipPath:`inset(-10% ${100*(1-(show?motionAt(f,reveal+4,reveal+20):0))}% -10% 0)`}}>{c.answer}</div>
          :<ol style={{listStyle:"none",margin:0,padding:".55em 0 0",display:"grid",gap:".4em"}}>
            {steps.map((step,i)=>{
              const last=i===steps.length-1;
              if(t<step.at) return null;
              return <li key={step.id} data-km-answer-step={step.id} style={{display:"flex",gap:".5em",alignItems:"baseline",
                fontSize:fitLongestWord(step.text,last?(portrait?1.72:1.62):(portrait?1.18:1.08),portrait?78:30),
                fontWeight:last?760:620,letterSpacing:last?"-.03em":"-.01em",lineHeight:1.12,
                opacity:final&&!last?.74:1,textShadow:"0 .04em .4em rgba(0,0,0,.5)"}}>
                <StepGlyph marker={step.marker}/>
                <span style={{minWidth:0,textWrap:"balance"}}><KineticWords text={step.text} start={step.at} stagger={2} length={13}
                  frame={t} reduced={reduced}/></span>
              </li>;
            })}
          </ol>}
      </div>
      {steps.length>0&&<p style={{position:"absolute",width:1,height:1,margin:-1,overflow:"hidden",clip:"rect(0 0 0 0)"}}>
        {show?c.answer:""}</p>}
    </div>
  </div>;
}
function renderScene(spec:SceneTemplateSpec,f:SceneTemplateFrame):ReactNode {
  const portrait=spec.height>spec.width;
  const deck:CSSProperties=portrait?{...styles.deck,flexDirection:"column",alignItems:"stretch"}:styles.deck;
  const show=f.phaseIndex>=2,final=f.phaseIndex===3,active=f.activeItem;
  switch(spec.recipeId) {
    case "question-reveal": return <QuestionRevealStage spec={spec} f={f}/>;
    case "place-shaped-image-reveal": return <PlaceShapedImageRevealStage spec={spec} f={f}/>;
    case "relief-map-expedition": return <ReliefMapExpeditionStage spec={spec} f={f}/>;
    case "nature-world-identity-reveal": return <NatureWorldIdentityRevealStage spec={spec} f={f}/>;
    case "illustrated-book-into-living-world": return <IllustratedBookStage spec={spec} f={f}/>;
    case "follow-subject-through-sections": return <FollowSubjectThroughSectionsStage spec={spec} f={f}/>;
    case "page-turn-story": return <PageTurnStoryStage spec={spec} f={f}/>;
    case "orbit-world": return <OrbitWorldStage spec={spec} f={f}/>;
    case "hidden-detail": return <>
      <Head eyebrow="Find the overlooked detail" title={spec.content.context}
        detail={show?spec.content.detail:undefined}/>
      <div style={{...deck,justifyContent:"center"}}>
        <Tile style={{padding:".4em",maxWidth:"82%",position:"relative"}}>
          <KineticMedia asset={spec.content.subject} frame={f} focus={spec.content.target}
            highlight={true} zoom={1.32} name="hidden-detail-zoom"/>
          <ScanBeam frame={f}/>
        </Tile>
      </div></>;
    case "before-after": {
      const wipe=final?100:f.phaseIndex===2?20+80*f.phaseProgress:
        f.phaseIndex===1?20*f.phaseProgress:0;
      return <><Head eyebrow="One subject · Aligned states" title={show?"What changed":"Before and after"}
          detail={final?spec.content.changes.join(" · "):undefined}/>
        <div style={{...deck,justifyContent:"center"}}>
          <Tile style={{padding:".35em",flex:"0 1 75%"}}>
            <div style={{position:"relative",width:"100%",flex:1,minHeight:0,overflow:"hidden"}}>
              <div style={{position:"absolute",inset:0}}><Asset asset={spec.content.before.image}/></div>
              <div data-km-before-after-wipe="" data-km-wipe-percent={wipe}
                style={{position:"absolute",inset:0,clipPath:`inset(0 ${100-wipe}% 0 0)`}}>
                <Asset asset={spec.content.after.image}/>
              </div>
              <div aria-hidden="true" data-km-comparison-scan-edge=""
                data-km-edge-position={wipe.toFixed(2)}
                style={{position:"absolute",top:0,bottom:0,left:Math.min(99.5,Math.max(.5,wipe))+"%",
                  width:"3px",transform:"translateX(-50%)",zIndex:3,
                  background:"linear-gradient(180deg,#d7fff2,var(--km-accent, #9fd9ce),#d7fff2)",
                  boxShadow:"0 0 .65em .19em rgba(147,241,218,.62),0 0 1.8em .5em rgba(147,241,218,.18)",
                  opacity:!f.reducedMotion&&wipe>1&&wipe<99?1:0,pointerEvents:"none"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",gap:".5em",padding:".4em"}}>
              <Label>{spec.content.before.label}</Label><Label>{spec.content.after.label}</Label>
            </div>
          </Tile>
        </div></>;
    }
    case "side-by-side": return <>
      <Head eyebrow="Controlled comparison" title={spec.content.criterion} detail={show?spec.content.comparison:undefined}/>
      <div style={{...deck,position:"relative"}}>{spec.content.alternatives.map((a,i)=>
        <EditorialMotion key={a.id} frame={f} name="comparison-dolly" start={3+i*4}
          end={cueAt(f,0)+i*4} fromX={i?24:-24} scaleFrom={.89}
          style={{minWidth:0,flex:"1 1 0",display:"flex"}}>
          <ImageTile asset={a.image} title={a.label} note={show?a.note:undefined}
            style={{flex:1,minWidth:0}}/>
        </EditorialMotion>)}
      </div></>;
    case "cause-effect": return <>
      <Head eyebrow="Mechanism · Not proof of causality" title={spec.content.event}
        detail={final?(spec.content.qualification??spec.content.outcome):spec.content.initial}/>
      <Chain items={[spec.content.initial,spec.content.event,...spec.content.links]}
        shown={final?spec.content.links.length+2:Math.max(1,f.revealedItems+1)}
        final={final?spec.content.outcome:undefined} frame={f}/></>;
    case "scale-reveal": {
      const ratio=spec.content.subject.quantity/spec.content.reference.quantity;
      const max=Math.max(spec.content.subject.quantity,spec.content.reference.quantity);
      return <><Head eyebrow="Scale comparison" title={spec.content.subject.label+" / "+spec.content.reference.label}
        detail={show?`${ratio.toLocaleString(undefined,{maximumFractionDigits:2})}× reference · ${spec.content.mode} scale`:undefined}/>
        <div style={{...deck,flexDirection:"column",justifyContent:"center"}}>
          {[spec.content.reference,spec.content.subject].map((item,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:"2%",height:"32%"}}>
            <span style={{width:"28%",fontSize:".8em"}}>{item.label}<br/>{Math.round(item.quantity*motionAt(f,i===0?0:cueAt(f,0),i===0?cueAt(f,0):cueAt(f,1))).toLocaleString()} {spec.content.unit}</span>
            <div style={{height:"42%",width:(spec.content.mode==="illustrative"?65:Math.max(2,65*item.quantity/max))+"%",
              borderRadius:".35em",background:i===0?"rgba(244,248,253,.40)":"var(--km-accent, #9fd9ce)",opacity:!show&&i===1?.14:1,
              transform:`scaleX(${motionAt(f,i===0?0:cueAt(f,0),i===0?cueAt(f,0):cueAt(f,1))})`,transformOrigin:"left center",willChange:"transform"}}/>
          </div>)}
        </div></>;
    }
    case "context-to-detail": return <>
      <Head eyebrow="Context → detail" title={spec.content.description}/>
      <div style={deck}>
        <Tile style={{padding:".3em",position:"relative"}}>
          <KineticMedia asset={spec.content.context} frame={f} focus={spec.content.target}
            highlight zoom={1.4} name="context-camera-dive"/>
          <ScanBeam frame={f}/>
        </Tile>
        {show&&<EditorialMotion frame={f} name="context-detail-inset"
          start={cueAt(f,1)} end={cueAt(f,1)+17} fromX={34} scaleFrom={.84}
          style={{minWidth:0,flex:"1 1 0",display:"flex"}}>
          <ImageTile asset={spec.content.detail} title="Detail" style={{flex:1,minWidth:0}}/>
        </EditorialMotion>}
      </div></>;
    case "layered-cutaway": {
      const {layers}=spec.content;
      const opened=motionAt(f,cueAt(f,0),cueAt(f,2));
      const total=layers.length;
      // Exploded plates are independent, perspectively projected surfaces with
      // depth, self-shading and optical separation. Intact artwork remains in the
      // reference viewport; no claim of real mesh sectioning is made.
      return <>
        <Head eyebrow="Spatial anatomy · Exploded assembly"
          title={show?spec.content.relationship:"What is inside?"}
          detail={spec.content.reconstructed?"Illustrative reconstruction · authored layers":undefined}/>
        <div style={{...deck,alignItems:"stretch",gap:portrait?"3%":"4%",minHeight:0}}>
          <div data-km-cutaway-reference="" style={{position:"relative",minWidth:0,minHeight:0,
            flex:portrait?"0 1 38%":"0 1 40%",borderRadius:".7em",overflow:"hidden",
            border:"1px solid rgba(233,249,251,.26)",
            background:"rgba(5,18,38,.7)"}}>
            <KineticMedia asset={spec.content.object} frame={f} zoom={1.13} name="cutaway-origin"/>
            <div aria-hidden="true" data-km-cutaway-peel={opened.toFixed(3)}
              style={{position:"absolute",inset:0,pointerEvents:"none",
                background:"linear-gradient(126deg,transparent 39%,rgba(89,213,198,.13) 43%,rgba(8,25,44,.75) 50%,rgba(8,25,44,.9) 65%)",
                clipPath:`polygon(${100-opened*61}% 0,100% 0,100% 100%,${100-opened*38}% 100%)`,
                opacity:opened}}/>
            <div style={{position:"absolute",left:"4%",bottom:"4%",fontSize:".62em",
              background:"rgba(8,26,41,.82)",padding:".45em .7em",
              borderLeft:"3px solid var(--km-accent, #9fd9ce)"}}>INTACT SUBJECT</div>
          </div>
          <div data-km-exploded-layers="" style={{flex:1,minWidth:0,minHeight:0,
            position:"relative",perspective:"1100px",overflow:"hidden",
            background:"radial-gradient(ellipse at 35% 42%,rgba(67,126,141,.12),transparent 66%)",
            border:"1px solid rgba(221,251,250,.10)",borderRadius:".7em"}}>
            <div aria-hidden="true" style={{position:"absolute",inset:"7% 6%",
              border:"1px dashed rgba(116,226,209,.14)",
              transform:"skewY(-8deg)",pointerEvents:"none"}}/>
            {layers.map((layer,i)=>{
              const entry=motionAt(f,cueAt(f,0)+i*5,cueAt(f,1)+i*7+12);
              const active=i<f.revealedItems||f.phaseIndex===3;
              const p=f.reducedMotion?1:entry;
              const y=6+(i+.5)*(84/total);
              const depth=(total-i)*16;
              const maxDrift=Math.min(24,85/total);
              return <div key={layer.id}
                data-km-cutaway-layer={layer.id}
                data-km-cutaway-separation={p.toFixed(4)}
                style={{position:"absolute",top:y+"%",left:"4%",width:"91%",
                  height:Math.min(31,65/total+10)+"%",
                  opacity:active?p:.10,
                  transform:`translate3d(${(1-p)*-24}%,${-50+(1-p)*maxDrift}%,${(1-p)*-depth}px)`,
                  pointerEvents:"none"}}>
                <div data-km-extruded-slab="" style={{position:"absolute",
                  left:portrait?"2%":"3%",top:"0",width:"66%",height:"82%",
                  transform:`perspective(1000px) rotateX(${42+(1-p)*22}deg) rotateZ(-10deg)`,
                  transformStyle:"preserve-3d",
                  filter:"drop-shadow(0 .65em .75em rgba(0,7,18,.55))"}}>
                  <div aria-hidden="true" style={{position:"absolute",inset:"0",
                    transform:"translate3d(.45em,.95em,-1.4em)",
                    background:"linear-gradient(145deg,#0b3349,#347585 44%,#0d3348)",
                    border:"1px solid rgba(162,235,223,.57)",
                    clipPath:"polygon(0 0,100% 0,100% 100%,0 100%)",
                    boxShadow:"0 .25em .65em rgba(3,14,27,.75)"}}/>
                  <div aria-hidden="true" style={{position:"absolute",inset:0,
                    background:"linear-gradient(90deg,rgba(15,64,78,.94),rgba(77,145,151,.86))",
                    transform:"translate3d(0,.6em,-.8em)",
                    clipPath:"polygon(0 77%,100% 77%,100% 100%,0 100%)"}}/>
                  <div style={{position:"absolute",inset:0,overflow:"hidden",
                    borderRadius:".28em",border:"2px solid rgba(185,251,225,.7)",
                    background:"rgba(21,67,77,.88)",
                    boxShadow:"inset 0 .12em .4em rgba(228,255,248,.35)"}}>
                    {layer.image?<Asset asset={layer.image} style={{objectFit:"cover"}}/>:
                      <div aria-hidden="true" style={{width:"100%",height:"100%",
                        background:"repeating-linear-gradient(140deg,rgba(174,245,232,.4) 0 2px,transparent 2px 12px)"}}/>}
                    <div aria-hidden="true" style={{position:"absolute",inset:0,pointerEvents:"none",
                      background:"linear-gradient(150deg,rgba(220,255,255,.27),transparent 42%,rgba(3,26,41,.48))"}}/>
                  </div>
                </div>
                <div aria-hidden="true" style={{position:"absolute",left:"70%",top:"30%",
                  height:"1px",width:"10%",background:"var(--km-accent, #9fd9ce)",
                  boxShadow:"0 0 .35em rgba(148,230,219,.7)"}}/>
                <div style={{position:"absolute",right:"1%",width:"30%",top:"4%",
                  transform:`translateX(${(1-p)*20}%)`,
                  borderLeft:"2px solid var(--km-accent, #9fd9ce)",padding:".2em .4em",
                  background:"rgba(7,27,43,.82)",borderRadius:".18em",
                  boxShadow:"0 .4em 1em rgba(0,11,29,.26)"}}>
                  <Label>{String(i+1).padStart(2,"0")} / {String(total).padStart(2,"0")}</Label>
                  <div style={{...styles.note,fontWeight:760,fontSize:".76em",opacity:1}}>{layer.label}</div>
                </div>
              </div>;
            })}
          </div>
        </div>
      </>;
    }
    case "build-and-connect": return <>
      <Head eyebrow="Assemble a system" title={show?spec.content.result:"Parts and relationships"}/>
      <div style={{...deck,flexDirection:"column"}}><GeometryGraph nodes={spec.content.nodes}
        edges={spec.content.connections} visible={f.revealedItems} frame={f}/></div></>;
    case "transform-and-track": {
      const mapped=spec.content.mapping.map(mapping=>({
        id:mapping.from+"→"+mapping.to,
        source:spec.content.source.find(item=>item.id===mapping.from)!,
        destination:spec.content.destination.find(item=>item.id===mapping.to)!,
      }));
      return <><Head eyebrow="Stable entity tracking" title={spec.content.changedProperty}/>
        <div style={{...deck,alignItems:"stretch"}}>
          {mapped.slice(0,Math.max(1,f.revealedItems)).map((pair,i)=>{
            const progress=motionAt(f,cueAt(f,1)+i*5,cueAt(f,2)+i*5);
            const angle=progress*180;
            return <div key={pair.id} data-km-transform-identity={pair.source.id}
              data-km-transform-angle={angle.toFixed(2)}
              style={{flex:"1 1 0",minWidth:0,perspective:"1000px",position:"relative"}}>
              <div style={{position:"absolute",inset:0,transformStyle:"preserve-3d",
                transform:`rotateY(${angle}deg)`}}>
                <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",display:"flex"}}>
                  <Tile style={{flex:1,borderColor:"rgba(152,219,206,.5)"}}>
                    <Label>Before · {pair.source.id}</Label>
                    <Word>{pair.source.label}</Word>
                    {pair.source.image&&<div style={{flex:1,minHeight:0}}><Asset asset={pair.source.image}/></div>}
                  </Tile>
                </div>
                <div style={{position:"absolute",inset:0,backfaceVisibility:"hidden",
                  transform:"rotateY(180deg)",display:"flex"}}>
                  <Tile style={{flex:1,borderColor:"var(--km-accent, #9fd9ce)"}}>
                    <Label>After · same identity</Label>
                    <Word>{pair.destination.label}</Word>
                    {pair.destination.image&&<div style={{flex:1,minHeight:0}}><Asset asset={pair.destination.image}/></div>}
                  </Tile>
                </div>
              </div>
            </div>;
          })}
        </div></>;
    }
    case "time-evolution": {
      const milestone=spec.content.milestones[final?spec.content.milestones.length-1:Math.min(active,spec.content.milestones.length-1)];
      return <><Head eyebrow="Evolution over time" title={final?spec.content.outcome:spec.content.baseline}/>
        <div style={{...deck,flexDirection:"column",minHeight:0}}>
          <div style={{flex:1,minHeight:0,position:"relative",overflow:"hidden"}}>
            {milestone.image
              ?<KineticMedia asset={milestone.image} frame={f} zoom={1.18} name="evolution-camera"/>
              :<Tile><Word>{milestone.label}</Word></Tile>}
            <EditorialMotion name="evolution-caption" frame={f} start={cueAt(f,0)} end={cueAt(f,1)}
              fromY={20} style={{position:"absolute",bottom:"4%",left:"4%",maxWidth:"60%",
                background:"rgba(8,31,49,.88)",padding:".7em",borderLeft:".2em solid var(--km-accent, #9fd9ce)"}}>
              <Label>{milestone.date}</Label><Word>{milestone.label}</Word>
            </EditorialMotion>
          </div>
          <div style={{height:"23%",minHeight:0,flex:"0 0 23%"}}>
            <TimeStrip items={spec.content.milestones} active={final?spec.content.milestones.length-1:Math.min(active,spec.content.milestones.length-1)} frame={f}/>
          </div>
        </div></>;
    }
    case "data-story": return <>
      <Head eyebrow="Chart · Sourced values" title={spec.content.insight} detail={"Source: "+spec.content.source}/>
      <Tile><ChartBars data={spec.content.data} unit={spec.content.unit} baseline={spec.content.baseline}
        shown={final?spec.content.data.length:f.revealedItems} frame={f}/></Tile></>;
    case "consequence-chain": {
      const impacts=spec.content.impacts;
      const positions=impacts.map((item,i)=>{
        if(portrait)return {item,x:30+(i%2)*40,y:19+i*Math.min(16,50/Math.max(1,impacts.length-1))};
        return {item,x:34+52*i/Math.max(1,impacts.length-1),y:32+16*Math.sin(i*2)};
      });
      const origin={x:portrait?50:12,y:portrait?7:48};
      const displayed=positions.slice(0,f.revealedItems);
      return <><Head eyebrow="Cascading consequences" title={spec.content.event}
        detail={final?spec.content.uncertainty:undefined}/>
        <div style={{position:"relative",height:"100%",width:"100%",flex:1,minHeight:0}}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"
            style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
            {displayed.map((p,i)=>{
              const from=i===0?origin:positions[i-1];
              return <line key={i} x1={from.x} y1={from.y} x2={p.x} y2={p.y}
                stroke="var(--km-accent, #9fd9ce)" strokeWidth=".55" opacity=".85"
                pathLength={1} strokeDasharray={1} strokeDashoffset={1-motionAt(f,cueAt(f,0)+i*7,cueAt(f,0)+i*7+16)}/>;
            })}
          </svg>
          <div style={{position:"absolute",left:origin.x+"%",top:origin.y+"%",
            transform:"translate(-50%,-50%)",textAlign:"center",fontSize:".7em",maxWidth:"18%"}}>
            <span style={{padding:".5em",borderRadius:"50%",background:"var(--km-accent, #9fd9ce)",
              color:"#09243a"}}>1</span>
            <div style={{marginTop:".55em"}}>Trigger</div>
          </div>
          {displayed.map((p,i)=><div key={i} data-km-cascade-impact={i}
            style={{position:"absolute",left:p.x+"%",top:p.y+"%",
              width:(portrait?"38%":"19%"),transform:`translate(-50%,-50%) scale(${.82+.18*motionAt(f,cueAt(f,0)+i*7,cueAt(f,0)+i*7+16)})`,
              opacity:motionAt(f,cueAt(f,0)+i*7,cueAt(f,0)+i*7+16),
              background:"rgba(18,48,69,.92)",border:"2px solid var(--km-accent, #9fd9ce)",
              borderRadius:".6em",padding:".65em",boxSizing:"border-box",
              fontSize:".8em",overflowWrap:"anywhere"}}>
            <Label>Effect {i+1}</Label><div>{p.item}</div>
          </div>)}
          {final&&<EditorialMotion name="cascade-impact" frame={f} start={cueAt(f,2)} end={cueAt(f,2)+15}
            fromY={20} scaleFrom={1.15} style={{position:"absolute",inset:0,pointerEvents:"none"}}><div data-km-cascade-outcome="" style={{position:"absolute",
            left:portrait?"50%":"79%",top:portrait?"87%":"84%",transform:"translate(-50%,-50%)",
            background:"rgba(136,217,198,.94)",color:"#08283c",borderRadius:".55em",
            padding:".75em",maxWidth:portrait?"82%":"34%",textAlign:"center",
            fontSize:".95em",fontWeight:720,overflowWrap:"anywhere"}}>{spec.content.outcome}</div></EditorialMotion>}
        </div></>;
    }
    case "decision-branch": {
      const options=spec.content.options;
      return <><Head eyebrow="Decision and possible outcomes" title={spec.content.decision}/>
        <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0,gap:"1.2em"}}>
          <div style={{display:"flex",justifyContent:"center",flex:"0 0 auto"}}>
            <div style={{background:"var(--km-accent, #9fd9ce)",color:"#0a2638",
              borderRadius:".5em",padding:".55em 1.5em",textAlign:"center",fontWeight:760}}>
              Decision point
            </div>
          </div>
          <div style={{display:"flex",flex:1,minHeight:0,justifyContent:"center",gap:"2%",position:"relative",
            flexDirection:portrait?"column":"row"}}>
            {options.map((option,i)=><div key={option.id} data-km-branch={option.id}
              style={{position:"relative",flex:1,minWidth:0,opacity:(i<=active||final?1:.3)*motionAt(f,cueAt(f,0)+i*6,cueAt(f,1)+i*6),
                transform:`translate3d(${portrait?0:(i-options.length/2)*15*(1-motionAt(f,cueAt(f,0)+i*6,cueAt(f,1)+i*6))}%,${portrait?18*(1-motionAt(f,cueAt(f,0)+i*6,cueAt(f,1)+i*6)):0}%,0) rotateY(${portrait?0:(i-options.length/2)*-12*(1-motionAt(f,cueAt(f,0)+i*6,cueAt(f,1)+i*6))}deg)`,
                background:"rgba(17,47,67,.88)",border:"2px solid var(--km-accent, #9fd9ce)",
                borderRadius:".65em",padding:"1.05em",display:"flex",flexDirection:"column",
                gap:".65em",boxSizing:"border-box",overflowWrap:"anywhere"}}>
              <div style={{position:"absolute",width:portrait?"6%":"2px",height:portrait?"2px":"11%",
                background:"var(--km-accent, #9fd9ce)",
                top:portrait?"50%":"-11%",left:portrait?"-6%":"50%"}} aria-hidden="true"/>
              <Label>{option.condition}</Label>
              <Word>{option.label}</Word>
              {(show||final)&&<div style={{...styles.note,borderTop:"1px solid rgba(242,251,249,.25)",
                paddingTop:".55em",marginTop:"auto"}}>{option.outcome}</div>}
            </div>)}
          </div>
        </div></>;
    }
    case "worked-example": return <>
      <Head eyebrow="Worked example" title={final?spec.content.result:spec.content.startingCase}/>
      <div style={deck}>{spec.content.operations.slice(0,f.revealedItems).map((o,i)=>
        <EditorialMotion key={o.id} name="worked-operation" frame={f} start={cueAt(f,0)+i*7} end={cueAt(f,0)+i*7+18}
          fromY={24} scaleFrom={.87} tilt={-5} style={{flex:"1 1 0",minWidth:0,display:"flex"}}>
        <Tile style={{flex:1}}><Label>Operation {i+1}</Label><Word>{o.instruction}</Word><span style={styles.note}>{o.intermediate}</span></Tile></EditorialMotion>)}
        {final&&<EditorialMotion name="worked-result" frame={f} start={cueAt(f,2)} end={cueAt(f,2)+15}
          fromY={24} scaleFrom={1.12} style={{flex:"1 1 0",minWidth:0,display:"flex"}}>
          <Tile style={{borderColor:"var(--km-accent, #9fd9ce)",flex:1}}><Label>Result</Label><Word>{spec.content.result} {spec.content.unit}</Word></Tile>
        </EditorialMotion>}</div></>;
    case "demonstration": {
      const actionCount=spec.content.actions.length;
      const activeAction=Math.min(actionCount-1,Math.max(0,f.revealedItems-1));
      const currentImage=spec.content.states?.[activeAction]??spec.content.setup;
      const focusRegion=spec.content.actionTargets?.[activeAction]??{x:.45,y:.45,width:.1,height:.1};
      const focusX=(focusRegion.x+focusRegion.width*.5)*100;
      const focusY=(focusRegion.y+focusRegion.height*.5)*100;
      const actionEntry=motionAt(f,cueAt(f,0)+activeAction*8,cueAt(f,0)+activeAction*8+13);
      return <><Head eyebrow={spec.content.simulated?"Simulated action preview":"Action-state demonstration"}
        title={final?spec.content.result:spec.content.target}/>
        <div style={{...deck,alignItems:"stretch"}}>
          <div style={{flex:"1 1 58%",position:"relative",minHeight:0,
            border:"1px solid rgba(242,250,252,.24)",borderRadius:".75em",overflow:"hidden"}}>
            <KineticMedia asset={currentImage} frame={f} focus={focusRegion}
              zoom={1.08} name="demonstration-state"/>
            {f.phaseIndex>0&&<div data-km-demo-action={activeAction}
              data-km-cursor-x={focusX.toFixed(2)} data-km-cursor-y={focusY.toFixed(2)}
              style={{position:"absolute",left:focusX+"%",top:focusY+"%",
                transform:`translate(-50%,-50%) scale(${.5+.5*actionEntry})`,
                width:"1.2em",height:"1.2em",borderRadius:"50%",
                border:".16em solid var(--km-accent, #9fd9ce)",
                boxShadow:`0 0 0 ${(1-actionEntry)*1.4}em rgba(152,226,215,.12), 0 .3em 1.2em rgba(5,20,32,.48)`,
                opacity:actionEntry,background:"rgba(243,251,248,.95)"}}/>}
            {f.phaseIndex>0&&<div aria-hidden="true" style={{
              position:"absolute",left:focusRegion.x*100+"%",top:focusRegion.y*100+"%",
              width:focusRegion.width*100+"%",height:focusRegion.height*100+"%",
              border:".1em solid var(--km-accent, #9fd9ce)",boxSizing:"border-box",
              opacity:actionEntry*.7,borderRadius:".35em",pointerEvents:"none"
            }}/>} 
            {spec.content.simulated&&<div style={{position:"absolute",right:"4%",top:"4%",
              background:"rgba(9,28,42,.86)",fontSize:".68em",padding:".4em .6em"}}>Simulation</div>}
          </div>
          <div style={{flex:"1 1 38%",minWidth:0,display:"flex",flexDirection:"column",gap:".45em",
            justifyContent:"center"}}>
            {spec.content.actions.map((action,i)=><div key={i}
              style={{opacity: i <= activeAction ? 0.95 : 0.25,display:"flex",alignItems:"center",gap:".5em",
                borderLeft:i===activeAction?".18em solid var(--km-accent, #9fd9ce)":".18em solid transparent",
                background:i===activeAction?"rgba(124,206,196,.12)":"transparent",padding:".55em",
                fontSize:".88em"}}>
                <strong>{i+1}.</strong><span>{action}</span>
              </div>)}
            {final&&<div style={{fontSize:".84em",fontWeight:700,padding:".65em",
              background:"rgba(21,80,72,.44)",borderRadius:".4em"}}>{spec.content.result}</div>}
          </div>
        </div></>;
    }
    case "guided-inspection": {
      const selected=spec.content.targets[active]??spec.content.targets[0];
      return <><Head eyebrow="Guided inspection"
        title={final?spec.content.summary:(f.phaseIndex===0?"Examine the full scene":selected.label)}/>
        <div style={{...deck,alignItems:"stretch"}}>
          <Tile style={{padding:".35em",position:"relative"}}>
            <div style={{position:"relative",height:"100%",width:"100%",minHeight:0}}>
              <KineticMedia asset={spec.content.scene} frame={f} focus={selected.region}
                zoom={1.22} name="guided-camera-pan" overlays={
                  spec.content.targets.map((target,i)=><div key={target.id}
                    data-km-inspection-region={target.id}
                    style={{position:"absolute",left:(target.region.x*100)+"%",top:(target.region.y*100)+"%",
                      width:(target.region.width*100)+"%",height:(target.region.height*100)+"%",
                      boxSizing:"border-box",border:"2px solid var(--km-accent, #9fd9ce)",
                      borderRadius:".35em",opacity:final||i===active&&f.phaseIndex>0?1:.12,
                      background:"rgba(135,214,208,.09)",display:"flex",
                      alignItems:"flex-start",justifyContent:"flex-start"}}>
                      {(final||i===active)&&<span style={{fontSize:".68em",background:"rgba(7,28,42,.9)",
                        padding:".25em .5em",maxWidth:"100%",overflowWrap:"anywhere"}}>{i+1}</span>}
                    </div>)
                }/>
              <ScanBeam frame={f}/>
            </div>
          </Tile>
          <Tile style={{flex:portrait?"0 0 24%":"0 0 29%"}}>
            <Label>Points of inspection</Label>
            {spec.content.targets.map((target,i)=><div key={target.id} style={{...styles.note,
              opacity:final||i<=active?1:.35,fontWeight:i===active?750:400}}>
                {i+1}. {target.label}
              </div>)}
          </Tile>
        </div></>;
    }
    case "character-discovery": {
      const anticipation=motionAt(f,0,cueAt(f,0));
      const reaction=motionAt(f,cueAt(f,1),cueAt(f,2));
      const tilt=f.reducedMotion?0:-8*anticipation+12*reaction;
      const bounce=f.reducedMotion?0:Math.sin(f.frame*.33)*1.2*(1-reaction);
      const gesture=f.phaseIndex===1?"Noticing":show?"Reacting":"Exploring";
      return <><Head eyebrow="Character-led discovery"
        title={final?spec.content.reveal:show?spec.content.reaction:spec.content.attentionTarget}/>
        <div style={{...deck,alignItems:"stretch"}}>
          <div style={{flex:1,position:"relative",minHeight:0,display:"flex",justifyContent:"center",
            alignItems:"center",borderRadius:".75em",background:"rgba(18,45,68,.55)"}}>
            <div style={{height:"78%",width:"75%",transform:`translateY(${bounce}%) rotate(${tilt}deg) scale(${1+.035*reaction})`,
              transformOrigin:"50% 80%"}}>
              <Asset asset={spec.content.character} style={{objectFit:"contain"}}/>
            </div>
            <div data-km-character-action={gesture}
              style={{position:"absolute",right:"2%",top:"3%",maxWidth:"49%",fontSize:".7em",
                borderRadius:".9em .9em .9em 0",padding:".6em .85em",
                background:"rgba(238,246,241,.94)",color:"#132f45",fontWeight:680,
                overflowWrap:"anywhere"}}>
              {final?spec.content.reveal:show?spec.content.reaction:spec.content.attentionTarget}
            </div>
          </div>
          <div style={{flex:1,position:"relative",minHeight:0,display:"flex",alignItems:"center",
            justifyContent:"center"}}>
            <div style={{width:"86%",height:"82%",transform:f.reducedMotion?"none":
              `scale(${1.08-.08*motionAt(f,cueAt(f,0),cueAt(f,2))}) rotate(${(1-reaction)*-2}deg)`}}>
              <Asset asset={spec.content.subject}/>
            </div>
            {f.phaseIndex>=1&&<span aria-hidden="true"
              style={{position:"absolute",left:"7%",top:"50%",fontSize:"1.8em",color:"var(--km-accent, #9fd9ce)"}}>↗</span>}
          </div>
        </div></>;
    }
    case "evidence-reveal": return <>
      <Head eyebrow="Claim → supporting evidence" title={spec.content.claim}
        detail={final?(spec.content.qualification??"Evidence supplied by author"):undefined}/>
      <div style={deck}><Tile style={{padding:".35em",minWidth:0}}>
        <div style={{position:"relative",flex:1,minHeight:0}}>{
          <KineticMedia asset={spec.content.evidence} frame={f}
            focus={spec.content.region} highlight={Boolean(spec.content.region)}
            zoom={1.18} name="evidence-camera"/>
          }<ScanBeam frame={f}/></div>
        </Tile>{show&&<EditorialMotion name="evidence-source" frame={f} start={cueAt(f,1)} end={cueAt(f,1)+17}
          fromX={26} scaleFrom={.9} style={{flex:"1 1 35%",minWidth:0,display:"flex"}}>
          <Tile style={{flex:1}}><Label>Source · {spec.content.source}</Label>
            <Word>{spec.content.excerpt}</Word>
          </Tile>
        </EditorialMotion>}</div></>;
    case "environment-reveal": {
      const path=spec.content.camera??{
        from:{x:.32,y:.38,zoom:1.055},to:{x:.54,y:.48,zoom:1.36},
      };
      const anchor=spec.content.focalAnchor??{x:.5,y:.5};
      const camera=sampleEnvironmentFrame(path,anchor,f.frame,f.durationFrames,{
        reducedMotion:f.reducedMotion,
        foregroundStrength:spec.content.parallax?.foregroundStrength??1.4,
      });
      const haze=spec.content.parallax?.haze??.42;
      const rays=spec.content.parallax?.lightRays!==false;
      const focalReady=f.phaseIndex>=2;
      const t=camera.progress;
      return <>
        <div data-km-environment-camera="" data-km-camera-zoom={camera.zoom.toFixed(4)}
          data-km-depth-progress={t.toFixed(4)}
          style={{position:"absolute",inset:0,overflow:"hidden",isolation:"isolate"}}>
          <div data-km-environment-background="" data-km-background-x={camera.background.x.toFixed(3)}
            style={{position:"absolute",inset:0,
              transform:`translate3d(${camera.background.x}%,${camera.background.y}%,0) scale(${camera.background.scale})`,
              transformOrigin:"center center",willChange:"transform"}}>
            <Asset asset={spec.content.environment} style={{...styles.image,borderRadius:0}}/>
          </div>
          {spec.content.atmosphere&&<div aria-hidden="true"
            style={{position:"absolute",inset:0,
              background:spec.content.atmosphere.tint,
              opacity:spec.content.atmosphere.opacity,pointerEvents:"none"}}/>}
          {haze>0&&<div data-km-volumetric-haze="" aria-hidden="true" style={{
            position:"absolute",inset:0,pointerEvents:"none",
            background:"radial-gradient(ellipse at 16% 78%,rgba(180,230,225,.28),transparent 60%),radial-gradient(ellipse at 74% 38%,rgba(194,230,243,.22),transparent 63%)",
            opacity:haze*(f.reducedMotion?.42:.84),
            transform:`translate3d(${-4+t*9}%,${(1-t)*-3}%,0) scale(1.2)`,
            mixBlendMode:"screen",
          }}/>}
          {rays&&!f.reducedMotion&&<div data-km-environment-light="" data-km-light-progress={camera.lightSweep.toFixed(4)}
            aria-hidden="true" style={{position:"absolute",inset:"-12%",
              pointerEvents:"none",opacity:.21*(1-t*.3),
              transform:`translateX(${-34+camera.lightSweep*53}%) skewX(-18deg)`,
              background:"linear-gradient(90deg,transparent 25%,rgba(234,251,224,.48) 41%,rgba(234,251,238,.17) 45%,transparent 59%)",
              filter:"blur(1.4em)",mixBlendMode:"screen",
            }}/>}
          <div data-km-environment-foreground=""
            data-km-foreground-x={camera.foreground.x.toFixed(3)}
            style={{position:"absolute",inset:0,
              pointerEvents:"none",opacity:f.reducedMotion?.86:.96-.26*t,
              transform:`translate3d(${camera.foreground.x}%,${camera.foreground.y}%,0) scale(${camera.foreground.scale})`,
              transformOrigin:"center center",willChange:"transform"}}>
            <Asset asset={spec.content.foreground} style={{...styles.image,borderRadius:0}}/>
          </div>
          {!f.reducedMotion&&Array.from({length:12},(_,i)=>{
            const x=(i*73+13)%100,y=(i*43+31)%100;
            const drift=((f.frame*(.08+(i%3)*.02))%115);
            const size=.12+(i%4)*.055;
            return <div key={i} data-km-environment-mote={i} aria-hidden="true"
              style={{position:"absolute",
                left:`${(x+drift*.12)%100}%`,top:`${(y-drift*.28+150)%100}%`,
                width:size+"em",height:size+"em",borderRadius:"50%",
                background:"rgba(233,250,220,.86)",opacity:.08+(i%5)*.065,
                boxShadow:"0 0 .7em .2em rgba(242,251,205,.28)",
                pointerEvents:"none"}}/>;})}
        </div>
        <div style={{position:"relative",height:"100%",width:"100%",pointerEvents:"none"}}>
          {focalReady&&<EditorialMotion name="environment-hero-arrival" frame={f}
            start={cueAt(f,1)} end={cueAt(f,1)+22} fromY={18} scaleFrom={.67}
            style={{position:"absolute",inset:0,pointerEvents:"none"}}>
            <div data-km-environment-focal="" data-km-subject-x={camera.subject.x.toFixed(3)}
              data-km-subject-y={camera.subject.y.toFixed(3)}
              style={{position:"absolute",left:camera.subject.x+"%",
                top:camera.subject.y+"%",transform:"translate(-50%,-50%)",
                width:portrait?"42%":"26%",height:"46%",
                filter:"drop-shadow(0 1.2em 1.4em rgba(1,17,33,.5))"}}>
              <Asset asset={spec.content.focal} style={{...styles.image,objectFit:"contain"}}/>
            </div>
          </EditorialMotion>}
          {focalReady&&<EditorialMotion name="environment-title" frame={f}
            start={cueAt(f,2)} end={cueAt(f,2)+17} fromY={0} scaleFrom={.94}
            style={{position:"absolute",inset:0,pointerEvents:"none"}}>
            <h2 style={{...styles.title,position:"absolute",bottom:"2%",left:"10%",width:"80%",
              maxWidth:"none",textAlign:"center",
              textShadow:"0 .12em .9em rgba(0,18,38,.92),0 2px 15px #091320"}}>
              {spec.content.title}
            </h2>
          </EditorialMotion>}
        </div>
      </>;
    }
    case "timeline-journey": return <TimelineJourneyStage spec={spec} f={f}/>;
    case "glass-data-reveal": return <>
      <div style={{position:"absolute",inset:0}}>
        <Asset asset={spec.content.background} style={{borderRadius:0}}/>
        <div aria-hidden="true" style={{position:"absolute",inset:0,
          background:"linear-gradient(143deg,rgba(8,29,49,.14),rgba(7,21,39,.47))",
          pointerEvents:"none"}}/>
      </div>
      <div style={{position:"relative",height:"100%",width:"100%",display:"flex",
        flexDirection:"column",gap:"2.5%"}}>
        <Head eyebrow="Luminous glass · Data presentation" title="Information in focus"/>
        <div style={{...deck,gap:"2.1%",minHeight:0}}>
          {spec.content.panels.slice(0,f.revealedItems).map((p,i)=>
            <EditorialMotion key={p.id} name="glass-pane-refract" frame={f}
              start={cueAt(f,0)+i*7} end={cueAt(f,1)+i*7+10}
              fromX={i%2?24:-24} fromY={12} tilt={i%2?-8:8} scaleFrom={.84}
              style={{flex:"1 1 0",minWidth:0,minHeight:0,display:"flex",perspective:"900px"}}>
              <GlassLensPane panel={p} material={spec.content.material} frame={f} index={i}/>
            </EditorialMotion>)}
          {show&&<EditorialMotion name="glass-metric-emergence" frame={f}
            start={cueAt(f,1)} end={cueAt(f,1)+21}
            fromY={25} scaleFrom={.86}
            style={{flex:"1 1 0",minWidth:0,minHeight:0,display:"flex"}}>
            <div style={{...styles.tile,position:"relative",flex:1,minWidth:0,
              border:"1px solid rgba(209,254,245,.53)",
              background:"rgba(8,27,44,.84)",
              backdropFilter:f.reducedMotion?"none":"blur(14px)",
              boxShadow:"0 .9em 2em rgba(2,14,30,.36)"}}>
              <ChartBars data={spec.content.data} unit={spec.content.unit}
                shown={spec.content.data.length} frame={f}/>
            </div>
          </EditorialMotion>}
        </div>
      </div></>;
  }
}
/** Composition surface; responsive typography is based on the stage container. */
export interface SceneTemplateViewProps<K extends SceneRecipeId = SceneRecipeId>
  extends Omit<ComponentPropsWithoutRef<"div">,"children"> {
  spec: SceneTemplateSpec<K>;
  frame: number;
  reducedMotion?: boolean;
  /** Host-only adapter for frame-addressable rigs, real 3D renderers or video.
   * Never save a callback inside the serializable recipe specification. */
  renderAsset?: SceneAssetRenderer;
  /** Host-only custom animation layer, for marks the serializable annotations cannot express.
   * Honoured by question-reveal. */
  renderOverlay?: SceneOverlayRenderer;
}
/** Film-plate stages own their full frame and place copy in measured regions themselves. */
const fullBleed=new Set<SceneRecipeId>(["question-reveal","place-shaped-image-reveal","relief-map-expedition","nature-world-identity-reveal","illustrated-book-into-living-world","follow-subject-through-sections","timeline-journey","page-turn-story","orbit-world"]);
/** All templates are deterministic: the parent controls the absolute frame. */
export const SceneTemplateView=forwardRef<HTMLDivElement,SceneTemplateViewProps>(
  function SceneTemplateView({spec,frame,reducedMotion,renderAsset,renderOverlay,style,...props},ref) {
    const evaluated=evaluateSceneTemplate(spec,frame,reducedMotion);
    const content=<div {...props} ref={ref} role={props.role??"group"}
      aria-label={props["aria-label"]??spec.recipeId.split("-").join(" ")}
      data-km-scene-recipe={spec.recipeId} data-km-scene-phase={evaluated.phase}
      data-km-frame={evaluated.frame} data-km-scene-id={spec.id}
      style={{...styles.stage,aspectRatio:`${spec.width} / ${spec.height}`,
        ...(fullBleed.has(spec.recipeId)&&!spec.safeInsets?{padding:0}:{}),
        ...(spec.safeInsets?{padding:[
          (spec.safeInsets.top*100)+"%",(spec.safeInsets.right*100)+"%",
          (spec.safeInsets.bottom*100)+"%",(spec.safeInsets.left*100)+"%",
        ].join(" ")}:{}),
        ...(spec.background?{background:spec.background}:{}),
        ...({"--km-accent":spec.accent??"#9fd9ce"} as CSSProperties),...style}}>
      {renderScene(spec,evaluated)}
    </div>;
    const wrapped=renderAsset
      ? <AssetRendererContext.Provider value={{render:renderAsset,frame:evaluated}}>{content}</AssetRendererContext.Provider>
      : content;
    return <PortraitContext.Provider value={spec.height>spec.width}>
      <OverlayRendererContext.Provider value={renderOverlay}>{wrapped}</OverlayRendererContext.Provider>
    </PortraitContext.Provider>;
  });
