/**
 * Motion core — diagnostics helpers (docs/11 §4).
 *
 * Diagnostics are plain data. They are produced by pure evaluation and are never
 * thrown: callers decide whether a warning or error is blocking.
 */

import type { Diagnostic } from "./types";

/** Build a diagnostic, letting `extra` refine any optional field. */
export function createDiagnostic(
  code: string,
  severity: "error" | "warning",
  message: string,
  extra?: Partial<Diagnostic>,
): Diagnostic {
  return { code, severity, message, ...extra };
}

/** Tally severities. */
export function countBySeverity(diags: Diagnostic[]): { error: number; warning: number } {
  let error = 0;
  let warning = 0;
  for (const d of diags) {
    if (d.severity === "error") error += 1;
    else warning += 1;
  }
  return { error, warning };
}

/** True when at least one error was reported. */
export function hasBlockingDiagnostics(diags: Diagnostic[]): boolean {
  return diags.some((d) => d.severity === "error");
}

/**
 * Stable sort: frame ascending (missing frames last), then errors before
 * warnings, then code, then message. Ties preserve input order.
 */
export function sortDiagnostics(diags: Diagnostic[]): Diagnostic[] {
  const indexed = diags.map((diagnostic, index) => ({ diagnostic, index }));
  indexed.sort((x, y) => {
    const fx = x.diagnostic.frame === undefined ? Number.POSITIVE_INFINITY : x.diagnostic.frame;
    const fy = y.diagnostic.frame === undefined ? Number.POSITIVE_INFINITY : y.diagnostic.frame;
    if (fx !== fy) return fx - fy;

    const sx = x.diagnostic.severity === "error" ? 0 : 1;
    const sy = y.diagnostic.severity === "error" ? 0 : 1;
    if (sx !== sy) return sx - sy;

    if (x.diagnostic.code !== y.diagnostic.code) {
      return x.diagnostic.code < y.diagnostic.code ? -1 : 1;
    }
    if (x.diagnostic.message !== y.diagnostic.message) {
      return x.diagnostic.message < y.diagnostic.message ? -1 : 1;
    }
    return x.index - y.index;
  });
  return indexed.map((entry) => entry.diagnostic);
}
