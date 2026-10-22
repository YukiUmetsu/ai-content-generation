import type { ComposerCopy } from "../i18n";
import type { ThumbnailIssue } from "../model/types";

export interface DiagnosticsListProps {
  issues: ThumbnailIssue[];
  copy: ComposerCopy;
  /** Documented as "checks" in the UI; the status line is announced politely. */
  id?: string;
}

function statusLine(issues: ThumbnailIssue[], copy: ComposerCopy): string {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  if (errors > 0) return copy.checksBlocked(errors);
  if (issues.length > 0) return copy.checksWarnings(issues.length);
  return copy.checksPass;
}

/**
 * Advisory QA. Geometry and copy checks never claim expressive quality; they
 * only flag things a person can verify.
 */
export function DiagnosticsList({ issues, copy, id }: DiagnosticsListProps) {
  const status = statusLine(issues, copy);
  return (
    <div className="tc-checks" id={id} data-testid="thumbnail-diagnostics">
      <p className="tc-checks__status" data-status={issues.some((entry) => entry.severity === "error") ? "blocked" : issues.length > 0 ? "warnings" : "pass"} aria-live="polite">
        <span className="tc-checks__glyph" aria-hidden="true">
          {issues.length === 0 ? "✓" : issues.some((entry) => entry.severity === "error") ? "!" : "i"}
        </span>
        {status}
      </p>
      {issues.length > 0 ? (
        <ul className="tc-checks__list">
          {issues.map((issue) => {
            const entry = copy.issueCopy[issue.code];
            return (
              <li
                key={`${issue.code}-${issue.layerId ?? "doc"}-${issue.locale}`}
                className="tc-check"
                data-severity={issue.severity}
                data-code={issue.code}
              >
                <span className="tc-check__severity">
                  {issue.severity === "error" ? copy.severityError : copy.severityWarning}
                </span>
                <span className="tc-check__body">
                  <span className="tc-check__title">{entry.title}</span>
                  {entry.hint ? <span className="tc-check__hint">{entry.hint}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tc-checks__empty">{copy.checksEmpty}</p>
      )}
    </div>
  );
}
