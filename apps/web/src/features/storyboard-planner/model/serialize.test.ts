import { describe, expect, it } from "vitest";
import { HVAC_EXAMPLE } from "./hvac-example";
import { canonicalJson, parseStoryboard, parseStoryboardDraft, serializeStoryboard } from "./serialize";

interface RawDocument {
  beats: Array<Record<string, unknown>>;
  questions: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function rawDocument(): RawDocument {
  return JSON.parse(serializeStoryboard(HVAC_EXAMPLE)) as RawDocument;
}

function errorCodes(text: string): string[] {
  const result = parseStoryboard(text);
  return result.ok ? [] : result.errors.map((issue) => issue.code);
}

describe("deterministic serialization", () => {
  it("produces byte-identical output for identical documents", () => {
    expect(serializeStoryboard(HVAC_EXAMPLE)).toBe(serializeStoryboard(HVAC_EXAMPLE));
  });

  it("sorts object keys recursively and ends with a newline", () => {
    const text = serializeStoryboard(HVAC_EXAMPLE);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toBe(canonicalJson(HVAC_EXAMPLE));
  });

  it("keeps authored array order", () => {
    const parsed = JSON.parse(serializeStoryboard(HVAC_EXAMPLE)) as RawDocument;
    expect(parsed.beats.map((beat) => beat.id)).toEqual([
      "beat-hook",
      "beat-equipment",
      "beat-installation",
      "beat-evidence",
      "beat-payoff",
    ]);
  });
});

describe("import / export round trip", () => {
  it("round-trips the complete fixture without drift", () => {
    const text = serializeStoryboard(HVAC_EXAMPLE);
    const result = parseStoryboard(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.board).toEqual(HVAC_EXAMPLE);
    expect(serializeStoryboard(result.board)).toBe(text);
  });

  it("drops unknown root and beat properties", () => {
    const raw = rawDocument();
    raw.extra = "root";
    raw.beats[0].extra = "beat";
    const result = parseStoryboard(JSON.stringify(raw));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("extra" in result.board).toBe(false);
    expect("extra" in result.board.beats[0]).toBe(false);
  });
});

describe("safe rejection", () => {
  it("rejects invalid JSON without throwing", () => {
    expect(errorCodes("{not json")).toEqual(["invalid-json"]);
    expect(errorCodes("")).toEqual(["invalid-json"]);
  });

  it("rejects non-object roots", () => {
    expect(errorCodes("null")).toEqual(["invalid-root"]);
    expect(errorCodes("[]")).toEqual(["invalid-root"]);
  });

  it("rejects the wrong schema version and kind", () => {
    const raw = rawDocument();
    raw.schemaVersion = 2;
    raw.kind = "kumiki-composition";
    expect(errorCodes(JSON.stringify(raw))).toEqual(["schema-version", "kind"]);
  });

  it("rejects an empty beat list", () => {
    const raw = rawDocument();
    raw.beats = [];
    expect(errorCodes(JSON.stringify(raw))).toEqual(["beats-empty"]);
  });

  it("rejects duplicate beat ids", () => {
    const raw = rawDocument();
    raw.beats[1].id = raw.beats[0].id;
    expect(errorCodes(JSON.stringify(raw))).toEqual(["duplicate-beat-id"]);
  });

  it("rejects zero and negative durations", () => {
    const zero = rawDocument();
    zero.beats[0].durationFrames = 0;
    expect(errorCodes(JSON.stringify(zero))).toEqual(["invalid-field"]);

    const negative = rawDocument();
    negative.beats[2].durationFrames = -12;
    expect(errorCodes(JSON.stringify(negative))).toEqual(["invalid-field"]);
  });

  it("rejects malformed beat entries and bad enums", () => {
    const malformed = rawDocument();
    malformed.beats[1] = "not a beat" as unknown as Record<string, unknown>;
    expect(errorCodes(JSON.stringify(malformed))).toEqual(["invalid-field"]);

    const badRole = rawDocument();
    badRole.beats[0].role = "montage";
    expect(errorCodes(JSON.stringify(badRole))).toEqual(["invalid-field"]);
  });

  it("rejects missing required fields", () => {
    const raw = rawDocument();
    delete raw.beats[0].narration;
    delete raw.title;
    const codes = errorCodes(JSON.stringify(raw));
    expect(codes).toContain("missing-field");
    expect(codes.filter((code) => code === "missing-field")).toHaveLength(2);
  });

  it("returns errors as data and never a partial board", () => {
    const raw = rawDocument();
    raw.locale = "fr";
    const result = parseStoryboard(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toEqual({ code: "invalid-field", path: "locale" });
  });
});

describe("incomplete draft recovery", () => {
  it("accepts an empty beat list as a recoverable draft but not a completed import", () => {
    const raw = rawDocument();
    raw.beats = [];
    const json = JSON.stringify(raw);
    const draft = parseStoryboardDraft(json);
    expect(draft.ok).toBe(true);
    if (draft.ok) expect(draft.board.beats).toEqual([]);
    expect(errorCodes(json)).toEqual(["beats-empty"]);
  });

  it("preserves finite zero, negative and fractional frame edits without weakening import", () => {
    for (const duration of [0, -12, 1.5]) {
      const raw = rawDocument();
      raw.beats[0].durationFrames = duration;
      const json = JSON.stringify(raw);
      const draft = parseStoryboardDraft(json);
      expect(draft.ok).toBe(true);
      if (draft.ok) expect(draft.board.beats[0].durationFrames).toBe(duration);
      expect(errorCodes(json)).toEqual(["invalid-field"]);
    }
  });

  it("still rejects nonnumeric duration fields in drafts", () => {
    const raw = rawDocument();
    raw.beats[0].durationFrames = null;
    const result = parseStoryboardDraft(JSON.stringify(raw));
    expect(result.ok).toBe(false);
  });
});
