import { expect, test } from "@playwright/test";

test("QA realtime query is visibly identified and can be reset", async ({ page }) => {
  await page.goto("/?realtime=sse");
  await expect(page.getByRole("status", { name: "Realtime QA override: sse" })).toBeVisible();
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(page.getByRole("status", { name: "Realtime QA override: sse" })).toHaveCount(0);
});
