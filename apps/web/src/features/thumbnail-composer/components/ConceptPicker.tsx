import { useId } from "react";
import { CONCEPT_IDS } from "../model/concepts";
import { VARIANT_ID_BY_CONCEPT } from "../model/fixtures";
import type { ConceptId } from "../model/types";
import type { ComposerCopy } from "../i18n";

export interface ConceptPickerProps {
  activeConcept: ConceptId;
  copy: ComposerCopy;
  onSelect: (concept: ConceptId) => void;
}

const LETTERS = ["A", "B", "C"] as const;

/**
 * Concept choice as a native radio group: arrow keys move between options and
 * focus stays visible on the whole card, not just the small input.
 */
export function ConceptPicker({ activeConcept, copy, onSelect }: ConceptPickerProps) {
  const name = useId();
  return (
    <div className="tc-concepts" role="radiogroup" aria-label={copy.conceptGroupLabel}>
      {CONCEPT_IDS.map((concept, index) => {
        const inputId = `${name}-${concept}`;
        const descriptionId = `${inputId}-description`;
        const checked = concept === activeConcept;
        return (
          <label
            key={concept}
            className="tc-concept"
            data-active={checked ? "true" : "false"}
            htmlFor={inputId}
          >
            <input
              id={inputId}
              className="tc-concept__input"
              type="radio"
              name={name}
              value={VARIANT_ID_BY_CONCEPT[concept]}
              checked={checked}
              onChange={() => onSelect(concept)}
              aria-describedby={descriptionId}
            />
            <span className="tc-concept__letter" aria-hidden="true">
              {LETTERS[index] ?? index + 1}
            </span>
            <span className="tc-concept__body">
              <span className="tc-concept__name">{copy.conceptNames[concept]}</span>
              <span className="tc-concept__description" id={descriptionId}>
                {copy.conceptDescriptions[concept]}
              </span>
              <span className="tc-concept__question">{copy.conceptQuestions[concept]}</span>
              <span className="tc-concept__composition">{copy.compositionNames[concept]}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
