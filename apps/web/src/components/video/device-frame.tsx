import { useId } from "react";
import type { CSSProperties } from "react";

export type DeviceKind = "laptop" | "monitor" | "phone";
export interface ScreenHighlight { x: number; y: number; width: number; height: number }
export interface DeviceFrameProps {
  imageSrc: string;
  alt: string;
  device?: DeviceKind;
  /** Normalized fractions of the screen glass. Only supply verified regions. */
  highlight?: ScreenHighlight;
  highlighted?: boolean;
  /** Optional licensed mark on the lower bezel edge; not a second subject. */
  appMarkSrc?: string;
  width?: number;
  height?: number;
  style?: CSSProperties;
}
export function validateScreenHighlight(h: ScreenHighlight): void {
  if (![h.x,h.y,h.width,h.height].every(Number.isFinite) ||
      h.x < 0 || h.y < 0 || h.width <= 0 || h.height <= 0 ||
      h.x + h.width > 1 || h.y + h.height > 1) {
    throw new Error("Highlight coordinates must describe a positive rectangle inside normalized screen glass.");
  }
}
const DESIGN_W = 980, DESIGN_H = 640;
export function DeviceFrame({imageSrc,alt,device="laptop",highlight,highlighted=false,
  appMarkSrc,width=DESIGN_W,height=DESIGN_H,style}:DeviceFrameProps) {
  const clipId = "km-glass-" + useId().replace(/:/g,"");
  if (!imageSrc?.trim() || !alt?.trim()) throw new Error("DeviceFrame requires a licensed image source and meaningful alt text.");
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) throw new Error("DeviceFrame dimensions must be finite and positive.");
  if (highlight) validateScreenHighlight(highlight);
  if (!["laptop","monitor","phone"].includes(device)) throw new Error("Unsupported device: " + device);
  const isPhone = device === "phone";
  const glass = isPhone
    ? { x:354, y:53, width:272, height:530, rx:24 }
    : { x:60, y:53, width:860, height:484, rx:6 };
  const band = highlight && highlighted ? {
    x:glass.x + highlight.x*glass.width, y:glass.y + highlight.y*glass.height,
    width:highlight.width*glass.width, height:highlight.height*glass.height,
  } : null;
  const isLaptop = device === "laptop";
  const bezel = isPhone ? {x:338,y:32,width:304,height:571,rx:48} :
    {x:38,y:31,width:904,height:528,rx:24};
  return <svg data-km-device-frame={device} data-highlighted={String(Boolean(band))}
    role="img" aria-label={alt} viewBox="0 0 980 640" width={width} height={height}
    preserveAspectRatio="xMidYMid meet" style={{display:"block",width:"100%",height:"100%",...style}}>
    <defs><clipPath id={clipId}><rect {...glass}/></clipPath></defs>
    <rect {...bezel} fill="var(--km-shot-device-body, #1c2633)" stroke="var(--km-shot-device-trim, #758397)" strokeWidth="3"/>
    <rect x={glass.x-5} y={glass.y-5} width={glass.width+10} height={glass.height+10}
      rx={glass.rx+3} fill="var(--km-shot-device-glass-frame, #070d15)" />
    <g clipPath={"url(#"+clipId+")"}>
      <rect x={glass.x} y={glass.y} width={glass.width} height={glass.height} fill="var(--km-shot-device-screen, #101c2b)"/>
      <image href={imageSrc} x={glass.x} y={glass.y} width={glass.width}
        height={glass.height} preserveAspectRatio="xMidYMid meet"/>
      {band && <rect data-km-invoice-band="" {...band} rx="4" fill="var(--km-shot-accent, #39bdb4)"
        fillOpacity=".26" stroke="var(--km-shot-accent, #62e0d1)" strokeOpacity=".68" strokeWidth="2"/>}
    </g>
    {isLaptop ? <>
      <path d="M20 559H960L980 594Q980 604 958 604H22Q0 604 0 594Z" fill="var(--km-shot-device-metal, #9aa6b4)"/>
      <path d="M17 559H963L952 580H28Z" fill="var(--km-shot-device-metal-light, #c1cad4)"/>
      <path d="M402 561H578L567 575H413Z" fill="var(--km-shot-device-metal-dark, #8292a4)"/>
    </> : device === "monitor" ? <>
      <rect x="451" y="559" width="78" height="48" fill="var(--km-shot-device-metal-dark, #6c7889)"/>
      <path d="M365 607H615L649 625H331Z" fill="var(--km-shot-device-metal, #9da9b7)"/>
    </> : <>
      <rect x="444" y="43" width="92" height="13" rx="7" fill="var(--km-shot-device-trim, #56616d)"/>
      <rect x="452" y="585" width="76" height="5" rx="3" fill="var(--km-shot-device-metal, #8a98a8)"/>
    </>}
    {appMarkSrc && device !== "phone" ? <g data-km-device-mark="">
      <rect x="826" y="536" width="104" height="104" rx="16" fill="var(--km-shot-device-mark-surface, #eef4f4)" stroke="var(--km-shot-device-trim, #82909c)" strokeWidth="3"/>
      <image href={appMarkSrc} x="830" y="540" width="96" height="96" preserveAspectRatio="xMidYMid meet"/>
    </g> : null}
  </svg>;
}
