import { useState } from "react";
import type { CSSProperties } from "react";
import { Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { contrastRatio, normalizeHex } from "@/features/brand-appearance/model/palette";
import { PRESETS } from "@/features/brand-appearance/model/presets";
import type { Locale } from "@/features/registry";
import type { LocalProject } from "./catalog-model";
import {
  PROJECT_COLOR_ROLES, resolveProjectAppearance, validateProjectAppearanceDraft,
  type ProjectAppearanceDraft, type ProjectColorRole, type ProjectPalette,
} from "./project-brand-appearance";

interface Props {
  project: LocalProject;
  locale: Locale;
  onSave: (draft: ProjectAppearanceDraft) => boolean;
}
type Preview = "thumbnail" | "video" | "blog";
const FALLBACK = "#758CA3";
const ROLE_LABELS: Record<ProjectColorRole,{en:string;ja:string}> = {
  primary:{en:"Primary",ja:"メイン"}, secondary:{en:"Secondary",ja:"サブ"},
  accent:{en:"Accent",ja:"アクセント"},background:{en:"Background",ja:"背景"},text:{en:"Text",ja:"文字"},
};
const message = (locale:Locale,en:string,ja:string) => locale==="ja"?ja:en;

function samplePalette(draft: ProjectAppearanceDraft): ProjectPalette {
  return {...draft.palette,...Object.fromEntries(PROJECT_COLOR_ROLES.map(role => [role,normalizeHex(draft.palette[role])??FALLBACK]))};
}

function projectInitials(name:string) {
  return name.trim().split(/\s+/).slice(0,2).map(token=>token.slice(0,1)).join("").toUpperCase() || "P";
}

function BrandSample({kind,palette,name}: {kind:Preview;palette:ProjectPalette;name:string}) {
  const onPrimary = (contrastRatio(palette.text,palette.primary)??0) >= (contrastRatio(palette.background,palette.primary)??0)
    ? palette.text : palette.background;
  if(kind==="thumbnail") return <div className="relative flex min-h-64 flex-col justify-between overflow-hidden rounded-xl p-7 shadow-inner sm:min-h-72"
    style={{background:`linear-gradient(135deg,${palette.primary},${palette.secondary})`,color:onPrimary}}>
    <div className="absolute -right-16 -top-16 size-72 rounded-full border-[28px] opacity-15" aria-hidden="true" style={{borderColor:palette.accent}}/>
    <p className="relative text-xs font-bold uppercase tracking-[.23em] opacity-85">{name}</p>
    <div className="relative max-w-lg">
      <p className="font-serif text-3xl font-bold leading-tight sm:text-4xl">Why home insurance keeps <span style={{color:palette.accent}}>rising</span></p>
      <div className="mt-5 h-1.5 w-20 rounded-full" style={{background:palette.accent}}/>
    </div>
    <p className="relative text-[10px] font-semibold uppercase tracking-[.2em]">Example thumbnail composition</p>
  </div>;
  if(kind==="video") return <div className="min-h-64 rounded-xl p-6 sm:min-h-72" style={{background:palette.primary,color:onPrimary}}>
    <p className="text-xs font-bold uppercase tracking-[.2em] opacity-80">{name} · example motion graphic</p>
    <h4 className="mt-4 font-serif text-2xl font-bold">Understanding rising costs</h4>
    <div className="mt-5 flex h-36 items-end gap-3 border-b border-white/25 px-3 pb-2" aria-label="Illustrative ascending bars; no numeric data">
      {[28,43,51,70,86].map((height,i)=><div key={i} className="min-w-0 flex-1 rounded-t-md" style={{height:`${height}%`,background:i===4?palette.accent:palette.secondary}}/>)}
    </div>
    <p className="mt-2 text-xs opacity-75">Visual style sample · illustrative only</p>
  </div>;
  return <div className="min-h-64 rounded-xl p-7 sm:min-h-72" style={{background:palette.background,color:palette.text}}>
    <div className="flex items-center justify-between border-b pb-3" style={{borderColor:palette.secondary}}>
      <span className="text-xs font-bold uppercase tracking-[.22em]" style={{color:palette.secondary}}>{name}</span>
      <span className="text-[11px]">Field notes</span>
    </div>
    <p className="mt-6 text-xs font-bold uppercase tracking-widest" style={{color:palette.secondary}}>Homeownership</p>
    <h4 className="mt-2 max-w-md font-serif text-3xl font-bold leading-tight">What drives higher home insurance costs?</h4>
    <div className="mt-4 h-1 w-16" style={{background:palette.accent}}/>
    <p className="mt-4 max-w-md text-sm opacity-75">A clear, evidence-led explanation of the costs behind the headline.</p>
  </div>;
}

export function ProjectBrandAppearancePanel({project,locale,onSave}:Props) {
  const initial=resolveProjectAppearance(project);
  const [draft,setDraft]=useState<ProjectAppearanceDraft>(()=>({
    palette:{...initial.palette,custom:initial.palette.custom.map(c=>({...c}))},
    typographyPreset:initial.typographyPreset,
  }));
  const [preview,setPreview]=useState<Preview>("thumbnail");
  const [saved,setSaved]=useState(false);
  const values=samplePalette(draft);
  const invalidRoles=PROJECT_COLOR_ROLES.filter(role=>!normalizeHex(draft.palette[role]));
  let invalidCustom=false;
  try {validateProjectAppearanceDraft(draft);} catch {invalidCustom=true;}
  const invalid=invalidRoles.length>0||invalidCustom;
  const ratio=contrastRatio(values.text,values.background);
  const textContrastOk=(ratio??0)>=4.5;
  const appearance=project.brandAppearance;
  const hasChanges=!appearance || JSON.stringify(draft)!==JSON.stringify({
    palette:appearance.palette,typographyPreset:appearance.typographyPreset,
  });
  const swatchStyle:CSSProperties={borderColor:"var(--km-border, #dce3ed)"};

  const updateRole=(role:ProjectColorRole,hex:string)=>{
    setSaved(false);
    setDraft(previous=>({...previous,palette:{...previous.palette,[role]:hex}}));
  };
  const updateCustom=(index:number,key:"name"|"hex",value:string)=>{
    setSaved(false);
    setDraft(previous=>({...previous,palette:{...previous.palette,custom:previous.palette.custom.map((item,i)=>i===index?{...item,[key]:value}:item)}}));
  };
  const save=()=>{
    if(invalid)return;
    if(onSave(validateProjectAppearanceDraft(draft)))setSaved(true);
  };

  return <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,.9fr)]">
    <div className="min-w-0 space-y-5">
      <Surface header={<div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{message(locale,"Brand color palette","ブランドカラーパレット")}</h2>
        <span role="status" className={`text-xs font-medium ${textContrastOk?"text-emerald-700":"text-amber-700"}`}>
          {textContrastOk?<><Check className="mr-1 inline size-4" aria-hidden/>{message(locale,"Text contrast passes","文字のコントラスト良好")}</>:message(locale,"Review text/background contrast","文字と背景のコントラストに注意")}
        </span></div>}>
        <p className="mb-4 text-sm text-muted-foreground">{message(locale,"Saved roles become default color choices for thumbnails, visuals and platform artwork.","保存した色はサムネイル、動画グラフィック、配信用画像の初期色になります。")}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {PROJECT_COLOR_ROLES.map(role=>{
            const roleName=ROLE_LABELS[role][locale];
            const invalidColor=!normalizeHex(draft.palette[role]);
            return <div key={role} role="group" aria-label={`${roleName} color`} className="min-w-0 rounded-xl border border-border bg-surface p-3" style={swatchStyle}>
              <label htmlFor={`project-hex-${role}`} className="text-sm font-semibold">{roleName}</label>
              <label className="relative mt-2 block h-24 cursor-pointer overflow-hidden rounded-lg border border-border" style={{background:normalizeHex(draft.palette[role])??FALLBACK}}>
                <span className="sr-only">{roleName} {message(locale,"color picker","色の選択")}</span>
                <input type="color" aria-label={`${roleName} color picker`} value={normalizeHex(draft.palette[role])??FALLBACK}
                  onChange={event=>updateRole(role,event.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/>
              </label>
              <input id={`project-hex-${role}`} aria-label={`${roleName} HEX`} value={draft.palette[role]}
                onChange={event=>updateRole(role,event.target.value)} spellCheck={false} aria-invalid={invalidColor}
                className="mt-2 w-full rounded-md border border-input bg-background px-2 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"/>
              {invalidColor&&<span className="mt-1 block text-xs text-destructive">{message(locale,"Invalid HEX","HEXが無効です")}</span>}
            </div>;
          })}
        </div>
        {draft.palette.custom.length>0&&<div className="mt-4 grid gap-2 sm:grid-cols-2">
          {draft.palette.custom.map((item,index)=><div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
            <label className="min-w-32 flex-1 text-xs font-medium text-muted-foreground">{message(locale,"Custom color name","追加色の名前")}
              <input aria-label="Custom color name" value={item.name} onChange={event=>updateCustom(index,"name",event.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm" maxLength={32}/>
            </label>
            <label className="min-w-32 flex-1 text-xs font-medium text-muted-foreground">HEX
              <input aria-label={`Custom color ${index+1} HEX`} value={item.hex} onChange={event=>updateCustom(index,"hex",event.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 font-mono text-sm"/>
            </label>
            <input type="color" aria-label={`Custom color ${index+1} picker`} className="h-10 w-10 cursor-pointer" value={normalizeHex(item.hex)??FALLBACK}
              onChange={event=>updateCustom(index,"hex",event.target.value)}/>
            <Button size="icon" variant="subtle" aria-label={`Remove custom color ${index+1}`} onClick={()=>{
              setSaved(false);setDraft(previous=>({...previous,palette:{...previous.palette,custom:previous.palette.custom.filter((_,i)=>i!==index)}}));
            }}><Trash2 className="size-4" aria-hidden/></Button>
          </div>)}
        </div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <Button size="sm" variant="outline" icon={<Plus className="size-4" aria-hidden/>} disabled={draft.palette.custom.length>=8}
            onClick={()=>{setSaved(false);setDraft(previous=>({...previous,palette:{...previous.palette,custom:[...previous.palette.custom,{name:"",hex:FALLBACK}]}}));}}>
            {message(locale,"Add custom color","色を追加")}
          </Button>
          <span className="text-xs text-muted-foreground">{message(locale,"Contrast ratio", "コントラスト比")}: {ratio?.toFixed(1)??"—"}:1</span>
        </div>
      </Surface>
      <Surface header={<h2 className="font-semibold">{message(locale,"Brand assets & typography","ブランド素材と書体")}</h2>}>
        <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex items-center gap-3"><div className="flex size-20 items-center justify-center rounded-xl text-2xl font-bold"
            style={{background:values.primary,color:values.background}} aria-label={`${project.name} monogram`}>{projectInitials(project.name)}</div>
            <p className="max-w-48 text-xs leading-relaxed text-muted-foreground">{message(locale,"Brand initials are used until a rights-cleared logo asset is linked.","利用許諾を確認したロゴが登録されるまでは頭文字を表示します。")}</p></div>
          <label className="flex min-w-0 flex-col gap-2 text-sm font-semibold">{message(locale,"Typography","書体")}
            <select aria-label="Typography preset" value={draft.typographyPreset} onChange={event=>{
              setSaved(false);setDraft(previous=>({...previous,typographyPreset:event.target.value as ProjectAppearanceDraft["typographyPreset"]}));
            }} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              {Object.values(PRESETS).map(preset=><option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <span className="text-xs font-normal text-muted-foreground">{PRESETS[draft.typographyPreset].description[locale]}</span>
          </label>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button onClick={save} disabled={invalid||!hasChanges}>{message(locale,"Save changes","変更を保存")}</Button>
          {(saved||!hasChanges)&&<span role="status" className="text-sm text-emerald-700"><Check className="mr-1 inline size-4" aria-hidden/>{message(locale,"Saved","保存しました")}</span>}
          {invalid&&<span className="text-sm text-destructive">{message(locale,"Fix invalid colors or names before saving.","保存する前に色または名前を修正してください。")}</span>}
          {appearance&&<span className="text-xs text-muted-foreground">{message(locale,"Current revision","現在の版")}: {appearance.revision}</span>}
        </div>
        {(project.brandAppearanceHistory?.length??0)>0&&<div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">{message(locale,"Previous versions","以前の版")}</span>
          {project.brandAppearanceHistory?.slice().reverse().map(old=><Button key={old.revision} size="sm" variant="outline"
            icon={<RotateCcw className="size-3.5" aria-hidden/>} onClick={()=>{const previous={palette:old.palette,typographyPreset:old.typographyPreset};setDraft(previous);onSave(previous);setSaved(true);}}>
            {message(locale,"Restore revision","版を復元") + " " + old.revision}
          </Button>)}
        </div>}
      </Surface>
    </div>
    <div className="min-w-0 space-y-5">
      <Surface header={<h2 className="font-semibold">{message(locale,"Live brand preview","ブランドのプレビュー")}</h2>}>
        <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1" role="group" aria-label="Preview format">
          {(["thumbnail","video","blog"] as Preview[]).map(kind=><Button key={kind} size="sm" variant={preview===kind?"secondary":"subtle"}
            aria-pressed={preview===kind} onClick={()=>setPreview(kind)}>{kind==="thumbnail"?"Thumbnail":kind==="video"?"Video":"Blog"}</Button>)}
        </div>
        <p className="mb-2 text-xs font-medium text-muted-foreground">{preview==="thumbnail"?"Thumbnail preview":preview==="video"?"Motion graphic preview":"Blog header preview"}</p>
        <BrandSample kind={preview} palette={values} name={project.name}/>
      </Surface>
      <Surface header={<h2 className="font-semibold">{message(locale,"Apply across ContentGen","ContentGen全体で使う")}</h2>}>
        <ul className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
          {["Thumbnails & covers","Explainer graphics","Charts & data visuals","Captions & social graphics","Blog & website art"].map(label=><li key={label} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden/>{label}</li>)}
        </ul>
        <p className="mt-4 rounded-lg bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">{message(locale,
          "These colors are saved as defaults for new work. Existing exports remain unchanged; editors may override individual colors.",
          "保存した色は今後の制作の初期値です。以前の書き出しは変更されず、編集画面で色を個別に変更できます。")}</p>
      </Surface>
    </div>
  </div>;
}

