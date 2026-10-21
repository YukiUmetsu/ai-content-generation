import { useEffect, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";

function joinClasses(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

type DialogSize = "sm" | "md" | "lg";
type DialogPlacement = "top" | "center" | "bottom";

export interface DialogProps {
  /** Controlled open state. */
  open?: boolean;
  /** Initial open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Called whenever the open state changes (close button, Escape, outside click). */
  onOpenChange?: (open: boolean) => void;
  /** Convenience callback fired only when the dialog closes. */
  onClose?: () => void;
  /** Accessible dialog title (also the label). */
  title?: ReactNode;
  /** Optional accessible description. */
  description?: ReactNode;
  /** Dialog body content. */
  children?: ReactNode;
  /** Panel width preset. */
  size?: DialogSize;
  /** Vertical alignment within the viewport. */
  placement?: DialogPlacement;
  /**
   * Modal by default: focus is trapped, page scroll is locked and pointer
   * interactions outside are disabled. Pass `false` for a non-modal dialog
   * (no trap, no scroll lock); the popup then omits `aria-modal`.
   */
  modal?: boolean;
  /** Extra classes for the dialog panel. */
  className?: string;
  /** Accessible label for the built-in close button. */
  closeLabel?: string;
}

const sizeClasses: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
};

const placementClasses: Record<DialogPlacement, string> = {
  top: "items-start",
  center: "items-center",
  bottom: "items-end",
};

const MotionBackdrop = motion.create(DialogPrimitive.Backdrop);

/**
 * Modal dialog built on Base UI's Dialog primitive.
 *
 * Provides a focus trap, initial/return focus management, Escape and
 * outside-click dismissal, scroll lock and portal rendering. Content longer
 * than the viewport scrolls inside the overlay rather than being clipped.
 * All colors come from semantic tokens.
 *
 * The panel enters and exits with a spring-driven fade + subtle scale. The
 * animation is wrapped in `AnimatePresence` and disabled under
 * `prefers-reduced-motion: reduce` so the dialog remains fully usable.
 */
export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  onClose,
  title,
  description,
  children,
  size = "md",
  placement = "center",
  modal = true,
  className,
  closeLabel = "Close",
}: DialogProps) {
  const reducedMotion = useReducedMotion();
  const [innerOpen, setInnerOpen] = useState(open ?? defaultOpen ?? false);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : innerOpen;

  useEffect(() => {
    if (isControlled) setInnerOpen(open);
  }, [isControlled, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!isControlled) setInnerOpen(nextOpen);
    onOpenChange?.(nextOpen);
    if (!nextOpen) onClose?.();
  }

  const panelTransition: Transition = reducedMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 350, damping: 28 };

  return (
    <DialogPrimitive.Root
      open={isOpen}
      defaultOpen={!isControlled ? defaultOpen : undefined}
      onOpenChange={handleOpenChange}
      modal={modal}
    >
      <AnimatePresence>
        {isOpen && (
          <DialogPrimitive.Portal key="dialog-portal">
            <MotionBackdrop
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reducedMotion ? { duration: 0 } : { duration: 0.2 }}
              className="fixed inset-0 z-50 bg-overlay"
            />
            <DialogPrimitive.Popup
              data-km-dialog=""
              aria-modal={modal ? true : undefined}
              className={joinClasses(
                "fixed inset-0 z-50 flex justify-center overflow-y-auto p-4",
                placementClasses[placement]
              )}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={panelTransition}
                className={joinClasses(
                  "relative m-auto w-full rounded-surface border border-border bg-surface-elevated p-6 text-foreground shadow",
                  "focus:outline-none",
                  sizeClasses[size],
                  className
                )}
              >
                {title != null && title !== "" ? (
                  <DialogPrimitive.Title className="font-serif text-2xl font-normal tracking-subheading text-foreground">
                    {title}
                  </DialogPrimitive.Title>
                ) : null}
                {description != null && description !== "" ? (
                  <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                    {description}
                  </DialogPrimitive.Description>
                ) : null}
                <div className="mt-4">{children}</div>
                <DialogPrimitive.Close
                  aria-label={closeLabel}
                  className={joinClasses(
                    "absolute end-4 top-4 inline-flex size-8 items-center justify-center rounded-control text-muted-foreground",
                    "transition-colors duration-[var(--km-duration-short)]",
                    "hover:bg-surface-subtle active:bg-surface-inset",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-elevated"
                  )}
                >
                  <span aria-hidden="true" className="text-lg leading-none">
                    ×
                  </span>
                </DialogPrimitive.Close>
              </motion.div>
            </DialogPrimitive.Popup>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}

export default Dialog;
