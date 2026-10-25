import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronDown, ClipboardCopy, Download, FileText, Image, RefreshCcw, Video } from "lucide-react";
import {
  PLATFORM_NAMES, approvePlatformPackage, composedPlatformCaption, createPlatformOptimizationManifest,
  markPlatformReviewed, normalizeTarget, platformExportManifest, platformTimestamp,
  reconcilePlatformOptimizationManifest, reviewPlatformPackage, sourceSignature,
  resetPlatformField,
  updatePlatformAsset, updatePlatformField,
  type PlatformAsset, type PlatformField, type PlatformMediaField,
  type PlatformMetadataFields, type PlatformOptimizationInput,
  type PlatformOptimizationManifest, type PlatformTarget,
} from "./model";
import { loadPlatformOptimization, savePlatformOptimization } from "./storage";

interface PlatformOptimizationProps {
  input: PlatformOptimizationInput;
  onManifestChange?: (manifest: PlatformOptimizationManifest) => void;
}

const inputClass = "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring";
const cardClass = "rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5";
const isYoutube = (target: PlatformTarget) => target === "youtube" || target === "youtube-shorts";
const isBlog = (target: PlatformTarget) => target === "blog";

function initialDocument(input: PlatformOptimizationInput): { manifest: PlatformOptimizationManifest; warning: string | null } {
  const saved = loadPlatformOptimization(input.productionId, input.projectId);
  return {
    manifest: saved.manifest ? reconcilePlatformOptimizationManifest(saved.manifest, input) : createPlatformOptimizationManifest(input),
    warning: saved.warning,
  };
}

function outputFilename(filename: string): string {
  return filename.replace(/[^a-z0-9_.-]+/gi, "-").slice(0, 90);
}

function saveJson(filename: string, payload: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = outputFilename(filename);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function friendlyAsset(asset: PlatformAsset): string {
  return asset.filename?.trim() || asset.id;
}

function ThumbnailPlaceholder({ filename, colors }: { filename?: string; colors: PlatformOptimizationInput["brandColors"] }) {
  return <div className="flex min-h-[134px] items-center justify-center rounded-xl border border-white/20 p-5 text-center"
    style={{ background: colors?.primary ?? "#172c35", color: colors?.background ?? "#fafafa" }}>
    <div className="max-w-full">
      <Image className="mx-auto mb-2 size-6 opacity-65" aria-hidden />
      <p className="break-all text-xs font-medium">{filename ?? "No cover selected"}</p>
      <p className="mt-1 text-[11px] opacity-65">Asset reference only · no image generated here</p>
    </div>
  </div>;
}

function AssetPicker({ label, kind, value, input, platform, onChange }: {
  label: string; kind: PlatformMediaField; value: string | null;
  input: PlatformOptimizationInput; platform: PlatformTarget; onChange: (value: string | null) => void;
}) {
  const available = (input.assets ?? []).filter((asset) => asset.kind === kind &&
    (!asset.platform || normalizeTarget(asset.platform) === platform));
  const missing = value && !available.some((asset) => asset.id === value);
  return <label className="block min-w-0 text-xs font-medium text-muted-foreground">
    <span className="mb-1.5 block">{label}</span>
    <select className={inputClass} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
      <option value="">{kind === "video" ? "No rendered video selected" : "None selected"}</option>
      {missing && <option value={value}>{value} (not in current assets)</option>}
      {available.map((asset) => <option key={asset.id} value={asset.id}>{friendlyAsset(asset)}</option>)}
    </select>
  </label>;
}

function ChapterEditor({ chapters, onChange }: {
  chapters: PlatformMetadataFields["chapters"];
  onChange: (chapters: PlatformMetadataFields["chapters"]) => void;
}) {
  const [newSeconds, setNewSeconds] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const canAdd = /^\d+$/.test(newSeconds) && newTitle.trim().length > 0;
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold text-foreground">YouTube chapters</span>
      <span className="text-[11px] text-muted-foreground">Only times supplied by the final edit</span>
    </div>
    {chapters.length === 0 && <p className="text-xs text-muted-foreground">No verified timeline markers yet. Chapters will stay empty until real timestamps are available.</p>}
    {chapters.map((chapter, index) => <div key={index} className="flex items-center gap-2">
      <label className="w-24 shrink-0 text-[11px] text-muted-foreground">
        Time (sec)
        <input className={inputClass} type="number" min={0} step={1} aria-label={`Chapter ${index + 1} time (seconds)`}
          value={chapter.seconds} onChange={(event) => onChange(chapters.map((item, i) => i === index ? { ...item, seconds: Math.max(0, Number(event.target.value) || 0) } : item))} />
      </label>
      <label className="min-w-0 flex-1 text-[11px] text-muted-foreground">
        Heading
        <input className={inputClass} aria-label={`Chapter ${index + 1} heading`} value={chapter.title}
          onChange={(event) => onChange(chapters.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} />
      </label>
      <button type="button" className="mt-4 rounded-lg px-2 py-2 text-xs text-muted-foreground hover:bg-muted" aria-label={`Remove chapter ${index + 1}`}
        onClick={() => onChange(chapters.filter((_, i) => i !== index))}>Remove</button>
    </div>)}
    <div className="flex flex-wrap items-end gap-2 pt-1">
      <label className="w-24 text-[11px] text-muted-foreground">New time (sec)
        <input className={inputClass} type="number" min={0} step={1} value={newSeconds} onChange={(event) => setNewSeconds(event.target.value)} />
      </label>
      <label className="min-w-[150px] flex-1 text-[11px] text-muted-foreground">New heading
        <input className={inputClass} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
      </label>
      <button type="button" disabled={!canAdd} className="rounded-lg border border-border px-3 py-2.5 text-xs font-medium disabled:opacity-40"
        onClick={() => { onChange([...chapters, { seconds: Number(newSeconds), title: newTitle.trim() }]); setNewSeconds(""); setNewTitle(""); }}>Add chapter</button>
    </div>
  </div>;
}

function SectionHeading({ children, note }: { children: React.ReactNode; note?: string }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-2">
    <h3 className="text-sm font-semibold text-foreground">{children}</h3>
    {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
  </div>;
}

/** Keep the raw comma-separated input while typing; commit a parsed array on blur. */
function KeywordEditor({ value, label, splitWords = false, onCommit }: { value: string[]; label: string; splitWords?: boolean; onCommit: (items: string[]) => void }) {
  const joined = value.join(", ");
  const [draft, setDraft] = useState(joined);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(joined); }, [joined, editing]);
  return <input aria-label={label} className={inputClass} value={draft}
    onFocus={() => setEditing(true)} onChange={(event) => setDraft(event.target.value)}
    onBlur={() => {
      setEditing(false);
      onCommit([...new Set(draft.split(splitWords ? /[\s,]+/ : /,/).map((tag) => tag.trim()).filter(Boolean))]);
    }} />;
}

export function PlatformOptimization({ input, onManifestChange }: PlatformOptimizationProps) {
  const incomingSignature = sourceSignature(input);
  const targets = input.platforms.map(normalizeTarget).filter((target): target is PlatformTarget => target !== null);
  const targetKey = [...new Set(targets)].join("|");
  const [manifest, setManifest] = useState<PlatformOptimizationManifest>(() => initialDocument(input).manifest);
  const [warning, setWarning] = useState<string | null>(() => initialDocument(input).warning);
  const [selected, setSelected] = useState<PlatformTarget>(() => targets[0] ?? "youtube");
  const [notice, setNotice] = useState("");
  const onManifestChangeRef = useRef(onManifestChange);
  onManifestChangeRef.current = onManifestChange;

  useEffect(() => {
    const loaded = initialDocument(input);
    setManifest(loaded.manifest);
    setWarning(loaded.warning);
    setSelected((target) => loaded.manifest.packages.some((pkg) => pkg.platform === target) ? target : (loaded.manifest.packages[0]?.platform ?? "youtube"));
    // Identity/revision only; parent components may construct a new input object each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.productionId, input.projectId]);

  useEffect(() => {
    setManifest((previous) => reconcilePlatformOptimizationManifest(previous, input));
    // Reconcile when the actual source changes, without resetting hand-edited fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingSignature, targetKey]);

  useEffect(() => {
    try {
      savePlatformOptimization(manifest);
      setWarning(null);
      onManifestChangeRef.current?.(manifest);
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Could not save local platform draft.");
    }
  }, [manifest]);

  const pkg = manifest.packages.find((item) => item.platform === selected) ?? manifest.packages[0];
  const platform = pkg?.platform;
  const showUploadTitle = platform !== "instagram" && platform !== "tiktok";
  const review = useMemo(() => pkg ? reviewPlatformPackage(pkg, input) : null, [pkg, input]);
  const change = <K extends PlatformField,>(field: K, value: PlatformMetadataFields[K]) => {
    if (!platform) return;
    setManifest((previous) => updatePlatformField(previous, platform, field, value));
    setNotice("");
  };
  const changeAsset = (kind: PlatformMediaField, value: string | null) => {
    if (!platform) return;
    setManifest((previous) => updatePlatformAsset(previous, platform, kind, value));
  };
  const restore = (field: PlatformField) => {
    if (!platform) return;
    setManifest((previous) => resetPlatformField(previous, platform, field, input));
    setNotice("Source suggestion restored for this field.");
  };
  const exportAll = () => {
    saveJson(`contentgen-${input.productionId}-upload-packages.json`, platformExportManifest(manifest, input));
    setNotice("Metadata manifest downloaded. No media was uploaded or published.");
  };
  const exportCurrent = () => {
    if (!pkg) return;
    saveJson(`contentgen-${input.productionId}-${pkg.platform}-metadata.json`, {
      exportNotice: "Metadata only. No publishing action was performed.",
      productionId: input.productionId, projectId: input.projectId,
      package: pkg, checks: reviewPlatformPackage(pkg, input),
    });
    setNotice(`${PLATFORM_NAMES[pkg.platform]} metadata saved as JSON.`);
  };
  const copyDescription = async () => {
    if (!pkg) return;
    try {
      if (!navigator.clipboard?.writeText) throw Error("Clipboard unavailable. Select the text to copy manually.");
      await navigator.clipboard.writeText(composedPlatformCaption(pkg));
      setNotice("Caption / description copied.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Copy failed. Select the text to copy manually.");
    }
  };
  const approvedCount = manifest.packages.filter((item) => item.status === "approved").length;

  return <section className="space-y-5" aria-label="Platform optimization">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Step 7 · Optimize</p>
        <h2 className="font-serif text-2xl font-semibold text-foreground">Prepare every platform</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Titles, captions, keywords and chapters are prefilled from your source. Review each destination and adjust only what you need.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted-foreground">{approvedCount}/{manifest.packages.length} approved</span>
        <button type="button" onClick={exportAll} disabled={!manifest.packages.length}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          <Download className="size-4" aria-hidden /> Export packages
        </button>
      </div>
    </header>
    {warning && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">Local save warning: {warning}</div>}
    {notice && <div role="status" className="rounded-xl border border-border bg-muted/60 px-3 py-2 text-xs text-foreground">{notice}</div>}
    <nav className="flex flex-wrap gap-2" role="tablist" aria-label="Upload destinations">
      {manifest.packages.map((item) => {
        const active = item.platform === platform;
        const count = reviewPlatformPackage(item, input).issues.filter((finding) => finding.severity === "error").length;
        return <button key={item.platform} role="tab" type="button" aria-selected={active} aria-label={PLATFORM_NAMES[item.platform]}
          onClick={() => { setSelected(item.platform); setNotice(""); }}
          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}>
          {item.status === "approved" ? <CheckCircle2 className="size-4" aria-hidden /> : count ? <AlertCircle className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
          {PLATFORM_NAMES[item.platform]}
        </button>;
      })}
    </nav>

    {!pkg || !platform || !review ? <div className={cardClass}>Choose at least one supported destination in Setup to prepare platform metadata.</div> :
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]">
        <div className="space-y-4">
          <div className={`${cardClass} space-y-4`}>
            <SectionHeading note="Auto-prepared · all fields editable">Discoverability</SectionHeading>
            {showUploadTitle && <label className="block text-xs font-medium text-muted-foreground">
              <span className="mb-1.5 flex items-center justify-between gap-2">
                {isBlog(platform) ? "Article title" : isYoutube(platform) ? "Upload title" : "Post title"}
                {pkg.manualFields.includes("title") && <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => restore("title")}>Restore suggestion</button>}
              </span>
              <input aria-label={isYoutube(platform) ? "Upload title" : isBlog(platform) ? "Article title" : "Post title"}
                className={inputClass} value={pkg.fields.title} onChange={(event) => change("title", event.target.value)} />
              {isYoutube(platform) && <span className="mt-1 block text-right text-[11px]">{pkg.fields.title.length}/100</span>}
            </label>}
            <label className="block text-xs font-medium text-muted-foreground">
              <span className="mb-1.5 flex items-center justify-between gap-2">
                <span>{isBlog(platform) ? "Article summary" : isYoutube(platform) ? "Video description" : "Post caption"}</span>
                <span className="flex items-center gap-3">
                  {pkg.manualFields.includes("description") && <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => restore("description")}>Restore suggestion</button>}
                  <button type="button" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" onClick={() => void copyDescription()}>
                    <ClipboardCopy className="size-3.5" aria-hidden /> Copy
                  </button>
                </span>
              </span>
              <textarea rows={7} aria-label={isBlog(platform) ? "Article summary" : isYoutube(platform) ? "Video description" : "Post caption"}
                className={`${inputClass} resize-y leading-relaxed`} value={pkg.fields.description} onChange={(event) => change("description", event.target.value)} />
            </label>
            {(isYoutube(platform) || isBlog(platform)) && <label className="block text-xs font-medium text-muted-foreground">
              <span className="mb-1.5 block">Search tags <span className="font-normal">(comma-separated; optional)</span></span>
              <KeywordEditor value={pkg.fields.tags} label="Search tags"
                onCommit={(items) => change("tags", items)} />
              <span className="mt-1 block text-[11px] font-normal">Tags are supporting metadata, not a guarantee of discovery.</span>
            </label>}
            {!isBlog(platform) && <label className="block text-xs font-medium text-muted-foreground">
              <span className="mb-1.5 block">Hashtags <span className="font-normal">(comma-separated)</span></span>
              <KeywordEditor value={pkg.fields.hashtags} label="Hashtags" splitWords
                onCommit={(items) => change("hashtags", items)} />
            </label>}
            {isBlog(platform) && <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-muted-foreground">URL slug
                <input aria-label="URL slug" className={`${inputClass} mt-1.5`} value={pkg.fields.slug} onChange={(event) => change("slug", event.target.value)} />
              </label>
              <label className="block text-xs font-medium text-muted-foreground">Meta description
                <textarea aria-label="Meta description" className={`${inputClass} mt-1.5`} rows={3} value={pkg.fields.metaDescription}
                  onChange={(event) => change("metaDescription", event.target.value)} />
              </label>
            </div>}
          </div>

          <div className={`${cardClass} space-y-4`}>
            <SectionHeading note="References current media, without re-rendering">Media and format</SectionHeading>
            <div className="grid gap-3 sm:grid-cols-2">
              {isBlog(platform) ? <AssetPicker label="Article hero image" kind="hero" value={pkg.assetIds.hero} input={input} platform={platform} onChange={(value) => changeAsset("hero", value)} /> : <>
                <AssetPicker label="Rendered video" kind="video" value={pkg.assetIds.video} input={input} platform={platform} onChange={(value) => changeAsset("video", value)} />
                <AssetPicker label="Thumbnail / cover" kind="thumbnail" value={pkg.assetIds.thumbnail} input={input} platform={platform} onChange={(value) => changeAsset("thumbnail", value)} />
                <AssetPicker label="Captions / subtitle file" kind="captions" value={pkg.assetIds.captions} input={input} platform={platform} onChange={(value) => changeAsset("captions", value)} />
              </>}
              <label className="block text-xs font-medium text-muted-foreground">Content language
                <input aria-label="Content language" className={`${inputClass} mt-1.5`} value={pkg.fields.language}
                  onChange={(event) => change("language", event.target.value)} />
              </label>
            </div>
            {platform === "youtube" && <ChapterEditor chapters={pkg.fields.chapters} onChange={(chapters) => change("chapters", chapters)} />}
            {(isYoutube(platform) || isBlog(platform)) && <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-muted-foreground">{isBlog(platform) ? "Blog category" : "Playlist (optional)"}
                <input aria-label={isBlog(platform) ? "Blog category" : "Playlist"} className={`${inputClass} mt-1.5`}
                  value={isBlog(platform) ? pkg.fields.category : pkg.fields.playlist}
                  onChange={(event) => change(isBlog(platform) ? "category" : "playlist", event.target.value)} />
              </label>
              {!isBlog(platform) && <label className="block text-xs font-medium text-muted-foreground">Visibility for manual upload
                <select aria-label="Visibility" className={`${inputClass} mt-1.5`} value={pkg.fields.visibility}
                  onChange={(event) => change("visibility", event.target.value as PlatformMetadataFields["visibility"])}>
                  <option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option>
                </select>
              </label>}
            </div>}
            {isYoutube(platform) && <label className="block text-xs font-medium text-muted-foreground">Video category (optional)
              <input aria-label="Video category" className={`${inputClass} mt-1.5`} value={pkg.fields.category}
                onChange={(event) => change("category", event.target.value)} placeholder="e.g. Education" />
            </label>}
          </div>

          <div className={`${cardClass} space-y-4`}>
            <SectionHeading note="Never guessed from script content">Publication review</SectionHeading>
            {isYoutube(platform) && <label className="block text-xs font-medium text-muted-foreground">Made for children?
              <select aria-label="Made for children?" className={`${inputClass} mt-1.5`} value={pkg.fields.madeForKids === null ? "unknown" : String(pkg.fields.madeForKids)}
                onChange={(event) => change("madeForKids", event.target.value === "unknown" ? null : event.target.value === "true")}>
                <option value="unknown">Please choose</option><option value="false">No, not made for children</option><option value="true">Yes, made for children</option>
              </select>
            </label>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-muted-foreground">Paid promotion / sponsorship
                <select aria-label="Paid promotion" className={`${inputClass} mt-1.5`} value={pkg.fields.paidPromotion === null ? "unknown" : String(pkg.fields.paidPromotion)}
                  onChange={(event) => change("paidPromotion", event.target.value === "unknown" ? null : event.target.value === "true")}>
                  <option value="unknown">Check before posting</option><option value="false">No</option><option value="true">Yes — disclosure needed</option>
                </select>
              </label>
              <label className="block text-xs font-medium text-muted-foreground">Altered / synthetic media disclosure
                <select aria-label="Synthetic media disclosure" className={`${inputClass} mt-1.5`} value={pkg.fields.syntheticContentDisclosure === null ? "unknown" : String(pkg.fields.syntheticContentDisclosure)}
                  onChange={(event) => change("syntheticContentDisclosure", event.target.value === "unknown" ? null : event.target.value === "true")}>
                  <option value="unknown">Check before posting</option><option value="false">No disclosure needed</option><option value="true">Disclosure needed</option>
                </select>
              </label>
            </div>
            <label className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-foreground">
              <input type="checkbox" className="mt-0.5 accent-primary" checked={pkg.fields.rightsConfirmed}
                onChange={(event) => change("rightsConfirmed", event.target.checked)} />
              I reviewed asset rights, licensing, music, voice and attribution.
            </label>
            <label className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed text-foreground">
              <input type="checkbox" className="mt-0.5 accent-primary" checked={pkg.fields.platformPolicyReviewed}
                onChange={(event) => change("platformPolicyReviewed", event.target.checked)} />
              I checked this platform's current requirements and relevant disclosures.
            </label>
          </div>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4">
          <div className={`${cardClass} space-y-3`}>
            <SectionHeading note="Illustrative text preview">Destination preview</SectionHeading>
            <ThumbnailPlaceholder filename={(input.assets ?? []).find((asset) => asset.id === (isBlog(platform) ? pkg.assetIds.hero : pkg.assetIds.thumbnail))?.filename}
              colors={input.brandColors} />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {isBlog(platform) ? <FileText className="size-3.5" aria-hidden /> : <Video className="size-3.5" aria-hidden />}
              {PLATFORM_NAMES[platform]} · content preview
            </div>
            {showUploadTitle && <p className="break-words text-base font-semibold leading-snug text-foreground">{pkg.fields.title || "Untitled"}</p>}
            <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
              {composedPlatformCaption(pkg).slice(0, 350)}{composedPlatformCaption(pkg).length > 350 ? "…" : ""}
            </p>
            {platform === "youtube" && pkg.fields.chapters.length > 0 && <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              {pkg.fields.chapters.slice(0, 6).map((chapter, index) => <p key={index}>{platformTimestamp(chapter.seconds)} · {chapter.title}</p>)}
            </div>}
          </div>

          <div className={`${cardClass} space-y-3`}>
            <div className="flex items-center justify-between gap-2">
              <SectionHeading>Readiness check</SectionHeading>
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${review.readyToUpload ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                {pkg.status === "approved" ? "Approved" : review.readyToUpload ? "Ready for approval" : "Review needed"}
              </span>
            </div>
            {review.issues.length === 0 ? <p className="flex items-center gap-2 text-xs text-emerald-700"><CheckCircle2 className="size-4" aria-hidden /> All current checks passed.</p> :
              <ul className="space-y-2.5" aria-label="Platform readiness findings">
                {review.issues.map((finding) => <li key={finding.code} className="flex items-start gap-2 text-xs leading-relaxed">
                  {finding.severity === "error" ? <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-amber-700" aria-hidden /> :
                    <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                  <span className="text-muted-foreground">{finding.message}</span>
                </li>)}
              </ul>}
            {pkg.stale && <button type="button" onClick={() => setManifest((current) => markPlatformReviewed(current, platform))}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <RefreshCcw className="size-3.5" aria-hidden /> Reviewed updated source
            </button>}
            <div className="space-y-2 border-t border-border pt-3">
              <button type="button" disabled={!review.readyToUpload || pkg.status === "approved"}
                onClick={() => {
                  try { setManifest((current) => approvePlatformPackage(current, platform, input)); setNotice("Metadata package approved for manual upload preparation."); }
                  catch (error) { setNotice(error instanceof Error ? error.message : "Could not approve package."); }
                }} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-45">
                <Check className="size-4" aria-hidden /> Approve package
              </button>
              <button type="button" onClick={exportCurrent} className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium hover:bg-muted">
                <Download className="size-4" aria-hidden /> Export this platform's metadata
              </button>
              <p className="text-center text-[11px] leading-relaxed text-muted-foreground">No upload, scheduling, or publishing happens here. Exported JSON references media assets; attach files in your platform's upload flow.</p>
            </div>
          </div>
        </aside>
      </div>}
  </section>;
}
