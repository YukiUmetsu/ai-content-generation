import { forwardRef } from "react";
import type { ForwardedRef, HTMLAttributes, ReactNode } from "react";

/** Visual treatment of a surface. */
export type SurfaceVariant = "solid" | "outline" | "ghost";

const variantClasses: Record<SurfaceVariant, string> = {
  solid: "border-border bg-surface",
  outline: "border-border bg-transparent",
  ghost: "border-transparent bg-transparent",
};

/**
 * Hover/press affordance layered on top of a variant while `interactive` is on.
 * The signal is never color alone: the border strengthens and the surface
 * responds with a small scale nudge on press.
 */
const interactiveVariantClasses: Record<SurfaceVariant, string> = {
  solid: "hover:border-input hover:shadow active:bg-surface-subtle",
  outline: "hover:border-input hover:bg-surface-subtle hover:shadow active:bg-surface-inset",
  ghost: "hover:bg-surface-subtle hover:shadow active:bg-surface-inset",
};

const BASE_CLASSES = [
  "flex flex-col overflow-hidden rounded-surface border",
  "text-base text-foreground",
  "transition-[color,background-color,border-color,transform] duration-[var(--km-duration-short)] ease-continuity",
].join(" ");

const INTERACTIVE_CLASSES = [
  "cursor-pointer text-start active:scale-[0.985]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
].join(" ");

const HEADER_CLASSES =
  "flex flex-wrap items-center justify-between gap-2 border-b border-border px-6 py-4";
const BODY_CLASSES = "px-6 py-4";
const FOOTER_CLASSES =
  "flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4";

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  /** Visual treatment. @default "solid" */
  variant?: SurfaceVariant;
  /**
   * Render the whole surface as a single native `<button>` so the entire card
   * becomes one keyboard- and pointer-operable action. Off by default, which
   * renders a plain, non-interactive `<div>`.
   *
   * Use it for a card that is itself a link/action, and keep interactive
   * controls (buttons, links, menus) out of `header`/`footer`/`children` — a
   * surface with nested actions should stay non-interactive and expose its
   * actions normally.
   * @default false
   */
  interactive?: boolean;
  /**
   * Optional top region, separated by a rule. Typically a title with optional
   * trailing actions; it is laid out as a flex row that wraps.
   */
  header?: ReactNode;
  /**
   * Optional bottom region, separated by a rule. Typically the surface's
   * actions; it is laid out as a right-aligned flex row that wraps.
   */
  footer?: ReactNode;
  /** Main content. Rendered in a padded, growing body region. */
  children?: ReactNode;
  /** Extra classes merged onto the root element. */
  className?: string;
}

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

/**
 * Tokenized base surface (card/panel).
 *
 * The one primitive other components and patterns build panels from: it owns
 * the shared chrome — radius, border, surface color, elevation, typography and
 * motion — and nothing else, so it never invents layout a consumer did not ask
 * for. `variant` selects the treatment (`solid`, `outline`, `ghost`), while
 * `header`, `children` and `footer` are optional regions rendered in a single
 * column.
 *
 * With `interactive` the root becomes a native `<button type="button">`, giving
 * honest Enter/Space activation, focus management and a visible focus ring for
 * a whole-surface action. Ref, `className` and arbitrary DOM props are merged
 * onto the root, and all colors, radii and motion come from semantic tokens, so
 * appearance, density and reduced-motion preferences stay centralized.
 */
const Surface = forwardRef<HTMLElement, SurfaceProps>(function Surface(
  { variant = "solid", interactive = false, header, footer, className, children, ...props },
  ref
) {
  const classes = joinClasses(
    BASE_CLASSES,
    variantClasses[variant],
    interactive && INTERACTIVE_CLASSES,
    interactive && interactiveVariantClasses[variant],
    className
  );

  const regions = (
    <>
      {header != null ? (
        <div data-km-surface="header" className={HEADER_CLASSES}>
          {header}
        </div>
      ) : null}
      {children != null ? (
        <div data-km-surface="body" className={BODY_CLASSES}>
          {children}
        </div>
      ) : null}
      {footer != null ? (
        <div data-km-surface="footer" className={FOOTER_CLASSES}>
          {footer}
        </div>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <button
        ref={ref as unknown as ForwardedRef<HTMLButtonElement>}
        type="button"
        data-km-surface="root"
        data-km-interactive="true"
        className={classes}
        {...props}
      >
        {regions}
      </button>
    );
  }

  return (
    <div
      ref={ref as unknown as ForwardedRef<HTMLDivElement>}
      data-km-surface="root"
      className={classes}
      {...props}
    >
      {regions}
    </div>
  );
});

Surface.displayName = "Surface";

export { Surface };
export default Surface;
