import { useEffect, useEffectEvent, useId, useMemo, useState } from "react";
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
import { artworkPng, canExportPlatformArtwork, generateBlogHtml, generateBlogMarkdown, generatePlatformArtwork, generatedArtworkCatalog } from "./generated-art";

type CoverLayout = "story" | "tiles" | "editorial";
type CoverDraft = { key: string; headline: string; layout: CoverLayout };
const coverLayouts: readonly { id: CoverLayout; name: string; suffix: string }[] = [
  { id: "story", name: "Story layout", suffix: "" },
  { id: "tiles", name: "Tile layout", suffix: "-tiles" },
  { id: "editorial", name: "Editorial layout", suffix: "-editorial" },
];
function loadCoverDraft(key: string, initialHeadline: string): CoverDraft {
  const fallback: CoverDraft = { key, headline: initialHeadline, layout: "story" };
  if (!key) return fallback;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null") as Record<string, unknown> | null;
    if (!stored || typeof stored.headline !== "string" || stored.headline.length > 110 ||
      !coverLayouts.some((layout) => layout.id === stored.layout)) return fallback;
    return { key, headline: stored.headline, layout: stored.layout as CoverLayout };
  } catch { return fallback; }
}

function coverScriptSignature(input: PlatformOptimizationInput, platform: PlatformTarget): string {
  // Artwork copy follows this destination's script, not its download assets,
  // citation review status, unrelated metadata, or the BrandKit palette.
  return sourceSignature({...input,assets:[],sourceEvidence:[],sourceRevision:undefined,
    summary:undefined,audience:undefined,primaryKeyword:undefined,brandColors:undefined,
    approvedPlatforms:[platform]},platform);
}

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

function saveFile(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
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
  const selected = available.find(asset=>asset.id===value);
  return <div className="min-w-0">
    <label className="block text-xs font-medium text-muted-foreground">
      <span className="mb-1.5 block">{label}</span>
      <select className={inputClass} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{kind === "video" ? "No rendered video selected" : "None selected"}</option>
        {missing && <option value={value}>{value} (not in current assets)</option>}
        {available.map((asset) => <option key={asset.id} value={asset.id}>{friendlyAsset(asset)}</option>)}
      </select>
    </label>
    {selected?.downloadUrl?.startsWith("/api/contentgen-video/media/")&&
      <a className="mt-1 inline-block text-xs font-medium text-primary underline" href={selected.downloadUrl}
        download={selected.filename}>Download selected local file</a>}
  </div>;
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
  const [draft, setDraft] = useState<string | null>(null);
  return <input aria-label={label} className={inputClass} value={draft ?? joined}
    onFocus={() => setDraft(joined)} onChange={(event) => setDraft(event.target.value)}
    onBlur={() => {
      onCommit([...new Set((draft ?? joined).split(splitWords ? /[\s,]+/ : /,/).map((tag) => tag.trim()).filter(Boolean))]);
      setDraft(null);
    }} />;
}

export function PlatformOptimization({ input, onManifestChange }: PlatformOptimizationProps) {
  return <PlatformOptimizationEditor key={JSON.stringify([input.productionId, input.projectId])}
    input={input} onManifestChange={onManifestChange} />;
}

function PlatformOptimizationEditor({ input, onManifestChange }: PlatformOptimizationProps) {
  // Generated artwork is a genuine, reproducible browser-side artifact, not an
  // imaginary server media URL. Real renderer files win when both are present.
  const availableInput = useMemo<PlatformOptimizationInput>(() => ({
    ...input, assets: [...generatedArtworkCatalog(input), ...(input.assets ?? [])],
  }), [input]);
  const incomingSignature = sourceSignature(availableInput);
  const targets = input.platforms.map(normalizeTarget).filter((target): target is PlatformTarget => target !== null);
  const targetKey = [...new Set(targets)].join("|");
  const [snapshot, setSnapshot] = useState(() => ({
    manifest: initialDocument(availableInput).manifest, signature: incomingSignature, targetKey, persisted: true,
  }));
  const [warning, setWarning] = useState<string | null>(() => initialDocument(availableInput).warning);
  const [selected, setSelected] = useState<PlatformTarget>(() => targets[0] ?? "youtube");
  const [notice, setNotice] = useState("");
  const [exportingArt, setExportingArt] = useState<string | null>(null);
  const titleInputId = useId();
  const descriptionInputId = useId();

  // React can restart this render immediately: no stale production is shown or
  // saved while changing destinations, and manual fields survive source updates.
  if (snapshot.signature !== incomingSignature || snapshot.targetKey !== targetKey) {
    setSnapshot({
      manifest: reconcilePlatformOptimizationManifest(snapshot.manifest, availableInput),
      signature: incomingSignature, targetKey, persisted: false,
    });
  }
  const manifest = snapshot.manifest;

  const announceManifest = useEffectEvent((current: PlatformOptimizationManifest) => {
    onManifestChange?.(current);
  });

  useEffect(() => {
    if(snapshot.persisted)announceManifest(manifest);
  }, [snapshot, manifest]);

  const setManifest = (update: (current: PlatformOptimizationManifest) => PlatformOptimizationManifest): boolean => {
    const next = update(manifest);
    let persisted = false;
    try {
      savePlatformOptimization(next);
      setWarning(null);
      persisted = true;
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Could not save local platform draft.");
    }
    // Retain the unsaved edit on screen, but never tell the parent an approval
    // was saved if browser storage rejected it.
    setSnapshot({ manifest: next, signature: incomingSignature, targetKey, persisted });
    return persisted;
  };

  const pkg = manifest.packages.find((item) => item.platform === selected) ?? manifest.packages[0];
  const platform = pkg?.platform;
  // A cover is an independent, explicitly edited download. It never overwrites
  // an approved script, upload title, or a saved media asset with the same ID.
  // Rendered MP4/caption assets arrive asynchronously after a successful job.
  // Their addition must not erase a manually chosen thumbnail design.
  const coverKey = platform ? `contentgen:cover-draft:v1:${input.productionId}:${platform}:${coverScriptSignature(input,platform)}` : "";
  const [coverDraft,setCoverDraft] = useState<CoverDraft>(() => loadCoverDraft(coverKey,input.title));
  if (coverDraft.key !== coverKey) setCoverDraft(loadCoverDraft(coverKey,input.title));
  const activeCover = coverDraft.key === coverKey ? coverDraft : loadCoverDraft(coverKey,input.title);
  const updateCover = (update: Partial<Omit<CoverDraft,"key">>) => {
    const next = {...activeCover,...update};
    setCoverDraft(next);
    try {localStorage.setItem(coverKey,JSON.stringify({headline:next.headline,layout:next.layout}));}
    catch(error){setWarning(error instanceof Error?`Cover is not saved: ${error.message}`:"Cover could not be saved locally.");}
  };
  const artwork = useMemo(() => platform ? generatePlatformArtwork(input,platform,
    platform === "blog" ? input.title : activeCover.headline || input.title) : [], [input,platform,activeCover.headline]);
  const chosenCover = artwork.find((art) => art.id === `cover-${platform}${coverLayouts.find((option) => option.id === activeCover.layout)?.suffix ?? ""}`) ?? artwork[0];
  const artApproved = Boolean(platform && canExportPlatformArtwork(input, platform));
  const showUploadTitle = platform !== "instagram" && platform !== "tiktok";
  const review = useMemo(() => pkg ? reviewPlatformPackage(pkg, availableInput) : null, [pkg, availableInput]);
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
    setManifest((previous) => resetPlatformField(previous, platform, field, availableInput));
    setNotice("Source suggestion restored for this field.");
  };
  const exportAll = () => {
    saveJson(`contentgen-${input.productionId}-upload-packages.json`, platformExportManifest(manifest, availableInput));
    setNotice("Metadata manifest downloaded. No media was uploaded or published.");
  };
  const exportCurrent = () => {
    if (!pkg) return;
    saveJson(`contentgen-${input.productionId}-${pkg.platform}-metadata.json`, {
      exportNotice: "Metadata only. No publishing action was performed.",
      productionId: input.productionId, projectId: input.projectId,
      package: pkg, checks: reviewPlatformPackage(pkg, availableInput),
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
  const downloadArt = async (id: string) => {
    const art = artwork.find((entry) => entry.id === id);
    if (!art || exportingArt) return;
    setExportingArt(id);
    try {
      saveFile(art.filename, await artworkPng(art));
      setNotice(`${art.label} downloaded as ${art.width}×${art.height} PNG. Review legibility before posting.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Artwork export failed.");
    } finally { setExportingArt(null); }
  };
  const exportArticle = (format: "markdown" | "html") => {
    if (!pkg || platform !== "blog" || !artApproved) { setNotice("Approve the current Blog script before exporting the article."); return; }
    try {
    const md = generateBlogMarkdown(input, pkg.fields.title, artwork, pkg.fields.description);
    if (format === "markdown") {
      saveFile(`${pkg.fields.slug || "article"}.md`, new Blob([md], { type: "text/markdown;charset=utf-8" }));
    } else {
      const html = generateBlogHtml(input, pkg.fields.title, pkg.fields.description, pkg.fields.metaDescription, artwork);
      saveFile(`${pkg.fields.slug || "article"}.html`, new Blob([html], { type: "text/html;charset=utf-8" }));
    }
    setNotice(`${format === "html" ? "Self-contained illustrated HTML" : "Article Markdown"} downloaded. Review citations, visual accuracy and rights before publishing.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Article export failed."); }
  };

  return <section className="space-y-5" aria-label="Platform optimization">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Step 7 · Publish Kit</p>
        <h2 className="font-serif text-2xl font-semibold text-foreground">Everything you need to post</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Metadata is prefilled as you draft. After a destination's script is approved, its cover and article illustrations are generated locally. Check accuracy and then finish publication requirements.
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
        const count = reviewPlatformPackage(item, availableInput).issues.filter((finding) => finding.severity === "error").length;
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
            {showUploadTitle && <div className="block text-xs font-medium text-muted-foreground">
              <span className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor={titleInputId}>{isBlog(platform) ? "Article title" : isYoutube(platform) ? "Upload title" : "Post title"}</label>
                {pkg.manualFields.includes("title") && <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => restore("title")}>Restore suggestion</button>}
              </span>
              <input id={titleInputId}
                className={inputClass} value={pkg.fields.title} onChange={(event) => change("title", event.target.value)} />
              {isYoutube(platform) && <span className="mt-1 block text-right text-[11px]">{pkg.fields.title.length}/100</span>}
            </div>}
            <div className="block text-xs font-medium text-muted-foreground">
              <span className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor={descriptionInputId}>{isBlog(platform) ? "Article summary" : isYoutube(platform) ? "Video description" : "Post caption"}</label>
                <span className="flex items-center gap-3">
                  {pkg.manualFields.includes("description") && <button type="button" className="text-[11px] text-primary hover:underline" onClick={() => restore("description")}>Restore suggestion</button>}
                  <button type="button" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline" onClick={() => void copyDescription()}>
                    <ClipboardCopy className="size-3.5" aria-hidden /> Copy
                  </button>
                </span>
              </span>
              <textarea id={descriptionInputId} rows={7}
                className={`${inputClass} resize-y leading-relaxed`} value={pkg.fields.description} onChange={(event) => change("description", event.target.value)} />
            </div>
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
            <SectionHeading note="Existing renders + generated local graphics">Media and format</SectionHeading>
            <div className="grid gap-3 sm:grid-cols-2">
              {isBlog(platform) ? <AssetPicker label="Article hero image" kind="hero" value={pkg.assetIds.hero} input={availableInput} platform={platform} onChange={(value) => changeAsset("hero", value)} /> : <>
                <AssetPicker label="Rendered video" kind="video" value={pkg.assetIds.video} input={availableInput} platform={platform} onChange={(value) => changeAsset("video", value)} />
                <AssetPicker label="Thumbnail / cover" kind="thumbnail" value={pkg.assetIds.thumbnail} input={availableInput} platform={platform} onChange={(value) => changeAsset("thumbnail", value)} />
                <AssetPicker label="Captions / subtitle file" kind="captions" value={pkg.assetIds.captions} input={availableInput} platform={platform} onChange={(value) => changeAsset("captions", value)} />
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
            <SectionHeading note="Made locally with Kumiki">{isBlog(platform) ? "Article illustrations" : "Thumbnail designer"}</SectionHeading>
            {artwork.length === 0 ? <p className="text-sm text-muted-foreground">Approve the current {PLATFORM_NAMES[platform]} script in the Script stage to generate download-ready artwork.</p> :
              isBlog(platform) ? <div className="grid gap-3 sm:grid-cols-2">{artwork.map((art) => <div key={art.id} className="min-w-0 rounded-xl border border-border p-2.5">
                <img src={art.preview} alt={`${art.label}: outline of the current script`} className="aspect-video w-full rounded-lg bg-muted object-contain" />
                <div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-xs font-semibold">{art.label}</span>
                  <button type="button" className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                    disabled={!!exportingArt} onClick={() => void downloadArt(art.id)}>{exportingArt === art.id ? "Rendering…" : "PNG ↓"}</button></div>
              </div>)}</div> : <div className="space-y-4" aria-label="Thumbnail design tools">
                <h4 className="font-serif text-xl font-semibold">Design your thumbnail</h4>
                <label className="block text-xs font-medium text-muted-foreground">Thumbnail headline
                  <input className={`${inputClass} mt-1.5`} aria-label="Thumbnail headline" maxLength={110}
                    value={activeCover.headline} onChange={(event) => updateCover({headline:event.target.value})}/>
                </label>
                {chosenCover && <img src={chosenCover.preview} alt="Selected thumbnail preview"
                  className="w-full rounded-xl border border-border bg-muted object-contain"/>}
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Thumbnail layouts">
                  {coverLayouts.map((option)=>{
                    const image=artwork.find((entry) => entry.id===`cover-${platform}${option.suffix}`);
                    return <button type="button" key={option.id} aria-label={option.name} aria-pressed={activeCover.layout===option.id}
                      disabled={!image} onClick={()=>updateCover({layout:option.id})}
                      className={`rounded-xl border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${activeCover.layout===option.id ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}>
                      {image && <img src={image.preview} alt="" className="aspect-video w-full rounded-md bg-muted object-contain"/>}
                      <span className="mt-1.5 block text-xs font-semibold">{option.name.replace(" layout","")}</span>
                    </button>;
                  })}
                </div>
                <button type="button" disabled={!chosenCover||!!exportingArt} onClick={()=>chosenCover&&void downloadArt(chosenCover.id)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                  <Download className="size-4" aria-hidden /> {exportingArt ? "Rendering PNG…" : "Download selected thumbnail"}
                </button>
                <p className="text-xs text-muted-foreground">Three editable text-based layouts, no fabricated photos. Your headline and choice are saved for this script revision. Download the PNG to attach to your upload.</p>
              </div>}
            {isBlog(platform) && <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
              <p className="text-sm font-semibold">{artApproved ? "Your illustrated article is ready to export" : "Approve your Blog script to unlock the illustrated article"}</p>
              <p className="text-xs text-muted-foreground">HTML includes the graphics inline. Markdown references the PNGs above—download those beside the article file.</p>
              <div className="flex flex-wrap gap-2"><button type="button" disabled={!artApproved} className={inputClass + " w-auto font-medium disabled:cursor-not-allowed disabled:opacity-40"} onClick={() => exportArticle("html")}>Download illustrated HTML</button>
                <button type="button" disabled={!artApproved} className={inputClass + " w-auto font-medium disabled:cursor-not-allowed disabled:opacity-40"} onClick={() => exportArticle("markdown")}>Download Markdown</button></div>
            </div>}
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
            {chosenCover ? <img className="w-full rounded-xl border border-border object-contain" src={chosenCover.preview} alt={`${PLATFORM_NAMES[platform]} generated cover preview`} /> :
              <ThumbnailPlaceholder filename={(availableInput.assets ?? []).find((asset) => asset.id === (isBlog(platform) ? pkg.assetIds.hero : pkg.assetIds.thumbnail))?.filename}
                colors={input.brandColors} />}
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
              <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${review.metadataReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                {pkg.status === "approved" ? "Metadata approved" : review.metadataReady ? "Ready to review metadata" : "Review needed"}
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
            {pkg.status === "approved" && !review.readyToUpload && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
              Metadata is approved, but this package cannot be uploaded yet. Attach a real destination render and complete rights and disclosure checks first.
            </p>}
            {pkg.stale && <button type="button" onClick={() => setManifest((current) => markPlatformReviewed(current, platform))}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
              <RefreshCcw className="size-3.5" aria-hidden /> Reviewed updated source
            </button>}
            <div className="space-y-2 border-t border-border pt-3">
              <button type="button" disabled={!review.metadataReady || pkg.status === "approved"}
                onClick={() => {
                  try {
                    const saved = setManifest((current) => approvePlatformPackage(current, platform, availableInput));
                    setNotice(saved ? "Metadata approved and saved. File, rights and disclosure checks still control upload readiness." :
                      "Metadata review is visible here but was not saved. Restore browser storage before leaving this page.");
                  }
                  catch (error) { setNotice(error instanceof Error ? error.message : "Could not approve package."); }
                }} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-45">
                <Check className="size-4" aria-hidden /> Approve metadata
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

