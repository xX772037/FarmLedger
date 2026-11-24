import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('after one visit the app opens with no network, with the farm still there', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByLabel('Farm or ranch name').fill('Offline Farm');
  await page.getByLabel('Your name').fill('Pat Example');
  await page.getByLabel('Crops').check();
  await page.getByRole('button', { name: 'Save and start' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offline Farm');
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Offline Farm');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'More' }).click();
  await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: /^Farm/ }).click();
  await page.getByLabel('County').fill('Davison');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await context.setOffline(false);
});
