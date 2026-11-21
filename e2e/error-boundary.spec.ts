import { test, expect } from '@playwright/test';

test.describe('error boundaries', () => {
  test('global error boundary shows fallback message and reload button for empty error message', async ({ page }) => {
    await page.goto('/__test/global-error-empty');

    await expect(page.getByRole('alert')).toContainText('Something went wrong');
    await expect(page.getByRole('button', { name: /reload/i })).toBeVisible();
  });

  test('route error boundary shows fallback message and reload button for empty error message', async ({ page }) => {
    await page.goto('/__test/error-empty');

    await expect(page.getByRole('alert')).toContainText('Something went wrong');
    await expect(page.getByRole('button', { name: /reload/i })).toBeVisible();
  });
});
