/** Real per-platform output planning, not a rendered video or publication claim. */
import { inspectSafeFrame, safeFrameContentRect, safeFrameProfileFromInset } from "@/components/visual/safe-frame";
import { videoPlatformPreset, type VideoPlatformPresetId } from "@/components/video/platform-presets";
import type { SafeFrameItem } from "@/components/visual/safe-frame";

export const PLATFORMS = [
  "youtube","youtube-shorts","instagram-reels","tiktok","instagram-feed","social-square",
] as const satisfies readonly VideoPlatformPresetId[];

export interface DeliveryInput {
  preset: (typeof PLATFORMS)[number];
  headline: string;
  supportingText: string;
  labels: string[];
}
export interface DeliveryLayout {
  version: 1;
  kind: "contentgen-platform-layout";
  preset: DeliveryInput["preset"];
  width: number; height: number;
  orientation: "portrait"|"landscape"|"square";
  headline: string;
  supportingText: string;
  labels: string[];
  placements: SafeFrameItem[];
  safeArea: {x:number;y:number;width:number;height:number};
  reserved: ReturnType<typeof safeFrameProfileFromInset>["reserved"];
  diagnostics: {severity:"warning"|"error";code:string;message:string}[];
  exportable: boolean;
}
function safeText(value:string, max:number, label:string) {
  if (typeof value !== "string" || !value.trim() || value.length > max || Array.from(value).some(char => {
    const cp=char.codePointAt(0)!;return cp<=8 || (cp>=14&&cp<=31);
  })) throw new Error(label+" must be 1–"+max+" characters.");
  return value.trim();
}
export function createDeliveryLayout(input:DeliveryInput):DeliveryLayout {
  if(!PLATFORMS.includes(input.preset)) throw new Error("Unsupported output preset.");
  const p=videoPlatformPreset(input.preset);
  const headline=safeText(input.headline,90,"Headline");
  const supportingText=safeText(input.supportingText,140,"Supporting copy");
  if(!Array.isArray(input.labels) || input.labels.length<2 || input.labels.length>4)throw new Error("2–4 graphic labels are required.");
  const labels=input.labels.map((label,i)=>safeText(label,44,"Label "+(i+1)));
  const profile=safeFrameProfileFromInset({
    id:p.id,label:p.label,width:p.width,height:p.height,inset:p.safeInset,
  });
  const content=safeFrameContentRect(profile);
  const portrait=p.width<p.height, landscape=p.width>p.height;
  const orientation=portrait?"portrait":landscape?"landscape":"square";
  const inset=.025;
  const x=content.x+inset, w=content.width-inset*2;
  const titleHeight=content.height*(portrait ? .20 : .22);
  const subtitleHeight=content.height*(portrait ? .10 : .12);
  const titleY=content.y+content.height*.035;
  const subtitleY=titleY+titleHeight+content.height*.025;
  const graphicsY=subtitleY+subtitleHeight+content.height*.06;
  const graphicsHeight=Math.max(.08,content.y+content.height*.93-graphicsY);
  const gap=portrait ? .018 : .023;
  const graphics=labels.map((_,i)=>{
    const split=landscape&&labels.length<=3;
    const cols=split?labels.length:2;
    const rows=Math.ceil(labels.length/cols);
    const width=(w-gap*(cols-1))/cols;
    const height=(graphicsHeight-gap*(rows-1))/rows;
    const px=x+(i%cols)*(width+gap), py=graphicsY+Math.floor(i/cols)*(height+gap);
    return {id:"subject-"+i,kind:"subject" as const,critical:true,rect:{x:px,y:py,width,height}};
  });
  const placements:SafeFrameItem[]=[
    {id:"headline",kind:"text",rect:{x,y:titleY,width:w,height:titleHeight}},
    {id:"subtitle",kind:"text",rect:{x,y:subtitleY,width:w,height:subtitleHeight}},
    ...graphics,
  ];
  const inspection=inspectSafeFrame(profile,placements);
  const diagnostics=inspection.diagnostics.map(d=>({severity:d.severity,code:d.code,message:d.message}));
  if(headline.length>(portrait?52:75))diagnostics.push({severity:"warning",code:"headline-length",message:"Headline may require smaller type; visually inspect before publication."});
  if(supportingText.length>(portrait?75:105))diagnostics.push({severity:"warning",code:"subtitle-length",message:"Supporting copy may overflow; visually inspect at destination size."});
  if(labels.some(t=>t.length>(portrait?26:34)))diagnostics.push({severity:"warning",code:"label-length",message:"Long diagram label may wrap; inspect against the actual output."});
  return {version:1,kind:"contentgen-platform-layout",preset:input.preset,width:p.width,height:p.height,
    orientation,headline,supportingText,labels,placements,safeArea:content,reserved:profile.reserved,
    diagnostics,exportable:!diagnostics.some(d=>d.severity==="error")};
}
