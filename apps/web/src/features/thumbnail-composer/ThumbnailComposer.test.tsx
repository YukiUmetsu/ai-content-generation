import { useState } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "@/App";
import { copyFor } from "./i18n";
import { ThumbnailComposer } from "./index";
import { HVAC_EXAMPLE, HVAC_EXAMPLE_JA } from "./model/fixtures";

function Harness({ locale = "en" as "en" | "ja" }) {
  const [preview, setPreview] = useState<ReactNode | null>(null);
  return (
    <div>
      <ThumbnailComposer projectId="test-project" locale={locale} onPreviewChange={setPreview} />
      <div data-testid="shared-preview">{preview}</div>
    </div>
  );
}

describe("ThumbnailComposer", () => {
  it("opens on a finished concept and publishes it to the shared preview", () => {
    render(<Harness />);
    const copy = copyFor("en");
    const preview = screen.getByTestId("shared-preview");

    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect(within(preview).getByTestId("thumbnail-live-preview")).toBeInTheDocument();
    expect(within(preview).getByTestId("thumbnail-preview-stage")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("$12,400?")
    );
    expect(screen.getByRole("radio", { name: /price shock/i })).toBeChecked();
    expect(screen.getByTestId("thumbnail-mini-320")).toBeInTheDocument();
    expect(screen.getByTestId("thumbnail-mini-160")).toBeInTheDocument();
  });

  it("updates the shared preview while the headline is edited", () => {
    render(<Harness />);
    const copy = copyFor("en");
    const headline = screen.getByLabelText(copy.headlineLabel) as HTMLInputElement;
    expect(headline.value).toBe("Same house. A new system. A new price.");

    fireEvent.change(headline, { target: { value: "The quote hides four costs" } });

    const stage = within(screen.getByTestId("shared-preview")).getByTestId("thumbnail-preview-stage");
    expect(stage).toHaveAttribute("aria-label", expect.stringContaining("The quote hides four costs"));
    expect(headline.value).toBe("The quote hides four costs");

    const value = screen.getByLabelText(copy.valueLabel);
    fireEvent.change(value, { target: { value: "$13,500" } });
    expect(
      within(screen.getByTestId("shared-preview")).getByTestId("thumbnail-preview-stage")
    ).toHaveAttribute("aria-label", expect.stringContaining("$13,500"));
  });

  it("clears the shared preview when the editor unmounts", () => {
    const onPreviewChange = vi.fn();
    const { unmount } = render(
      <ThumbnailComposer projectId="test-project" locale="en" onPreviewChange={onPreviewChange} />
    );
    expect(onPreviewChange).toHaveBeenCalled();
    unmount();
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
  });

  it("switches composition and keeps each concept's edits", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const copy = copyFor("en");
    const headline = screen.getByLabelText(copy.headlineLabel) as HTMLInputElement;

    fireEvent.change(headline, { target: { value: "Price shock edit" } });
    await user.click(screen.getByRole("radio", { name: /hidden complexity/i }));

    expect(screen.getByRole("radio", { name: /hidden complexity/i })).toBeChecked();
    const hiddenStage = within(screen.getByTestId("shared-preview")).getByTestId("thumbnail-preview-stage");
    expect(hiddenStage).toHaveAttribute("aria-label", expect.stringContaining("The quote is never one number."));

    fireEvent.change(screen.getByLabelText(copy.headlineLabel), { target: { value: "Hidden edit" } });
    await user.click(screen.getByRole("radio", { name: /price shock/i }));

    expect((screen.getByLabelText(copy.headlineLabel) as HTMLInputElement).value).toBe("Price shock edit");
    await user.click(screen.getByRole("radio", { name: /hidden complexity/i }));
    expect((screen.getByLabelText(copy.headlineLabel) as HTMLInputElement).value).toBe("Hidden edit");
  });

  it("warns about long copy without blocking the render", () => {
    render(<Harness />);
    const copy = copyFor("en");
    const headline = screen.getByLabelText(copy.headlineLabel);
    fireEvent.change(headline, {
      target: {
        value:
          "Why a replacement quote bundles equipment labour ductwork permits and disposal into one number that hides the real installed cost",
      },
    });
    const diagnostics = screen.getByTestId("thumbnail-diagnostics");
    expect(within(diagnostics).getByText(copy.issueCopy["headline-too-long"].title)).toBeInTheDocument();
    expect(within(diagnostics).getAllByText(copy.severityWarning).length).toBeGreaterThan(0);
  });

  it("renders Japanese interface copy and artwork", () => {
    render(<Harness locale="ja" />);
    const copy = copyFor("ja");
    expect(screen.getByLabelText(copy.topicLabel)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: copy.title })).toBeInTheDocument();
    expect(within(screen.getByTestId("shared-preview")).getByTestId("thumbnail-preview-stage")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("同じ家")
    );
  });

  it("appears inside the existing Create workspace tab", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("link", { name: "Create" }));
    await user.click(screen.getByRole("tab", { name: /thumbnail composer/i }));
    const editor = screen.getByTestId("thumbnail-composer");
    expect(within(editor).getByRole("heading", { name: "Thumbnail composer" })).toBeInTheDocument();
    expect(screen.getByTestId("thumbnail-live-preview")).toBeInTheDocument();
    expect(within(editor).getByLabelText("Video topic")).toBeInTheDocument();
  });

  it("blocks export until the price-versus-quote concept has a comparison figure", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const copy = copyFor("en");
    await user.click(screen.getByRole("radio", { name: /price vs\. quote/i }));

    const field = screen.getByLabelText(copy.compareLabel) as HTMLInputElement;
    expect(field.value).toBe("$4,800");

    await user.clear(field);

    expect(screen.getByText(copy.compareRequired)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.exportSvg })).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.exportPng })).toBeDisabled();
    const diagnostics = screen.getByTestId("thumbnail-diagnostics");
    expect(within(diagnostics).getByText(copy.issueCopy["compare-empty"].title)).toBeInTheDocument();
  });

  it("follows the interface language for untouched example copy only", async () => {
    const { rerender } = render(<Harness />);
    const en = copyFor("en");
    const enTopic = screen.getByLabelText(en.topicLabel) as HTMLInputElement;
    expect(enTopic.value).toBe(HVAC_EXAMPLE.topic);

    rerender(<Harness locale="ja" />);
    const ja = copyFor("ja");
    expect((screen.getByLabelText(ja.topicLabel) as HTMLInputElement).value).toBe(HVAC_EXAMPLE_JA.topic);

    await userEvent.setup().type(screen.getByLabelText(ja.topicLabel), " 追記");
    rerender(<Harness locale="en" />);
    const edited = screen.getByLabelText(en.topicLabel) as HTMLInputElement;
    expect(edited.value).toBe(`${HVAC_EXAMPLE_JA.topic} 追記`);
  });

  it("drops the export confirmation when the content changes", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "blob:thumbnail-test",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => undefined,
    });

    render(<Harness />);
    const copy = copyFor("en");
    await user.click(screen.getByRole("button", { name: copy.exportSvg }));
    expect(screen.getByText(copy.exportSuccessSvg)).toBeInTheDocument();

    await user.type(screen.getByLabelText(copy.headlineLabel), "!");
    expect(screen.queryByText(copy.exportSuccessSvg)).not.toBeInTheDocument();
  });
});
