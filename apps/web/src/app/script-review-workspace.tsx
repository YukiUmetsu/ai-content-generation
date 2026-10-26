import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Copy, FileText, PencilLine, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import {
  acceptScriptCandidate, approveScriptDraft, copyShortFormScript, createScriptDraft, discardScriptCandidate,
  editScriptSection, estimatedNarrationSeconds, fillScriptSection, isScriptContextCurrent, loadScriptDraft,
  insertScriptSection, proposeScriptCandidate, rebaseScriptDraftContext, rebindEmptyScriptEvidence, restoreScriptRevision, saveScriptDraft,
  scriptEvidenceFingerprint, SHORT_FORM_SCRIPT_PLATFORMS,
  type ScriptDraft, type ScriptEvidence,
  type ScriptGeneratedText, type ScriptLocale, type ScriptPlatform, type NewScriptSection,
} from "./script-review-model";
import {scriptSectionRole,MAX_SCRIPT_SECTIONS} from "../../scripts/video-production/script-contract.mjs";
import {applyScriptImport,loadScriptBackup,saveScriptReplacement,type ScriptImportSection} from "./script-import";
import {ScriptInsertDialog,ScriptImportDialog} from "./script-editing-tools";

export interface ScriptReviewWorkspaceProps {
  productionId: string;
  projectId: string;
  platforms: readonly ScriptPlatform[];
  locale: ScriptLocale;
  title: string;
  viewerQuestion: string;
  audience: string;
  angle: string;
  brandVoice: string;
  evidence: ScriptEvidence[];
  onApprove: (draft: ScriptDraft) => void;
  /** Allows the parent workflow to invalidate downstream approval when an accepted section changes. */
  onDraftChange?: (draft: ScriptDraft) => void;
  onStatusChange?: (status: "idle" | "running" | "failed") => void;
}

type ViewState = { draft: ScriptDraft | null; warning: string | null };
type CopyDestination = { platform: ScriptPlatform; existing: boolean; warning: string | null; snapshot: string | null };
const platforms: Record<ScriptPlatform, string> = { youtube: "YouTube", youtube_shorts: "YouTube Shorts", tiktok: "TikTok",
  instagram: "Instagram", facebook: "Facebook", blog: "Blog", website: "Website" };
const secondsPerSection: Record<ScriptPlatform, number> = { youtube: 106, youtube_shorts: 18, tiktok: 27,
  instagram: 18, facebook: 28, blog: 235, website: 110 };
const textField = "w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const secondary = "rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50";

const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const outputId = (productionId: string, platform: ScriptPlatform) => `${productionId}:${platform}`;

export function ScriptReviewWorkspace(props: ScriptReviewWorkspaceProps) {
  const { productionId, platforms: targetPlatforms } = props;
  const allowed = targetPlatforms.filter(platform => Object.hasOwn(platforms, platform));
  const first = allowed[0] ?? "youtube";
  const [selection, setSelection] = useState({ productionId, platform: first });
  const platform = selection.productionId === productionId && allowed.includes(selection.platform) ? selection.platform : first;
  return <ScriptReviewEditor key={outputId(productionId, platform)} {...props} allowed={allowed} platform={platform}
    onSelectPlatform={target => setSelection({ productionId, platform: target })} />;
}

interface ScriptReviewEditorProps extends ScriptReviewWorkspaceProps {
  allowed: ScriptPlatform[];
  platform: ScriptPlatform;
  onSelectPlatform: (platform: ScriptPlatform) => void;
}

function ScriptReviewEditor({ productionId, projectId, allowed, platform, onSelectPlatform, locale, title,
  viewerQuestion, audience, angle, brandVoice, evidence, onApprove, onDraftChange, onStatusChange }: ScriptReviewEditorProps) {
  const snapshotId = scriptEvidenceFingerprint(evidence);
  const context = useMemo(() => ({ productionId, projectId, platform, locale, title, viewerQuestion,
    audience, angle, brandVoice, evidenceSnapshotId: snapshotId }),
    [productionId, projectId, platform, locale, title, viewerQuestion, audience, angle, brandVoice, snapshotId]);
  const contextRef = useRef(context);
  const open = (): ViewState => {
    const saved = loadScriptDraft(productionId, platform);
    return saved.draft || saved.warning ? saved : { draft: createScriptDraft(context), warning: null };
  };
  const [view, setView] = useState<ViewState>(open);
  const viewRef = useRef(view);
  const ownerRef = useRef(outputId(productionId, platform));
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const failuresRef = useRef(new Set<string>());
  const rejectedRef = useRef<Partial<Record<string,string[]>>>({});
  const mountedRef = useRef(true);
  const batchStopped = useRef(false);
  const [autoPaused, setAutoPaused] = useState(false);
  // YouTube keeps its existing AI-first behavior. Other destinations start on
  // explicit request, so switching tabs never launches an unexpected model job.
  const [fullDraftRequested, setFullDraftRequested] = useState(platform === "youtube");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [regenerateId, setRegenerateId] = useState<string | null>(null);
  const [instructions, setInstructions] = useState("");
  const [fullRewriteOpen, setFullRewriteOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState("");
  const [editedClaims,setEditedClaims]=useState<string[]>([]);
  const [inserting,setInserting]=useState<{id:string;heading:string;position:"before"|"after"}|null>(null);
  const [importOpen,setImportOpen]=useState(false);
  const [hasBackup,setHasBackup]=useState(()=>{try{return !!loadScriptBackup(productionId,platform);}catch{return false;}});
  const pauseWriting=()=>{batchStopped.current=true;setAutoPaused(true);abortRef.current?.abort();};
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyDestinations, setCopyDestinations] = useState<CopyDestination[]>([]);
  const [copySelection, setCopySelection] = useState<ScriptPlatform[]>([]);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [copyMessage, setCopyMessage] = useState("");
  // A pristine first draft can adopt evidence arriving after mount. Authored drafts
  // retain their original context until the editor explicitly reviews and adopts it.
  const draft = useMemo(() => view.draft ? rebindEmptyScriptEvidence(view.draft, snapshotId) : null,
    [view.draft, snapshotId]);

  // Accepted text is advanced synchronously by persist(). A delayed passive
  // effect must never roll this ref back to an older committed render while
  // another section is already being saved. Only pristine drafts can rebind.
  useEffect(() => {
    const latest=viewRef.current.draft;
    if(latest)viewRef.current={...viewRef.current,draft:rebindEmptyScriptEvidence(latest,snapshotId)};
  }, [snapshotId]);
  useEffect(() => { contextRef.current = context; }, [context]);
  // The editor is keyed by output identity: switching outputs remounts the local state.
  useEffect(() => {
    mountedRef.current=true;
    return () => {mountedRef.current=false;batchStopped.current=true;abortRef.current?.abort();};
  }, []);
  useEffect(() => {onStatusChange?.(busy ? "running" : error ? "failed" : "idle");}, [busy,error,onStatusChange]);

  const persist = (next: ScriptDraft, replacement=false): boolean => {
    try {
      if(replacement&&viewRef.current.draft){saveScriptReplacement(next,viewRef.current.draft);setHasBackup(true);}
      else saveScriptDraft(next);
      const state = { draft: next, warning: null };
      viewRef.current = state;
      setView(state);
      onDraftChange?.(next);
      return true;
    } catch (problem) {
      setError(`Unable to save script. Your existing accepted draft was not deleted. ${problem instanceof Error ? problem.message : "Storage unavailable."}`);
      return false;
    }
  };

  async function generate(sectionId: string, mode: "initial" | "regenerate", extraInstructions = "", useProposedPredecessors=false) {
    const before = viewRef.current.draft;
    if (!before || busyRef.current || !mountedRef.current) return;
    if (!isScriptContextCurrent(before, context)) {
      setError("The script's research or creative brief changed. Review and adopt the updated context before generating.");
      return;
    }
    const index = before.sections.findIndex(section => section.id === sectionId);
    const section = before.sections[index];
    if (mode === "initial" && section?.text.trim()) return;
    if (!section || !evidence.length) {
      setError("The idea has no captured evidence. Return to Discovery and complete its source research before drafting factual narration.");
      return;
    }
    const identity = ownerRef.current;
    const expectedRevision = section.revision;
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    setBusy(`${mode}:${sectionId}`);
    setError("");
    const continuity=(value:ScriptDraft)=>value.sections.map((item,position)=>({sectionId:item.id,
      role:scriptSectionRole(item),heading:item.heading,purpose:item.purpose,
      text:useProposedPredecessors&&position<index?value.pending[item.id]?.text??item.text:item.text}));
    const scriptSections=continuity(before);
    const request = { sectionId, sectionRole:scriptSectionRole(section), heading: section.heading, purpose: section.purpose, mode,
      title: before.input.title, viewerQuestion: before.input.viewerQuestion,
      audience: before.input.audience, angle: before.input.angle, brandVoice: before.input.brandVoice,
      locale: before.input.locale, platform: before.input.platform, requestedDurationSeconds: secondsPerSection[platform],
      previousSection: scriptSections[index - 1]?.text.slice(-1800) ?? "",
      nextSection: scriptSections[index + 1]?.text.slice(0, 1800) ?? "",
      currentText: section.text, extraInstructions, evidence,
      scriptSections,rejectedTexts:[...new Set([...(rejectedRef.current[sectionId]??[]),
        ...(before.pending[sectionId]?[before.pending[sectionId]!.text]:[])])].slice(-2) };
    try {
      const response = await fetch(`/api/contentgen-director/script-${mode === "initial" ? "generate" : "regenerate-section"}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Contentgen-Director": "local-only" },
        body: JSON.stringify(request), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(320_000)]),
      });
      const result = await response.json() as Partial<ScriptGeneratedText> & { error?: string };
      if (!response.ok) throw Error(result.error ?? `Script AI returned HTTP ${response.status}.`);
      if (ownerRef.current !== identity || controller.signal.aborted) return;
      const latest = viewRef.current.draft;
      if (!latest) return;
      if (!isScriptContextCurrent(latest, contextRef.current) ||
          latest.input.evidenceSnapshotId !== before.input.evidenceSnapshotId) {
        setError("Research or creative context changed while AI was drafting. The outdated response was discarded; review updated sources and retry.");
        return;
      }
      if(JSON.stringify(continuity(latest))!==JSON.stringify(request.scriptSections)) {
        setError("Another script section changed while AI was writing. The outdated response was discarded; retry using the updated script.");
        return;
      }
      const candidate = { narration: result.narration ?? "", claimRefs: result.claimRefs ?? [],
        sourceRefs: result.sourceRefs ?? [] };
      const updated = mode === "initial" ? fillScriptSection(latest, sectionId, candidate, expectedRevision) :
        proposeScriptCandidate(latest, sectionId, candidate, expectedRevision, new Date().toISOString(), extraInstructions);
      if (persist(updated) && mode === "regenerate") setRegenerateId(null);
    } catch (problem) {
      if (ownerRef.current !== identity || controller.signal.aborted) return;
      const reason = problem instanceof Error ? problem.message : "Script generation failed.";
      if (mode === "initial") failuresRef.current.add(`${identity}:${sectionId}`);
      setError(`${section.heading}: ${reason} Accepted sections and manual corrections remain saved. ${mode === "initial" ? "You can retry this section." : "You can retry or discard the proposed change."}`);
    } finally {
      if (ownerRef.current === identity) {
        busyRef.current = false;
        abortRef.current = null;
        setBusy(null);
      }
    }
  }

  // AI-first: as soon as the user selects an idea, generate missing sections one small request at a time.
  useEffect(() => {
    if (!draft || draft.input.productionId !== productionId || draft.input.platform !== platform ||
        !isScriptContextCurrent(draft, context) ||
        busyRef.current || autoPaused || error || !fullDraftRequested || !evidence.length || view.warning) return;
    const next = viewRef.current.draft?.sections.find(section => !section.text &&
      !failuresRef.current.has(`${ownerRef.current}:${section.id}`));
    if (next) void generate(next.id, "initial");
    // generate reads latest state from viewRef, never a stale closure or another platform.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, productionId, platform, busy, autoPaused, error, fullDraftRequested, evidence.length, view.warning]);

  const cite = (claimRef: string) => evidence.find(item => item.claimId === claimRef);
  const generated = draft?.sections.filter(section => section.text).length ?? 0;
  const seconds = draft?.sections.reduce((total, section) => total + estimatedNarrationSeconds(section.text, locale), 0) ?? 0;
  const articleWords = draft?.sections.reduce((total, section) => total + section.text.trim().split(/\s+/u).filter(Boolean).length, 0) ?? 0;
  const articleReadMinutes = locale === "ja"
    ? Math.max(1, Math.ceil((draft?.sections.reduce((total, section) => total + section.text.length, 0) ?? 0) / 500))
    : Math.max(1, Math.ceil(articleWords / 200));
  const unreviewed = draft?.sections.some(section => section.claimRefs.some(id =>
    evidence.some(item => item.claimId === id && item.reviewStatus !== "verified" && item.reviewStatus !== "illustrative"))) ?? false;
  const staleContext = Boolean(draft && !isScriptContextCurrent(draft, context));
  const done = Boolean(draft?.sections.every(section => !!section.text.trim()));
  const shortDestinations = allowed.filter(candidate => candidate !== platform && SHORT_FORM_SCRIPT_PLATFORMS.includes(candidate));
  const replacing = copyDestinations.some(destination => destination.existing && copySelection.includes(destination.platform));

  const openCopy = () => {
    const choices = shortDestinations.map(target => {
      const saved = loadScriptDraft(productionId, target);
      const existing = Boolean(saved.draft && (saved.draft.status === "approved" ||
        Object.keys(saved.draft.pending).length || saved.draft.sections.some(section => section.revision || section.text)));
      return { platform: target, existing, warning: saved.warning, snapshot: saved.draft ? JSON.stringify(saved.draft) : null };
    });
    setCopyDestinations(choices);
    setCopySelection(choices.filter(target => !target.existing && !target.warning).map(target => target.platform));
    setReplaceConfirmed(false);
    setCopyMessage("");
    setCopyOpen(true);
  };
  const copyToSelected = () => {
    const source = viewRef.current.draft;
    if (!source || !copySelection.length || busyRef.current || batchBusy) return;
    setCopyMessage("");
    try {
      // Preflight every destination before the first write. A blocked, corrupt or
      // changed target cannot turn a multi-platform copy into a surprise overwrite.
      const prepared = copySelection.map(target => {
        const saved = loadScriptDraft(productionId, target);
        if (saved.warning) throw Error(`${platforms[target]}: ${saved.warning}`);
        const selected = copyDestinations.find(item => item.platform === target);
        if (!selected || (saved.draft ? JSON.stringify(saved.draft) : null) !== selected.snapshot)
          throw Error(`${platforms[target]} changed after you opened copy options. Reopen the picker and review the destination again.`);
        const next = copyShortFormScript(source, { ...context, platform: target }, saved.draft,
          { replaceExisting: replaceConfirmed && selected.existing });
        return { platform: target, draft: next };
      });
      let completed = 0;
      for (const output of prepared) {
        try {
          const current = loadScriptDraft(productionId, output.platform);
          if (current.warning || (current.draft ? JSON.stringify(current.draft) : null) !==
            copyDestinations.find(item => item.platform === output.platform)?.snapshot)
            throw Error("Destination changed during copying. Reopen the picker to retry.");
          saveScriptDraft(output.draft);
        } catch (problem) {
          throw Error(`${platforms[output.platform]} could not be saved after ${completed} successful copies. ${problem instanceof Error ? problem.message : "Storage unavailable."}`);
        }
        completed++;
        onDraftChange?.(output.draft);
      }
      setCopyOpen(false);
      setCopyMessage(`Copied accepted sections to ${prepared.map(output => platforms[output.platform]).join(", ")}. Review each destination before approval.`);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Unable to copy script.");
    }
  };

  const revise = (sectionId: string, text: string) => {
    const current = viewRef.current.draft;
    if (!current) return;
    try {
    const sourceRefs=[...new Set(evidence.filter(item=>editedClaims.includes(item.claimId)).map(item=>item.sourceId))];
    if (persist(editScriptSection(current, sectionId, text,undefined,{claimRefs:editedClaims,sourceRefs}))) {
      setEditingId(null);
      setReviewConfirmed(false);
    }
    } catch(problem){setError(problem instanceof Error?problem.message:"Unable to save section edit.");}
  };
  const restore = (sectionId: string, revision: number) => {
    const current = viewRef.current.draft;
    if (!current) return;
    try {
      if (persist(restoreScriptRevision(current, sectionId, revision))) {
        setHistoryId(null);
        setReviewConfirmed(false);
      }
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Unable to restore script version."); }
  };
  const choose = (sectionId: string, action: "accept" | "discard") => {
    const current = viewRef.current.draft;
    if (!current) return;
    try {
      const discarded=current.pending[sectionId]?.text;
      if (persist(action === "accept" ? acceptScriptCandidate(current, sectionId) : discardScriptCandidate(current, sectionId))) {
        if(action==="discard"&&discarded)rejectedRef.current[sectionId]=[...(rejectedRef.current[sectionId]??[]),discarded].slice(-2);
        setReviewConfirmed(false);
      }
    } catch (problem) {setError(problem instanceof Error ? problem.message : "Unable to apply script suggestion.");}
  };
  const approve = () => {
    const current = viewRef.current.draft;
    if (!current) return;
    try {
      const approved = approveScriptDraft(current);
      if (persist(approved)) onApprove(approved);
    } catch (problem) {setError(problem instanceof Error ? problem.message : "Cannot approve incomplete script.");}
  };
  const adoptUpdatedContext = () => {
    const current = viewRef.current.draft;
    if (!current) return;
    try {
      if (persist(rebaseScriptDraftContext(current, context))) {
        failuresRef.current.clear();
        setReviewConfirmed(false);
        setRegenerateId(null);
        setError("");
      }
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Could not update script research context.");
    }
  };
  async function regenerateFullScript() {
    const identity = ownerRef.current;
    const current = viewRef.current.draft;
    if (!current || !current.sections.every(section => section.text)) return;
    setFullRewriteOpen(false);
    batchStopped.current=false;
    setBatchBusy(true);
    for (const section of current.sections) {
      if (ownerRef.current !== identity || !mountedRef.current || batchStopped.current) break;
      const previous=viewRef.current.draft?.pending[section.id];
      await generate(section.id, "regenerate", "Create a cohesive alternative to this section while preserving the overall question, sources and narrative continuity. Earlier proposed sections are the beginning of this alternative script.",true);
      if(viewRef.current.draft?.pending[section.id]===previous)break;
    }
    if (ownerRef.current === identity) setBatchBusy(false);
  }

  const addSection=(section:NewScriptSection)=>{
    const current=viewRef.current.draft;if(!current||!inserting||busyRef.current||batchBusy)return false;
    try {const saved=persist(insertScriptSection(current,inserting.id,inserting.position,section));if(saved){setReviewConfirmed(false);setError("");}return saved;}
    catch(problem){setError(problem instanceof Error?problem.message:"Unable to add section.");return false;}
  };
  const importSections=(sections:ScriptImportSection[])=>{
    const current=viewRef.current.draft;if(!current||busyRef.current||batchBusy)return false;
    try {const saved=persist(applyScriptImport(current,sections,evidence),true);if(saved){setReviewConfirmed(false);setEditingId(null);setRegenerateId(null);setError("");failuresRef.current.clear();}return saved;}
    catch(problem){setError(problem instanceof Error?problem.message:"Unable to import script.");return false;}
  };
  const restorePrevious=()=>{
    pauseWriting();
    try{const previous=loadScriptBackup(productionId,platform);if(!previous)throw Error("No previous script is available.");
      if(previous.input.projectId!==projectId)throw Error("Previous script belongs to a different project.");
      if(persist({...previous,status:"draft",approvedAt:null,updatedAt:new Date().toISOString()},true)){
        setReviewConfirmed(false);setEditingId(null);setRegenerateId(null);setError("");
      }
    }catch(problem){setError(problem instanceof Error?problem.message:"Unable to restore script.");}
  };

  return <div className="space-y-5" aria-label="Script review workspace">
    <Surface header={<div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><FileText className="size-5 text-primary" />Review AI-generated script</h2>
        <p className="text-sm text-muted-foreground">Generate a platform-specific draft, then review, edit or improve individual sections. YouTube starts automatically; other platforms start when you request them.</p>
      </div>
      <div className="rounded-control border border-border bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{generated}/{draft?.sections.length??0} sections</span> · <Clock3 className="inline size-3" /> {platform === "blog" ? `${locale === "ja" ? "Japanese article" : `${articleWords.toLocaleString()} words`} · about ${articleReadMinutes} min read` : `Estimated ${duration(seconds)}`}
      </div>
    </div>}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Platform script versions">
        {allowed.map(target => <button key={target} type="button" onClick={() => onSelectPlatform(target)}
          aria-pressed={target === platform} className={`${secondary} ${target === platform ? "border-primary bg-primary/10 text-primary" : ""}`}>
          {platforms[target]}
        </button>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Each destination has its own script and revision history. Switching platforms never overwrites another output.</p>
      {draft&&<div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={()=>{pauseWriting();setError("");setImportOpen(true);}}>Import full script</Button>
        {hasBackup&&<button type="button" className={secondary} disabled={!!busy||batchBusy} onClick={restorePrevious}>Restore previous script</button>}
      </div>}
      {!done && <div className="mt-3">
        <Button disabled={!!busy || batchBusy || !evidence.length || !!view.warning || staleContext}
          onClick={() => { failuresRef.current.clear(); setError(""); setAutoPaused(false); setFullDraftRequested(true); }}
          icon={<Sparkles className="size-4" />}>
          {generated ? `Generate remaining ${platforms[platform]} sections` : `Generate full ${platforms[platform]} script`}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">Writes missing sections in order, using captured evidence and previous sections. Accepted edits stay saved.</p>

      </div>}
      {staleContext && <div role="status" className="mt-3 space-y-3 rounded-control border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <p>The research, brand voice or creative brief changed since this script began. Existing narration and revisions will be preserved, but any previous approval must be renewed after reviewing source links.</p>
        <button type="button" className={secondary} disabled={!!busy || batchBusy} onClick={adoptUpdatedContext}>
          Use updated context and review again
        </button>
      </div>}
      {done && draft && <div className="mt-3">
        <button type="button" className={secondary} disabled={!!busy || batchBusy}
          onClick={() => setFullRewriteOpen(value => !value)}>Regenerate full script</button>
        {fullRewriteOpen && <div className="mt-3 space-y-2 rounded-control border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold">Generate a full alternative script?</p>
          <p className="text-xs text-muted-foreground">This will request {draft.sections.length} AI suggestions in script order, using earlier proposed sections for continuity. Your current text, manual changes and accepted versions stay untouched until you accept individual suggestions.</p>
          <div className="flex flex-wrap gap-2"><Button onClick={() => void regenerateFullScript()}>Generate {draft.sections.length} suggestions</Button>
            <button type="button" className={secondary} onClick={() => setFullRewriteOpen(false)}>Keep current script</button></div>
        </div>}
      </div>}
      {SHORT_FORM_SCRIPT_PLATFORMS.includes(platform) && shortDestinations.length > 0 && <div className="mt-4 rounded-control border border-border bg-surface-subtle p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-semibold"><Copy className="size-4 text-primary" />Use this script on other short-form platforms</p>
            <p className="text-xs text-muted-foreground">Copy all accepted sections and source links, then customize and approve each version separately. No AI request needed.</p>
          </div>
          <button type="button" className={secondary} disabled={!done || staleContext || !!busy || batchBusy || !!view.warning}
            onClick={() => copyOpen ? setCopyOpen(false) : openCopy()}>{copyOpen ? "Close copy options" : "Copy to other platforms"}</button>
        </div>
        {copyOpen && <div className="mt-4 space-y-3 border-t border-border pt-4" aria-label="Copy script destinations">
          <p className="text-sm font-semibold">Choose destinations</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {copyDestinations.map(destination => <label key={destination.platform}
              className="flex cursor-pointer items-start gap-3 rounded-control border border-border bg-surface p-3 text-sm">
              <input type="checkbox" className="mt-1 accent-primary" disabled={!!destination.warning}
                checked={copySelection.includes(destination.platform)} onChange={event => {
                  setCopySelection(previous => event.target.checked ? [...previous, destination.platform] : previous.filter(item => item !== destination.platform));
                  setReplaceConfirmed(false);
                }} aria-label={`Copy to ${platforms[destination.platform]}`} />
              <span className="min-w-0"><span className="block font-medium">{platforms[destination.platform]}</span>
                <span className="block text-xs text-muted-foreground">{destination.warning ? "Saved draft needs attention — open this tab first" :
                  destination.existing ? "Existing script — replacing requires confirmation" : "No accepted script yet"}</span></span>
            </label>)}
          </div>
          {replacing && <label className="flex items-start gap-2 rounded-control border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <input type="checkbox" className="mt-1 accent-primary" checked={replaceConfirmed}
              onChange={event => setReplaceConfirmed(event.target.checked)} />
            <span>Replace the selected existing scripts. Their earlier revisions will be preserved, but approvals and pending AI suggestions will be cleared.</span>
          </label>}
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!copySelection.length || (replacing && !replaceConfirmed) || !!busy || batchBusy}
              onClick={copyToSelected}>Copy to {copySelection.length} {copySelection.length === 1 ? "platform" : "platforms"}</Button>
            <button type="button" className={secondary} onClick={() => setCopyOpen(false)}>Cancel</button>
          </div>
        </div>}
        {copyMessage && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{copyMessage}</p>}
      </div>}
    </Surface>

    {(busy || batchBusy) && <div role="status" className="flex items-center gap-3 text-sm">
      <p>Writing one section at a time with your configured local script model…</p>
      <button type="button" className={secondary} onClick={() => {
        batchStopped.current=true;setAutoPaused(true);abortRef.current?.abort();
      }}>Stop writing</button>
    </div>}
    {autoPaused && !busy && !done && <button type="button" className={secondary} onClick={() => {
      setAutoPaused(false);setError("");failuresRef.current.clear();
    }}>Continue writing missing sections</button>}
    {view.warning && <Surface><div className="space-y-3" role="alert">
      <p className="font-semibold">Saved script needs attention</p><p className="text-sm">{view.warning}</p>
      <p className="text-xs text-muted-foreground">Create a new draft only if you have saved a copy or are certain the old data is no longer needed.</p>
      <Button onClick={() => persist(createScriptDraft(context))}>Create a new script draft</Button>
    </div></Surface>}
    {!evidence.length && <p role="alert" className="rounded-control border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      This idea has no captured evidence yet. Collect supporting sources above to start AI writing. ContentGen will not invent research or citations.
    </p>}
    {error && <p role="alert" className="rounded-control border border-destructive/50 bg-destructive/5 p-3 text-sm text-foreground">{error}</p>}

    {draft?.sections.map((section, index) => {
      const candidate = draft.pending[section.id];
      const sectionBusy = busy === `initial:${section.id}` || busy === `regenerate:${section.id}`;
      return <section key={section.id} className="rounded-surface border border-border bg-surface p-4 shadow-sm sm:p-6" aria-label={`${section.heading} script section`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="font-medium">SECTION {index + 1}</span>
              <span>·</span><span>{platform === "blog" ? `${section.text.trim().split(/\s+/u).filter(Boolean).length} words` : `Estimated ${duration(estimatedNarrationSeconds(section.text, locale))}`}</span>
              {section.revision > 0 && <span>· Revision {section.revision}</span>}
            </div>
            <h3 className="text-lg font-semibold">{section.heading}</h3>
            <p className="text-xs text-muted-foreground">{section.purpose}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {section.history.length > 1 && <button type="button" className={secondary}
              aria-expanded={historyId === section.id} onClick={() => setHistoryId(current => current === section.id ? null : section.id)}>
              Revision history ({section.history.length})</button>}
            <button type="button" className={secondary} onClick={() => {pauseWriting();setEditingId(section.id);setEditedText(section.text);setEditedClaims(section.claimRefs);}}
              aria-label={`Edit section ${section.heading}`}><PencilLine className="mr-1 inline size-4" />Edit section</button>
            <button type="button" className={secondary} onClick={() => {setRegenerateId(section.id);setInstructions("");}}
              aria-label={`Regenerate section ${section.heading}`} disabled={!section.text || !!busy || batchBusy}>
              <RefreshCw className="mr-1 inline size-4" />Regenerate section
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["before","after"] as const).map(position=><button key={position} type="button" className={secondary}
            disabled={draft.sections.length>=MAX_SCRIPT_SECTIONS} aria-label={`Add section ${position} ${section.heading}`}
            onClick={()=>{pauseWriting();setError("");setInserting({id:section.id,heading:section.heading,position});}}>+ Add {position}</button>)}
          {draft.sections.length>=MAX_SCRIPT_SECTIONS&&<span className="text-xs text-muted-foreground">20-section limit reached</span>}
        </div>
        {historyId === section.id && <div className="mt-4 space-y-3 rounded-control border border-border bg-surface-subtle p-4" aria-label={`Revision history for ${section.heading}`}>
          <p className="text-sm font-semibold">Previous accepted versions</p>
          {section.history.slice(0, -1).map(entry => <div key={entry.revision} className="rounded-control border border-border bg-surface p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Revision {entry.revision} · {entry.origin}</span>
              <button type="button" className={secondary} disabled={!!busy || batchBusy}
                onClick={() => restore(section.id, entry.revision)}>Restore revision {entry.revision}</button>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{entry.text}</p>
          </div>)}
          <p className="text-xs text-muted-foreground">Restoring creates a new accepted revision and requires fresh script approval. Current and earlier versions remain in history.</p>
        </div>}
        <div className="mt-4 rounded-control bg-surface-subtle p-4 text-sm leading-7 text-foreground">
          {section.text ? <p className="whitespace-pre-wrap">{section.text}</p> :
            <div className="space-y-2 text-muted-foreground"><p>{sectionBusy ? "AI is writing this section using the captured evidence…" : "This section is waiting for AI generation."}</p>
              {!busy && evidence.length > 0 && <button className="text-primary underline" type="button"
                onClick={() => {failuresRef.current.delete(`${ownerRef.current}:${section.id}`);void generate(section.id, "initial");}}>Generate / retry this section</button>}
            </div>}
        </div>
        {section.text && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {section.sourceRefs.length ? section.sourceRefs.map(sourceId => {
            const source = evidence.find(item => item.sourceId === sourceId);
            return source ? <a key={sourceId} href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2">
              Source: {sourceId}</a> : <span key={sourceId}>Source {sourceId} unavailable — review needed</span>;
          }) : <span className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="size-3" />No source linked — check factual statements</span>}
          {section.claimRefs.some(id => !cite(id) || !["verified", "illustrative"].includes(cite(id)!.reviewStatus)) &&
            <span className="text-amber-700 dark:text-amber-400">Claim requires editorial review</span>}
          {section.history.length > 1 && <span>{section.history.length} accepted versions preserved</span>}
        </div>}

        {editingId === section.id && <div className="mt-4 space-y-2 rounded-control border border-border p-3">
          <label className="block text-xs font-semibold" htmlFor={`script-edit-${section.id}`}>Edit {section.heading}</label>
          <textarea id={`script-edit-${section.id}`} aria-label={`Edit ${section.heading}`} className={textField} rows={6}
            maxLength={6500} value={editedText} onChange={event => setEditedText(event.target.value)} />
          <p className="text-xs text-muted-foreground">Manual text remains yours. Recheck evidence for any new factual statements; previous accepted text stays in revision history.</p>
          {evidence.length>0&&<fieldset className="space-y-2 rounded-control border border-border p-3">
            <legend className="text-xs font-semibold">Supporting captured evidence (optional)</legend>
            {evidence.map(item=><label key={item.claimId+item.sourceId} className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5 accent-primary"
              checked={editedClaims.includes(item.claimId)} onChange={event=>setEditedClaims(value=>event.target.checked?[...new Set([...value,item.claimId])]:value.filter(id=>id!==item.claimId))} />
              <span>{item.claimText} · {item.sourceId}</span></label>)}
          </fieldset>}
          <div className="flex flex-wrap gap-2"><Button onClick={() => revise(section.id, editedText)}>Save section edit</Button>
            <button className={secondary} type="button" onClick={() => setEditingId(null)}>Cancel edit</button></div>
        </div>}

        {regenerateId === section.id && !candidate && <div className="mt-4 space-y-3 rounded-control border border-primary/30 bg-primary/5 p-4">
          <div><p className="font-semibold">Improve only “{section.heading}”</p><p className="text-xs text-muted-foreground">The current narration and neighboring sections are provided for context. Other sections will not change.</p></div>
          <label className="block text-sm font-medium" htmlFor={`script-instructions-${section.id}`}>Extra instructions (optional)</label>
          <textarea className={textField} id={`script-instructions-${section.id}`} rows={3} value={instructions}
            maxLength={2000} aria-label={`Extra instructions for ${section.heading}`} onChange={event => setInstructions(event.target.value)}
            placeholder="Make this more surprising, with a concrete everyday example. No unsupported statistics." />
          <div className="flex flex-wrap gap-2"><Button disabled={!!busy || batchBusy} onClick={() => void generate(section.id, "regenerate", instructions)}
            icon={<Sparkles className="size-4" />}>{sectionBusy ? "Generating…" : "Generate section candidate"}</Button>
            <button type="button" className={secondary} onClick={() => setRegenerateId(null)}>Cancel</button></div>
        </div>}

        {candidate && <div className="mt-4 space-y-3 rounded-control border border-primary/40 p-4" aria-label={`Suggested revision for ${section.heading}`}>
          <p className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-primary" />Suggested revision — not applied</p>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-control bg-surface-subtle p-3"><p className="mb-2 text-xs font-bold text-muted-foreground">CURRENT · REVISION {section.revision}</p>
              <p className="whitespace-pre-wrap text-sm leading-6">{section.text}</p></div>
            <div className="rounded-control border border-primary/30 bg-primary/5 p-3"><p className="mb-2 text-xs font-bold text-primary">PROPOSED</p>
              <p className="whitespace-pre-wrap text-sm leading-6">{candidate.text}</p></div>
          </div>
          <p className="text-xs text-muted-foreground">Review the facts and meaning before accepting. Accepting keeps the previous version in history.</p>
          <div className="flex flex-wrap gap-2"><Button onClick={() => choose(section.id, "accept")}>Accept suggested section</Button>
            <button className={secondary} type="button" onClick={() => choose(section.id, "discard")}>Discard suggestion</button></div>
        </div>}
      </section>;
    })}

    {inserting&&<ScriptInsertDialog {...inserting} busy={!!busy||batchBusy} onApply={addSection} onClose={()=>setInserting(null)} saveError={error} />}
    {importOpen&&<ScriptImportDialog busy={!!busy||batchBusy} onApply={importSections} onClose={()=>setImportOpen(false)} saveError={error} />}
    {draft && <Surface header={<h3 className="text-base font-semibold">Ready for storyboard?</h3>}>
      <p className="text-sm text-muted-foreground">Script changes are versioned. After approval, storyboard shots, narration timing and previously rendered assets may need review if you change a section.</p>
      <div className="mt-3 flex items-center gap-2 text-sm">
        {done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Clock3 className="size-4 text-muted-foreground" />}
        <span>{done ? "All sections have narration." : `${draft.sections.length - generated} sections still need AI narration.`}</span>
      </div>
      {(unreviewed || draft.sections.some(s => !s.sourceRefs.length)) && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">Some claims are unverified or uncited. Read the linked research and resolve unsupported factual statements before release.</p>}
      <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm"><input className="mt-1 accent-primary" type="checkbox"
        checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} />
        <span>I have reviewed the factual claims, source links and caveats in the script.</span></label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button disabled={!done || !!busy || !!view.warning || !reviewConfirmed || staleContext ||
          Object.keys(draft.pending).length > 0} onClick={approve}>Approve script &amp; continue</Button>
        {draft.status === "approved" && <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-4" />Approved revision saved</span>}
      </div>
    </Surface>}
  </div>;
}

