// axe-core on the main views, and Tab through the toolbar and the review card.
// Serious and critical findings fail; vendored code is allow-listed below.
import { readFile } from 'node:fs/promises';
import { axePath, start } from './harness.mjs';

const allow = [
  // dockview draws each tab as role=tab with its close button (role=button,
  // tabindex=-1) inside it. The markup is the library's; the close action is
  // also on the keyboard (Ctrl+W) and in the tab bar above.
  { rule: 'nested-interactive', target: /^#dv-tab-\d+$/, why: 'dockview tab with its close button inside' },
];

const axe = await readFile(axePath, 'utf8');
const summary = [];
const audit = async (page, ok, name) => {
  await page.evaluate(axe); // evaluate, not a script tag: the page has the app CSP
  const result = await page.evaluate(() => window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    resultTypes: ['violations'],
  }));
  const found = [];
  let allowed = 0;
  for (const violation of result.violations) {
    if (!['serious', 'critical'].includes(violation.impact)) continue;
    for (const node of violation.nodes) {
      const target = node.target.join(' ');
      if (allow.some((a) => a.rule === violation.id && a.target.test(target))) allowed += 1;
      else found.push(`${violation.id} (${violation.impact}) ${target}: ${node.failureSummary.split('\n').slice(1, 2).join('').trim()}`);
    }
  }
  const minor = result.violations.filter((v) => !['serious', 'critical'].includes(v.impact)).map((v) => v.id);
  summary.push(`${name}: ${found.length} serious/critical, ${allowed} allow-listed${minor.length ? `, minor: ${minor.join(', ')}` : ''}`);
  ok(found.length === 0, `axe: ${name}${found.length ? `\n      ${found.join('\n      ')}` : ''}`);
};
const tabTo = async (page, ids, limit = 80, key = 'Tab') => {
  const seen = new Set();
  for (let i = 0; i < limit && seen.size < ids.length; i += 1) {
    await page.keyboard.press(key);
    const id = await page.evaluate(() => document.activeElement?.id || document.activeElement?.dataset?.request || '');
    if (ids.includes(id)) seen.add(id);
  }
  return ids.filter((id) => !seen.has(id));
};

// One review per tint, every status, some with requests: the dim text on each row colour.
const actions = ['improve', 'delete', 'request', 'clarify'];
const store = {
  format: 3, revision: 1, nextId: 17,
  reviews: Array.from({ length: 16 }, (_, i) => ({
    id: `r${i + 1}`, file: 'a.md', kind: 'markdown', quote: i % 2 ? 'Second paragraph' : 'brave new',
    comment: i % 3 ? '' : 'A note', action: actions[i % 4], status: ['open', 'applied', 'resolved'][i % 3],
    resolution: i % 3 === 1 ? 'Done' : '', color: i + 1, ...(i % 4 === 2 ? { requests: ['ask:why', 'tone:jfm'] } : {}),
  })),
};
for (const theme of ['light', 'dark']) {
  const { page, ok, selectText, close } = await start({ theme, store, viewport: { width: 1500, height: 2600 } });
  if (await page.$eval('#reviewPane', (p) => p.hidden)) await page.click('#notes');
  await page.waitForSelector('#reviewList .review-row');
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === theme, `${theme} theme is on`);
  ok(await page.$$eval('#reviewList .review-row', (r) => new Set(r.map((x) => x.dataset.reviewTint)).size) === 16, `${theme}: all 16 review colours are shown`);
  await audit(page, ok, `${theme}: Review panel with 16 reviews`);
  await selectText('#markdown', 'Second paragraph');
  await page.keyboard.press('Control+Shift+N');
  await page.waitForSelector('#noteBox:not([hidden])');
  await audit(page, ok, `${theme}: review card`);
  await close();
}

{
  const { page, ok, close } = await start({ initial: null });
  await page.waitForSelector('#empty');
  await page.waitForTimeout(300);
  await audit(page, ok, 'empty window');
  const now = Date.now();
  await page.evaluate((now) => {
    const view = null;
    localStorage.setItem('pdf-next.places', JSON.stringify([
      { path: '/d/three-pages.pdf', name: 'three-pages.pdf', kind: 'pdf', opened: now - 60_000, view },
      { path: '/d/a.md', name: 'a.md', kind: 'markdown', opened: now - 3_600_000 * 30, view },
      { path: '/d/gone/figure.png', name: 'figure.png', kind: 'image', opened: now - 86_400_000 * 40, view },
    ]));
    sessionStorage.setItem('missing', JSON.stringify(['/d/gone/figure.png']));
  }, now);
  await page.reload();
  await page.waitForSelector('#recentList .recent-item.missing');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await audit(page, ok, `${theme}: empty window with recent files`);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.focus('#viewerContainer');
  await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.activeElement.classList.contains('recent-item')), 'The keyboard reaches the recent files');
  await page.click('#settingsToggle');
  await page.waitForSelector('#settingsPanel:not([hidden])');
  await audit(page, ok, 'Settings');
  await page.keyboard.press('Escape');
  await close();
}

// The outline and pages sidebar, and a link preview, in both themes.
for (const theme of ['light', 'dark']) {
  const { page, ok, close } = await start({ initial: '/d/navigate.pdf', theme });
  await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
  await page.keyboard.press('Control+Shift+O');
  await page.waitForSelector('#outlineTree [role="treeitem"]');
  await page.$eval('#viewerContainer', (c) => { c.scrollTop = 150; });
  await page.waitForTimeout(300);
  await audit(page, ok, `${theme}: PDF outline`);
  await page.hover('#viewer .annotationLayer section[data-internal-link] > a[href*="equation"]');
  await page.waitForSelector('#linkPreview:not([hidden]) canvas');
  await audit(page, ok, `${theme}: link preview`);
  await page.click('#outlineTabPages');
  await page.waitForSelector('#outlineThumbs .outline-thumb canvas');
  await audit(page, ok, `${theme}: PDF pages`);
  await close();
}

const { page, ok, selectText, finish } = await start();
await page.click('#notes');
await page.waitForSelector('#reviewPane:not([hidden])');
await audit(page, ok, 'Markdown with the Review panel');
await page.keyboard.press('Control+Shift+O');
await page.waitForSelector('#outline:not([hidden])');
await audit(page, ok, 'Markdown outline with the Review panel');
await page.keyboard.press('Control+Shift+O');
await page.click('#notes');
await page.evaluate(() => document.activeElement?.blur());
const toolbar = ['open', 'zoomOut', 'zoom', 'zoomIn', 'findToggle', 'viewMenuButton', 'dockMenuButton', 'notes', 'settingsToggle'];
const missed = await tabTo(page, toolbar);
ok(missed.length === 0, `Tab reaches the toolbar controls${missed.length ? ` (missed ${missed.join(', ')})` : ''}`);
for (const menu of ['viewMenu', 'dockMenu']) {
  await page.click(`[aria-controls="${menu}"]`);
  await page.waitForSelector(`#${menu}:not([hidden])`);
  await audit(page, ok, `${menu === 'viewMenu' ? 'View' : 'Window'} menu`);
  await page.keyboard.press('Escape');
}
await selectText('#markdown', 'Second paragraph');
await page.keyboard.press('Control+Shift+N');
await page.waitForSelector('#noteBox:not([hidden])');
await audit(page, ok, 'review card');
ok(await page.evaluate(() => document.activeElement.id) === 'noteText', 'The review card opens with focus in the note');
const after = await tabTo(page, ['noteCancel', 'noteSave'], 4);
await page.focus('#noteText');
const before = await tabTo(page, ['noteAction', 'tone:jfm', 'scope:paragraph', 'ask:why', 'noteClose'], 24, 'Shift+Tab');
const missedCard = [...after, ...before];
ok(missedCard.length === 0, `Tab and Shift+Tab reach the review card buttons${missedCard.length ? ` (missed ${missedCard.join(', ')})` : ''}`);
await page.focus('.request-chip[data-request="ask:why"]');
await page.keyboard.press('Space');
ok(await page.$eval('.request-chip[data-request="ask:why"]', (c) => c.getAttribute('aria-pressed')) === 'true', 'Space on a focused request button presses it');
ok(await page.$eval('#noteBox', (b) => !b.hidden), 'Tab keeps the review card open');
await page.focus('#noteText');
await page.keyboard.press('Enter');
await page.waitForSelector('#noteBox', { state: 'hidden' });
if (await page.$eval('#reviewPane', (p) => p.hidden)) await page.click('#notes');
await page.waitForSelector('#reviewList .review-row');
await audit(page, ok, 'Review panel with a review');
await page.click('#notes');
await page.evaluate(() => { window.__pick = '/d/b.md'; });
await page.keyboard.press('Control+Shift+D');
await page.waitForSelector('#panes:not([hidden]) .dv-groupview');
await page.waitForTimeout(400);
await audit(page, ok, 'panes');
console.log(`axe summary:\n  ${summary.join('\n  ')}`);
await finish();
