// The frontend in Chromium against a mocked Tauri backend. Each test file
// opens the app with `start()`, checks with `ok()` and ends with `finish()`.

import { chromium } from 'playwright';
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = join(root, 'src');
const fixtures = join(root, 'tests', 'fixtures');
export const shots = process.env.PDF_NEXT_SHOTS || join(process.env.RUNNER_TEMP || tmpdir(), 'pdf-next-browser');
export const axePath = join(root, 'node_modules', 'axe-core', 'axe.min.js');

const types = {
  '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.json': 'application/json', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.png': 'image/png', '.wasm': 'application/wasm',
};

function serve() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
      const file = url.startsWith('/d/') ? join(fixtures, url.slice(3)) : join(src, url);
      if (!file.startsWith(src) && !file.startsWith(fixtures)) throw new Error('outside');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

export const defaultFiles = {
  '/d/a.md': 'Hello brave new world.\n\nSecond paragraph here.\n',
  '/d/b.md': 'Other file text.\n',
  '/d/c.md': 'Third file.\n',
};

// A file is its raw text, or { raw, html } to hand the page markup shaped like
// the Rust renderer's. `window.__fail[cmd] = 'message'` makes a command reject
// (sessionStorage `fail`, as JSON, does the same across a reload).
function mockTauri({ files, initial, theme, store }) {
  if (store) window.__store = store;
  const render = (raw) => raw.split('\n\n').filter(Boolean).map((block, i) => {
    const line = raw.split('\n\n').slice(0, i).join('\n\n').split('\n').length + (i ? 1 : 0);
    return `<p><span class="src" data-line="${i === 0 ? 1 : line}"></span>${block.replace(/\n$/, '')}</p>`;
  }).join('\n');
  const text = (p) => (typeof files[p] === 'object' ? files[p].raw : files[p]);
  let rev = 1;
  window.__calls = [];
  window.__files = files;
  window.__fail = JSON.parse(sessionStorage.getItem('fail') || '{}');
  const kind = (p) => (p.endsWith('.pdf') ? 'pdf' : p.endsWith('.png') ? 'image' : p.endsWith('.json') ? 'json' : 'markdown');
  const info = (p) => ({ path: p, name: p.split('/').pop(), kind: kind(p), revision: rev });
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const write = (change) => {
    const st = window.__store || { format: 3, revision: 0, nextId: 1, reviews: [] };
    change(st);
    st.revision += 1;
    window.__store = st;
    return copy(st);
  };
  const find = (id) => {
    const review = window.__store?.reviews.find((r) => r.id === id);
    if (!review) throw new Error('review not found');
    return review;
  };
  window.__TAURI__ = {
    core: {
      convertFileSrc: (p) => p,
      invoke: async (cmd, args = {}) => {
        window.__calls.push([cmd, args]);
        if (window.__fail[cmd]) throw window.__fail[cmd];
        switch (cmd) {
          case 'launch_options': return { version: '0.0.0-test' };
          case 'initial_file': return !initial || sessionStorage.getItem('noInitial') ? null : info(initial);
          case 'pending_files': return [];
          case 'open_path': return info(args.path);
          case 'read_markdown': {
            const f = files[args.path];
            return { html: typeof f === 'object' ? f.html : render(f), raw: text(args.path), digest: `sha256:${text(args.path).length}:${rev}` };
          }
          case 'read_json': return text(args.path);
          case 'edit_markdown': {
            const path = args.path ?? '/d/a.md';
            const f = text(path);
            if (f.slice(args.start, args.start + args.expectedText.length) !== args.expectedText) throw 'the file changed on disk';
            const s = f.slice(0, args.start) + args.replacement + f.slice(args.start + args.expectedText.length);
            files[path] = s;
            rev += 1;
            return `sha256:${s.length}:${rev}`;
          }
          case 'read_reviews': return window.__store ? copy(window.__store) : null;
          case 'append_review': return write((st) => {
            st.reviews.push({ ...args.review, id: `r${st.nextId}` });
            st.nextId += 1;
          });
          case 'update_review': return write(() => {
            const review = find(args.id);
            if ((review.comment || '') !== args.expectedComment) throw new Error('review conflict: comment changed on disk');
            review.comment = args.comment;
          });
          case 'patch_review': return write(() => Object.assign(find(args.id), args.patch));
          case 'delete_review': return write((st) => {
            find(args.id);
            st.reviews = st.reviews.filter((r) => r.id !== args.id);
          });
          case 'restore_review': return write((st) => {
            if (st.reviews.some((r) => r.id === args.review.id)) throw new Error(`${args.review.id} already exists`);
            st.reviews.push(args.review);
            st.reviews.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
          });
          case 'window_size': return { width: 1500, height: 900 };
          case 'os_theme': return theme;
          case 'siblings': return [];
          case 'pick_file': return window.__pick ?? null;
          default: return null;
        }
      },
    },
    event: {
      listen: async (name, fn) => {
        (window.__listeners ||= {})[name] = fn;
        window.__emit = (n, payload) => window.__listeners[n]?.({ payload });
        return () => {};
      },
    },
  };
}

const tally = { pass: 0, fail: 0, errors: [] };

/** Open the app. `initial` is the launch file, or null for the empty window. */
export async function start({ files = defaultFiles, initial = '/d/a.md', theme = 'light', store = null, viewport = { width: 1500, height: 900 } } = {}) {
  const server = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, colorScheme: theme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(mockTauri, { files, initial, theme, store });
  const url = `http://127.0.0.1:${server.address().port}/index.html`;
  await page.goto(url);
  if (initial?.endsWith('.md')) await page.waitForSelector('#markdown p');
  const ok = (condition, message) => {
    if (condition) tally.pass += 1;
    else tally.fail += 1;
    console.log(condition ? 'ok  ' : 'FAIL', message);
    return condition;
  };
  const selectText = (selector, text) => page.evaluate(([selector, text]) => {
    const walk = document.createTreeWalker(document.querySelector(selector), NodeFilter.SHOW_TEXT);
    let node;
    while (walk.nextNode()) if (walk.currentNode.textContent.includes(text)) { node = walk.currentNode; break; }
    const at = node.textContent.indexOf(text);
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + text.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, [selector, text]);
  const shot = (name, options = {}) => {
    mkdirSync(shots, { recursive: true });
    return page.screenshot({ path: join(shots, `${name}.png`), ...options });
  };
  const close = async () => {
    if (tally.fail) await shot(`failed-${Date.now()}`).catch(() => {});
    tally.errors.push(...errors);
    await browser.close();
    server.close();
  };
  const finish = async () => {
    await close();
    console.log(tally.errors.length ? `page errors: ${tally.errors.join('\n')}` : 'no page errors');
    console.log(`${tally.pass} passed, ${tally.fail} failed`);
    process.exit(tally.fail || tally.errors.length ? 1 : 0);
  };
  return { page, ok, errors, selectText, shot, close, finish };
}
