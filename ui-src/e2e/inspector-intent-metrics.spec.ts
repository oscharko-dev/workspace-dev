import { expect, test, type Page } from "@playwright/test";
import {
  getWorkspaceUiUrl,
  resetBrowserStorage,
  simulateInspectorPaste,
} from "./helpers";

const BOOTSTRAP_VIEWPORT = { width: 1440, height: 1024 } as const;
const MAX_MISCLASSIFICATION_RATE = 0.05;

const INSPECTOR_URL = (() => {
  const base = new URL(getWorkspaceUiUrl());
  base.pathname = base.pathname.replace(
    /\/workspace\/ui\/?$/,
    "/workspace/ui/inspector",
  );
  return base.toString();
})();

const INTENT_METRICS_URL = (() => {
  const base = new URL(getWorkspaceUiUrl());
  base.pathname = base.pathname.replace(
    /\/workspace\/ui\/?$/,
    "/workspace/ui/inspector/intent-metrics",
  );
  return base.toString();
})();

const FIGMA_DOC_JSON = JSON.stringify({
  document: {
    id: "0:0",
    type: "DOCUMENT",
    name: "Doc",
    children: [],
  },
  schemaVersion: "JSON_REST_V1",
});

const PLUGIN_EXPORT_JSON = JSON.stringify({
  type: "PLUGIN_EXPORT",
  nodes: [{ type: "FRAME", name: "Card" }],
});

const PLAIN_JSON_PAYLOAD = JSON.stringify({ greeting: "hello world" });
const PLAIN_TEXT_PAYLOAD = "hello world";

const SAMPLE_CASES = [
  {
    payload: FIGMA_DOC_JSON,
    expectedLabel: "Figma-Dokument JSON",
  },
  {
    payload: PLUGIN_EXPORT_JSON,
    expectedLabel: "Figma-Node JSON",
  },
  {
    payload: PLAIN_JSON_PAYLOAD,
    expectedLabel: "Code / Text",
  },
  {
    payload: PLAIN_TEXT_PAYLOAD,
    expectedLabel: "Code / Text",
  },
] as const;

async function gotoInspector(page: Page): Promise<void> {
  await page.setViewportSize(BOOTSTRAP_VIEWPORT);
  await page.goto(INSPECTOR_URL);
  await expect(page.getByTestId("inspector-bootstrap")).toBeVisible();
}

async function gotoIntentMetrics(page: Page): Promise<void> {
  await page.goto(INTENT_METRICS_URL);
  await expect(page.getByTestId("intent-metrics-page")).toBeVisible();
}

test.describe("inspector intent metrics", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test.afterEach(async ({ page }) => {
    await resetBrowserStorage(page);
  });

  test("keeps representative E2E misclassification under five percent and exposes the local diagnostics route", async ({
    page,
  }) => {
    let mismatches = 0;
    const runCount = 5;
    const expectedTotalClassifications = SAMPLE_CASES.length * runCount;

    await gotoInspector(page);

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      for (const sample of SAMPLE_CASES) {
        await simulateInspectorPaste(page, sample.payload);

        const banner = page.getByTestId("smart-banner");
        await expect(banner).toBeVisible({ timeout: 5_000 });

        const observedLabel =
          (await banner.locator("span.font-semibold").textContent())?.trim() ??
          "";
        if (observedLabel !== sample.expectedLabel) {
          mismatches += 1;
        }

        await banner.getByRole("button", { name: "Banner schliessen" }).click();
        await expect(page.getByTestId("smart-banner")).toHaveCount(0);
      }
    }

    const observedRate = mismatches / expectedTotalClassifications;
    expect(observedRate).toBeLessThanOrEqual(MAX_MISCLASSIFICATION_RATE);

    await gotoIntentMetrics(page);

    await expect(
      page.getByTestId("intent-metrics-total-classifications"),
    ).toContainText(String(expectedTotalClassifications));
    await expect(
      page.getByTestId("intent-metrics-total-corrections"),
    ).toContainText("0");
    await expect(
      page.getByTestId("intent-metrics-misclassification-rate"),
    ).toContainText("0.00%");
    await expect(
      page.getByTestId("intent-metrics-threshold-status"),
    ).toContainText("Pass");
    await expect(page.getByTestId("intent-metrics-events")).toBeVisible();
  });
});
