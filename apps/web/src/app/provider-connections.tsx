import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LockKeyhole, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import {
  deleteYoutubeKey, loadProviderConnections, saveYoutubeKey,
  type ProviderConnection,
} from "@/lib/api/provider-credentials";

const fieldClass = "min-w-0 w-full rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function labelForSource(source: ProviderConnection["source"] | null, ja: boolean) {
  switch (source) {
    case "keychain": return ja ? "macOS キーチェーンに保存済み" : "Saved in macOS Keychain";
    case "environment": return ja ? "環境変数から読み込み中" : "Environment variable in use";
    case "missing": return ja ? "未設定" : "Not configured";
    case "unavailable": return ja ? "キーチェーンを利用できません" : "Secure storage unavailable";
    case "error": return ja ? "キーチェーンにアクセスできません" : "Cannot access Keychain";
    default: return ja ? "確認中…" : "Checking connection…";
  }
}

export function ProviderConnections({ locale }: { locale: Locale }) {
  const ja = locale === "ja";
  const [connection, setConnection] = useState<ProviderConnection | null>(null);
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const providers = await loadProviderConnections();
    setConnection(providers[0] ?? null);
  }

  useEffect(() => {
    let active = true;
    void loadProviderConnections().then(providers => {
      if (active) setConnection(providers[0] ?? null);
    }).catch(() => {
      if (active) setMessage(ja ? "ローカル設定サービスに接続できません。" : "Cannot reach local settings. Is the ContentGen server running?");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ja]);

  async function save() {
    if (busy || !key.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await saveYoutubeKey(key);
      setKey("");
      await refresh();
      setMessage(ja ? "キーを安全に保存しました。" : "Key saved securely. YouTube collection can use it now.");
    } catch (error) {
      // The API adapter supplies bounded messages; never display raw server bodies.
      setMessage(error instanceof Error ? error.message : "Unable to save provider key.");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (busy || !window.confirm(ja
      ? "保存された YouTube API キーをキーチェーンから削除しますか？"
      : "Remove the saved YouTube API key from macOS Keychain?")) return;
    setBusy(true);
    setMessage("");
    try {
      await deleteYoutubeKey();
      setKey("");
      await refresh();
      setMessage(ja ? "保存されたキーを削除しました。" : "Saved key removed from Keychain.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove provider key.");
    } finally { setBusy(false); }
  }

  const unavailable = connection?.source === "unavailable" || connection?.source === "error";
  return <Surface header={<div className="flex items-center gap-2">
    <LockKeyhole aria-hidden className="size-4 text-primary" />
    <h2 className="font-medium">{ja ? "API 接続・安全な認証情報" : "API connections & secure credentials"}</h2>
  </div>}>
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">{ja
        ? "YouTube Data API キーはローカルの macOS キーチェーンに保存されます。ブラウザーの保存領域やプロジェクトのバックアップには含まれません。"
        : "Connect YouTube Data API for research and scheduled collection. Keys are stored in your macOS Keychain, not browser storage or project backups."}</p>
      <div className="rounded-control border border-border bg-surface-subtle p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2 font-medium"><KeyRound aria-hidden className="size-4" />YouTube Data API v3</div>
          <div className="flex items-center gap-1.5 text-xs" role="status">
            {connection?.configured && <CheckCircle2 aria-hidden className="size-3.5 text-primary" />}
            {labelForSource(loading ? null : connection?.source ?? "missing", ja)}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{ja
          ? "新しいキーを入力すると置き換えられます。保存後はキーを再表示できません。"
          : "Enter a new key to save or replace it. The saved key is never displayed again."}</p>
        <form className="mt-3 flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {ja ? "YouTube Data API キー" : "YouTube Data API key"}
            <input className={fieldClass} type="password" autoComplete="off" spellCheck={false}
              value={key} onChange={event => setKey(event.target.value)} maxLength={512}
              placeholder={ja ? "キーを貼り付け" : "Paste an API key"} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || loading || unavailable || !key.trim()} icon={<LockKeyhole aria-hidden className="size-4" />}>
              {ja ? "キーチェーンに保存" : "Save to Keychain"}
            </Button>
            {connection?.source === "keychain" && <Button type="button" size="sm" variant="outline" disabled={busy}
              onClick={() => void remove()} icon={<Trash2 aria-hidden className="size-4" />}>
              {ja ? "保存キーを削除" : "Remove saved key"}
            </Button>}
            <Button type="button" size="sm" variant="subtle" disabled={busy || loading} aria-label={ja ? "接続状態を更新" : "Refresh connection status"}
              onClick={() => { setMessage(""); void refresh().catch(() => setMessage(ja ? "接続状態を確認できません。" : "Could not refresh connection status.")); }}
              icon={<RefreshCcw aria-hidden className="size-4" />}>
              {ja ? "更新" : "Refresh"}
            </Button>
          </div>
        </form>
        {connection?.source === "environment" && <p className="mt-2 text-xs text-muted-foreground">{ja
          ? "現在は CONTENTGEN_YOUTUBE_API_KEY を使用しています。キーチェーンに保存すると、そちらが優先されます。"
          : "Using CONTENTGEN_YOUTUBE_API_KEY. Saving to Keychain will take precedence over the environment variable."}</p>}
        {unavailable && <p className="mt-2 text-xs text-muted-foreground">{ja
          ? "macOS のキーチェーンの権限を確認してください。キーは別の場所には保存されません。"
          : "Check macOS Keychain permissions. ContentGen will not store your key elsewhere."}</p>}
      </div>
      {message && <p role="alert" className="text-xs text-muted-foreground">{message}</p>}
    </div>
  </Surface>;
}
