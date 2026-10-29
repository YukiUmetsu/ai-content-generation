import {useState} from "react";
import type {Locale} from "@/features/registry";
import {Surface} from "@/components/ui/surface-card";
import {ProjectVoiceFavoritesPanel} from "./project-voice-favorites-panel";
import {readAudioSettings,saveAudioSettings,DEFAULT_FISH_ENGINE_REVISION,type AudioSettings} from "./audio-settings";
import type {VoiceFavorite} from "./project-voice-favorites";

const field="w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const label="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground";
const tr=(locale:Locale,en:string,ja:string)=>locale==="ja"?ja:en;

export function AudioSettingsPanel({projectId,projectName,locale}:{projectId:string;projectName:string;locale:Locale}){
  const [settings,setSettings]=useState<AudioSettings>(()=>readAudioSettings(projectId));
  const [error,setError]=useState("");
  function update(patch:Partial<AudioSettings>){
    const next={...settings,...patch};
    if(patch.provider==="fish"&&!next.providerRevision.trim())next.providerRevision=DEFAULT_FISH_ENGINE_REVISION;
    setSettings(next);
    try{saveAudioSettings(next,projectId);setError("");}
    catch(reason){setError(reason instanceof Error?reason.message:"Audio settings could not be saved locally.");}
  }
  function useFavorite(voice:VoiceFavorite){
    update({provider:voice.provider,voiceId:voice.voiceId,
      ...(voice.provider==="fish"?{providerRevision:settings.provider==="fish"?
        settings.providerRevision||DEFAULT_FISH_ENGINE_REVISION:DEFAULT_FISH_ENGINE_REVISION}:{})});
  }
  return <div className="space-y-4">
    <Surface header={<h2 className="text-sm font-semibold">{tr(locale,"Narration defaults","ナレーションの既定設定")} · {projectName}</h2>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>{tr(locale,"Voice provider","音声プロバイダー")}
          <select className={field} aria-label="Audio voice provider" value={settings.provider}
            onChange={e=>update({provider:e.target.value as AudioSettings["provider"]})}>
            <option value="fish">Fish Audio</option><option value="local">Local TTS</option>
          </select>
        </label>
        <label className={label}>{tr(locale,"Voice ID","音声 ID")}
          <input className={field} aria-label="Audio voice ID" maxLength={128} value={settings.voiceId}
            onChange={e=>update({voiceId:e.target.value})} placeholder="Voice ID" spellCheck={false}/>
        </label>
        <label className={label}>{tr(locale,"Engine revision","エンジンのバージョン")}
          <input className={field} aria-label="Audio engine revision" maxLength={128} value={settings.providerRevision}
            onChange={e=>update({providerRevision:e.target.value})}
            placeholder={settings.provider==="fish"?DEFAULT_FISH_ENGINE_REVISION:"Installed engine version"} spellCheck={false}/>
        </label>
        {settings.provider==="local"&&<>
          <label className={label}>{tr(locale,"Installed model","ローカルモデル")}
            <input className={field} aria-label="Audio local model" maxLength={128} value={settings.modelId}
              onChange={e=>update({modelId:e.target.value})} placeholder="Installed model ID" spellCheck={false}/>
          </label>
          <label className={label}>{tr(locale,"Local speech server","ローカル音声サーバー")}
            <input className={field} aria-label="Audio local server" maxLength={240} value={settings.endpoint}
              onChange={e=>update({endpoint:e.target.value})} placeholder="http://127.0.0.1:8765" spellCheck={false}/>
          </label>
        </>}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{settings.provider==="fish"?
        tr(locale,"Fish Audio API keys are managed in Settings → Connections. Voice and engine settings save automatically.",
          "Fish Audio の API キーは設定 → API 接続で管理します。音声とエンジンの設定は自動保存されます。"):
        tr(locale,"These project settings save automatically. Use a locally installed speech model and server.",
          "このプロジェクトの設定は自動保存されます。インストール済みの音声モデルとサーバーを使用してください。")}</p>
      {error&&<p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </Surface>
    <ProjectVoiceFavoritesPanel projectId={projectId}
      selectedVoice={{provider:settings.provider,voiceId:settings.voiceId}} onUseVoice={useFavorite}/>
  </div>;
}
