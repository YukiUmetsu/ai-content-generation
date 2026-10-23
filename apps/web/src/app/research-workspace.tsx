import { useEffect, useRef, useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface-card";
import { EvidencePanel } from "@/app/evidence-panel";
import { PackagingPanel } from "@/app/packaging-panel";
import { YoutubeIntelligencePanel } from "@/app/youtube-intelligence-panel";
import { RelatedYoutubePanel } from "@/app/related-youtube-panel";
import { translate } from "@/i18n/messages";
import type { Locale } from "@/features/registry";
import { createDraft, starterApproaches, validateEditorialDraft, type EditorialDraft } from "./editorial-brief";
import type { ResearchDraftResult } from "./researched-storyboard";

const LATEST_RESEARCH_KEY="contentgen:studio-research:latest:v1";
interface RecentResearch {topic:string;artifactId:string}
function savedResearchFor(projectTopic:string):RecentResearch|null {
  if(!projectTopic.trim())return null;
  try{
    const stored:unknown=JSON.parse(localStorage.getItem(LATEST_RESEARCH_KEY)||"null");
    if(!stored||typeof stored!=="object"||!("topic" in stored)||!("artifactId" in stored))return null;
    if(stored.topic!==projectTopic.trim()||typeof stored.artifactId!=="string"||
      !/^research_[a-z0-9_-]{1,78}-[a-f0-9]{12}$/iu.test(stored.artifactId))return null;
    return {topic:stored.topic,artifactId:stored.artifactId};
  }catch{return null;}
}

interface ResearchWorkspaceProps {
  locale: Locale;
  onUseVideo: (idea: {title: string; sourceUrl: string}) => boolean;
  onCreateStoryboard?: (draft: EditorialDraft, research?: ResearchDraftResult) => boolean;
  projectTopic?: string;
}

export function ResearchWorkspace({ locale, onUseVideo, onCreateStoryboard, projectTopic = "" }: ResearchWorkspaceProps) {
  const ja = locale === "ja";
  const tr = (en: string, jp: string) => ja ? jp : en;
  const [topic, setTopic] = useState(projectTopic);
  const [evidenceQuery, setEvidenceQuery] = useState("");
  const [showInspiration, setShowInspiration] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [audience, setAudience] = useState("");
  const [viewerQuestion, setViewerQuestion] = useState("");
  const [payoff, setPayoff] = useState("");
  const [approach, setApproach] = useState<EditorialDraft["selectedId"]>("direct");
  const [projectError, setProjectError] = useState("");
  const [recentResearch] = useState(()=>savedResearchFor(projectTopic));
  const [researchBusy, setResearchBusy] = useState(Boolean(recentResearch));
  const [restoring, setRestoring] = useState(Boolean(recentResearch));
  const [researchResult, setResearchResult] = useState<ResearchDraftResult | null>(null);
  const [researchError, setResearchError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const revision = useRef(0);

  useEffect(()=>{
    if(!recentResearch||recentResearch.topic!==projectTopic.trim())return;
    const controller=new AbortController();pending.current=controller;
    const current=++revision.current;
    let cancelled=false;
    void fetch("/api/contentgen-director/research-draft/"+recentResearch.artifactId,{signal:controller.signal})
      .then(async response=>{
        if(!response.ok)throw Error("The saved research snapshot is unavailable. Run research again.");
        return await response.json() as ResearchDraftResult;
      })
      .then(result=>{if(!cancelled&&current===revision.current&&result.dossier?.topic.title===projectTopic.trim())setResearchResult(result);})
      .catch(error=>{if(!cancelled&&current===revision.current)setResearchError(error instanceof Error?error.message:"Cannot restore research.");})
      .finally(()=>{if(!cancelled&&current===revision.current){pending.current=null;setRestoring(false);setResearchBusy(false);}});
    return ()=>{cancelled=true;controller.abort();};
  },[projectTopic,recentResearch]);

  function invalidateResearch() {
    pending.current?.abort();
    revision.current++;
    setResearchBusy(false);
    setRestoring(false);
    setResearchResult(null);
    setResearchError("");
    setProjectError("");
  }

  function changeTopic(next: string) {
    invalidateResearch();
    setTopic(next);
    setSelectedUrls([]);
  }

  function cancelResearch() {
    pending.current?.abort();
    revision.current++;
    pending.current=null;
    setResearchBusy(false);
    setRestoring(false);
    setResearchError("");
  }

  function editorialDraft():EditorialDraft {
    const seed = createDraft(topic.trim());
    const input = {
      ...seed.input,
      audience: audience.trim() || seed.input.audience,
      viewerQuestion: viewerQuestion.trim() || seed.input.viewerQuestion,
      payoff: payoff.trim() || seed.input.payoff,
      inspirationUrls: selectedUrls,
    };
    return validateEditorialDraft({...seed,input,approaches:starterApproaches(input),selectedId:approach});
  }

  async function researchAndGenerate(){
    if(researchBusy||topic.trim().length<3||topic.trim().length>160)return;
    setResearchBusy(true);setResearchError("");setResearchResult(null);
    const current=++revision.current;
    const controller=new AbortController();pending.current=controller;
    try{
      const editorial=editorialDraft();
      const response=await fetch("/api/contentgen-director/research-draft",{
        method:"POST",signal:controller.signal,
        headers:{"Content-Type":"application/json","x-contentgen-director":"local-only"},
        body:JSON.stringify({title:editorial.input.topic,viewerQuestion:editorial.input.viewerQuestion,
          audience:editorial.input.audience,locale:locale==="ja"?"ja-JP":"en-US"}),
      });
      const payload=await response.json() as ResearchDraftResult & {error?:string};
      if(!response.ok)throw Error(payload.error||`Research failed (HTTP ${response.status}).`);
      if(!payload.dossier?.id||!payload.plan?.shots?.length||!payload.quotes?.length)
        throw Error("Research returned an incomplete dossier or shot plan.");
      if(current===revision.current){
        setResearchResult(payload);
        if(payload.artifactId)try{localStorage.setItem(LATEST_RESEARCH_KEY,JSON.stringify({topic:editorial.input.topic,artifactId:payload.artifactId}));}
        catch{/* The in-memory reviewed result remains usable. */}
      }
    }catch(error){
      if(current===revision.current)setResearchError(error instanceof Error?error.message:"Research failed.");
    }finally{
      if(current===revision.current){setResearchBusy(false);pending.current=null;}
    }
  }

  function createFromResearch() {
    if (!onCreateStoryboard) return;
    setProjectError("");
    try {
      const draft=editorialDraft();
      if (!onCreateStoryboard(draft)) setProjectError(tr("Couldn't save the new storyboard project.", "ストーリーボードを保存できませんでした。"));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Could not create project.");
    }
  }

  function createSourcedStoryboard(){
    if(!researchResult||!onCreateStoryboard||researchBusy||researchResult.dossier.topic.title!==topic.trim())return;
    setProjectError("");
    try{
      if(!onCreateStoryboard(editorialDraft(),researchResult))
        setProjectError(tr("Couldn't save the researched storyboard.","調査済みストーリーボードを保存できませんでした。"));
    }catch(error){setProjectError(error instanceof Error?error.message:"Could not save the researched storyboard.");}
  }

  return (
    <section
      id="workspace"
      aria-label={tr("Research workspace", "リサーチワークスペース")}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Tabs
        defaultActiveIndex={0}
        label={tr("Research sections", "リサーチのセクション")}
        className="flex min-h-0 flex-1 flex-col px-4 pb-4"
      >
        <Tabs.List className="mt-3 shrink-0" aria-label={tr("Research sections", "リサーチのセクション")}>
          <Tabs.Tab value={0} className="h-11">
            {tr("Research", "リサーチ")}
          </Tabs.Tab>
          <Tabs.Tab value={1} className="h-11">
            {tr("Evidence Library", "根拠ライブラリ")}
          </Tabs.Tab>
          <Tabs.Tab value={2} className="h-11">
            {translate(locale, "navPackaging")}
          </Tabs.Tab>
          <Tabs.Tab value={3} className="h-11">
            {locale === "ja" ? "YouTube 市場" : "YouTube Intelligence"}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value={0} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-8">
            <header className="rounded-surface border border-border bg-surface-subtle px-5 py-6 sm:px-8 sm:py-8">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {tr("STUDIO / RESEARCH", "スタジオ / リサーチ")}
              </p>
              <h2 className="mt-3 max-w-3xl font-serif text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {tr("Start with a question worth answering.", "答える価値のある問いから始めましょう。")}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                {tr("Capture public sources, review what they actually support, and turn the research into an editable visual story.",
                  "公開情報を集め、出典が裏付ける内容を確認し、編集できる映像ストーリーにまとめます。")}
              </p>
              <label htmlFor="research-topic" className="mt-6 block text-sm font-semibold text-foreground">
                {tr("Research topic", "リサーチするトピック")}
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input id="research-topic" value={topic} maxLength={160} onChange={e=>changeTopic(e.target.value)}
                  placeholder={tr("e.g. Why heat pumps cost more upfront", "例：ヒートポンプの初期費用が高い理由")}
                  className="min-w-0 flex-1 rounded-control border border-input bg-surface px-4 py-3 text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
                {!topic.trim() && <Button size="md" variant="outline" onClick={()=>changeTopic("heat pump vs gas furnace costs")}>
                  {tr("Try an example", "例を入力")}
                </Button>}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {tr("Research drafts stay separate from the saved Evidence Library until an indexing workflow is added.",
                  "調査の下書きは、索引機能が追加されるまで根拠ライブラリとは別に保存されます。")}
              </p>
            </header>
            <Surface variant="solid" className="gap-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {tr("01 / STORY BRIEF", "01 / 構成の概要")}
              </p>
              <h3 className="text-lg font-semibold">{tr("Shape the explanation", "解説の構成を整える")}</h3>
              <p className="text-sm text-muted-foreground">{tr(
                "One click captures public sources, checks exact quotes and drafts explanatory shots with your local model. You review the evidence before saving a video project; YouTube links remain inspiration, not evidence.",
                "公開情報を取得し、引用を照合してローカルモデルで解説ショット案を作ります。保存前に根拠を確認できます。YouTube リンクは参考用で、事実の証拠ではありません。"
              )}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">{tr("Audience (optional)", "対象視聴者（任意）")}
                  <input value={audience} maxLength={120} onChange={e=>{invalidateResearch();setAudience(e.target.value);}}
                    placeholder="Homeowners comparing heating quotes"
                    className="rounded-control border border-input bg-surface px-3 py-2"/>
                </label>
                <label className="grid gap-1 text-sm">{tr("Story approach", "構成パターン")}
                  <select value={approach} onChange={e=>{invalidateResearch();setApproach(e.target.value as EditorialDraft["selectedId"]);}}
                    className="rounded-control border border-input bg-surface px-3 py-2">
                    <option value="direct">{tr("Audience-first question", "視聴者の疑問から")}</option>
                    <option value="process">{tr("Mechanism reveal", "仕組みを段階的に説明")}</option>
                    <option value="comparison">{tr("Decision comparison", "選択肢を比較")}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">{tr("Question to answer (optional)", "答える疑問（任意）")}
                  <input value={viewerQuestion} maxLength={200} onChange={e=>{invalidateResearch();setViewerQuestion(e.target.value);}}
                    className="rounded-control border border-input bg-surface px-3 py-2"/>
                </label>
                <label className="grid gap-1 text-sm">{tr("What viewers will learn (optional)", "視聴者が学ぶこと（任意）")}
                  <input value={payoff} maxLength={320} onChange={e=>{invalidateResearch();setPayoff(e.target.value);}}
                    className="rounded-control border border-input bg-surface px-3 py-2"/>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={()=>void researchAndGenerate()} disabled={!onCreateStoryboard||researchBusy||topic.trim().length<3||topic.trim().length>160}>
                  {researchBusy?tr("Researching…","調査中…"):tr("Research & generate storyboard","調査して構成案を生成")}
                </Button>
                {researchBusy&&<Button variant="outline" onClick={cancelResearch}>{tr("Cancel","中止")}</Button>}
                <Button variant="outline" onClick={createFromResearch} disabled={!onCreateStoryboard||researchBusy||topic.trim().length<3||topic.trim().length>160}>
                  {tr("Create unresearched outline","未調査の構成案を作成")}
                </Button>
                <span className="text-xs text-muted-foreground">{tr(`${selectedUrls.length} inspiration links selected`, `参考リンク ${selectedUrls.length} 件`)}</span>
              </div>
              {researchBusy&&<p role="status" className="text-sm text-muted-foreground">{restoring?tr("Restoring saved research…","保存済みの調査を読み込み中…"):tr("Capturing public sources and drafting teaching shots. This may take a few minutes; no media is rendered yet.","公開情報を取得し、解説ショットを生成しています。数分かかる場合があります。動画はまだ生成されません。")}</p>}
              {researchError&&<p role="alert" className="rounded-control border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{researchError}</p>}
              {researchResult&&researchResult.dossier.topic.title===topic.trim()&&<div className="grid gap-4 border-t border-border pt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-lg font-semibold">{tr("Research-backed draft to review","根拠付き下書きを確認")}</h4>
                    <p className="text-sm text-muted-foreground">{tr(`${researchResult.dossier.claims.length} candidate claims · ${researchResult.dossier.evidence.length} captured sources · ${researchResult.plan.shots.length} planned shots`,
                      `主張 ${researchResult.dossier.claims.length} 件・出典 ${researchResult.dossier.evidence.length} 件・ショット ${researchResult.plan.shots.length} 件`)}</p>
                  </div>
                  <Button onClick={createSourcedStoryboard} disabled={!onCreateStoryboard}>
                    {tr("Create editable sourced storyboard →","根拠付きストーリーボードを作成 →")}
                  </Button>
                </div>
                <p className="text-sm text-status-warning">{tr("Quotes are copied from captured pages, but facts have not been independently verified. Review disputed numbers and assumptions before final production.",
                  "引用は取得したページからの原文ですが、事実確認は未完了です。最終生成前に数字と前提を確認してください。")}</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {researchResult.dossier.claims.map(claim=><div key={claim.id} className="rounded-surface border border-border bg-surface-subtle p-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{tr("Candidate claim · Needs review","確認待ちの主張")}</span>
                    <p className="mt-2 font-medium">{claim.text}</p>
                    {researchResult.quotes.filter(q=>q.claimId===claim.id).map((quote,i)=>{
                      const source=researchResult.dossier.evidence.find(s=>s.id===quote.sourceId);
                      return <div key={`${quote.sourceId}-${i}`} className="mt-3 border-s-2 border-primary/40 ps-3">
                        <p className="text-sm text-muted-foreground">“{quote.quote}”</p>
                        {source&&<a href={source.sourceUri} target="_blank" rel="noopener noreferrer" className="mt-1 block break-words text-sm text-primary underline-offset-2 hover:underline">
                          {source.title} · {new Date(source.retrievedAt).toLocaleDateString(locale==="ja"?"ja-JP":"en-US")}
                        </a>}
                      </div>;
                    })}
                  </div>)}
                </div>
                {researchResult.dossier.gaps.length>0&&<div className="rounded-surface border border-warning/30 bg-warning/5 p-4">
                  <h5 className="font-semibold">{tr("What still needs checking","追加調査が必要な点")}</h5>
                  <ul className="mt-2 list-disc space-y-1 ps-5 text-sm">{researchResult.dossier.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul>
                </div>}
                <div>
                  <h5 className="font-semibold">{tr("Planned visual explanation","映像でどう説明するか")}</h5>
                  <p className="mt-1 text-sm text-muted-foreground">{researchResult.plan.story.hook}</p>
                  <ol className="mt-3 grid gap-2 md:grid-cols-2">{researchResult.plan.shots.map((shot,i)=><li key={shot.id} className="rounded-control border border-border p-3">
                    <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{i+1}.</span><strong>{shot.onScreenText}</strong></div>
                    <p className="mt-1 text-sm text-foreground">{shot.visualChange}</p>
                    <p className="mt-2 text-xs text-muted-foreground">{researchResult.plan.sound.find(s=>s.shotId===shot.id)?.narration}</p>
                  </li>)}</ol>
                </div>
              </div>}
              {projectError && <p role="alert" className="text-sm text-danger">{projectError}</p>}
              <p className="text-xs text-muted-foreground">{tr("No video/audio is rendered yet. Independent factual research and approval are still required before publishing.",
                "映像・音声の生成はまだ行いません。公開前に独立した事実確認と承認が必要です。")}</p>
            </Surface>
            <details className="rounded-surface border border-border bg-surface" onToggle={event=>setShowInspiration(event.currentTarget.open)}>
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6">
                {tr("YouTube inspiration (optional)", "YouTube の参考動画（任意）")}
                <span className="ms-2 text-xs font-normal text-muted-foreground">{tr("Find related videos without treating them as verified facts", "関連動画を探す（事実の証拠には含めません）")}</span>
              </summary>
              <div className="border-t border-border px-4 py-4">
                {showInspiration && <RelatedYoutubePanel locale={locale} topic={topic} selectedUrls={selectedUrls} onSelectUrls={setSelectedUrls}/>}
              </div>
            </details>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value={1} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="mx-auto w-full max-w-5xl pb-8">
            <EvidencePanel locale={locale} query={evidenceQuery} onQueryChange={setEvidenceQuery} />
          </div>
        </Tabs.Panel>

        <Tabs.Panel value={2} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <PackagingPanel locale={locale} />
        </Tabs.Panel>

        <Tabs.Panel value={3} className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <YoutubeIntelligencePanel locale={locale} onUseVideo={onUseVideo} onCreateStoryboard={onCreateStoryboard}/>
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}
