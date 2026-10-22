import { afterAll, describe, expect, it, vi } from "vitest";
import { thumbnailFileName, thumbnailPng, thumbnailSvg } from "./export";
import { createThumbnailDocument, VARIANT_ID_BY_CONCEPT } from "./fixtures";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("thumbnail export", () => {
  it("exports the fixture at 1280 × 720 with a predictable filename", () => {
    const document = createThumbnailDocument();
    const result = thumbnailSvg(document, { locale: "en" });
    expect(result.size).toEqual({ width: 1280, height: 720 });
    expect(result.filename).toBe("thumbnail-hvac-replacement-price-shock-1280x720.svg");
    expect(result.svg.startsWith("<svg")).toBe(true);
    expect(result.svg).toContain('viewBox="0 0 1280 720"');
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  });

  it("names exports per concept and format", () => {
    const document = createThumbnailDocument();
    const hidden = thumbnailSvg(document, {
      variantId: VARIANT_ID_BY_CONCEPT["hidden-cost"],
      locale: "ja",
    });
    expect(hidden.filename).toBe("thumbnail-hvac-replacement-hidden-cost-1280x720.svg");
    expect(thumbnailFileName(document, {}, "png", { width: 1280, height: 720 })).toBe(
      "thumbnail-hvac-replacement-price-shock-1280x720.png"
    );
  });

  it("renders PNG through the Kumiki raster pipeline (rasteriser stubbed for jsdom)", async () => {
    const context = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 8 }),
    } as unknown as CanvasRenderingContext2D;

    const getContext = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => context);

    const pngBlob = new Blob([PNG_SIGNATURE], { type: "image/png" });
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: (callback: BlobCallback) => callback(pngBlob),
    });

    class StubImage {
      src = "";
      width = 1280;
      height = 720;
      decode() {
        return Promise.resolve();
      }
    }
    vi.stubGlobal("Image", StubImage);

    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:thumbnail-test",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => undefined,
    });

    const document = createThumbnailDocument();
    const result = await thumbnailPng(document, { locale: "en" });

    expect(result.size).toEqual({ width: 1280, height: 720 });
    expect(result.blob.type).toBe("image/png");
    expect(result.filename).toBe("thumbnail-hvac-replacement-price-shock-1280x720.png");
    expect(result.svg).toContain("<svg");
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1280, 720);
    expect(context.drawImage).toHaveBeenCalled();

    getContext.mockRestore();
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
