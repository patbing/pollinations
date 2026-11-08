// Browser smoke test (Playwright Chromium). Usage: node tests/browser/smoke.mjs [baseUrl]
// Starts nothing itself: serve the folder first, e.g. `python3 -m http.server 8123`.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://127.0.0.1:8123';
const outDir = process.env.SHOTS || '/tmp/glassbox-shots';
fs.mkdirSync(outDir, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures++; };

const browser = await chromium.launch();
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, colorScheme: opts.colorScheme || 'light', acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|Failed to load resource|net::/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return { ctx, page, errors };
}

// ---- home + gallery
{
  const { ctx, page, errors } = await newPage();
  await page.goto(base + '/index.html');
  await page.waitForSelector('.gb-gcard');
  ok((await page.locator('.gb-gcard').count()) === 4, 'home shows 4 gallery cards');
  await page.waitForTimeout(400);
  const thumbsPainted = await page.evaluate(() => [...document.querySelectorAll('canvas.gb-thumb')].every((c) => c.width > 10 && c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data[3] > 0));
  ok(thumbsPainted, 'gallery thumbnails are painted');
  ok(await page.locator('text=Built with pollinations.ai').count() >= 1, 'footer names the Pollinations endpoints');
  ok(await page.locator('img[alt="Made with pollinations.ai"]').count() === 1, 'badge present');
  await page.screenshot({ path: path.join(outDir, '01-home.png') });
  ok(errors.length === 0, 'no console errors on home ' + errors.join(' | '));
  await ctx.close();
}

// ---- pendulum lesson
for (const id of ['pendulum', 'predator-prey', 'equilibrium', 'seasons']) {
  const { ctx, page, errors } = await newPage();
  await page.goto(base + '/index.html#/lesson/' + id);
  await page.waitForSelector('canvas.gb-canvas', { timeout: 15000 });
  await page.waitForTimeout(id === 'seasons' ? 500 : 2200);
  const info = await page.evaluate(() => {
    const c = document.querySelector('canvas.gb-canvas'); const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let colored = 0; for (let i = 0; i < d.length; i += 40) { if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 40) colored++; }
    return { w: c.width, h: c.height, colored, readouts: [...document.querySelectorAll('.gb-ro-val')].map((e) => e.textContent), charts: document.querySelectorAll('canvas.gb-chart').length, sliders: document.querySelectorAll('input[type=range]').length, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
  });
  ok(info.colored > 20, `${id}: canvas has drawn shapes (${info.colored})`);
  ok(info.readouts.every((r) => r !== '–' && r !== ''), `${id}: readouts have values ${info.readouts.join(', ')}`);
  ok(info.charts >= 1 && info.sliders >= 3, `${id}: charts ${info.charts}, sliders ${info.sliders}`);
  ok(info.sw <= info.cw + 1, `${id}: no horizontal scroll at 1280`);
  await page.screenshot({ path: path.join(outDir, `02-${id}.png`), fullPage: false });
  ok(errors.length === 0, `${id}: no console errors ${errors.join(' | ')}`);
  await ctx.close();
}

// ---- pendulum interactions: slider, tour, predict, equations, checks
{
  const { ctx, page, errors } = await newPage();
  await page.goto(base + '/index.html#/lesson/pendulum');
  await page.waitForSelector('canvas.gb-canvas'); await page.waitForTimeout(800);
  const before = await page.locator('.gb-ro-val').first().textContent();
  await page.locator('#gb-r-L').evaluate((e) => { e.value = '2.5'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(500);
  const after = await page.locator('.gb-ro-val').first().textContent();
  ok(before !== after, `slider changes the period readout (${before} -> ${after})`);
  await page.getByRole('button', { name: 'Show me' }).nth(2).click();
  await page.waitForTimeout(1000);
  ok((await page.locator('#gb-n-g').inputValue()) === '1.62', 'tour step 3 sets gravity to 1.62');
  ok(await page.locator('.gb-step.gb-active').count() === 1, 'tour step is marked active');
  await page.getByRole('tab', { name: 'Predict' }).click();
  await page.locator('input[name="gb-pred-p1"][value="increases"]').check();
  await page.getByRole('button', { name: 'Lock in my prediction' }).first().click();
  await page.waitForSelector('.gb-verdict', { timeout: 8000 });
  const verdict = await page.locator('.gb-verdict').first().textContent();
  ok(/You predicted it increases/i.test(verdict) && /simulation says it increases/.test(verdict), 'prediction reveal compares guess and simulation: ' + verdict);
  ok(/Period: 1\.4.*2\.8/.test(await page.locator('.gb-measure').first().textContent()), 'measured values shown');
  await page.getByRole('tab', { name: 'Equations' }).click();
  ok((await page.locator('.gb-eq code').first().textContent()).startsWith('dtheta/dt'), 'equations tab shows the ODEs');
  await page.getByRole('tab', { name: 'Sources & checks' }).click();
  ok(await page.locator('.gb-check-ok').count() >= 2, 'checks tab lists passed checks');
  ok(await page.locator('.gb-sources li').count() === 3, 'three sources listed');
  await page.screenshot({ path: path.join(outDir, '03-pendulum-checks.png') });
  ok(errors.length === 0, 'no console errors during interactions ' + errors.join(' | '));
  await ctx.close();
}

// ---- demo build end to end, export, reopen the export
{
  const { ctx, page, errors } = await newPage();
  const requests = [];
  page.on('request', (r) => { if (!/^(data|blob):/.test(r.url()) && !r.url().startsWith(base)) requests.push(r.url()); });
  await page.goto(base + '/index.html?demo=1');
  await page.waitForSelector('#topic');
  ok(await page.locator('.banner-demo').count() === 1, 'demo banner shown');
  await page.fill('#topic', 'Why does a pendulum keep time?');
  await page.getByRole('button', { name: 'Estimate & build' }).click();
  await page.waitForSelector('#dlg[open]');
  await page.screenshot({ path: path.join(outDir, '04-cost-dialog.png') });
  await page.getByRole('button', { name: 'Build lesson' }).click();
  await page.waitForSelector('.steps');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '05-progress.png') });
  ok(!(await page.getByRole('button', { name: 'Back' }).isVisible().catch(() => false)), 'progress: only Cancel is visible while the build runs');
  await page.waitForSelector('canvas.gb-canvas', { timeout: 30000 });
  ok(/#\/lesson\/current/.test(page.url()), 'build ends on the lesson');
  ok(await page.locator('text=Demo (pre-recorded)').count() === 1, 'lesson is labelled demo');
  ok(await page.locator('.gb-cover img').count() === 1, 'cover image shown');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '06-demo-lesson.png') });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download as offline HTML' }).click()]);
  const file = path.join(outDir, 'exported.html'); await dl.saveAs(file);
  const html = fs.readFileSync(file, 'utf8');
  ok(html.length > 50000 && !/sk_[A-Za-z0-9]/.test(html) && !/blob:/.test(html), 'export is self-contained, no key, no blob: ' + html.length + ' bytes');
  ok(/Content-Security-Policy/.test(html) && !/<script src=/.test(html) && !/<link /.test(html), 'export has CSP and no external script/link');
  ok(requests.filter((u) => !/jsdelivr|raw\.githubusercontent/.test(u)).length === 0, 'demo build made no outside requests: ' + requests.join(','));
  ok(errors.length === 0, 'no console errors in demo flow ' + errors.join(' | '));
  const p2 = await ctx.newPage(); const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
  const reqs2 = []; p2.on('request', (r) => { if (!/^(data|blob|file):/.test(r.url())) reqs2.push(r.url()); });
  await p2.goto('file://' + file); await p2.waitForSelector('canvas.gb-canvas'); await p2.waitForTimeout(1200);
  ok(errs2.length === 0, 'exported file runs without errors ' + errs2.join('|'));
  ok(reqs2.length === 0, 'exported file makes no network requests ' + reqs2.join(','));
  ok(await p2.locator('.gb-tab').count() >= 4 && await p2.locator('input[type=range]').count() >= 4, 'exported file has tabs and sliders');
  await p2.screenshot({ path: path.join(outDir, '07-export.png') });
  await ctx.close();
}

// ---- mobile and dark
{
  const { ctx, page } = await newPage({ viewport: { width: 375, height: 800 }, colorScheme: 'dark' });
  await page.goto(base + '/index.html'); await page.waitForSelector('.gb-gcard');
  let m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(m.sw <= m.cw + 1, `home has no horizontal scroll at 375 (${m.sw}/${m.cw})`);
  await page.screenshot({ path: path.join(outDir, '08-mobile-home-dark.png') });
  await page.goto(base + '/index.html#/lesson/seasons'); await page.waitForSelector('canvas.gb-canvas'); await page.waitForTimeout(600);
  m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(m.sw <= m.cw + 1, `lesson has no horizontal scroll at 375 (${m.sw}/${m.cw})`);
  const clipped = await page.evaluate(() => { const l = document.querySelector('.gb-tabs').getBoundingClientRect(); return [...document.querySelectorAll('.gb-tab')].filter((t) => t.getBoundingClientRect().right > l.right + 1).length; });
  ok(clipped === 0, `all lesson tabs are visible at 375 (${clipped} clipped)`);
  await page.screenshot({ path: path.join(outDir, '09-mobile-seasons-dark.png'), fullPage: true });
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall browser checks passed');
process.exit(failures ? 1 : 0);
