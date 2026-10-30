// The website's screenshots, taken in the real app (Rust and WebKitGTK) driven
// over WebDriver by tauri-driver as tests/e2e/app.mjs does, then checked by
// their pixels, which the Chromium tests cannot see. Linux only:
//   xvfb-run -a -s '-screen 0 3200x2000x24' node tools/screenshots.mjs --out <dir> [--bin <pdf-next>]
// Writes <name>.png (2x), <name>.webp (1600x1000) and social.png (1200x750)
// into <dir>. Needs tauri-driver, WebKitWebDriver and Pillow (python3-pil).
import { annotate } from './annotate.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const pdfDrawn = "[...document.querySelectorAll('#viewer .page canvas')].some((c) => c.width > 0) && !!document.querySelector('#viewer [data-review-id]')";

export const SHOTS = {
  paper: { open: ['wake.pdf'], ready: pdfDrawn },
  night: { open: ['wake.pdf', '--night'], ready: `${pdfDrawn} && document.body.classList.contains('mode-night')` },
  markdown: { open: ['notes.md'], ready: "!!document.querySelector('#markdown h1') && !!document.querySelector('#markdown pre') && !!document.querySelector('#markdown li')" },
  panes: {
    open: ['notes.md', 'wake.pdf'],
    ready: "document.querySelectorAll('#tabs .tab').length === 2",
    keys: ['d'],
    after: "document.querySelectorAll('#panes .dv-groupview').length === 2 && [...document.querySelectorAll('#panes canvas')].some((c) => c.width > 0) && !!document.querySelector('#panes h1') && !!document.querySelector('#panes [data-review-id]')",
  },
  review: {
    open: ['wake.pdf'],
    ready: pdfDrawn,
    keys: ['r'],
    after: "!document.getElementById('reviewPane').hidden && document.querySelectorAll('#reviewList .review-row').length === 3",
  },
};
export const OUTPUTS = [...Object.keys(SHOTS).map((name) => `${name}.webp`), 'social.png'];

const REVIEWS = [
  ['--quote', 'globally unstable flow', '--request', 'ask:why', '--request', 'scope:phrase'],
  ['--quote', 'within one per cent of direct numerical simulation', '--action', 'check', '--comment', 'Give the DNS resolution here.'],
  ['--quote', 'matches the frequency of the saturated limit cycle', '--action', 'shorten'],
];

// 8-bit RGB(A) PNGs, as WebKit writes them.
export function decodePng(buffer) {
  let at = 8;
  let header;
  const chunks = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    if (type === 'IDAT') chunks.push(body);
    at += 12 + length;
  }
  const channels = { 2: 3, 6: 4 }[header.color];
  if (header.depth !== 8 || !channels || header.interlace) throw new Error(`unsupported PNG ${JSON.stringify(header)}`);
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const predict = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      pixels[y * stride + x] = (line[x] + predict) & 255;
    }
  }
  const pixel = (x, y) => {
    const i = (Math.min(header.height - 1, Math.max(0, y)) * header.width + Math.min(header.width - 1, Math.max(0, x))) * channels;
    return [pixels[i], pixels[i + 1], pixels[i + 2]];
  };
  return { width: header.width, height: header.height, pixel };
}

// Luminance statistics of a rectangle in image pixels, sampled every other pixel.
export function stats(image, { x, y, width, height }) {
  let n = 0;
  let sum = 0;
  let squares = 0;
  let dark = 0;
  let light = 0;
  let tinted = 0;
  const lum = [];
  for (let j = Math.round(y); j < y + height; j += 2) {
    for (let i = Math.round(x); i < x + width; i += 2) {
      const [r, g, b] = image.pixel(i, j);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n += 1;
      sum += l;
      squares += l * l;
      if (l < 110) dark += 1;
      if (l > 150) light += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 30) tinted += 1;
      lum.push(l);
    }
  }
  const mean = sum / n;
  return { mean, sd: Math.sqrt(Math.max(0, squares / n - mean * mean)), dark: dark / n, light: light / n, tinted: tinted / n, lum };
}

const round = (value) => Math.round(value * 1000) / 1000;
const brief = ({ lum, ...rest }) => JSON.stringify(Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, round(v)])));

// What each picture must show, from its pixels. 0.17.1 shipped split panes
// without their stylesheet and white Night pages on WebKit; both are here.
export function checkShot(name, image, info) {
  const scale = image.width / info.width;
  const rect = (r) => r && { x: r.x * scale, y: r.y * scale, width: r.width * scale, height: r.height * scale };
  const results = [[scale === 2 && info.width === 1440 && info.height === 900, `${name} is a 1440x900 window drawn at twice its size (${image.width}x${image.height} for ${info.width}x${info.height})`]];
  results.push([info.barShown !== false, `${name} shows the toolbar`]);
  const below = { x: 0, y: info.bar * scale, width: image.width, height: image.height - info.bar * scale };
  if (name === 'paper' || name === 'night') {
    const page = info.page && stats(image, rect(info.page));
    results.push(page
      ? name === 'paper'
        ? [page.mean > 200 && page.dark > 0.003, `paper shows a light page with ink in Clear mode ${brief(page)}`]
        : [page.mean < 80 && page.light > 0.003, `night shows a dark page with light text ${brief(page)}`]
      : [false, `${name} has a page on screen`]);
  }
  if (name === 'markdown') {
    const column = info.column && stats(image, rect(info.column));
    results.push([!!column && column.dark > 0.005 && column.sd > 20, `markdown shows a column of text ${column ? brief(column) : 'none'}`]);
  }
  if (name === 'panes') {
    const half = { ...below, width: Math.floor(image.width / 2) };
    const left = stats(image, half);
    const right = stats(image, { ...half, x: half.width });
    const n = Math.min(left.lum.length, right.lum.length);
    let diff = 0;
    for (let i = 0; i < n; i += 1) diff += Math.abs(left.lum[i] - right.lum[i]);
    diff /= n;
    results.push([left.sd > 20 && left.dark > 0.003, `panes: the left half has a document ${brief(left)}`]);
    results.push([right.sd > 20 && right.dark > 0.003, `panes: the right half has a document ${brief(right)}`]);
    results.push([diff > 8, `panes: the two halves show different documents (mean difference ${round(diff)})`]);
    const [one, two] = info.groups;
    results.push([info.groups.length === 2 && one.x + one.width <= two.x + 1 && Math.min(one.width, two.width) > info.width * 0.3,
      `panes: two panes side by side, each a third of the window or more ${JSON.stringify(info.groups)}`]);
  }
  if (name === 'review') {
    const panel = info.review && info.review.width > 200 && stats(image, rect(info.review));
    results.push([!!panel && panel.sd > 15 && panel.tinted > 0.05, `review shows the Review panel with its tinted rows ${panel ? brief(panel) : JSON.stringify(info.review)}`]);
  }
  return results;
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const option = (flag) => {
    const at = process.argv.indexOf(flag);
    return at > 0 ? process.argv[at + 1] : undefined;
  };
  const out = option('--out') && resolve(option('--out'));
  if (!out) throw new Error('usage: node tools/screenshots.mjs --out <dir> [--bin <pdf-next>]');
  const bin = option('--bin') || process.env.PDF_NEXT_BIN || ['release', 'debug'].map((p) => join(root, 'src-tauri', 'target', p, 'pdf-next')).find(existsSync);
  if (!bin || !existsSync(bin)) throw new Error(`no app at ${bin}: pass --bin or build it first`);
  mkdirSync(out, { recursive: true });

  const dir = mkdtempSync(join(tmpdir(), 'pdf-next-shots-'));
  for (const name of ['wake.pdf', 'wake.tex', 'notes.md']) copyFileSync(join(root, 'tests', 'fixtures', 'site', name), join(dir, name));
  for (const review of REVIEWS) {
    const add = spawnSync(bin, ['reviews', 'add', join(dir, 'wake.pdf'), '--page', '1', ...review], { encoding: 'utf8' });
    if (add.status !== 0) throw new Error(`pdf-next reviews add failed: ${add.stderr || add.stdout}`);
  }
  // A profile of its own, so nothing remembered from an earlier run (a layout,
  // a session, a page mode) reaches the pictures.
  const home = join(dir, 'profile');
  const env = { ...process.env, GDK_SCALE: '2', GDK_DPI_SCALE: '1', XDG_DATA_HOME: join(home, 'data'), XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache') };

  const port = Number(process.env.TAURI_DRIVER_PORT || 4454);
  const base = `http://127.0.0.1:${port}`;
  const driver = spawn('tauri-driver', ['--port', String(port), '--native-port', String(port + 1)], { stdio: ['ignore', 'inherit', 'inherit'], detached: true, env });
  const stop = () => {
    try { process.kill(-driver.pid, 'SIGTERM'); } catch { /* gone */ }
  };
  process.on('exit', stop);
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  for (let i = 0; i < 50 && !(await fetch(`${base}/status`).then((r) => r.ok, () => false)); i += 1) await sleep(200);
  async function call(method, path, body) {
    const response = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${path}: ${JSON.stringify(json.value ?? json)}`);
    return json.value;
  }

  const failures = [];
  const taken = [];
  try {
    for (const [name, shot] of Object.entries(SHOTS)) {
      const sid = (await call('POST', '/session', {
        capabilities: { alwaysMatch: { 'tauri:options': { application: bin, args: [...shot.open.map((f) => (f.startsWith('--') ? f : join(dir, f))), '--wait'] } } },
      })).sessionId;
      const run = (script) => call('POST', `/session/${sid}/execute/sync`, { script, args: [] });
      const until = async (condition, what, timeout = 20_000) => {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
          if (await run(`return Boolean(${condition})`).catch(() => false)) return true;
          await sleep(150);
        }
        throw new Error(`${name}: timed out waiting for ${what}`);
      };
      const chord = (key) => call('POST', `/session/${sid}/actions`, {
        actions: [{ type: 'key', id: 'keyboard', actions: ['\uE009', '\uE008', key, key, '\uE008', '\uE009'].map((value, i) => ({ type: i < 3 ? 'keyDown' : 'keyUp', value })) }],
      });
      // Fonts in, the layout still for a second, and two frames painted.
      const settle = async () => {
        await run('return document.fonts.ready.then(() => true)').catch(() => {});
        const layout = `return JSON.stringify([innerWidth, innerHeight, ...[...document.querySelectorAll('#panes .dv-groupview, #viewer .page, #reviewPane, #markdown')]
          .map((el) => Object.values(el.getBoundingClientRect().toJSON()).map(Math.round))])`;
        let last = '';
        for (let still = 0, i = 0; still < 4 && i < 40; i += 1) {
          const now = await run(layout);
          still = now === last ? still + 1 : 0;
          last = now;
          await sleep(250);
        }
        await run('return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))');
        await sleep(500);
      };
      try {
        // The window fits itself to the page, a split and the Review panel,
        // so it is sized again once they are open.
        const size = async () => {
          await call('POST', `/session/${sid}/window/rect`, { width: 1440, height: 900 });
          await until('innerWidth === 1440 && innerHeight === 900', 'a 1440x900 window', 5_000).catch(() => {});
        };
        // As on an offline machine, so a build older than the latest release
        // shows no update notice; the check runs 3 s after launch. Focus mode
        // off, or the toolbar fades in some pictures and not in others,
        // depending on the keys and scrolls that came before.
        await run(`const real = window.fetch;
          window.fetch = (url, ...rest) => String(url).startsWith('https://api.github.com/') ? Promise.reject(new TypeError('offline')) : real(url, ...rest);
          localStorage.setItem('pdf-next.focus-mode', '0');
          document.body.classList.remove('bar-hidden');`);
        await until(shot.ready, 'the document');
        await size();
        if (!shot.open.includes('--night')) await run("document.getElementById('mode').dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }))");
        await settle();
        for (const key of shot.keys ?? []) await chord(key);
        if (shot.after) await until(shot.after, 'the view to open');
        await size();
        await settle();
        const png = Buffer.from(await call('GET', `/session/${sid}/screenshot`), 'base64');
        writeFileSync(join(out, `${name}.png`), png);
        const info = await run(`const box = (el) => { if (!el || el.hidden) return null; const r = el.getBoundingClientRect();
            const x = Math.max(0, r.left), y = Math.max(0, r.top), w = Math.min(innerWidth, r.right) - x, h = Math.min(innerHeight, r.bottom) - y;
            return w > 0 && h > 0 ? { x, y, width: w, height: h } : null; };
          return { width: innerWidth, height: innerHeight, bar: document.getElementById('bar').getBoundingClientRect().bottom,
            barShown: getComputedStyle(document.getElementById('bar')).opacity === '1',
            page: box(document.querySelector('#viewer .page')), column: box(document.getElementById('markdown')),
            review: box(document.getElementById('reviewPane')), groups: [...document.querySelectorAll('#panes .dv-groupview')].map(box).filter(Boolean) };`);
        taken.push(name);
        for (const [ok, message] of checkShot(name, decodePng(png), info)) {
          console.log(ok ? 'ok  ' : 'FAIL', message);
          if (!ok) failures.push(message);
        }
      } catch (error) {
        console.log('FAIL', error.message);
        failures.push(error.message);
      } finally {
        await call('DELETE', `/session/${sid}`).catch(() => {});
      }
    }
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }

  if (taken.length) {
    const convert = spawnSync('python3', ['-I', '-c', `
import sys
from PIL import Image, ImageOps
out, names = sys.argv[1], sys.argv[2:]
for name in names:
    image = Image.open(f"{out}/{name}.png").convert("RGB")
    ImageOps.fit(image, (1600, 1000), Image.LANCZOS).save(f"{out}/{name}.webp", quality=88, method=6)
    if name == "panes":
        ImageOps.fit(image, (1200, 750), Image.LANCZOS).save(f"{out}/social.png", optimize=True)
`, out, ...taken], { encoding: 'utf8' });
    if (convert.status !== 0) failures.push(`converting to WebP needs Pillow (apt install python3-pil): ${convert.stderr.trim()}`);
    else console.log(`wrote ${taken.map((name) => `${name}.webp`).join(', ')}${taken.includes('panes') ? ', social.png' : ''} to ${out}`);
  }
  for (const message of failures) annotate('website screenshots', message);
  console.log(failures.length ? `${failures.length} screenshot checks failed` : 'All screenshot checks passed');
  return failures.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error);
    annotate('website screenshots', error.stack || error.message);
    process.exit(1);
  });
}
