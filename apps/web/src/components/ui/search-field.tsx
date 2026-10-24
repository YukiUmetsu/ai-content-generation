import { forwardRef, useCallback, useId, useRef } from "react";
import type { InputHTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { Button } from "./button";
import { Input } from "./field-input";

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

function SearchGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="10.75" cy="10.75" r="6.75" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

function ClearGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function LoadingGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="size-5 animate-spin motion-reduce:animate-none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="8" opacity="0.3" />
      <path d="M12 4a8 8 0 0 1 8 8" />
    </svg>
  );
}

export interface SearchFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "children"> {
  /** Search query owned by the consumer. */
  query: string;
  /** Called on every edit, clear button activation, or Escape-to-clear. */
  onQueryChange: (next: string) => void;
  /** Optional explicit search; Enter and the submit button call this with the current query. */
  onSearch?: (query: string) => void;
  /** Called after the query is cleared by the built-in clear control or Escape. */
  onClear?: () => void;
  /** Visible label. @default "Search" */
  label?: ReactNode;
  /** Text displayed under the field; always wired to `aria-describedby`. */
  description?: ReactNode;
  /** Assistive hint, replaced by an error while invalid. */
  hint?: ReactNode;
  /** Actionable error, announced through an alert and `aria-invalid`. */
  error?: ReactNode;
  /** An in-flight request; prevent duplicate submissions but keep text editable. @default false */
  loading?: boolean;
  /** Show an explicit submit button when `onSearch` is supplied. @default false */
  showSubmit?: boolean;
  /** Label for the optional submit button. @default "Search" */
  submitLabel?: string;
  /** Consumer-owned filter trigger or controls, placed beside the search input. */
  filterAction?: ReactNode;
  /** Extra classes on the outer field container. */
  containerClassName?: string;
}

/**
 * Search input for toolbar and form compositions. It owns no filtering,
 * debouncing, routing or requests. Native searchbox, label, feedback and
 * focus semantics remain usable without a form wrapper.
 */
const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    query,
    onQueryChange,
    onSearch,
    onClear,
    label = "Search",
    description,
    hint,
    error,
    loading = false,
    showSubmit = false,
    submitLabel = "Search",
    filterAction,
    containerClassName,
    className,
    id,
    disabled,
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedBy,
    autoComplete = "off",
    ...props
  },
  forwardedRef
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = `${inputId}-description`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposing = useRef(false);
  const hasError = error != null && error !== "";
  const hasDescription = description != null && description !== "";
  const showHint = !hasError && hint != null && hint !== "";
  const canSearch = !disabled && !loading && query.trim().length > 0;

  const assignRef = useCallback(
    (input: HTMLInputElement | null) => {
      inputRef.current = input;
      if (typeof forwardedRef === "function") forwardedRef(input);
      else if (forwardedRef) forwardedRef.current = input;
    },
    [forwardedRef]
  );

  const clear = () => {
    if (disabled || !query) return;
    onQueryChange("");
    onClear?.();
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled || isComposing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Escape" && query) {
      event.preventDefault();
      clear();
    } else if (event.key === "Enter" && onSearch) {
      event.preventDefault();
      if (canSearch) onSearch(query);
    }
  };

  const describedBy = [
    ariaDescribedBy,
    hasDescription ? descriptionId : undefined,
    hasError ? errorId : showHint ? hintId : undefined,
  ].filter(Boolean).join(" ");

  return (
    <div
      data-km-search-field=""
      data-loading={loading ? "" : undefined}
      className={joinClasses("flex w-full min-w-0 flex-col gap-2 text-foreground", containerClassName)}
    >
      {label != null && label !== "" ? (
        <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}</label>
      ) : null}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted-foreground" aria-hidden="true">
            {loading ? <LoadingGlyph /> : <SearchGlyph />}
          </span>
          <Input
            {...props}
            ref={assignRef}
            id={inputId}
            type="search"
            autoComplete={autoComplete}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={(event) => {
              isComposing.current = true;
              onCompositionStart?.(event);
            }}
            onCompositionEnd={(event) => {
              isComposing.current = false;
              onCompositionEnd?.(event);
            }}
            disabled={disabled}
            aria-label={label == null || label === "" ? props["aria-label"] ?? "Search" : props["aria-label"]}
            aria-invalid={ariaInvalid ?? (hasError || undefined)}
            aria-describedby={describedBy || undefined}
            aria-busy={loading || undefined}
            className={joinClasses(
              "min-w-0 ps-11 pe-12 [&::-webkit-search-cancel-button]:hidden",
              className
            )}
          />
          {query.length > 0 && !disabled ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clear}
              className={joinClasses(
                "absolute inset-y-0 right-2 my-auto inline-flex size-8 shrink-0 items-center justify-center rounded-control",
                "text-muted-foreground transition-colors duration-[var(--km-duration-short)] ease-continuity",
                "hover:bg-surface-subtle hover:text-foreground active:bg-surface-inset",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              )}
            >
              <ClearGlyph />
            </button>
          ) : null}
        </div>
        {showSubmit && onSearch ? (
          <Button type="button" variant="primary" onClick={() => { if (canSearch) onSearch(query); }} disabled={!canSearch} isLoading={loading}>
            {submitLabel}
          </Button>
        ) : null}
        {filterAction != null ? <div className="flex min-w-0 items-center">{filterAction}</div> : null}
      </div>
      {hasDescription ? <p id={descriptionId} className="text-sm text-muted-foreground">{description}</p> : null}
      {hasError ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">{error}</p>
      ) : showHint ? (
        <p id={hintId} className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">{loading ? "Searching…" : ""}</span>
    </div>
  );
});

SearchField.displayName = "SearchField";

export { SearchField };
export default SearchField;
