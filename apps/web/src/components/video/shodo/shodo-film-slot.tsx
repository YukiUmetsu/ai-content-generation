import { useMemo } from "react";
import type { ReactNode } from "react";
import { SHODO_GLYPHS } from "./shodo-glyphs";
import type { ShodoGlyph } from "./shodo-glyphs";
import { planShodoWriting } from "./shodo-hand";
import { kenteiSheet } from "./shodo-paper";
import { ShodoCanvas } from "./shodo-react";
import { SHODO_INKS, assertShodoStyle, resolveShodoStyle } from "./shodo-style";
import type { DeepPartial, ShodoStyle } from "./shodo-style";

type SlotContent = { slot: string; label: string; props?: Readonly<Record<string, unknown>> };
type SlotContext = { frame: number; durationFrames: number; width: number; height: number; reducedMotion: boolean };

export interface ShodoSlotProps {
  /** Characters to write, top to bottom (one column). Bundled glyphs, or `glyphs` for others. */
  text: string;
  /** Extra glyphs by character, for example parsed KanjiVG data (credit KanjiVG in the film). */
  glyphs?: Readonly<Record<string, ShodoGlyph>>;
  style?: DeepPartial<ShodoStyle>;
  /** Frame of the writing at the start of this shot, so a long writing can span cuts. */
  startFrame?: number;
  /** "kentei" prints the faint vermilion grid; "plain" is bare paper. */
  sheet?: "kentei" | "plain";
  /** 1-based stroke numbers (across the whole text) written with vermilion 朱墨. */
  vermilionStrokes?: readonly number[];
  /** Stroke-order guide: "current" and "all" mark the vermilion strokes; "numbers" numbers every stroke. */
  orderGuide?: "none" | "current" | "all" | "numbers";
  showBrush?: boolean;
}

function ShodoShot({ props, context, label }: { props: ShodoSlotProps; context: SlotContext; label: string }) {
  const { width, height } = context;
  const chars = [...props.text].filter(c => c.trim());
  const style = useMemo(() => {
    const s = resolveShodoStyle(props.style ?? {});
    assertShodoStyle(s);
    return s;
  }, [props.style]);
  const paper = useMemo(() => {
    // A hanshi sheet (242 × 333) as tall as the frame allows, centred.
    const ph = Math.round(height * .92), pw = Math.min(width * .92, Math.round(ph * 242 / 333));
    return { x: Math.round((width - pw) / 2), y: Math.round((height - ph) / 2), width: pw, height: ph };
  }, [width, height]);
  const plan = useMemo(() => {
    const glyphs = chars.map(c => props.glyphs?.[c] ?? SHODO_GLYPHS[c]);
    const missing = chars.filter((_, i) => !glyphs[i]);
    if (missing.length) throw new RangeError(`shodo-writing has no glyph for ${missing.join("")}; pass it in props.glyphs`);
    const size = Math.min(paper.width * .86, (paper.height * .9) / chars.length);
    let order = 0;
    const vermilion = new Set(props.vermilionStrokes ?? []);
    return planShodoWriting({
      style, exit: "hover",
      items: glyphs.map((glyph, i) => {
        const strokeInk: Record<number, typeof SHODO_INKS.shuboku> = {};
        glyph!.strokes.forEach((_, k) => { if (vermilion.has(++order)) strokeInk[k] = SHODO_INKS.shuboku; });
        return { glyph: glyph!, size, x: paper.x + (paper.width - size) / 2, y: paper.y + (paper.height - size * chars.length) / 2 + i * size, strokeInk };
      }),
      rest: [paper.x + paper.width + width * .06, paper.y + paper.height * .7], inkstone: [width + width * .1, height * .3],
    });
  }, [chars.join(""), props.glyphs, props.vermilionStrokes, style, paper, width]); // eslint-disable-line react-hooks/exhaustive-deps
  const sheet = useMemo(() => props.sheet === "plain" ? null : kenteiSheet(paper.width, paper.height, 1, chars.length), [props.sheet, paper, chars.length]);
  return <ShodoCanvas plan={plan} frame={(props.startFrame ?? 0) + context.frame} width={width} height={height} paper={paper}
    sheet={sheet} orderGuide={props.orderGuide ?? "none"} guideStrokes={props.orderGuide === "numbers" ? undefined : props.vermilionStrokes}
    showBrush={props.showBrush ?? true} reducedMotion={context.reducedMotion} label={label} />;
}

/** Frames a `shodo-writing` shot needs for the whole writing at `fps` (layout does not change timing). */
export function shodoWritingFrames(text: string, style: DeepPartial<ShodoStyle> = {}, fps = 30, glyphs?: Readonly<Record<string, ShodoGlyph>>): number {
  const chars = [...text].filter(c => c.trim());
  const plan = planShodoWriting({
    style: resolveShodoStyle(style), exit: "hover",
    items: chars.map((c, i) => {
      const glyph = glyphs?.[c] ?? SHODO_GLYPHS[c];
      if (!glyph) throw new RangeError(`No glyph for ${c}`);
      return { glyph, x: 0, y: i * 600, size: 600 };
    }),
  });
  return Math.ceil(plan.duration * fps);
}

/**
 * FilmStage slot for SHO1 calligraphy:
 * - `shodo-writing` `{ text, style?, startFrame?, sheet?, vermilionStrokes?, orderGuide?, showBrush?, glyphs? }`
 *   writes the text with the brush on hanshi. The writing time comes from the hand's speed;
 *   give the shot enough frames (use `planShodoWriting(...).duration`).
 * Returns undefined for any other slot so hosts can chain renderers.
 */
export function renderShodoSlot(content: SlotContent, context: SlotContext): ReactNode | undefined {
  if (content.slot !== "shodo-writing") return undefined;
  const props = (content.props ?? {}) as unknown as ShodoSlotProps;
  if (typeof props.text !== "string" || ![...props.text].some(c => c.trim()))
    throw new RangeError("shodo-writing needs a non-empty text");
  if (props.startFrame !== undefined && (!Number.isSafeInteger(props.startFrame) || props.startFrame < 0))
    throw new RangeError("shodo-writing startFrame must be a nonnegative integer");
  return <ShodoShot props={props} context={context} label={content.label} />;
}
