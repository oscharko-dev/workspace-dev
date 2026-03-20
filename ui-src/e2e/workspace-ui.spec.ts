import { test, expect } from "@playwright/test";

const desktopViewportMatrix = [
  { label: "1536x864", width: 1536, height: 864 },
  { label: "1920x1080", width: 1920, height: 1080 },
  { label: "2560x1440", width: 2560, height: 1440 }
] as const;

for (const viewport of desktopViewportMatrix) {
  test(`renders workspace shell at ${viewport.label}`, async ({ page }) => {
    const uiUrl = process.env.WORKSPACE_DEV_UI_URL ?? "http://127.0.0.1:19831/workspace/ui";
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(uiUrl);

    await expect(page.getByRole("heading", { name: "Workspace Dev" })).toBeVisible();
    await expect(page.locator('header img[src$="logo-keiko.svg"]')).toBeVisible();
    await expect(page.getByLabel("Figma file key")).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Generate" })).toBeVisible();

    const faviconUrl = new URL("/workspace/ui/favicon.svg", uiUrl).toString();
    const faviconResponse = await page.request.get(faviconUrl);
    expect(faviconResponse.ok()).toBeTruthy();

    const hasPageOverflow = await page.evaluate(() => {
      return {
        horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight
      };
    });
    expect(hasPageOverflow.horizontal).toBe(false);
    expect(hasPageOverflow.vertical).toBe(false);

    const inputCard = page.getByTestId("input-card");
    const runtimeCard = page.getByTestId("runtime-card");
    const inputBox = await inputCard.boundingBox();
    const runtimeBox = await runtimeCard.boundingBox();

    expect(inputBox).not.toBeNull();
    expect(runtimeBox).not.toBeNull();

    if (inputBox && runtimeBox) {
      expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(viewport.height);
      expect(runtimeBox.y + runtimeBox.height).toBeLessThanOrEqual(viewport.height);
    }

    const payloadContainers = page.locator('[data-testid$="-payload"]');
    const payloadContainerMetrics = await payloadContainers.evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = window.getComputedStyle(node);
        return {
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          height: node.getBoundingClientRect().height
        };
      })
    );

    expect(payloadContainerMetrics.length).toBeGreaterThanOrEqual(3);
    for (const metric of payloadContainerMetrics) {
      expect(["auto", "scroll"]).toContain(metric.overflowX);
      expect(["auto", "scroll"]).toContain(metric.overflowY);
      expect(metric.height).toBeGreaterThan(60);
    }
  });
}
