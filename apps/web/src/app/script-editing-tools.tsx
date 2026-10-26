import {useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {Dialog} from "@/components/ui/dialog";
import {SCRIPT_ROLES} from "../../scripts/video-production/script-contract.mjs";
import {MAX_SCRIPT_IMPORT_BYTES,parseScriptImport,type ScriptImportSection} from "./script-import";
import type {NewScriptSection,ScriptRole} from "./script-review-model";

const field="w-full rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-primary";
const cancel="rounded-control border border-border px-3 py-2 text-sm hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary";

export function ScriptInsertDialog({heading:anchor,position,busy,onApply,onClose,saveError}:{heading:string;position:"before"|"after";busy:boolean;saveError?:string;
  onApply:(section:NewScriptSection)=>boolean;onClose:()=>void}) {
  const [heading,setHeading]=useState("");
  const [purpose,setPurpose]=useState("Introduce a new point that advances the script without repeating earlier sections.");
  const [role,setRole]=useState<ScriptRole>("custom");
  const [text,setText]=useState("");
  return <Dialog open title="Add a script section" description={`Insert ${position} “${anchor}”. Existing narration and revision history stay in place.`}
    size="lg" onClose={onClose}>
    <form className="space-y-4" onSubmit={event=>{event.preventDefault();if(onApply({heading,purpose,role,text}))onClose();}}>
      <label className="block space-y-1 text-sm font-medium">Section heading<input autoFocus className={field} required maxLength={140} value={heading} onChange={event=>setHeading(event.target.value)} placeholder="How FileQuell can help accountants" /></label>
      <label className="block space-y-1 text-sm font-medium">Section role<select className={field} value={role} onChange={event=>setRole(event.target.value as ScriptRole)}>
        {SCRIPT_ROLES.map(value=><option key={value} value={value}>{value==="promotion"?"Promotion / call to action":value[0].toUpperCase()+value.slice(1)}</option>)}
      </select></label>
      <label className="block space-y-1 text-sm font-medium">Purpose / AI direction<textarea className={field} required minLength={10} maxLength={400} rows={3} value={purpose} onChange={event=>setPurpose(event.target.value)} /></label>
      <label className="block space-y-1 text-sm font-medium">Narration (optional)<textarea className={field} maxLength={6500} rows={5} value={text} onChange={event=>setText(event.target.value)} placeholder="Paste your narration, or leave blank to write or generate it later." /></label>
      <p className="text-xs text-muted-foreground">New text starts without citations. Link captured evidence in Edit section and review factual statements before release. Adding a section resets approval and clears pending AI suggestions. AI writing pauses while you edit.</p>
      {saveError&&<p role="alert" className="text-sm text-destructive">{saveError}</p>}
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy||!heading.trim()||purpose.trim().length<10}>Add section</Button>
        <button className={cancel} type="button" onClick={onClose}>Cancel</button></div>
    </form>
  </Dialog>;
}

export function ScriptImportDialog({busy,onApply,onClose,saveError}:{busy:boolean;saveError?:string;onApply:(sections:ScriptImportSection[])=>boolean;onClose:()=>void}) {
  const [raw,setRaw]=useState("");
  const [preview,setPreview]=useState<ScriptImportSection[]|null>(null);
  const [error,setError]=useState("");
  const fileRead=useRef(0);
  const change=(value:string)=>{fileRead.current++;setRaw(value);setPreview(null);setError("");};
  return <Dialog open title="Import full script" description="Preview JSON or numbered text, then replace this platform’s script. A copy of the current script is saved for Restore previous script. Other platforms are unchanged."
    size="lg" onClose={onClose}>
    <div className="space-y-4">
      <details className="rounded-control border border-border p-3 text-sm"><summary className="cursor-pointer font-medium">Supported formats and examples</summary>
        <p className="mt-2 text-xs text-muted-foreground">Use 1–20 sections, up to 6,500 characters each. Every [number] starts a new section on its own line; text beside it is narration. JSON headings and roles are optional.</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-control bg-surface-subtle p-3 text-xs">{'[1] Opening narration…\nMore narration in section one.\n\n[2]\nThe next section…\n\nOR\n\n{"sections":[\n  {"heading":"Opening", "text":"Opening narration…"},\n  {"heading":"FileQuell", "role":"promotion", "text":"Your reviewed product message…"}\n]}'}</pre>
      </details>
      <label className="block space-y-1 text-sm font-medium">Import text file (optional)<input className={field} type="file" accept=".txt,.json,text/plain,application/json" onChange={async event=>{
        const file=event.target.files?.[0];if(!file)return;
        const token=++fileRead.current;setRaw("");setPreview(null);setError("");
        try {if(file.size>MAX_SCRIPT_IMPORT_BYTES)throw Error("Script import exceeds 512 KB.");const value=await file.text();if(fileRead.current===token){setRaw(value);}}
        catch(problem){if(fileRead.current===token)setError(problem instanceof Error?problem.message:"Unable to read file.");}
      }} /></label>
      <label className="block space-y-1 text-sm font-medium">Script to import<textarea className={field} rows={9} value={raw} onChange={event=>change(event.target.value)} placeholder="[1] Opening narration…" /></label>
      {saveError&&<p role="alert" className="text-sm text-destructive">{saveError}</p>}
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button onClick={()=>{try{setPreview(parseScriptImport(raw));setError("");}catch(problem){setPreview(null);setError(problem instanceof Error?problem.message:"Unable to parse script.");}}}>Preview import</Button>
      {preview&&<div className="space-y-3" aria-label="Script import preview">
        <p className="text-sm font-semibold">{preview.length} sections ready to import</p>
        <ol className="max-h-72 space-y-3 overflow-y-auto rounded-control border border-border p-3">
          {preview.map((section,index)=><li key={index} className="space-y-1"><p className="text-sm font-medium">{index+1}. {section.heading}</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-6">{section.text}</p><p className="text-xs text-muted-foreground">{section.sourceRefs?.length?"Citation IDs will be checked against captured evidence.":"Uncited — factual review needed"}</p></li>)}
        </ol>
        <p className="text-xs text-muted-foreground">Imported text is saved as manual narration. It resets approval and clears pending AI suggestions. No AI rewrites or invented citations.</p>
        <Button disabled={busy} onClick={()=>{if(onApply(preview))onClose();}}>Replace current script</Button>
      </div>}
      <button className={cancel} type="button" onClick={onClose}>Cancel import</button>
    </div>
  </Dialog>;
}
