import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FileText, PencilLine, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import {
  acceptScriptCandidate, approveScriptDraft, createScriptDraft, discardScriptCandidate,
  editScriptSection, estimatedNarrationSeconds, fillScriptSection, isScriptContextCurrent, loadScriptDraft,
  proposeScriptCandidate, rebaseScriptDraftContext, rebindEmptyScriptEvidence, saveScriptDraft, scriptEvidenceFingerprint, type ScriptDraft, type ScriptEvidence,
  type ScriptGeneratedText, type ScriptLocale, type ScriptPlatform, type ScriptRole,
} from "./script-review-model";

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
}

type ViewState = { draft: ScriptDraft | null; warning: string | null };
const platforms: Record<ScriptPlatform, string> = { youtube: "YouTube", youtube_shorts: "YouTube Shorts", tiktok: "TikTok",
  instagram: "Instagram", facebook: "Facebook", blog: "Blog", website: "Website" };
const secondsPerSection: Record<ScriptPlatform, number> = { youtube: 106, youtube_shorts: 18, tiktok: 27,
  instagram: 18, facebook: 28, blog: 110, website: 110 };
const textField = "w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const secondary = "rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50";

const duration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const outputId = (productionId: string, platform: ScriptPlatform) => `${productionId}:${platform}`;

export function ScriptReviewWorkspace({ productionId, projectId, platforms: targetPlatforms, locale, title,
  viewerQuestion, audience, angle, brandVoice, evidence, onApprove, onDraftChange }: ScriptReviewWorkspaceProps) {
  const allowed = targetPlatforms.filter(platform => Object.hasOwn(platforms, platform));
  const first = allowed[0] ?? "youtube";
  const [platform, setPlatform] = useState<ScriptPlatform>(first);
  const snapshotId = scriptEvidenceFingerprint(evidence);
  const context = useMemo(() => ({ productionId, projectId, platform, locale, title, viewerQuestion,
    audience, angle, brandVoice, evidenceSnapshotId: snapshotId }),
    [productionId, projectId, platform, locale, title, viewerQuestion, audience, angle, brandVoice, snapshotId]);
  const contextRef = useRef(context);
  contextRef.current = context;
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [regenerateId, setRegenerateId] = useState<ScriptRole | null>(null);
  const [instructions, setInstructions] = useState("");
  const [fullRewriteOpen, setFullRewriteOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [editingId, setEditingId] = useState<ScriptRole | null>(null);
  const [editedText, setEditedText] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const draft = view.draft;

  useEffect(() => {setPlatform(first);}, [productionId, first]);

  // Preserve per-platform draft and abort a previous platform's expensive local generation.
  useEffect(() => {
    const identity = outputId(productionId, platform);
    ownerRef.current = identity;
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    failuresRef.current.clear();
    const next = open();
    viewRef.current = next;
    setView(next);
    setBusy(null); setError(""); setRegenerateId(null); setEditingId(null);
    setFullRewriteOpen(false); setBatchBusy(false); setReviewConfirmed(false);
    return () => {abortRef.current?.abort();};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionId, platform]);

  useEffect(() => { viewRef.current = view; }, [view]);

  useEffect(() => {
    // Evidence may load after the component. Rebind a completely blank first draft only.
    // Never silently update the evidence lineage of accepted/generated text.
    const current = viewRef.current.draft;
    if (!current || current.input.productionId !== productionId || current.input.platform !== platform ||
        current.input.evidenceSnapshotId === snapshotId) return;
    const rebound = rebindEmptyScriptEvidence(current, snapshotId);
    if (rebound !== current) persist(rebound);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productionId, platform, snapshotId]);

  const persist = (next: ScriptDraft): boolean => {
    try {
      saveScriptDraft(next);
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

  async function generate(sectionId: ScriptRole, mode: "initial" | "regenerate", extraInstructions = "") {
    const before = viewRef.current.draft;
    if (!before || busyRef.current) return;
    if (!isScriptContextCurrent(before, context)) {
      setError("The script's research or creative brief changed. Review and adopt the updated context before generating.");
      return;
    }
    const index = before.sections.findIndex(section => section.id === sectionId);
    const section = before.sections[index];
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
    const request = { sectionId, heading: section.heading, purpose: section.purpose, mode,
      title: before.input.title, viewerQuestion: before.input.viewerQuestion,
      audience: before.input.audience, angle: before.input.angle, brandVoice: before.input.brandVoice,
      locale: before.input.locale, platform: before.input.platform, requestedDurationSeconds: secondsPerSection[platform],
      previousSection: before.sections[index - 1]?.text.slice(-1800) ?? "",
      nextSection: before.sections[index + 1]?.text.slice(0, 1800) ?? "",
      currentText: section.text, extraInstructions, evidence };
    try {
      const response = await fetch(`/api/contentgen-director/script-${mode === "initial" ? "generate" : "regenerate-section"}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Contentgen-Director": "local-only" },
        body: JSON.stringify(request), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(160_000)]),
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
      const candidate = { narration: result.narration ?? "", claimRefs: result.claimRefs ?? [],
        sourceRefs: result.sourceRefs ?? [] };
      const updated = mode === "initial" ? fillScriptSection(latest, sectionId, candidate, expectedRevision) :
        proposeScriptCandidate(latest, sectionId, candidate, expectedRevision, new Date().toISOString(), extraInstructions);
      if (persist(updated) && mode === "regenerate") setRegenerateId(null);
    } catch (problem) {
      if (ownerRef.current !== identity || controller.signal.aborted) return;
      const reason = problem instanceof Error ? problem.message : "Script generation failed.";
      if (mode === "initial") failuresRef.current.add(`${identity}:${sectionId}`);
      setError(`${section.heading}: ${reason} Accepted sections and manual corrections remain saved. ${mode === "initial" ? "Retry this section when your local model is available." : "You can retry or discard the proposed change."}`);
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
        busyRef.current || error || !evidence.length || view.warning) return;
    const next = draft.sections.find(section => !section.text &&
      !failuresRef.current.has(`${ownerRef.current}:${section.id}`));
    if (next) void generate(next.id, "initial");
    // generate reads latest state from viewRef, never a stale closure or another platform.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, productionId, platform, busy, error, evidence.length, view.warning]);

  const cite = (claimRef: string) => evidence.find(item => item.claimId === claimRef);
  const generated = draft?.sections.filter(section => section.text).length ?? 0;
  const seconds = draft?.sections.reduce((total, section) => total + estimatedNarrationSeconds(section.text, locale), 0) ?? 0;
  const unreviewed = draft?.sections.some(section => section.claimRefs.some(id =>
    evidence.some(item => item.claimId === id && item.reviewStatus !== "verified" && item.reviewStatus !== "illustrative"))) ?? false;
  const staleContext = Boolean(draft && !isScriptContextCurrent(draft, context));
  const done = Boolean(draft?.sections.every(section => !!section.text.trim()));

  const revise = (sectionId: ScriptRole, text: string) => {
    const current = viewRef.current.draft;
    if (!current) return;
    if (persist(editScriptSection(current, sectionId, text))) {
      setEditingId(null);
      setReviewConfirmed(false);
    }
  };
  const choose = (sectionId: ScriptRole, action: "accept" | "discard") => {
    const current = viewRef.current.draft;
    if (!current) return;
    try {
      if (persist(action === "accept" ? acceptScriptCandidate(current, sectionId) : discardScriptCandidate(current, sectionId)))
        setReviewConfirmed(false);
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
    setBatchBusy(true);
    for (const section of current.sections) {
      if (ownerRef.current !== identity) break;
      await generate(section.id, "regenerate", "Create a cohesive alternative to this section while preserving the overall question, sources and adjacent narrative continuity.");
    }
    if (ownerRef.current === identity) setBatchBusy(false);
  }

  return <div className="space-y-5" aria-label="Script review workspace">
    <Surface header={<div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-xl font-semibold"><FileText className="size-5 text-primary" />Review AI-generated script</h2>
        <p className="text-sm text-muted-foreground">AI prepares the complete first draft. Review the writing, edit only if needed, or improve any section with your own instructions.</p>
      </div>
      <div className="rounded-control border border-border bg-surface-subtle px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{generated}/5 sections</span> · <Clock3 className="inline size-3" /> Estimated {duration(seconds)}
      </div>
    </div>}>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Platform script versions">
        {allowed.map(target => <button key={target} type="button" onClick={() => setPlatform(target)}
          aria-pressed={target === platform} className={`${secondary} ${target === platform ? "border-primary bg-primary/10 text-primary" : ""}`}>
          {platforms[target]}
        </button>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Each destination has its own script and revision history. Switching platforms never overwrites another output.</p>
      {staleContext && <div role="status" className="mt-3 space-y-3 rounded-control border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <p>The research, brand voice or creative brief changed since this script began. Existing narration and revisions will be preserved, but any previous approval must be renewed after reviewing source links.</p>
        <button type="button" className={secondary} disabled={!!busy || batchBusy} onClick={adoptUpdatedContext}>
          Use updated context and review again
        </button>
      </div>}
      {done && <div className="mt-3">
        <button type="button" className={secondary} disabled={!!busy || batchBusy}
          onClick={() => setFullRewriteOpen(value => !value)}>Regenerate full script</button>
        {fullRewriteOpen && <div className="mt-3 space-y-2 rounded-control border border-amber-500/40 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold">Generate a full alternative script?</p>
          <p className="text-xs text-muted-foreground">This will request five independent AI suggestions. Your current text, manual changes and accepted versions stay untouched until you accept individual suggestions.</p>
          <div className="flex flex-wrap gap-2"><Button onClick={() => void regenerateFullScript()}>Generate five suggestions</Button>
            <button type="button" className={secondary} onClick={() => setFullRewriteOpen(false)}>Keep current script</button></div>
        </div>}
      </div>}
    </Surface>

    {view.warning && <Surface><div className="space-y-3" role="alert">
      <p className="font-semibold">Saved script needs attention</p><p className="text-sm">{view.warning}</p>
      <p className="text-xs text-muted-foreground">Create a new draft only if you have saved a copy or are certain the old data is no longer needed.</p>
      <Button onClick={() => persist(createScriptDraft(context))}>Create a new script draft</Button>
    </div></Surface>}
    {!evidence.length && <p role="alert" className="rounded-control border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      This idea has no captured evidence yet. Return to Discovery, collect claim-supporting sources, then reopen Script. ContentGen will not invent research or citations.
    </p>}
    {error && <p role="alert" className="rounded-control border border-destructive/50 bg-destructive/5 p-3 text-sm text-foreground">{error}</p>}

    {draft?.sections.map((section, index) => {
      const candidate = draft.pending[section.id];
      const sectionBusy = busy === `initial:${section.id}` || busy === `regenerate:${section.id}`;
      return <section key={section.id} className="rounded-surface border border-border bg-surface p-4 shadow-sm sm:p-6" aria-label={`${section.heading} script section`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="font-medium">SECTION {index + 1}</span>
              <span>·</span><span>Estimated {duration(estimatedNarrationSeconds(section.text, locale))}</span>
              {section.revision > 0 && <span>· Revision {section.revision}</span>}
            </div>
            <h3 className="text-lg font-semibold">{section.heading}</h3>
            <p className="text-xs text-muted-foreground">{section.purpose}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={secondary} onClick={() => {setEditingId(section.id);setEditedText(section.text);}}
              aria-label={`Edit section ${section.heading}`} disabled={!section.text}><PencilLine className="mr-1 inline size-4" />Edit section</button>
            <button type="button" className={secondary} onClick={() => {setRegenerateId(section.id);setInstructions("");}}
              aria-label={`Regenerate section ${section.heading}`} disabled={!section.text || !!busy || batchBusy}>
              <RefreshCw className="mr-1 inline size-4" />Regenerate section
            </button>
          </div>
        </div>
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

