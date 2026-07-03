import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, 'out');
mkdirSync(OUT, { recursive: true });

/** Screenshot `target` (a CSS selector, clipped) or the full page into out/<name>.png. */
export async function shot(page: Page, name: string, target?: string): Promise<void> {
  const path = join(OUT, `${name}.png`);
  const loc = target ? page.locator(target).first() : null;
  if (loc) await loc.waitFor({ timeout: 5000 });
  await (loc ? loc.screenshot({ path }) : page.screenshot({ path }));
  console.log(`  captured ${name}.png`);
}
