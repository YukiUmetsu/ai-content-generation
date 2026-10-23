import { useState } from "react";
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

interface ResearchWorkspaceProps {
  locale: Locale;
  onUseVideo: (idea: {title: string; sourceUrl: string}) => boolean;
  onCreateStoryboard?: (draft: EditorialDraft) => boolean;
  projectTopic?: string;
}

export function ResearchWorkspace({ locale, onUseVideo, onCreateStoryboard, projectTopic = "" }: ResearchWorkspaceProps) {
  const ja = locale === "ja";
  const tr = (en: string, jp: string) => ja ? jp : en;
  const [topic, setTopic] = useState(projectTopic);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [audience, setAudience] = useState("");
  const [viewerQuestion, setViewerQuestion] = useState("");
  const [payoff, setPayoff] = useState("");
  const [approach, setApproach] = useState<EditorialDraft["selectedId"]>("direct");
  const [projectError, setProjectError] = useState("");

  function changeTopic(next: string) {
    setTopic(next);
    setSelectedUrls([]);
    setProjectError("");
  }

  function createFromResearch() {
    if (!onCreateStoryboard) return;
    setProjectError("");
    try {
      const seed = createDraft(topic.trim());
      const input = {
        ...seed.input,
        audience: audience.trim() || seed.input.audience,
        viewerQuestion: viewerQuestion.trim() || seed.input.viewerQuestion,
        payoff: payoff.trim() || seed.input.payoff,
        inspirationUrls: selectedUrls,
      };
      const draft = validateEditorialDraft({...seed,input,approaches:starterApproaches(input),selectedId:approach});
      if (!onCreateStoryboard(draft)) setProjectError(tr("Couldn't save the new storyboard project.", "ストーリーボードを保存できませんでした。"));
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "Could not create project.");
    }
  }

  return (
    <section
      id="workspace"
      aria-label={translate(locale, "navEvidence")}
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <Tabs
        defaultActiveIndex={0}
        label={translate(locale, "navEvidence")}
        className="flex min-h-0 flex-1 flex-col px-4 pb-4"
      >
        <Tabs.List className="mt-3 shrink-0" aria-label={translate(locale, "navLabel")}>
          <Tabs.Tab value={0} className="h-11">
            {translate(locale, "navEvidence")}
          </Tabs.Tab>
          <Tabs.Tab value={1} className="h-11">
            {translate(locale, "navPackaging")}
          </Tabs.Tab>
          <Tabs.Tab value={2} className="h-11">
            {locale === "ja" ? "YouTube 市場" : "YouTube Intelligence"}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value={0} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-6">
            <EvidencePanel locale={locale} query={topic} onQueryChange={changeTopic} />
            {!topic.trim() && <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              {tr("No project topic yet. Try a research example:", "まだトピックがありません。例を試す:")}
              <Button size="sm" variant="outline" onClick={()=>changeTopic("heat pump vs gas furnace costs")}>
                {tr("Heat pump vs. gas furnace", "ヒートポンプ vs ガス炉")}
              </Button>
            </div>}
            <RelatedYoutubePanel locale={locale} topic={topic} selectedUrls={selectedUrls} onSelectUrls={setSelectedUrls}/>
            <Surface variant="solid" className="gap-3">
              <h3 className="text-base font-semibold">{tr("Create an original video from this research", "このリサーチからオリジナル動画を作成")}</h3>
              <p className="text-sm text-muted-foreground">{tr(
                "Your topic and editorial choices create a new storyboard. Selected YouTube links are references only; factual claims remain unverified.",
                "テーマと編集方針をもとに新規ストーリーボードを作成します。YouTubeリンクは参考用であり、事実の根拠ではありません。"
              )}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">{tr("Audience (optional)", "対象視聴者（任意）")}
                  <input value={audience} maxLength={120} onChange={e=>setAudience(e.target.value)}
                    placeholder="Homeowners comparing heating quotes"
                    className="rounded-control border border-input bg-surface px-3 py-2"/>
                </label>
                <label className="grid gap-1 text-sm">{tr("Story approach", "構成パターン")}
                  <select value={approach} onChange={e=>setApproach(e.target.value as EditorialDraft["selectedId"])}
                    className="rounded-control border border-input bg-surface px-3 py-2">
                    <option value="direct">{tr("Audience-first question", "視聴者の疑問から")}</option>
                    <option value="process">{tr("Mechanism reveal", "仕組みを段階的に説明")}</option>
                    <option value="comparison">{tr("Decision comparison", "選択肢を比較")}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">{tr("Question to answer (optional)", "答える疑問（任意）")}
                  <input value={viewerQuestion} maxLength={200} onChange={e=>setViewerQuestion(e.target.value)}
                    className="rounded-control border border-input bg-surface px-3 py-2"/>
                </label>
                <label className="grid gap-1 text-sm">{tr("What viewers will learn (optional)", "視聴者が学ぶこと（任意）")}
                  <input value={payoff} maxLength={320} onChange={e=>setPayoff(e.target.value)}
                    className="rounded-control border border-input bg-surface px-3 py-2"/>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={createFromResearch} disabled={!onCreateStoryboard || topic.trim().length < 3 || topic.trim().length > 160}>
                  {tr("Create video project → Storyboard", "動画プロジェクト → ストーリーボード")}
                </Button>
                <span className="text-xs text-muted-foreground">{tr(`${selectedUrls.length} inspiration links selected`, `参考リンク ${selectedUrls.length} 件`)}</span>
              </div>
              {projectError && <p role="alert" className="text-sm text-danger">{projectError}</p>}
              <p className="text-xs text-muted-foreground">{tr("No video/audio is rendered yet. Independent factual research and approval are still required before publishing.",
                "映像・音声の生成はまだ行いません。公開前に独立した事実確認と承認が必要です。")}</p>
            </Surface>
          </div>
        </Tabs.Panel>

        <Tabs.Panel value={1} keepMounted className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <PackagingPanel locale={locale} />
        </Tabs.Panel>

        <Tabs.Panel value={2} className="mt-3 flex min-h-0 flex-1 flex-col overflow-auto">
          <YoutubeIntelligencePanel locale={locale} onUseVideo={onUseVideo} onCreateStoryboard={onCreateStoryboard}/>
        </Tabs.Panel>
      </Tabs>
    </section>
  );
}
