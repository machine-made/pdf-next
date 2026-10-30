// The real app end to end: the built binary (Rust backend and system webview)
// driven over WebDriver by tauri-driver. Linux only (WebKitWebDriver); needs a
// display, so CI runs it under xvfb-run.
//   node tests/e2e/app.mjs            # binary from src-tauri/target, or PDF_NEXT_BIN
import { annotate } from '../../tools/annotate.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bin = process.env.PDF_NEXT_BIN || ['release', 'debug'].map((p) => join(root, 'src-tauri', 'target', p, 'pdf-next')).find(existsSync);
if (!bin) throw new Error('no built app: run `bunx tauri build --no-bundle` or `cargo build` in src-tauri first');
const port = Number(process.env.TAURI_DRIVER_PORT || 4444);
const base = `http://127.0.0.1:${port}`;
const dir = mkdtempSync(join(tmpdir(), 'pdf-next-e2e-'));
const md = join(dir, 'notes.md');
const pdf = join(dir, 'paper.pdf');
writeFileSync(md, '# Notes\n\nThe wake of a sphere sheds vortex loops.\n\nA second paragraph.\n');
copyFileSync(join(root, 'tests', 'fixtures', 'three-pages.pdf'), pdf);

let pass = 0;
let fail = 0;
const ok = (condition, message) => {
  if (condition) pass += 1;
  else fail += 1;
  console.log(condition ? 'ok  ' : 'FAIL', message);
  if (!condition) annotate('e2e', message);
  return condition;
};

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.value ?? json)}`);
  return json.value;
}

const driver = spawn('tauri-driver', ['--port', String(port), '--native-port', String(port + 1)], { stdio: ['ignore', 'inherit', 'inherit'], detached: true });
const stop = () => {
  try { process.kill(-driver.pid, 'SIGTERM'); } catch { /* gone */ }
};
process.on('exit', stop);
for (let i = 0; i < 50; i += 1) {
  if (await fetch(`${base}/status`).then((r) => r.ok, () => false)) break;
  await new Promise((done) => setTimeout(done, 200));
}

const sid = (await call('POST', '/session', {
  capabilities: { alwaysMatch: { 'tauri:options': { application: bin, args: [md, pdf, '--wait'] } } },
})).sessionId;
const run = (script, ...args) => call('POST', `/session/${sid}/execute/sync`, { script, args });
const element = async (css) => Object.values(await call('POST', `/session/${sid}/element`, { using: 'css selector', value: css }))[0];
const click = async (css) => call('POST', `/session/${sid}/element/${await element(css)}/click`, {});
const type = async (css, text) => call('POST', `/session/${sid}/element/${await element(css)}/value`, { text });
const keys = (...chords) => call('POST', `/session/${sid}/actions`, {
  actions: [{
    type: 'key', id: 'keyboard',
    actions: chords.flatMap((chord) => [...chord.map((value) => ({ type: 'keyDown', value })), ...chord.reverse().map((value) => ({ type: 'keyUp', value }))]),
  }],
});
const CTRL = '';
const SHIFT = '';
async function until(script, what, timeout = 15_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await run(script).catch((error) => String(error));
    if (last === true) return true;
    await new Promise((done) => setTimeout(done, 150));
  }
  console.log(`  waited for ${what}; last: ${JSON.stringify(last)}`);
  return false;
}
const store = () => JSON.parse(readFileSync(join(dir, 'notes_review.json'), 'utf8'));

try {
  const started = Date.now();
  ok(await until("return document.querySelector('#markdown')?.textContent.includes('vortex loops') === true", 'the Markdown text'), 'The Markdown file renders in the real window');
  console.log(`  first draw after ${Date.now() - started} ms`);
  ok(await run("return document.querySelector('#markdown h1')?.id") === 'md-notes', 'The Rust renderer named the heading');
  ok(await until("return document.querySelectorAll('#tabs .tab').length === 2", 'the second tab'), 'The PDF from the command line is a second tab');

  writeFileSync(md, '# Notes\n\nThe wake of a sphere sheds vortex rings downstream.\n\nA second paragraph.\n');
  ok(await until("return document.querySelector('#markdown')?.textContent.includes('vortex rings downstream') === true", 'the rewritten text'), 'Rewriting the file on disk reloads the page');

  await run(`const p = document.querySelectorAll('#markdown p')[0];
    const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const at = walk.currentNode.textContent.indexOf('vortex rings');
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(walk.currentNode, at);
        range.setEnd(walk.currentNode, at + 12);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }
    }`);
  await keys([CTRL, SHIFT, 'n']);
  ok(await until("return !document.getElementById('noteBox').hidden", 'the review card'), 'Ctrl+Shift+N opens the review card on a selection');
  await type('#noteText', 'Name the shedding regime');
  await click('#noteSave');
  ok(await until("return document.querySelectorAll('#reviewList .review-row').length === 1", 'the review row'), 'Save lists the review in the panel');
  const saved = store();
  const review = saved.reviews[0];
  ok(saved.format === 3 && saved.nextId === 2 && review?.id === 'r1', 'notes_review.json holds r1');
  ok(review.quote === 'vortex rings' && review.comment === 'Name the shedding regime' && review.at.line === 3, `with the quote, comment and source line (${JSON.stringify(review.at)})`);
  ok(review.anchor?.documentRevision?.startsWith('sha256:') && review.anchor.prefix?.includes('sheds'), 'and the document digest and context');
  const agent = readFileSync(join(dir, 'notes_review.agent.txt'), 'utf8');
  const lines = agent.trim().split('\n');
  ok(/^# notes\.md rev \d+:/.test(lines[0]) && lines[0].includes('1 open'), 'notes_review.agent.txt has the header');
  ok(lines.length === 2 && lines[1] === 'r1 L3 Name the shedding regime | "vortex rings"', `and one line for the open item (${JSON.stringify(lines[1])})`);

  const done = spawnSync(bin, ['reviews', 'done', md, 'r1', 'named the regime'], { encoding: 'utf8' });
  ok(done.status === 0, `pdf-next reviews done exits 0 ${done.stderr.trim()}`);
  ok(store().reviews[0].status === 'applied' && store().reviews[0].resolution === 'named the regime', 'The CLI marks r1 applied on disk');
  ok(await until("return document.querySelector('#reviewList .review-row')?.dataset.status === 'applied'", 'the row to turn applied'), 'The open window shows r1 applied');
  ok(await run("return [...document.querySelectorAll('#reviewList .review-row button')].some((b) => b.textContent === 'Resolve')"), 'and offers Resolve');
  await run("[...document.querySelectorAll('#reviewList .review-row button')].find((b) => b.textContent === 'Resolve').click()");
  ok(await until("return document.querySelector('#reviewList .review-row')?.dataset.status === 'resolved'", 'resolved'), 'Resolve in the window');
  ok(store().reviews[0].status === 'resolved', 'writes resolved to the sidecar');

  await keys([CTRL, '2']);
  ok(await until("return document.body.classList.contains('kind-pdf') && [...document.querySelectorAll('#viewer .page canvas')].some((c) => c.width > 0)", 'a PDF canvas'), 'Ctrl+2 shows the PDF, drawn by PDF.js');
  ok(await run("return document.getElementById('pages').textContent") === '/ 3', 'with its three pages');
  const ink = await run(`const c = document.querySelector('#viewer .page canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark += 1;
    return dark;`);
  ok(ink > 100, `The page has ink (${ink} dark pixels)`);

  const clear = "document.getElementById('mode').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }))";
  await run(clear);
  await run("document.getElementById('mode').click()");
  ok(await until(`const c = document.querySelector('#viewer .page canvas');
    return document.body.classList.contains('mode-night') && c?.dataset.recolored === 'true' && c.getContext('2d').getImageData(4, 4, 1, 1).data[0] < 64`, 'a dark page'),
  'Night recolours the page after it is drawn in this webview');
  await run(clear);

  await keys([CTRL, SHIFT, 'd']);
  ok(await until("return document.querySelectorAll('#panes .dv-groupview').length === 2", 'two panes'), 'Ctrl+Shift+D splits the real window');
  const layout = await run(`const g = [...document.querySelectorAll('#panes .dv-groupview')].map((x) => x.getBoundingClientRect());
    return { left: g.map((r) => Math.round(r.left)), width: g.map((r) => Math.round(r.width)), tabs: getComputedStyle(document.querySelector('#panes .dv-tabs-container')).display };`);
  ok(layout.left[0] < layout.left[1] && layout.width.every((w) => w > 100) && layout.tabs === 'flex',
    `The panes sit side by side with their tab strips, so the webview applied dockview's stylesheet (${JSON.stringify(layout)})`);
} catch (error) {
  fail += 1;
  console.log('FAIL', error.message);
  annotate('e2e', error.stack || error.message);
} finally {
  await call('DELETE', `/session/${sid}`).catch(() => {});
  stop();
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
