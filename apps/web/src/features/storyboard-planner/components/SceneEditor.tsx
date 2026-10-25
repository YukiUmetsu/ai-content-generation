import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { copy, describeDiagnostic } from "../i18n";
import {
  estimateNarration,
  formatRuntime,
  type BeatTiming,
} from "../model/timeline";
import {
  MAX_ON_SCREEN_CHARS,
  NARRATIVE_ROLES,
  VISUAL_INTENTS,
  isPositiveInteger,
  type Locale,
  type SemanticStoryboard,
  type StoryboardBeat,
} from "../model/types";
import { diagnosticsForBeat, type StoryboardDiagnostic } from "../model/validate";
import {VISUAL_OPERATORS} from "../../../../scripts/video-production/semantic-mechanic.mjs";
import type {VisualMechanicV1} from "../../../../scripts/video-production/semantic-mechanic.mjs";

interface SceneEditorProps {
  board: SemanticStoryboard;
  beat: StoryboardBeat;
  timing?: BeatTiming;
  diagnostics: StoryboardDiagnostic[];
  onChange: (patch: Partial<StoryboardBeat>) => void;
  locale: Locale;
}

function TextAreaField({
  label,
  value,
  onChange,
  hint,
  rows = 3,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  rows?: number;
  maxLength?: number;
}) {
  const generated = useId();
  const hintId = hint ? `${generated}-hint` : undefined;
  return (
    <div className="sp-field">
      <label htmlFor={generated} className="sp-label">
        {label}
      </label>
      <textarea
        id={generated}
        className="sp-textarea"
        rows={rows}
        maxLength={maxLength}
        value={value}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && (
        <p className="sp-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const generated = useId();
  return (
    <div className="sp-field">
      <label htmlFor={generated} className="sp-label">
        {label}
      </label>
      <select
        id={generated}
        className="sp-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckGroup({
  legend,
  options,
  selected,
  onToggle,
}: {
  legend: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
}) {
  const generated = useId();
  if (options.length === 0) return null;
  return (
    <fieldset className="sp-check-group" aria-labelledby={`${generated}-legend`}>
      <legend id={`${generated}-legend`} className="sp-label">
        {legend}
      </legend>
      <div className="sp-check-grid">
        {options.map((option) => (
          <label key={option.id} className="sp-check">
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={(event) => onToggle(option.id, event.target.checked)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SceneEditor({
  board,
  beat,
  timing,
  diagnostics,
  onChange,
  locale,
}: SceneEditorProps) {
  const t = copy(locale);
  const [showAdvanced,setShowAdvanced]=useState(false);
  const beatDiagnostics = diagnosticsForBeat(diagnostics, beat.id);
  const estimate = estimateNarration(beat, board.fps, board.locale);
  const units =
    board.locale === "ja"
      ? `${estimate.units}${locale === "ja" ? "文字" : " characters"}`
      : `${estimate.units}${locale === "ja" ? "語" : " words"}`;
  const rate = board.locale === "ja" ? t.rateChars : t.rateWords;
  const estimated = formatRuntime(estimate.estimatedFrames, board.fps, locale);
  const allotted = formatRuntime(
    isPositiveInteger(beat.durationFrames) ? beat.durationFrames : 0,
    board.fps,
    locale
  );
  const estimateLine =
    estimate.status === "over"
      ? t.narrationOver(units, rate, estimated, allotted)
      : estimate.status === "tight"
        ? t.narrationTight(units, rate, estimated, allotted)
        : t.narrationFits(units, rate, estimated, allotted);

  const onScreenCount = Array.from(beat.onScreenText.trim()).length;
  const roleOptions = NARRATIVE_ROLES.map((role) => ({ value: role, label: t.roles[role] }));
  const intentOptions = VISUAL_INTENTS.map((intent) => ({ value: intent, label: t.intents[intent] }));
  const focusOptions = board.semanticObjects.map((object) => ({
    value: object.id,
    label: object.label,
  }));
  if (
    beat.focusTarget !== "" &&
    !focusOptions.some((option) => option.value === beat.focusTarget)
  ) {
    focusOptions.push({ value: beat.focusTarget, label: beat.focusTarget });
  }

  function toggle(list: string[], id: string, checked: boolean): string[] {
    return checked ? [...list, id] : list.filter((entry) => entry !== id);
  }

  function nudge(frames: number) {
    const base = isPositiveInteger(beat.durationFrames) ? beat.durationFrames : 0;
    onChange({ durationFrames: Math.max(1, base + frames) });
  }

  return (
    <section className="sp-panel sp-scene-editor" aria-label={t.sceneHeading}>
      <div className="sp-panel-heading">
        <h2>{t.sceneHeading}</h2>
        <span className="sp-scene-id">{beat.id}</span>
        {timing && (
          <span className="sp-scene-range">
            {formatRuntime(timing.startFrame, board.fps, locale)} –{" "}
            {formatRuntime(timing.endFrame, board.fps, locale)}
          </span>
        )}
      </div>

      {beatDiagnostics.length > 0 && (
        <div className="sp-inline-issues" role="status">
          <h3>{t.relatedIssues}</h3>
          <ul>
            {beatDiagnostics.map((diagnostic, index) => (
              <li key={`${diagnostic.code}-${index}`} className={`is-${diagnostic.severity}`}>
                {describeDiagnostic(diagnostic, locale, board)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="sp-editor-sections">
        <fieldset className="sp-section">
          <legend>{locale==="ja"?"シーンの基本編集":"Scene essentials"}</legend>
          <TextAreaField
            label={t.objectiveLabel}
            value={beat.objective}
            onChange={(objective) => onChange({ objective })}
            rows={2}
          />

          <TextAreaField
            label={t.narrationLabel}
            value={beat.narration}
            onChange={(narration) => onChange({ narration })}
            hint={t.narrationHint}
            rows={4}
          />
          <p className="sp-estimate" data-status={estimate.status}>
            {estimateLine}
          </p>
          <Field
            label={t.onScreenTextLabel}
            hint={t.characters(onScreenCount, MAX_ON_SCREEN_CHARS)}
            value={beat.onScreenText}
            aria-invalid={onScreenCount > MAX_ON_SCREEN_CHARS || undefined}
            onChange={(event) => onChange({ onScreenText: event.target.value })}
          />
          <TextAreaField
            label={t.visualObjectiveLabel}
            value={beat.visualObjective}
            onChange={(visualObjective) => onChange({ visualObjective })}
            rows={3}
          />
          <div className="sp-duration">
            <Field
              label={t.durationLabel}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className="sp-number"
              containerClassName="sp-duration-field"
              value={Number.isFinite(beat.durationFrames) ? beat.durationFrames : 0}
              aria-invalid={!isPositiveInteger(beat.durationFrames) || undefined}
              hint={t.durationHint}
              onChange={(event) => onChange({ durationFrames: Number(event.target.value) })}
            />
            <div className="sp-nudge" role="group" aria-label={t.durationLabel}>
              {[-30, -15, 15, 30].map((frames) => (
                <Button
                  key={frames}
                  variant="outline"
                  size="sm"
                  aria-label={`${t.durationLabel} ${frames > 0 ? "+" : ""}${frames}`}
                  onClick={() => nudge(frames)}
                >
                  {frames > 0 ? `+${frames}` : frames}
                </Button>
              ))}
            </div>
            <p className="sp-duration-readout">
              {isPositiveInteger(beat.durationFrames)
                ? `${t.frames(beat.durationFrames)} · ${formatRuntime(beat.durationFrames, board.fps, locale)}`
                : t.invalidDurationShort}
            </p>
          </div>
        </fieldset>
        <button type="button" aria-expanded={showAdvanced} onClick={()=>setShowAdvanced(value=>!value)}
          className="flex w-full items-center justify-between rounded-control border border-border bg-surface-subtle px-4 py-3 text-left text-sm font-semibold hover:bg-muted">
          {locale==="ja"?"詳細設定":"Advanced scene controls"} <span aria-hidden="true">{showAdvanced?"−":"+"}</span>
        </button>
        {showAdvanced&&<>

        <fieldset className="sp-section">
          <legend>{t.narrativeSection}</legend>
          <SelectField
            label={t.roleLabel}
            value={beat.role}
            onChange={(role) => onChange({ role: role as StoryboardBeat["role"] })}
            options={roleOptions}
          />

        </fieldset>

        <fieldset className="sp-section">
          <legend>{t.visualSection}</legend>
          <SelectField
            label={t.visualIntentLabel}
            value={beat.visualIntent}
            onChange={(intent) =>
              onChange({ visualIntent: intent as StoryboardBeat["visualIntent"] })
            }
            options={intentOptions}
          />


          {beat.teachingState && <div data-teaching-state-editor="" className="sp-field">
            <p className="sp-label">{t.teachingStateLabel} · {beat.teachingState.subjectId} · {beat.teachingState.phase}</p>
            <p className="sp-hint">{t.teachingStateHint}</p>
            {(["before","action","after"] as const).map(key=><TextAreaField key={key}
              label={key==="before"?t.teachingStateBefore:key==="action"?t.teachingStateAction:t.teachingStateAfter}
              value={beat.teachingState![key]} rows={2}
              maxLength={key==="action"?90:48}
              onChange={text=>onChange({teachingState:{...beat.teachingState!,[key]:text}})}/>) }
          </div>}

          {beat.teachingMechanic && <div data-semantic-mechanic-editor="" className="sp-field">
            <p className="sp-label">{t.mechanicLabel} · {beat.teachingMechanic.mechanic.subjectId}</p>
            <p className="sp-hint">{t.mechanicHint}</p>
            <SelectField label={t.mechanicOperator} value={beat.teachingMechanic.mechanic.operator}
              options={VISUAL_OPERATORS.map(x=>({value:x,label:x}))}
              onChange={value=>onChange({teachingMechanic:{...beat.teachingMechanic!,mechanic:{
                ...beat.teachingMechanic!.mechanic,operator:value as VisualMechanicV1["operator"]}}})}/>
            {beat.teachingMechanic.mechanic.actors.map((actor,index)=><details key={actor.id} data-semantic-actor-editor={actor.id} className="sp-field">
              <summary className="sp-label">{actor.label||actor.id} · {actor.id}</summary>
              <TextAreaField label={`${t.mechanicActor}: ${actor.id}`} value={actor.label} rows={1} maxLength={42}
                onChange={label=>onChange({teachingMechanic:{...beat.teachingMechanic!,mechanic:{
                  ...beat.teachingMechanic!.mechanic,actors:beat.teachingMechanic!.mechanic.actors.map((a,i)=>i===index?{...a,label}:a)}}})}/>
              <SelectField label={t.mechanicRole} value={actor.role}
                options={["subject","part","source","destination","result"].map(value=>({value,label:value}))}
                onChange={role=>onChange({teachingMechanic:{...beat.teachingMechanic!,mechanic:{
                  ...beat.teachingMechanic!.mechanic,actors:beat.teachingMechanic!.mechanic.actors.map((a,i)=>i===index?{
                    ...a,role:role as typeof a.role}:a)}}})}/>
              <CheckGroup legend={t.mechanicClaims}
                options={board.claims.map(claim=>({id:claim.id,label:`${claim.id}: ${claim.note.slice(0,45)}`}))}
                selected={actor.claimIds}
                onToggle={(id,checked)=>onChange({teachingMechanic:{...beat.teachingMechanic!,mechanic:{
                  ...beat.teachingMechanic!.mechanic,actors:beat.teachingMechanic!.mechanic.actors.map((a,i)=>i===index?{
                    ...a,claimIds:checked?[...a.claimIds,id]:a.claimIds.filter(c=>c!==id)}:a)}}})}/>
            </details>)}
            <CheckGroup legend={t.mechanicOperands}
              options={beat.teachingMechanic.mechanic.actors.map(x=>({id:x.id,label:x.label||x.id}))}
              selected={beat.teachingMechanic.mechanic.operands}
              onToggle={(id,checked)=>onChange({teachingMechanic:{...beat.teachingMechanic!,mechanic:{
                ...beat.teachingMechanic!.mechanic,operands:checked
                  ?[...beat.teachingMechanic!.mechanic.operands,id]
                  :beat.teachingMechanic!.mechanic.operands.filter(x=>x!==id)}}})}/>
            <SelectField label={t.mechanicOutcome} value={beat.teachingMechanic.mechanic.outcomeId}
              options={beat.teachingMechanic.mechanic.actors.map(x=>({value:x.id,label:x.label||x.id}))}
              onChange={outcomeId=>onChange({teachingMechanic:{...beat.teachingMechanic!,mechanic:{
                ...beat.teachingMechanic!.mechanic,outcomeId}}})}/>
          </div>}

          <CheckGroup
            legend={t.objectsLabel}
            options={board.semanticObjects}
            selected={beat.semanticObjects}
            onToggle={(id, checked) =>
              onChange({ semanticObjects: toggle(beat.semanticObjects, id, checked) })
            }
          />
          <p className="sp-hint">{t.objectsHint}</p>

          <div className="sp-field">
            <label htmlFor="sp-focus-target" className="sp-label">
              {t.focusLabel}
            </label>
            <select
              id="sp-focus-target"
              className="sp-select"
              value={beat.focusTarget}
              onChange={(event) => onChange({ focusTarget: event.target.value })}
            >
              <option value="">{t.noneOption}</option>
              {focusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <Field
            label={t.cameraLabel}
            hint={t.cameraHint}
            value={beat.cameraIntent ?? ""}
            onChange={(event) => onChange({ cameraIntent: event.target.value })}
          />

          <CheckGroup
            legend={t.eventsLabel}
            options={board.semanticEvents.map((event) => ({
              id: event.id,
              label: `${event.label} → ${event.objectId}`,
            }))}
            selected={beat.namedEvents}
            onToggle={(id, checked) =>
              onChange({ namedEvents: toggle(beat.namedEvents, id, checked) })
            }
          />
        </fieldset>

        <fieldset className="sp-section">
          <legend>{t.copySection}</legend>

          <CheckGroup
            legend={t.claimsLabel}
            options={board.claims.map((claim) => ({
              id: claim.id,
              label: `${claim.id} · ${t.statuses[claim.status]}`,
            }))}
            selected={beat.claimRefs}
            onToggle={(id, checked) =>
              onChange({ claimRefs: toggle(beat.claimRefs, id, checked) })
            }
          />

          <Field
            label={t.cueLabel}
            hint={t.cueHint}
            value={beat.narrationCueId ?? ""}
            onChange={(event) => onChange({ narrationCueId: event.target.value })}
          />
        </fieldset>

        <fieldset className="sp-section">
          <legend>{t.structureSection}</legend>
          <div className="sp-field-pair">
            <div className="sp-field">
              <label htmlFor="sp-opens-question" className="sp-label">
                {t.opensLabel}
              </label>
              <select
                id="sp-opens-question"
                className="sp-select"
                value={beat.opensQuestion ?? ""}
                onChange={(event) => onChange({ opensQuestion: event.target.value })}
              >
                <option value="">{t.noneOption}</option>
                {board.questions.map((question) => (
                  <option key={question.id} value={question.id}>
                    {question.text}
                  </option>
                ))}
              </select>
            </div>
            <div className="sp-field">
              <label htmlFor="sp-answers-question" className="sp-label">
                {t.answersLabel}
              </label>
              <select
                id="sp-answers-question"
                className="sp-select"
                value={beat.answersQuestion ?? ""}
                onChange={(event) => onChange({ answersQuestion: event.target.value })}
              >
                <option value="">{t.noneOption}</option>
                {board.questions.map((question) => (
                  <option key={question.id} value={question.id}>
                    {question.text}
                  </option>
                ))}
              </select>
            </div>
          </div>


          <TextAreaField
            label={t.staticFallbackLabel}
            value={beat.staticFallback}
            onChange={(staticFallback) => onChange({ staticFallback })}
            hint={t.staticFallbackHint}
            rows={2}
          />
        </fieldset>
        </>}
      </div>

      <div className="sp-claim-summary">
        <h3>{t.claimsLabel}</h3>
        <ul>
          {board.claims.map((claim) => (
            <li key={claim.id} data-status={claim.status}>
              <span className="sp-claim-id">{claim.id}</span>
              <span className="sp-claim-status">{t.statuses[claim.status]}</span>
              {claim.note && <span className="sp-claim-note">{claim.note}</span>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
