// Zoom around the cursor (Ctrl+wheel and pinch), the place kept per file after
// the tab closes and the app restarts, and the recent files in the empty window.
import { start } from './harness.mjs';

const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: the wake behind the cylinder sheds vortices at a steady rate once the Reynolds number passes forty.`).join('\n\n');
const files = { '/d/long.md': `${long}\n`, '/d/a.md': 'Hello brave new world.\n' };
const { page, ok, finish } = await start({ files, initial: '/d/three-pages.pdf' });
await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
await page.waitForTimeout(400);
const settle = (ms = 450) => page.waitForTimeout(ms);
const zoomText = () => page.$eval('#zoom', (s) => s.options[s.selectedIndex].textContent);
const pageNo = () => page.$eval('#page', (i) => Number(i.value));
const names = () => page.$$eval('#recentList .recent-name', (n) => n.map((x) => x.textContent));
const emptyShown = () => page.$eval('#empty', (e) => getComputedStyle(e).display !== 'none');
const open = async (path) => {
  await page.evaluate((path) => window.__emit('open-files', [path]), path);
  await settle(700);
};
const ctrlWheel = async (x, y, deltaY, times = 1) => {
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  for (let i = 0; i < times; i += 1) await page.mouse.wheel(0, deltaY);
  await page.keyboard.up('Control');
};
/// Where (x, y) falls on the element under it, as fractions, and how far that
/// spot has since moved from (x, y).
const anchor = (selector, x, y) => page.evaluate(([selector, x, y]) => {
  const hit = document.elementFromPoint(x, y).closest(selector);
  const r = hit.getBoundingClientRect();
  hit.dataset.anchor = '1';
  return { fx: (x - r.left) / r.width, fy: (y - r.top) / r.height };
}, [selector, x, y]);
const where = (a) => page.evaluate((a) => {
  const r = document.querySelector('[data-anchor="1"]').getBoundingClientRect();
  return { x: r.left + a.fx * r.width, y: r.top + a.fy * r.height };
}, a);
const drift = async (x, y, a) => {
  const at = await where(a);
  await page.evaluate(() => delete document.querySelector('[data-anchor="1"]').dataset.anchor);
  return Math.round(Math.hypot(at.x - x, at.y - y));
};

// ── PDF: Ctrl+wheel keeps the point under the cursor ──
await page.selectOption('#zoom', '1');
await settle();
const box = await page.$eval('#viewerContainer', (c) => c.getBoundingClientRect().toJSON());
const [px, py] = [Math.round(box.left + box.width / 2 + 150), Math.round(box.top + 260)];
const width0 = await page.$eval('#viewer .page', (p) => p.getBoundingClientRect().width);
let spot = await anchor('.page', px, py);
await page.evaluate(() => {
  window.__frames = 0;
  window.__blank = 0;
  window.__sampling = true;
  const container = document.getElementById('viewerContainer');
  const tick = () => {
    if (!window.__sampling) return;
    const edge = container.getBoundingClientRect();
    for (const sheet of document.querySelectorAll('#viewer .page')) {
      const r = sheet.getBoundingClientRect();
      if (r.bottom < edge.top || r.top > edge.bottom) continue;
      if (![...sheet.querySelectorAll('canvas')].some((c) => !c.hidden && c.width > 0 && c.getBoundingClientRect().width > 0)) window.__blank += 1;
    }
    window.__frames += 1;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await ctrlWheel(px, py, -100);
const previewed = await where(spot);
const during = await page.evaluate(() => ({
  transform: document.getElementById('viewer').style.transform,
  width: document.querySelector('#viewer .page').getBoundingClientRect().width,
  layout: document.querySelector('#viewer .page').offsetWidth,
}));
ok(/scale\(1\.25\)/.test(during.transform) && Math.abs(during.layout - width0) < 1,
  `During the gesture the page is scaled on screen, not yet re-laid out (${during.transform}, ${during.layout} px)`);
await settle(700);
const sampled = await page.evaluate(() => { window.__sampling = false; return { frames: window.__frames, blank: window.__blank }; });
ok(sampled.frames > 10 && sampled.blank === 0, `No page shows blank while zooming and redrawing (${sampled.blank} blank in ${sampled.frames} frames)`);
ok(await page.$eval('#viewer', (v) => v.style.transform === ''), 'Once the gesture settles the transform is gone');
const width1 = await page.$eval('#viewer .page', (p) => p.getBoundingClientRect().width);
ok(Math.abs(width1 / width0 - 1.25) < 0.02 && await zoomText() === '125%', `Then PDF.js draws at the new scale (${await zoomText()}, ${Math.round(width0)} -> ${Math.round(width1)} px)`);
// A page narrower than the window stays centred, so the point keeps its
// height and moves out from the middle, exactly as the preview showed it.
const landed = await where(spot);
let moved = await drift(previewed.x, previewed.y, spot);
ok(moved <= 3 && Math.abs(landed.y - py) <= 3, `Letting go of a PDF zoom does not jump (${moved} px from the preview, ${Math.round(landed.y - py)} px in height)`);
await page.selectOption('#zoom', '2');
await settle();
spot = await anchor('.page', px, py);
await ctrlWheel(px, py, -100);
await settle(600);
moved = await drift(px, py, spot);
ok(await zoomText() === '250%' && moved <= 3, `Ctrl+wheel on a PDF wider than the window keeps the point under the cursor (${await zoomText()}, ${moved} px)`);
spot = await anchor('.page', px, py);
await ctrlWheel(px, py, 100);
await settle(600);
moved = await drift(px, py, spot);
ok(await zoomText() === '200%' && moved <= 3, `Ctrl+wheel down zooms out around the same point (${await zoomText()}, ${moved} px)`);

// A pinch is a stream of small deltas; passing near fit width lands on it.
await page.selectOption('#zoom', 'page-width');
await settle();
const fitWidth = await page.$eval('#viewer .page', (p) => p.getBoundingClientRect().width);
await page.selectOption('#zoom', '1');
await settle();
await page.mouse.move(px, py);
await page.keyboard.down('Control');
let detent = false;
for (let i = 0; i < 40 && !detent; i += 1) {
  await page.mouse.wheel(0, -2);
  detent = await zoomText() === 'Fit width';
}
await page.keyboard.up('Control');
await settle(600);
const snapped = await page.$eval('#viewer .page', (p) => p.getBoundingClientRect().width);
ok(detent && await zoomText() === 'Fit width' && Math.abs(snapped - fitWidth) < 2,
  `A pinch passing fit width snaps to it and the menu says so (${await zoomText()}, ${Math.round(snapped)} of ${Math.round(fitWidth)} px)`);
ok(await page.evaluate(() => document.querySelectorAll('#viewer').length === 1 && !document.body.style.zoom), 'The page itself is never zoomed by the webview');

// The keys zoom around the middle of the view.
await page.selectOption('#zoom', '1');
await settle();
const middle = [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)];
spot = await anchor('.page', ...middle);
await page.click('#zoomIn');
await settle();
moved = await drift(...middle, spot);
ok(moved <= 3, `Zoom in by button keeps the middle of the view still (${moved} px)`);

// ── PDF place: closed and opened again ──
await page.selectOption('#zoom', '1.5');
await settle();
await page.fill('#page', '2');
await page.press('#page', 'Enter');
await settle();
await page.evaluate(() => { document.getElementById('viewerContainer').scrollTop += 140; });
await settle(600);
const placeOf = () => page.evaluate(() => {
  const c = document.getElementById('viewerContainer');
  const p = document.querySelector('#viewer .page[data-page-number="2"]');
  return Math.round(p.getBoundingClientRect().top - c.getBoundingClientRect().top);
});
const left = await placeOf();
await page.keyboard.press('Control+w');
await settle();
ok(await emptyShown() && (await names()).join() === 'three-pages.pdf', `Closing the last tab shows the empty window with the file in Recent (${await names()})`);
await open('/d/three-pages.pdf');
ok(await pageNo() === 2 && await zoomText() === '150%' && Math.abs(await placeOf() - left) <= 3,
  `Reopening a PDF comes back to its page, zoom and spot (page ${await pageNo()}, ${await zoomText()}, ${left} -> ${await placeOf()} px)`);

// ── Markdown: Ctrl+wheel steps the text size, keeping the block under the cursor ──
await open('/d/long.md');
await page.waitForSelector('#markdown p');
await page.evaluate(() => { document.getElementById('markdownStage').scrollTop = 900; });
await settle();
const stage = await page.$eval('#markdownStage', (s) => s.getBoundingClientRect().toJSON());
const [mx, my] = [Math.round(stage.left + stage.width / 2), Math.round(stage.top + stage.height / 2)];
spot = await anchor('#markdown > p', mx, my);
await ctrlWheel(mx, my, -100);
await settle(300);
moved = await drift(mx, my, spot);
ok(await zoomText() === '125%' && await page.$eval('#markdown', (m) => m.style.zoom) === '1.25',
  `Ctrl+wheel on Markdown steps the text size and reflows (${await zoomText()})`);
ok(moved <= 4, `and keeps the paragraph under the cursor where it was (${moved} px)`);
await ctrlWheel(mx, my, 100);
await settle(300);
ok(await zoomText() === '100%', 'Ctrl+wheel down steps back');
await page.evaluate(() => { document.getElementById('markdownStage').scrollTop = 1400; });
await settle(600);
const mdTop = () => page.evaluate(() => {
  const s = document.getElementById('markdownStage').getBoundingClientRect().top;
  const first = [...document.querySelectorAll('#markdown > p')].find((p) => p.getBoundingClientRect().bottom > s + 4);
  return `${first.textContent.slice(0, 13)}@${Math.round(first.getBoundingClientRect().top - s)}`;
});
const mdPlace = await mdTop();

// ── Image: Ctrl+wheel around the cursor, and its zoom remembered ──
await open('/d/large-figure.png');
await page.waitForFunction(() => document.getElementById('image').naturalWidth > 0);
await settle();
const picture = await page.$eval('#imageBox', (b) => b.getBoundingClientRect().toJSON());
const [ix, iy] = [Math.round(picture.left + picture.width * 0.7), Math.round(picture.top + picture.height * 0.4)];
spot = await anchor('#imageBox', ix, iy);
const scale0 = await page.$eval('#imageBox', (b) => b.getBoundingClientRect().width);
await ctrlWheel(ix, iy, -100);
const imageDuring = await page.$eval('#imageBox', (b) => b.style.transform);
const imagePreview = await where(spot);
await settle(600);
moved = await drift(imagePreview.x, imagePreview.y, spot);
const scale1 = await page.$eval('#imageBox', (b) => b.getBoundingClientRect().width);
ok(/scale\(1\.25\)/.test(imageDuring) && Math.abs(scale1 / scale0 - 1.25) < 0.02, `An image scales on screen during the gesture, then for real (${imageDuring})`);
ok(moved <= 3, `A picture smaller than the window settles where the preview put it (${moved} px)`);
await page.selectOption('#zoom', '2');
await settle(600);
spot = await anchor('#imageBox', ix, iy);
await ctrlWheel(ix, iy, -100);
await settle(600);
moved = await drift(ix, iy, spot);
ok(await zoomText() === '250%' && moved <= 3, `Ctrl+wheel on a zoomed image keeps the point under the cursor (${await zoomText()}, ${moved} px)`);
await page.selectOption('#zoom', '2');
await settle(600);

// ── Close everything, restart, and come back from the Recent list ──
for (let i = 0; i < 3; i += 1) {
  await page.keyboard.press('Control+w');
  await settle(300);
}
ok((await names()).join() === 'large-figure.png,long.md,three-pages.pdf', `Recent lists the files opened last first (${await names()})`);
await page.evaluate(() => sessionStorage.setItem('noInitial', '1'));
await page.reload();
await page.waitForSelector('#recentList .recent-item');
await settle(300);
ok(await emptyShown() && (await names()).join() === 'large-figure.png,long.md,three-pages.pdf', 'After a restart the empty window lists them again');
const row = await page.$eval('#recentList .recent-item', (b) => ({
  icon: b.querySelector('use').getAttribute('href'), folder: b.querySelector('.recent-folder').textContent.replace(/‎/g, ''),
  when: b.querySelector('.recent-when').textContent,
}));
ok(row.icon === '#i-kind-image' && row.folder === '/d' && row.when === 'just now', `Each row has a kind icon, its folder and when it was opened (${JSON.stringify(row)})`);
const height = await page.$eval('#empty', (e) => e.scrollHeight <= e.clientHeight);
ok(height, 'The list fits the empty window without scrolling');
await page.click('#recentList .recent-item:has-text("long.md")');
await page.waitForSelector('#markdown p');
await settle(500);
ok(await mdTop() === mdPlace, `A Markdown file comes back to the same paragraph after a restart (${mdPlace} -> ${await mdTop()})`);
await page.keyboard.press('Control+w');
await settle(300);

await page.focus('#viewerContainer');
await page.keyboard.press('ArrowDown');
ok(await page.evaluate(() => document.activeElement.classList.contains('recent-item') && document.activeElement.textContent.includes('long.md')),
  'Down arrow moves into the list');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowDown');
ok(await page.evaluate(() => document.activeElement.textContent.includes('large-figure.png')), 'The arrows move through it');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.getElementById('image').naturalWidth > 0);
await settle(500);
ok(await zoomText() === '200%', `Enter opens it, at the zoom it had (${await zoomText()})`);
await page.keyboard.press('Control+w');
await settle(300);

// An explicit place wins over the remembered one.
await page.evaluate(() => window.__emit('open-files', [{ path: '/d/three-pages.pdf', target: { page: 3 } }]));
await settle(800);
ok(await pageNo() === 3, `--page wins over the remembered page (${await pageNo()})`);
await page.keyboard.press('Control+w');
await settle(300);

// Delete takes a file off the list, not off the disk.
await page.focus('#recentList .recent-item:has-text("long.md")');
await page.keyboard.press('Delete');
await settle(200);
ok((await names()).join() === 'three-pages.pdf,large-figure.png' && await page.evaluate(() => document.activeElement.classList.contains('recent-item')),
  `Delete removes the entry and keeps the focus in the list (${await names()})`);
ok(!await page.evaluate(() => window.__calls.some(([cmd]) => cmd === 'trash_document')), 'and never touches the file');

// The palette lists the same files.
await page.keyboard.press('Control+k');
await page.waitForSelector('#palette:not([hidden])');
await page.fill('#paletteInput', 'open recent');
await page.waitForTimeout(100);
const offered = await page.$$eval('#paletteList .palette-label', (l) => l.map((x) => x.textContent));
ok(offered.includes('Open recent…') && offered.includes('Open recent: three-pages.pdf') && offered.includes('Open recent: large-figure.png'),
  `The palette has Open recent… and each recent file (${offered.join(' | ')})`);
await page.click('#paletteList .palette-item:has-text("Open recent…")');
await page.waitForTimeout(150);
const listed = await page.$$eval('#paletteList .palette-label', (l) => l.map((x) => x.textContent));
ok(await page.inputValue('#paletteInput') === 'Open recent: ' && listed.length === 2, `Open recent… shows just the files (${listed.join(' | ')})`);
await page.keyboard.press('Escape');

// A file that is gone is dimmed, and picking it takes it off the list.
await page.evaluate(() => sessionStorage.setItem('missing', JSON.stringify(['/d/three-pages.pdf'])));
await page.reload();
await page.waitForSelector('#recentList .recent-item.missing');
const gone = await page.$eval('#recentList .recent-item.missing', (b) => [b.dataset.path, b.querySelector('.recent-when').textContent]);
ok(gone.join() === '/d/three-pages.pdf,not found', `A missing file is shown dimmed (${gone})`);
await page.click('#recentList .recent-item.missing');
await settle(200);
ok((await names()).join() === 'large-figure.png' && /no longer there/.test(await page.textContent('#status')),
  `Clicking it removes it with a short message (${await page.textContent('#status')})`);
ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pdf-next.places')).length === 1), 'The store forgets it too');
await finish();
