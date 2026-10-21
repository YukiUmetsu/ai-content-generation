import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrandAppearanceStudio } from "./BrandAppearanceStudio";
import { createBrandState } from "./model/brands";
import type { BrandState } from "./model/types";
import fixtureKit from "../../../../../examples/brand-kit.json";
import longFixture from "./fixtures/long-brand.json";

function setup(props: Partial<React.ComponentProps<typeof BrandAppearanceStudio>> = {}) {
  const user = userEvent.setup();
  const view = render(<BrandAppearanceStudio locale="en" {...props} />);
  return { user, ...view };
}

describe("BrandAppearanceStudio", () => {
  it("renders the default House Math brand with modern-analytical preset", () => {
    setup();
    expect(screen.getByRole("heading", { name: "House Math" })).toBeInTheDocument();
    expect(screen.getByTestId("video-opening")).toHaveAttribute("data-preset", "modern-analytical");
    expect(screen.getByTestId("metric-reveal")).toHaveAttribute("data-preset", "modern-analytical");
    expect(screen.getByTestId("thumbnail-preview")).toHaveAttribute("data-preset", "modern-analytical");
  });

  it("switches presets and updates all three previews", async () => {
    const { user } = setup();
    const cinematic = screen.getByRole("button", { name: /Cinematic Investigative/i });
    await user.click(cinematic);

    expect(screen.getByTestId("video-opening")).toHaveAttribute("data-preset", "cinematic-investigative");
    expect(screen.getByTestId("metric-reveal")).toHaveAttribute("data-preset", "cinematic-investigative");
    expect(screen.getByTestId("thumbnail-preview")).toHaveAttribute("data-preset", "cinematic-investigative");

    const stage = screen.getByTestId("video-opening");
    expect(stage.style.getPropertyValue("--ba-canvas")).toBe("#0A0A0C");
  });

  it("edits a single palette role without changing others", async () => {
    const { user } = setup();
    const hexInputs = screen.getAllByLabelText(/hex$/i);
    const canvasInput = hexInputs[0];

    await user.clear(canvasInput);
    await user.type(canvasInput, "#FF5733");

    expect(canvasInput).toHaveValue("#FF5733");

    const video = screen.getByTestId("video-opening");
    expect(video.style.getPropertyValue("--ba-canvas")).toBe("#FF5733");

    const surfaceInput = hexInputs[1];
    expect(surfaceInput).toHaveValue("#1D2A33");
  });

  it("keeps two brands independent when switching", async () => {
    const { user } = setup();
    const hexInputs = screen.getAllByLabelText(/hex$/i);
    const canvasInput = hexInputs[0];

    await user.clear(canvasInput);
    await user.type(canvasInput, "#FF5733");

    const tidelineButton = screen.getByRole("button", { name: /Tideline/i });
    await user.click(tidelineButton);

    const tidelineCanvas = screen.getAllByLabelText(/hex$/i)[0];
    expect(tidelineCanvas).toHaveValue("#F3EEE5");

    const houseMathButton = screen.getByRole("button", { name: /House Math/i });
    await user.click(houseMathButton);
    expect(screen.getAllByLabelText(/hex$/i)[0]).toHaveValue("#FF5733");
  });

  it("exports and re-imports the active brand appearance round-trip", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /export/i }));

    const textarea = screen.getByRole("textbox", { name: /export/i });
    const exported = (textarea as HTMLTextAreaElement).value;
    const doc = JSON.parse(exported);
    expect(doc.kind).toBe("brand-kit-appearance");
    expect(doc.visual.palette.canvas).toBe("#101A22");

    await user.click(screen.getByRole("button", { name: /import/i }));

    const importArea = screen.getByRole("textbox", { name: /import/i });
    await user.clear(importArea);
    await user.click(importArea);
    await user.paste(exported);

    await user.click(screen.getByRole("button", { name: /Import from JSON/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("video-opening").style.getPropertyValue("--ba-canvas")).toBe("#101A22");
  });

  it("imports examples/brand-kit.json and applies the House Math appearance", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /export/i }));
    await user.click(screen.getByRole("button", { name: /import/i }));

    const importArea = screen.getByRole("textbox", { name: /import/i });
    await user.clear(importArea);
    await user.click(importArea);
    await user.paste(JSON.stringify(fixtureKit));

    await user.click(screen.getByRole("button", { name: /Import from JSON/i }));

    expect(screen.getByTestId("video-opening").style.getPropertyValue("--ba-canvas")).toBe("#101A22");
    expect(screen.getByTestId("video-opening").style.getPropertyValue("--ba-accent")).toBe("#E8A95B");
  });

  it("shows invalid-hex and low-contrast warnings without crashing previews", async () => {
    const { user } = setup();
    const hexInputs = screen.getAllByLabelText(/hex$/i);
    const canvasInput = hexInputs[0];

    await user.clear(canvasInput);
    await user.type(canvasInput, "not-a-color");

    expect(screen.getByRole("alert")).toHaveTextContent(/#RGB|#RRGGBB/i);
    expect(screen.getByTestId("video-opening")).toBeInTheDocument();
    expect(screen.getByTestId("metric-reveal")).toBeInTheDocument();
    expect(screen.getByTestId("thumbnail-preview")).toBeInTheDocument();

    await user.clear(canvasInput);
    await user.type(canvasInput, "#FFFFFF");
    const textInput = screen.getByLabelText(/Primary text hex/i);
    await user.clear(textInput);
    await user.type(textInput, "#FFFFFF");

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/contrast|issue/i);
  });

  it("renders Japanese locale and a long brand name fully", () => {
    const longBrand = createBrandState(
      longFixture.id,
      longFixture.name,
      longFixture.revision,
      longFixture.artDirection.presetId as BrandState["appearance"]["presetId"],
      {
        video: { kicker: "", title: "", dek: "" },
        metric: {
          label: "",
          value: "",
          delta: "",
          positiveLabel: "",
          positiveValue: "",
          negativeLabel: "",
          negativeValue: "",
          source: "",
        },
        thumbnail: { kicker: "", title: "", badge: "", footer: "" },
      }
    );

    render(<BrandAppearanceStudio locale="ja" initialBrands={[longBrand]} initialActiveBrandId={longBrand.id} />);
    const heading = screen.getByRole("heading", { name: longFixture.name });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent(longFixture.name);
    expect(heading).not.toHaveClass("truncate");
    expect(screen.getByRole("region", { name: "ブランドの外観" })).toBeInTheDocument();
    expect(screen.getByText("カラーパレット")).toBeInTheDocument();
    expect(screen.getByText("タイポグラフィ")).toBeInTheDocument();
  });
});
