import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const errorsOf = page => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
};

async function setUp(page, { name = 'Prairie View Farm', owner = 'Pat Example', county = 'Hutchinson', crops = true, livestock = true } = {}) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Set up your farm');
  await page.getByLabel('Farm or ranch name').fill(name);
  await page.getByLabel('Your name').fill(owner);
  await page.getByLabel('County').fill(county);
  if (crops) await page.getByLabel('Crops').check();
  if (livestock) await page.getByLabel('Livestock').check();
  await page.getByRole('button', { name: 'Save and start' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

/** Farm, People, Backup and the shared records are on the More screen. */
async function openMore(page, name) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'More' }).click();
  await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

test('setup catches what is missing, then opens the farm, which is still there after a reload', async ({ page }) => {
  const errors = errorsOf(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Save and start' }).click();
  await expect(page.getByText('Give your farm or ranch a name.')).toBeVisible();
  await expect(page.getByText('Type your name.')).toBeVisible();
  await expect(page.getByText('Tick crops, livestock, or both.')).toBeVisible();
  await expect(page.getByLabel('Farm or ranch name')).toBeFocused();
  await expect(page.getByLabel('Farm or ranch name')).toHaveAttribute('aria-invalid', 'true');

  await setUp(page);
  await expect(page.getByText('Pat Example · Hutchinson County, SD')).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Herd', 'Crops', 'More']);
  await expect(page.getByRole('heading', { name: 'Herd' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Crops' })).toBeVisible();
  await expect(page.getByText('Coming soon')).toHaveCount(2);
  await expect(page.getByText(/Nothing due in the next week/)).toBeVisible();
  await expect(page.getByText('Your records are saved on this device.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Prairie View Farm');
  await page.goto('/#/setup'); // setup can't be reached again once the farm exists
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Prairie View Farm');
  expect(errors).toEqual([]);
});

test('editing the farm: a crops-only farm hides Herd; the module page says coming soon', async ({ page }) => {
  await setUp(page);
  await page.getByRole('link', { name: 'Herd' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Herd');
  await expect(page.getByText('Coming soon.')).toBeVisible();

  await openMore(page, 'Farm');
  await expect(page.getByLabel('Farm or ranch name')).toHaveValue('Prairie View Farm');
  await page.getByLabel('Livestock').uncheck();
  await page.getByLabel('Total acres (optional)').fill('640');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Crops', 'More']);

  await page.goto('/#/herd'); // no longer offered: back to home
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Prairie View Farm');
  await expect(page.getByRole('heading', { name: 'Herd' })).toHaveCount(0);

  await openMore(page, 'Farm');
  await page.getByLabel('Crops').uncheck();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Tick crops, livestock, or both.')).toBeVisible();
});

test('people: the owner is listed; add a worker, catch a bad phone, keep the last owner, remove the worker', async ({ page }) => {
  await setUp(page);
  await openMore(page, 'People');
  const list = page.locator('.people li');
  await expect(list).toHaveCount(1);
  await expect(list.first()).toContainText('Pat Example');
  await expect(list.first()).toContainText('Owner');

  await page.getByLabel('Name').fill('Sam Hand');
  await page.getByLabel('Phone (optional)').fill('call me');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByText("That doesn't look like a phone number.")).toBeVisible();
  await page.getByLabel('Phone (optional)').fill('(605) 555-0100');
  await page.getByLabel('Role').selectOption('viewer');
  await expect(page.getByText('For a vet, agronomist, lender or landlord.')).toBeVisible();
  await page.getByLabel('Role').selectOption('worker');
  await page.getByRole('button', { name: 'Add person' }).click();
  await expect(list).toHaveCount(2);
  await expect(list.nth(1)).toContainText('Sam Hand');
  await expect(list.nth(1)).toContainText('Worker · (605) 555-0100');

  // the only owner can't be removed
  const ownerRemove = list.first().getByRole('button');
  await ownerRemove.click();
  await expect(ownerRemove).toHaveText('Tap again to remove');
  await ownerRemove.click();
  await expect(page.getByText('The farm needs at least one owner.')).toBeVisible();
  await expect(list).toHaveCount(2);

  const samRemove = list.nth(1).getByRole('button');
  await samRemove.click();
  await samRemove.click();
  await expect(list).toHaveCount(1);
});

test('backup: download, then restore on a fresh device straight from the setup screen', async ({ page, browser }) => {
  await setUp(page, { name: 'Backup Test Ranch', crops: false });
  await openMore(page, 'People');
  await page.getByLabel('Name').fill('Sam Hand');
  await page.getByRole('button', { name: 'Add person' }).click();
  await openMore(page, 'Backup');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^FarmLedger-backup-Backup-Test-Ranch-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await dl.path();
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup.app).toBe('FarmLedger');
  expect(backup.records.filter(r => r.type === 'person')).toHaveLength(2);

  // A new phone: empty storage. Restore without setting up a farm first.
  const fresh = await browser.newContext();
  const p2 = await fresh.newPage();
  await p2.goto('/');
  await expect(p2.getByRole('heading', { level: 1 })).toHaveText('Set up your farm');
  await p2.locator('#restoreFile').setInputFiles({ name: 'not-a-backup.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(p2.getByText('This file is not a FarmLedger backup.')).toBeVisible();
  await p2.locator('#restoreFile').setInputFiles(file);
  await expect(p2.getByText(/Backup of Backup Test Ranch from .+, with 3 records\./)).toBeVisible();
  const go = p2.locator('#restoreGo'); // its label changes after the first tap
  await expect(go).toHaveText("Replace this device's records");
  await go.click();
  await expect(go).toHaveText('Tap again to replace');
  await go.click();
  await expect(p2.getByRole('heading', { level: 1 })).toHaveText('Backup Test Ranch');
  await expect(p2.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Home', 'Herd', 'More']);
  await openMore(p2, 'People');
  await expect(p2.locator('.people li')).toHaveCount(2);
  await fresh.close();
});

test('text a person types is shown as text, never run as code', async ({ page }) => {
  const errors = errorsOf(page);
  await setUp(page, { name: '<img src=x onerror="window.hacked=1">Farm', owner: '<b>Bold</b>' });
  await expect(page.getByText('<b>Bold</b>', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  expect(await page.locator('main img').count()).toBe(0);
  expect(errors).toEqual([]);
});

test('every screen fits a phone: no sideways scrolling, and buttons and fields are at least 44 px tall', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  const check = async where => {
    const r = await page.evaluate(() => ({
      wide: document.documentElement.scrollWidth,
      small: [...document.querySelectorAll('main button, main input:not([type=checkbox]):not([type=file]), main select, main a.btn, main label.btn, nav a')]
        .filter(e => e.offsetParent).map(e => [e.textContent.trim().slice(0, 20) || e.name, Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 44),
    }));
    expect(r.wide, `${where}: page width`).toBeLessThanOrEqual(360);
    expect(r.small, `${where}: small tap targets`).toEqual([]);
  };
  await check('setup');
  await setUp(page);
  for (const where of ['', 'herd', 'more', 'farm', 'people', 'backup', 'land', 'land/new', 'contacts/new', 'supplies/new', 'reminders/new', 'money', 'money/new', 'setup/new']) {
    await page.goto(`/#/${where}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await check(where || 'home');
  }
});
