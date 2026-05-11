import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { ScreenshotPreview } from "./ScreenshotPreview";

afterEach(() => {
  cleanup();
});

describe("ScreenshotPreview — rendering", () => {
  it("renders image with correct src and alt", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    expect(
      screen.getByRole("img", { name: "Figma design preview" }),
    ).toHaveAttribute("src", "http://cdn.example.com/shot.png");
  });

  it("renders default badge text 'Figma preview'", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    expect(screen.getByText("Figma preview")).toBeInTheDocument();
  });

  it("renders custom badgeText when provided", () => {
    render(
      <ScreenshotPreview
        screenshotUrl="http://cdn.example.com/shot.png"
        badgeText="Custom badge"
      />,
    );

    expect(screen.getByText("Custom badge")).toBeInTheDocument();
    expect(screen.queryByText("Figma preview")).not.toBeInTheDocument();
  });

  it("renders stageName when provided", () => {
    render(
      <ScreenshotPreview
        screenshotUrl="http://cdn.example.com/shot.png"
        stageName="Generating code…"
      />,
    );

    expect(screen.getByText("Generating code…")).toBeInTheDocument();
  });

  it("does not render stage div when stageName is absent", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    expect(screen.queryByText("Generating code…")).not.toBeInTheDocument();
    expect(screen.queryByText("Resolving design…")).not.toBeInTheDocument();
  });
});

describe("ScreenshotPreview — zoom controls", () => {
  it("renders zoom percent label at 100% by default", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    expect(
      screen.getByTestId("screenshot-preview-zoom-percent"),
    ).toHaveTextContent("100%");
  });

  it("zoom in button multiplies scale by 1.25 and updates percent label", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    fireEvent.click(screen.getByTestId("screenshot-preview-zoom-in"));

    expect(
      screen.getByTestId("screenshot-preview-zoom-percent"),
    ).toHaveTextContent("125%");
  });

  it("zoom out button divides scale by 1.25 and updates percent label", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    fireEvent.click(screen.getByTestId("screenshot-preview-zoom-out"));

    // 100 / 1.25 = 80
    expect(
      screen.getByTestId("screenshot-preview-zoom-percent"),
    ).toHaveTextContent("80%");
  });

  it("zoom in button is disabled once scale reaches MAX_SCALE", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    const zoomIn = screen.getByTestId("screenshot-preview-zoom-in");
    // Click many times to reach MAX_SCALE (5)
    for (let i = 0; i < 20; i++) {
      if (!zoomIn.hasAttribute("disabled")) {
        fireEvent.click(zoomIn);
      }
    }

    expect(zoomIn).toBeDisabled();
  });

  it("zoom out button is disabled once scale reaches MIN_SCALE", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    const zoomOut = screen.getByTestId("screenshot-preview-zoom-out");
    // Click many times to reach MIN_SCALE (0.1)
    for (let i = 0; i < 30; i++) {
      if (!zoomOut.hasAttribute("disabled")) {
        fireEvent.click(zoomOut);
      }
    }

    expect(zoomOut).toBeDisabled();
  });

  it("reset button restores percent to 100% and image transform to translate(0px, 0px) scale(1)", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    fireEvent.click(screen.getByTestId("screenshot-preview-zoom-in"));
    expect(
      screen.getByTestId("screenshot-preview-zoom-percent"),
    ).toHaveTextContent("125%");

    fireEvent.click(screen.getByTestId("screenshot-preview-zoom-reset"));

    expect(
      screen.getByTestId("screenshot-preview-zoom-percent"),
    ).toHaveTextContent("100%");
    expect(
      screen
        .getByRole("img", { name: "Figma design preview" })
        .style.getPropertyValue("--transform-translate-scale"),
    ).toBe("translate(0px, 0px) scale(1)");
  });
});

describe("ScreenshotPreview — wheel zoom", () => {
  it("wheel event with negative deltaY increases scale", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    const img = screen.getByRole("img", { name: "Figma design preview" });
    // The wheel listener is on the outermost container (two levels up from img)
    const container = img.parentElement?.parentElement;
    expect(container).not.toBeNull();

    act(() => {
      container!.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -100,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // toHaveStyle does not accept regex matchers; read the attribute directly
    expect(
      screen
        .getByRole("img", { name: "Figma design preview" })
        .getAttribute("style"),
    ).toMatch(/scale\(1\.\d+\)/);
  });

  it("wheel event with positive deltaY decreases scale", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    const img = screen.getByRole("img", { name: "Figma design preview" });
    const container = img.parentElement?.parentElement;
    expect(container).not.toBeNull();

    act(() => {
      container!.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: 200,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      screen
        .getByRole("img", { name: "Figma design preview" })
        .getAttribute("style"),
    ).toMatch(/scale\(0\.\d+\)/);
  });
});

describe("ScreenshotPreview — pointer drag pan", () => {
  it("dragging the image translates it by the pointer delta", () => {
    render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/shot.png" />,
    );

    const img = screen.getByRole("img", { name: "Figma design preview" });
    // Pointer handlers are on the outermost container (two levels up from img).
    // setPointerCapture is called on event.currentTarget which is that container.
    const container = img.parentElement?.parentElement;
    expect(container).not.toBeNull();

    // jsdom does not implement setPointerCapture; stub it on the container
    (container as HTMLDivElement).setPointerCapture = () => {};

    fireEvent.pointerDown(container!, {
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    fireEvent.pointerMove(container!, {
      clientX: 150,
      clientY: 120,
      pointerId: 1,
    });
    fireEvent.pointerUp(container!, { pointerId: 1 });

    expect(img.style.getPropertyValue("--transform-translate-scale")).toBe(
      "translate(50px, 20px) scale(1)",
    );
  });
});

describe("ScreenshotPreview — URL change reset", () => {
  it("resets zoom and pan when screenshotUrl prop changes", () => {
    const { rerender } = render(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/a.png" />,
    );

    fireEvent.click(screen.getByTestId("screenshot-preview-zoom-in"));
    expect(
      screen.getByTestId("screenshot-preview-zoom-percent"),
    ).toHaveTextContent("125%");

    rerender(
      <ScreenshotPreview screenshotUrl="http://cdn.example.com/b.png" />,
    );

    expect(
      screen.getByTestId("screenshot-preview-zoom-percent"),
    ).toHaveTextContent("100%");
    expect(
      screen
        .getByRole("img", { name: "Figma design preview" })
        .style.getPropertyValue("--transform-translate-scale"),
    ).toBe("translate(0px, 0px) scale(1)");
  });
});

describe("ScreenshotPreview — externalOffsetY", () => {
  it("applies externalOffsetY on top of user pan", () => {
    const { rerender } = render(
      <ScreenshotPreview
        screenshotUrl="http://cdn.example.com/a.png"
        externalOffsetY={50}
      />,
    );

    expect(
      screen
        .getByRole("img", { name: "Figma design preview" })
        .getAttribute("style"),
    ).toContain("translate(0px, 50px)");

    rerender(
      <ScreenshotPreview
        screenshotUrl="http://cdn.example.com/a.png"
        externalOffsetY={-30}
      />,
    );

    expect(
      screen
        .getByRole("img", { name: "Figma design preview" })
        .getAttribute("style"),
    ).toContain("translate(0px, -30px) scale(1)");
  });
});
