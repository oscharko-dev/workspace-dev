import { expect, test, type Page } from "@playwright/test";
import { openWorkspaceUi, resetBrowserStorage } from "./helpers";

/**
 * WCAG 2.2 SC 2.4.7 (Focus Visible, AA) regression coverage for the workspace
 * form inputs and pipeline selector. Issue #1661 caught these controls
 * shipping with `outline-none focus:border-[#4eba87]`, where the only focus
 * cue was a low-contrast border colour swap that keyboard users with low
 * vision could not perceive. The fix mirrors PR #1709 (issue #1700, inspector
 * splitter) and adds a `focus-visible:outline-2 focus-visible:outline-[#4eba87]
 * focus-visible:outline-offset-1` indicator on every affected control.
 *
 * Browsers only apply `:focus-visible` styles when the user-agent's focus
 * modality is "keyboard"; programmatic `.focus()` calls do not flip that
 * flag. The tests therefore drive each control into focus through real
 * `Tab` key presses (`page.keyboard.press`) and inspect the resulting
 * computed outline.
 */

const VIEWPORT = { width: 1536, height: 864 } as const;

// #4eba87 — the workspace green outline colour applied by Tailwind
const FOCUS_OUTLINE_COLOR_RGB = "rgb(78, 186, 135)";

// Maximum tab steps we are willing to walk before giving up on a target.
// Generous to allow for hidden runtime tabstops; the form has fewer than 30
// focusable elements end-to-end.
const MAX_TAB_STEPS = 60;

const ALWAYS_VISIBLE_FORM_IDS = [
  "figma-source-mode",
  "figma-file-key",
  "figma-access-token",
] as const;

const ADVANCED_SECTION_FORM_IDS = [
  "repo-url",
  "repo-token",
  "project-name",
  "target-path",
  "storybook-static-dir",
  "customer-profile-path",
] as const;

interface FocusOutline {
  readonly id: string;
  readonly outlineStyle: string;
  readonly outlineWidth: number;
  readonly outlineColor: string;
}

async function blurActiveElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && active instanceof HTMLElement) {
      active.blur();
    }
  });
}

async function tabUntilFocused(
  page: Page,
  targetId: string,
): Promise<FocusOutline> {
  for (let step = 0; step < MAX_TAB_STEPS; step += 1) {
    await page.keyboard.press("Tab");
    const result = await page.evaluate(() => {
      const node = document.activeElement;
      if (!(node instanceof HTMLElement)) {
        return null;
      }
      const cs = window.getComputedStyle(node);
      return {
        id: node.id,
        outlineStyle: cs.outlineStyle,
        outlineWidth: Number.parseFloat(cs.outlineWidth) || 0,
        outlineColor: cs.outlineColor,
      };
    });
    if (result && result.id === targetId) {
      return result;
    }
  }
  throw new Error(
    `Failed to tab onto #${targetId} after ${String(MAX_TAB_STEPS)} steps`,
  );
}

function expectVisibleFocusOutline(outline: FocusOutline): void {
  expect
    .soft(outline.outlineStyle, `${outline.id}: outline-style`)
    .not.toBe("none");
  expect
    .soft(outline.outlineWidth, `${outline.id}: outline-width >= 2px`)
    .toBeGreaterThanOrEqual(2);
  expect
    .soft(
      outline.outlineColor.replace(/\s+/g, ""),
      `${outline.id}: outline-color #4eba87`,
    )
    .toBe(FOCUS_OUTLINE_COLOR_RGB.replace(/\s+/g, ""));
}

test.describe("workspace form focus indicator (WCAG 2.4.7)", () => {
  test.afterEach(async ({ page }) => {
    await resetBrowserStorage(page);
  });

  test("primary form controls expose a 2px focus-visible outline in the workspace green", async ({
    page,
  }) => {
    await openWorkspaceUi(page, VIEWPORT);

    for (const fieldId of ALWAYS_VISIBLE_FORM_IDS) {
      await expect(page.locator(`#${fieldId}`)).toBeVisible();
    }

    // Restart from <body> so the tab walk is deterministic across runs.
    await blurActiveElement(page);

    for (const fieldId of ALWAYS_VISIBLE_FORM_IDS) {
      const outline = await tabUntilFocused(page, fieldId);
      expectVisibleFocusOutline(outline);
    }
  });

  test("advanced form controls expose a 2px focus-visible outline once expanded", async ({
    page,
  }) => {
    await openWorkspaceUi(page, VIEWPORT);

    await page
      .getByRole("button", {
        name: /advanced destination and git \/ pr options/i,
      })
      .click();

    // `repo-url` and `repo-token` are `disabled` until Git/PR is enabled,
    // and disabled inputs are skipped by the keyboard tab order. Enabling
    // the checkbox here ensures every advanced control is reachable.
    await page.locator("#enable-git-pr").check();

    for (const fieldId of ADVANCED_SECTION_FORM_IDS) {
      await expect(page.locator(`#${fieldId}`)).toBeVisible();
      await expect(page.locator(`#${fieldId}`)).toBeEnabled();
    }

    await blurActiveElement(page);

    for (const fieldId of ADVANCED_SECTION_FORM_IDS) {
      const outline = await tabUntilFocused(page, fieldId);
      expectVisibleFocusOutline(outline);
    }
  });
});
