import { test, expect } from '@playwright/test';

// Smoke test: the home page loads and renders without errors. FarmLedger has no app features yet; add a
// test for each feature (crops, livestock, ...) when it is built, not before.
test('the home page loads and renders without errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(`page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console error: ${m.text()}`); });
  const failed = [];
  page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

  const res = await page.goto('/');
  expect(res.status()).toBe(200);
  await expect(page).toHaveTitle('FarmLedger');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('FarmLedger');
  await expect(page.locator('body')).toBeVisible();
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});
