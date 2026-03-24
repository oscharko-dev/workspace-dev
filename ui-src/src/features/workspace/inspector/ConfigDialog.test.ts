import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Fragment, createElement } from "react";
import { ConfigDialog } from "./ConfigDialog";

afterEach(() => {
  cleanup();
});

describe("ConfigDialog", () => {
  it("returns null when closed", () => {
    const { container } = render(
      createElement(ConfigDialog, {
        open: false,
        onClose: vi.fn(),
        title: "Test dialog"
      })
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders dialog semantics and labels the title", () => {
    render(
      createElement(
        ConfigDialog,
        {
          open: true,
          onClose: vi.fn(),
          title: "Test dialog"
        },
        createElement("p", null, "Body")
      )
    );

    const overlay = screen.getByTestId("config-dialog-overlay");
    const title = screen.getByText("Test dialog");

    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-labelledby")).toBe(title.getAttribute("id"));
  });

  it("moves focus into the dialog when opened", async () => {
    render(
      createElement(
        ConfigDialog,
        {
          open: true,
          onClose: vi.fn(),
          title: "Focus dialog"
        },
        createElement("input", { "data-testid": "dialog-input" })
      )
    );

    await waitFor(() => {
      expect(screen.getByTestId("config-dialog-close")).toHaveFocus();
    });
  });

  it("restores focus to the previously focused element when closed", async () => {
    const handleClose = vi.fn();
    const { rerender } = render(
      createElement(
        Fragment,
        null,
        createElement("button", { type: "button", "data-testid": "dialog-trigger" }, "Open dialog"),
        createElement(
          ConfigDialog,
          {
            open: false,
            onClose: handleClose,
            title: "Restore focus dialog"
          },
          createElement("p", null, "Body")
        )
      )
    );

    const trigger = screen.getByTestId("dialog-trigger");
    trigger.focus();
    expect(trigger).toHaveFocus();

    rerender(
      createElement(
        Fragment,
        null,
        createElement("button", { type: "button", "data-testid": "dialog-trigger" }, "Open dialog"),
        createElement(
          ConfigDialog,
          {
            open: true,
            onClose: handleClose,
            title: "Restore focus dialog"
          },
          createElement("p", null, "Body")
        )
      )
    );

    await waitFor(() => {
      expect(screen.getByTestId("config-dialog-close")).toHaveFocus();
    });

    rerender(
      createElement(
        Fragment,
        null,
        createElement("button", { type: "button", "data-testid": "dialog-trigger" }, "Open dialog"),
        createElement(
          ConfigDialog,
          {
            open: false,
            onClose: handleClose,
            title: "Restore focus dialog"
          },
          createElement("p", null, "Body")
        )
      )
    );

    expect(screen.getByTestId("dialog-trigger")).toHaveFocus();
  });

  it("calls onClose on Escape and backdrop click, but not panel click", () => {
    const onClose = vi.fn();
    render(
      createElement(
        ConfigDialog,
        {
          open: true,
          onClose,
          title: "Dismiss dialog"
        },
        createElement("button", { type: "button" }, "Action")
      )
    );

    const overlay = screen.getByTestId("config-dialog-overlay");
    const panel = screen.getByTestId("config-dialog-panel");

    fireEvent.keyDown(overlay, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(panel);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("traps focus within the dialog", async () => {
    render(
      createElement(
        ConfigDialog,
        {
          open: true,
          onClose: vi.fn(),
          title: "Trap focus dialog"
        },
        createElement("input", { "data-testid": "dialog-input" })
      )
    );

    const overlay = screen.getByTestId("config-dialog-overlay");
    const closeButton = screen.getByTestId("config-dialog-close");
    const input = screen.getByTestId("dialog-input");

    await waitFor(() => {
      expect(closeButton).toHaveFocus();
    });

    input.focus();
    expect(input).toHaveFocus();
    fireEvent.keyDown(overlay, { key: "Tab" });
    expect(closeButton).toHaveFocus();

    closeButton.focus();
    fireEvent.keyDown(overlay, { key: "Tab", shiftKey: true });
    expect(input).toHaveFocus();
  });
});
