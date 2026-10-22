import { AlertTriangle, CircleCheck } from "lucide-react";
import { copy, describeDiagnostic } from "../i18n";
import type { Locale, SemanticStoryboard } from "../model/types";
import { countBySeverity, type StoryboardDiagnostic } from "../model/validate";

interface DiagnosticsPanelProps {
  board: SemanticStoryboard;
  diagnostics: StoryboardDiagnostic[];
  onSelectBeat: (beatId: string) => void;
  locale: Locale;
}

export function DiagnosticsPanel({
  board,
  diagnostics,
  onSelectBeat,
  locale,
}: DiagnosticsPanelProps) {
  const t = copy(locale);
  const counts = countBySeverity(diagnostics);

  return (
    <section className="sp-panel sp-checks" aria-label={t.checksHeading}>
      <div className="sp-panel-heading">
        <h2>{t.checksHeading}</h2>
        <span className={counts.errors > 0 ? "sp-count is-error" : "sp-count"}>
          {diagnostics.length}
        </span>
      </div>
      <p className="sp-check-counts">
        <span className={counts.errors > 0 ? "is-error" : ""}>
          {t.errorsCount(counts.errors)}
        </span>
        <span>{t.warningsCount(counts.warnings)}</span>
      </p>

      {diagnostics.length === 0 ? (
        <p className="sp-empty-checks">
          <CircleCheck aria-hidden="true" className="sp-empty-icon" />
          {t.noIssues}
        </p>
      ) : (
        <ul className="sp-diagnostics">
          {diagnostics.map((diagnostic, index) => {
            const message = describeDiagnostic(diagnostic, locale, board);
            return (
              <li key={`${diagnostic.code}-${diagnostic.beatId ?? diagnostic.path}-${index}`}>
                {diagnostic.beatId ? (
                  <button
                    type="button"
                    className="sp-diagnostic"
                    data-severity={diagnostic.severity}
                    onClick={() => onSelectBeat(diagnostic.beatId ?? "")}
                  >
                    <SeverityIcon severity={diagnostic.severity} />
                    <span>{message}</span>
                  </button>
                ) : (
                  <div className="sp-diagnostic" data-severity={diagnostic.severity}>
                    <SeverityIcon severity={diagnostic.severity} />
                    <span>{message}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="sp-advisory">{t.advisoryNote}</p>
    </section>
  );
}

function SeverityIcon({ severity }: { severity: StoryboardDiagnostic["severity"] }) {
  return severity === "error" ? (
    <AlertTriangle aria-hidden="true" className="sp-severity-icon is-error" />
  ) : (
    <AlertTriangle aria-hidden="true" className="sp-severity-icon is-warning" />
  );
}
