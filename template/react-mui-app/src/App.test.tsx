import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { resetRouteWarmupStateForTests, routeModuleLoaders } from "./routes/lazy-routes";

describe("App", () => {
  beforeEach(() => {
    window.location.hash = "#/";
    resetRouteWarmupStateForTests();
    vi.restoreAllMocks();
  });

  it("renders the eager home route by default", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Performance-first seed app" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview route" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Checkout route" })).toBeInTheDocument();
  });

  it("warms lazy route modules on pointer and keyboard intent without duplicate imports", () => {
    const overviewLoader = routeModuleLoaders.overview;
    const spy = vi.spyOn(routeModuleLoaders, "overview").mockImplementation(overviewLoader);

    render(<App />);

    const overviewLink = screen.getByRole("link", { name: "Overview route" });
    fireEvent.pointerEnter(overviewLink);
    fireEvent.focus(overviewLink);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("shows the suspense fallback before rendering a delayed lazy route", async () => {
    const actualOverviewLoader = routeModuleLoaders.overview;
    vi.spyOn(routeModuleLoaders, "overview").mockImplementation(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      return await actualOverviewLoader();
    });

    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole("link", { name: "Overview route" }));

    expect(screen.getByLabelText("Loading route content")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Overview dashboard" });
  });

  it("navigates to the checkout lazy route", async () => {
    const user = userEvent.setup();

    render(<App />);
    await user.click(screen.getByRole("link", { name: "Checkout route" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Checkout flow" })).toBeInTheDocument();
    });
  });
});
