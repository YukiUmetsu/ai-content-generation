import type { Locale } from "@/features/registry";

export type MarketCounts = { succeeded: number; unavailable: number; attempts?: number };
export type MarketHealth = { state?: string; youtube?: MarketCounts; googleTrends?: MarketCounts };
export type DiscoveryProviderHealth = Record<string, string | MarketHealth>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function parseCounts(value: unknown): MarketCounts | undefined {
  if (!record(value) || !count(value.succeeded) || !count(value.unavailable)) return;
  if (value.attempts !== undefined && (!count(value.attempts) ||
      value.attempts < value.succeeded + value.unavailable)) return;
  return { succeeded: value.succeeded, unavailable: value.unavailable,
    ...(value.attempts === undefined ? {} : { attempts: value.attempts }) };
}

/** Normalize untrusted server data into a small, explicitly allowed display contract. */
export function parseDiscoveryProviderHealth(value: unknown): DiscoveryProviderHealth {
  if (!record(value)) return {};
  const result: DiscoveryProviderHealth = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      result[key] = item;
    } else if (record(item)) {
      const health: MarketHealth = {};
      if (typeof item.state === "string") health.state = item.state;
      const youtube = parseCounts(item.youtube);
      const trends = parseCounts(item.googleTrends);
      if (youtube) health.youtube = youtube;
      if (trends) health.googleTrends = trends;
      result[key] = health;
    }
  }
  return result;
}
function marketCount(value: unknown, name: string, locale: Locale): string | null {
  const parsed = parseCounts(value);
  if (!parsed) return null;
  return locale === "ja"
    ? `${name}: 成功 ${parsed.succeeded} 件、利用不可 ${parsed.unavailable} 件`
    : `${name}: ${parsed.succeeded} succeeded, ${parsed.unavailable} unavailable`;
}

/** Render only known measurements; never stringify arbitrary objects or metadata. */
export function formatDiscoveryProviderHealth(value: unknown, locale: Locale): string {
  if (typeof value === "string") return value;
  if (!record(value)) return locale === "ja" ? "不明" : "Unknown";
  const parts: string[] = [];
  const states: Record<string, [string, string]> = {
    measured: ["Measured", "計測済み"], partial: ["Partial", "一部のみ"],
    running: ["Running", "実行中"], failed: ["Failed", "失敗"],
    unavailable: ["Unavailable", "利用不可"], skipped: ["Skipped", "スキップ"],
    queued: ["Queued", "待機中"], pending: ["Pending", "保留中"],
    completed: ["Completed", "完了"], insufficient_evidence: ["Insufficient evidence", "根拠不足"],
  };
  if (typeof value.state === "string" && Object.hasOwn(states, value.state)) {
    parts.push(states[value.state][locale === "ja" ? 1 : 0]);
  }
  const youtube = marketCount(value.youtube, "YouTube", locale);
  const trends = marketCount(value.googleTrends, "Google Trends", locale);
  if (youtube) parts.push(youtube);
  if (trends) parts.push(trends);
  return parts.join(" · ") || (locale === "ja" ? "詳細を表示できません" : "Details unavailable");
}
