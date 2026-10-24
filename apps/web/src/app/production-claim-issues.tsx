import type { Locale } from "@/features/registry";
import type { ResearchDraftResult } from "./researched-storyboard";
import type { ClaimEvidenceIssue } from "./claim-evidence";

interface ProductionClaimIssuesProps {
  issues: readonly ClaimEvidenceIssue[];
  draft?: ResearchDraftResult | null;
  locale?: Locale;
  onOpenBeat: (beatId: string) => void;
  onFindEvidence: () => void;
  onRetryRepair?: () => void;
  reviewedClaims?: ReadonlySet<string>;
  onMarkReviewed?: (claimId:string) => void;
  onUndoReviewed?: (claimId:string) => void;
}
const label=(kind:ClaimEvidenceIssue["kind"],ja:boolean)=>({
  source_missing:ja?"出典がありません":"Missing source",
  source_mismatch:ja?"引用と出典が一致しません":"Source link mismatch",
  source_unchecked:ja?"保存した資料を確認してください":"Source not loaded",
  needs_factual_review:ja?"事実確認が必要です":"Needs factual review",
})[kind];

export function ProductionClaimIssues({
  issues,draft,locale="en",onOpenBeat,onFindEvidence,onRetryRepair,
  reviewedClaims,onMarkReviewed,onUndoReviewed,
}:ProductionClaimIssuesProps) {
  const ja=locale==="ja";
  if(issues.length===0)return (
    <p className="rounded-control border border-border bg-surface p-4 text-sm text-muted-foreground">
      {ja?"参照中の主張に問題はありません。":"No claim evidence issues detected in this storyboard."}
    </p>
  );
  const sources=new Map((draft?.dossier?.evidence??[]).map(source=>[source.id,source]));
  return <section aria-label={ja?"主張と出典の確認":"Claim evidence review"} className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-serif text-lg font-semibold">{ja?"主張の確認":"Claim review"} · {issues.length}</h3>
      <p className="max-w-lg text-xs text-muted-foreground">
        {ja?"出典の確認と事実の承認は別です。":"A captured quotation is a source link, not proof that a claim is correct."}
      </p>
    </div>
    {issues.map(issue=>{
      const broken=issue.kind==="source_missing"||issue.kind==="source_mismatch";
      const reviewed=reviewedClaims?.has(issue.claimId)??false;
      const linkedQuotes=(draft?.quotes??[]).filter(quote=>quote.claimId===issue.claimId&&
        issue.sourceRefs.includes(quote.sourceId)&&typeof quote.quote==="string").slice(0,2);
      return <article key={issue.claimId} data-testid="claim-issue"
        className="space-y-3 rounded-control border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{issue.claimId}</p>
            <p className="mt-1 text-sm font-medium leading-relaxed">{issue.claimText}</p>
          </div>
          <span className={reviewed?"rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700":
            broken?"rounded-full bg-danger/10 px-2.5 py-1 text-xs text-danger":
            "rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"}>
            {reviewed?(ja?"ローカルで確認済み":"Reviewed locally"):label(issue.kind,ja)}
          </span>
        </div>
        {issue.sourceRefs.length>0&&<div className="flex flex-wrap gap-2 text-xs">
          {issue.sourceRefs.map(ref=>{
            const source=sources.get(ref);
            return source?.sourceUri?
              <a key={ref} href={source.sourceUri} target="_blank" rel="noopener noreferrer"
                className="rounded-control border border-border px-2.5 py-1.5 text-primary underline-offset-2 hover:underline">
                {ja?"出典を開く":"Open source"}: {source.title||ref}
              </a>:
              <span key={ref} className="rounded-control border border-border px-2.5 py-1.5 text-muted-foreground">
                {ref} · {ja?"未読込":"not loaded"}
              </span>;
          })}
        </div>}
        {linkedQuotes.length>0&&<div className="space-y-2 rounded-control bg-surface-subtle p-3">
          <p className="text-xs font-semibold text-muted-foreground">{ja?"保存済みの引用":"Saved source excerpt"}</p>
          {linkedQuotes.map((quote,index)=><blockquote key={quote.sourceId+index}
            className="border-l-2 border-border pl-3 text-xs leading-relaxed text-foreground">
            {quote.quote}
          </blockquote>)}
        </div>}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{ja?"使用箇所":"Used in"}:</span>
          {issue.beatIds.map(beatId=><button key={beatId} type="button" data-testid="claim-beat-link"
            className="rounded-control border border-border px-2.5 py-1.5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
            onClick={()=>onOpenBeat(beatId)}>{beatId}</button>)}
        </div>
        {issue.kind==="needs_factual_review"&&onMarkReviewed&&draft&&linkedQuotes.length>0&&<div className="flex flex-wrap gap-2">
          {reviewed?<button type="button" onClick={()=>onUndoReviewed?.(issue.claimId)}
            className="rounded-control border border-border px-3 py-2 text-xs">
            {ja?"確認を取り消す":"Undo review"}
          </button>:<button type="button" onClick={()=>onMarkReviewed(issue.claimId)}
            className="rounded-control border border-border px-3 py-2 text-xs font-medium">
            {ja?"主張と出典を自分で確認しました":"I reviewed this claim and its sources"}
          </button>}
          <p className="self-center text-xs text-muted-foreground">{ja?"この操作は公開を承認しません。":"This does not approve publishing."}</p>
        </div>}
        {broken&&<div className="flex flex-wrap gap-2">
          <button type="button" onClick={onFindEvidence}
            className="rounded-control bg-primary px-3 py-2 text-xs font-medium text-primary-foreground">
            {ja?"追加の根拠を探す":"Find more evidence"}
          </button>
          {onRetryRepair&&<button type="button" onClick={onRetryRepair}
            className="rounded-control border border-border px-3 py-2 text-xs">
            {ja?"自動修復を再試行":"Retry automatic repair"}
          </button>}
        </div>}
      </article>;
    })}
  </section>;
}
