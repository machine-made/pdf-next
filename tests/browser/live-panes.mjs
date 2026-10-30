// Panes that are not live: a PDF viewer and an image of their own that follow
// their file, review marks, a drag that makes a pane live and selects, and
// nothing left behind when a pane closes.
import { readFile } from 'node:fs/promises';
import { start } from './harness.mjs';

const fixture = (name) => readFile(new URL(`../fixtures/${name}`, import.meta.url));
const pdfs = { hello: await fixture('hello.pdf'), dense: await fixture('dense-page.pdf') };
const pngs = { swatch: await fixture('swatch.png'), figure: await fixture('large-figure.png') };
let pdfNow = 'hello';
let pngNow = 'swatch';
const store = {
  format: 3, revision: 1, nextId: 3, reviews: [
    { id: 'r1', kind: 'markdown', at: { line: 1 }, quote: 'brave new', anchor: { prefix: 'hello ', suffix: ' world.' }, action: 'polish', status: 'open' },
    { id: 'r2', kind: 'pdf', at: { page: 1 }, quote: 'smoke test', action: 'check', status: 'open' },
  ],
};

const { page, ok, shot, finish } = await start({ store });
await page.route('**/d/live.pdf*', (route) => route.fulfill({ body: pdfs[pdfNow], contentType: 'application/pdf' }));
await page.route('**/d/pic.png*', (route) => route.fulfill({ body: pngs[pngNow], contentType: 'image/png' }));
// Documents opened and closed on the shared worker.
await page.evaluate(() => {
  window.__docs = { opened: 0, closed: 0 };
  const send = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message?.action === 'GetDocRequest') window.__docs.opened += 1;
    if (message?.action === 'Terminate') window.__docs.closed += 1;
    return send.call(this, message, ...rest);
  };
});
const pane = (path) => `.pane-body[data-path="${path}"]`;
const livePath = () => page.evaluate(() => document.getElementById('stage').closest('.pane-body')?.dataset.path);
const pick = (path) => page.evaluate((path) => { window.__pick = path; }, path);
const changed = (path, revision) => page.evaluate(([path, revision]) => window.__emit('file-changed', { path, kind: 'changed', revision }), [path, revision]);
const paneText = (path) => page.evaluate((sel) => document.querySelector(`${sel} .pane-pdf .textLayer`)?.textContent ?? '', pane(path));
const waitFor = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 }).then(() => true, () => false);

await pick('/d/live.pdf');
await page.keyboard.press('Control+Shift+D');
await page.waitForTimeout(1200);
ok(await livePath() === '/d/live.pdf', 'The PDF is live in the new pane');
ok(await waitFor((sel) => document.querySelector(`${sel} mark.review[data-review-id="r1"]`), pane('/d/a.md')),
  'Review marks show in a Markdown pane that is not live');
ok(await page.$eval(`${pane('/d/a.md')} mark.review`, (m) => m.textContent) === 'brave new', 'The mark covers the quote');
ok(await page.$(`${pane('/d/a.md')} .review-no`) !== null, 'The copy carries the review badge');

await page.click(`${pane('/d/a.md')} .pane-cover`);
await page.waitForTimeout(600);
ok(await livePath() === '/d/a.md', 'Clicking the Markdown pane makes it live');
ok(await waitFor((sel) => document.querySelector(`${sel} .pane-pdf .page canvas`) && !document.querySelector(`${sel} > .pane-snapshot > #viewerContainer`), pane('/d/live.pdf')),
  'The PDF pane gets a viewer of its own, and the pixel copy goes');
ok((await paneText('/d/live.pdf')).includes('smoke test'), 'The PDF pane shows hello.pdf');
ok(await waitFor((sel) => document.querySelector(`${sel} .pane-pdf review-q[data-review-id="r2"]`), pane('/d/live.pdf')),
  'Review marks show in a PDF pane that is not live');
ok((await page.evaluate(() => window.__calls.filter((c) => c[0] === 'watch_secondary').at(-1)?.[1]?.paths || [])).join() === '/d/live.pdf',
  'The PDF pane is watched');
await shot('live-panes-pdf');

pdfNow = 'dense';
await changed('/d/live.pdf', 50);
ok(await waitFor((sel) => document.querySelector(`${sel} .pane-pdf .textLayer`)?.textContent.includes('Scroll render'), pane('/d/live.pdf')),
  'The PDF pane re-renders when its file changes');
ok(await livePath() === '/d/a.md', 'The live pane stays where it was');
const scroller = `${pane('/d/live.pdf')} .pane-pdf`;
const room = await page.$eval(scroller, (s) => s.scrollHeight - s.clientHeight);
await page.$eval(scroller, (s) => { s.scrollTop = 150; });
await page.waitForTimeout(200);
pdfNow = 'hello';
await changed('/d/live.pdf', 51);
ok(await waitFor((sel) => document.querySelector(`${sel} .pane-pdf .textLayer`)?.textContent.includes('smoke test'), pane('/d/live.pdf')),
  'It reloads again on the next change');
const top = await page.$eval(scroller, (s) => s.scrollTop);
ok(room > 150 && Math.abs(top - 150) < 2, `Its scroll survives the reload (${top} of ${room})`);
const docs = await page.evaluate(() => window.__docs);
ok(docs.opened - docs.closed === 1, `Each reload frees the document before (${JSON.stringify(docs)})`);

await page.click(`${pane('/d/live.pdf')} .pane-cover`);
await page.waitForTimeout(1200);
ok(await livePath() === '/d/live.pdf', 'Clicking the PDF pane makes it live');
const back = await page.evaluate(() => ({ top: document.getElementById('viewerContainer').scrollTop, text: document.querySelector('#stage .textLayer')?.textContent ?? '' }));
ok(Math.abs(back.top - 150) < 2 && back.text.includes('smoke test'), `The live PDF opens where the pane was (${back.top})`);
ok(await page.$(`${pane('/d/live.pdf')} .pane-pdf`) === null, 'The pane viewer is gone once the pane is live');

// One gesture: press in the Markdown copy, drag, and the text is selected in the live view.
const words = await page.evaluate((sel) => {
  const node = [...document.querySelectorAll(`${sel} #markdown p`)].find((p) => p.textContent.includes('Second'));
  const range = document.createRange();
  const text = node.lastChild;
  range.setStart(text, text.textContent.indexOf('Second'));
  range.setEnd(text, text.textContent.indexOf('here'));
  const { left, right, top, bottom } = range.getBoundingClientRect();
  return { x0: left + 1, x1: right - 1, y: (top + bottom) / 2 };
}, pane('/d/a.md'));
await page.mouse.move(words.x0, words.y);
await page.mouse.down();
await page.mouse.move(words.x0 + 20, words.y, { steps: 3 });
await page.mouse.move(words.x1, words.y, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(500);
ok(await livePath() === '/d/a.md', 'A press on a pane makes it live');
const selected = await page.evaluate(() => [getSelection().toString(), Boolean(getSelection().anchorNode?.parentElement?.closest('#stage #markdown'))]);
ok(selected[1] && /Second paragraph/.test(selected[0]), `The drag goes on as a selection in the live view ("${selected[0]}")`);

// Closing the tab frees its viewer and its document.
await waitFor((sel) => document.querySelector(`${sel} .pane-pdf .page canvas`), pane('/d/live.pdf'));
const before = await page.evaluate(() => window.__docs);
ok(before.opened - before.closed === 1, `The PDF pane holds one document (${JSON.stringify(before)})`);
await page.click(`.dv-tab:has-text("live.pdf") .dv-default-tab-action`);
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({ ...window.__docs, canvases: document.querySelectorAll('.pane-pdf canvas, .pane-pdf').length }));
ok(after.opened === after.closed && after.canvases === 0, `Closing the tab frees its viewer (${JSON.stringify(after)})`);

// An image pane follows its file.
await pick('/d/pic.png');
await page.keyboard.press('Control+Shift+D');
await page.waitForTimeout(800);
await page.click(`${pane('/d/a.md')} .pane-cover`);
await page.waitForTimeout(600);
const size = () => page.$eval(`${pane('/d/pic.png')} img`, (img) => `${img.naturalWidth}x${img.naturalHeight}`).catch(() => '');
const first = await size();
pngNow = 'figure';
await changed('/d/pic.png', 70);
await page.waitForTimeout(600);
const second = await size();
ok(first && second && first !== second, `An image pane reloads when its file changes (${first} -> ${second})`);
await page.selectOption('#splitView', 'off');
await page.waitForTimeout(400);
const left = await page.evaluate(() => ({ ...window.__docs, viewers: document.querySelectorAll('.pane-pdf').length }));
ok(left.opened === left.closed && left.viewers === 0, 'Leaving panes leaves no viewer behind');
await finish();
