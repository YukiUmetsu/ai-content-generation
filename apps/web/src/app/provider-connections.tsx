import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, LockKeyhole, RefreshCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";
import {
  deleteProviderKey, loadProviderConnections, saveProviderKey,
  type ProviderConnection,
} from "@/lib/api/provider-credentials";

const fieldClass = "min-w-0 w-full rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const providers: {id: ProviderConnection["id"]; name: string; purpose: string; environment: string}[] = [
  {id: "youtube", name: "YouTube Data API v3", purpose: "Research and scheduled topic collection", environment: "CONTENTGEN_YOUTUBE_API_KEY"},
  {id: "fish", name: "Fish Audio", purpose: "Narration and scene voice previews (requires voice permission)", environment: "FISH_AUDIO_API_KEY"},
];

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
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [keys, setKeys] = useState<Record<ProviderConnection["id"], string>>({youtube:"",fish:""});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<ProviderConnection["id"] | null>(null);
  const [message, setMessage] = useState("");

  async function refresh() {
    setConnections(await loadProviderConnections());
  }

  useEffect(() => {
    let active = true;
    void loadProviderConnections().then(loaded => {
      if (active) setConnections(loaded);
    }).catch(() => {
      if (active) setMessage(ja ? "ローカル設定サービスに接続できません。" : "Cannot reach local settings. Is the ContentGen server running?");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [ja]);

  async function save(provider: ProviderConnection["id"]) {
    if (busy || !keys[provider].trim()) return;
    setBusy(provider);
    setMessage("");
    try {
      await saveProviderKey(provider, keys[provider]);
      setKeys(current => ({...current, [provider]:""}));
      await refresh();
      setMessage(ja ? "キーを安全に保存しました。" : `${providers.find(item => item.id === provider)?.name} key saved securely. Use it in Studio without pasting it again.`);
    } catch (error) {
      // The API adapter supplies bounded messages; never display raw server bodies.
      setMessage(error instanceof Error ? error.message : "Unable to save provider key.");
    } finally { setBusy(null); }
  }

  async function remove(provider: ProviderConnection["id"]) {
    if (busy || !window.confirm(ja
      ? "保存された API キーをキーチェーンから削除しますか？"
      : `Remove the saved ${providers.find(item => item.id === provider)?.name} API key from macOS Keychain?`)) return;
    setBusy(provider);
    setMessage("");
    try {
      await deleteProviderKey(provider);
      setKeys(current => ({...current, [provider]:""}));
      await refresh();
      setMessage(ja ? "保存されたキーを削除しました。" : "Saved key removed from Keychain.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove provider key.");
    } finally { setBusy(null); }
  }

  return <Surface header={<div className="flex items-center gap-2">
    <LockKeyhole aria-hidden className="size-4 text-primary" />
    <h2 className="font-medium">{ja ? "API 接続・安全な認証情報" : "API connections & secure credentials"}</h2>
  </div>}>
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">{ja
        ? "API キーはローカルの macOS キーチェーンに保存されます。ブラウザーやプロジェクトのバックアップには含まれません。"
        : "Connect your production and research providers here. Keys stay in macOS Keychain, never in browser storage, project backups or Jobs history."}</p>
      {providers.map(provider => {
        const connection=connections.find(item=>item.id===provider.id);
        const unavailable=connection?.source==="unavailable"||connection?.source==="error";
        return <div key={provider.id} className="rounded-control border border-border bg-surface-subtle p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div><div className="flex items-center gap-2 font-medium"><KeyRound aria-hidden className="size-4" />{provider.name}</div>
            <p className="mt-1 text-xs text-muted-foreground">{provider.purpose}</p></div>
          <div className="flex items-center gap-1.5 text-xs" role="status">
            {connection?.configured && <CheckCircle2 aria-hidden className="size-3.5 text-primary" />}
            {labelForSource(loading ? null : connection?.source ?? "missing", ja)}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{ja
          ? "新しいキーを入力すると置き換えられます。保存後はキーを再表示できません。"
          : "Enter a new key to save or replace it. The saved key is never displayed again."}</p>
        <form className="mt-3 flex flex-col gap-2" onSubmit={event => { event.preventDefault(); void save(provider.id); }}>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            {provider.id==="youtube"?"YouTube Data API":provider.name+" API"} {ja?"キー":"key"}
            <input className={fieldClass} type="password" autoComplete="off" spellCheck={false}
              value={keys[provider.id]} onChange={event => setKeys(current=>({...current,[provider.id]:event.target.value}))} maxLength={512}
              placeholder={ja ? "キーを貼り付け" : "Paste an API key"} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!!busy || loading || unavailable || !keys[provider.id].trim()} icon={<LockKeyhole aria-hidden className="size-4" />}>
              {ja ? "キーチェーンに保存" : "Save to Keychain"}
            </Button>
            {connection?.source === "keychain" && <Button type="button" size="sm" variant="outline" disabled={!!busy}
              onClick={() => void remove(provider.id)} icon={<Trash2 aria-hidden className="size-4" />}>
              {ja ? "保存キーを削除" : "Remove saved key"}
            </Button>}
            <Button type="button" size="sm" variant="subtle" disabled={!!busy || loading} aria-label={ja ? `${provider.name} 接続状態を更新` : `Refresh ${provider.name} connection status`}
              onClick={() => { setMessage(""); void refresh().catch(() => setMessage(ja ? "接続状態を確認できません。" : "Could not refresh connection status.")); }}
              icon={<RefreshCcw aria-hidden className="size-4" />}>
              {ja ? "更新" : "Refresh"}
            </Button>
          </div>
        </form>
        {connection?.source === "environment" && <p className="mt-2 text-xs text-muted-foreground">{ja
          ? `現在は ${provider.environment} を使用しています。キーチェーンに保存するとそちらが優先されます。`
          : `Using ${provider.environment}. A saved Keychain entry takes precedence.`}</p>}
        {unavailable && <p className="mt-2 text-xs text-muted-foreground">{ja
          ? "macOS のキーチェーンの権限を確認してください。キーは別の場所には保存されません。"
          : "Check macOS Keychain permissions. ContentGen will not store your key elsewhere."}</p>}
      </div>;
      })}
      {message && <p role="alert" className="text-xs text-muted-foreground">{message}</p>}
    </div>
  </Surface>;
}
