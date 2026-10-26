/** Browser export handshake. This is deliberately not an encoder.
 * A host drives a single absolute-frame playhead; Playwright captures the
 * ready DOM surface and FFmpeg encodes it using the manifest's rational FPS.
 */
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { inspectVideoPreset } from "./platform-presets";
import type { VideoPlatformPresetId } from "./platform-presets";
/** Local shared-frame value shape; no mandatory motion runtime dependency. */
export interface VideoFrameRate { num:number; den:number }

export interface VideoExportManifest {
  schemaVersion:1;
  id:string;
  durationFrames:number;
  width:number;
  height:number;
  fps:VideoFrameRate;
  /** Platform layout recipe; the producer must author at this size. */
  preset?:VideoPlatformPresetId;
  /** Media the frames depend on. Checked before the first frame: reachable, rights reference present and, for video,
   * decodable in the export browser. Optional; a manifest without assets is not checked.
   */
  assets?:readonly VideoExportAsset[];
}
export interface VideoExportAsset {
  id:string;
  kind:"video"|"image";
  /** Same-origin URL, or absolute URL the preview can load. */
  url:string;
  /** Rights or licence reference for the asset. Required before export. */
  licenseRef?:string;
}
export interface KumikiVideoExportApi {
  manifest:VideoExportManifest;
  /** Reject on missing fonts/assets, camera lag or incorrect seek. */
  seek:(frame:number)=>Promise<void>;
}
declare global {
  interface Window { __kmVideoExport?:KumikiVideoExportApi }
}
const validInt=(n:number,min:number)=>Number.isSafeInteger(n)&&n>=min;
export function validateVideoExportManifest(m:VideoExportManifest):void{
  if(!m||m.schemaVersion!==1||typeof m.id!=="string"||!m.id.trim()||
    !validInt(m.durationFrames,1)||!validInt(m.width,2)||!validInt(m.height,2)||
    m.width>7680||m.height>4320||m.width%2!==0||m.height%2!==0||
    !m.fps||!validInt(m.fps.num,1)||!validInt(m.fps.den,1)||
    m.fps.num/m.fps.den>120||m.fps.num/m.fps.den<1)
    throw new Error("Video export needs a unique ID, positive frames, even output dimensions ≤7680×4320 and rational FPS from 1 to 120.");
  if(m.preset){
    const errors=inspectVideoPreset(m,m.preset).filter(d=>d.severity==="error");
    if(errors.length)throw new Error(errors.map(d=>d.message).join("; "));
  }
}
export interface VideoExportStageProps {
  manifest:VideoExportManifest;
  frame:number;
  onSeek:(frame:number)=>void|Promise<void>;
  /** Optional asynchronous renderer or decoder frame preparation. */
  prepareFrame?:(frame:number)=>void|Promise<void>;
  children:ReactNode;
  className?:string;
}
const nextPaint=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const bounded=<T,>(task:Promise<T>,ms:number,description:string):Promise<T>=>{
  let timer:ReturnType<typeof setTimeout>;
  return Promise.race([task,new Promise<T>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error(description+" timed out.")),ms);
  })]).finally(()=>clearTimeout(timer!));
};
async function ready(root:HTMLDivElement,frame:number):Promise<void>{
  const start=performance.now();
  while(root.dataset.frame!==String(frame)||
    [...root.querySelectorAll<HTMLElement>("[data-km-camera-viewport-3d]")]
      .some(el=>el.dataset.cameraFrame!==String(frame)||
        !el.querySelector<HTMLCanvasElement>("canvas")?.width)||
    root.querySelector("[data-km-caption-performer][data-caption-status=pending]")||
    root.querySelector("[data-km-frame-clip][data-clip-status=pending]")||
    [...root.querySelectorAll<HTMLElement>("[data-km-hero-viewer]")].some(el=>!el.querySelector("[role=alert]")&&
      el.querySelector<HTMLCanvasElement>("canvas")?.dataset.kmHeroReady!=="true")) {
    if(performance.now()-start>15000)throw new Error("Video frame did not settle at "+frame+".");
    await nextPaint();
  }
  if(root.querySelector("[data-km-explainer-fallback], [data-km-camera-viewport-3d] [role=alert], [data-km-hero-viewer] [role=alert]"))
    throw new Error("Video frame has layout or 3D rendering errors.");
  const stage=root.querySelector<HTMLElement>("[data-km-explainer-stage]");
  if(stage&&stage.dataset.layoutStatus!=="ready")throw new Error("Explainer layout is not capture-ready.");
  if(root.querySelector("[data-km-safe-frame-guides]"))
    throw new Error("Safe-frame authoring guides are visible; disable guides for export.");
  if(root.querySelector("[data-km-safe-frame][data-safe-frame-status=error]"))
    throw new Error("Safe-frame layout has errors at frame "+frame+".");
  if(root.querySelector("[data-km-caption-performer][data-caption-status=error]"))
    throw new Error("Captions have timing or layout errors at frame "+frame+".");
  for(const clip of root.querySelectorAll<HTMLElement>("[data-km-frame-clip]")){
    if(clip.dataset.clipStatus==="error")throw new Error("Footage frame failed at output frame "+frame+".");
    if(clip.dataset.clipStatus!=="hidden"&&clip.dataset.sourceFrame!==clip.dataset.expectedSourceFrame)
      throw new Error("Footage shows source frame "+clip.dataset.sourceFrame+", expected "+clip.dataset.expectedSourceFrame+".");
  }
  await bounded(document.fonts?.ready??Promise.resolve(),15000,"Fonts");
  const images=[...root.querySelectorAll<HTMLImageElement>("img")];
  await bounded(Promise.all(images.map(async img=>{
    if(!img.complete)await new Promise<void>((resolve,reject)=>{
      img.addEventListener("load",()=>resolve(),{once:true});
      img.addEventListener("error",()=>reject(new Error("Video image failed to load.")),{once:true});
    });
    if(!img.naturalWidth)throw new Error("Missing image during video export.");
    await img.decode?.();
  })),15000,"Image decoding");
  await nextPaint();await nextPaint();
  if(root.dataset.frame!==String(frame))throw new Error("Export frame changed during preparation.");
}
/** Wrap a renderer in this fixed-output surface. No extra timers or animation
 * clocks: the consumer remains responsible for changing its actual frame.
 * Mount one stage per export page.
 */
export function VideoExportStage({manifest,frame,onSeek,prepareFrame,children,className}:VideoExportStageProps){
  validateVideoExportManifest(manifest);
  if(!validInt(frame,0)||frame>=manifest.durationFrames)
    throw new Error("Video export frame is outside the manifest duration.");
  const root=useRef<HTMLDivElement>(null);
  const callbacks=useRef({onSeek,prepareFrame});
  callbacks.current={onSeek,prepareFrame};
  useEffect(()=>{
    let active=true;
    const api:KumikiVideoExportApi={
      manifest,
      async seek(target){
        if(!active)throw new Error("Video export stage is no longer mounted.");
        if(!validInt(target,0)||target>=manifest.durationFrames)
          throw new Error("Requested video frame is outside the manifest.");
        const element=root.current;
        if(!element)throw new Error("Video export stage is not mounted.");
        await callbacks.current.onSeek(target);
        await callbacks.current.prepareFrame?.(target);
        await ready(element,target);
      },
    };
    window.__kmVideoExport=api;
    return ()=>{active=false;if(window.__kmVideoExport===api)delete window.__kmVideoExport;};
  },[manifest]);
  return <div ref={root} className={className}
    data-km-video-capture="" data-frame={frame}
    data-output-width={manifest.width} data-output-height={manifest.height}
    style={{width:manifest.width,height:manifest.height,position:"relative",overflow:"hidden"}}>
    {children}
  </div>;
}
