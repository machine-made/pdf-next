// Change marks after a PDF rebuild: what changed is highlighted and fades,
// ticks at the right edge stay faint, . and , walk the changes, a tick
// click goes there, and a long document reloads without stalling.
import { start } from './harness.mjs';

/// A PDF with one page per entry of `pages`, each a list of lines of text.
function makePdf(pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const lines of pages) {
    const stream = lines.map((line, i) => `BT /F1 14 Tf 72 ${760 - 22 * i} Td (${line}) Tj ET`).join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let out = '%PDF-1.7\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const words = ['river', 'stone', 'cloud', 'field', 'light', 'paper', 'north', 'quiet', 'glass', 'wheel'];
const lines = (page, n = 12) => Array.from({ length: n }, (_, i) => `Page ${page} line ${i + 1} ${words[(page + i) % 10]} ${words[(page * 3 + i) % 10]} and more text`);
const book = (count) => Array.from({ length: count }, (_, i) => lines(i + 1));

let pdf = makePdf(book(5));
const { page, ok, shot, finish } = await start({ initial: '/d/changes.pdf', files: { '/d/a.md': 'Notes.\n' } });
await page.route('**/d/changes.pdf*', (route) => route.fulfill({ body: pdf, contentType: 'application/pdf' }));
await page.reload();
await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
const strip = '#stage > .change-ticks';
const waitFor = (fn, arg, timeout = 8000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
let revision = 1;
const rebuild = async (pages) => {
  pdf = makePdf(pages);
  revision += 1;
  await page.evaluate((revision) => window.__emit('file-changed', { path: '/d/changes.pdf', kind: 'changed', revision }), revision);
};
const done = () => waitFor((s) => document.querySelector(s)?.dataset.done === 'true', strip, 20_000);
const ticks = () => page.$$eval(`${strip} .change-tick`, (t) => t.map((x) => Number(x.dataset.page)));
const pageNo = () => page.$eval('#page', (i) => Number(i.value));

ok(await done(), 'The first build is read in the background, to compare the next one with');
ok(await page.$eval(strip, (s) => s.hidden), 'Nothing is marked on a first open');

const second = book(5);
second[0][3] = 'Page 1 line 4 harbour stone and more text';
second[3][9] = 'Page 4 line 10 entirely new words here';
second.push(lines(6));
await rebuild(second);
ok(await waitFor(() => document.querySelector('#viewer .page[data-page-number="1"] .change-marks > i')), 'The rebuilt page marks what changed');
const marked = await page.evaluate(() => {
  const box = document.querySelector('#viewer .page[data-page-number="1"] .change-marks > i').getBoundingClientRect();
  const span = [...document.querySelectorAll('#viewer .page[data-page-number="1"] .textLayer span')].find((s) => s.textContent.includes('harbour'));
  const range = document.createRange();
  const node = span.firstChild;
  range.setStart(node, node.textContent.indexOf('harbour'));
  range.setEnd(node, node.textContent.indexOf('harbour stone') + 13);
  const word = range.getBoundingClientRect();
  const count = document.querySelectorAll('#viewer .page[data-page-number="1"] .change-marks > i').length;
  return { count, left: Math.abs(box.left - word.left), width: Math.abs(box.width - word.width), top: Math.abs(box.top - word.top) };
});
ok(marked.count === 1 && marked.left < 3 && marked.width < 4 && marked.top < 4, `The mark covers the changed words and nothing else ${JSON.stringify(marked)}`);
ok(await page.$$eval('#viewer .page[data-page-number="2"] .change-marks, #viewer .page[data-page-number="3"] .change-marks', (m) => m.length) === 0, 'Unchanged pages are not marked');
ok(await done(), 'The rest of the rebuild is compared in the background');
const seen = await ticks();
ok(seen.join() === '1,4,6', `Ticks for the changed pages and the added one (${seen})`);
ok(await page.$eval(`${strip}`, (s) => s.classList.contains('fresh')), 'The ticks are bright at first');
await shot('changes-fresh');
await page.waitForTimeout(3600);
ok(await page.$$eval('#viewer .change-marks', (m) => m.length) === 0, 'The highlight is gone after a few seconds');
const faint = await page.$eval(`${strip} .change-tick`, (t) => Number(getComputedStyle(t).opacity));
ok(faint > 0.2 && faint < 0.6, `The ticks stay, faint (${faint})`);
const edge = await page.evaluate((s) => {
  const strip = document.querySelector(s).getBoundingClientRect();
  const view = document.getElementById('viewerContainer');
  const box = view.getBoundingClientRect();
  return { right: Math.round(box.left + view.clientWidth - strip.right), height: Math.round(strip.height - view.clientHeight) };
}, strip);
ok(edge.right === 0 && edge.height === 0, `The strip runs down the right edge, beside the scrollbar ${JSON.stringify(edge)}`);

await page.click('#viewerContainer', { position: { x: 5, y: 5 } });
await page.keyboard.press('.');
await page.waitForTimeout(900);
ok(await pageNo() === 4, `. goes to the next change (page ${await pageNo()})`);
ok(await waitFor(() => document.querySelector('#viewer .page[data-page-number="4"] .change-marks > i')), 'and marks it again');
await page.keyboard.press('.');
await page.waitForTimeout(900);
ok(await pageNo() === 6, `. again goes to the added page (${await pageNo()})`);
ok(await page.$eval('#viewer .page[data-page-number="6"] .change-marks > i', (i) => i.style.width === '100%').catch(() => false), 'An added page is marked whole');
await page.keyboard.press(',');
await page.waitForTimeout(900);
ok(await pageNo() === 4, `, goes back (${await pageNo()})`);
await page.click(`${strip} .change-tick[data-page="1"]`);
await page.waitForTimeout(900);
ok(await pageNo() === 1, 'Clicking a tick goes there');
await page.keyboard.press('Control+k');
await page.keyboard.type('next change');
await page.waitForTimeout(150);
ok((await page.textContent('#palette')).includes('Next change'), 'Next change is in the palette');
await page.keyboard.press('Escape');

await rebuild(second);
ok(await done(), 'The same build again is compared');
ok(await page.$eval(strip, (s) => s.hidden && !s.querySelector('.change-tick')), 'and leaves nothing marked: the text did not change');
await page.keyboard.press('.');
await page.waitForTimeout(200);
ok((await page.textContent('#status')).includes('Nothing changed'), 'With nothing changed, . says so');

// A long document: the reload is not held up, the background pass stays in
// its budget and is not felt, and a page past the budget is compared when shown.
pdf = makePdf(book(600));
revision += 1;
await page.evaluate((revision) => window.__emit('file-changed', { path: '/d/changes.pdf', kind: 'changed', revision }), revision);
ok(await done(), 'A 600-page build is read up to the budget');
const read = await page.$eval(strip, (s) => Number(s.dataset.checked || 0));
await page.fill('#page', '590');
await page.press('#page', 'Enter');
await page.waitForTimeout(800);
await page.fill('#page', '1');
await page.press('#page', 'Enter');
await page.waitForTimeout(500);
const long = book(600);
long[9][2] = 'Page 10 line 3 changed early';
long[299][5] = 'Page 300 line 6 changed in the middle';
long[589][1] = 'Page 590 line 2 changed past the budget';
const timing = await page.evaluate(() => {
  window.__gaps = [];
  let last = performance.now();
  const frame = (now) => {
    window.__gaps.push(now - last);
    last = now;
    if (window.__gaps.length < 2000) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  window.__drawn = new Promise((resolve) => {
    const seen = new Set([...document.querySelectorAll('#viewer canvas')]);
    const watch = new MutationObserver(() => {
      if ([...document.querySelectorAll('#viewer canvas')].some((c) => !seen.has(c))) {
        watch.disconnect();
        resolve(performance.now());
      }
    });
    watch.observe(document.getElementById('viewer'), { childList: true, subtree: true });
  });
  return performance.now();
});
pdf = makePdf(long);
revision += 1;
await page.evaluate((revision) => window.__emit('file-changed', { path: '/d/changes.pdf', kind: 'changed', revision }), revision);
const reload = await page.evaluate((t0) => window.__drawn.then((t) => t - t0), timing);
ok(reload < 2500, `The 600-page rebuild shows its first page in ${Math.round(reload)} ms`);
ok(await done(), 'and its background pass finishes');
const gaps = await page.evaluate(() => {
  const sorted = [...window.__gaps].slice(5).sort((a, b) => a - b);
  return { max: Math.round(sorted.at(-1)), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]) };
});
ok(gaps.p95 < 50, `The background pass is not felt: frames ${JSON.stringify(gaps)} ms`);
const checked = await page.$eval(strip, (s) => Number(s.dataset.checked));
ok(read <= 505 && checked <= 505, `It reads no more than its budget of 500 pages, with the few on screen (${read} then ${checked})`);
const longTicks = await ticks();
ok(longTicks.includes(10) && longTicks.includes(300) && !longTicks.includes(590), `Changes within the budget get ticks without scrolling (${longTicks})`);
await page.fill('#page', '590');
await page.press('#page', 'Enter');
ok(await waitFor(() => document.querySelector('#viewer .page[data-page-number="590"] .change-marks > i')), 'A page past the budget is compared when it is shown');
ok((await ticks()).includes(590), 'and gets its tick');

// The same in a pane that is not live.
pdf = makePdf(book(3));
revision += 1;
await page.evaluate((revision) => window.__emit('file-changed', { path: '/d/changes.pdf', kind: 'changed', revision }), revision);
await page.waitForTimeout(800);
await page.evaluate(() => { window.__pick = '/d/a.md'; });
await page.keyboard.press('Control+Shift+D');
await page.waitForTimeout(1200);
const pane = '.pane-body[data-path="/d/changes.pdf"]';
ok(await waitFor((sel) => document.querySelector(`${sel} .change-ticks`)?.dataset.done === 'true', pane, 15_000), 'The PDF pane that is not live reads its build too');
const paned = book(3);
paned[1][0] = 'Page 2 line 1 rewritten in the pane';
await rebuild(paned);
ok(await waitFor((sel) => document.querySelector(`${sel} .pane-pdf .page[data-page-number="2"] .change-marks > i, ${sel} .change-tick[data-page="2"]`), pane), 'A rebuild marks its changes in a pane that is not live');
await shot('changes-pane');
await finish();
