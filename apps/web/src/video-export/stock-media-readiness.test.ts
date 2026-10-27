import { describe, expect, it, vi } from "vitest";
import { prepareStockMediaFrame } from "./stock-media-readiness";

describe("deterministic reviewed-media frame readiness", () => {
  it("waits for an image decode and rejects a broken photo before export", async () => {
    const stage = document.createElement("div");
    const image = document.createElement("img");
    image.dataset.contentgenStockPhoto = "";
    let resolveDecode!: () => void;
    image.decode = vi.fn(() => new Promise<void>(resolve => { resolveDecode = resolve; }));
    Object.defineProperty(image, "naturalWidth", { value: 960 });
    Object.defineProperty(image, "naturalHeight", { value: 540 });
    stage.append(image);
    let ready = false;
    const wait = prepareStockMediaFrame(stage).then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    resolveDecode();
    await wait;
    expect(ready).toBe(true);
    image.decode = vi.fn().mockRejectedValue(Error("Invalid JPEG"));
    await expect(prepareStockMediaFrame(stage)).rejects.toThrow(/image|decode|JPEG/i);
  });

  it("seeks the muted clip to the requested frame and waits for decoded video", async () => {
    const stage = document.createElement("div");
    const video = document.createElement("video");
    video.dataset.contentgenStockVideo = "";
    video.dataset.mediaTime = "1.250000";
    Object.defineProperty(video, "readyState", { value: 4 });
    Object.defineProperty(video, "duration", { value: 4 });
    let position = 0;
    Object.defineProperty(video, "currentTime", { get: () => position, set: value => {
      position = value;
      queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
    } });
    stage.append(video);
    await prepareStockMediaFrame(stage);
    expect(position).toBe(1.25);
    video.dataset.mediaTime = "2.500000";
    await prepareStockMediaFrame(stage);
    expect(position).toBe(2.5);
  });

  it("never accepts missing media metadata or an unresponsive video as a completed frame", async () => {
    const stage = document.createElement("div");
    const video = document.createElement("video");
    video.dataset.contentgenStockVideo = "";
    stage.append(video);
    await expect(prepareStockMediaFrame(stage, 15)).rejects.toThrow(/time|invalid|media/i);
    video.dataset.mediaTime = "1.2";
    await expect(prepareStockMediaFrame(stage, 15)).rejects.toThrow(/time|video|ready/i);
  });
});
