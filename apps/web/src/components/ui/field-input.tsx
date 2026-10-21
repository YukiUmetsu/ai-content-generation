import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

const inputBaseClasses = [
  "flex rounded-control border border-input bg-field px-[var(--km-control-space-x)]",
  "h-[var(--km-control-height)] text-base text-foreground",
  "placeholder:text-muted-foreground",
  "transition-colors duration-[var(--km-duration-short)] ease-continuity",
  // Hover strengthens the boundary, but only for an enabled, valid field so a
  // disabled or invalid field keeps its own state unambiguously.
  "not-disabled:not-aria-[invalid=true]:hover:border-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
  "disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-muted-foreground disabled:border-border-subtle",
  // A coordinated error ring keeps invalid from being carried by the hairline alone.
  "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-danger/30",
  // ...and yields to the focus ring while focused so focus stays legible.
  "aria-[invalid=true]:focus-visible:ring-ring",
].join(" ");

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Extra classes for the `<input>` element. */
  className?: string;
  /**
   * Size the control to its content instead of filling the container, using the
   * native `field-sizing: content` behaviour where the browser supports it.
   * @default false
   */
  autoResize?: boolean;
}

/**
 * Bare text input for use inside a custom layout. Preserves native
 * `<input>` semantics and behaviour; the consumer owns the label and accessible
 * name (`aria-label`/`aria-labelledby`).
 */
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, autoResize = false, ...props },
  ref
) {
  return (
    <input
      ref={ref}
      className={joinClasses(
        inputBaseClasses,
        autoResize ? "w-auto max-w-full [field-sizing:content]" : "w-full",
        className
      )}
      {...props}
    />
  );
});

Input.displayName = "Input";

export interface FieldProps extends InputProps {
  /** Visible label, associated with the input through `htmlFor`/`id`. */
  label?: ReactNode;
  /** Supporting text, shown only while there is no error. */
  hint?: ReactNode;
  /** Validation message; replaces the hint and marks the field invalid. */
  error?: ReactNode;
  /**
   * Persistent descriptive text (for example a format rule). Always associated
   * with the input through `aria-describedby`, even while an error is shown.
   */
  description?: ReactNode;
  /** Extra classes for the wrapping element. */
  containerClassName?: string;
}

/**
 * Text input with an associated label, hint, persistent description and an
 * actionable error. `htmlFor`/`id`, `aria-describedby` and `aria-invalid` are
 * wired automatically; the error carries `role="alert"` so it is announced.
 */
const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, description, containerClassName, className, id, autoResize, ...props },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const descriptionId = `${inputId}-description`;

  const hasError = error != null && error !== "";
  const hasHint = hint != null && hint !== "";
  const hasDescription = description != null && description !== "";
  const showHint = hasHint && !hasError;

  // The error wins over the hint so a stale hint is never read with a failure,
  // while a persistent description stays associated in every state. A consumer
  // supplied id always headlines the description list.
  const describedBy = [
    props["aria-describedby"],
    hasDescription ? descriptionId : undefined,
    showHint ? hintId : hasError ? errorId : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  const invalid = props["aria-invalid"] ?? (hasError || undefined);

  return (
    <div className={joinClasses("flex flex-col gap-2", containerClassName)}>
      {label != null && label !== "" ? (
        <label
          htmlFor={inputId}
          className="mb-2 text-sm font-medium text-foreground"
        >
          {label}
        </label>
      ) : null}
      <Input
        {...props}
        ref={ref}
        id={inputId}
        autoResize={autoResize}
        aria-invalid={invalid}
        aria-describedby={describedBy || undefined}
        className={className}
      />
      {hasDescription ? (
        <p id={descriptionId} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : showHint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

Field.displayName = "Field";

export { Input, Field };
export default Field;
