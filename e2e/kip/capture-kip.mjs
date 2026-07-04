// Captures a screenshot of the KIP "Image" widget configuration dialog for the SK Image docs.
//
// It boots a built KIP app (served by serve-kip.mjs) pointed at a running SK Image server, seeds a
// dashboard holding one pre-configured Image widget, opens that widget's options dialog, and writes
// the result as WebP into ../../docs/images/. See ../capture-kip.sh for the full flow and README.md.
//
// The KIP app must be built from a branch that ships the Image widget (requiredPlugins: ['sk-image']).
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// document/KeyboardEvent are used inside page.evaluate() callbacks (browser context).
/* global document, KeyboardEvent */

const here = dirname(fileURLToPath(import.meta.url));
const SK = process.env.SIGNALK_URL || 'http://localhost:3007';
const KIP = process.env.KIP_URL || 'http://localhost:4300/@mxtommy/kip/';
const OUT = join(here, '..', '..', 'docs', 'images', 'kip-widget-config.webp');
mkdirSync(dirname(OUT), { recursive: true });

// A complete, valid KIP local config. All four keys are seeded so KIP boots straight to a dashboard
// holding one configured Image widget — no tutorial, no add-widget gesture, no plugin-install prompt.
const UNITS = {
  Unitless: 'unitless',
  Speed: 'knots',
  Flow: 'l/h',
  Temperature: 'celsius',
  Length: 'm',
  Volume: 'liter',
  Current: 'A',
  Potential: 'V',
  Charge: 'C',
  Power: 'W',
  Energy: 'J',
  Pressure: 'mmHg',
  'Fuel Distance': 'nm/l',
  'Energy Distance': 'nm/kWh',
  Density: 'kg/m3',
  Time: 'Hours',
  'Angular Velocity': 'deg/min',
  Angle: 'deg',
  Frequency: 'Hz',
  Ratio: 'ratio',
  Resistance: 'ohm',
};
const NOTIF = {
  disableNotifications: false,
  menuGrouping: true,
  security: { disableSecurity: true },
  devices: { disableDevices: false, showNormalState: false, showNominalState: false },
  sound: {
    disableSound: false,
    muteNormal: true,
    muteNominal: true,
    muteWarn: true,
    muteAlert: false,
    muteAlarm: false,
    muteEmergency: false,
  },
};
const APP = {
  configVersion: 12,
  autoNightMode: false,
  redNightMode: false,
  nightModeBrightness: 0.27,
  isRemoteControl: false,
  instanceName: '',
  dataSets: [],
  unitDefaults: UNITS,
  notificationConfig: NOTIF,
  splitShellEnabled: true,
  splitShellSide: 'left',
  splitShellSwipeDisabled: false,
  splitShellWidth: 0.5,
};
const CONN = {
  configVersion: 12,
  kipUUID: 'kip-docs',
  signalKUrl: SK,
  proxyEnabled: false,
  signalKSubscribeAll: false,
  useDeviceToken: false,
  loginName: null,
  loginPassword: null,
  useSharedConfig: false,
  sharedConfigName: 'default',
};
const WID = '22222222-2222-4222-8222-222222222222';

async function main() {
  const imgs = await (await fetch(`${SK}/plugins/sk-image/images`)).json();
  if (!Array.isArray(imgs) || imgs.length === 0)
    throw new Error('No seeded images found — run the seed first.');
  const pick = imgs.find((i) => /deck-plan/.test(i.name)) || imgs[0];

  const dashboards = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Image',
      icon: 'dashboard-dashboard',
      configuration: [
        {
          w: 12,
          h: 18,
          id: WID,
          selector: 'widget-host2',
          x: 0,
          y: 0,
          input: {
            widgetProperties: {
              type: 'widget-image',
              uuid: WID,
              config: {
                displayName: 'Image',
                image: {
                  imageId: pick.id,
                  imageFit: 'contain',
                  altText: pick.name,
                  backgroundColor: null,
                },
              },
            },
          },
        },
      ],
    },
  ];

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1360, height: 1440 },
      deviceScaleFactor: 2,
      serviceWorkers: 'block',
    });
    await ctx.addInitScript(
      (seed) => {
        for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
      },
      {
        connectionConfig: CONN,
        appConfig: APP,
        themeConfig: { themeName: '' },
        dashboardsConfig: dashboards,
      },
    );

    const page = await ctx.newPage();
    await page.goto(KIP, { waitUntil: 'domcontentloaded' });
    await page.locator('.widget-container').first().waitFor({ timeout: 20000 });
    await page
      .locator('.image-widget-img')
      .first()
      .waitFor({ timeout: 10000 })
      .catch(() => {});
    await page.waitForTimeout(1500);

    // Unlock the dashboard: dispatch the Ctrl+ArrowLeft keydown KIP listens for to open the actions
    // menu (reliable via the document listener), then click the unlock (layout) button.
    await page.evaluate(() =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', ctrlKey: true, bubbles: true }),
      ),
    );
    const unlock = page.locator('button:has-text("lock_open")').first();
    await unlock.waitFor({ state: 'visible', timeout: 8000 });
    await unlock.click();
    await page.waitForTimeout(1200);

    // Open the widget's options: the gesture directive listens for a custom `doubletap` event.
    await page
      .locator('.widget-container')
      .first()
      .evaluate((el) =>
        el.dispatchEvent(new CustomEvent('doubletap', { bubbles: true, detail: {} })),
      );
    await page
      .locator('modal-widget-config')
      .first()
      .waitFor({ timeout: 8000 })
      .catch(async () => {
        await page
          .locator('.widget-container')
          .first()
          .dblclick()
          .catch(() => {});
        await page.locator('modal-widget-config').first().waitFor({ timeout: 8000 });
      });
    await page
      .locator('.image-setup__thumb img')
      .first()
      .waitFor({ timeout: 8000 })
      .catch(() => {});
    await page
      .locator('.image-setup__preview')
      .first()
      .waitFor({ timeout: 6000 })
      .catch(() => {});
    await page.waitForTimeout(1500);

    const state = await page.evaluate(() => ({
      thumbs: document.querySelectorAll('.image-setup__thumb').length,
      selected: document.querySelectorAll('.image-setup__thumb--selected').length,
    }));
    if (!state.thumbs)
      throw new Error('Image library gallery did not render in the config dialog.');
    console.log(`config dialog open: ${state.thumbs} thumbnails, ${state.selected} selected`);

    const png = await page.locator('.mat-mdc-dialog-container').first().screenshot();
    await sharp(png).webp({ quality: 82 }).toFile(OUT);
    console.log(`wrote ${OUT}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
