import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertCircle, CheckCircle2, FileArchive, Layers3, ShieldAlert, UploadCloud } from "lucide-react";
import { Surface } from "@/components/ui/surface-card";
import { CHARACTER_PACK_LIMITS, inspectCharacterZip } from "./character-pack";
import type { InspectedCharacterPack } from "./character-pack";
import type { Locale } from "@/features/registry";

export function CharacterPackInspector({ locale }: { locale: Locale }) {
  const ja = locale === "ja";
  const [status, setStatus] = useState<"idle" | "reading" | "ready" | "error">("idle");
  const [preview, setPreview] = useState<{ pack: InspectedCharacterPack; urls: Map<string, string> } | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const urlsRef = useRef(new Map<string, string>());
  const generation = useRef(0);
  const pack = preview?.pack;
  const urls = preview?.urls;

  useEffect(() => () => {
    generation.current++;
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
  }, []);

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const requestId = ++generation.current;
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current = new Map();
    setPreview(null);
    setFileName(file.name);
    setError("");
    setStatus("reading");
    try {
      if (!file.name.toLowerCase().endsWith(".zip")) throw Error("Select a .zip character package.");
      if (file.size > CHARACTER_PACK_LIMITS.compressedBytes) throw Error("Character ZIP must be 16 MB or smaller.");
      const result = await inspectCharacterZip(await file.arrayBuffer());
      if (generation.current !== requestId) return;
      const nextUrls = new Map<string, string>();
      try {
        for (const [path, blob] of result.images) nextUrls.set(path, URL.createObjectURL(blob));
      } catch (failure) {
        for (const url of nextUrls.values()) URL.revokeObjectURL(url);
        throw failure;
      }
      urlsRef.current = nextUrls;
      setPreview({ pack: result, urls: nextUrls });
      setStatus("ready");
    } catch (caught) {
      if (generation.current !== requestId) return;
      setError(caught instanceof Error ? caught.message : "Could not inspect the ZIP file.");
      setStatus("error");
    }
  };

  return <section aria-label={ja ? "キャラクターパック検査" : "Character package inspector"} className="mt-7 space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[.16em] text-muted-foreground">CHARACTER STUDIO · 01</p>
        <h2 className="mt-1 font-serif text-xl font-semibold text-foreground">{ja ? "キャラクターパックを確認" : "Inspect a character pack"}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">{ja
          ? "透過レイヤーを含むZIPの構造を確認します。ファイルはブラウザー内にとどまり、保存やアップロードは行いません。"
          : "Check a layered sprite ZIP before you rig or register a character. Files stay in your browser; nothing is uploaded or saved."}</p>
      </div>
      <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground"><ShieldAlert aria-hidden className="size-4" />{ja ? "プレビューのみ" : "Local preview only"}</span>
    </div>
    <Surface variant="outline" className="overflow-hidden p-5">
      <label className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-surface-subtle/50 px-5 py-10 text-center transition-colors hover:border-primary/50 hover:bg-surface-subtle focus-within:ring-2 focus-within:ring-ring">
        <span className="grid size-14 place-items-center rounded-2xl bg-surface text-primary shadow-sm"><UploadCloud aria-hidden className="size-7" /></span>
        <span className="text-base font-semibold text-foreground">{ja ? "キャラクターZIPを選択" : "Choose character ZIP"}</span>
        <span className="max-w-lg text-xs leading-relaxed text-muted-foreground">character.json + layers/*.png or *.webp · {ja ? "最大16 MB" : "16 MB max"}</span>
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
      <Surface variant="outline" className="gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-success/10 text-success"><CheckCircle2 aria-hidden className="size-6" /></span>
            <div><p className="font-semibold text-foreground">{pack.definition.characterId} <span className="text-xs font-normal text-muted-foreground">rev {pack.definition.revision}</span></p>
              <p className="text-xs text-muted-foreground">{fileName} · {pack.definition.mode}</p></div>
          </div>
          <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-medium text-success">{ja ? "構造チェック完了" : "Structure checked"}</span>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-surface-subtle p-3"><Layers3 aria-hidden className="mb-2 size-4 text-muted-foreground" /><p className="font-semibold tabular-nums">{pack.parts.length} parts</p><p className="text-xs text-muted-foreground">{Object.keys(pack.definition.assets).length} image assets</p></div>
          <div className="rounded-lg bg-surface-subtle p-3"><FileArchive aria-hidden className="mb-2 size-4 text-muted-foreground" /><p className="font-semibold tabular-nums">{pack.definition.design.width} × {pack.definition.design.height}</p><p className="text-xs text-muted-foreground">{ja ? "デザイン画面" : "Design canvas"}</p></div>
          <div className="rounded-lg bg-surface-subtle p-3"><ShieldAlert aria-hidden className="mb-2 size-4 text-muted-foreground" /><p className="font-semibold">{ja ? "権利の承認待ち" : "Rights not approved"}</p><p className="text-xs text-muted-foreground">{ja ? "出力前に確認が必要" : "Review before export"}</p></div>
        </div>
        <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-foreground">
          {ja ? "構造・画像の確認のみです。アニメーション、音声、Kumikiレンダリングの検証やキャラクター登録は未実装です。" :
            "Structural check only. This does not validate motion, voices, Kumiki rendering or rights, and it does not register a character yet."}
        </div>
      </Surface>
      <Surface variant="outline" className="p-5">
        <h3 className="mb-3 font-semibold text-foreground">{ja ? "レイヤー一覧" : "Rig layers"}</h3>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
      </Surface>
    </div>}

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
