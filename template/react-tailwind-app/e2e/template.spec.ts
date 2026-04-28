import { expect, test } from "@playwright/test";

test("renders the Tailwind template shell in a real browser", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "React, TypeScript, Vite, and Tailwind ready for generated apps.",
    }),
  ).toBeVisible();
  await expect(page.getByText("WorkspaceDev default template")).toBeVisible();
  await expect(page.getByText("Components", { exact: true })).toBeVisible();
  await expect(page.getByText("Views", { exact: true })).toBeVisible();
  await expect(page.getByText("Checks", { exact: true })).toBeVisible();
});
