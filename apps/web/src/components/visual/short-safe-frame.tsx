import { createContext, forwardRef, useContext, useEffect, useMemo, useRef } from "react";
import type { CSSProperties, ComponentPropsWithoutRef, ReactNode } from "react";
import type { Rect } from "../motion/types";
import { inspectSafeFrame, safeFrameContentRect, safeFrameOrientation, safeFrameTextConstraints } from "./safe-frame";
import type { ReservedRegion, SafeFrameInspection, SafeFrameItem, SafeFrameProfile } from "./safe-frame";

export interface ShortSafeFrameContext {
  profile: SafeFrameProfile;
  orientation: "portrait" | "landscape" | "square";
  /** Normalized area left after edge-anchored reserved regions. */
  contentRect: Rect;
  /** Ready to spread into `ExplainerStage` or `placeProtectedText`. */
  text: { safeRegion: Rect; avoidRegions: Rect[] };
}
const SafeFrameContext = createContext<ShortSafeFrameContext | null>(null);
/** The enclosing frame's profile and safe areas, or null outside `ShortSafeFrame`. */
export function useOptionalShortSafeFrame(): ShortSafeFrameContext | null {
  return useContext(SafeFrameContext);
}
/** The enclosing frame's profile and safe areas; throws outside `ShortSafeFrame`. */
export function useShortSafeFrame(): ShortSafeFrameContext {
  const value = useContext(SafeFrameContext);
  if (!value) throw new Error("useShortSafeFrame must be used inside <ShortSafeFrame>.");
  return value;
}

export interface ShortSafeFrameProps extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  profile: SafeFrameProfile;
  /** Measured layout to check against the profile (normalized output rects). */
  items?: readonly SafeFrameItem[];
  /** Authoring overlay: reserved regions, simulated app UI, content area and item status. Never exported. */
  guides?: boolean;
  onInspect?: (inspection: SafeFrameInspection) => void;
  children?: ReactNode | ((frame: ShortSafeFrameContext) => ReactNode);
}

const pct = (r: Rect): CSSProperties => ({ position: "absolute", left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.width * 100}%`, height: `${r.height * 100}%` });
const ui = "var(--km-safe-frame-ui, rgba(255, 255, 255, 0.86))";
const chip: CSSProperties = {
  position: "absolute", padding: "4px 8px", borderRadius: 6, whiteSpace: "nowrap",
  font: "500 12px/1.3 var(--km-font-body, system-ui, sans-serif)",
  background: "var(--km-safe-frame-chip, rgba(15, 23, 42, 0.86))", color: "var(--km-safe-frame-chip-ink, #f8fafc)",
};
const STATUS_COLOR = { ok: "var(--km-status-success, #15803d)", warning: "var(--km-status-warning, #b45309)", error: "var(--km-status-danger, #b91c1c)" };

/** Generic stand-ins for app chrome so authors see what will cover the frame. No platform branding. */
function SimulatedUI({ region, portrait }: { region: ReservedRegion; portrait: boolean }) {
  const shadow = "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45))";
  switch (region.appearance) {
    case "actions":
      return <div style={{ position: "absolute", inset: "auto 0 6% 0", display: "flex", flexDirection: "column", alignItems: "center", gap: portrait ? "3.2%" : "6%", filter: shadow, height: portrait ? "48%" : "70%", justifyContent: "flex-end" }}>
        {[0, 1, 2, 3].map(i => <div key={i} style={{ display: "grid", justifyItems: "center", gap: 4, width: "100%" }}>
          <span style={{ width: "46%", aspectRatio: "1", borderRadius: "50%", background: ui }} />
          <span style={{ width: "26%", height: 5, borderRadius: 3, background: ui, opacity: 0.8 }} />
        </div>)}
      </div>;
    case "description":
      // Sized in % of the region so thin landscape bands stay inside their bounds.
      return <div style={{ position: "absolute", left: "8%", right: portrait ? "18%" : "40%", top: "18%", bottom: "16%", display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: "9%", filter: shadow }}>
        <div style={{ display: "flex", alignItems: "center", gap: "3%", height: "26%" }}>
          <span style={{ height: "100%", aspectRatio: "1", borderRadius: "50%", background: ui }} />
          <span style={{ width: "34%", height: "50%", borderRadius: 99, background: ui }} />
        </div>
        <span style={{ width: "92%", height: "13%", borderRadius: 99, background: ui, opacity: 0.75 }} />
        <span style={{ width: "64%", height: "13%", borderRadius: 99, background: ui, opacity: 0.75 }} />
      </div>;
    case "header":
      return <div style={{ position: "absolute", inset: "30% 8% auto", display: "flex", justifyContent: "center", gap: "4%", filter: shadow }}>
        <span style={{ width: portrait ? "16%" : "7%", height: 10, borderRadius: 5, background: ui }} />
        <span style={{ width: portrait ? "16%" : "7%", height: 10, borderRadius: 5, background: ui, opacity: 0.6 }} />
      </div>;
    case "progress":
      return <span style={{ position: "absolute", left: "4%", right: "4%", top: "50%", height: 4, borderRadius: 2, background: ui, opacity: 0.8 }} />;
    default:
      return null;
  }
}

/** Fixed-aspect output frame with per-profile reserved regions and measured-layout checks.
 * Preview width is responsive (100%); set an explicit px width for capture. The frame is an
 * inline-size query container, so children can size type in `cqw` relative to the output.
 */
export const ShortSafeFrame = forwardRef<HTMLDivElement, ShortSafeFrameProps>(function ShortSafeFrame(
  { profile, items, guides = false, onInspect, children, style, ...props }, ref,
) {
  const value = useMemo<ShortSafeFrameContext>(() => ({
    profile, orientation: safeFrameOrientation(profile), contentRect: safeFrameContentRect(profile), text: safeFrameTextConstraints(profile),
  }), [profile]);
  const inspection = useMemo(() => items ? inspectSafeFrame(profile, items) : undefined, [profile, items]);
  const callback = useRef(onInspect);
  callback.current = onInspect;
  const latest = useRef(inspection);
  latest.current = inspection;
  // Notify by value: callers commonly rebuild `items` on every render.
  const signature = inspection ? JSON.stringify(inspection) : "";
  useEffect(() => { if (latest.current) callback.current?.(latest.current); }, [signature]);
  const status = !inspection ? "unchecked" : !inspection.ok ? "error" : inspection.diagnostics.length ? "warning" : "ok";
  const portrait = value.orientation === "portrait";
  // Amber "caution" stripes read on both dark and light scene art.
  const hatch = "repeating-linear-gradient(135deg, var(--km-safe-frame-reserved, rgba(245, 158, 11, 0.24)) 0 8px, transparent 8px 16px)";
  return <SafeFrameContext.Provider value={value}>
    <div {...props} ref={ref} data-km-safe-frame="" data-profile={profile.id} data-orientation={value.orientation}
      data-safe-frame-status={status}
      style={{ position: "relative", overflow: "hidden", width: "100%", aspectRatio: `${profile.width} / ${profile.height}`, containerType: "inline-size", ...style }}>
      {typeof children === "function" ? children(value) : children}
      {guides ? <div data-km-safe-frame-guides="" data-km-exportable="false" aria-hidden="true"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div data-safe-frame-content="" style={{ ...pct(value.contentRect), outline: "2px dashed var(--km-status-info, #2563eb)", outlineOffset: -2 }} />
        {profile.reserved.map(region => <div key={region.id} data-reserved={region.id}
          style={{ ...pct(region.rect), overflow: "hidden", backgroundImage: hatch, boxShadow: "inset 0 0 0 1px var(--km-safe-frame-reserved-edge, rgba(245, 158, 11, 0.7))" }}>
          <SimulatedUI region={region} portrait={portrait} />
        </div>)}
        {profile.reserved.filter(r => r.label).map(region => <span key={`label-${region.id}`}
          style={{ ...chip, top: `calc(${region.rect.y * 100}% + 6px)`, ...(region.rect.x + region.rect.width / 2 > 0.5
            ? { right: `calc(${(1 - region.rect.x - region.rect.width) * 100}% + 6px)` } : { left: `calc(${region.rect.x * 100}% + 6px)` }) }}>{region.label}</span>)}
        {items?.map(item => {
          const itemStatus = inspection?.status[item.id] ?? "ok";
          return <div key={item.id} data-safe-frame-item={item.id} data-status={itemStatus}
            style={{ ...pct(item.rect), outline: `2px ${item.kind === "text" ? "solid" : "dashed"} ${STATUS_COLOR[itemStatus]}`, outlineOffset: 2 }}>
            <span style={{ ...chip, left: 0, bottom: "calc(100% + 6px)", background: STATUS_COLOR[itemStatus], color: "#fff" }}>{item.id}</span>
          </div>;
        })}
      </div> : null}
    </div>
  </SafeFrameContext.Provider>;
});
