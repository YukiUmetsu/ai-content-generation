import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertCircle, CheckCircle2, Download, FileArchive, Layers3, Save, ShieldAlert, UploadCloud } from "lucide-react";
import { Surface } from "@/components/ui/surface-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { CHARACTER_PACK_LIMITS, inspectCharacterZip } from "./character-pack";
import type { InspectedCharacterPack } from "./character-pack";
import { characterDraftArchiveUrl, listCharacterDrafts, loadCharacterDraft, saveCharacterDraft } from "./character-drafts-api";
import type { CharacterDraft } from "./character-drafts-api";
import { summarizeRigMetadata } from "./rig-metadata";
import { RigCalibrationEditor } from "./RigCalibrationEditor";
import type { Locale } from "@/features/registry";

export function CharacterPackInspector({ locale, projectId }: { locale: Locale; projectId: string }) {
  // A project switch must invalidate in-flight ZIP inspections, saves, and
  // archive reloads together. Remounting also releases the previous sprites.
  return <ProjectCharacterPackInspector key={projectId} locale={locale} projectId={projectId} />;
}

function ProjectCharacterPackInspector({ locale, projectId }: { locale: Locale; projectId: string }) {
  const ja = locale === "ja";
  const [status, setStatus] = useState<"idle" | "reading" | "ready" | "error">("idle");
  const [preview, setPreview] = useState<{ pack: InspectedCharacterPack; urls: Map<string, string>; inspectionId: number } | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<CharacterDraft[]>([]);
  const [draftsError, setDraftsError] = useState("");
  const [loadedProjectId, setLoadedProjectId] = useState("");
  const [lastSaved, setLastSaved] = useState("");
  const bytesRef = useRef<ArrayBuffer | null>(null);
  const urlsRef = useRef(new Map<string, string>());
  const generation = useRef(0);
  const draftsRun = useRef(0);
  const savingRef = useRef(false);
  const pack = preview?.pack;
  const rig = pack ? summarizeRigMetadata(pack.definition) : null;
  const urls = preview?.urls;
  const draftsLoading = loadedProjectId !== projectId;

  useEffect(() => () => {
    generation.current++;
    draftsRun.current++;
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    const run = ++draftsRun.current;
    let active = true;
    void listCharacterDrafts(projectId).then(list => {
      if (!active || draftsRun.current !== run) return;
      setDrafts(list);
      setDraftsError("");
    }).catch(caught => {
      if (!active || draftsRun.current !== run) return;
      setDraftsError(caught instanceof Error ? caught.message : "Could not load drafts.");
    }).finally(() => { if (active && draftsRun.current === run) setLoadedProjectId(projectId); });
    return () => { active = false; };
  }, [projectId]);

  async function presentBytes(bytes: ArrayBuffer, name: string, requestId: number, savedDraft?: CharacterDraft) {
    const result = await inspectCharacterZip(bytes);
    if (savedDraft && (result.definition.characterId !== savedDraft.characterId || result.definition.revision !== savedDraft.revision)) {
      throw Error("The saved ZIP manifest does not match its recorded character ID or revision.");
    }
    if (generation.current !== requestId) return;
    const nextUrls = new Map<string, string>();
    try {
      for (const [path, blob] of result.images) nextUrls.set(path, URL.createObjectURL(blob));
    } catch (failure) {
      for (const url of nextUrls.values()) URL.revokeObjectURL(url);
      throw failure;
    }
    urlsRef.current = nextUrls;
    bytesRef.current = bytes;
    setFileName(name);
    setPreview({ pack: result, urls: nextUrls, inspectionId: requestId });
    setStatus("ready");
  }

  function startRead(name: string): number {
    const requestId = ++generation.current;
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current = new Map();
    bytesRef.current = null;
    setPreview(null);
    setFileName(name);
    setError("");
    setSaveError("");
    setLastSaved("");
    setStatus("reading");
    return requestId;
  }

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const requestId = startRead(file.name);
    try {
      if (!file.name.toLowerCase().endsWith(".zip")) throw Error("Select a .zip character package.");
      if (file.size > CHARACTER_PACK_LIMITS.compressedBytes) throw Error("Character ZIP must be 16 MB or smaller.");
      await presentBytes(await file.arrayBuffer(), file.name, requestId);
    } catch (caught) {
      if (generation.current !== requestId) return;
      setError(caught instanceof Error ? caught.message : "Could not inspect the ZIP file.");
      setStatus("error");
    }
  };

  const reopen = async (draft: CharacterDraft) => {
    const requestId = startRead(`${draft.characterId} · rev ${draft.revision}`);
    try {
      const bytes = await loadCharacterDraft(projectId, draft);
      await presentBytes(bytes, `${draft.characterId} · rev ${draft.revision}`, requestId, draft);
      if (generation.current === requestId) setLastSaved(draft.id);
    } catch (caught) {
      if (generation.current !== requestId) return;
      setError(caught instanceof Error ? caught.message : "Could not reopen the saved ZIP.");
      setStatus("error");
    }
  };

  const save = async () => {
    if (savingRef.current || !pack || !bytesRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    const requestId = generation.current;
    try {
      const draft = await saveCharacterDraft(projectId, pack.definition.characterId, pack.definition.revision, bytesRef.current);
      if (generation.current !== requestId) return;
      const run = ++draftsRun.current;
      setLoadedProjectId(projectId);
      setLastSaved(draft.id);
      setDrafts(current => [draft, ...current.filter(entry => entry.id !== draft.id)]);
      setDraftsError("");
      // The initial list might still be loading. Fetch a fresh snapshot after
      // persistence instead of discarding other drafts from that response.
      void listCharacterDrafts(projectId).then(list => {
        if (draftsRun.current !== run) return;
        setDrafts([draft, ...list.filter(entry => entry.id !== draft.id)]);
        setDraftsError("");
      }).catch(caught => {
        if (draftsRun.current !== run) return;
        setDraftsError(caught instanceof Error ? caught.message : "Draft saved, but could not refresh the list.");
      });
    } catch (caught) {
      if (generation.current === requestId) setSaveError(caught instanceof Error ? caught.message : "Could not save the draft.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return <section aria-label={ja ? "キャラクターパック検査" : "Character package inspector"} className="mt-7 space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-primary">CHARACTER STUDIO</p>
        <h2 className="mt-1 font-serif text-2xl font-semibold text-foreground">{ja ? "キャラクターパックを確認" : "Inspect a character pack"}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{ja
          ? "レイヤーZIPを読み込み、動物のパーツを調整して新しいマニフェストを書き出します。"
          : "Import a layered ZIP, adjust your character's proportions, and export a revised manifest."}</p>
      </div>
      <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-subtle px-3 py-1.5 text-xs text-muted-foreground"><ShieldAlert aria-hidden className="size-4" />{ja ? "未承認の下書き" : "Unverified drafts"}</span>
    </div>
    <Surface variant="outline">
      <label className="group flex cursor-pointer flex-col flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/30 bg-surface-subtle/50 px-4 py-5 text-center transition-colors hover:border-primary/60 hover:bg-surface-subtle focus-within:ring-2 focus-within:ring-ring sm:flex-row sm:text-left">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface text-primary shadow-sm"><UploadCloud aria-hidden className="size-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{ja ? "ステップ 1 · キャラクターZIPを選択" : "STEP 1 · Choose character ZIP"}</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">character.json + layers/*.png or *.webp · {ja ? "最大16 MB" : "16 MB max"}</span>
        </span>
        <input type="file" accept=".zip,application/zip" aria-label={ja ? "キャラクターZIP" : "Character ZIP"}
          onChange={event => void handleFile(event)}
          className="max-w-full text-xs text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-2 file:font-medium file:text-foreground" />
      </label>
      {status === "reading" && <p role="status" className="mt-4 text-sm text-muted-foreground">{ja ? "ZIPを検査しています…" : "Inspecting ZIP structure and asset checksums…"}</p>}
      {status === "error" && <div role="alert" className="mt-4 flex items-start gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
        <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div><p className="font-semibold">{ja ? "読み込みに失敗しました" : "Package needs attention"}</p><p className="mt-1 break-words">{fileName}: {error}</p></div>
      </div>}
    </Surface>

    {pack && <div className="space-y-4" aria-label="Character pack report">
      <Surface variant="outline">
        <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-success/10 text-success"><CheckCircle2 aria-hidden className="size-6" /></span>
            <div><p className="font-semibold text-foreground">{pack.definition.characterId} <span className="text-xs font-normal text-muted-foreground">rev {pack.definition.revision}</span></p>
              <p className="text-xs text-muted-foreground">{fileName} · {pack.definition.mode}</p></div>
          </div>
          <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success">{ja ? "構造チェック完了" : "Structure checked"}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button size="sm" icon={<Save className="size-4" />} isLoading={saving} disabled={!!lastSaved}
            onClick={() => void save()}>{lastSaved ? (ja ? "下書き保存済み" : "Draft saved") : (ja ? "下書きを保存" : "Save draft locally")}</Button>
          <p className="text-xs text-muted-foreground">{ja ? "保存後も検証・権利承認は未完了です。" : "Saving preserves the ZIP; it does not approve the rig or rights."}</p>
          {!!saveError && <p role="alert" className="w-full text-sm text-danger">{saveError}</p>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5"><Layers3 aria-hidden className="size-4" />{pack.parts.length} {ja ? "パーツ" : "parts"} · {Object.keys(pack.definition.assets).length} {ja ? "画像" : "assets"}</span>
          <span className="inline-flex items-center gap-1.5"><FileArchive aria-hidden className="size-4" />{pack.definition.design.width} × {pack.definition.design.height} px</span>
          <span className="inline-flex items-center gap-1.5"><ShieldAlert aria-hidden className="size-4" />{ja ? "権利・動作は未承認" : "Rights & playback unverified"}</span>
        </div>
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs leading-relaxed text-foreground">
          {ja ? "構造・画像の確認のみです。アニメーション、音声、Kumikiレンダリングの検証やキャラクター登録は未実装です。" :
            "Structural check only. Motion, voices, Kumiki rendering and rights are not approved. Saved drafts cannot be used for publishing yet."}
        </div>
        </div>
      </Surface>
      {rig && <details className="rounded-xl border border-border bg-surface px-4 py-3 text-sm" aria-label="Rig metadata inventory">
        <summary className="cursor-pointer font-medium text-foreground">{ja ? "リグ設定とアクション宣言を表示 · 動作未検証" : "Rig metadata, not playback-tested"}</summary>
        <p className="mt-3 text-xs text-muted-foreground">{ja
          ? "ZIPに記述された機能のみ。Kumikiでの動作・画質は未確認です。"
          : "Declarations from the ZIP only. Animation quality and Kumiki compatibility have not been tested."}</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-lg bg-surface-subtle p-3">
            <dt className="text-xs font-medium text-muted-foreground">{ja ? "アクション・移動" : "Actions & movement"}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{rig.actions.length}</dd>
            <dd className="mt-1 break-words text-xs text-muted-foreground">{rig.actions.length
              ? rig.actions.slice(0, 6).join(" · ") + (rig.actions.length > 6 ? " …" : "")
              : (ja ? "ジェスチャーアクション未定義" : "No gesture actions declared")}</dd>
          </div>
          <div className="rounded-lg bg-surface-subtle p-3">
            <dt className="text-xs font-medium text-muted-foreground">{ja ? "ポーズ" : "Named poses"}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{rig.poses.length}</dd>
            <dd className="mt-1 break-words text-xs text-muted-foreground">{rig.poses.slice(0, 6).join(" · ")}</dd>
          </div>
          <div className="rounded-lg bg-surface-subtle p-3">
            <dt className="text-xs font-medium text-muted-foreground">{ja ? "差分画像" : "Artwork variants"}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{rig.variants}</dd>
            <dd className="mt-1 text-xs text-muted-foreground">{ja ? "目・口・表情などの差し替え" : "Eye, mouth, face or outfit swaps"}</dd>
          </div>
          <div className="rounded-lg bg-surface-subtle p-3">
            <dt className="text-xs font-medium text-muted-foreground">{ja ? "音声・口の設定" : "Speech / visemes"}</dt>
            <dd className="mt-1 text-sm font-semibold">{rig.speechDeclared ? (ja ? "設定あり" : "Declared") : (ja ? "設定なし" : "Not declared")}</dd>
            <dd className="mt-1 text-xs text-muted-foreground">{ja ? "音声合成とリップシンクは別途検証" : "Neither voice nor lip-sync verified"}</dd>
          </div>
          <div className="rounded-lg bg-surface-subtle p-3">
            <dt className="text-xs font-medium text-muted-foreground">{ja ? "表情プリセット" : "Expression presets"}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{rig.expressions.length}</dd>
            <dd className="mt-1 break-words text-xs text-muted-foreground">{rig.expressions.length ? rig.expressions.slice(0, 6).join(" · ") : (ja ? "未定義" : "Not declared")}</dd>
          </div>
          <div className="rounded-lg bg-surface-subtle p-3">
            <dt className="text-xs font-medium text-muted-foreground">{ja ? "アンカー・初期配置" : "Anchors & rest placement"}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums">{rig.anchors} <span className="text-xs font-normal text-muted-foreground">{ja ? "アンカー" : "anchors"}</span></dd>
            <dd className="mt-1 text-xs text-muted-foreground">{ja ? `${rig.restTransforms} パーツに初期配置あり` : `${rig.restTransforms} parts declare rest transforms`}</dd>
          </div>
        </dl>
      </details>}
      <RigCalibrationEditor key={preview.inspectionId} definition={pack.definition} locale={locale} spriteUrls={urls} />
      <details className="rounded-xl border border-border bg-surface px-4 py-3" aria-label={ja ? "レイヤー一覧" : "Rig layers"}>
        <summary className="cursor-pointer text-sm font-semibold text-foreground">{ja ? "すべてのレイヤーと階層を確認" : "Browse all layers & hierarchy"}</summary>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...pack.parts].sort((a, b) => a.z - b.z).map(part => {
            const asset = pack.definition.assets[part.asset];
            return <li key={part.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-surface-subtle/50 p-3">
              <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface" style={{ backgroundImage: "linear-gradient(45deg,#aaa2 25%,transparent 25%,transparent 75%,#aaa2 75%),linear-gradient(45deg,#aaa2 25%,transparent 25%,transparent 75%,#aaa2 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }}>
                {asset && urls?.has(asset.uri) && <img src={urls.get(asset.uri)} alt={`${part.id} sprite layer`} className="max-h-full max-w-full object-contain" />}
              </div>
              <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground" title={part.id}>{part.id}</p>
                <p className="mt-1 text-xs text-muted-foreground">{part.channel} · z {part.z}</p>
                <p className="truncate text-xs text-muted-foreground" title={part.parent}>{part.parent ? `↳ ${part.parent}` : "Root part"}</p></div>
            </li>;
          })}
        </ul>
      </details>
    </div>}

    <Surface variant="outline" aria-label={ja ? "保存したキャラクター" : "Saved character drafts"}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-foreground">{ja ? "このプロジェクトの下書き" : "Saved drafts for this project"}</h3>
        <span className="text-xs text-muted-foreground">{drafts.length} {ja ? "件" : "saved"}</span>
      </div>
      {draftsLoading && <p role="status" className="text-sm text-muted-foreground">{ja ? "下書きを読み込み中…" : "Loading local drafts…"}</p>}
      {!draftsLoading && !!draftsError && <p role="alert" className="mb-3 text-sm text-danger">{draftsError}</p>}
      {!draftsLoading && !draftsError && drafts.length === 0 && <p className="text-sm text-muted-foreground">{ja ? "まだ保存した下書きはありません。" : "No saved drafts yet. Import a ZIP and select Save draft locally."}</p>}
      {!draftsLoading && drafts.length > 0 && <ul className="space-y-2">
        {drafts.map(draft => <li key={draft.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle/50 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground" title={draft.characterId}>{draft.characterId} <span className="text-xs font-normal text-muted-foreground">rev {draft.revision}</span></p>
            <p className="mt-1 text-xs text-muted-foreground">{ja ? "未検証" : "Unverified"} · {(draft.sizeBytes / 1024).toFixed(0)} KiB · {new Date(draft.createdAt).toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void reopen(draft)}>{ja ? "再確認" : "Reopen ZIP"}</Button>
            <a href={characterDraftArchiveUrl(projectId, draft)} download
              className={buttonVariants({ variant: "subtle", size: "sm" })}>
              <Download aria-hidden className="size-4" />{ja ? "ZIPを保存" : "Download ZIP"}
            </a>
          </div>
        </li>)}
      </ul>}
    </Surface>

    <details className="rounded-xl border border-border bg-surface px-5 py-4 text-sm text-foreground">
      <summary className="cursor-pointer font-medium">{ja ? "ZIPの作り方と必要なファイル" : "ZIP format and rig instructions"}</summary>
      <div className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
        <p>{ja ? "ルートにcharacter.jsonを置き、参照する画像をlayers/フォルダーに格納します。" : "Place character.json at the ZIP root and put all referenced transparent sprites inside layers/."}</p>
        <p>{ja ? "schemaVersion 1、sprite-2d / puppet-2.5d、パーツ階層、チャンネル、ピボット、ポーズを宣言します。" : "Use schemaVersion 1, sprite-2d or puppet-2.5d, and explicit part parents, channels, pivots, poses and image provenance."}</p>
        <p>{ja ? "公開・商用利用の権利承認やアニメーションの検証は別の手順です。" : "Rig playback, licenses, voice consent and publishing approval remain separate steps."}</p>
      </div>
    </details>
  </section>;
}
