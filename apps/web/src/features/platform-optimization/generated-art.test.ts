import { describe, expect, it } from "vitest";
import { createPlatformOptimizationManifest, sourceSignature, type PlatformOptimizationInput } from "./model";
import { generateBlogHtml, generateBlogMarkdown, generatePlatformArtwork, generatedArtworkCatalog } from "./generated-art";

const input: PlatformOptimizationInput = {
  productionId: "production-1", projectId: "project-1", title: "How workflows move from paper to reports",
  platforms: ["youtube", "youtube_shorts", "tiktok", "instagram", "facebook", "blog"], language: "en",
  approvedPlatforms: ["youtube", "youtube_shorts", "tiktok", "instagram", "facebook", "blog"],
  brandColors: { primary: "#214C49", secondary: "#235C58", accent: "#C89443", background: "#F7F4EE", text: "#182C2B" },
  scriptSections: [
    { id: "hook", heading: "The initial question", text: "Why does paperwork move through so many steps?" },
    { id: "context", heading: "The current process", text: "First a team gathers documents. Then the team checks the forms." },
    { id: "mechanism", heading: "What happens next", text: "After that, a reviewer compares the relevant entries." },
    { id: "practical", heading: "Checking the result", text: "The reviewer records discrepancies to investigate." },
    { id: "closing", heading: "The next step", text: "This is the final section of the same document workflow." },
  ],
  assets: [],
};

describe("Kumiki-generated publishing artwork", () => {
  it("produces real SVG previews for platform covers and long-form article illustrations", () => {
    for (const target of ["youtube", "youtube-shorts", "tiktok", "instagram", "facebook"] as const) {
      const artwork = generatePlatformArtwork(input, target, input.title);
      expect(artwork).toHaveLength(1);
      expect(artwork[0].svg).toContain("<svg");
      expect(artwork[0].svg).toContain("The initial question");
      expect(artwork[0].width).toBeGreaterThan(100);
      expect(artwork[0].height).toBeGreaterThan(100);
    }
    const blog = generatePlatformArtwork(input, "blog", input.title);
    expect(blog).toHaveLength(4);
    expect(blog.map((image) => image.filename)).toEqual([...new Set(blog.map((image) => image.filename))]);
    expect(blog[2].svg).toContain("The current process");
  });

  it("builds a blog article from the blog-specific approved text, not video narration", () => {
    const selected = { ...input, platformScripts: { blog: [
      { id: "chapter-1", heading: "Article premise", text: "Specific longer-form article content." },
      { id: "chapter-2", heading: "Important details", text: "This section only exists in the blog." },
    ] } };
    const artwork = generatePlatformArtwork(selected, "blog", selected.title);
    const markdown = generateBlogMarkdown(selected, selected.title, artwork, "An article summary.");
    expect(markdown).toContain("## Important details");
    expect(markdown).toContain("This section only exists in the blog.");
    expect(markdown).not.toContain("The initial question");
    expect(markdown).toContain(artwork[1].filename);
  });

  it("indexes generated artwork while keeping source revisions unchanged and not fabricating videos", () => {
    const generated = generatedArtworkCatalog(input);
    expect(generated).toHaveLength(6);
    expect(generated.every((asset) => asset.kind === "hero" || asset.kind === "thumbnail")).toBe(true);
    const withArtwork = { ...input, assets: generated };
    expect(sourceSignature(withArtwork)).toBe(sourceSignature(input));
    expect(sourceSignature(withArtwork, "youtube")).toBe(sourceSignature(input, "youtube"));
    const packages = createPlatformOptimizationManifest(withArtwork).packages;
    expect(packages.find((item) => item.platform === "youtube")?.assetIds.video).toBeNull();
    expect(packages.find((item) => item.platform === "youtube")?.assetIds.thumbnail).toBeTruthy();
    expect(packages.find((item) => item.platform === "blog")?.assetIds.hero).toBeTruthy();
  });

  it("never puts unescaped user supplied markup into an SVG element", () => {
    const malicious = { ...input, title: `A title <script>alert('x')</script>` };
    const art = generatePlatformArtwork(malicious, "youtube", malicious.title)[0];
    expect(art?.svg).not.toContain("<script>");
  });

  it("cannot generate covers or download article prose from unapproved or stale scripts", () => {
    const unapproved = { ...input, approvedPlatforms: ["youtube"] };
    expect(generatePlatformArtwork(unapproved, "blog", unapproved.title)).toHaveLength(0);
    expect(generatedArtworkCatalog(unapproved).some((asset) => asset.platform === "blog")).toBe(false);
    expect(() => generateBlogMarkdown(unapproved, unapproved.title, [])).toThrow(/Approve/);
    expect(() => generateBlogHtml(unapproved, unapproved.title, "", "", [])).toThrow(/Approve/);
  });

  it("exports safe, fully inline HTML and links only the article's actual cited sources", () => {
    const sourceInput: PlatformOptimizationInput = { ...input, title: "<img src=x onerror=alert(1)>",
      sourceEvidence: [
        {sourceId: "source-1", sourceUrl: "https://example.org/source", reviewStatus: "verified"},
        {sourceId: "source-2", sourceUrl: "https://unrelated.test/", reviewStatus: "unverified"},
      ],
      platformScripts: {blog: [{id:"section-1", heading:"A <b>test</b>",
        text:"## Important subsection\n\nThis is the actual source-linked article.", sourceRefs:["source-1"]}]},
    };
    const art = generatePlatformArtwork(sourceInput, "blog", sourceInput.title);
    const html = generateBlogHtml(sourceInput, sourceInput.title, "Editorial summary", "Search summary", art);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;b&gt;test&lt;/b&gt;");
    expect(html).toContain("<h3>Important subsection</h3>");
    expect(html).toContain("https://example.org/source");
    expect(html).not.toContain("unrelated.test");
    expect(html).toContain("src=\"data:image/svg+xml");
  });
});
