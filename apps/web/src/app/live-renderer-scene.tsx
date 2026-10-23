import { useEffect, useRef, useState } from "react";
import type { GeneralVisualPlan } from "../../scripts/video-production/general-visual-plan.mjs";
import { GeneralExportScene } from "../video-export/general-scene";

/** Exactly the component the headless MP4 exporter renders; only the scaling shell differs. */
export default function LiveRendererScene({plan,frame}:{plan:GeneralVisualPlan;frame:number}){
  const container=useRef<HTMLDivElement>(null);
  const [width,setWidth]=useState(960);
  useEffect(()=>{
    const node=container.current;
    if(!node)return;
    const update=()=>{
      const measured=node.getBoundingClientRect().width;
      if(measured>0)setWidth(measured);
    };
    if(typeof ResizeObserver==="undefined")return;
    const observer=new ResizeObserver(update);
    observer.observe(node);
    return ()=>observer.disconnect();
  },[]);
  return <div ref={container} className="relative aspect-video w-full overflow-hidden rounded-control bg-[#101d2d]"
    aria-label="Actual export scene visual" data-contentgen-real-renderer="">
    <div style={{width:1920,height:1080,transformOrigin:"top left",
      transform:`scale(${width/1920})`,pointerEvents:"none"}}>
      <GeneralExportScene plan={plan} frame={frame}/>
    </div>
  </div>;
}
