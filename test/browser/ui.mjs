import { createRequire } from 'node:module';

// Playwright is an optional dev dependency; resolve it wherever it is installed.
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PF_PLAYWRIGHT ?? 'playwright');

const URL = process.env.PF_URL ?? 'http://127.0.0.1:8899/fixture.html';
const browser = await chromium.launch();
const problems = [];
const log = (...a) => console.log(...a);

async function session(name, contextOpts) {
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#pf-anvil.pf-anvil--ready', { timeout: 8000 });
  return { ctx, page, errors, name };
}

/* ---------- Desktop ---------- */
{
  const { ctx, page, errors } = await session('desktop', { viewport: { width: 1280, height: 860 } });

  const anvil = page.locator('#pf-anvil');
  const before = await anvil.boundingBox();
  log('desktop: anvil at', Math.round(before.x), Math.round(before.y), `${before.width}x${before.height}`);

  // Drag it across the screen.
  await page.mouse.move(before.x + 26, before.y + 26);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(before.x + 26 - i*40, before.y + 26 - i*30);
  await page.mouse.up();
  const after = await anvil.boundingBox();
  log('desktop: after drag', Math.round(after.x), Math.round(after.y));
  if (Math.abs(after.x - before.x) < 100) problems.push('anvil did not move on drag');
  if (await page.locator('#pf-panel.pf-panel--open').count()) problems.push('drag opened the panel');

  // A plain click must open the panel.
  const cb = await anvil.boundingBox();
  await page.mouse.move(cb.x + cb.width/2, cb.y + cb.height/2);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForSelector('#pf-panel.pf-panel--open', { timeout: 3000 });
  log('desktop: panel opened on click');

  // Position persisted?
  const stored = await page.evaluate(() => globalThis.__ES.presetForge);
  log('desktop: stored pos', Math.round(stored.buttonX), Math.round(stored.buttonY));
  if (stored.buttonX == null) problems.push('button position not persisted');

  // Tabs
  for (const tab of ['create','rewrite','modules','settings']) {
    await page.locator(`.pf-tab[data-tab="${tab}"]`).click();
    await page.waitForTimeout(120);
    const n = await page.locator('.pf-page').count();
    if (!n) problems.push(`tab ${tab} rendered nothing`);
  }
  log('desktop: all four tabs render');

  // Connection profiles must be listed in Settings.
  await page.locator('.pf-tab[data-tab="settings"]').click();
  const opts = await page.locator('select').nth(2).locator('option').allTextContents();
  log('desktop: profile options ->', opts.join(' | '));
  if (!opts.some(o => o.includes('Cheap Haiku'))) problems.push('connection profiles not listed');

  // Switch UI language to Russian and confirm the chrome re-renders.
  await page.selectOption('select >> nth=0', 'ru');
  await page.waitForTimeout(300);
  const tabs = await page.locator('.pf-tab').allTextContents();
  log('desktop: RU tabs ->', tabs.join(' | '));
  if (!tabs.includes('Создать')) problems.push('language switch did not apply');
  await page.selectOption('select >> nth=0', 'en');
  await page.waitForTimeout(250);

  // Panel drag by header.
  const panel = page.locator('#pf-panel');
  const p0 = await panel.boundingBox();
  const header = page.locator('.pf-panel__header');
  const hb = await header.boundingBox();
  await page.mouse.move(hb.x + 60, hb.y + 14);
  await page.mouse.down();
  await page.mouse.move(hb.x - 140, hb.y + 90, { steps: 6 });
  await page.mouse.up();
  const p1 = await panel.boundingBox();
  log('desktop: panel moved', Math.round(p0.x), '->', Math.round(p1.x));
  if (Math.abs(p1.x - p0.x) < 50) problems.push('panel header drag did not move panel');

  if (errors.length) problems.push(`desktop console errors: ${errors.join(' ; ')}`);
  await ctx.close();
}

/* ---------- Mobile ---------- */
{
  const { ctx, page, errors } = await session('mobile', { ...devices['Pixel 7'] });
  const anvil = page.locator('#pf-anvil');
  const b = await anvil.boundingBox();
  log('mobile: viewport', page.viewportSize(), 'anvil', `${Math.round(b.width)}x${Math.round(b.height)}`);
  if (b.width < 40) problems.push('anvil too small to tap on mobile');

  // Touch drag.
  await page.touchscreen.tap(b.x + b.width/2, b.y + b.height/2);
  await page.waitForSelector('#pf-panel.pf-panel--open', { timeout: 3000 });
  log('mobile: panel opened on tap');

  const pb = await page.locator('#pf-panel').boundingBox();
  const vw = page.viewportSize();
  log('mobile: panel box', Math.round(pb.x), Math.round(pb.y), `${Math.round(pb.width)}x${Math.round(pb.height)}`);
  if (Math.abs(pb.width - vw.width) > 2) problems.push('panel is not full-width as a mobile sheet');
  if (pb.height > vw.height) problems.push('panel taller than viewport');
  if (pb.y + pb.height > vw.height + 2) problems.push('panel bottom off-screen');

  // No horizontal overflow anywhere in the panel body.
  const overflow = await page.evaluate(() => {
    const body = document.querySelector('.pf-panel__body');
    return { scrollW: body.scrollWidth, clientW: body.clientWidth };
  });
  log('mobile: body scrollW/clientW', overflow.scrollW, '/', overflow.clientW);
  if (overflow.scrollW > overflow.clientW + 2) problems.push('panel body scrolls horizontally on mobile');

  // Inputs must be >=16px or iOS zooms on focus.
  const fs = await page.evaluate(() => {
    const i = document.querySelector('.pf-input');
    return parseFloat(getComputedStyle(i).fontSize);
  });
  log('mobile: input font-size', fs);
  if (fs < 16) problems.push(`mobile input font-size ${fs}px will trigger iOS zoom`);

  // Grid must collapse to one column.
  await page.locator('.pf-tab[data-tab="settings"]').click();
  await page.waitForTimeout(150);
  const cols = await page.evaluate(() => {
    const g = document.querySelector('.pf-grid');
    return getComputedStyle(g).gridTemplateColumns.split(' ').length;
  });
  log('mobile: grid columns', cols);
  if (cols !== 1) problems.push(`mobile grid did not collapse (${cols} columns)`);

  if (errors.length) problems.push(`mobile console errors: ${errors.join(' ; ')}`);
  await page.screenshot({ path: process.env.PF_SHOT ?? 'mobile.png' });
  await ctx.close();
}

await browser.close();
console.log('\n' + (problems.length ? 'PROBLEMS:\n- ' + problems.join('\n- ') : 'ALL UI CHECKS PASSED'));
process.exit(problems.length ? 1 : 0);
