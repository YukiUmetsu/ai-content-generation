/**
 * SHO1 glyph source: any Japanese character, written the same way everywhere.
 *
 * Bundled original glyphs come first. Any other kanji or kana is read from KanjiVG
 * (stroke order and centrelines), pinned to one release and loaded at run time: the data
 * is never bundled. KanjiVG is © Ulrich Apel, CC BY-SA 3.0; a film that uses it must
 * credit KanjiVG (http://kanjivg.tagaini.net) and keep the share-alike terms. Every
 * loaded glyph keeps `source: "kanjivg"` so hosts can show the credit.
 *
 * `shodoKaishoForm` then applies the teacher-measured layout rules (結構法, `shodoStructure`)
 * and brush habits (右上がり, weight by length, 懸針, 右払い feet, kana curves).
 *
 * A host can also supply a teacher: forms fitted to one teacher's models. When the teacher
 * has the character, it is written as that teacher wrote it; other characters use the rules.
 * A teacher's forms reproduce that teacher's work, so a host keeps them with the rights it
 * has for them; this library bundles none.
 */
import { SHODO_GLYPHS, kanjiVgFileName, parseKanjiVgSvg, shodoKaishoForm } from "./shodo-glyphs";
import type { ShodoFormOptions, ShodoGlyph } from "./shodo-glyphs";

export const SHODO_KANJIVG_RELEASE = "r20260714";
// Raw GitHub at the release tag: CORS-enabled and not limited by CDN package size.
export const SHODO_KANJIVG_BASE = `https://raw.githubusercontent.com/KanjiVG/kanjivg/${SHODO_KANJIVG_RELEASE}/kanji/`;
export const SHODO_KANJIVG_CREDIT = `Stroke data: KanjiVG ${SHODO_KANJIVG_RELEASE} © Ulrich Apel, CC BY-SA 3.0 (kanjivg.tagaini.net)`;

/** Forms fitted to one teacher's models, by character. */
export interface ShodoTeacher {
  id: string;
  /** Name and credit to show with the writing. */
  label: string;
  glyphs: Readonly<Record<string, ShodoGlyph>>;
}

export interface ShodoGlyphLoadOptions extends ShodoFormOptions {
  /**
   * Write the characters a teacher has as that teacher wrote them. With several teachers, the
   * first one that has the character is used.
   */
  teacher?: ShodoTeacher | readonly ShodoTeacher[] | null;
  /** Folder or server holding KanjiVG `kanji/*.svg` files; defaults to the pinned release on GitHub. */
  baseUrl?: string;
  /** Use the bundled original glyph when one exists. Default true. */
  preferBundled?: boolean;
  fetcher?: (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

/** The teacher whose form is used for a character: the first one that has it. */
export function shodoTeacherFor(char: string, teacher: ShodoTeacher | readonly ShodoTeacher[] | null | undefined): ShodoTeacher | null {
  const list: readonly ShodoTeacher[] = !teacher ? [] : Array.isArray(teacher) ? teacher : [teacher as ShodoTeacher];
  return list.find(t => t.glyphs[char]) ?? null;
}

const cache = new Map<string, Promise<ShodoGlyph>>();

/** Load one character's glyph. Rejects with a clear message when no stroke data exists. */
export function loadShodoGlyph(char: string, options: ShodoGlyphLoadOptions = {}): Promise<ShodoGlyph> {
  const c = [...char][0];
  if (!c || !c.trim()) return Promise.reject(new RangeError("A non-space character is required."));
  const taught = shodoTeacherFor(c, options.teacher)?.glyphs[c];
  if (taught) return Promise.resolve(taught);
  if (options.preferBundled !== false && SHODO_GLYPHS[c]) return Promise.resolve(SHODO_GLYPHS[c]);
  const base = options.baseUrl ?? SHODO_KANJIVG_BASE;
  // Every form option changes the result, so all of them are part of the cache key.
  const key = [base, c, options.rise, options.sweep, options.main, JSON.stringify(options.structure ?? null)].join("|");
  const hit = cache.get(key);
  if (hit) return hit;
  const fetcher = options.fetcher ?? ((url: string) => fetch(url));
  const job = fetcher(base + kanjiVgFileName(c)).then(async res => {
    if (!res.ok) throw new RangeError(`No stroke data for ${c} (KanjiVG ${res.status}).`);
    return shodoKaishoForm(parseKanjiVgSvg(await res.text(), c), options);
  });
  job.catch(() => cache.delete(key));
  cache.set(key, job);
  return job;
}

/** Load every character of a text, in order (spaces skipped). */
export function loadShodoText(text: string, options: ShodoGlyphLoadOptions = {}): Promise<ShodoGlyph[]> {
  return Promise.all([...text].filter(c => c.trim()).map(c => loadShodoGlyph(c, options)));
}
