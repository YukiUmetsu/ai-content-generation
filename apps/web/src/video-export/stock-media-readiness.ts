/** Await decoded pixels for the absolute video frame before Playwright screenshots it. */
function waitForVideo(video: HTMLVideoElement, ready: () => boolean, events: string[], timeoutMs: number) {
  if (ready()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      for (const name of events) video.removeEventListener(name, check);
      video.removeEventListener("error", failed);
    };
    const check = () => {
      if (ready()) { cleanup(); resolve(); }
    };
    const failed = () => { cleanup(); reject(Error("Reviewed scene video could not be decoded")); };
    const timer = setTimeout(() => { cleanup(); reject(Error("Timed out waiting for a reviewed scene video frame")); }, timeoutMs);
    for (const name of events) video.addEventListener(name, check);
    video.addEventListener("error", failed);
    check();
  });
}

export async function prepareStockMediaFrame(stage: Element, timeoutMs = 10000): Promise<void> {
  const image = stage.querySelector<HTMLImageElement>("[data-contentgen-stock-photo]");
  if (image) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([image.decode(), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(Error("Timed out decoding reviewed scene image")), timeoutMs);
      })]);
    } finally { clearTimeout(timeout); }
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0)
      throw Error("Reviewed scene image decoded without valid dimensions");
  }
  const video = stage.querySelector<HTMLVideoElement>("[data-contentgen-stock-video]");
  if (!video) return;
  const requested = Number(video.dataset.mediaTime);
  if (!video.dataset.mediaTime || !Number.isFinite(requested) || requested < 0)
    throw Error("Invalid reviewed scene video frame time");
  await waitForVideo(video, () => video.readyState >= HTMLMediaElement.HAVE_METADATA,
    ["loadedmetadata", "loadeddata"], timeoutMs);
  if (!Number.isFinite(video.duration) || video.duration < 0.25)
    throw Error("Reviewed scene video lacks a usable measured duration");
  const target = Math.min(requested, Math.max(0, video.duration - 1 / 60));
  const ready = () => video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    !video.seeking && Math.abs(video.currentTime - target) < 0.02;
  if (!ready()) {
    video.currentTime = target;
    await waitForVideo(video, ready, ["seeked", "loadeddata", "canplay"], timeoutMs);
  }
}
