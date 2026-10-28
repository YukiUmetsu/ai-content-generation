import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteProviderKey, deleteYoutubeKey, loadProviderConnections, saveProviderKey, saveYoutubeKey } from "./provider-credentials";

const otherProviders = [
  { id: "fish", configured: false, source: "missing" },
];

const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("local provider credentials API", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("reads configuration status without expecting secret material", async () => {
    const call = vi.fn(async () => jsonResponse({
      providers: [{ id: "youtube", configured: true, source: "keychain" },...otherProviders],
    }));
    globalThis.fetch = call;

    expect(await loadProviderConnections()).toEqual([
      { id: "youtube", configured: true, source: "keychain" },...otherProviders,
    ]);
    expect(call).toHaveBeenCalledWith("/api/settings/providers", expect.objectContaining({ method: "GET" }));
  });

  it("sends a new key only in the bounded settings request body with a session token", async () => {
    const secret = "YT-secret-never-persist";
    const calls: Array<{ path: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(path), init: init ?? {} });
      if (String(path).endsWith("/session")) return jsonResponse({ token: "CSRF-test-token" });
      return jsonResponse({ id: "youtube", configured: true, source: "keychain" });
    });

    expect(await saveYoutubeKey(secret)).toEqual({ id: "youtube", configured: true, source: "keychain" });
    expect(calls.map(call => call.path)).toEqual([
      "/api/settings/session",
      "/api/settings/providers/youtube/key",
    ]);
    expect(calls[1].init.method).toBe("PUT");
    expect(calls[1].init.headers).toEqual(expect.objectContaining({
      "Content-Type": "application/json",
      "X-Contentgen-Settings": "CSRF-test-token",
    }));
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ key: secret });
    expect(JSON.stringify(calls.map(call => call.path))).not.toContain(secret);
    expect(localStorage.length).toBe(0);
  });

  it("deletes the Keychain item without sending a secret", async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (path: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ path: String(path), init: init ?? {} });
      return String(path).endsWith("/session")
        ? jsonResponse({ token: "CSRF-delete" })
        : new Response(null, { status: 204 });
    });

    await deleteYoutubeKey();
    expect(calls[1]).toEqual({
      path: "/api/settings/providers/youtube/key",
      init: expect.objectContaining({ method: "DELETE", body: undefined }),
    });
    expect(calls[1].init.headers).toEqual(expect.objectContaining({
      "X-Contentgen-Settings": "CSRF-delete",
    }));
  });

  it("uses the same one-time session for each provider write, never returns key material",async()=>{
    const calls: string[]=[];
    globalThis.fetch=vi.fn(async(path:RequestInfo|URL)=>{
      const url=String(path);calls.push(url);
      if(url.endsWith("/session"))return jsonResponse({token:"single-use-token"});
      if(url.endsWith("/key"))return jsonResponse({id:url.includes("/fish/")?"fish":"pexels",configured:true,source:"keychain"});
      throw Error("unexpected route");
    });
    expect((await saveProviderKey("fish","private-fish-key")).id).toBe("fish");
    await deleteProviderKey("fish");
    expect(calls).toEqual(["/api/settings/session","/api/settings/providers/fish/key",
      "/api/settings/session","/api/settings/providers/fish/key"]);
    expect(localStorage.length).toBe(0);
  });

  it("rejects unexpected status, missing session and secret-shaped provider errors", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ providers: [{ id: "youtube", configured: true, source: "insecure-local-storage" }] }));
    await expect(loadProviderConnections()).rejects.toThrow("Invalid provider connection");

    globalThis.fetch = vi.fn(async () => jsonResponse({ token: "" }));
    await expect(saveYoutubeKey("secret-key")).rejects.toThrow("Invalid local settings session");

    globalThis.fetch = vi.fn(async (path: RequestInfo | URL) => String(path).endsWith("/session")
      ? jsonResponse({ token: "test-token" })
      : jsonResponse({ error: { code: "keychain_denied", message: "Provider key secret appeared here" } }, 503));
    await expect(saveYoutubeKey("secret-key")).rejects.toThrow("Local credential request failed (HTTP 503)");
  });
});
