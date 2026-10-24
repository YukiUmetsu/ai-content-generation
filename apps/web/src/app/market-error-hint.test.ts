import { describe, expect, it } from "vitest";
import { marketErrorHint } from "./market-error-hint";

describe("market provider error messages", () => {
  it("explains permission and precise Google API errors without exposing provider responses", () => {
    expect(marketErrorHint("permission", false)).toMatch(/YouTube Data API v3/);
    expect(marketErrorHint("api_not_enabled", false)).toMatch(/Enable YouTube Data API v3/);
    expect(marketErrorHint("api_key_invalid", false)).toMatch(/Keychain key takes priority/);
    expect(marketErrorHint("api_key_restricted", false)).toMatch(/Rust server/);
    expect(marketErrorHint("quota_exceeded", false)).toMatch(/quota/);
    expect(marketErrorHint("permission", true)).toMatch(/Google/);
    expect(marketErrorHint("unknown_reason", false)).toBe("");
  });

});
