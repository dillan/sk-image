import { test } from '@playwright/test';
import { shot } from './harness';

// The plugin serves the web app at /sk-image (signalk-webapp keyword).
const APP = '/sk-image/';

test('library grid', async ({ page }) => {
  await page.goto(`${APP}#/library`);
  await page.getByRole('heading', { name: 'Image library' }).waitFor();
  await page.locator('.tile').first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(800); // let thumbnails paint
  await shot(page, 'library');
});

test('image detail + EXIF', async ({ page }) => {
  await page.goto(`${APP}#/library`);
  await page.getByRole('heading', { name: 'Image library' }).waitFor();
  await page.locator('.tile', { hasText: 'anchorage' }).first().click();
  await page.locator('.drawer__panel').waitFor();
  await page.waitForTimeout(800);
  await shot(page, 'image-detail', '.drawer__panel');
});

test('collections', async ({ page }) => {
  await page.goto(`${APP}#/collections`);
  await page.getByRole('heading', { name: 'Collections' }).waitFor();
  await page.getByText('Deck & rigging').waitFor();
  await page.waitForTimeout(500);
  await shot(page, 'collections');
});

test('settings — image cache', async ({ page }) => {
  await page.goto(`${APP}#/settings`);
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await page.locator('.panel__title', { hasText: 'Image cache' }).waitFor();
  await page.waitForTimeout(500);
  await shot(page, 'settings');
});
