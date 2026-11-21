/**
 * Kanji study card (SHO1): the brush writes a character on gridded hanshi, writes it again with
 * vermilion stroke-order numbers, then holds a reading card with the useful words. An optional
 * intro types the character first. Frame-addressed: the host gives the glyph and the frame, so a
 * video export can seek in any order. Planning lives in `shodo-kanji-card-plan.ts`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes, RefObject } from "react";
import type { ShodoGlyph } from "./shodo-glyphs";
import { kenteiSheet } from "./shodo-paper";
import { ShodoCanvas } from "./shodo-react";
import { shodoRgb } from "./shodo-style";
import {
  KANJI_CARD_FPS, KANJI_CARD_JLPT_LEVELS, kanjiCardHasCard, kanjiCardPhaseAt, kanjiCardSafeInset, kanjiCardSections, kanjiCardType, kanjiCardTypedAt,
  kanjiCardWriting,
  spreadWordHighlights, wordHighlightAt,
} from "./shodo-kanji-card-plan";
import type {
  KanjiCardContent, KanjiCardDensity, KanjiCardInk, KanjiCardIntro, KanjiCardLayout, KanjiCardPhase, KanjiCardSafeInset,
  KanjiCardSection, KanjiCardTiming, KanjiWordHighlight, KanjiWordHighlightState,
} from "./shodo-kanji-card-plan";

const KANJI_INK = "#1B1A18", KANJI_MUTED = "#665B51", KANJI_SHU = "#B3301A";
const KANJI_SERIF = "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif";
const KANJI_SANS = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', 'Yu Gothic', system-ui, sans-serif";
const KANJI_DISPLAY = "'Oswald', 'Arial Narrow', system-ui, sans-serif";
const KANJI_CARD_COLUMNS = (n: number) => n <= 3 ? n : n === 4 ? 2 : 3;

/** Mix two #RRGGBB colours, t = 0..1. */
function mixHex(a: string, b: string, t: number): string {
  const ca = shodoRgb(a), cb = shodoRgb(b), u = Math.min(1, Math.max(0, t));
  return `rgb(${ca.map((v, i) => Math.round(v + (cb[i] - v) * u)).join(",")})`;
}

/** The viewer's prefers-reduced-motion setting, kept up to date. False where it cannot be read. */
function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const update = () => setReduce(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduce;
}

/** Keeps the content inside a box of fixed height: text gets smaller (to 60 %) before it is cut. */
function useFitHeight(ref: RefObject<HTMLElement | null>, key: string) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fits = (f: number) => { el.style.setProperty("--km-fit", f.toFixed(3)); return el.scrollHeight <= el.clientHeight + 1; };
    const fit = () => {
      // Shorter lines wrap less, so the size is found by bisection, not by one ratio.
      let f = 1;
      if (!fits(1)) {
        let lo = .6, hi = 1;
        for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
        f = lo;
        fits(f);
      }
      el.dataset.kmFit = f.toFixed(3);
      el.dataset.kmOverflow = String(el.scrollHeight > el.clientHeight + 1);
    };
    fit();
    let live = true;
    document.fonts?.ready.then(() => { if (live) fit(); }).catch(() => undefined);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(el);
    return () => { live = false; observer?.disconnect(); };
  }, [ref, key]);
}

export interface ShodoKanjiInfoCardProps extends KanjiCardContent, Omit<HTMLAttributes<HTMLElement>, "children"> {
  char: string;
  layout?: KanjiCardLayout;
  /** "compact" (9:16 only): the JLPT badge joins the title row and the word tiles are tighter. */
  density?: KanjiCardDensity;
  sections?: Partial<Record<KanjiCardSection, boolean>>;
  /** Opacity of the text, 0..1, for a frame-driven fade-in. The panel itself always shows. */
  reveal?: number;
  /** The highlighted useful word and its strength (from `wordHighlightAt`). */
  highlight?: KanjiWordHighlightState;
  /** Highlight without scale or lift (fade only). Default: false. */
  reducedMotion?: boolean;
}

/**
 * The reading card: meanings, readings, JLPT level and useful words. Sizes are in `cqw` of the
 * nearest size container (the video frame), so the card scales with the frame.
 */
export function ShodoKanjiInfoCard({
  char, meanings, onyomi, kunyomi, jlpt, words, layout = "landscape", density = "regular", sections, reveal = 1, highlight, reducedMotion = false,
  style, vermilionStrokes: _vermilion, ...rest
}: ShodoKanjiInfoCardProps) {
  void _vermilion;
  const ref = useRef<HTMLElement>(null);
  const wide = layout === "portrait";
  const compact = wide && density === "compact";
  const t = kanjiCardType(layout, density), W = wide ? 720 : 1280;
  const cq = (px: number) => `${(px / W * 100).toFixed(3)}cqw`;
  const fs = (px: number) => `calc(${cq(px)} * var(--km-fit, 1))`;
  const show = kanjiCardSections(sections);
  const level = show.jlpt && jlpt && KANJI_CARD_JLPT_LEVELS.includes(jlpt) ? jlpt : null;
  const readings = show.readings && (onyomi || kunyomi);
  const list = show.words && words?.length ? words : null;
  useFitHeight(ref, [char, meanings, onyomi, kunyomi, level, layout, density, JSON.stringify(list), JSON.stringify(show)].join("|"));
  const term: CSSProperties = { font: `700 ${fs(t.reading * .84)}/1.3 ${KANJI_DISPLAY}`, letterSpacing: ".06em", color: KANJI_MUTED };
  // Word highlight: a light vermilion tint and ring, a small lift and scale (transforms only,
  // so nothing around it moves), and the other words dimmed a little. Fade only with reduced motion.
  const active = highlight && highlight.word !== null && list && highlight.word < list.length ? highlight.word : null;
  const S = active === null ? 0 : Math.min(1, Math.max(0, highlight?.strength ?? 0));
  const wordOpacity = (i: number) => i === active ? Math.max(reveal, S) : reveal * (1 - .3 * S);
  const ring = (s: number, width: number) => s > 0
    ? `inset 0 0 0 max(1.5px, ${cq(width)}) rgba(179,48,26,${(.85 * s).toFixed(3)}), 0 ${cq(10 * s)} ${cq(24)} rgba(110,40,20,${(.18 * s).toFixed(3)})`
    : "none";
  const badge = level ? <span data-km-jlpt={level} style={{
    // When long readings push the badge to its own row, it stays at the right.
    marginLeft: "auto", display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", font: `700 ${fs(t.badge)}/1 ${KANJI_DISPLAY}`, letterSpacing: ".06em",
    color: KANJI_SHU, border: `max(1px, ${cq(2)}) solid ${KANJI_SHU}`, borderRadius: ".3em", padding: ".42em .8em", alignSelf: "center",
  }}>JLPT {level}</span> : null;
  const title = show.meanings && meanings;
  return <aside {...rest} ref={ref} aria-label={`${char} readings and words`} data-km-kanji-density={compact ? "compact" : "regular"} style={{
    background: "#FBFAF7", padding: `${cq(t.pad[0])} ${cq(t.pad[1])}`, boxSizing: "border-box", overflow: "hidden", color: KANJI_INK, ...style,
  }}>
    <div style={{ display: "grid", alignContent: "start", gap: fs(t.gap) }}>
      {title || compact && level ? <div style={{
        opacity: reveal, display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: ".3em", rowGap: ".1em",
        font: `700 ${fs(t.head)}/1.12 ${KANJI_DISPLAY}`, borderBottom: "1px solid #C9C3B8", paddingBottom: fs(t.gap * .6),
      }}>
        {title ? <>
          <span lang="ja" style={{ font: `700 ${fs(t.headKanji)}/1 ${KANJI_SERIF}` }}>{char}</span>
          <span aria-hidden="true" style={{ color: "#A39A8E" }}>|</span>
          <span style={{ flex: "1 1 6em", minWidth: 0 }}>{meanings}</span>
        </> : null}
        {compact ? badge : null}
      </div> : null}
      {readings || level && !compact ? <div style={{ opacity: reveal, display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: `${fs(t.gap * .5)} ${fs(t.gap)}` }}>
        {readings && wide ? <dl style={{ margin: 0, display: "flex", flexWrap: "wrap", columnGap: fs(t.gap * 1.6), rowGap: fs(t.gap * .4), font: `600 ${fs(t.reading)}/1.3 system-ui, sans-serif` }}>
          {onyomi ? <div><dt style={term}>ON&apos;YOMI</dt><dd style={{ margin: 0 }}>{onyomi}</dd></div> : null}
          {kunyomi ? <div><dt style={term}>KUN&apos;YOMI</dt><dd style={{ margin: 0 }}>{kunyomi}</dd></div> : null}
        </dl> : readings ? <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto auto", justifyContent: "start", alignItems: "baseline", columnGap: ".7em", rowGap: ".2em", font: `600 ${fs(t.reading)}/1.3 system-ui, sans-serif` }}>
          {onyomi ? <><dt style={term}>ON&apos;YOMI</dt><dd style={{ margin: 0 }}>{onyomi}</dd></> : null}
          {kunyomi ? <><dt style={term}>KUN&apos;YOMI</dt><dd style={{ margin: 0 }}>{kunyomi}</dd></> : null}
        </dl> : null}
        {compact ? null : badge}
      </div> : null}
      {list ? <>
        <div style={{ opacity: reveal, font: `700 ${fs(t.title)}/1 ${KANJI_DISPLAY}`, marginTop: fs(t.gap * .3), letterSpacing: wide ? ".04em" : undefined }}>USEFUL WORDS</div>
        {wide ? <ul role="list" style={{
          margin: 0, padding: 0, listStyle: "none", display: "grid", gap: fs(t.gap * (compact ? .7 : .55)),
          gridTemplateColumns: `repeat(${KANJI_CARD_COLUMNS(list.length)}, minmax(0, 1fr))`,
        }}>
          {list.map((w, i) => {
            const s = i === active ? S : 0;
            return <li key={i} aria-current={s >= .5 ? "true" : undefined} data-km-word-highlight={s > 0 ? s.toFixed(3) : undefined} style={{
              display: "grid", justifyItems: "center", alignContent: "start", textAlign: "center", minWidth: 0,
              background: mixHex("#F3EFE7", "#F9E0D4", s), borderRadius: fs(14), padding: `${fs(t.gap * .7)} ${fs(t.gap * .45)} ${fs(t.gap * .8)}`,
              opacity: wordOpacity(i), position: "relative", zIndex: s > 0 ? 1 : 0, boxShadow: ring(s, 2.5), transformOrigin: "50% 60%",
              transform: s > 0 && !reducedMotion ? `translateY(${cq(-6 * s)}) scale(${(1 + .045 * s).toFixed(4)})` : undefined,
            }}>
              <ruby lang="ja" style={{ font: `600 ${fs(t.word)}/1.08 ${KANJI_SERIF}` }}>{w.word}<rt style={{ font: `600 ${fs(t.ruby)}/1.2 system-ui, sans-serif`, letterSpacing: ".04em", color: KANJI_MUTED }}>{w.ruby}</rt></ruby>
              <span style={{ marginTop: fs(t.gap * .35), font: `600 ${fs(t.gloss)}/1.25 system-ui, sans-serif`, color: mixHex(KANJI_MUTED, KANJI_SHU, s), overflowWrap: "anywhere" }}>{w.romaji}</span>
              <span style={{ font: `500 ${fs(t.gloss)}/1.25 system-ui, sans-serif`, overflowWrap: "anywhere" }}>{w.meaning}</span>
            </li>;
          })}
        </ul> : <ul role="list" style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "auto 1fr", columnGap: fs(t.word * .45), rowGap: fs(t.gap * .75) }}>
          {list.map((w, i) => {
            const s = i === active ? S : 0;
            return <li key={i} aria-current={s >= .5 ? "true" : undefined} data-km-word-highlight={s > 0 ? s.toFixed(3) : undefined} style={{
              display: "grid", gridColumn: "1 / -1", gridTemplateColumns: "subgrid", alignItems: "end",
              opacity: wordOpacity(i), position: "relative", isolation: "isolate", zIndex: s > 0 ? 1 : 0, transformOrigin: "50% 50%",
              transform: s > 0 && !reducedMotion ? `scale(${(1 + .03 * s).toFixed(4)})` : undefined,
            }}>
              {/* The highlight sits behind the row and takes no space, so the list does not move. */}
              <span aria-hidden="true" style={{
                position: "absolute", inset: `${cq(-10)} ${cq(-12)}`, zIndex: -1, borderRadius: cq(14),
                background: `rgba(179,48,26,${(.075 * s).toFixed(3)})`, boxShadow: ring(s, 2),
              }} />
              <ruby lang="ja" style={{ font: `600 ${fs(t.word)}/1.08 ${KANJI_SERIF}` }}>{w.word}<rt style={{ font: `600 ${fs(t.ruby)}/1.2 system-ui, sans-serif`, letterSpacing: ".04em", color: KANJI_MUTED }}>{w.ruby}</rt></ruby>
              <span style={{ display: "grid", font: `500 ${fs(t.gloss)}/1.25 system-ui, sans-serif`, paddingBottom: ".12em", minWidth: 0 }}>
                <span style={{ color: mixHex(KANJI_MUTED, KANJI_SHU, s), fontWeight: 600 }}>{w.romaji}</span>
                <span>{w.meaning}</span>
              </span>
            </li>;
          })}
        </ul>}
      </> : null}
    </div>
  </aside>;
}

export interface ShodoKanjiCardProps extends KanjiCardContent, Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The character to write. */
  char: string;
  /** Its stroke data, for example from `loadShodoGlyph(char)`. The card does not load anything itself. */
  glyph: ShodoGlyph;
  /** The video frame to show, at 30 fps (`KANJI_CARD_FPS`). The host owns the clock. */
  frame: number;
  /** The label at the top of the writing panel reads "HEADING: char". Default: "Kanji study". */
  heading?: string;
  /** "landscape" is 16:9 (1280 × 720). "portrait" is 9:16 (720 × 1280) for phone shorts. Default: landscape. */
  layout?: KanjiCardLayout;
  /** "compact" gives the 9:16 card a shorter reading card and a taller writing panel. Default: regular. */
  density?: KanjiCardDensity;
  timing?: KanjiCardTiming;
  /** What the intro phase types (`timing.intro` sets its length). */
  intro?: KanjiCardIntro;
  /** Parts to show. All parts show by default. A part with no data never shows. */
  sections?: Partial<Record<KanjiCardSection, boolean>>;
  /** The phase in which the text of the card fades in (over 12 frames). Default: "intro", the start of the video. */
  cardFrom?: KanjiCardPhase;
  /** Ink for the whole character. Default: "sumi" (black). Use `vermilionStrokes` to highlight single strokes. */
  ink?: KanjiCardInk;
  /** Hand speed, 0.25..4 (1 is an unhurried teacher). Used when `timing.write` is not set. Default: 1.6. */
  speed?: number;
  /** Show the order number of each stroke in the review pass. Default: true. */
  strokeNumbers?: boolean;
  /**
   * Timed highlights of the useful words, one word at a time, in seconds from the start of the
   * video (see `wordHighlightAt`). "each" highlights every word in turn, spread over the video
   * (see `spreadWordHighlights`). A highlighted word card shows also before the card text is
   * revealed (`cardFrom`). Default: none.
   */
  wordHighlights?: readonly KanjiWordHighlight[] | "each";
  /**
   * No scale, lift, growth or blink (fades only). Default: the viewer's prefers-reduced-motion
   * setting. Give true or false for a video export, so that every export is the same.
   */
  reducedMotion?: boolean;
  /**
   * Keep the label, the ink of the character and the text of the card out of these bands, for
   * example under the buttons and the caption of a phone short. The paper and the card panel
   * still fill the frame. Default: none.
   */
  safeInset?: Partial<KanjiCardSafeInset>;
  /**
   * Backing-store pixels per design pixel of the brush canvas. Default: the screen's, at most 2.
   * Set it when the picture is shown larger than its design size, for example 1.5 for a
   * 1080 × 1920 export of the 720 × 1280 portrait card.
   */
  pixelRatio?: number;
}

/**
 * A study video for one kanji, drawn at one frame. The ink is centred in the writing panel.
 * Landscape (16:9) puts the card on the right; portrait (9:16) puts it under the sheet.
 * Reports `data-km-kanji-phase`, `data-km-ink-box`, `data-km-stroke-times`, `data-km-timeline`
 * and `data-km-word-highlight` for rendered-bounds and timing checks.
 */
export function ShodoKanjiCard({
  char, glyph, frame: hostFrame, heading = "Kanji study", layout = "landscape", density = "regular", timing, intro, sections, cardFrom = "intro",
  ink = "sumi", speed, strokeNumbers = true, wordHighlights, reducedMotion, safeInset, pixelRatio, style,
  meanings, onyomi, kunyomi, jlpt, words, vermilionStrokes, ...rest
}: ShodoKanjiCardProps) {
  const prefersReduced = usePrefersReducedMotion();
  const reduce = reducedMotion ?? prefersReduced;
  const show = kanjiCardSections(sections);
  const content: KanjiCardContent = { meanings, onyomi, kunyomi, jlpt, words };
  const withCard = kanjiCardHasCard(content, show);
  // The bands the layout really uses (clamped), also reported in data-km-safe-inset.
  const bands = kanjiCardSafeInset(safeInset);
  const insetKey = [bands.left, bands.right, bands.top, bands.bottom].join(",");
  const vermilion = vermilionStrokes ?? [];
  const vermilionKey = vermilion.join(",");
  // String() keeps Infinity and NaN apart from a missing value (JSON would turn both into null).
  const timingKey = [timing?.intro, timing?.write, timing?.review, timing?.info].map(String).join(",");
  // Inputs are compared by value, so a host that passes new objects with the same values keeps the plan.
  const writing = useMemo(() => kanjiCardWriting(glyph, {
    layout, density, safeInset: bands, content, sections: show, timing, ink, speed,
    vermilionStrokes: vermilionKey ? vermilionKey.split(",").map(Number) : [],
  }), [glyph, layout, density, insetKey, withCard, show.label, timingKey, ink, speed, vermilionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const { geometry: g, plan, timeline, strokes, inkBox } = writing;
  const sheet = useMemo(() => kenteiSheet(g.paper.width, g.paper.height, 1, 1), [g]);
  const last = timeline.frames - 1;
  const fps = KANJI_CARD_FPS;
  // The canvas follows the exact position, so a live preview can move at the screen's refresh rate.
  const position = Math.min(last, Math.max(0, Number.isFinite(hostFrame) ? hostFrame : 0));
  const frame = Math.floor(position);
  const at = kanjiCardPhaseAt(timeline, position);
  const reviewed = timeline.review[1] > timeline.review[0];
  const writeGuide = vermilion.length ? "all" as const : "none" as const;
  // Each pass plays the same plan, stretched to its phase; the intro shows the brush at rest and the info phase holds the last pass.
  const writingPass = (at.phase === "write" || at.phase === "review") && at.length > 0;
  const guide = strokeNumbers && (writingPass ? at.phase === "review" : at.phase === "info" && reviewed) ? "numbers" as const : at.phase === "intro" ? "none" as const : writeGuide;
  const canvasFps = writingPass ? at.length / plan.duration : fps;
  const canvasFrame = writingPass ? at.local : at.phase === "intro" ? 0 : Math.ceil(plan.duration * fps);
  // The text fades in over 12 frames at the start of its phase; from the first frame it shows at once.
  const revealFrom = timeline[cardFrom][0];
  const reveal = revealFrom === 0 ? 1 : Math.min(1, Math.max(0, (frame - revealFrom) / 12));
  const pct = (v: number, of: number) => `${(v / of * 100).toFixed(3)}%`;
  const cq = (px: number) => `${(px / g.width * 100).toFixed(3)}cqw`;
  const portrait = layout === "portrait";
  // Word highlights run on the video clock (frame / fps), so every frame renders the same way.
  const wordCount = show.words ? words?.length ?? 0 : 0;
  const cues = wordHighlights === "each" ? spreadWordHighlights(wordCount, timeline.frames / fps) : wordHighlights ?? [];
  const highlight = wordHighlightAt(cues, frame / fps, { count: wordCount });
  // The typed intro: the reading in kana, then the character at the size the brush will write it.
  const introLength = (timeline.intro[1] - timeline.intro[0]) / fps;
  const typed = kanjiCardTypedAt(char, intro, introLength, position / fps, { reducedMotion: reduce });
  const [ix0, iy0, ix1, iy1] = inkBox;
  // A font's ink fills about 0.9 of its em, so the typed character is a little smaller than the brush's.
  const kanjiSize = Math.max(ix1 - ix0, iy1 - iy0);
  const kana = Math.max(1, [...(intro?.reading ?? "")].length);
  const kanaSize = Math.min(kanjiSize * .42, g.writing.width * .8 / kana);
  const typedSize = typed.composing ? kanaSize : (kanaSize + (kanjiSize - kanaSize) * typed.grow) * typed.scale;
  return <div {...rest} data-km-kanji-card={layout} data-km-kanji-phase={at.phase} data-km-ink-box={inkBox.map(v => v.toFixed(1)).join(" ")}
    data-km-design={`${g.width}x${g.height}`} data-km-kanji-frame={frame} data-km-safe-inset={insetKey} data-km-stroke-times={JSON.stringify(strokes)}
    data-km-word-highlight={highlight.word === null ? "" : `${highlight.word} ${highlight.strength.toFixed(3)}`}
    data-km-timeline={[timeline.review[0], timeline.info[0], timeline.frames].join(" ")} data-km-write-start={timeline.write[0]} style={{
      position: "relative", width: "100%", overflow: "hidden", containerType: "inline-size", ...style,
    }}>
    <ShodoCanvas plan={plan} frame={canvasFrame} fps={canvasFps} width={g.width} height={g.height} paper={g.paper} sheet={sheet} paperweight="none"
      underlay={g.band ? "felt" : "none"} orderGuide={guide} guideStrokes={guide === "numbers" ? undefined : vermilion} label={`The kanji ${char} written with a brush`}
      guideSize={guide === "numbers" ? Math.max(12, plan.brush.diameter * .42, g.type.number) : undefined} pixelRatio={pixelRatio} />
    {typed.opacity > 0 ? <div data-km-kanji-typed={typed.composing ? "composing" : typed.text ? "converted" : "caret"} aria-hidden="true" style={{
      position: "absolute", left: pct((ix0 + ix1) / 2, g.width), top: pct((iy0 + iy1) / 2, g.height), transform: "translate(-50%, -50%)",
      display: "flex", alignItems: "center", whiteSpace: "nowrap", opacity: typed.opacity, color: KANJI_INK,
      font: `600 ${cq(typedSize)}/1 ${KANJI_SANS}`,
    }}>
      <span lang="ja" style={{
        textDecoration: typed.composing ? "underline" : "none", textDecorationStyle: "dotted", textDecorationThickness: ".05em", textUnderlineOffset: ".14em",
        background: typed.converted > 0 ? `rgba(179,48,26,${(.16 * typed.converted).toFixed(3)})` : "transparent", borderRadius: ".06em", padding: "0 .04em",
      }}>{typed.text}</span>
      <span style={{ display: "inline-block", width: `max(2px, ${cq(4)})`, height: typed.text ? ".95em" : cq(kanaSize), marginLeft: ".04em",
        background: KANJI_SHU, opacity: typed.caret ? 1 : 0 }} />
    </div> : null}
    {show.label ? <div data-km-kanji-label="" style={{
      position: "absolute", left: pct(g.label.x, g.width), top: pct(g.label.y, g.height),
      font: `700 ${(g.type.label / g.width * 100).toFixed(3)}cqw/1 ${KANJI_DISPLAY}`, letterSpacing: ".01em", color: KANJI_INK,
    }}>{heading.toUpperCase()}: <span lang="ja">{char}</span></div> : null}
    {g.card ? <ShodoKanjiInfoCard char={char} layout={layout} density={density} sections={show} reveal={reveal}
      highlight={highlight} reducedMotion={reduce}
      meanings={meanings} onyomi={onyomi} kunyomi={kunyomi} jlpt={jlpt} words={words} style={{
        position: "absolute", left: pct(g.card.x, g.width), top: pct(g.card.y, g.height), width: pct(g.card.width, g.width), height: pct(g.card.height, g.height),
        padding: g.cardPad.map(cq).join(" "), boxShadow: portrait ? "0 -6px 18px rgba(0,0,0,.12)" : "-6px 0 18px rgba(0,0,0,.12)",
      }} /> : null}
  </div>;
}
