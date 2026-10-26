import type { DiscoverySourceSummary, ScriptEvidence } from "./discovery-sessions";
export interface ProductionEvidenceSnapshot {
  version: 1;
  productionId: string;
  projectId: string;
  ideaId: string;
  evidence: ScriptEvidence[];
  sources: DiscoverySourceSummary[];
  warnings: string[];
}
export async function productionEvidence(productionId: string, options: {
  locale?: "en" | "ja"; signal?: AbortSignal;
} = {}): Promise<ProductionEvidenceSnapshot | null> {
  const response = await fetch("/api/contentgen-director/production-evidence/" + encodeURIComponent(productionId), {
    method: options.locale ? "POST" : "GET", signal: options.signal,
    ...(options.locale ? {headers: {"Content-Type": "application/json", "X-Contentgen-Director": "local-only"},
      body: JSON.stringify({allowNetwork: true, locale: options.locale})} : {}),
  });
  const result = await response.json().catch(() => null) as {snapshot?: ProductionEvidenceSnapshot | null; error?: string} | null;
  if (!response.ok) throw Error(result?.error ?? `Production evidence service returned HTTP ${response.status}.`);
  const snapshot = result?.snapshot;
  if (snapshot === null) return null;
  if (!snapshot || snapshot.version !== 1 || snapshot.productionId !== productionId ||
    !Array.isArray(snapshot.evidence) || !snapshot.evidence.length || !Array.isArray(snapshot.sources))
    throw Error("The production evidence response is invalid.");
  return snapshot;
}
