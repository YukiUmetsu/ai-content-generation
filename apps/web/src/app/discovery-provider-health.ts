import type { Locale } from "@/features/registry";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function marketCount(value: unknown, name: string, locale: Locale): string | null {
  if (!record(value)) return null;
  const succeeded = value.succeeded;
  const unavailable = value.unavailable;
  if (typeof succeeded !== "number" || !Number.isSafeInteger(succeeded) || succeeded < 0 ||
      typeof unavailable !== "number" || !Number.isSafeInteger(unavailable) || unavailable < 0) return null;
  return locale === "ja"
    ? `${name}: 成功 ${succeeded} 件、利用不可 ${unavailable} 件`
    : `${name}: ${succeeded} succeeded, ${unavailable} unavailable`;
}

/** Provider health may contain structured market measurements, not just legacy status strings. */
export function formatDiscoveryProviderHealth(value: unknown, locale: Locale): string {
  if (typeof value === "string") return value;
  if (!record(value)) return locale === "ja" ? "不明" : "Unknown";

  const parts: string[] = [];
  if (typeof value.state === "string") {
    const states: Record<string, [string, string]> = {
      measured: ["Measured", "計測済み"], partial: ["Partial", "一部のみ"],
      running: ["Running", "実行中"], failed: ["Failed", "失敗"],
    };
    const status = Object.hasOwn(states, value.state) ? states[value.state] : undefined;
    if (status) parts.push(status[locale === "ja" ? 1 : 0]);
  }
  const youtube = marketCount(value.youtube, "YouTube", locale);
  const trends = marketCount(value.googleTrends, "Google Trends", locale);
  if (youtube) parts.push(youtube);
  if (trends) parts.push(trends);
  if (parts.length > 0) return parts.join(" · ");

  return locale === "ja" ? "詳細を表示できません" : "Details unavailable";
}
