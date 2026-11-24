// The shared screens: operations, land with notes, contacts, supplies on hand, reminders on Today, money and print.
import { test, expect } from '@playwright/test';

const errorsOf = page => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
};

async function setUp(page, name = 'Prairie View Farm') {
  await page.goto('/');
  await page.getByLabel('Farm or ranch name').fill(name);
  await page.getByLabel('Your name').fill('Pat Example');
  await page.getByLabel('Crops').check();
  await page.getByLabel('Livestock').check();
  await page.getByRole('button', { name: 'Save and start' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

async function openMore(page, name) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'More' }).click();
  await page.getByRole('navigation', { name: 'More' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

const h1 = page => page.getByRole('heading', { level: 1 });

test('the More screen lists every shared record kind', async ({ page }) => {
  await setUp(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'More' }).click();
  await expect(h1(page)).toHaveText('More');
  await expect(page.getByRole('navigation', { name: 'More' }).getByRole('link').locator('b'))
    .toHaveText(['Land', 'Supplies', 'Contacts', 'Reminders', 'Money', 'People', 'Farm', 'Backup']);
});

test('operations: add a second one, switch between them, each keeps its own records, remove one', async ({ page }) => {
  const errors = errorsOf(page);
  await setUp(page);
  await openMore(page, 'Land');
  await page.getByRole('link', { name: 'Add land' }).click();
  await page.getByLabel('Name').fill('North 80');
  await page.getByLabel('Used as').selectOption('field');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.rows li')).toHaveCount(1);

  await openMore(page, 'Farm');
  await page.getByRole('link', { name: 'Add another operation' }).click();
  await expect(h1(page)).toHaveText('Add another operation');
  await page.getByLabel('Farm or ranch name').fill('Creek Partnership');
  await page.getByLabel('Your name').fill('Pat Example');
  await page.getByLabel('Livestock').check();
  await page.getByRole('button', { name: 'Start this operation' }).click();
  await expect(h1(page)).toHaveText('Creek Partnership');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Home', 'Herd', 'More']);

  await openMore(page, 'Land');
  await expect(page.getByText('No land yet.')).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
  await page.getByLabel('Operation').selectOption({ label: 'Prairie View Farm' });
  await expect(h1(page)).toHaveText('Prairie View Farm');
  await openMore(page, 'Land');
  await expect(page.locator('.rows li')).toHaveText([/North 80/]);

  await page.reload(); // the choice is remembered
  await expect(h1(page)).toHaveText('Land');
  await openMore(page, 'Farm');
  const creek = page.locator('.people li', { hasText: 'Creek Partnership' });
  const remove = creek.getByRole('button', { name: 'Remove' });
  await remove.click();
  await expect(remove).toHaveText('Tap again: removes all its records');
  await remove.click();
  await expect(page.locator('.people li')).toHaveCount(1);
  await expect(page.locator('.people li').getByRole('button', { name: 'Remove' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('land: errors, edit, notes with a photo, delete', async ({ page }) => {
  const errors = errorsOf(page);
  await setUp(page);
  await openMore(page, 'Land');
  await page.getByRole('link', { name: 'Add land' }).click();
  await page.getByLabel('Acres (optional)').fill('-3');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Name is needed.')).toBeVisible();
  await expect(page.getByText('Acres must be 0 or more.')).toBeVisible();
  await expect(page.getByLabel('Name')).toBeFocused();
  await page.getByLabel('Name').fill('Creek pasture');
  await page.getByLabel('Used as').selectOption('pasture');
  await page.getByLabel('Acres (optional)').fill('160');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: /Creek pasture/ }).click();
  await expect(h1(page)).toHaveText('Creek pasture');

  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Type a note or add a photo.')).toBeVisible();
  await page.getByLabel('Add a note').fill('Fence down on the north side');
  // a 2×2 red PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');
  await page.locator('input[name="photo"]').setInputFiles({ name: 'fence.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Photo added.')).toBeVisible();
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.notes li')).toHaveCount(1);
  await expect(page.locator('.notes li')).toContainText('Fence down on the north side');
  await expect(page.locator('.notes img')).toHaveAttribute('src', /^data:image\/jpeg/);

  await page.getByLabel('Name').fill('Creek pasture (west)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('.rows li')).toHaveText([/Creek pasture \(west\)/]);
  await page.getByRole('link', { name: /Creek pasture/ }).click();
  const del = page.locator('#delRec'); // its label changes after the first tap
  await del.click(); await del.click();
  await expect(page.getByText('No land yet.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('supplies: label details by kind, stock in and out, on hand and lot numbers', async ({ page }) => {
  await setUp(page);
  await openMore(page, 'Supplies');
  await page.getByRole('link', { name: 'Add a supply' }).click();
  await page.getByLabel('Name').fill('Bovi-Shield Gold 5');
  await page.getByLabel('Kind').selectOption('vaccine');
  await expect(page.getByLabel('Meat withdrawal, days (optional)')).toBeVisible();
  await expect(page.getByLabel('Re-entry interval, hours (optional)')).toBeHidden();
  await page.getByLabel('Kind').selectOption('chemical');
  await expect(page.getByLabel('Re-entry interval, hours (optional)')).toBeVisible();
  await expect(page.getByLabel('Meat withdrawal, days (optional)')).toBeHidden();
  await page.getByLabel('Kind').selectOption('vaccine');
  await page.getByLabel('Counted in').selectOption('dose');
  await page.getByLabel('Meat withdrawal, days (optional)').fill('21');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.rows li')).toContainText(['0 doses on hand']);
  await page.getByRole('link', { name: /Bovi-Shield/ }).click();

  const stock = page.locator('#stockForm');
  await stock.getByLabel('In or out').selectOption('in');
  await stock.getByLabel('Amount').fill('50');
  await stock.getByLabel('Lot number (optional)').fill('A123');
  await stock.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'On hand: 50 doses' })).toBeVisible();
  await stock.getByLabel('In or out').selectOption('out');
  await stock.getByLabel('Amount').fill('12');
  await stock.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'On hand: 38 doses' })).toBeVisible();
  await expect(page.getByText('Lot numbers: A123')).toBeVisible();
  await openMore(page, 'Supplies');
  await expect(page.locator('.rows li')).toContainText(['38 doses on hand']);
});

test('reminders show on Today, overdue ones first, and can be marked done from there', async ({ page }) => {
  await setUp(page);
  await page.getByRole('link', { name: 'Add a reminder' }).click();
  await page.getByLabel('What').fill('Preg check the heifers');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(h1(page)).toHaveText('Reminders');
  await page.getByRole('link', { name: 'Add a reminder' }).click();
  await page.getByLabel('What').fill('Pay cash rent');
  await page.getByLabel('When').fill('2020-03-01');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Home' }).click();
  const today = page.locator('.today li');
  await expect(today).toHaveCount(2);
  await expect(today.first()).toContainText('Pay cash rent');
  await expect(today.first()).toContainText('was due Mar 1, 2020');
  await today.first().getByRole('button', { name: 'Done' }).click();
  await expect(today).toHaveCount(1);
  await expect(today).toContainText('Preg check the heifers');

  await openMore(page, 'Reminders');
  await expect(page.getByRole('heading', { name: 'Done' })).toBeVisible();
  await expect(page.locator('.rows').last()).toContainText('Pay cash rent');
});

test('money: categories follow in or out, amounts in dollars, year totals, contacts; print', async ({ page }) => {
  const errors = errorsOf(page);
  await setUp(page);
  await openMore(page, 'Contacts');
  await page.getByRole('link', { name: 'Add a contact' }).click();
  await page.getByLabel('Name').fill('Sioux Falls Regional Livestock');
  await page.getByLabel('Sale barn').check();
  await page.getByLabel('Email (optional)').fill('nope');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/email/i).locator('visible=true').filter({ hasText: /look/ })).toBeVisible();
  await page.getByLabel('Email (optional)').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.rows li')).toHaveText([/Sioux Falls Regional Livestock/]);

  await openMore(page, 'Money');
  await expect(page.getByText(`No money entries in ${new Date().getFullYear()}.`)).toBeVisible();
  await page.getByRole('link', { name: 'Add money in or out' }).click();
  await page.getByLabel('Money in or out').selectOption('income');
  await expect(page.getByLabel('Category').locator('option')).toContainText(['Cattle sales']);
  await page.getByLabel('Category').selectOption('Cattle sales');
  await page.getByLabel('Amount').fill('24,500.00');
  await page.getByLabel('Paid to or by (optional)').selectOption({ label: 'Sioux Falls Regional Livestock' });
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Add money in or out' }).click();
  await page.getByLabel('Money in or out').selectOption('expense');
  await expect(page.getByLabel('Category').locator('option')).not.toContainText(['Cattle sales']);
  await page.getByLabel('Category').selectOption('Vet and medicine');
  await page.getByLabel('Amount').fill('0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Amount must be more than $0.')).toBeVisible();
  await page.getByLabel('Amount').fill('450.25');
  await page.getByRole('button', { name: 'Save' }).click();

  const totals = page.locator('.totals');
  await expect(totals).toContainText('$24,500.00');
  await expect(totals).toContainText('$450.25');
  await expect(totals.locator('.net')).toContainText('$24,049.75');
  await expect(page.locator('.rows li')).toHaveCount(2);

  await page.evaluate(() => { window.printed = 0; window.print = () => { window.printed++; }; });
  await page.getByRole('button', { name: 'Print' }).click();
  expect(await page.evaluate(() => window.printed)).toBe(1);
  await expect(page.locator('#printHead')).toHaveText(/^Prairie View Farm · Money · printed /);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await expect(page.locator('.appbar')).toBeHidden();
  await expect(page.locator('#printHead')).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
  expect(errors).toEqual([]);
});
