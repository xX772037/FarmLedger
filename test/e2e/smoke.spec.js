import { test, expect } from '@playwright/test';

// Smoke test: the app loads and renders without errors. On a device with no farm yet, that's the setup screen.
test('the app loads, renders without errors, and opens on setup for a new device', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(`page error: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console error: ${m.text()}`); });
  const failed = [];
  page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

  const res = await page.goto('/');
  expect(res.status()).toBe(200);
  await expect(page).toHaveTitle('FarmLedger');
  await expect(page.getByRole('link', { name: 'FarmLedger home' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set up your farm');
  expect(failed).toEqual([]);
  expect(errors).toEqual([]);
});
