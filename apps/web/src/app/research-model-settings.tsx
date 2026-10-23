import { useEffect, useState } from "react";
import { RefreshCcw, Save, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import type { Locale } from "@/features/registry";

const route = "/api/local-research-model";
const defaultEndpoint = "http://127.0.0.1:11434/v1/chat/completions";
const presets = [
  { label: "Ollama", value: defaultEndpoint },
  { label: "LM Studio", value: "http://127.0.0.1:1234/v1/chat/completions" },
];
const field = "min-w-0 w-full rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
type Settings = { version: 1; endpoint: string; model: string };
async function request(path: string, method: "GET" | "POST", value?: unknown) {
  const result = await fetch(route + path, {
    method, headers: method === "POST"
      ? { "Content-Type": "application/json", "X-Contentgen-Settings": "local-only" } : undefined,
    body: value ? JSON.stringify(value) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const body = await result.json() as Record<string, unknown>;
  if (!result.ok) throw Error(String(body.error ?? "Local Settings API failed."));
  return body;
}

export function ResearchModelSettings({ locale }: { locale: Locale }) {
  const ja = locale === "ja";
  const [endpoint, setEndpoint] = useState(defaultEndpoint);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [searchEndpoint, setSearchEndpoint] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    void request("", "GET").then(raw => {
      if (!active) return;
      const settings = raw.settings as Settings;
      setEndpoint(settings.endpoint);
      setModel(settings.model);
      setSearchEndpoint(typeof raw.searchEndpoint === "string" ? raw.searchEndpoint : null);
    }).catch(error => { if (active) setStatus(String(error.message)); });
    return () => { active = false; };
  }, []);

  async function loadModels() {
    setLoading(true);
    setStatus("");
    try {
      const response = await request("/models", "POST", { endpoint });
      const found = response.models;
      if (!Array.isArray(found) || !found.every(x => typeof x === "string"))
        throw Error("The local server returned an invalid model list.");
      setModels(found);
      if (found.length === 0) setStatus(ja
        ? "モデルが見つかりません。Ollama または LM Studio でモデルを起動してください。"
        : "No installed models reported. Start your model in Ollama or LM Studio.");
      else {
        if (!found.includes(model)) setModel(found[0]);
        setStatus((ja ? "ローカルモデルに接続しました: " : "Connected to local model server. Models: ") + found.length);
      }
    } catch (error) { setModels([]); setStatus(error instanceof Error ? error.message : "Model discovery failed."); }
    finally { setLoading(false); }
  }
  async function save() {
    setSaving(true); setStatus("");
    try {
      await request("/save", "POST", { version: 1, endpoint, model });
      setStatus(ja ? "調査モデルの設定を保存しました。CLI と共有されます。" :
        "Research model saved. video:research and video:plan will use this configuration.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Save failed."); }
    finally { setSaving(false); }
  }
  return <Surface header={<h2 className="font-medium">{ja ? "調査用 AI モデル" : "Research AI model"}</h2>}>
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">{ja
        ? "ローカルの Ollama / LM Studio モデルを選択します。クラウド API やモデルの自動ダウンロードはありません。"
        : "Choose an existing Ollama, LM Studio or compatible local model. Nothing is downloaded and no cloud model is contacted."}</p>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
        {ja ? "モデルサーバー" : "Model server"}
        <select className={field} aria-label="Research model server preset"
          value={presets.some(x => x.value === endpoint) ? endpoint : "custom"}
          onChange={e => setEndpoint(e.target.value === "custom" ? endpoint : e.target.value)}>
          {presets.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          <option value="custom">Custom loopback</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
        {ja ? "ローカル API URL" : "Local API endpoint"}
        <input className={field} aria-label="Research API endpoint" value={endpoint} maxLength={240}
          onChange={e => { setEndpoint(e.target.value); setModels([]); }} spellCheck={false}/>
      </label>
      <Button variant="outline" size="sm" onClick={() => void loadModels()} disabled={loading}
        icon={<RefreshCcw className="size-4" />}>
        {loading ? "Checking…" : ja ? "インストール済みモデルを検出" : "Find installed models"}
      </Button>
      <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
        {ja ? "調査モデル ID" : "Research model ID"}
        {models.length > 0 ? <select aria-label="Research model ID" className={field} value={model}
            onChange={e => setModel(e.target.value)}>
            {!models.includes(model) && <option value={model}>{model || "Choose a model"}</option>}
            {models.map(x => <option key={x} value={x}>{x}</option>)}
          </select> :
          <input aria-label="Research model ID" className={field} value={model}
            onChange={e => setModel(e.target.value)} maxLength={120} placeholder="e.g. qwen3:8b"/>}
      </label>
      <Button size="sm" onClick={() => void save()} disabled={saving || !model.trim()} icon={<Save className="size-4" />}>
        {ja ? "調査モデル設定を保存" : "Save research model"}
      </Button>
      <div className="rounded-control border border-border bg-surface-subtle p-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground"><Search aria-hidden className="size-4"/>
          {ja ? "ローカル検索" : "Local search"}
        </div>
        <p className="mt-1">{searchEndpoint
          ? "SearXNG configured at " + searchEndpoint
          : ja ? "SearXNG 未設定。apps/web で pnpm research:up を実行してください。"
            : "SearXNG is not configured. From apps/web run pnpm research:up (Docker Desktop required)."}</p>
        <p className="mt-1">{ja ? "研究は --allow-network を明示したときのみ実行されます。" :
          "Research still requires explicit --allow-network; opening Settings never launches Docker or searches the web."}</p>
      </div>
      {status && <p role="status" className="text-xs text-muted-foreground">{status}</p>}
    </div>
  </Surface>;
}
