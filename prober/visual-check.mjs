// Local-only verification: use the existing pinned Playwright install, never download browsers.
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
const { AxeBuilder } = require(process.env.AXE_MODULE || '@axe-core/playwright');
const root = dirname(fileURLToPath(import.meta.url));
const fixtures = join(root, 'artifacts/e2e');
const output = join(root, 'artifacts/visual');
await mkdir(output, { recursive: true });
const clocks = JSON.parse(await readFile(join(fixtures, 'clock.json'), 'utf8'));
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
let assertions = 0;
const check = (value, message) => { assertions++; assert.ok(value, message); };
const reference = process.env.MONITOR_MOCKUP;
if (!reference) throw new Error('Set MONITOR_MOCKUP to the Bedrock design/monitoring/mockup.html path.');
const scenarios = { reachable: 'good', unreachable: 'incident', unknown: 'stale', 'first-run': 'first' };
try {
  for (const [scenario, mock] of Object.entries(scenarios)) {
    for (const width of [390, 1280]) for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme });
      await context.addInitScript((now) => { Date.now = () => now; }, clocks[scenario]);
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(pathToFileURL(join(fixtures, scenario, 'page/index.html')).href);
      await page.waitForFunction(() => document.querySelector('#headline')?.textContent !== '');
      const headline = await page.locator('#headline').innerText();
      const expected = {
        reachable: 'Home cloud — reachable', unreachable: 'Home cloud — unreachable',
        unknown: 'Current status unknown', 'first-run': 'Waiting for the first external observation',
      }[scenario];
      check(headline === expected, `${scenario}: ${headline}`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}`);
      const visibleBars = await page.locator(width < 600 ? '.history-30 .day' : '.history-90 .day').count();
      check(visibleBars === (width < 600 ? 30 : 90), 'Responsive bar count');
      const geometry = await page.locator('.public, .status, .days:visible').evaluateAll((nodes) => nodes.map((n) => {
        const r = n.getBoundingClientRect(); return { class: n.className, x: r.x, y: r.y, width: r.width, height: r.height };
      }));
      if (width === 390 && theme === 'dark') {
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        await writeFile(join(output, `axe-${scenario}.json`), JSON.stringify(axe, null, 2));
        check(axe.violations.length === 0, `${scenario}: ${axe.violations.map((v) => v.id).join(', ')} axe violations`);
      }
      const implemented = join(output, `${scenario}-${width}-${theme}.png`);
      await page.screenshot({ path: implemented, fullPage: true });
      await page.goto(`${pathToFileURL(reference).href}?view=public&scn=${mock}&theme=${theme}&width=${width < 600 ? 'phone' : 'desktop'}`);
      // Remove only the mockup presentation chrome, preserving the Public view's actual CSS.
      await page.addStyleTag({ content: '#controls{display:none}body{margin:0}.app{border:0;border-radius:0;min-height:100vh}' });
      const referencePath = join(output, `reference-${scenario}-${width}-${theme}.png`);
      await page.screenshot({ path: referencePath, fullPage: true });
      const referenceGeometry = await page.locator('.public, .status, .days').evaluateAll((nodes) => nodes.map((n) => {
        const r = n.getBoundingClientRect(); return { class: n.className, x: r.x, y: r.y, width: r.width, height: r.height };
      }));
      results.push({ scenario, width, theme, headline, geometry, referenceGeometry, implemented, reference: referencePath });
      await context.close();
    }
  }
  // Verify expiry without a rebuild/reload and on resumed tabs, plus an unresolved stale incident.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const openFixture = async (scenario, now = clocks[scenario]) => {
    await page.addInitScript((time) => { Date.now = () => time; }, now);
    await page.goto(pathToFileURL(join(fixtures, scenario, 'page/index.html')).href);
  };
  await openFixture('reachable');
  check(await page.locator('#headline').innerText() === 'Home cloud — reachable', 'Initial fresh status');
  await page.evaluate((now) => { Date.now = () => now + 16 * 60_000; window.dispatchEvent(new Event('pageshow')); }, clocks.reachable);
  check(await page.locator('#headline').innerText() === 'Current status unknown', 'Resumed stale tab');
  const periodic = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const timed = await periodic.newPage();
  await timed.clock.install({ time: new Date(clocks.reachable) });
  await timed.goto(pathToFileURL(join(fixtures, 'reachable/page/index.html')).href);
  await timed.clock.fastForward(16 * 60_000);
  check(await timed.locator('#headline').innerText() === 'Current status unknown', 'Periodic expiry');
  await periodic.close();
  await openFixture('unknown-unresolved');
  check(await page.locator('#headline').innerText() === 'Current status unknown', 'Stale incident headline');
  check((await page.locator('#recovery-note').innerText()).includes('remains unresolved'), 'Stale incident preserved');
  await openFixture('recovering');
  check(await page.locator('#headline').innerText() === 'Checks passing · confirming recovery', 'First success is not recovery');
  await page.evaluate((now) => { Date.now = () => now - 5 * 60_000; window.dispatchEvent(new Event('pageshow')); }, clocks.recovering);
  check((await page.locator('#observation').innerText()).includes('Device clock uncertain'), 'Clock skew');
  await page.setViewportSize({ width: 320, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px reflow');
  await context.close();
  const noJS = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const dated = await noJS.newPage();
  await dated.goto(pathToFileURL(join(fixtures, 'reachable/page/index.html')).href);
  check((await dated.locator('#headline').innerText()).startsWith('Last observation at '), 'No-JS dated wording');
  check(!(await dated.locator('#headline').innerText()).includes('Home cloud — reachable'), 'No undated green without JS');
  await dated.screenshot({ path: join(output, 'no-js-390-light.png'), fullPage: true });
  await noJS.close();
  check(errors.length === 0, `Browser errors: ${errors}`);
  for (const width of [390, 1280]) {
    const rows = [];
    for (const scenario of Object.keys(scenarios)) for (const theme of ['light', 'dark']) {
      rows.push(`<section><h2>${scenario} · ${width}px · ${theme} · reference left / implementation right</h2><div><img alt="Reference" src="reference-${scenario}-${width}-${theme}.png"><img alt="Implementation" src="${scenario}-${width}-${theme}.png"></div></section>`);
    }
    const html = join(output, `comparison-${width}.html`);
    await writeFile(html, `<!doctype html><html lang="en"><title>Public status comparison</title><style>body{margin:0;font:13px system-ui;background:#ccc}h2{height:32px;margin:0;font-size:14px;padding:6px}section>div{display:flex}img{width:${width}px;height:844px;object-fit:contain;object-position:top}</style>${rows.join('')}</html>`);
    const comparison = await browser.newPage({ viewport: { width: width * 2, height: 876 } });
    await comparison.goto(pathToFileURL(html).href);
    await comparison.screenshot({ path: join(output, `comparison-${width}.png`), fullPage: true });
    await comparison.close();
  }
} finally { await browser.close(); }
await writeFile(join(output, 'results.json'), JSON.stringify({ assertions, errors, results }, null, 2));
console.log(`${results.length} implemented + ${results.length} reference + 1 no-JS screenshots, 2 comparison sheets; ${assertions} browser assertions passed.`);
