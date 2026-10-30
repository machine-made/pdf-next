// Source contracts for the things that are easy to break silently and
// expensive to notice: the real worker, streaming, the canvas budget, the
// one-second poll, and the mid-build gap behaviour.
import { annotate } from './annotate.mjs';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import './check_pdf_stream_limits.mjs';
import { REQUEST_GROUPS, REVIEW_REQUESTS, reviewRequests, requestsLabel, toggleRequest } from '../src/review-requests.mjs';
import { findAllSpans, findNormalizedSpan, normalizeReviewText, reviewLabel, resolveReviewAnchor, reviewAction, reviewStatus, reviewColor, sameReviewQuote, reattachedReviewAnchor, resolveMarkdownReview, selectionContext, madeOnOlderVersion, contextAt, ACTION_LABELS, REVIEW_ACTIONS, REVIEW_STATUSES } from '../src/review-label.mjs';
import { paginate, validPageView } from '../src/md-pages.mjs';
import { blockSpan, deleteEdit, figureWidthEdit, formatEdit, parentheticalEdit, sourceSpan } from '../src/md-edit.mjs';
import { BLOCK_LIMIT, DOCUMENT_LIMIT, TAGS, colourCode } from '../src/code-colour.mjs';
import { BEFORE_LIMIT, diffView, passageSource, passageText, wordDiff } from '../src/review-diff.mjs';
import { createHash } from 'node:crypto';
import { fuzzyScore, isTextField, matchCommand, rankCommands, selectChoices, shortcutKeys } from '../src/palette.mjs';
import { mapCollapsedIndex, reconcilePendingComment, reconcilePendingComments } from '../src/review-sync.mjs';
import { columnAt, linkDestination, locateDestination } from '../src/navigate.mjs';
import { PLACES_KEY, PLACES_MAX, folderOf, forgetPlace, notePlace, openedLabel, placeOf, readPlaces, recentPlaces } from '../src/places.mjs';
import { ZOOM_MAX, ZOOM_MIN, clampScale, snapScale, wheelFactor } from '../src/zoom.mjs';
import {
  REVIEW_SIZE_DEFAULT,
  REVIEW_SIZE_STEPS,
  nearestReviewSize,
  nextReviewSize,
} from '../src/review-size.mjs';

for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    annotate('frontend contracts', error?.stack || String(error));
    console.error(error);
    process.exit(1);
  });
}

const app = await readFile('src/app.mjs', 'utf8');
const main = await readFile('src-tauri/src/main.rs', 'utf8');
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const styles = await readFile('src/style.css', 'utf8');
const version = await readFile('src/vendor/PDFJS_VERSION', 'utf8');
const pdfCoreSource = await readFile('src/vendor/pdfjs/build/pdf.min.mjs', 'utf8');
const pdfViewerSource = await readFile('src/vendor/pdfjs/web/pdf_viewer.mjs', 'utf8');
const readme = await readFile('README.md', 'utf8');
const page = await readFile('src/index.html', 'utf8');
const smoke = await readFile('src/smoke.mjs', 'utf8');
const smokeHarness = await readFile('tools/smoke.mjs', 'utf8');
const nsisTemplate = await readFile('src-tauri/windows/installer.nsi', 'utf8');
const releaseWorkflow = await readFile('.github/workflows/release.yml', 'utf8');
assert.match(releaseWorkflow, /run: node tools\/check_frontend\.mjs/,
  'Release builds must run frontend regressions before publishing.');
assert.match(releaseWorkflow, /run: cargo test --locked/,
  'Release builds must run Rust regressions before publishing.');
for (const [job, workflow] of [['release-notes', 'release-notes'], ['install-check', 'install-check']]) {
  assert.match(releaseWorkflow, new RegExp(`\\n  ${job}:\\n    needs: [^\\n]*publish[^\\n]*\\n    if: always\\(\\) && needs\\.publish\\.result == 'success'[^\\n]*\\n    uses: \\./\\.github/workflows/${workflow}\\.yml`),
    `release.yml runs ${workflow}.yml once the release is published.`);
}
assert.match(releaseWorkflow, /install-check:\n    needs: \[publish, apt\]/, 'The install check waits for apt.');
{
  const notesWorkflow = await readFile('.github/workflows/release-notes.yml', 'utf8');
  assert.match(notesWorkflow, /paths: \[CHANGELOG\.md,/, 'Release notes follow CHANGELOG.md changes on main.');
  assert.match(notesWorkflow, /run: node tools\/sync_release_notes\.mjs\n/, 'Release notes are synced by tools/sync_release_notes.mjs.');
  const sync = await readFile('tools/sync_release_notes.mjs', 'utf8');
  assert.match(sync, /'tools\/release_notes\.mjs', tag/, 'Synced notes are exactly what release_notes.mjs prints.');
  assert.match(sync, /notes\.status !== 0\) \{\s*without\.push\(tag\);\s*continue;/, 'A release without a CHANGELOG.md section keeps its notes.');
  assert.match(sync, /tidy\(body\) === tidy\(notes\.stdout\)\) \{\s*continue;/, 'A release whose notes match is not edited.');
  if (process.platform !== 'win32') {
    // Against a stand-in gh (a shell script, so not on Windows): generated and download-only notes follow the
    // changelog; notes written by hand are never replaced.
    const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    const bin = mkdtempSync(join(tmpdir(), 'pdf-next-gh-'));
    const generatedBody = execFileSync(process.execPath, ['tools/release_notes.mjs', '0.16.4'], { encoding: 'utf8' }).replace('- ', '- Old wording: ');
    const releases = [
      { tag: 'v0.16.4', body: generatedBody },
      { tag: 'v0.5.0', body: 'Download the build for your system below.\n\n- **Windows** — `.exe` installer.' },
      { tag: 'v0.16.0', body: 'pdf-next by machine-made.\n\n- Review box: Esc, × and Cancel close it.' },
    ].map((release) => JSON.stringify(release)).join('\n');
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncase "$*" in *latest*) echo v0.16.4 ;; *paginate*) cat <<'JSON'\n${releases}\nJSON\n;; *) exit 1 ;; esac\n`);
    chmodSync(join(bin, 'gh'), 0o755);
    try {
      const out = execFileSync(process.execPath, ['tools/sync_release_notes.mjs', '--dry-run'], {
        encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      });
      assert.match(out, /would update v0\.16\.4\n/, 'Generated release notes follow CHANGELOG.md.');
      assert.match(out, /would update v0\.5\.0\n/, 'Download-only notes get their CHANGELOG.md section.');
      assert.doesNotMatch(out, /v0\.16\.0/, 'Release notes written by hand are left alone.');
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  }
  const winget = await readFile('.github/workflows/winget.yml', 'utf8');
  assert.match(winget, /Tee-Object -FilePath \$log/, 'winget keeps what wingetcreate printed.');
  assert.match(winget, /Get-Content \$log -Tail 20[\s\S]*?Replace\(\$env:WINGET_CREATE_GITHUB_TOKEN, '\*\*\*'\)[\s\S]*?::error /,
    'A winget failure is an ::error:: annotation with the tail of wingetcreate output and no token.');
  assert.doesNotMatch(winget, /--token/, 'The winget token never goes on a command line.');
}

// A sharp canvas at the old scroll position must not satisfy the render gate.
{
  const viewport = { left: 0, top: 100, right: 400, bottom: 500 };
  let rect = { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 };
  const canvas = { width: 800, height: 800, hidden: false,
    getBoundingClientRect: () => rect };
  const view = { renderingState: 3, canvas,
    div: { getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 900 }) } };
  const sharp = appFunction('sharpPdfViewport', 'async function smokePdfScroll', {
    ui: { container: { getBoundingClientRect: () => viewport,
      clientLeft: 0, clientTop: 0, clientWidth: 400, clientHeight: 400 } },
    window: { devicePixelRatio: 2 },
  });
  assert.equal(sharp(view), false, 'A sharp canvas that misses visible content must fail.');
  rect = { ...rect, top: 100, bottom: 500 };
  assert.equal(sharp(view), true);
  canvas.width = 400;
  assert.equal(sharp(view), false, 'A CSS-scaled low-resolution canvas must fail.');
  canvas.width = 800;
  view.detailView = { renderingState: 1, canvas };
  assert.equal(sharp(view), false, 'An unfinished detail render must fail.');
}

// Run the vendored detail view against a page rounded down by CSS. Percentages
// based on the unrounded viewport would shrink and displace the sharp crop.
{
  const source = pdfViewerSource.slice(
    pdfViewerSource.indexOf('class PDFPageDetailView extends BasePDFPageView'),
    pdfViewerSource.indexOf(';// ./web/struct_tree_layer_builder.js'),
  );
  const canvas = { style: {} };
  class Base {
    constructor(page) { this.div = page.div; this.renderingState = 0; }
    get renderingState() { return this.state; }
    set renderingState(value) { this.state = value; }
    cancelRendering() {}
    _resetCanvas() {}
    _createCanvas() { return { canvas, prevCanvas: null }; }
    _drawCanvas() { return Promise.resolve(); }
    dispatchPageRender() {}
  }
  const Detail = runInNewContext(`${source}\nPDFPageDetailView`, {
    BasePDFPageView: Base,
    RenderingStates: { INITIAL: 0, RUNNING: 1, FINISHED: 3, PAUSED: 2 },
    OutputScale: { pixelRatio: 3, capPixels: (pixels) => pixels },
  });
  const page = {
    div: { clientWidth: 4758, clientHeight: 6732, setAttribute() {} },
    viewport: { width: 4760, height: 6736, scale: 6 },
    maxCanvasPixels: 4_194_304, pdfPage: {},
    _ensureCanvasWrapper: () => ({}), _getRenderingContext: () => ({}),
  };
  page.detailView = new Detail({ pageView: page });
  page.detailView.update({ visibleArea: { minX: 0, minY: 3366, maxX: 793, maxY: 4488 } });
  await page.detailView.draw();
  assert.ok(Math.abs(parseFloat(canvas.style.width) / 100 * page.div.clientWidth - 793) < 0.01,
    'The cropped canvas must cover the visible width of a CSS-rounded page.');
  assert.ok(Math.abs(parseFloat(canvas.style.top) / 100 * page.div.clientHeight - 3366) < 0.01,
    'The cropped canvas must start at the actual visible scroll offset.');
  page.div.clientWidth = page.div.clientHeight = 0;
  page.detailView.renderingState = 0;
  await page.detailView.draw();
  assert.ok(Number.isFinite(parseFloat(canvas.style.width)),
    'A queued draw for a hidden page must not produce infinite CSS dimensions.');
  page.div.clientWidth = 4758;
  page.div.clientHeight = 6732;
  page.detailView.enableOptimizedPartialRendering = true;
  page.pdfPage.recordedBBoxes = {
    isEmpty: (index) => index === 0,
    minX: () => 0,
    maxX: () => 1,
    minY: (index) => index === 2 ? 0 : 0.5,
    maxY: (index) => index === 2 ? 0.1 : 0.6,
  };
  const context = page.detailView._getRenderingContext(canvas, null);
  assert.equal(context.operationsFilter(0), false);
  assert.equal(context.operationsFilter(1), true, 'Visible PDF drawing operations must remain.');
  assert.equal(context.operationsFilter(2), false, 'Off-screen PDF drawing operations must be skipped.');
}

{
  const canvas = { width: 256, height: 256,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    getContext: () => ({ getImageData: () => ({ data: Uint8Array.of(255, 255, 255, 255) }) }) };
  const view = { viewport: { height: 1000 }, canvas,
    div: { getBoundingClientRect: () => ({ top: 0 }) } };
  const scroll = appFunction('smokePdfScroll', '/// Report to the build server', {
    pdfViewer: { getPageView: () => view, update() {} },
    ui: { container: { scrollTop: 0, getBoundingClientRect: () => ({ top: 0, left: 0 }) } },
    state: { file: { name: 'dense-page.pdf' } }, failures: [],
    window: { devicePixelRatio: 1, requestAnimationFrame: (fn) => fn() },
    performance: { now: () => 0 }, eventBus: { on() {}, off() {} },
    sharpPdfViewport: () => true, settles: async () => true,
  });
  await assert.rejects(scroll(), /pixels did not change/,
    'Blank or stale pixels must fail the dense PDF scrolling test.');
}

// Exercise the shipped renderer, including cancellation before the first draw.
// An incomplete bounds cache must never suppress a later valid drawing operation.
{
  const prelude = `Map.prototype.getOrInsertComputed = function(key, create) {
    if (!this.has(key)) this.set(key, create(key));
    return this.get(key);
  }; class Iterator {}`;
  const core = runInNewContext(prelude +
    pdfCoreSource.slice(0, pdfCoreSource.lastIndexOf('export{'))
      .replaceAll('import.meta.url', '"file:///pdf-next/pdf.mjs"') +
    '\n({PDFPageProxy, OPS: globalThis.pdfjsLib.OPS})', {
    console, setTimeout, clearTimeout, DOMMatrix: class {},
  });
  const transport = {
    commonObjs: {}, getRenderingIntent: () => ({ renderingIntent: 1, cacheKey: 'display' }),
    getOptionalContentConfig: () => Promise.resolve({ renderingIntent: 1 }),
    canvasFactory: {}, filterFactory: {},
  };
  const page = new core.PDFPageProxy(0, {}, transport, null);
  page._pumpOperatorList = function({ cacheKey }) {
    const state = this._intentStates.get(cacheKey);
    state.operatorList = { fnArray: [core.OPS.paintSolidColorImageMask],
      argsArray: [null], lastChunk: true, length: 1 };
    state.displayReadyCapability.resolve(false);
  };
  let draws = 0;
  const context = {
    save() {}, restore() {}, transform() {},
    fillRect(x, y, width, height) { if (width === 1 && height === 1) draws++; },
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  const canvas = { width: 100, height: 100, getContext: () => context };
  context.canvas = canvas;
  const options = { canvas, viewport: { scale: 1, transform: [1, 0, 0, 1, 0, 0] },
    recordOperations: true };
  const canceled = page.render(options);
  canceled.onContinue = () => canceled.cancel();
  await assert.rejects(canceled.promise, { name: 'RenderingCancelledException' });
  assert.equal(page.recordedBBoxes, null, 'Canceled renders must not cache incomplete operation bounds.');
  await page.render(options).promise;
  assert.equal(page.recordedBBoxes.isEmpty(0), false, 'The completed redraw must record its drawing.');
  let excluded = 0;
  await page.render({ ...options, operationsFilter(index) {
    if (page.recordedBBoxes.isEmpty(index)) {
      excluded++;
      return false;
    }
    return true;
  } }).promise;
  assert.equal(excluded, 0, 'Detail rendering must retain drawing after a canceled base render.');
  assert.equal(draws, 2);
}

// Exercise the app functions with controlled IPC completion order.
function appFunction(name, next, context, source = app) {
  const pattern = new RegExp(`(?:async )?function ${name}\\(`);
  const start = source.search(pattern);
  const end = source.indexOf(`\n${next}`, start);
  assert.ok(start >= 0 && end > start, `Could not locate ${name}.`);
  return runInNewContext(`${source.slice(start, end)}\n${name}`, context);
}

// The markdown text menus set the article's style, remember it, and ignore unknown values.
{
  const stored = new Map();
  const menu = (style, values, fallback) => ({
    value: '',
    dataset: { md: style },
    options: values.map((value) => ({ value, defaultSelected: value === fallback })),
  });
  const font = menu('font', ['latin-modern', 'serif', 'sans', 'mono'], 'latin-modern');
  const size = menu('size', ['14', '15', '16', '17', '18', '20', '22', '24'], '17');
  const width = menu('width', ['narrow', 'normal', 'wide', 'full'], 'normal');
  const ui = { markdown: { dataset: {} } };
  const localStorage = { setItem: (key, value) => stored.set(key, value) };
  const setStyle = appFunction('setMarkdownStyle', '/// Markdown zoom', { ui, localStorage, paneArticles: () => [], paneMarkdownStages: () => [] });
  setStyle(font, 'sans');
  assert.equal(ui.markdown.dataset.font, 'sans', 'The chosen face reaches the article.');
  assert.equal(font.value, 'sans', 'The menu shows the chosen face.');
  assert.equal(stored.get('pdf-next.md-font'), 'sans', 'The face is remembered.');
  setStyle(font, 'comic-sans', { persist: false });
  assert.equal(ui.markdown.dataset.font, 'latin-modern', 'An unknown face falls back to the default.');
  assert.equal(stored.get('pdf-next.md-font'), 'sans', 'A restore does not overwrite the saved choice.');
  setStyle(size, null, { persist: false });
  assert.equal(ui.markdown.dataset.size, '17', 'No saved size gives the marked default, not the first option.');
  setStyle(size, '22');
  setStyle(width, 'wide');
  assert.equal(stored.get('pdf-next.md-size'), '22', 'The size is remembered.');
  assert.deepEqual([ui.markdown.dataset.size, ui.markdown.dataset.width], ['22', 'wide'], 'Size and width reach the article.');
  const failing = { setItem() { throw new Error('storage off'); } };
  appFunction('setMarkdownStyle', '/// Markdown zoom', { ui, localStorage: failing, paneArticles: () => [], paneMarkdownStages: () => [] })(font, 'mono');
  assert.equal(ui.markdown.dataset.font, 'mono', 'The face changes without storage.');
}

// Page view: where a page ends, and the menu that picks the view per kind.
{
  const block = (top, height, keepNext = false) => ({ top, bottom: top + height, keepNext });
  const flow = (heights, keep = []) => {
    let top = 0;
    return heights.map((height, i) => {
      const item = block(top, height, keep.includes(i));
      top += height + 10;
      return item;
    });
  };
  assert.deepEqual(paginate([], 100), [], 'An empty article has no pages.');
  assert.deepEqual(paginate(flow([40, 40]), 100), [[0, 2]], 'Blocks that fit share a page.');
  assert.deepEqual(paginate(flow([40, 40, 40]), 100), [[0, 2], [2, 3]], 'The block that would overflow starts the next page.');
  assert.deepEqual(paginate(flow([40, 50, 40]), 100), [[0, 2], [2, 3]], 'A page may be filled exactly.');
  assert.deepEqual(paginate(flow([40, 40, 20, 40], [2]), 100), [[0, 2], [2, 4]],
    'A heading at the foot of a page moves with the block after it.');
  assert.deepEqual(paginate(flow([40, 20, 20, 40], [1, 2]), 100), [[0, 1], [1, 4]],
    'A run of headings moves as one with its block.');
  assert.deepEqual(paginate(flow([20, 20, 90], [0, 1]), 100), [[0, 2], [2, 3]],
    'When the headings fill the page alone, the page ends on the last of them.');
  assert.deepEqual(paginate(flow([30, 250, 30]), 100), [[0, 1], [1, 2], [2, 3]],
    'A block taller than a page stands alone on its own page.');
  assert.deepEqual(paginate(flow([250]), 100), [[0, 1]]);
  assert.deepEqual(paginate(flow([250, 30]), 100), [[0, 1], [1, 2]]);

  assert.equal(validPageView('md', 'two'), 'two');
  assert.equal(validPageView('md', undefined), 'continuous', 'Markdown opens continuous.');
  assert.equal(validPageView('pdf', null), 'single', 'A PDF opens as it always has.');
  assert.equal(validPageView('pdf', 'continuous'), 'single', 'A PDF has no continuous view.');
  assert.equal(validPageView('md', 'sideways'), 'continuous', 'An unknown value falls back.');

  const stored = new Map();
  const classes = new Set();
  const ui = { pageView: { value: '' } };
  const state = { file: { kind: 'markdown' }, pageViews: { pdf: 'single', md: 'continuous' } };
  let paginated = 0;
  const context = {
    state, ui, validPageView,
    localStorage: { setItem: (key, value) => stored.set(key, value) },
    document: { body: { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } } },
    schedulePaginate: () => { paginated += 1; },
    applyPdfSpread() {}, scheduleWrap() {},
  };
  const setView = appFunction('setPageView', '/// Pages in pairs', context);
  setView('two');
  assert.equal(state.pageViews.md, 'two');
  assert.equal(ui.pageView.value, 'two', 'The menu shows the chosen view.');
  assert.equal(stored.get('pdf-next.page-view.md'), 'two', 'The view is remembered for Markdown.');
  assert.equal(classes.has('pages-on'), true, 'A page view hides the width menu.');
  assert.equal(paginated, 1, 'Choosing a view repaginates.');
  setView('continuous', { persist: false, apply: false });
  assert.equal(stored.get('pdf-next.page-view.md'), 'two', 'A restore does not overwrite the saved choice.');
  assert.equal(classes.has('pages-on'), false);
  assert.equal(paginated, 1, 'A restore without apply leaves the article alone.');
  state.file = { kind: 'pdf' };
  setView('two');
  assert.equal(stored.get('pdf-next.page-view.pdf'), 'two', 'The PDF view is remembered apart from Markdown.');
  assert.equal(state.pageViews.md, 'continuous');
  setView('continuous');
  assert.equal(state.pageViews.pdf, 'single', 'A PDF rejects the continuous view.');
  assert.match(page, /id="pageView"[^>]*class="page-view-only"/, 'The menu is in the toolbar.');
  assert.match(page, /<option value="continuous">[^]*<option value="single">[^]*<option value="two">/);
  assert.match(styles, /body:not\(\.kind-pdf\):not\(\.kind-markdown\) \.page-view-only/,
    'The menu shows for PDF and Markdown only.');
  assert.match(app, /SpreadMode\.EVEN/, 'Two pages in a PDF is PDF.js even spreads.');
  assert.match(styles, /\.md-page \{[^}]*break-after: page/, 'A page box prints on its own sheet.');
}

// Markdown highlighting must stay within a small synchronous work budget.
{
  const diff = appFunction('changedIndices', '/// Extract ', {});
  const changed = (before, after) => Array.from(diff(before, after));
  assert.deepEqual(changed(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(changed(['a', 'b'], ['a', 'edited']), [1]);
  assert.deepEqual(changed(['a', 'b'], ['new', 'a', 'b']), [0]);
  assert.deepEqual(changed(['a', 'b'], ['b']), []);
  assert.deepEqual(changed([], ['new']), [0]);
  assert.deepEqual(changed(['a'], []), []);
  const before = Array.from({ length: 500 }, (_, i) => `paragraph ${i}`);
  const after = [...before];
  after[250] = 'edited';
  assert.deepEqual(changed(before, after), [250],
    'Comparisons at the work budget must still identify the changed block.');

  const skip = appFunction('changedIndices', '/// Extract ', {
    Array() { assert.fail('Over-budget comparisons must return before allocating the LCS table.'); },
  });
  for (const [n, m] of [[500, 501], [501, 500], [4000, 63], [63, 4000], [4000, 4000]]) {
    assert.deepEqual(Array.from(skip({ length: n }, { length: m })), [],
      `Skip detailed highlighting for ${n} × ${m} blocks.`);
  }

  const state = { generation: 1, markdownBlocks: { path: 'notes.md', texts: Array(4000).fill('old') } };
  const stage = { scrollHeight: 1000, scrollTop: 0, scrollLeft: 0 };
  const texts = Array(4000).fill('new');
  const show = appFunction('showMarkdown', '/// `_review.json`', {
    state, ui: { markdown: {}, markdownRaw: {}, markdownStage: stage }, markFigures() {},
    releaseDocument: async () => {},
    invoke: async () => ({ html: '<p>new</p>', raw: 'new' }),
    embedMarkdownImages() {}, colourCode() {},
    setRaw() {}, setMarkdownScale() {}, paginateMarkdown() {},
    markdownBlocks: () => texts.map((text) => ({ text })),
    changedIndices: diff,
    highlightChangedBlocks() { assert.fail('An over-budget reload must skip highlighting.'); },
    MARKDOWN_WINDOW_WIDTH: 780,
  });
  await show({ path: 'notes.md' }, { top: 300, left: 5, scale: 1 }, 1, false);
  assert.deepEqual(Array.from(state.markdownBlocks.texts), texts,
    'Skipping highlighting must still update the baseline for the next reload.');
  assert.equal(stage.scrollTop, 300, 'An over-budget reload must restore the scroll position.');
  assert.equal(stage.scrollLeft, 5);
}

// Find in Markdown: hit list, counter, wrap-around, clearing.
{
  assert.deepEqual(findAllSpans('the wake of a wake', 'WAKE'), [{ start: 4, end: 8 }, { start: 14, end: 18 }]);
  assert.deepEqual(findAllSpans('aaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }], 'Hits do not overlap.');
  assert.deepEqual(findAllSpans('abc', '  '), [], 'A blank query has no hits.');
  assert.match(page, /id="findToggle"[^>]*class="find-only"/, 'The find button is not hidden for Markdown.');
  assert.match(styles, /body:not\(\.kind-pdf\):not\(\.kind-markdown\) \.find-only/);

  const text = 'the wake of a wake in the wake';
  const ui = {
    markdown: {}, findInput: { value: 'wake' }, findCount: { textContent: '' },
  };
  const state = { file: { kind: 'markdown' }, mdFind: null };
  let unwrapped = 0;
  let scrolled = 0;
  const context = {
    state, ui, normalizeReviewText, findAllSpans, FIND_LIMIT: 1000,
    collectTextParts: () => ({ joined: text, parts: [] }),
    unwrapMarks() { unwrapped += 1; },
    wrapSpanParts(root, parts, span, makeWrap) { makeWrap(); },
    document: { createElement: () => ({
      isConnected: true, className: '', on: false,
      classList: { toggle(name, on) { this.owner.on = on; } },
      scrollIntoView() { scrolled += 1; },
    }) },
  };
  const create = context.document.createElement;
  context.document.createElement = () => {
    const mark = create();
    mark.classList.owner = mark;
    return mark;
  };
  context.showMarkdownFind = appFunction('showMarkdownFind', '/// Move to the next', context);
  const build = appFunction('buildMarkdownFind', 'function showMarkdownFind', context);
  context.buildMarkdownFind = build;
  const step = appFunction('stepMarkdownFind', 'function clearMarkdownFind', context);
  const clear = appFunction('clearMarkdownFind', 'function runFind', context);
  build();
  assert.equal(ui.findCount.textContent, '1 of 3', 'Three hits, the first one current.');
  assert.deepEqual(Array.from(state.mdFind.hits, ([mark]) => mark.on), [true, false, false]);
  step(1);
  step(1);
  assert.equal(ui.findCount.textContent, '3 of 3');
  step(1);
  assert.equal(ui.findCount.textContent, '1 of 3', 'Next wraps from the last hit to the first.');
  step(-1);
  assert.equal(ui.findCount.textContent, '3 of 3', 'Previous wraps from the first hit to the last.');
  assert.equal(scrolled, 4, 'Every move scrolls the hit into view.');
  ui.findInput.value = 'absent';
  build();
  assert.equal(ui.findCount.textContent, 'No match');
  step(1);
  assert.equal(ui.findCount.textContent, 'No match', 'Stepping with no hits stays put.');
  ui.findInput.value = 'wake';
  build();
  state.mdFind.hits[0][0].isConnected = false;
  step(1);
  assert.equal(state.mdFind.index, 0, 'Hits from a replaced article are rebuilt, not stepped.');
  const before = unwrapped;
  clear();
  assert.equal(state.mdFind, null, 'Closing find forgets the hits.');
  assert.equal(unwrapped, before + 1, 'Closing find removes the highlights.');
  clear();
  assert.equal(unwrapped, before + 1, 'Clearing twice does no work.');

  // One character matches nearly everything: no search, no marks, no count.
  ui.findInput.value = 'e';
  const marked = [];
  context.wrapSpanParts = (root, parts, span, makeWrap) => { marked.push(span.start); makeWrap(); };
  build();
  assert.deepEqual([state.mdFind.hits.length, ui.findCount.textContent, marked.length], [0, '', 0],
    'A one-character query searches nothing.');
  // A query with more than 1000 hits marks 1000, in reading order, and says so.
  context.collectTextParts = () => ({ joined: 'ab '.repeat(1500), parts: [] });
  ui.findInput.value = 'ab';
  build();
  assert.equal(ui.findCount.textContent, '1 of 1000+', 'The count says there are more hits than marked.');
  assert.equal(state.mdFind.hits.length, 1000);
  assert.equal(marked.length, 1000);
  assert.ok(marked.every((start, at) => at === 0 || start < marked[at - 1]),
    'Hits are wrapped from the last to the first.');
}

// Unwrapping many marks joins the text once per parent, not once per mark.
{
  let joins = 0;
  const parent = { insertBefore() {}, normalize() { joins += 1; } };
  const marks = Array.from({ length: 50 }, () => ({ parentNode: parent, firstChild: null, remove() {} }));
  const other = { insertBefore() {}, normalize() { joins += 100; } };
  marks.push({ parentNode: other, firstChild: null, remove() {} });
  appFunction('unwrapMarks', '/// A target is an instruction', { })({ querySelectorAll: () => marks }, 'mark');
  assert.equal(joins, 101, 'Each parent is normalized exactly once.');
}

// Wrapping a span looks only at the text nodes it covers.
{
  const wrapped = [];
  let looked = 0;
  const parts = Array.from({ length: 20000 }, (_, at) => ({
    start: at * 5, end: at * 5 + 4,
    node: {
      get parentNode() { looked += 1; return { insertBefore() {} }; },
      textContent: 'abcd', splitText() { assert.fail('Whole nodes need no split.'); },
      at,
    },
  }));
  const wrap = appFunction('wrapSpanParts', 'function wrapPdfQuote', {
    offsetsInPart: (part) => [0, 4],
  });
  const first = wrap({ contains: () => true }, parts, { start: 50_001, end: 50_012 }, () => ({
    appendChild(node) { wrapped.push(node.at); },
  }));
  assert.deepEqual(wrapped, [10000, 10001, 10002], 'The covered nodes are wrapped, and only those.');
  assert.ok(first, 'The first wrapper is returned.');
  assert.ok(looked <= 12, `Scanning is bounded by the span, not by the document (${looked} nodes read).`);
}

// Text for matching: badges are not text, inline markup does not add spaces, blocks do.
{
  const node = (text, parent) => ({ textContent: text, parentElement: parent });
  const element = ({ block = null, badge = false } = {}) => ({
    closest: (selector) => (selector.includes('review-nos') ? (badge ? {} : null) : block),
  });
  const p1 = element({ block: 'p1' });
  const bold = element({ block: 'p1' });
  const p2 = element({ block: 'p2' });
  const badges = element({ badge: true, block: 'p2' });
  const nodes = [node('Wa', p1), node('KE', bold), node(' is ', p1), node('long', bold), node(' ', p1),
    node('and', p1), node('r1', badges), node('Next', p2)];
  const collect = (inline) => appFunction('collectTextParts', 'function offsetsInPart', {
    BLOCK_ELEMENTS: 'p',
    NodeFilter: { SHOW_TEXT: 4 },
    document: { createTreeWalker: () => { let at = 0; return { nextNode: () => nodes[at++] ?? null }; } },
  })({}, inline);
  assert.equal(collect(true).joined, 'wake is long and next',
    'Inline markup runs together, a space stays where the source has one, and a block ends with a space.');
  assert.equal(collect(false).joined, 'wa ke is long and next', 'PDF text spans are still separated.');
  assert.equal(collect(true).parts.length, 6, 'Whitespace and badges make no parts.');
}

// Markdown reviews are located by the text around the quote.
{
  const article = 'the wake is long. repeat this phrase here. other text. repeat this phrase there. last wake.';
  const second = selectionContext('the wake is long. repeat this phrase here. other text. ', ' there. last wake.');
  assert.deepEqual(second, { prefix: 'ke is long. repeat this phrase here. other text.', suffix: 'there. last wake.' },
    'Context keeps at most 48 characters on each side, normalized.');
  const located = resolveMarkdownReview(article, { quote: 'Repeat this phrase', anchor: second });
  assert.equal(located.status, 'located', 'Repeated text is located by its context.');
  assert.equal(article.slice(located.start, located.end), 'repeat this phrase');
  assert.ok(located.start > article.indexOf('other text.'), 'The second occurrence is the one chosen.');
  const lead = resolveMarkdownReview(`  ${article}`, { quote: 'Repeat this phrase', anchor: second });
  assert.equal(`  ${article}`.slice(lead.start, lead.end), 'repeat this phrase', 'Offsets index the text as given.');
  assert.deepEqual({ ...resolveMarkdownReview('a  b c', { quote: 'b c' }) }, { status: 'located', start: 3, end: 6 },
    'Spaces collapsed inside the text do not shift the offsets.');
  const spread = 'First  Line\n\n  Second\tline  here.';
  const across = resolveMarkdownReview(spread, { quote: 'line second line' });
  assert.equal(spread.slice(across.start, across.end), 'Line\n\n  Second\tline', 'A quote across a newline maps back whole.');
  const page = resolveReviewAnchor([{ page: 2, text: ' One  TWO\nthree ' }], 'two three');
  assert.deepEqual({ ...page }, { status: 'located', page: 2, start: 6, end: 15 }, 'PDF page offsets index the page text.');
  const vouched = resolveMarkdownReview(` ${article} `, { quote: 'Long.', anchor: { prefix: 'wake is' } }, { normalized: true });
  assert.equal(` ${article} `.slice(vouched.start, vouched.end), 'long.', 'Vouched text is searched as given, offsets and all.');
  assert.deepEqual({ ...resolveMarkdownReview(article, { quote: 'repeat this phrase' }) },
    { status: 'ambiguous', legacy: true }, 'Repeated text without context is ambiguous, and falls back to its line range.');
  assert.equal(resolveMarkdownReview(article, { quote: 'repeat this phrase', anchor: { prefix: 'nowhere', suffix: '' } }).status,
    'ambiguous', 'Context that matches nothing does not pick a candidate.');
  assert.deepEqual({ ...resolveMarkdownReview(article, { quote: 'gone words', anchor: { prefix: 'x', suffix: '' } }) },
    { status: 'unlocated', legacy: false });
  assert.equal(resolveMarkdownReview(article, { quote: 'long' }).status, 'located',
    'An old review with a unique quote is located without context.');
  const moved = reattachedReviewAnchor({ prefix: 'old', suffix: 'old' }, { prefix: 'new', suffix: 'new' }, { line: 3 }, 'quote');
  assert.deepEqual([moved.prefix, moved.suffix], ['new', 'new'], 'Reattaching moves the context.');
  assert.deepEqual(moved.original, { anchor: { prefix: 'old', suffix: 'old' }, at: { line: 3 }, quote: 'quote' });
}

// Reattach moves the context, and for Markdown the lines as well; PDF keeps its page.
for (const kind of ['markdown', 'pdf']) {
  const patches = [];
  const state = { file: { path: 'a', kind }, generation: 1, markdownDigest: 'sha256:now' };
  const picked = kind === 'pdf'
    ? { kind, quote: 'the quote', at: { page: 4 }, anchor: { position: { page: 4, x: 1, y: 2 } } }
    : { kind, quote: 'The Quote', at: { line: 9, end: 11 }, anchor: { prefix: 'p', suffix: 's', documentRevision: 'sha256:then' } };
  const reattach = appFunction('reattachReview', 'async function jumpToReview', {
    state, describeSelection: () => picked, sameReviewQuote, reattachedReviewAnchor,
    pdfDocumentDigest: async () => 'sha256:pdf',
    patchReview: async (review, patch) => patches.push(patch),
    setStatus() {},
  });
  await reattach({ id: 'r1', quote: 'an older quote', at: kind === 'pdf' ? { page: 1 } : { line: 2 }, anchor: { prefix: 'old' } });
  assert.equal(patches.length, 1, `${kind} reattach patches the review.`);
  const [patch] = patches;
  assert.equal(patch.anchor.documentRevision, kind === 'pdf' ? 'sha256:pdf' : 'sha256:now',
    `${kind} reattach stamps the digest of the file shown.`);
  assert.equal(patch.quote, picked.quote, `${kind} reattach takes the selected text, even when it differs.`);
  assert.equal(patch.anchor.original.quote, 'an older quote', 'The first quote is kept.');
  if (kind === 'markdown') {
    assert.deepEqual(patch.at, { line: 9, end: 11 }, 'Markdown reattach moves the lines with the context.');
    assert.deepEqual(patch.anchor.original.at, { line: 2 }, 'The first place is kept.');
  } else {
    assert.deepEqual(patch.at, { page: 4 }, 'PDF reattach moves to the page of the selection.');
  }
}

// A Markdown selection without a source line reattaches the context only: the
// backend refuses an `at` without a line.
{
  const patches = [];
  const reattach = appFunction('reattachReview', 'async function jumpToReview', {
    state: { file: { path: 'a', kind: 'markdown' }, generation: 1, markdownDigest: 'sha256:now' },
    describeSelection: () => ({ kind: 'markdown', quote: 'the quote', at: {}, anchor: { prefix: 'p', suffix: 's' } }),
    sameReviewQuote, reattachedReviewAnchor,
    patchReview: async (review, patch) => patches.push(patch),
    setStatus() {},
  });
  await reattach({ id: 'r1', quote: 'the quote', at: { line: 2 }, anchor: { prefix: 'old' } });
  assert.equal(patches.length, 1, 'The context is still reattached.');
  assert.equal('at' in patches[0], false, 'No line, no at.');
}

// What the Markdown selection sends along when the article has no context to give.
{
  const selected = { isCollapsed: false, toString: () => ' quote ', anchorNode: {}, focusNode: {}, getRangeAt: () => ({}) };
  const context = (anchor, digest) => ({
    state: { file: { kind: 'markdown', path: 'a.md' }, markdownDigest: digest },
    window: { getSelection: () => selected },
    ui: { markdown: {} },
    basenameFromPath: (path) => path,
    lineNear: () => 3, atRange: (start) => ({ line: start }),
    markdownAnchorForSelection: () => anchor,
  });
  const describe = (anchor, digest) => appFunction('describeSelection', '/// Human form of a record', context(anchor, digest));
  assert.deepEqual({ ...describe(null, 'sha256:seen')({ context: true }).anchor }, { documentRevision: 'sha256:seen' },
    'Raw mode still sends the digest the viewer saw.');
  assert.equal(describe(null, null)({ context: true }).anchor, undefined);
  assert.deepEqual({ ...describe({ prefix: 'p', documentRevision: 'sha256:x' }, 'sha256:seen')({ context: true }).anchor },
    { prefix: 'p', documentRevision: 'sha256:x' }, 'Context taken at selection time keeps its own digest.');
  assert.equal(describe(null, 'sha256:seen')().anchor, undefined, 'No context is read unless it will be saved.');
}

// The review panel: where a review is, and whether it is made on another version.
{
  const element = () => {
    const node = {
      children: [], dataset: {}, style: {}, textContent: '', className: '',
      classList: { added: [], add(name) { this.added.push(name); }, toggle() {}, contains: () => false },
      append(...items) { node.children.push(...items); },
      addEventListener() {}, setAttribute() {},
    };
    return node;
  };
  const texts = (node) => [node.textContent, ...node.children.flatMap((child) => (typeof child === 'string' ? [child] : texts(child)))];
  const render = (review, locationStatus) => {
    const list = element();
    const state = {
      file: { path: 'a.md', kind: 'markdown' }, markdownDigest: 'sha256:new', reviews: [review],
      reviewLocations: new Map([['a.md\u0000r1', locationStatus]]), reviewConflicts: new Map(),
      reviewActionFilter: 'all', reviewStatusFilter: 'all',
    };
    appFunction('renderReviewList', 'function selectReview', {
      state, ui: { reviewList: list, reviewCount: element() },
      document: { activeElement: null, createElement: element, createTextNode: (text) => text },
      draftsForPath: () => new Map(), pendingComments: new Map(), commentDraftKey: () => 'k',
      reviewStateKey: (path, id) => `${path}\u0000${id}`, reviewTint: () => 1, makeReviewBadge: element,
      formatSelection: () => 'a.md:1', reviewAction, reviewStatus, madeOnOlderVersion, ACTION_LABELS, reviewRequests, requestsLabel,
      scheduleCommentSave() {}, flushCommentSave() {}, discardReviewDraft() {}, saveDraftAfterConflict() {},
      patchReview() {}, deleteReview() {}, selectReview() {}, jumpToReview() {}, reattachReview() {}, setStatus() {},
      reviewRowById: () => null, HTMLTextAreaElement: class {},
    })();
    const row = list.children[0];
    const found = texts(row);
    return {
      older: found.includes('Made on an earlier version of this file'),
      lines: found.some((text) => text.startsWith('Placed by its line range')),
      unlocated: found.includes('Unlocated · not highlighted · Reattach to pin it'),
      reattach: found.includes('Reattach'),
      dimmed: row.classList.added.includes('unlocated'),
    };
  };
  const old = { id: 'r1', status: 'open', quote: 'q', anchor: { documentRevision: 'sha256:old' } };
  assert.deepEqual(render(old, 'located'),
    { older: false, lines: false, unlocated: false, reattach: true, dimmed: false },
    'A review located on the text shown needs no flag, whichever version it was made on.');
  assert.deepEqual(render(old, 'unlocated'),
    { older: true, lines: false, unlocated: true, reattach: true, dimmed: true },
    'A review that is lost and was made on another version says so and offers Reattach.');
  assert.deepEqual(render({ id: 'r1', status: 'open', quote: 'q' }, 'lines'),
    { older: false, lines: true, unlocated: false, reattach: true, dimmed: false },
    'A review placed by its lines offers Reattach, so an old sidecar can be upgraded.');
  assert.equal(render({ id: 'r1', status: 'applied', quote: 'q' }, 'lines').reattach, false,
    'Only an open review is reattached.');
}

// What the Markdown paint does with each kind of review.
{
  const calls = [];
  let reads = 0;
  const state = { file: { path: 'a.md' }, mdFind: null, reviewLocations: new Map(), reviews: [] };
  const context = {
    state, ui: { markdown: { querySelectorAll: () => [] } },
    unwrapMarks() {}, unwrapReviewMarks() {}, renderReviewList() {}, buildMarkdownFind() {},
    collectTextParts: () => { reads += 1; return { joined: 'a repeat b repeat c', parts: [] }; },
    resolveMarkdownReview, reviewAction, reviewStatus,
    reviewStateKey: (path, id) => `${path}\u0000${id}`,
    wrapSpanParts: (root, parts, span) => { calls.push(['span', span.start]); return { parentElement: null }; },
    markdownReviewMark: () => ({}),
    markdownBadgeHost: () => null,
    paintMarkdownByLines: (review) => { calls.push(['lines', review.id]); return null; },
    placeMarkdownBadge() {},
    contextAt, atRange: (line) => ({ line }), lineNear: () => 1,
    window: { setTimeout() {}, clearTimeout() {} },
  };
  const paint = appFunction('paintMarkdownMarks', 'function paintReviewMarks', context);
  const at = { line: 1 };
  state.reviews = [
    { id: 'r1', quote: 'repeat', at, anchor: { prefix: 'b', suffix: 'c' } },
    { id: 'r2', quote: 'repeat', at },
    { id: 'r3', quote: 'repeat', at, anchor: { prefix: 'zzz' } },
    { id: 'r4', quote: 'missing', at, action: 'delete', status: 'applied', anchor: { prefix: 'a' } },
    { id: 'r5', quote: 'repeat', at: {}, anchor: { prefix: 'b' } },
    { id: 'r6', quote: 'repeat', at, anchor: { prefix: 'a', suffix: 'b' } },
    { id: 'r7', quote: 'gone', at },
  ];
  paint();
  assert.deepEqual(calls.map((call) => call.join(':')), ['span:11', 'span:2', 'lines:r2', 'lines:r7'],
    'Located reviews are wrapped from the last offset to the first, then the context-free ones by their lines.');
  assert.equal(reads, 1, 'The article text is read once for all reviews that do not overlap.');
  const status = (id) => state.reviewLocations.get(`a.md\u0000${id}`);
  assert.deepEqual([status('r1'), status('r2'), status('r3'), status('r4'), status('r5'), status('r6'), status('r7')],
    ['located', 'lines', 'ambiguous', 'preserved', undefined, 'located', 'lines'],
    'A context-free repeat or miss is placed by its lines, which the panel offers to Reattach.');
  calls.length = 0;
  reads = 0;
  state.reviews = [
    { id: 'o1', quote: 'repeat', at, anchor: { prefix: 'b', suffix: 'c' } },
    { id: 'o2', quote: 'repeat', at, anchor: { prefix: 'b', suffix: 'c' } },
  ];
  paint();
  assert.deepEqual([calls.length, reads], [2, 2], 'Reviews on the same text are wrapped from a fresh read.');
}

// A reload replaces the article's DOM. Identical reviews must not leave it unmarked.
{
  const reviews = [{ id: 'r1', kind: 'markdown', at: { line: 1 }, quote: 'new', action: 'improve', status: 'open', color: 1 }];
  let painted = false;
  const article = { set innerHTML(value) { painted = false; } };
  const state = {
    generation: 1, file: { path: 'notes.md', kind: 'markdown' }, reviews: [],
    reviewDocumentPath: null, reviewRevision: 0, markdownBlocks: null,
  };
  const reviewPaintSignature = appFunction('reviewPaintSignature', 'function reviewRowById', {});
  const context = {
    state, ui: { markdown: article, markdownRaw: {}, markdownStage: { scrollHeight: 1000 } },
    releaseDocument: async () => {},
    invoke: async () => ({ html: '<p>new</p>', raw: 'new', digest: 'sha256:aa' }),
    embedMarkdownImages() {}, colourCode() {}, setRaw() {}, setMarkdownScale() {}, paginateMarkdown() {},
    markdownBlocks: () => [], changedIndices() {}, highlightChangedBlocks() {},
    MARKDOWN_WINDOW_WIDTH: 780,
    reviewPaintSignature, reviewIdNum: () => 1, renderReviewList() {},
    paintMarkdownMarks() { painted = true; },
    loadReviews() {},
  };
  context.paintReviewMarks = appFunction('paintReviewMarks', 'function reviewFromEvent', context);
  const show = appFunction('showMarkdown', '/// `_review.json`', { markFigures() {}, ...context });
  const apply = appFunction('applyReviewStore', 'async function loadReviews(', context);
  for (const round of ['first open', 'reload with identical reviews']) {
    await show(state.file, { top: 0, left: 0, scale: 1 }, 1, false);
    apply({ revision: 1, nextId: 2, reviews: structuredClone(reviews) });
    assert.equal(painted, true, `Marks must be painted after ${round}.`);
  }
  assert.equal(state.markdownDigest, 'sha256:aa', 'The digest of the file as read is kept for new reviews.');
}

// A review made on another version of the file is flagged while it is open.
{
  const review = (status, revision) => ({ status, anchor: revision ? { documentRevision: revision } : {} });
  assert.equal(madeOnOlderVersion(review('open', 'sha256:old'), 'sha256:new'), true);
  assert.equal(madeOnOlderVersion(review('open', 'sha256:new'), 'sha256:new'), false);
  assert.equal(madeOnOlderVersion(review('open'), 'sha256:new'), false, 'A review saved without a digest is not flagged.');
  assert.equal(madeOnOlderVersion(review('applied', 'sha256:old'), 'sha256:new'), false, 'Only open reviews need a second look.');
  assert.equal(madeOnOlderVersion({ status: 'open' }, 'sha256:new'), false);
  assert.equal(madeOnOlderVersion(review('open', 'sha256:old'), null), false, 'No digest for the shown file, no flag.');
  assert.equal(madeOnOlderVersion(review('open', 'sha256:old'), 'sha256:new', 'located'), false,
    'A review located on the shown text is not flagged.');
  assert.equal(madeOnOlderVersion(review('open', 'sha256:old'), 'sha256:new', 'ambiguous'), true);
}

{
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => {
    if (signal === 'SIGTERM') {
      queueMicrotask(() => {
        child.stdout.emit('data', '\nsmoke: fail watchdog expired\n');
        child.emit('close', 1);
      });
    }
    return true;
  };
  const open = appFunction('open', 'const binary = findBinary();', {
    spawn: () => child, process: { env: {} }, basename: (name) => name.split('/').pop(),
    readFileSync: () => Uint8Array.of(37), openSync: () => 1,
    closeSync() {}, writeSync() {}, writeFileSync() {}, renameSync() {}, unlinkSync() {},
    setTimeout: () => 1, clearTimeout() {},
  }, smokeHarness);
  const running = open('viewer', 'fixture.pdf', 90);
  child.stdout.emit('data', 'smoke: ready fixture rendered\n');
  const result = await running;
  assert.notEqual(result.code, 0, 'An explicit viewer failure after readiness must fail the smoke gate.');
}

{
  let released = false;
  let shown = false;
  const image = {
    set src(value) {
      assert.ok(released, 'Switching to an image must release the previous PDF first.');
      shown = true;
    },
    set alt(value) {},
    decode: async () => {},
  };
  const show = appFunction('showImage', 'async function openFile(', {
    state: { generation: 1 },
    ui: { image },
    releaseDocument: async () => { released = true; },
    sourceUrl: () => 'doc://image',
    setImageRotation() {},
    setImageScale() {},
    openingImageScale: () => 1,
    shrinkImageToWindow: async () => {},
    restoreImageView() {},
    trimWindowToContent() {},
    scheduleWrap() {},
  });
  await show({ name: 'swatch.png' }, false, null, 1);
  assert.ok(shown);
}

{
  // A 400 dpi figure is far larger than the screen. It opens whole, not at 100%.
  let scaled = null;
  const show = appFunction('showImage', 'async function openFile(', {
    state: { generation: 1 },
    ui: { image: { set src(value) {}, set alt(value) {}, decode: async () => {} } },
    releaseDocument: async () => {},
    sourceUrl: () => 'doc://figure',
    setImageRotation() {},
    setImageScale(value) { scaled = value; },
    openingImageScale: () => 0.25,
    shrinkImageToWindow: async () => {},
    restoreImageView() {},
    trimWindowToContent() {},
    scheduleWrap() {},
  });
  await show({ name: 'figure.png' }, true, null, 1);
  assert.equal(scaled, 0.25, 'A new figure opens at the scale that fits the screen.');
  await show({ name: 'figure.png' }, false, null, 1);
  assert.equal(scaled, 'page-fit', 'A figure stepped to in a kept window fills that window.');
}

{
  let scaled = null;
  const show = appFunction('showImage', 'async function openFile(', {
    state: { generation: 1, docked: 'left' },
    ui: { image: { set src(value) {}, set alt(value) {}, decode: async () => {} } },
    releaseDocument: async () => {},
    sourceUrl: () => 'doc://figure',
    setImageRotation() {},
    setImageScale(value) { scaled = value; },
    openingImageScale: () => 0.25,
    shrinkImageToWindow: async () => {},
    restoreImageView() {},
    trimWindowToContent() {},
    scheduleWrap() {},
  });
  await show({ name: 'figure.png' }, true, null, 1);
  assert.equal(scaled, 'page-fit', 'A figure opened in a docked window fills the dock.');
}

{
  // Delete moves the file on screen to the trash, then shows its neighbour.
  const run = async ({ path = 'b.png', siblings = ['a.png', 'b.png', 'c.png'], platform = 'windows',
    confirm = true, fails = false, plan = 'trash' } = {}) => {
    const calls = [];
    let question = '';
    await appFunction('trashShownFile', 'function ', {
      state: { file: { path, name: path, kind: siblings.length ? 'image' : 'pdf' }, siblings: [], platform,
        active: 0 },
      window: { confirm: (text) => { question = text; return confirm; } },
      invoke: async (command, args) => {
        if (command === 'siblings') return siblings;
        if (command === 'trash_plan') return plan;
        calls.push([command, args.path, args.permanent]);
        if (fails) throw new Error('access denied');
      },
      showInActiveTab: async (next) => { calls.push(['show', next]); },
      closeTab: async (index) => { calls.push(['close', index]); },
      setStatus: (text) => { calls.push(['status', text]); },
    })();
    return { calls, question };
  };
  assert.deepEqual((await run({ confirm: false })).calls, [], 'Nothing is deleted without confirmation.');
  const middle = await run();
  assert.equal(middle.question, 'Move b.png to the Recycle Bin?');
  assert.deepEqual(middle.calls.slice(0, 2), [['trash_document', 'b.png', false], ['show', 'c.png']],
    'The next figure follows a deleted one.');
  assert.deepEqual(middle.calls[2], ['status', 'Moved b.png to the Recycle Bin']);
  const wsl = await run({ plan: 'permanent' });
  assert.equal(wsl.question, 'b.png is in a folder without a Recycle Bin. Delete it permanently?',
    'A folder with no Recycle Bin says the file will be deleted for good.');
  assert.deepEqual(wsl.calls[0], ['trash_document', 'b.png', true]);
  assert.deepEqual(wsl.calls[2], ['status', 'Deleted b.png']);
  assert.deepEqual((await run({ plan: 'permanent', confirm: false })).calls, [],
    'A refused permanent delete leaves the file alone.');
  assert.deepEqual((await run({ path: 'c.png' })).calls[1], ['show', 'b.png'],
    'The last figure is followed by the one before it.');
  assert.deepEqual((await run({ path: 'paper.pdf', siblings: [] })).calls[1], ['close', 0],
    'A file with no neighbours closes its tab.');
  const failed = await run({ fails: true });
  assert.equal(failed.calls.length, 2, 'A failed move shows an error and stays on the file.');
  assert.match(failed.calls[1][1], /^Could not delete b\.png: /);
  assert.equal((await run({ platform: 'macos' })).question, 'Move b.png to the Trash?');
  assert.equal((await run({ platform: 'linux' })).question, 'Move b.png to the trash?');
}

{
  const layout = (natural, scale) => {
    const image = { naturalWidth: natural[0], naturalHeight: natural[1], style: {} };
    appFunction('layoutImage', 'function setImageRotation(', {
      state: { imageRotation: 0, imageScale: 'page-fit' },
      ui: { image, imageBox: { style: { setProperty() {} } } },
      document: { body: { classList: { toggle() {} } } },
      pageFitScale: () => scale,
    })();
    return image.style.width;
  };
  assert.equal(layout([640, 480], 2.5), '1600px', 'Page fit enlarges a small figure to fill the window.');
  assert.equal(layout([3200, 2400], 0.3), '960px', 'Page fit shrinks a large figure into the window.');
  const fitScale = (contain) => appFunction('pageFitScale', '/// The scale at which the whole image fits', {
    imageContainScale: () => contain,
  })();
  assert.equal(fitScale(1.23456), 1.234, 'Page fit rounds down, so no scrollbar appears.');
  assert.equal(fitScale(0), 0.01, 'Page fit never reaches zero.');
  let chosen = null;
  appFunction('applyZoomChoice', 'function ', {
    state: { file: { kind: 'image' } },
    zoomImageTo(value) { chosen = value; },
  })('page-fit');
  assert.equal(chosen, 'page-fit', 'Fit page in the zoom box keeps fitting when the window changes.');
}

{
  const context = (natural) => ({
    state: { reviewOpen: false },
    window: { outerWidth: 1000, innerWidth: 1000, outerHeight: 800, innerHeight: 800,
      screen: { availWidth: 1920, availHeight: 1040 } },
    REVIEW_PANE_WIDTH: 280,
    turnedNatural: () => natural,
    chromeHeight: () => 36,
  });
  const scale = (natural) =>
    appFunction('openingImageScale', '/// The \'page-fit\' scale', context(natural))();
  assert.equal(scale([3200, 2400]), 0.401,
    'A screen-sized limit leaves room for the frame and the toolbar.');
  assert.equal(scale([640, 480]), 1, 'A small picture still opens at 100%.');
  assert.equal(scale([0, 0]), 1, 'An undecoded picture keeps 100%.');
}

{
  // The window frame was larger than estimated, so the screen clamped the window.
  const run = async (box, stage) => {
    const calls = [];
    const context = {
      state: { generation: 1, imageScale: 0.3 },
      ui: { imageBox: { offsetWidth: box[0], offsetHeight: box[1] },
        imageStage: { clientWidth: stage[0], clientHeight: stage[1] } },
      stageSettled: async () => {},
      stagePadding: () => [0, 0],
      imageContainScale: () => 0.2834,
      setImageScale(value) { calls.push(['scale', value]); },
      trimWindowToContent: async () => { calls.push(['trim']); },
    };
    await appFunction('shrinkImageToWindow', 'async function stageSettled(', context)(1);
    return calls;
  };
  assert.deepEqual(await run([900, 660], [900, 620]), [['scale', 0.283]],
    'A picture taller than its clamped window shrinks into it, and the window keeps its size.');
  assert.deepEqual(await run([900, 620], [900, 620]), [],
    'A picture that fits its window keeps its scale.');
}

{
  const note = { file: 'a.pdf', quote: 'selected text' };
  const state = { file: { path: 'a.pdf' }, generation: 1, pendingNote: note };
  const ui = {
    noteBox: { hidden: false }, noteText: { value: 'unsaved comment' }, editBox: { hidden: false },
    image: { removeAttribute() {} }, markdown: {}, markdownRaw: {},
  };
  const open = appFunction('openFile', 'async function openPath(', {
    state, ui, printPending: false,
    flushCommentSave: async () => {}, captureView: () => null,
    clearPrintPages() {}, setTitle() {}, setStatus() {},
    document: { body: { classList: { add() {}, toggle() {}, remove() {} } } },
    showPdf: async () => {}, loadReviews: async () => {}, syncPageViewMenu() {},
    nav: { refresh() {} },
  });
  await open({ path: 'a.pdf', name: 'a.pdf', kind: 'pdf' }, { preserveView: true });
  assert.equal(state.pendingNote, note, 'Reloading the same document must preserve the selected quote.');
  assert.equal(ui.noteText.value, 'unsaved comment');
  assert.equal(ui.noteBox.hidden, false);
  await open({ path: 'b.pdf', name: 'b.pdf', kind: 'pdf' });
  assert.equal(state.pendingNote, null, 'Changing documents must clear the old selection.');
  assert.equal(ui.noteText.value, '');
  assert.equal(ui.noteBox.hidden, true);
}

for (const pauseAt of ['save', 'close']) {
  const state = { file: { path: 'a.pdf' }, generation: 1 };
  let finish;
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const pause = () => new Promise((resolve) => { finish = resolve; started(); });
  const close = appFunction('closeAll', 'function cycleTab(', {
    state,
    rememberPlace() {},
    panes: { active: false },
    noteSaveInFlight: false,
    flushCommentSave: pauseAt === 'save' ? pause : async () => {},
    invoke: pauseAt === 'close' ? pause : async () => {
      assert.fail('A superseded close must not clear the new watch target.');
    },
  });
  const closing = close();
  await waiting;
  const nextFile = { path: 'b.pdf' };
  state.file = nextFile;
  state.generation += 1;
  finish();
  await closing;
  assert.equal(state.file, nextFile, 'A superseded close must preserve the newly opened document.');
}

{
  const state = { file: { path: 'a.pdf', kind: 'pdf' }, generation: 1, reviews: [] };
  let finish;
  let applied = false;
  const load = appFunction('loadReviews', '/// Disk first.', {
    state,
    pendingComment: null,
    commentSaveTimer: 0,
    window: { clearTimeout() {} },
    invoke: () => new Promise((resolve) => { finish = resolve; }),
    applyReviewStore() { applied = true; },
    setStatus() {},
  });
  const loading = load();
  state.file = { path: 'b.pdf', kind: 'pdf' };
  state.generation += 1;
  finish({ reviews: [{ id: 'r1', file: 'a.pdf' }] });
  await loading;
  assert.equal(applied, false, 'A late review response must not replace another file’s reviews.');
}

{
  // Remove asks nothing; it offers Undo, which puts the record and its
  // unsaved draft back. A failed removal keeps the draft and offers no Undo.
  const record = { id: 'r1', file: 'a.pdf', comment: 'saved' };
  const draft = { id: 'r1', path: 'a.pdf', comment: 'unsaved edit' };
  const pendingComments = new Map([['a.pdf\u0000r1', draft]]);
  const undo = [];
  const statuses = [];
  const calls = [];
  const context = {
    state: { file: { path: 'a.pdf' }, generation: 1, reviews: [record], selectedReviewId: 'r1' },
    pendingComments,
    commentDraftKey: (path, id) => `${path}\u0000${id}`,
    window: { confirm: () => assert.fail('Removal must not ask a question.'), clearTimeout() {} },
    invoke: async (name, args) => { calls.push([name, args]); return { reviews: [] }; },
    applyReviewStore() {},
    pushUndo: (entry) => undo.push(entry),
    undoLast: async () => true,
    restoreRemovedReview: async (...args) => { calls.push(['restore', ...args]); },
    setStatus: (message, options) => statuses.push([message, options]),
  };
  const remove = appFunction('deleteReview', 'async function jumpToReview(', context);
  await remove('r1');
  assert.equal(JSON.stringify(calls[0]),
    JSON.stringify(['delete_review', { document: 'a.pdf', id: 'r1', expectedRecord: record }]));
  assert.equal(pendingComments.size, 0);
  assert.equal(context.state.selectedReviewId, null);
  assert.equal(undo.length, 1, 'A removal can be undone.');
  assert.equal(undo[0].path, 'a.pdf');
  assert.equal(statuses[0][1].action.label, 'Undo', 'The toast offers Undo.');
  await undo[0].run();
  assert.equal(calls[1][1], 'a.pdf');
  assert.equal(calls[1][2], record, 'Undo restores the exact record.');
  assert.equal(calls[1][3], draft, 'Undo restores the unsaved draft.');

  pendingComments.set('a.pdf\u0000r1', draft);
  context.state.reviews = [record];
  context.invoke = async () => { throw new Error('permission denied'); };
  await remove('r1');
  assert.equal(pendingComments.size, 1, 'Failed removal preserves the pending edit.');
  assert.equal(undo.length, 1, 'A failed removal offers no Undo.');
}

{
  const key = 'a.pdf\u0000r1';
  const pendingComments = new Map([[key, { id: 'r1', path: 'a.pdf', comment: 'first', expectedComment: '' }]]);
  const saved = [];
  let releaseFirst;
  const context = {
    state: { file: { path: 'a.pdf' }, reviews: [{ id: 'r1' }], reviewConflicts: new Map() },
    pendingComments,
    commentSaveTimer: 0,
    commentFlushPromise: null,
    window: { clearTimeout() {} },
    commentDraftKey: (path, id) => `${path}\u0000${id}`,
    reviewStateKey: (path, id) => `${path}\u0000${id}`,
    renderReviewList() {},
    updateReviewComment: async (pending) => {
      saved.push(pending.comment);
      if (saved.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
      if (pendingComments.get(key) === pending) pendingComments.delete(key);
    },
  };
  const flush = appFunction('flushCommentSave', 'async function updateReviewComment(', context);
  const first = flush();
  pendingComments.set(key, { id: 'r1', path: 'a.pdf', comment: 'second', expectedComment: 'first' });
  const second = flush();
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(saved, ['first', 'second'], 'A flush requested during a save also saves the newer draft.');
  assert.equal(pendingComments.size, 0);
}

{
  const original = [{ id: 'b1', file: 'b.pdf' }];
  const state = { file: { path: 'a.pdf' }, generation: 1, reviews: [], reviewConflicts: new Set() };
  const pending = { id: 'r1', path: 'a.pdf', comment: 'edited', expectedComment: 'old' };
  const pendingComments = new Map([['a.pdf\u0000r1', pending]]);
  let finish;
  const update = appFunction('updateReviewComment', 'async function deleteReview(', {
    state,
    pendingComments,
    commentDraftKey: (path, id) => `${path}\u0000${id}`,
    invoke: () => new Promise((resolve) => { finish = resolve; }),
    setStatus() {},
    selectReview() {},
    applyReviewStore() {},
    renderReviewList() {},
    reviewRowById() { return null; },
  });
  const updating = update(pending, { quiet: true });
  state.file = { path: 'b.pdf' };
  state.generation += 1;
  state.reviews = original;
  finish({ reviews: [{ id: 'r1', file: 'a.pdf' }] });
  await updating;
  assert.equal(state.reviews, original, 'A late comment save must not change another file’s panel.');
}

{
  let stateDigest;
  const state = {
    file: { path: 'a.pdf' }, generation: 1,
    pendingNote: { file: 'a.pdf', kind: 'pdf', at: { page: 1 }, quote: 'text', anchor: { position: { page: 1, x: 20, y: 30 } } },
    pendingNotePdf: { path: 'a.pdf', document: {}, digestPromise: new Promise((resolve) => { stateDigest = resolve; }) },
  };
  let finish;
  let applied = false;
  let appended;
  let statusMessage = '';
  const save = appFunction('saveNote', 'async function optionalSourceHint(', { REVIEW_ACTIONS, reviewRequests,
    state,
    noteSaveInFlight: false,
    structuredClone: (value) => JSON.parse(JSON.stringify(value)),
    REVIEW_TINTS: 16,
    ui: { noteText: { value: 'comment' }, noteAction: { value: 'improve' }, noteSave: {}, noteBox: {}, noteQuote: {}, noteRef: {} },
    pdfDocumentDigest: async () => 'sha256:wrong-current-document',
    optionalSourceHint: async () => null,
    invoke: (_command, args) => {
      if (_command === 'append_review') { appended = args.review; return new Promise((resolve) => { finish = resolve; }); }
      return null;
    },
    applyReviewStore() { applied = true; },
    setReviewOpen() {},
    selectReview() {},
    setStatus(message) { statusMessage = message; },
  });
  state.generation += 1;
  state.file.revision = 2;
  const saving = save();
  state.generation += 1;
  stateDigest('sha256:captured-original-document');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(appended?.anchor?.documentRevision, 'sha256:captured-original-document', `A same-path rebuild keeps the digest captured with the selection. ${statusMessage}`);
  state.file.path = 'b.pdf';
  state.generation += 1;
  finish({ reviews: [{ id: 'r1', file: 'a.pdf' }] });
  await saving;
  assert.equal(applied, false, 'A late new-review save must not change another file’s panel.');
}

{
  const state = {
    file: { kind: 'pdf', revision: 1 }, reviewLocations: new Map(), generation: 1,
    reviews: [{ id: 'r1', at: { page: 1, end: 4_294_967_295 }, quote: 'quote' }],
  };
  let visited = 0;
  const paint = appFunction('paintPdfMarks', 'function paintReviewMarks(', {
    state,
    pdfPaintSerial: 0,
    reviewStateKey: (path, id) => `${path}\u0000${id}`,
    pdfDocumentDigest: async () => 'sha256:test',
    reviewAction,
    reviewStatus,
    resolveReviewAnchor,
    renderReviewList() {},
    pdfViewer: { pagesCount: 3 },
    pdfReviewTextPages: async () => [
      { page: 1, text: 'quote' }, { page: 2, text: 'other' }, { page: 3, text: 'else' },
    ],
    ui: { viewer: {
      querySelectorAll: () => [],
      querySelector: () => {
        visited += 1;
        assert.ok(visited <= 3, 'An imported review must not scan beyond the PDF page count.');
        return null;
      },
    } },
  });
  await paint();
  assert.equal(visited, 1, 'The stored end page cannot expand work beyond its unique text match.');
}

{
  const state = { file: { kind: 'pdf' }, document: {}, generation: 1 };
  let printed = false;
  const print = appFunction('printDocument', '// Two ways to hear', {
    state, printing: false, printPending: false, printBlurred: false,
    clearPrintPages() {},
    renderPrintPages: async () => { state.generation += 1; return true; },
    invoke: async () => { printed = true; },
    setStatus() {},
  });
  await print();
  assert.equal(printed, false, 'A superseded print must not open the dialog.');
}

for (const release of ['0.9.0', '0.9.1']) {
  const manifest = await readFile(
    `winget/RicardoFrantz.pdf-next/${release}/RicardoFrantz.pdf-next.installer.yaml`,
    'utf8',
  );
  assert.doesNotMatch(manifest, /^\s*DisplayVersion:/m, 'WinGet must omit redundant DisplayVersion.');
}

{
  const { watchPdfRendering } = await import('../src/pdf-rendering.mjs');
  const previousWindow = globalThis.window;
  const queries = [];
  const events = new Map();
  const updates = [];
  const viewer = {
    pdfDocument: {},
    _pages: [{
      canvas: { width: 800 },
      reset() { this.canvas = null; updates.push('reset'); },
      update() { assert.equal(this.canvas, null); updates.push('scale'); },
    }],
    update() { updates.push('render'); },
  };
  globalThis.window = {
    devicePixelRatio: 1,
    matchMedia(query) {
      const media = { query, handler: null,
        addEventListener(event, fn) { this.handler = fn; },
        removeEventListener() { this.handler = null; },
      };
      queries.push(media);
      return media;
    },
    addEventListener(name, handler) { events.set(name, handler); },
  };
  try {
    watchPdfRendering(viewer);
    globalThis.window.devicePixelRatio = 2;
    queries[0].handler();
    assert.deepEqual(updates, ['reset', 'scale', 'render']);
    assert.match(queries[1].query, /2dppx/);
    events.get('resize')();
    assert.equal(updates.length, 3, 'Resizing at unchanged density must not discard canvases.');
    globalThis.window.devicePixelRatio = 1.5;
    events.get('resize')();
    assert.match(queries.at(-1).query, /1.5dppx/);
    assert.deepEqual(updates.slice(-3), ['reset', 'scale', 'render']);
  } finally {
    globalThis.window = previousWindow;
  }
}

// PDF.js must parse in a real worker thread.
{
  let onRendered;
  const statuses = [];
  const start = app.indexOf("eventBus.on('pagerendered', ({ error }) => {");
  assert.ok(start >= 0, 'PDF render failures must be shown to the reader.');
  runInNewContext(app.slice(start, app.indexOf('\n});', start) + 4), {
    eventBus: { on: (name, callback) => { onRendered = callback; } },
    setStatus: (message, options) => { statuses.push({ message, options }); },
  });
  onRendered({ error: null });
  assert.equal(statuses.length, 0);
  onRendered({ error: { message: 'PDF decoded stream byte limit exceeded' } });
  assert.equal(statuses[0].message, 'Could not render PDF: PDF decoded stream byte limit exceeded');
  assert.equal(statuses[0].options.error, true);
  assert.equal(statuses[0].options.sticky, true);
}
assert.match(
  app,
  /GlobalWorkerOptions\.workerSrc = '\.\/vendor\/pdfjs\/build\/pdf\.worker\.min\.mjs'/,
  'PDF.js must point at the vendored worker bundle.',
);
assert.doesNotMatch(
  app,
  /globalThis\.pdfjsWorker\s*=/,
  'Assigning globalThis.pdfjsWorker makes PDF.js parse on the UI thread.',
);

// Memory. These are the ones that compound: the app reloads the document on
// every rebuild, potentially hundreds of times per session.
assert.match(
  app,
  /const MAX_CANVAS_PIXELS = [\d_]+;[\s\S]*?maxCanvasPixels: MAX_CANVAS_PIXELS/,
  'The canvas budget must be capped; it dominates resident memory.',
);
assert.match(app, /enableOptimizedPartialRendering: true/,
  'High-density detail rendering must skip drawing operations outside the visible crop.');
assert.match(
  app,
  /const pdfWorker = new PDFWorker\(\);[\s\S]*?worker: pdfWorker,/,
  'One shared worker: getDocument would otherwise spawn a thread per reload.',
);
assert.match(
  app,
  /async function releaseDocument\(\)[\s\S]*?await task\.destroy\(\)/,
  'The previous document must be destroyed, not just dereferenced (~77 MB/reload).',
);
assert.match(
  app,
  /class TidyViewer extends PDFViewer \{[\s\S]*?pageView\.destroy\(\)/,
  'Page views must free their canvases on reset; PDF.js only drops the references.',
);
assert.match(
  app,
  /document\.visibilityState === 'hidden'[\s\S]*?state\.pendingRevision = revision/,
  'Reloads must be deferred while the window is hidden.',
);
assert.match(
  await readFile('src/vendor/pdfjs/web/pdf_viewer.mjs', 'utf8'),
  /const DEFAULT_CACHE_SIZE = 3;/,
  'Vendored PDF.js keeps 10 rendered pages by default; pdf-next pins it to 3.',
);

// Page colors carry over from vscode-pdf Next, where they were tuned.
assert.match(
  app,
  /night: \{ background: '#1b1b1b', foreground: '#d6d1c4' \}/,
  'Night mode page colors must stay as tuned.',
);
assert.match(
  app,
  /sepia: \{ background: '#f4ecd8', foreground: '#5b4636' \}/,
  'Sepia mode page colors must stay as tuned.',
);
assert.match(
  app,
  /const MODE_CYCLE = \[null, 'night', 'invert', 'sepia'\];/,
  'Plain pages are a stop on the cycle, so white is always one press away.',
);
// Page colors live in the canvas pixels, so a color change is only visible
// once the canvas is drawn again. refresh() is not that: it goes through
// PDFPageView.update(), which resets with keepCanvasWrapper and never calls
// _resetCanvas(), leaving the old bitmap. That showed up as a white page with
// brown text on the way out of sepia.
assert.match(
  app,
  /function applyPageColors\(\)[\s\S]*?pageView\.reset\(\);[\s\S]*?pdfViewer\.update\(\)/,
  'A page-color change must drop each page canvas, or the previous colors stay.',
);

// Inverting the whole page also inverts the text layer and its highlights.
assert.match(
  styles,
  /body\.mode-invert \.pdfViewer \.page \.canvasWrapper \{[^}]*filter: invert\(1\)/s,
  'Invert must be scoped to the canvas so find highlights keep their color.',
);

// The watcher: one second, and a missing file is a state, not a failure.
assert.match(
  main,
  /static POLL_SECONDS: AtomicU64 = AtomicU64::new\(1\)/,
  'Watching must be on by default, at one second.',
);
assert.match(
  main,
  /if missing \{\s*continue;[\s\S]*?state\.missing = true;[\s\S]*?kind: "missing"/,
  'A vanished file must report once and keep the last render on screen.',
);
assert.match(
  main,
  /let reappeared = missing;[\s\S]*?if changed \|\| reappeared/,
  'A file that reappears after a build must trigger a reload.',
);

// Window fitting happens on a fresh open only; refitting on every rebuild would
// make the window jump while you work.
assert.match(
  app,
  /if \(view\) \{[\s\S]*?\} else \{[\s\S]*?await trimWindowToContent\(\{ recenter: true \}\)/,
  'The window may only be trimmed when opening a file, not when reloading it.',
);
assert.match(
  app,
  /pdfViewer\.currentScaleValue = '1';[\s\S]*?await trimWindowToContent/,
  'A fresh PDF open is 100%, then the window hugs that page — not page-fit into a large window.',
);
assert.match(
  app,
  /function pageBoxReady\(\)[\s\S]*?Math\.abs\(scale - 1\)/,
  'Trim must wait for 100% layout, not a leftover page-fit box.',
);
assert.match(
  main,
  /if window\.is_maximized\(\)\.unwrap_or\(false\) \{\s*let _ = window\.unmaximize\(\);/,
  'A maximized window must come off maximize or set_size cannot trim it.',
);
assert.match(
  main,
  /fn is_complete\(path: &Path\) -> bool \{[\s\S]*?File::open\(path\)[\s\S]*?b"%%EOF"/,
  'A file must be complete before a reload; a half-written PDF must not be shown.',
);
assert.match(
  main,
  /if \(changed \|\| reappeared\) && !is_complete\(&path\)/,
  'The watcher must skip ticks where the file is still being written.',
);
assert.match(
  main,
  /fn set_poll_seconds\(seconds: u64\)[\s\S]*?POLL_SECONDS\.store/,
  'The poll cadence must be settable, including 0 for off.',
);
assert.match(
  main,
  /fn watch_review_sidecar\([\s\S]*?"reviews-changed"/,
  'A sidecar change must emit reviews-changed, not file-changed.',
);
assert.match(
  main,
  /fn document_watch_due\(poll_seconds: u64, since_last: Duration\) -> bool \{\s*poll_seconds != 0/,
  'Document poll at 0 must not be required for sidecar watching.',
);
assert.match(
  main,
  /watch_review_sidecar\([\s\S]*?if !document_watch_due/,
  'The sidecar must be stated before the document-poll gate.',
);
assert.match(
  main,
  /fn sidecar_ready\(path: &Path\)[\s\S]*?parse_store/,
  'A half-written sidecar must wait for the next tick.',
);
assert.match(
  main,
  /fn note_sidecar_written\([\s\S]*?state\.sidecar_modified/,
  'A save from the app must not look like an incoming sidecar edit.',
);
assert.match(
  app,
  /await showImage\(file, !view && !keepWindow, view, generation, place\)/,
  'Images must refit only on a fresh open — not on reload, not on a tab switch, and not when stepping through a folder.',
);
assert.match(
  app,
  /async function stepSibling\(delta\)[\s\S]*?openFile\(file, \{ keepWindow: true \}\)/,
  'Walking a folder must not resize the window on every arrow press.',
);
assert.match(
  app,
  /async function dockTo\(edge\)[\s\S]*?if \(!undocking\) \{\s*pdfViewer\.currentScaleValue = 'page-width'/,
  'Docking to any edge must fit the width; undocking trims to the page at 100%.',
);
assert.match(
  app,
  /async function dockTo\(edge\)[\s\S]*?await trimWindowToContent\(\{ recenter: true \}\)/,
  'Undocking must trim the window to the document.',
);
assert.match(
  main,
  /fn fit_window\([\s\S]*?width\.is_finite\(\) && height\.is_finite\(\) && width > 80\.0 && height > 80\.0/,
  'A bogus measurement must never be turned into a window size.',
);

// Wrapping the window around the content. The failure mode here is not a wrong
// size, it is an infinite one: the window resizes, a preset scale recomputes,
// the scale change refits the window, forever.
assert.match(
  app,
  /function pinScale\(\)[\s\S]*?const scale = pdfViewer\.currentScale;\s*pdfViewer\.currentScaleValue = String\(scale\)/,
  'Turning wrap on must pin the scale to a number; a preset would resize forever.',
);
assert.match(
  app,
  /if \(state\.wrap && \(value === 'auto' \|\| value === 'page-fit' \|\| value === 'page-width'\)\) \{\s*setWrap\(false\)/,
  'Choosing a fit preset must turn wrap off — the two are opposite instructions.',
);
assert.match(
  app,
  /async function dockTo\(edge\)[\s\S]*?if \(state\.wrap\) \{[\s\S]*?setWrap\(false\)/,
  'Docking sets an explicit size; wrap must let go of the window first.',
);
assert.match(
  app,
  /function chromeHeight\(\)\s*\{\s*const measured = window\.innerHeight - ui\.stage\.clientHeight/,
  'Chrome height must be measured: the tab strip changes it, --bar-height does not.',
);
assert.match(
  app,
  /function contentSize\(\)[\s\S]*?Math\.ceil\(ui\.imageBox\.offsetWidth\)/,
  'The fit must measure the rendered element, ceiled — a fractional size raises a scrollbar.',
);
assert.match(
  styles,
  /body\.wrap-on #imageStage(?:,\s*body\.hug #imageStage)? \{[^}]*padding: 0/s,
  'An exact fit means no padding: the window frame is the edge of the picture.',
);
assert.match(
  main,
  /fn fit_window\([\s\S]*?exact: bool,[\s\S]*?if !exact \{[\s\S]*?inner_height\.min\(inner_width \/ aspect\)/,
  'Aspect is preserved only on the open-time fit; a wrap clamps each axis alone.',
);

// Tabs hold paths. A tab that held a document would cost ~60 MB of resident
// memory each, which is the opposite of the point of this app.
assert.match(
  app,
  /tabs: \[\],\s*active: -1,\s*views: new Map\(\)/,
  'Tab state is paths and view offsets; the document lives once, in state.document.',
);
assert.doesNotMatch(
  app,
  /tabs\[[^\]]*\]\.(document|task)\b|(document|task): (state\.document|state\.task)/,
  'No tab may retain a PDF document or loading task.',
);
assert.match(
  app,
  /async function activateTab\([\s\S]*?await openFile\(file, \{\s*keepWindow: true,\s*view: state\.views\.get\(tab\.path\) \|\| null,/,
  'Switching tabs reloads through openFile, restoring the view it was left at.',
);
assert.match(
  app,
  /async function stepSibling\(delta\)[\s\S]*?tab\.path = file\.path/,
  'Walking a folder must replace what the tab shows, not open a tab per file.',
);

// Security. An untrusted PDF is the threat model: the attacker controls the
// file, and the app reloads it from disk every second.
const csp = config.app?.security?.csp ?? '';
assert.doesNotMatch(csp, /unsafe-eval/, 'CSP must not allow eval.');
assert.match(csp, /worker-src 'self' blob:/, 'CSP must allow the PDF.js worker.');
assert.match(csp, /object-src 'none'/, 'CSP must forbid plugins.');
assert.match(csp, /base-uri 'none'/, 'CSP must forbid base-tag hijacking.');

// Document bytes travel over the doc protocol, not the asset protocol. The
// no-store header is what stops the webview cache growing ~10 MB per reload,
// and the allowlist in our own handler is the whole filesystem boundary.
assert.equal(
  config.app?.security?.assetProtocol,
  undefined,
  'The asset protocol is gone; the doc protocol replaced it.',
);
const cargo = await readFile('src-tauri/Cargo.toml', 'utf8');
assert.doesNotMatch(
  cargo,
  /protocol-asset/,
  'The protocol-asset feature must stay off; the doc protocol serves the bytes.',
);
assert.match(csp, /img-src[^;]*http:\/\/doc\.localhost/, 'CSP must allow doc images.');
assert.match(csp, /connect-src[^;]*http:\/\/doc\.localhost/, 'CSP must allow doc fetches.');
assert.match(
  main,
  /register_asynchronous_uri_scheme_protocol\("doc"/,
  'The doc protocol must be registered.',
);
assert.match(
  main,
  /fn serving\([\s\S]*?state\.allowed\.contains\(canonical\)[\s\S]*?state\.embedded\.contains\(canonical\)[\s\S]*?\n\}/,
  'Only opened files and checked embedded images may be served.',
);
assert.match(
  main,
  /fn serve_document\([\s\S]*?let Some\(served\) = [\s\S]*?serving\(&state, &canonical\)[\s\S]*?\) else \{\s*return deny\(404\);\s*\};[\s\S]*?Served::Embedded => read_image\(&canonical\)[\s\S]*?document_response\(&served/,
  'A path that serving() refuses must be denied, and embedded images must be rechecked before any response.',
);
assert.match(
  main,
  /fn document_response\([\s\S]*?"Cache-Control", "no-store"[\s\S]*?"X-Content-Type-Options", "nosniff"[\s\S]*?Served::Embedded[\s\S]*?"Content-Security-Policy"/,
  'Every served document carries no-store and nosniff, and embedded images a sandbox policy.',
);
{
  const production = main.slice(0, main.indexOf('#[cfg(test)]\nmod tests'));
  const users = new Set();
  for (const use of production.matchAll(/\.embedded\b/g)) {
    const before = production.slice(0, use.index);
    users.add([...before.matchAll(/^(?:pub )?fn (\w+)/gm)].at(-1)?.[1]);
  }
  assert.deepEqual(
    [...users].sort(),
    ['read_markdown', 'serving'],
    'Only serving and read_markdown may touch the embedded image set.',
  );
}
assert.match(
  main,
  /fn adopt\([\s\S]*?state\.allowed\.insert\(canonical\.clone\(\)\)/,
  'Opening a file is what grants the webview permission to read exactly it.',
);
assert.match(
  app,
  /convertFileSrc\(file\.path, 'doc'\)/,
  'Document URLs must go through the doc protocol.',
);
assert.match(
  app,
  /visibilityState === 'hidden'[\s\S]*?state\.document\?\.cleanup\(\)/,
  'A hidden window must drop the PDF.js font and image caches.',
);

// Markdown crosses the IPC boundary as HTML, so it must be sanitized before
// it leaves Rust, and an image must be a checked local file.
assert.match(
  main,
  /fn render_markdown\([\s\S]*?builder\.attribute_filter\([\s\S]*?judge_image\([\s\S]*?builder\.clean\(/,
  'Markdown must be sanitized by ammonia, with every image source judged as a local file.',
);
assert.match(
  main,
  /fn read_markdown\([\s\S]*?state\.allowed\.contains\(&canonical\)/,
  'read_markdown must serve only files the reader has opened.',
);
assert.match(
  main,
  /fn navigation_guard\(\)[\s\S]*?"tauri" => host == Some\("localhost"\)/,
  'The webview must not be able to navigate away from the app origin.',
);
assert.match(
  app,
  /closest\('\.annotationLayer a\[href\]'\)[\s\S]*?event\.preventDefault\(\);\s*if \(\/\^https\?:\/i\.test\(href\)\) \{\s*void invoke\('open_link'/,
  'A web link in a PDF must open in the system browser, never in the window.',
);
assert.match(
  app,
  /function scheduleReviewChip\(\)[\s\S]*?if \(!state\.reviewOpen \|\| !reviewFromSelection\(\)\)/,
  'Outside review mode a selection must not raise the review chip.',
);
assert.match(
  app,
  /function onDocumentContextMenu\(event\)[\s\S]*?if \(!state\.reviewOpen && !edits\) \{\s*return;\s*\}[\s\S]*?event\.preventDefault\(\)[\s\S]*?ui\.reviewMenuCopy\.hidden = state\.reviewOpen;/,
  'Outside review mode the system context menu stays, unless a Markdown edit menu replaces it with its own Copy.',
);
assert.match(
  app,
  /if \(launch\?\.mode\)[\s\S]*?setMode\(requested, false\)/,
  'A command-line appearance flag must not overwrite the saved preference.',
);
const capabilities = JSON.parse(
  await readFile('src-tauri/capabilities/default.json', 'utf8'),
);
assert.deepEqual(
  capabilities.permissions,
  ['core:event:allow-listen', 'core:event:allow-unlisten', 'core:window:allow-is-fullscreen', 'core:window:allow-set-fullscreen'],
  'The webview needs events and full screen (F11, F5) and nothing else; every other permission is reachable by injected script.',
);

// The command line is a contract for programs, not just people: it answers
// --help, exits non-zero on mistakes, prints what it opened, hands a second
// launch to the running window, and on macOS hears files opened from Finder.
assert.match(
  main,
  /"-h" \| "--help" => return Ok\(Cli::Help\)[\s\S]*?"-V" \| "--version" => return Ok\(Cli::Version\)/,
  '--help and --version must be answered, never treated as file names.',
);
assert.match(
  main,
  /if !candidate\.is_file\(\) \{\s*return Err\(\(1, format!\("no such file: \{name\}"\)\)\);/,
  'A missing file must fail with exit status 1, not open an empty window.',
);
// Opening a document at a page or a match is what makes this usable from a
// script: the flags, the link form of the same thing, and the printed line
// that says which was understood.
assert.match(
  main,
  /"--page" => match arguments[\s\S]*?"--find" \| "--search" =>[\s\S]*?"--dest" \| "--nameddest" =>/,
  '--page, --find and --dest must all be accepted.',
);
assert.match(
  main,
  /"page" => target\.page[\s\S]*?"nameddest" \| "dest"[\s\S]*?"search" \| "find"/,
  'A path fragment must be read with the field names PDF links use.',
);
assert.match(
  main,
  /if focus \{\s*if let Some\(window\) = app\.get_webview_window\("main"\)/,
  '--no-focus must be able to hand a file over without raising the window.',
);
assert.match(
  app,
  /async function applyTarget\(target\)[\s\S]*?pdfViewer\.currentPageNumber = landed/,
  'A target must land on its page once the document is up.',
);
assert.match(
  app,
  /async function consumeTarget\(tab\) \{[\s\S]*?tab\.target = null;\s*await applyTarget\(target\);/,
  'A target fires once; afterwards the tab remembers its own view.',
);
assert.match(
  main,
  /"--line" => match arguments[\s\S]*?aimed_at\(&mut invocation\)\.line = Some\(line\)/,
  '--line must bind a 1-based source line the same way --page binds a page.',
);
assert.match(
  main,
  /"line" => target\.line = value\.parse\(\)\.ok\(\)\.filter\(\|line\| \*line >= 1\)/,
  'A path fragment must accept line=N for Markdown.',
);
assert.match(
  app,
  /const line = Number\.isFinite\(value\.line\) && value\.line >= 1 \? Math\.round\(value\.line\) : null/,
  'asTarget must keep a 1-based line so Markdown can be aimed.',
);
assert.match(
  app,
  /async function applyTarget\(target\)[\s\S]*?kind === 'markdown'[\s\S]*?mark\.aim[\s\S]*?\[data-line\][\s\S]*?scrollIntoView/,
  'A Markdown target must scroll to the source line and mark the first search match.',
);
assert.match(
  styles,
  /mark\.aim \{[\s\S]*?background: var\(--aim-highlight\)/,
  'The Markdown search mark must use the aim-highlight token.',
);
assert.match(
  main,
  /_ if text\.starts_with\('-'\) && text\.len\(\) > 1 => \{\s*return Err\(\(2,/,
  'An unknown flag must fail with exit status 2.',
);
assert.match(
  main,
  /Ok\(Cli::Help\) => \{[\s\S]*?return;[\s\S]*?Err\(\(status, message\)\) => \{[\s\S]*?std::process::exit\(status\);[\s\S]*?tauri::Builder::default\(\)/,
  'The command line must be answered before Tauri builds anything.',
);
assert.match(
  main,
  /println!\("opened \{\}\{separator\}\{fragment\}"/,
  'Each opened file must be printed on stdout, with the fragment that was understood, so a caller can verify.',
);
assert.match(
  main,
  /tauri::Builder::default\(\);[\s\S]{0,700}?\.plugin\(tauri_plugin_single_instance::init\(/,
  'single-instance must be the first plugin: a second launch forwards its files and exits.',
);
assert.match(
  main,
  /if !smoke_enabled\(\) \{[\s\S]{0,400}?tauri_plugin_single_instance::init\(/,
  'A smoke run must skip single-instance, or a second run exits 0 without opening anything.',
);
assert.doesNotMatch(
  main,
  /\.plugin\(navigation_guard\(\)\)[\s\S]*?tauri_plugin_single_instance::init\(/,
  'Nothing may be registered before single-instance.',
);
assert.match(
  main,
  /tauri::RunEvent::Opened \{ urls \}[\s\S]*?deliver\(app, files, true\)/,
  'macOS files arrive as an Opened event; without this arm a double-click opens nothing.',
);
assert.match(
  main,
  /fn detach\([\s\S]*?\.arg\("--wait"\)[\s\S]*?\.process_group\(0\)/,
  'The detached child must run with --wait, in its own process group.',
);
assert.match(
  main,
  /!invocation\.wait[\s\S]{0,200}?!cfg!\(debug_assertions\)[\s\S]{0,200}?!must_stay[\s\S]{0,200}?!smoke_enabled\(\)[\s\S]{0,200}?detach\(&arguments\)/,
  'Detach only in release, only without --wait, never when LaunchServices started us.',
);
assert.match(
  app,
  /const openFilesReady = listen\('open-files'[\s\S]*?await openFilesReady;\s*const pending = await invoke\('pending_files'\)/,
  'The open-files listener must be live before pending_files hands over to events.',
);
assert.match(
  readme,
  /## From scripts and agents/,
  'The README must tell a program how to call this.',
);

// 0.9.2's NSIS setup said "Unable to uninstall!" over 0.9.0: it looked up
// Software\<publisher>\pdf-next, 0.9.0 had written `frantz`, and `_?=` was
// empty. The bundled template must keep the fallback, and the config must
// point at it.
assert.equal(
  config.bundle.windows?.nsis?.template,
  'windows/installer.nsi',
  'The Windows NSIS bundle must use the patched installer template.',
);
assert.match(
  nsisTemplate,
  /Function ResolvePreviousInstallDir/,
  'The NSIS template must resolve the old install dir before calling uninstall.exe.',
);
assert.match(
  nsisTemplate,
  /Software\\frantz\\\$\{PRODUCTNAME\}/,
  'The fallback must still find a 0.9.0 install under Software\\frantz.',
);
assert.match(
  nsisTemplate,
  /\$4 == ""[\s\S]*Goto reinst_done/,
  'An empty install dir must overwrite, not run uninstall.exe with `_?=`.',
);
assert.match(
  nsisTemplate,
  /StrCpy \$PassiveMode 1/,
  'A double-click is passive: progress, then the app.',
);
assert.match(
  nsisTemplate,
  /CMDLINE "\/W"/,
  '/W must still open the old wizard.',
);
assert.match(
  nsisTemplate,
  /PassiveMode = 1[\s\S]*WixMode <> 1[\s\S]*Goto reinst_done/,
  'A passive upgrade must overwrite, not uninstall.',
);
assert.equal(
  config.bundle.windows?.nsis?.installMode,
  'currentUser',
  'The setup must not ask for Administrator.',
);

// Updates: the webview may talk to exactly one host, only when asked, and may
// open exactly one kind of URL, checked in Rust.
assert.doesNotMatch(
  csp,
  /https?:\/\/(?!ipc\.localhost|doc\.localhost|api\.github\.com)/,
  'The CSP must name no network host besides api.github.com for the update check.',
);
assert.match(
  main,
  /fn is_release_url\(url: &str\) -> bool \{[\s\S]*?const RELEASES: &str = "https:\/\/github\.com\/machine-made\/pdf-next\/releases\/";[\s\S]*?url\.strip_prefix\(RELEASES\)[\s\S]*?is_ascii_alphanumeric/,
  'is_release_url must refuse anything but a pdf-next release URL made of plain path segments.',
);
assert.match(
  main,
  /fn open_download\(url: String\)[\s\S]*?!is_release_url\(&url\)[\s\S]*?open::that_detached/,
  'open_download must check is_release_url before it opens anything.',
);
assert.match(
  app,
  /ui\.update\.addEventListener\('click', \(\) => checkForUpdates\(\)\)/,
  'The update check runs on a press.',
);
assert.match(
  app,
  /window\.setTimeout\(\(\) => \{\s*void checkForUpdates\(\{ quiet: true \}\);\s*\}, \d+\);/,
  'One quiet check at launch, delayed past the first paint.',
);
assert.doesNotMatch(
  app,
  /setInterval\([\s\S]*?checkForUpdates/,
  'No polling for updates: one check at launch, then only on a press.',
);

// Printing: the system's own dialog, over a document laid out for paper.
assert.match(
  main,
  /ShowPrintUI\(COREWEBVIEW2_PRINT_DIALOG_KIND_SYSTEM\)/,
  "On Windows the dialog is the system's print window, not WebView2's in-page preview.",
);
assert.match(
  main,
  /Some\(Trouble::Refused\(message\)\) => Err\(/,
  'A dialog that refuses to open must be reported, never answered with the in-page preview.',
);
assert.match(
  app,
  /function setTitle\(name\)[\s\S]*?`pdf-next \$\{state\.version\}`[\s\S]*?invoke\('set_title', \{ title \}\)/,
  'The window title must carry the build — and be set on the window, since WebView2 never passes document.title to the frame.',
);
assert.match(
  main,
  /fn set_title\(title: String, window: tauri::Window\)[\s\S]*?window\.set_title\(&title\)/,
  'The window title is set from Rust, so the webview keeps its events-only permission list.',
);
assert.match(
  main,
  /fn printing_unavailable\(\)[\s\S]*?EnumPrintersW/,
  'ShowPrintUI succeeds and shows nothing when there is no print service, so ask the spooler first and say so.',
);
assert.match(
  styles,
  /\.sprite \{\s*\n\s*display: none/,
  'The icon sprite is hidden from the stylesheet: the CSP drops style attributes, and the dropped one laid the sprite out above the toolbar.',
);
assert.doesNotMatch(
  await readFile('src/index.html', 'utf8'),
  /style="/,
  'No style attributes in the markup — the CSP blocks them, silently.',
);
assert.ok(
  true,
);
assert.match(
  main,
  /#\[cfg\(not\(windows\)\)\]\s*fn open_print_dialog[\s\S]*?webview\.print\(\)/,
  "Elsewhere wry's own call is already the system dialog: a sheet on macOS, GTK on Linux.",
);
assert.match(
  app,
  /async function printDocument\(\)[\s\S]*?await invoke\('print_document'\)/,
  'The print button and Ctrl+P must ask Rust for the dialog.',
);
assert.match(
  app,
  /key === 'p'\) \{\s*event\.preventDefault\(\)/,
  "Ctrl+P must be taken from the webview, which would print the screen instead.",
);
assert.match(
  app,
  /intent: 'print'[\s\S]*?canvas\.width = 0;\s*canvas\.height = 0;/,
  'One scratch canvas for the whole document, released when the pages are made.',
);
assert.match(
  app,
  /context\.fillStyle = '#ffffff'/,
  'Printed pages are white: a page mode is a property of the screen.',
);
assert.match(
  app,
  /window\.addEventListener\('afterprint', finishPrint\)[\s\S]*?if \(printBlurred && state\.platform !== 'windows'\)/,
  "afterprint is the Windows signal; macOS and Linux never call window.print(), so the window coming back stands in for it there — but never on Windows, whose dialog is a separate window this one stays clickable behind.",
);
assert.match(
  app,
  /if \(!printPending\) \{\s*clearPrintPages\(\);\s*\}/,
  'A rebuild lands every second: opening a file must not empty the pages a dialog is holding.',
);
assert.match(
  styles,
  /@media print \{[\s\S]*?--md-fg: #000000 !important/,
  'The print palette must outrank body.mode-night, which is more specific than a bare id and would otherwise print pale text on white.',
);
assert.doesNotMatch(
  app,
  /await invoke\('print_document'\);\s*clearPrintPages\(\)/,
  'The dialog outlives the call on Windows and macOS: clearing here empties it.',
);
assert.match(
  styles,
  /@media print \{[\s\S]*?body > svg,[\s\S]*?#imageStage \{\s*\n\s*display: none !important/,
  'The on-screen viewer must never be what goes on paper — nor the icon sprite, which is laid out on paper however hidden it looks and pushes page one onto a second sheet.',
);

// Every decoder the worker asks for by name must be vendored next to it.
// The wasm modules are what render bitonal scans (CCITT and JBIG2 both go
// through jbig2.wasm) and JPEG 2000; a missing one draws the picture white,
// silently, and only on the files that use it.
const worker = await readFile('src/vendor/pdfjs/build/pdf.worker.min.mjs', 'utf8');
const wanted = new Set(
  worker.match(/"[\w-]+\.wasm"|\b[\w-]+_nowasm_fallback\.js\b/g)?.map((name) => name.replaceAll('"', '')),
);
assert.ok(wanted.has('jbig2.wasm'), 'The worker is expected to name jbig2.wasm.');
for (const name of wanted) {
  await assert.doesNotReject(
    access(`src/vendor/pdfjs/wasm/${name}`),
    `The worker loads ${name}; it must be vendored in src/vendor/pdfjs/wasm/.`,
  );
}
// And the worker must be told where they are in absolute terms: it fetches
// them itself, and a relative path resolves against its own folder.
assert.match(
  app,
  /function vendorUrl\(folder\) \{\s*return new URL\(`\.\/vendor\/pdfjs\/\$\{folder\}`, document\.baseURI\)\.href;/,
  'vendorUrl must build an absolute URL from the page, not the worker.',
);
for (const option of ['cMapUrl', 'standardFontDataUrl', 'wasmUrl', 'iccUrl']) {
  assert.match(
    app,
    new RegExp(`${option}: vendorUrl\\('[\\w]+/'\\)`),
    `getDocument's ${option} must go through vendorUrl; a relative path 404s inside the worker.`,
  );
}

// Markdown equations: TeX becomes MathML on the Rust side and goes through
// the same sanitizer as the rest of the document, never around it.
assert.match(main, /options\.insert\(Options::ENABLE_MATH\);/, 'Math must be enabled in pulldown-cmark.');
assert.match(
  main,
  /for \(tag, attributes\) in MATHML \{[\s\S]*?builder\.attribute_filter\([\s\S]*?keep_known_styles\([\s\S]*?builder\.clean\(&rendered\)/,
  'MathML must be allowlisted in ammonia and cleaned with the document, not spliced in after.',
);
assert.match(
  main,
  /annotation: false,/,
  'No TeX annotation: the renderer writes it unescaped.',
);
const indexHtml = await readFile('src/index.html', 'utf8');
assert.match(
  indexHtml,
  /<link rel="stylesheet" href="\.\/vendor\/math-core\/mathmlfixes\.css" \/>/,
  'The math stylesheet (equation fixes for MathML) must be linked.',
);
for (const file of [
  'math-core/mathmlfixes.css',
  'math-core/NewCMMath-Book.woff2',
  'math-core/GUST-FONT-LICENSE.txt',
  'latin-modern/lmroman12-regular.woff2',
  'machine-made-type/MachineMadeWeft-Variable.woff2',
  'machine-made-type/MachineMadeSans-Variable.woff2',
  'machine-made-type/MachineMadeSans-Italic-Variable.woff2',
  'machine-made-type/MachineMadeHeddle-Variable.woff2',
  'machine-made-type/OFL-Weft.txt',
  'machine-made-type/OFL-Sans.txt',
  'machine-made-type/OFL-Heddle.txt',
  'monaspace/MonaspaceNeon-Variable.woff2',
  'monaspace/MonaspaceArgon-Variable.woff2',
  'monaspace/MonaspaceXenon-Variable.woff2',
  'monaspace/MonaspaceRadon-Variable.woff2',
  'monaspace/MonaspaceKrypton-Variable.woff2',
  'monaspace/OFL.txt',
]) {
  await assert.doesNotReject(access(`src/vendor/${file}`), `${file} must be vendored.`);
}

// Markdown links: nothing navigates the webview. Same-page links scroll, web
// links go to the system browser through a command that takes http(s) only,
// and relative links open as tabs.
assert.match(
  app,
  /if \(\/\^https\?:\/i\.test\(href\)\) \{\s*\/\/ The web[\s\S]*?invoke\('open_link', \{ url: href \}\)/,
  'Web links in markdown must go through open_link.',
);
assert.match(
  main,
  /fn open_link\(url: String\)[\s\S]*?starts_with\("http:\/\/"\)[\s\S]*?starts_with\("https:\/\/"\);[\s\S]*?return Err/,
  'open_link must refuse every scheme but http and https.',
);
// A same-page link finds an equation whose id keeps the label's
// percent-encoding, and a heading whose id does not.
{
  const ids = ['md-math:eq%20a', 'md-math:a%3Cb', 'md-results 2'];
  const ui = { markdown: { querySelector: (selector) => {
    const id = /^\[id="(.*)"\]$/.exec(selector)?.[1].replace(/\\(.)/g, '$1');
    return ids.includes(id) ? { id } : null;
  } } };
  const CSS = { escape: (text) => text.replace(/["\\%<: ]/g, '\\$&') };
  const target = appFunction('markdownFragmentTarget', "ui.markdown.addEventListener('click'", { ui, CSS });
  assert.equal(target('md-math:eq%20a')?.id, 'md-math:eq%20a', 'An encoded equation label is found as written.');
  assert.equal(target('md-math:a%3Cb')?.id, 'md-math:a%3Cb', 'An encoded equation label is found as written.');
  assert.equal(target('md-results%202')?.id, 'md-results 2', 'An encoded link finds a plain id.');
  assert.equal(target('md-math:%E0%A4%A'), null, 'A malformed fragment finds nothing and does not throw.');
  assert.equal(target(''), null);
}
assert.match(app, /const target = siblingPath\(href\);\s*if \(target\) \{\s*void openPath\(target\);/, 'Relative markdown links open as tabs.');

// Smoke mode. Nothing here runs for a reader; it exists so a build server can
// tell a working viewer from a window that opens and draws nothing. Each part
// is easy to drop by accident and silent when dropped, which is the whole
// reason the 0.9.0 macOS build shipped.
assert.match(
  page,
  /<script type="module" src="\.\/smoke\.mjs"><\/script>\s*<script type="module" src="\.\/app\.mjs"><\/script>/,
  'smoke.mjs must load before app.mjs, or a failure inside app.mjs is never seen.',
);
assert.match(
  smoke,
  /addEventListener\('error'[\s\S]*?addEventListener\('unhandledrejection'/,
  'The failure buffer must catch both thrown errors and rejected promises.',
);
assert.match(
  app,
  /if \(launch\?\.smoke\) \{\s*void reportSmoke\(\);/,
  'The frontend must report its verdict when the launch says this is a smoke run.',
);
assert.match(
  app,
  /async function renderedPixels\(\)[\s\S]*?canvas\.width > 0 && canvas\.height > 0/,
  'A PDF counts as shown only when a page canvas has pixels; "no error" is not evidence.',
);
assert.match(
  main,
  /invoke_handler\(tauri::generate_handler!\[[\s\S]*?smoke_report[\s\S]*?\]\)/,
  'smoke_report must be registered, or the frontend can never answer.',
);
assert.match(
  main,
  /fn smoke_finish\([\s\S]*?-> ![\s\S]*?std::process::exit\(if ok \{ 0 \} else \{ 1 \}\)/,
  'The verdict must reach the shell as an exit status.',
);
assert.match(
  main,
  /if smoke_enabled\(\) \{[\s\S]{0,500}?smoke_finish\(false, &format!\("no report within/,
  'A frontend that never answers must still end the run; that is the blank-window case.',
);

assert.match(
  smoke,
  /boot stalled at \$\{progress\.at\}/,
  'A launch that hangs must name the step it hung in; every check in app.mjs runs after it.',
);
assert.match(
  app,
  /mark\('os_theme'\);\s*applyTheme\(await invoke\('os_theme'\)\)/,
  'The first call the boot waits on must be marked, or a hang there looks like a blank window.',
);

// A drop that brings no paths must say so. It is the one way into the app
// that can fail without raising anything, and silence reads as a dead app.
// The frontend waits for the Rust side, which looks on the pasteboard first.
assert.match(
  app,
  /listen\('drop-empty'[\s\S]*?setStatus\(/,
  'A drop the Rust side found nothing for must report itself; silence looks like a broken viewer.',
);
assert.match(
  main,
  /WindowEvent::DragDrop\(DragDropEvent::Drop \{ paths, \.\. \}\)[\s\S]*?paths\.is_empty\(\)/,
  'An empty drop must be caught in Rust, where the pasteboard can still be read.',
);
assert.match(
  main,
  /dropped_paths\(\)[\s\S]*?emit\("drop-empty"[\s\S]*?deliver\(&handle, files, true\)/,
  'A recovered path must be opened, and only a truly empty drop reported as one.',
);
assert.match(
  main,
  /NSPasteboardNameDrag/,
  'The recovery must read the drag pasteboard; the general one holds a different thing.',
);
assert.match(
  main,
  /fn a_file_url_on_the_drag_pasteboard_is_a_dropped_file/,
  'The recovery must be run, not only compiled: a drop is the one path no CI can perform.',
);
assert.match(
  main,
  /registerForDraggedTypes[\s\S]*NSPasteboardTypeFileURL/,
  'The webview must accept a file-URL drop; tao only registers the older filename type, so Finder otherwise never delivers the event.',
);
assert.match(
  main,
  /fn accept_file_url_drops/,
  'Register the current type on the webview, not the window: tao unwraps the older property list and would panic.',
);

// One selection record for Markdown and PDF. The Review panel lists them.
assert.match(
  app,
  /function describeSelection\([^)]*\)[\s\S]*?return \{ file, kind: 'markdown', at: atRange\(start, end, 'line'\), quote, \.\.\.\(anchor \? \{ anchor \} : \{\}\) \}/,
  'describeSelection must return a review record, not a display string.',
);
assert.match(
  app,
  /function formatSelection\(record\)[\s\S]*?`\$\{record\.file\}:\$\{record\.at\.line\}\$\{end\}`[\s\S]*?`\$\{record\.file\} p\.\$\{record\.at\.page\}\$\{end\}`/,
  'The human locator must be derived from the record.',
);
assert.match(
  app,
  /invoke\('append_review', \{\s*document: path,\s*review,/,
  'A new review must append a record, not a markdown block.',
);
assert.match(
  app,
  /listen\('reviews-changed'[\s\S]*?reloadReviewsFromDisk\(\)/,
  'An external sidecar edit must refresh reviews without reloading the document.',
);
assert.match(app, /await openFile\(\{ \.\.\.state\.file, revision \}, \{ preserveView: true \}\);[\s\S]*?state\.file\?\.kind === 'pdf'[\s\S]*?reportSmoke\(\)/,
  'A completed PDF watcher reload reports its final revision to the held native smoke harness.');
assert.match(app, /documentSha256=\$\{digest\.slice\('sha256:'\.length\)\}; sourceRevision=\$\{file\.revision\}; reviewsRevision=\$\{state\.reviewRevision\}/,
  'Native reload reports include the PDF digest, file revision, and sidecar revision.');
assert.match(app, /reviewsCount=\$\{reviews\.length\}/,
  'Native readiness reports how many review rows were loaded.');
assert.match(app, /uniqueRowIds=\$\{rowIds\.size\}; uniqueTints=\$\{tints\.size\}; serializedIds=\$\{serializedIds\.size\}; agentExtensions=\$\{agentExtensions\.length\}; nextId=\$\{state\.nextId\}/,
  'Dense native readiness reports stable row IDs, all tints, preserved extensions, and next ID.');
assert.match(app, /'Cancel reattach' : 'Reattach'[\s\S]*?pointerdown'[\s\S]*?preventDefault\(\)/,
  'Reattach keeps the text selection, so a selection made first is taken at once.');
assert.match(app, /textContent = 'Use disk'[\s\S]*?textContent = 'Save my draft'[\s\S]*?expectedComment: String\(current\.comment \|\| ''\)/,
  'Same-field conflicts require an explicit choice before the user draft is rebased.');
assert.match(app, /textContent = 'Copy draft'[\s\S]*?textContent = 'Discard draft'/,
  'A draft for a removed record can be copied or discarded without recreating the review.');
assert.match(
  app,
  /async function reloadReviewsFromDisk\(\) \{\s*await loadReviews\(\{ fromDisk: true \}\)/,
  'An agent write must load disk first, not flush a panel draft over it.',
);
assert.doesNotMatch(
  app,
  /async function reloadReviewsFromDisk\(\) \{[^}]*flushCommentSave/,
  'reloadReviewsFromDisk must not write the panel back to disk before reading.',
);
assert.match(
  app,
  /from '\.\/review-sync\.mjs'/,
  'Panel drafts vs agent writes share a reconcile helper.',
);
assert.match(
  app,
  /const COMMENT_SAVE_MS = 400/,
  'A panel comment must write the sidecar as you type.',
);
assert.match(
  app,
  /!typing &&\s*event\.key === 'Enter'[\s\S]*?reviewFromSelection\(\)[\s\S]*?openNoteBox\(\)/,
  'Enter on a selection must open the comment box.',
);
assert.match(
  app,
  /event\.target instanceof HTMLTextAreaElement/,
  'A comment textarea must count as typing, so Enter there is a newline.',
);
assert.doesNotMatch(
  app,
  /save\.textContent = 'Save'/,
  'Panel comments write themselves; there is no extra Save click.',
);
assert.match(page, /id="reviewPane"/, 'The Review panel lives on the right of the stage.');
assert.match(page, /id="reviewSizeDown"/, 'The Review panel has a smaller-text control.');
assert.match(page, /id="reviewSizeUp"/, 'The Review panel has a larger-text control.');
assert.match(
  app,
  /from '\.\/review-size\.mjs'/,
  'Review text size comes from the shared size helper.',
);
assert.match(
  styles,
  /#reviewList \{[\s\S]*?font-size: var\(--review-size/,
  'Review quotes and comments follow the pane size, not a hard-coded 12px.',
);
{
  assert.deepEqual(REVIEW_SIZE_STEPS, [10, 11, 12, 13, 15, 17, 20]);
  assert.equal(REVIEW_SIZE_DEFAULT, 12);
  assert.equal(nearestReviewSize(12), 12);
  assert.equal(nearestReviewSize(14), 13);
  assert.equal(nearestReviewSize(16), 15);
  assert.equal(nearestReviewSize(0), 12);
  assert.equal(nearestReviewSize('nope'), 12);
  assert.equal(nextReviewSize(12, 1), 13);
  assert.equal(nextReviewSize(12, -1), 11);
  assert.equal(nextReviewSize(10, -1), 10);
  assert.equal(nextReviewSize(20, 1), 20);
  assert.equal(nextReviewSize(11, 1), 12);
  assert.equal(nextReviewSize(17, 1), 20);
}
assert.match(page, /id="reviewChip"/, 'A chip after a short hold adds a review.');
assert.match(page, /id="copyPath"/, 'The toolbar copies the full path after zoom.');
assert.match(page, /id="copyName"/, 'The toolbar copies the file name after zoom.');
assert.match(page, /id="reduce"/, 'PDF toolbar can write a smaller name_reduced.pdf.');
// The quiet toolbar: about ten controls; the rest live in the View and Window
// menus, which keep the controls' ids, or in the palette and shortcuts.
{
  const bar = page.slice(page.indexOf('<header id="bar">'), page.indexOf('</header>'));
  const outside = bar.replace(/<div id="(viewMenu|dockMenu)" class="popover"[\s\S]*?\n {8}<\/div>\n/g, '');
  const controls = outside.match(/<(button|select|input)\b/g) || [];
  assert.ok(controls.length <= 16, `The toolbar keeps to a few controls (${controls.length}, counting each file kind's own).`);
  for (const id of ['pageView', 'raw', 'mdFont', 'mdSize', 'mdWidth', 'splitView', 'mode', 'poll', 'copyPath', 'copyName', 'print', 'reduce']) {
    assert.match(bar, new RegExp(`<div id="viewMenu"[\\s\\S]*id="${id}"[\\s\\S]*id="dockMenuButton"`), `${id} is in the View menu.`);
  }
  for (const id of ['dockTop', 'dockLeft', 'dockCenter', 'dockRight', 'dockBottom', 'wrap', 'fullScreen', 'present']) {
    assert.match(bar, new RegExp(`<div id="dockMenu"[\\s\\S]*id="${id}"`), `${id} is in the Window menu.`);
  }
  assert.doesNotMatch(bar, /id="(ask|note)"/, 'Ask and Add review live on their shortcuts, the card and the right-click menu.');
  assert.match(bar, /id="notes"[^>]*>\s*<svg class="icon"><use href="#i-review"/, 'The Review panel keeps its toolbar button.');
  assert.match(bar, /id="viewMenuButton"[^>]*aria-haspopup="dialog" aria-expanded="false" aria-controls="viewMenu"/);
  assert.match(styles, /#update:not\(\.available\) \{\s*display: none/, 'The update button only shows when there is an update.');
  const capabilities = JSON.parse(await readFile('src-tauri/capabilities/default.json', 'utf8')).permissions;
  for (const permission of ['core:window:allow-set-fullscreen', 'core:window:allow-is-fullscreen']) {
    assert.ok(capabilities.includes(permission), `The window may ${permission.split('allow-')[1].replace('-', ' ')}.`);
  }
  assert.match(app, /event\.key === 'F11' \|\| event\.key === 'F5'/, 'F11 is full screen and F5 presents.');
  assert.match(page, /id="setFocusMode" type="checkbox" checked/, 'Settings has the focus mode switch, on by default.');
}
assert.match(
  app,
  /invoke\('reduce_pdf'/,
  'Reduce size calls the Rust picamatl command.',
);
assert.match(
  app,
  /_reduced\.pdf|reduceOpenPdf/,
  'Reduce opens the written sibling when smaller.',
);
assert.match(
  styles,
  /body:not\(\.has-file\) \.file-only/,
  'Path and name copy stay hidden until a file is open.',
);
assert.match(
  styles,
  /#noteBox \{[\s\S]*?position: fixed;/,
  'The comment box sits on the selection, not pinned to the toolbar corner.',
);
assert.match(
  app,
  /function wrapPdfQuote\([\s\S]*?wrapQuoteFragments\(layer, quote, id/,
  'A quote that spans PDF.js nodes must still receive a tint.',
);
assert.match(
  app,
  /createElement\(asMark \? 'mark' : 'review-q'\)/,
  'PDF quotes wrap matched glyphs in <review-q>, not a textLayer span.',
);
assert.match(
  styles,
  /\.textLayer review-q/,
  'PDF quote wash targets <review-q>, which PDF.js does not absolutize.',
);
assert.deepEqual(
  findNormalizedSpan('hello world from page', 'hello world'),
  { start: 0, end: 11 },
);
assert.deepEqual(
  findNormalizedSpan('the start of a much longer quote lives here', 'start of a much longer quote'),
  { start: 4, end: 32 },
);
assert.equal(findNormalizedSpan('nope', 'missing phrase here'), null);
assert.equal(findNormalizedSpan('repeat quote repeat quote', 'repeat quote'), null,
  'A repeated full quote is ambiguous; never fall back to its first occurrence.');
assert.deepEqual(reviewLabel({ id: 'r17', at: { page: 4 } }, []), 'r17',
  'Review badges use stable IDs, independent of location and list order.');
assert.equal(reviewAction({ comment: 'please delete this' }), 'improve',
  'Legacy comments never imply the Delete action.');
assert.equal(reviewStatus({}), 'open', 'Legacy reviews remain open until explicitly changed.');
assert.equal(sameReviewQuote({ quote: ' A selected phrase ' }, 'a  selected phrase'), true);
assert.equal(sameReviewQuote({ quote: 'original phrase' }, 'different phrase'), false,
  'Manual reattachment cannot silently change the requested text.');
{
  const oldAnchor = { prefix: 'before', position: { page: 1, x: 10, y: 20 } };
  const nextAnchor = reattachedReviewAnchor(oldAnchor, {
    prefix: 'new before', position: { page: 3, x: 30, y: 40 },
  }, { page: 1 }, 'original phrase');
  assert.equal(nextAnchor.position.page, 3);
  assert.deepEqual(nextAnchor.original, {
    anchor: oldAnchor, at: { page: 1 }, quote: 'original phrase',
  }, 'Manual reattachment retains the original quote, location, and anchor.');
}
assert.equal(reviewColor({ id: 'r17', color: 5 }), 5, 'Persisted colors survive reorder and reload.');
assert.equal(reviewColor({ id: 'r17' }), 1, 'Legacy colors have a stable deterministic fallback.');
assert.equal(new Set(Array.from({ length: 16 }, (_, i) => reviewColor({ id: `r${i + 1}` })).slice(0, 16)).size, 16);
assert.equal(new Set(Array.from({ length: 30 }, (_, i) => reviewColor({ id: `r${i + 1}` })).slice(0, 16)).size, 16,
  'Thirty reviews can use every available tint while stable IDs keep badge identity.');
const thirtyIds = Array.from({ length: 30 }, (_, i) => ({ id: `r${i + 1}` }));
assert.equal(new Set(thirtyIds.map((review) => reviewLabel(review, thirtyIds))).size, 30,
  'Thirty review badges remain individually addressable.');
assert.equal(new Set([...thirtyIds].reverse().map((review) => `${review.id}:${reviewColor(review)}`)).size, 30,
  'Stable review color assignments do not depend on list order.');
const reviewStateKey = appFunction('reviewStateKey', 'function draftsForPath(', {});
assert.notEqual(reviewStateKey('a.pdf', 'r1'), reviewStateKey('b.pdf', 'r1'),
  'Review conflicts and location state are isolated by document path.');
{
  const hint = appFunction('optionalSourceHint', '/// Ask is', {
    invoke: async () => ({ file: 'chapters/main.tex', line: 14, method: 'synctex', verified: false,
      documentRevision: 'sha256:abc' }),
    window: { setTimeout: () => 1, clearTimeout() {} },
    setStatus() {},
  });
  const value = await hint('paper.pdf', { page: 1, x: 36, y: 72 }, 'sha256:abc');
  assert.equal(value.verified, false, 'Source hints remain explicitly unverified.');
  assert.equal(value.documentRevision, 'sha256:abc');
}
{
  const expectedComment = '  agent note\n';
  const draft = { id: 'r1', comment: 'my edit', expectedComment };
  const unchanged = reconcilePendingComment(draft, [{ id: 'r1', comment: expectedComment }], []);
  assert.equal(unchanged.pending.expectedComment, expectedComment,
    'Reconciliation must preserve the exact disk comment used by backend compare-and-swap.');
  assert.equal(unchanged.conflict, null);
  const changed = reconcilePendingComment(draft, [{ id: 'r1', comment: 'agent note' }], []);
  assert.equal(changed.conflict, 'changed',
    'Whitespace-only changes on disk still change the compare-and-swap value.');
}
{
  const pages = [{ page: 1, text: 'aaaa' }];
  assert.equal(resolveReviewAnchor(pages, 'aaa').status, 'ambiguous',
    'Overlapping quote occurrences cannot be treated as a unique selection.');
  assert.equal(resolveReviewAnchor(pages, 'aaa', { prefix: 'missing' }).status, 'ambiguous',
    'An unmatched context does not make overlapping repeated quotes unique.');
  assert.deepEqual(resolveReviewAnchor(pages, 'aaa', { prefix: 'a' }),
    { status: 'located', page: 1, start: 1, end: 4 },
    'Context can disambiguate an overlapping occurrence.');
}
{
  const pages = [
    { page: 2, text: 'start alpha repeated phrase end. second repeated phrase elsewhere.' },
    { page: 8, text: 'before repeated phrase after' },
  ];
  assert.deepEqual(resolveReviewAnchor(pages, 'repeated phrase', {
    position: { page: 2, x: 36, y: 72 }, prefix: 'start alpha ', suffix: ' end.',
  }), { status: 'located', page: 2, start: 12, end: 27 });
  assert.deepEqual(resolveReviewAnchor(pages, 'repeated phrase', {
    position: { page: 2, x: 36, y: 72 }, prefix: 'before ', suffix: ' after',
  }), { status: 'located', page: 8, start: 7, end: 22 });
  assert.equal(resolveReviewAnchor(pages, 'repeated phrase', {
    position: { page: 2 }, prefix: 'no matching context ', suffix: 'missing',
  }).status, 'ambiguous');
  assert.equal(resolveReviewAnchor(pages, 'deleted passage', {
    position: { page: 2 }, prefix: '', suffix: '',
  }).status, 'unlocated');
  assert.equal(resolveReviewAnchor([
    { page: 2, text: 'the selected repeated phrase remains here' },
    { page: 9, text: 'an unrelated repeated phrase remains here' },
  ], 'repeated phrase', { position: { page: 2 }, prefix: '', suffix: '' }).status, 'ambiguous',
  'A quote still present on its former page is ambiguous if it also appears elsewhere.');
}
{
  // PDF.js 6.3.289 text items for a pdflatex page with \emph{non}linear and
  // $u_\tau$, joined with spaces as pdfReviewTextPages joins them.
  const items = ['The', ' ', 'non', 'linear term dominates when the friction velocity', ' ', 'u', 'τ',
    ' ', 'grows large. We', 'measure the Reynolds number', ' ', 'Re', 'τ', ' ', '= 180 in the channel.', '1'];
  const pages = [{ page: 1, text: items.join(' ') }];
  const word = resolveReviewAnchor(pages, 'The nonlinear term');
  assert.equal(word.status, 'located', 'A quote across a font change inside a word is located.');
  assert.equal(pages[0].text.slice(word.start, word.end), 'The   non linear term', 'Offsets index the page text.');
  assert.equal(resolveReviewAnchor(pages, 'velocity uτ grows').status, 'located',
    'A quote across inline math pieces is located.');
  assert.equal(resolveReviewAnchor([{ page: 1, text: 'u τ and u τ' }], 'uτ').status, 'ambiguous',
    'A repeated quote stays ambiguous when spaces are ignored.');
  assert.equal(resolveReviewAnchor([{ page: 3, text: 'flow within the wa ke region' }], 'in the wake').status,
    'unlocated', 'A match that ignores spaces must start at a word boundary.');
  assert.equal(resolveReviewAnchor([{ page: 3, text: 'the wa kes form' }], 'the wake').status,
    'unlocated', 'A match that ignores spaces must end at a word boundary.');
  assert.deepEqual(resolveReviewAnchor([{ page: 1, text: 'ab and a b' }], 'ab'),
    { status: 'located', page: 1, start: 0, end: 2 },
    'An exact match wins over a match that ignores spaces.');
  assert.equal(resolveReviewAnchor([{ page: 1, text: 'u τ here' }, { page: 2, text: 'u τ there' }], 'uτ', {
    prefix: '', suffix: 'there',
  }).status, 'located', 'Context still selects one candidate when spaces are ignored.');
}
{
  const prefix = 'p'.repeat(48);
  const suffix = 's'.repeat(48);
  const anchor = { prefix: `ignored ${prefix}`, suffix: `${suffix} ignored` };
  for (const loose of [false, true]) {
    const space = (text) => loose ? [...text].join(' ') : text;
    const text = `${space(prefix)} ${space('ab')} ${space(suffix)}`;
    const start = space(prefix).length + 1;
    assert.deepEqual(resolveReviewAnchor([{ page: 1, text }], 'ab', anchor),
      { status: 'located', page: 1, start, end: start + space('ab').length },
      'All 48 context characters must match across boundary spaces and PDF word splits.');
    assert.equal(resolveReviewAnchor([{ page: 1, text }], 'ab', { prefix: 'wrong' }).status,
      'unlocated', 'A unique occurrence with mismatched context must remain unlocated.');
  }
}
{
  // Count characters processed by replacements instead of asserting wall time.
  // A page-wide space removal per loose candidate makes this grow quadratically.
  const source = (await readFile('src/review-label.mjs', 'utf8')).replace(/^export /gm, '');
  for (const anchor of [{ prefix: 'missing' }, { suffix: 'missing' }]) {
    const text = 'a b '.repeat(4_000);
    const work = runInNewContext(`
      let characters = 0;
      const replace = String.prototype.replace;
      String.prototype.replace = function(...args) {
        characters += this.length;
        return replace.apply(this, args);
      };
      ${source}
      const result = resolveReviewAnchor([{ page: 1, text }], 'ab', anchor);
      if (result.status !== 'ambiguous') throw new Error('Repeated unmatched quotes must stay ambiguous.');
      characters;
    `, { text, anchor });
    assert.ok(work < text.length * 64,
      'Missing prefix and suffix comparisons must process a bounded amount of context per candidate.');
  }
  const text = `${'a b '.repeat(4_000)}unique`;
  assert.deepEqual(resolveReviewAnchor([{ page: 2, text }], 'ab', { suffix: 'unique' }),
    { status: 'located', page: 2, start: 15_996, end: 15_999 },
    'Context must still select a unique occurrence at the end of a repetitive page.');
}
assert.equal(mapCollapsedIndex('hello', 2), 2);
assert.equal(mapCollapsedIndex('a  b', 1), 1);
assert.equal(mapCollapsedIndex('a  b', 2), 3);
{
  const saved = [{ id: 'r1', comment: 'old' }, { id: 'r2', comment: 'keep' }];
  const draft = { id: 'r1', comment: 'typing' };
  assert.equal(
    reconcilePendingComment(draft, [{ id: 'r2', comment: 'keep' }], saved).keepDraftId,
    'r1',
    'Agent deletion preserves an orphaned draft for recovery.',
  );
  assert.equal(reconcilePendingComment(draft, [{ id: 'r2', comment: 'keep' }], saved).conflict, 'removed');
  assert.equal(
    reconcilePendingComment(
      draft,
      [
        { id: 'r1', comment: 'agent fix' },
        { id: 'r2', comment: 'keep' },
      ],
      saved,
    ).keepDraftId,
    'r1',
    'Agent edit of that comment preserves the draft for conflict resolution.',
  );
  assert.equal(
    reconcilePendingComment(
      draft,
      [
        { id: 'r1', comment: 'old' },
        { id: 'r2', comment: 'agent other' },
      ],
      saved,
    ).keepDraftId,
    'r1',
    'Agent edit of another id keeps the in-progress comment.',
  );
}
{
  const state = { file: { path: 'a.pdf' }, generation: 2, reviews: [], reviewConflicts: new Map() };
  const pending = { id: 'r4', path: 'a.pdf', comment: 'mine', expectedComment: 'original' };
  const key = 'a.pdf\u0000r4';
  const pendingComments = new Map([[key, pending]]);
  let args;
  const update = appFunction('updateReviewComment', 'async function deleteReview(', {
    state, pendingComments,
    HTMLTextAreaElement: class {},
    commentDraftKey: (path, id) => `${path}\u0000${id}`,
    reviewStateKey: (path, id) => `${path}\u0000${id}`,
    invoke: async (_command, payload) => {
      args = payload;
      throw new Error('review comment conflict');
    },
    loadReviews: async () => {},
    setStatus() {}, renderReviewList() {}, reviewRowById() { return null; },
  });
  assert.equal(await update(pending, { quiet: true }), false);
  assert.equal(JSON.stringify(args), JSON.stringify({
    document: 'a.pdf', id: 'r4', expectedComment: 'original', comment: 'mine',
  }));
  assert.equal(pendingComments.get(key), pending, 'A same-field conflict keeps the unsaved draft.');
  assert.equal(state.reviewConflicts.get(key).reason, 'changed');
}
{
  const pending = new Map([
    ['r1', { id: 'r1', comment: 'mine 1', expectedComment: 'old 1' }],
    ['r2', { id: 'r2', comment: 'mine 2', expectedComment: 'old 2' }],
  ]);
  const result = reconcilePendingComments(pending, [
    { id: 'r1', comment: 'agent 1' }, { id: 'r2', comment: 'old 2' },
  ], [{ id: 'r1', comment: 'old 1' }, { id: 'r2', comment: 'old 2' }]);
  assert.equal(result.pending.size, 2, 'One external edit must not discard another pending row.');
  assert.equal(result.conflicts.has('r1'), true, 'Same-field edits are reported as conflicts.');
  assert.equal(result.conflicts.has('r2'), false, 'Independent draft remains saveable.');
}
{
  const pending = { id: 'r1', path: 'a.pdf', comment: 'mine', expectedComment: 'old', original: { id: 'r1' } };
  const pendingComments = new Map([['a.pdf\u0000r1', pending]]);
  const state = { file: { path: 'a.pdf' }, generation: 1, reviewConflicts: new Map() };
  let retry;
  const saveDraft = appFunction('saveDraftAfterConflict', 'async function reattachReview(', {
    state, pendingComments,
    commentDraftKey: (path, id) => `${path}\u0000${id}`,
    reviewStateKey: (path, id) => `${path}\u0000${id}`,
    invoke: async () => ({ reviews: [{ id: 'r1', comment: 'agent' }] }),
    applyReviewStore() {}, renderReviewList() {},
    updateReviewComment: async (draft) => { retry = draft; return true; },
    setStatus() {},
  });
  await saveDraft('r1');
  assert.equal(retry.expectedComment, 'agent', 'Explicit Save my draft uses the refreshed disk comment for CAS.');
  assert.equal(retry.comment, 'mine');
}
{
  const pending = { id: 'r1', path: 'a.pdf', comment: 'mine', expectedComment: 'old', original: { id: 'r1', quote: 'audit quote' } };
  const pendingComments = new Map([['a.pdf\u0000r1', pending]]);
  const state = { file: { path: 'a.pdf' }, generation: 1, reviewConflicts: new Map() };
  let updated = false;
  const saveDraft = appFunction('saveDraftAfterConflict', 'async function reattachReview(', {
    state, pendingComments,
    commentDraftKey: (path, id) => `${path}\u0000${id}`,
    reviewStateKey: (path, id) => `${path}\u0000${id}`,
    invoke: async () => ({ reviews: [] }),
    applyReviewStore() {}, renderReviewList() {},
    updateReviewComment: async () => { updated = true; },
    setStatus() {},
  });
  await saveDraft('r1');
  assert.equal(updated, false, 'An explicitly removed record is never recreated by saving its draft.');
  assert.equal(pendingComments.get('a.pdf\u0000r1'), pending, 'The removed record keeps its quote and draft for copying.');
  assert.equal(state.reviewConflicts.get('a.pdf\u0000r1').reason, 'removed');
}
{
  const pending = { id: 'r1', path: 'a.pdf', comment: 'mine', expectedComment: 'old', original: { id: 'r1', quote: 'audit quote' } };
  const pendingComments = new Map([['a.pdf\u0000r1', pending]]);
  const conflict = new Map([['a.pdf\u0000r1', { reason: 'changed' }]]);
  const state = { file: { path: 'a.pdf' }, generation: 1, reviewConflicts: conflict };
  let status = '';
  let updated = false;
  const saveDraft = appFunction('saveDraftAfterConflict', 'async function reattachReview(', {
    state, pendingComments,
    commentDraftKey: (path, id) => `${path}\u0000${id}`,
    reviewStateKey: (path, id) => `${path}\u0000${id}`,
    invoke: async () => null,
    applyReviewStore() {}, renderReviewList() {},
    updateReviewComment: async () => { updated = true; },
    setStatus(message) { status = message; },
  });
  await saveDraft('r1');
  assert.equal(updated, false, 'A missing sidecar does not authorize rebasing a draft or recreating a review.');
  assert.equal(pendingComments.get('a.pdf\u0000r1'), pending, 'The draft survives a temporarily missing sidecar.');
  assert.equal(conflict.get('a.pdf\u0000r1').reason, 'changed');
  assert.match(status, /temporarily unavailable/);
}
{
  const pending = { id: 'r1', path: 'a.pdf', comment: 'saved edit', expectedComment: 'saved edit', original: { id: 'r1', comment: 'old' } };
  const pendingComments = new Map([['a.pdf\u0000r1', pending]]);
  const state = {
    file: { path: 'a.pdf', kind: 'pdf' }, generation: 1, reviewDocumentPath: 'a.pdf',
    reviewConflicts: new Map(), reviewLocations: new Map(), reviews: [],
  };
  const load = appFunction('loadReviews', '/// Disk first.', {
    state, pendingComments,
    commentDraftKey: (path, id) => `${path}\u0000${id}`,
    reviewStateKey: (path, id) => `${path}\u0000${id}`,
    draftsForPath: () => new Map([['r1', pending]]),
    reconcilePendingComments,
    invoke: async () => ({ revision: 2, reviews: [{ id: 'r1', comment: 'saved edit' }] }),
    applyReviewStore() {}, setStatus() {},
  });
  await load();
  assert.equal(pendingComments.has('a.pdf\u0000r1'), false, 'A draft reconciled to the saved disk value is removed from the pending map.');
}
{
  const records = Array.from({ length: 32 }, (_, index) => ({ id: `r${index + 1}`, quote: `Scroll render ${index * 8}`, comment: '' }));
  const draft = { id: 'r1', path: 'a.pdf', comment: 'unsaved', expectedComment: '', original: records[0] };
  const pendingComments = new Map([['a.pdf\u0000r1', draft]]);
  const state = {
    file: { path: 'a.pdf', kind: 'pdf' }, generation: 1, reviewDocumentPath: 'a.pdf',
    reviewRevision: 4, reviews: records, reviewConflicts: new Map(), reviewLocations: new Map(),
  };
  let read = null;
  let rendered = null;
  const load = appFunction('loadReviews', '/// Disk first.', {
    state, pendingComments,
    commentDraftKey: (path, id) => `${path}\u0000${id}`,
    reviewStateKey: (path, id) => `${path}\u0000${id}`,
    draftsForPath: () => new Map([['r1', pendingComments.get('a.pdf\u0000r1')]].filter(([, item]) => item)),
    reconcilePendingComments,
    invoke: async () => read,
    applyReviewStore(store, options) { rendered = { store, options }; state.reviews = store.reviews; },
    setStatus() {},
  });
  await load();
  assert.equal(state.reviews.length, 32, 'A missing sidecar cannot erase the last valid review panel.');
  assert.equal(pendingComments.get('a.pdf\u0000r1'), draft, 'A missing sidecar preserves pending drafts.');
  assert.equal(rendered, null, 'A null IPC result is not treated as a valid empty store.');
  read = { revision: 5, nextId: 33, reviews: records };
  await load();
  assert.equal(state.reviews.length, 32, 'The panel restores when its sidecar returns.');
  read = { revision: 6, nextId: 1, reviews: [] };
  await load();
  assert.equal(state.reviews.length, 0, 'A valid empty store clears reviews.');
}
{
  const state = { file: { path: 'a.pdf' }, reviewDocumentPath: 'a.pdf', reviewRevision: 8, reviews: [] };
  let reloads = 0;
  const apply = appFunction('applyReviewStore', 'async function loadReviews(', {
    state, reviewPaintSignature: () => '', loadReviews() { reloads += 1; },
    reviewIdNum: () => 1,
    renderReviewList() {}, paintReviewMarks() {},
  });
  assert.equal(apply({ revision: 7, reviews: [] }), false, 'A late mutation response cannot roll the panel back behind a newer watcher read.');
  assert.equal(reloads, 1, 'A stale mutation response triggers one authoritative reread.');
  assert.equal(apply({ revision: 2, reviews: [{ id: 'r1' }] }, { authoritative: true }), true,
    'An authoritative disk read can represent a reset/imported revision counter.');
  assert.equal(state.reviewRevision, 2);
}
// A Markdown paint draws the panel itself, so the panel is not drawn twice.
for (const [kind, signature, panels, paints] of [
  ['markdown', 'new', 0, 1], ['markdown', 'same', 1, 0], ['pdf', 'new', 1, 1],
]) {
  const state = { file: { path: 'a', kind }, reviewDocumentPath: 'a', reviewRevision: 0, reviews: [] };
  let sigs = 0;
  let panelsDrawn = 0;
  let painted = 0;
  const apply = appFunction('applyReviewStore', 'async function loadReviews(', {
    state, reviewPaintSignature: () => (signature === 'same' ? 's' : String(sigs++)),
    reviewIdNum: () => 1, loadReviews() {},
    renderReviewList() { panelsDrawn += 1; }, paintReviewMarks() { painted += 1; },
  });
  apply({ revision: 1, reviews: [{ id: 'r1' }] });
  assert.deepEqual([panelsDrawn, painted], [panels, paints],
    `${kind} store with ${signature} paint: panel drawn ${panels}, paints ${paints}.`);
}
// A target aimed at Markdown leaves find marks alone, so the counter stays true.
{
  const selectors = [];
  await appFunction('applyTarget', '/// Replace each element', {
    state: { file: { kind: 'markdown' } }, ui: { markdown: {} }, nav: { push() {} },
    setRaw() {}, unwrapMarks: (root, selector) => selectors.push(selector),
  })({ line: null, search: null, page: null });
  assert.deepEqual(selectors, ['mark.aim:not(.find)']);
}
assert.match(page, /id="reviewMenu"/, 'Right-click on a selection adds a review.');
assert.match(
  app,
  /const REVIEW_CHIP_MS = 500/,
  'The add-review chip waits half a second after the selection settles.',
);
assert.match(
  app,
  /function reviewTint\(review\)[\s\S]*?REVIEW_TINTS/,
  'Review marks use the persisted color from the record.',
);
assert.match(
  app,
  /PDF\.js styles[\s\S]*?position:absolute[\s\S]*?nested span/,
  'PDF quote wash must not nest a span inside the textLayer.',
);
{
  const wrap = app.match(/function wrapQuoteFragments\([\s\S]*?\nfunction wrapPdfQuote/)?.[0] || '';
  assert.ok(wrap, 'wrapQuoteFragments must sit next to wrapPdfQuote.');
  assert.doesNotMatch(
    wrap,
    /createElement\('span'\)/,
    'A nested textLayer span becomes position:absolute and washes the whole line.',
  );
  assert.doesNotMatch(
    wrap,
    /createElement\('mark'\)/,
    'Wrapping PDF.js text in bare createElement(mark) is only for markdown via asMark.',
  );
  assert.match(wrap, /'review-q'/, 'PDF path creates <review-q>.');
}
assert.match(
  app,
  /function wrapQuoteIn\([\s\S]*?asMark: true/,
  'Markdown quotes wrap the matched words.',
);
assert.match(
  styles,
  /\[data-review-tint='1'\][\s\S]*?\[data-review-tint='16'\]/,
  'Sixteen review tints are available in light and dark themes.',
);
assert.match(
  app,
  /from '\.\/review-label\.mjs'/,
  'Review numbers come from the shared label helper.',
);
assert.match(styles, /\.review-no/, 'Each highlighted block carries its 1.1 number.');
{
  const pages = [
    { id: 'r1', at: { page: 1 } },
    { id: 'r2', at: { page: 1 } },
    { id: 'r3', at: { page: 1 } },
    { id: 'r4', at: { page: 2 } },
    { id: 'r5', at: { page: 2 } },
  ];
  assert.equal(reviewLabel(pages[0], pages), 'r1');
  assert.equal(reviewLabel(pages[1], pages), 'r2');
  assert.equal(reviewLabel(pages[2], pages), 'r3');
  assert.equal(reviewLabel(pages[3], pages), 'r4');
  assert.equal(reviewLabel(pages[4], pages), 'r5');
  const afterDelete = pages.filter((review) => review.id !== 'r2');
  assert.equal(reviewLabel(afterDelete[1], afterDelete), 'r3');
  const md = [
    { id: 'r1', at: { line: 12 } },
    { id: 'r2', at: { line: 12 } },
    { id: 'r3', at: { line: 40 } },
  ];
  assert.equal(reviewLabel(md[0], md), 'r1');
  assert.equal(reviewLabel(md[1], md), 'r2');
  assert.equal(reviewLabel(md[2], md), 'r3');
}
assert.match(
  app,
  /const REVIEW_PANE_WIDTH = 280/,
  'Opening the Review panel must know how much width to grow.',
);
assert.match(
  styles,
  /body:not\(\.kind-pdf\):not\(\.kind-markdown\) \.review-only/,
  'Ask and Review stay hidden until a PDF or Markdown file is open.',
);
assert.match(
  JSON.stringify(config.app.windows[0]),
  /"width":880/,
  'The empty window must be wide enough for the toolbar.',
);
assert.match(
  JSON.stringify(config.app.windows[0]),
  /"height":520/,
  'The empty window must be tall enough to read the drop target.',
);
assert.doesNotMatch(app, /append_note/, 'append_note is gone.');
assert.doesNotMatch(app, /\.notes\.md/, 'The per-stem notes sidecar is gone.');
assert.match(
  main,
  /fn open_review_document\([\s\S]*?let admitted = allowed\.get\(&doc_path\)\.ok_or\("file was never opened"\)\?;/,
  'Review writes must refuse a document that is not in the open set.',
);
assert.match(
  main,
  /const REVIEW_SUFFIX: &str = "_review\.json"/,
  'The sidecar is {stem}_review.json next to the document.',
);
assert.match(
  main,
  /fn review_sidecar\(doc: &Path\)[\s\S]*?format!\("\{stem\}\{REVIEW_SUFFIX\}"\)/,
  'paper.pdf must own paper_review.json.',
);
assert.match(
  readme,
  /paper_review\.json/,
  'The README must name the per-file sidecar.',
);
assert.doesNotMatch(
  readme,
  /\.notes\.md/,
  'The README must not still describe <stem>.notes.md.',
);

// The fixtures the smoke test opens, one per kind the viewer claims to show.
for (const fixture of [
  'tests/fixtures/hello.pdf',
  'tests/fixtures/three-pages.pdf',
  'tests/fixtures/dense-page.pdf',
  'tests/fixtures/jbig2.pdf',
  'tests/fixtures/jpeg2000.pdf',
  'tests/fixtures/swatch.png',
  'tests/fixtures/large-figure.png',
  'tests/fixtures/notes.md',
  'tests/fixtures/review-parity.md',
  'tests/fixtures/code.md',
]) {
  await access(fixture);
}

// The README must name the runtime it actually ships.
const vendored = version.match(/Version:\s*(\S+)/)?.[1];
assert.ok(vendored, 'src/vendor/PDFJS_VERSION must record a version.');
for (const source of [
  pdfCoreSource,
  worker,
  pdfViewerSource,
]) {
  assert.equal(source.match(/pdfjsVersion = (\S+)/)?.[1], vendored,
    'Core, worker, and viewer must match the recorded PDF.js version.');
}
// Coloured code blocks: the fence tags, the budgets, and text that stays the same.
{
  const unescape = (html) => html.replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
  const block = (tag, text) => ({
    classList: tag ? [`language-${tag}`] : [],
    textContent: text,
    html: null,
    anchors: [{ className: 'src' }],
    kept: null,
    querySelectorAll(selector) { assert.equal(selector, '.src'); return this.anchors; },
    prepend(...nodes) { this.kept = nodes; },
    set innerHTML(html) { this.html = html; this.textContent = unescape(html); this.kept = null; },
  });
  const run = (...codes) => colourCode({ querySelectorAll: (selector) => {
    assert.equal(selector, 'pre > code', 'Only fenced blocks are coloured, never inline code.');
    return codes;
  } });
  const source = 'def f(x):\n    return "a<b" + str(1) # & done\n';

  const python = block('python', source);
  const untagged = block(null, source);
  const unknown = block('ruby', source);
  const inherited = block('Python', source);
  run(python, untagged, unknown, inherited);
  assert.match(python.html, /<span class="hljs-keyword">def<\/span>/, 'A tagged Python block gets hljs spans.');
  assert.equal(python.textContent, source, 'Colouring must not change the text.');
  assert.deepEqual(python.kept, python.anchors, 'The line anchor must stay in a coloured block, or review links lose their line.');
  for (const plain of [untagged, unknown, inherited]) {
    assert.equal(plain.html, null, 'An untagged, unknown or mis-cased tag stays plain.');
  }

  const big = block('python', 'x = 1\n'.repeat(BLOCK_LIMIT / 6 + 1));
  assert.ok(big.textContent.length > BLOCK_LIMIT);
  const edge = block('python', 'x'.repeat(BLOCK_LIMIT));
  run(big, edge);
  assert.equal(big.html, null, 'A block over 64 KiB stays plain.');
  assert.notEqual(edge.html, null, 'A block of exactly 64 KiB is coloured.');

  const size = BLOCK_LIMIT - 1;
  const blocks = Array.from({ length: Math.ceil(DOCUMENT_LIMIT / size) + 2 }, () => block('python', 'x = 1\n'.repeat(1).padEnd(size, ' ')));
  run(...blocks);
  const coloured = blocks.filter((b) => b.html !== null).length;
  assert.equal(coloured, Math.ceil(DOCUMENT_LIMIT / size), 'Colouring stops once 512 KiB of code is used.');
  assert.ok(blocks.slice(coloured).every((b) => b.html === null), 'Blocks after the budget stay plain.');

  const lang = (tag) => `language-${tag}`;
  const rustTags = [...main.matchAll(/^\s+"language-([\w+-]+)",$/gm)].map((m) => m[1]);
  assert.deepEqual(rustTags.slice().sort(), Object.keys(TAGS).sort(),
    'The Rust sanitizer and src/code-colour.mjs must name the same fence tags.');
  for (const tag of rustTags) {
    const probe = block(tag, 'x = 1\n');
    run(probe);
    assert.notEqual(probe.html, null, `${lang(tag)} must reach a registered grammar.`);
  }
  assert.match(app, /^import \{ colourCode \} from '\.\/code-colour\.mjs';$/m);
  assert.match(app, /embedMarkdownImages\(ui\.markdown, file\.revision\);\n\s+colourCode\(ui\.markdown\);/,
    'Colour runs on the fresh article, before anything reads its blocks or paginates it.');
  assert.doesNotMatch(app, /colourCode\(ui\.markdownRaw\)/, 'Raw mode is never coloured.');

  const vendorList = await readFile('src/vendor/highlightjs/VERSION', 'utf8');
  const hashes = [...vendorList.matchAll(/^ {2}([0-9a-f]{64}) {2}(\S+)$/gm)];
  assert.equal(hashes.length, 19, 'VERSION lists the licence, the core and 17 grammars.');
  for (const [, hash, file] of hashes) {
    const actual = createHash('sha256').update(await readFile(`src/vendor/highlightjs/${file}`)).digest('hex');
    assert.equal(actual, hash, `${file} must match its VERSION hash.`);
  }
}

// Code token colours are defined in every mode and are readable on the code background (WCAG AA).
{
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const tokens = ['keyword', 'built-in', 'type', 'literal', 'number', 'string', 'comment', 'meta',
    'title', 'params', 'variable', 'attr', 'symbol', 'section', 'addition', 'deletion'];
  const backgrounds = [...styles.matchAll(/--md-code-bg: (#[0-9a-f]{6})/g)];
  assert.equal(backgrounds.length, 4, 'Day, night, sepia and print each set the code background.');
  const worst = [];
  for (const { index, 1: bg } of backgrounds) {
    const open = styles.lastIndexOf('{', index);
    const rule = styles.slice(open, styles.indexOf('}', index));
    const colours = Object.fromEntries([...rule.matchAll(/--md-code-([a-z-]+): (#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
    delete colours.bg;
    assert.deepEqual(Object.keys(colours).sort(), tokens.slice().sort(), `Every mode defines every token (background ${bg}).`);
    const ratios = Object.entries(colours).map(([name, colour]) => [name, ratio(colour, bg)]);
    const [name, low] = ratios.reduce((a, b) => (b[1] < a[1] ? b : a));
    assert.ok(low >= 4.5, `${name} on ${bg} is ${low.toFixed(2)}:1, below 4.5:1.`);
    worst.push(`${bg} ${low.toFixed(2)}`);
  }
  console.log(`Code colour contrast, lowest per background: ${worst.join(', ')}`);
  for (const token of tokens) {
    assert.match(styles, new RegExp(`\\.hljs-[\\w-]+[^{]*\\{[^}]*var\\(--md-code-${token}\\)`),
      `A .hljs rule must use --md-code-${token}.`);
  }
}

const viewerCss = await readFile('src/vendor/pdfjs/web/pdf_viewer.css', 'utf8');
for (const match of viewerCss.matchAll(/url\(["']?(images\/[^)'"\s]+)["']?\)/g)) {
  await access(`src/vendor/pdfjs/web/${match[1]}`);
}
assert.ok(
  readme.includes(vendored),
  `README.md must mention the vendored PDF.js version (${vendored}).`,
);

const packageInfo = JSON.parse(await readFile('package.json', 'utf8'));
const rustVersion = cargo.match(/^version = "([^"]+)"/m)?.[1];
assert.equal(packageInfo.version, config.version, 'Frontend and bundle versions must agree.');
assert.equal(rustVersion, config.version, 'Rust and bundle versions must agree.');
const releaseTag = process.env.GITHUB_REF?.match(/^refs\/tags\/v(.+)$/)?.[1];
if (releaseTag) {
  assert.equal(releaseTag, config.version, 'The release tag must match the built version.');
}

// The review composer closes from anywhere: Esc whatever has focus, the ×,
// Cancel, and a click outside it while it is empty.
{
  const state = { pendingNote: { quote: 'q' }, pendingNotePdf: {} };
  const ui = { noteBox: { hidden: false }, noteText: { value: 'draft' } };
  let chromeHidden = false;
  let released = null;
  const close = appFunction('closeNoteBox', 'let noteSaveInFlight', {
    state, ui, hideReviewChrome: () => { chromeHidden = true; }, releaseFocus: (box) => { released = box; },
  });
  close();
  assert.equal(ui.noteBox.hidden, true);
  assert.equal(ui.noteText.value, '');
  assert.equal(state.pendingNote, null);
  assert.equal(state.pendingNotePdf, null);
  assert.ok(chromeHidden);
  assert.equal(released, ui.noteBox, 'Closing gives the focus back, so the next shortcut works.');
  const keydown = app.slice(app.indexOf("window.addEventListener('keydown'"));
  const escape = keydown.indexOf("key === 'escape' && !ui.noteBox.hidden");
  assert.ok(escape > 0 && escape < keydown.indexOf('const dockKeys'),
    'Esc must close the composer before any other key handling, even from a menu.');
  assert.match(app, /ui\.noteCancel\.addEventListener\('click', \(\) => closeNoteBox\(\)\)/);
  assert.match(app, /ui\.noteClose\.addEventListener\('click', \(\) => closeNoteBox\(\)\)/);
  assert.match(app, /!ui\.noteBox\.hidden && !ui\.noteText\.value\.trim\(\)\) \{\n\s*closeNoteBox\(\);/,
    'A click outside closes only an empty composer.');
  assert.match(page, /id="noteClose"[^>]*aria-label="Close without saving"/);
  assert.match(page, /<button id="noteCancel" type="button">Cancel<\/button>/);
}

// Ctrl+Z undoes the newest change to the file on screen, and only that file's.
{
  const ran = [];
  const context = {
    state: { file: { path: 'a.md' } },
    undoStack: [
      { path: 'a.md', label: 'one', run: async () => ran.push('a1') },
      { path: 'b.md', label: 'two', run: async () => ran.push('b1') },
      { path: 'a.md', label: 'three', run: async () => { ran.push('a2'); throw new Error('gone'); } },
    ],
    statuses: [],
  };
  context.setStatus = (message) => context.statuses.push(message);
  const undo = appFunction('undoLast', '/// Put a removed review back', context);
  assert.equal(await undo(), true);
  assert.deepEqual(ran, ['a2']);
  assert.match(context.statuses[0], /Could not undo three/);
  assert.equal(await undo(), true);
  assert.deepEqual(ran, ['a2', 'a1']);
  assert.equal(await undo(), false, 'Another file’s change is not undone here.');
  assert.equal(context.undoStack.length, 1);
  const limited = { undoStack: [], UNDO_LIMIT: 2 };
  const push = appFunction('pushUndo', '/// Undo the newest change', limited);
  for (const label of ['x', 'y', 'z']) push({ path: 'a.md', label });
  assert.deepEqual(limited.undoStack.map((entry) => entry.label), ['y', 'z'],
    'The stack keeps the newest entries.');
}

// An agent fixes reviews one by one and edits the text around the others.
// Every open review must still be found afterwards, at its own text.
{
  const before = normalizeReviewText(`
    The boundary layer separates early because the adverse pressure gradient is strong.
    We measure the wall shear stress with hot-film sensors at twelve stations.
    The wake is long and the vortex shedding frequency matches the Strouhal number.
    Results agree with the direct numerical simulation within five percent.
    The appendix lists every sensor and its calibration.`);
  const review = (quote) => {
    const start = before.indexOf(quote);
    return { quote, anchor: contextAt(before, start, start + quote.length) };
  };
  const shear = review('wall shear stress');
  const wake = review('the vortex shedding frequency');
  const agree = review('within five percent');
  const sensor = review('every sensor');
  const after = normalizeReviewText(`
    # A heading the agent added
    The boundary layer separates early: the adverse pressure gradient is very strong here.
    We measure the wall shear stress using calibrated hot-film sensors at twelve stations.
    The wake is long, and the vortex shedding frequency matches the Strouhal number.
    Results agree with the DNS of Smith et al. within five percent.
    The appendix lists each sensor and its calibration.`);
  for (const [name, item, quote] of [['shear', shear, 'wall shear stress'],
    ['wake', wake, 'the vortex shedding frequency'], ['agree', agree, 'within five percent']]) {
    const found = resolveMarkdownReview(after, item, { normalized: true });
    assert.equal(found.status, 'located', `${name}: edits around a quote must not lose it.`);
    assert.equal(after.slice(found.start, found.end), quote, `${name}: the mark is on its own text.`);
    assert.equal(found.moved, true, `${name}: a drifted review is flagged for healing.`);
    const healed = { quote, anchor: contextAt(after, found.start, found.end) };
    const again = resolveMarkdownReview(after, healed, { normalized: true });
    assert.equal(again.status, 'located');
    assert.equal(again.moved, undefined, `${name}: once healed, the context matches in full.`);
  }
  const changed = resolveMarkdownReview(after, sensor, { normalized: true });
  assert.equal(changed.status, 'changed', 'An edited quote is found between its old neighbours.');
  assert.equal(after.slice(changed.start, changed.end), 'each sensor');
  const repeated = 'see the figure above. see the figure below. and more text';
  const short = { quote: 'the figure', anchor: { prefix: 'nothing alike at all', suffix: 'nor here either' } };
  assert.equal(resolveMarkdownReview(repeated, short).status, 'ambiguous',
    'A repeated quote with no deciding context stays ambiguous.');
  const leaning = { quote: 'the figure', anchor: { prefix: 'please see', suffix: 'below. and more' } };
  const chosen = resolveMarkdownReview(repeated, leaning);
  assert.equal(chosen.status, 'located', 'The candidate whose context clearly agrees best wins.');
  assert.equal(chosen.start, repeated.lastIndexOf('the figure'));
  assert.equal(resolveReviewAnchor([{ page: 1, text: 'only ab here' }], 'ab', { prefix: 'wrong' }).status,
    'unlocated', 'A short quote needs agreeing context before it is taken.');
}

// A drifted open review is rewritten to where its quote stands now.
{
  const joined = 'new heading. the boundary layer separates early. the wake is long.';
  const start = joined.indexOf('separates early');
  const found = { start, end: start + 'separates early'.length };
  const context = {
    state: { markdownDigest: 'sha256:now' },
    ui: { markdown: {} },
    reviewStatus, contextAt, atRange: (lo, hi) => (lo === hi ? { line: lo } : { line: lo, end: hi }),
    lineNear: (node) => node.line,
  };
  const heal = appFunction('markdownHealPatch', 'let reviewHealTimer', context);
  const review = { id: 'r3', status: 'open', at: { line: 2 }, anchor: { prefix: 'old', suffix: 'old', documentRevision: 'sha256:then' } };
  const result = heal(review, joined, found, { line: 4 }, { line: 4 });
  assert.equal(result.id, 'r3');
  assert.deepEqual({ ...result.patch.at }, { line: 4 }, 'The lines follow the quote.');
  assert.equal(result.patch.anchor.prefix, 'new heading. the boundary layer');
  assert.equal(result.patch.anchor.documentRevision, 'sha256:now');
  assert.equal(result.expected.anchor, review.anchor, 'The write is a compare-and-swap on what was read.');
  assert.equal(result.expected.at, review.at);
  const settled = { ...review, at: { line: 4 }, anchor: { ...result.patch.anchor } };
  assert.equal(heal(settled, joined, found, { line: 4 }, { line: 4 }), null, 'A review in place is not rewritten.');
  assert.equal(heal({ ...review, status: 'applied' }, joined, found, { line: 4 }, { line: 4 }), null,
    'Only open reviews are healed; applied and resolved ones keep their record.');
}

// Direct edits map a rendered selection back to its Markdown source.
{
  const raw = '# Title\r\n\r\nThe wake is long and the\r\nwake is slow.\r\n\r\nA [link to the wake](x.md) here.\r\n';
  const lines = (n) => n;
  const span = sourceSpan(raw, lines(3), lines(3), 'long and the wake');
  assert.equal(raw.slice(span.start, span.end), 'long and the\r\nwake', 'A quote across a line break maps whole.');
  assert.equal(sourceSpan(raw, 3, 3, 'wake').error, 'repeated', 'A repeat within the paragraph is refused.');
  assert.equal(sourceSpan(raw, 6, 6, 'link to the wake here').error, 'markup', 'A quote across a link is refused.');
  const block = blockSpan(raw, 3, 3);
  assert.deepEqual([block.line, block.endLine], [3, 4], 'The paragraph runs to the next blank line.');
  assert.equal(raw.slice(block.start, block.end), 'The wake is long and the\r\nwake is slow.');
  const bold = formatEdit(raw, span, 'bold');
  assert.equal(bold.replacement, '**long and the\r\nwake**');
  const boldRaw = raw.slice(0, bold.start) + bold.replacement + raw.slice(bold.start + bold.expected.length);
  const inner = { start: bold.start + 2, end: bold.start + 2 + span.end - span.start };
  const unbold = formatEdit(boldRaw, inner, 'bold');
  assert.equal(unbold.removed, true, 'Bold on bold text removes it.');
  assert.equal(unbold.replacement, 'long and the\r\nwake');
  const italic = formatEdit(boldRaw, inner, 'italic');
  assert.equal(italic.removed, false, 'A star that is half of a bold pair is not italic.');
  assert.equal(formatEdit('a `b` c', { start: 3, end: 4 }, 'code').removed, true);
  assert.equal(formatEdit('a b c', { start: 2, end: 3 }, 'underline').replacement, '<u>b</u>');
  assert.throws(() => formatEdit('a', { start: 0, end: 1 }, 'blink'));
  const smart = 'It\'s -- here... "x"';
  const typographic = sourceSpan(smart, 1, 1, 'It’s – here… “x”');
  assert.equal(smart.slice(typographic.start, typographic.end), smart,
    'Smart quotes, dashes and ellipses map back to their source characters.');
  const delMid = deleteEdit('Say obrigado now.', sourceSpan('Say obrigado now.', 1, 1, 'obrigado'));
  assert.equal(
    'Say obrigado now.'.slice(0, delMid.start) + delMid.replacement + 'Say obrigado now.'.slice(delMid.start + delMid.expected.length),
    'Say now.',
    'Deleting a word mid-sentence tidies the adjacent space.',
  );
  const paren = parentheticalEdit('Say obrigado now.', sourceSpan('Say obrigado now.', 1, 1, 'obrigado'), 'thank you');
  assert.equal(paren.replacement, 'obrigado (thank you)', 'Parenthetical definition inserts term (explanation).');
  const figAdd = figureWidthEdit('![Wake](fig.png)\n', 1, 65);
  assert.equal(figAdd.replacement, '![Wake](fig.png){width=65%}');
  const figUpdate = figureWidthEdit('![Wake](fig.png){width=80%}\n', 1, 50);
  assert.equal(figUpdate.replacement, '![Wake](fig.png){width=50%}');
  assert.equal(sourceSpan('This is it.', 1, 1, 'is').start, 5, 'A selected word is not found inside a longer word.');
  assert.equal(sourceSpan('This', 1, 1, 'is').error, 'markup', 'A word found only inside a longer word is not a match.');
  assert.equal(sourceSpan('is_ready and is', 1, 1, 'is').start, 13, 'An underscore joins a word.');
  assert.equal(sourceSpan('two-dimensional flow', 1, 1, 'dimensional').error, 'markup', 'A dash joins a word.');
  assert.equal(sourceSpan('这是测试', 1, 1, '是测').start, 1, 'A selection inside unspaced text is found.');
  assert.equal(figureWidthEdit('![a](f.png){width = 80%}\n', 1, 50).replacement, '![a](f.png){width=50%}');
  assert.equal(figureWidthEdit('![a](f.png){width= 80% height=3}\n', 1, 50).replacement, '![a](f.png){width=50% height=3}');
  assert.equal(figureWidthEdit('![a](f.png){width= height = 3}\n', 1, 50).error, 'malformed-attribute', 'An empty width is not guessed at.');
  assert.equal(figureWidthEdit('![a](f.png){width=#id}\n', 1, 50).error, 'malformed-attribute', 'A width that holds a class is refused.');
  assert.equal(figureWidthEdit('![a](f.png){width=80%height=3}\n', 1, 50).error, 'malformed-attribute', 'A width glued to another key is refused.');
  assert.equal(figureWidthEdit('![a](f.png){width = 80% height = 3}\n', 1, 50).replacement, '![a](f.png){width=50% height = 3}', 'Other attributes keep their spacing.');
  assert.equal(figureWidthEdit('![a](f.png){title="a = b" width=5cm}\n', 1, 50).replacement, '![a](f.png){title="a = b" width=50%}', 'Quoted text stays; the size outside it changes.');
  assert.equal(figureWidthEdit('![a](f.png){alt="a width=5cm extra" width=40%}\n', 1, 50).replacement, '![a](f.png){alt="a width=5cm extra" width=50%}', 'A width inside quotes is not the size.');
  assert.equal(figureWidthEdit('![a](f.png){alt="a width=5cm extra"}\n', 1, 50).replacement, '![a](f.png){width=50% alt="a width=5cm extra"}', 'A width only inside quotes gets a new one.');
  assert.equal(figureWidthEdit('![a](f.png){title=“a width=5cm” width=40%}\n', 1, 50).replacement, '![a](f.png){title=“a width=5cm” width=50%}', 'Typographic quotes are masked too.');
  assert.equal(figureWidthEdit('![a](f.png){alt="a width=5cm width=40%}\n', 1, 50).error, 'malformed-attribute', 'An unclosed quote is refused.');
  assert.equal(figureWidthEdit('![a](f.png){alt="a \\"b width=5cm\\" c"}\n', 1, 50).replacement, '![a](f.png){width=50% alt="a \\"b width=5cm\\" c"}', 'An escaped quote does not end the quoted text.');
  assert.equal(figureWidthEdit('![a](f.png){width=12pt}\n', 1, 50).replacement, '![a](f.png){width=50%}', 'Points are a unit the renderer reads.');
  assert.equal(figureWidthEdit('![a](f.png){width=50.5%}\n', 1, 50).replacement, '![a](f.png){width=50%}', 'A decimal size is a plain size.');
  assert.equal(figureWidthEdit('![a](img(1).png)\n', 1, 50).replacement, '![a](img(1).png){width=50%}');
  assert.equal(figureWidthEdit('![a](f.png){width= height=3}\n', 1, 50).error, 'malformed-attribute');
  assert.equal(figureWidthEdit('![a](f.png){max-width=10}\n', 1, 50).replacement, '![a](f.png){width=50% max-width=10}');
  assert.equal(figureWidthEdit('![a](a.png) and ![b](b.png)\n', 1, 50).error, 'several-images', 'Two images in one paragraph are not guessed at.');
  assert.equal(parentheticalEdit('Say obrigado now.', sourceSpan('Say obrigado now.', 1, 1, 'obrigado'), 'thank\n\nyou').replacement,
    'obrigado (thank you)', 'A parenthetical definition stays on one line.');
}
assert.match(app, /if \(key === 'escape' && !ui\.editBox\.hidden\)/, 'Esc closes the edit box.');
assert.match(app, /expectedDigest: next, start, expectedText: replacement, replacement: expected/,
  'Undoing a direct edit writes the inverse against the digest the edit produced.');

// Every review action the agent can read is offered in the menus.
for (const action of REVIEW_ACTIONS) {
  assert.match(page, new RegExp(`<option value="${action}">`), `${action} is in a review menu.`);
}

// machine-made type: every face the menus offer is declared, and Settings
// mirrors the toolbar menus and keeps its own preferences.
for (const [value, family] of [['weft', 'machine-made Weft'], ['mm-sans', 'machine-made Sans'], ['heddle', 'machine-made Heddle']]) {
  assert.match(page, new RegExp(`<option value="${value}">`), `${value} is in the font menu.`);
  assert.match(styles, new RegExp(`#markdown\\[data-font="${value}"\\] \\{\\s*--article-font: "${family}"`));
  assert.match(styles, new RegExp(`@font-face \\{\\s*font-family: "${family}";`), `${family} has a font face.`);
}
assert.match(page, /<option value="mm-sans">mm Sans<\/option>/, 'Settings offers the interface fonts.');
// Monaspace: each face is declared, offered for the body text and for code.
for (const face of ['Neon', 'Argon', 'Xenon', 'Radon', 'Krypton']) {
  const value = `monaspace-${face.toLowerCase()}`;
  assert.match(styles, new RegExp(`@font-face \\{\\s*font-family: "Monaspace ${face}";`), `Monaspace ${face} has a font face.`);
  assert.match(styles, new RegExp(`#markdown\\[data-font="${value}"\\] \\{\\s*--article-font: "Monaspace ${face}"`));
  assert.match(styles, new RegExp(`:root\\[data-code-font="${value}"\\] \\{ --code-font: "Monaspace ${face}"`));
  assert.equal((page.match(new RegExp(`<option value="${value}">Monaspace ${face}</option>`, 'g')) || []).length, 2,
    `Monaspace ${face} is in the Markdown font menu and the code font menu.`);
}
assert.ok(styles.split('\n').filter((line) => line.includes('ui-monospace')).every((line) => line.includes('--code-font:')),
  'Every monospace stack goes through --code-font.');

// The Markdown font menu is clustered: TeX, System, Monaspace, then machine-made.
{
  const menu = page.slice(page.indexOf('<select id="mdFont"'), page.indexOf('</select>', page.indexOf('<select id="mdFont"')));
  const groups = [...menu.matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['TeX', 'System', 'Monaspace (GitHub)', 'machine-made'], 'Font menu groups are in order.');
}

// Review card buttons: the JS list and the Rust list are the same words, and a
// one-choice group (scope, tone) swaps rather than stacks.
{
  const rust = await readFile('src-tauri/src/main.rs', 'utf8');
  const block = rust.slice(rust.indexOf('const REVIEW_REQUESTS'), rust.indexOf('];', rust.indexOf('const REVIEW_REQUESTS')));
  assert.deepEqual([...block.matchAll(/\("([a-z]+:[a-z]+)",/g)].map((m) => m[1]), REVIEW_REQUESTS, 'Rust and JS requests match.');
  const statuses = rust.slice(rust.indexOf('const REVIEW_STATUSES'), rust.indexOf(';', rust.indexOf('const REVIEW_STATUSES')));
  assert.deepEqual([...statuses.matchAll(/"([a-z]+)"/g)].map((m) => m[1]), REVIEW_STATUSES, 'Rust and JS review statuses match.');
  assert.equal(reviewStatus({ status: 'question' }), 'question', 'A review waiting on the reader keeps its status.');
  for (const ask of ['why', 'how', 'more', 'example', 'source', 'derive']) {
    const line = block.match(new RegExp(`\\("ask:${ask}", "([^"]+)"\\)`))?.[1] ?? '';
    assert.ok(!/^(explain|give)\b/.test(line), `ask:${ask} asks for a rewrite of the text, not an answer: ${line}`);
  }
  const readme = await readFile('README.md', 'utf8');
  assert.ok(!readme.includes('the answer goes in the done note'), 'The README says an Ask means rewrite the text.');
  for (const command of ['brief', 'next', 'done', 'ask', 'add', 'relocate']) {
    assert.ok(readme.includes(`pdf-next reviews ${command} `), `The README documents reviews ${command}.`);
  }
  let picked = toggleRequest([], 'scope:phrase');
  picked = toggleRequest(picked, 'ask:why');
  picked = toggleRequest(picked, 'scope:section');
  assert.deepEqual(picked, ['ask:why', 'scope:section'], 'Scope takes one choice, kept in menu order.');
  assert.deepEqual(toggleRequest(picked, 'ask:why'), ['scope:section'], 'A second click turns a button off.');
  assert.deepEqual(reviewRequests({ requests: ['tone:jfm', 'ask:nope', 'ask:how'] }), ['ask:how', 'tone:jfm'], 'Unknown words are left out of the view.');
  assert.equal(requestsLabel(['ask:why', 'scope:paragraph']), 'Why? · Paragraph');
  assert.equal(REQUEST_GROUPS.map((g) => g.group).join(','), 'ask,change,scope,tone');
  assert.match(app, /chosenAction === 'improve' && requests\.length && !comment \? 'request'/, 'Buttons alone save a request.');
}

// Panes: dockview is vendored and loads before the app; its tabs drag with
// pointer events (HTML5 drops never arrive on Windows, where the window takes
// file drops); every split, merge and move path is wired.
await assert.doesNotReject(access('src/vendor/dockview/dockview-core.min.noStyle.js'), 'dockview must be vendored.');
await assert.doesNotReject(access('src/vendor/dockview/dockview.css'), 'dockview styles must ship as a file: the app CSP blocks the <style> tag the styled build injects.');
assert.match(indexHtml, /href="\.\/vendor\/dockview\/dockview\.css"/, 'index.html must link the dockview stylesheet.');
await assert.doesNotReject(access('src/vendor/dockview/LICENSE.md'), 'dockview licence must be vendored.');
assert.match(page, /<script src="\.\/vendor\/dockview\/dockview-core\.min\.noStyle\.js"><\/script>\s*<script type="module" src="\.\/smoke\.mjs">/,
  'dockview loads before the modules.');
{
  const panesSource = await readFile('src/panes.mjs', 'utf8');
  assert.match(panesSource, /dndStrategy: 'pointer'/, 'Tabs drag with pointer events.');
  assert.match(app, /key === 'd' \|\| key === 'e'\)\) \{\s*event\.preventDefault\(\);\s*void splitPane\(key === 'd' \? 'right' : 'bottom'\)/, 'Ctrl+Shift+D and E split.');
  assert.match(app, /function activateTab[\s\S]*?freezeLivePane\(\);[\s\S]*?if \(panes\.active\) panes\.mount\(tab\.path\)/, 'Switching tabs leaves a copy and moves the live view.');
  assert.match(app, /panes\.visible\(\)\.includes\(path\)\) \{[\s\S]*?await fillPane\(path, revision\)/, 'A copy follows its file.');
  assert.ok(!/markdownStageSplit|splitDivider/.test(page), 'The old split view is gone.');
  // Panes that are not live: their own PDF viewer on the one worker, freed
  // whenever a copy leaves its pane; review marks; a drag that goes on live.
  const viewers = await readFile('src/pane-viewers.mjs', 'utf8');
  assert.match(app, /const paneViewers = createPaneViewers\(\{\s*load: loadPdf,/, 'Pane viewers load through the app loader.');
  assert.match(app, /function loadPdf\(url\) \{\s*return getDocument\(\{[\s\S]*?worker: pdfWorker,/, 'Pane viewers share the one worker.');
  assert.match(viewers, /dispose\(\) \{[\s\S]*?setDocument\(null\)[\s\S]*?abort\.abort\(\);[\s\S]*?task\?\.destroy\(\)/,
    'A pane viewer drops its pages, its listeners and its document.');
  assert.match(viewers, /viewer\.setDocument\(pdf\);\s*changes\?\.load\(pdf, path\);\s*void previous\?\.destroy\(\);/, 'A pane reload destroys the document it replaces.');
  assert.match(viewers, /addEventListener\('pane-detached', \(\) => \{\s*if \(viewers\.get\(path\) === viewer\) drop\(path\);/,
    'A viewer goes with its copy.');
  assert.match(panesSource, /const detach = \(element\) => \{[\s\S]*?new Event\('pane-detached'\)/, 'Panes say when a copy leaves.');
  for (const site of [/onDidRemovePanel\(\(removed\) => \{\s*detach\(/, /for \(const element of bodies\.values\(\)\) detach\(element\);/, /const element = body\(path\);\s*detach\(element\);\s*element\.append\(stage\)/]) {
    assert.match(panesSource, site, 'Closing a tab, leaving panes and going live free the copy.');
  }
  assert.match(app, /function watchVisiblePanes\(\) \{[\s\S]*?paneViewers\.keep\(paths\);/, 'A pane showing another file frees its viewer.');
  assert.match(app, /if \(paneViewers\.reload\(path, url\)\) \{\s*paneViewers\.setReviews\(path, reviews\);/, 'A PDF pane follows its file and its reviews.');
  assert.match(app, /paintMarkdownCopy\(article, reviews,/, 'A Markdown copy shows its review marks.');
  assert.match(app, /paneViewers\.cleanup\(\);\s*try \{\s*await state\.document\?\.cleanup\(\);/, 'A hidden window frees pane caches too.');
  assert.match(viewers, /cover\.addEventListener\('pointerdown', \(event\) => \{\s*event\.preventDefault\(\);\s*dragIntoLive\(event, onPick\);/,
    'A press on a copy makes it live and the drag goes on as a selection.');
}

// Every version has its CHANGELOG.md section before it can be released, in
// the style of Claude Code's changelog: version headings, flat bullets that
// start with Added, Fixed, Improved or Changed (or a platform prefix).
{
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const changelog = await readFile('CHANGELOG.md', 'utf8');
  assert.ok(changelog.startsWith('# Changelog\n'), 'CHANGELOG.md starts with its title.');
  const start = changelog.indexOf(`## ${version}\n`);
  assert.ok(start >= 0, `CHANGELOG.md has a section for ${version}.`);
  const section = changelog.slice(start).split(/\n## /)[0].split('\n').slice(1).filter((line) => line.trim());
  assert.ok(section.length > 0, `The ${version} section has entries.`);
  for (const line of section) {
    assert.match(line, /^- ((Added|Fixed|Improved|Changed|Removed) |(Windows|macOS|Linux): )/, `Changelog entry style: ${line}`);
  }
}

// The wheel steps through the toolbar menus and zooms over the zoom controls.
assert.match(app, /function wireMenuWheel\(\)[\s\S]*?#bar select, #settingsPanel select'/,
  'Toolbar and Settings menus take the wheel.');
assert.match(app, /control === ui\.zoom \|\| control === ui\.zoomIn \|\| control === ui\.zoomOut\) \{\s*stepZoom\(direction\)/,
  'The wheel over zoom zooms through the preset ladder.');

// Ctrl+U with text selected in rendered Markdown formats it (or says why it
// cannot) and never falls through to the raw view.
assert.match(app, /const selectedPane = formatKey[\s\S]*?renderedMarkdownSelection\(\)[\s\S]*?if \(selectedPane\) \{[\s\S]*?return;\s*\}\s*if \(\(event\.ctrlKey \|\| event\.metaKey\) && key === 'u'\)/,
  'A Markdown selection is handled before Ctrl+U toggles the raw view.');
assert.match(page, /<strong>pdf-next<\/strong> by machine-made/, 'About names the maker.');
assert.match(page, /<summary>Details: what pdf-next is built with<\/summary>/, 'About lists what pdf-next is built with.');
assert.ok(page.includes(`PDF.js ${vendored}`),
  'The PDF.js version in About is the vendored one.');
for (const name of ['Tauri', 'pulldown-cmark', 'ammonia', 'math-core', 'highlight.js', 'lopdf', 'picamatl']) {
  assert.match(readme, new RegExp(`\\[?${name.replace('.', '\\.')}`), `The README lists ${name}.`);
}
assert.equal(config.bundle.publisher, 'machine-made', 'machine-made publishes pdf-next.');
assert.equal(config.identifier, 'dev.frantz.pdf-next', 'The bundle identifier stays, so installs keep their settings.');
assert.match(nsisTemplate, /ReadRegStr \$4 SHCTX "Software\\Ricardo Frantz\\\$\{PRODUCTNAME\}" ""/,
  'An upgrade still finds the folder an older publisher recorded.');
{
  const root = { dataset: {} };
  const stored = new Map();
  const apply = appFunction('applyUiFont', 'function syncSettings', {
    UI_FONTS: ['system', 'mm-sans', 'weft'], ui: { setUiFont: { value: '' } },
    document: { documentElement: root },
    localStorage: { setItem: (key, value) => stored.set(key, value) },
  });
  apply('weft');
  assert.equal(root.dataset.uiFont, 'weft');
  assert.equal(stored.get('pdf-next.ui-font'), 'weft');
  apply('comic');
  assert.equal(root.dataset.uiFont, undefined, 'An unknown interface font falls back to the system one.');
}

// Figures: an image alone in its paragraph gets the figure class and, with
// captions on, its alt text as a caption the reader (and a review) can see.
{
  const made = [];
  const element = (tag, props = {}) => ({
    tag, className: '', textContent: '', children: [], attributes: {},
    classList: { names: new Set(), add(...n) { n.forEach((x) => this.names.add(x)); } },
    matches(selector) { return selector === tag || (selector === 'span.src' && props.src); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    append(child) { this.children.push(child); },
    ...props,
  });
  const figure = (alt, text = '') => {
    const image = element('img', { attributes: { alt } });
    const paragraph = element('p', { textContent: text });
    paragraph.children = [element('span', { src: true }), image];
    return paragraph;
  };
  const alone = figure('Wake behind the cylinder');
  const silent = figure('');
  const inline = figure('icon', 'Press the button');
  let caption = 'numbered';
  const context = {
    figureSetting: () => caption,
    document: { createElement: (tag) => { const node = element(tag); made.push(node); return node; } },
  };
  const mark = appFunction('markFigures', '/// The HTML arrives already sanitized', context);
  mark({ querySelectorAll: () => [alone, silent, inline] });
  assert.ok(alone.classList.names.has('md-figure') && alone.classList.names.has('has-caption'));
  assert.equal(alone.children.at(-1).textContent, 'Wake behind the cylinder', 'The alt text is the caption.');
  assert.ok(silent.classList.names.has('md-figure') && !silent.classList.names.has('has-caption'),
    'A figure without alt text has no caption and takes no number.');
  assert.equal(inline.classList.names.size, 0, 'An image inside text is not a figure.');
  caption = 'off';
  const bare = figure('Wake');
  mark({ querySelectorAll: () => [bare] });
  assert.equal(bare.children.length, 2, 'Captions off adds no text.');
  assert.match(styles, /#markdown\[data-fig-caption="numbered"\] \.md-caption::before \{\s*content: "Figure " counter\(figure\) "\. ";/);
  assert.match(styles, /#markdown\[data-fig-width="75"\] p\.md-figure > img:not\(\[width\]\)/,
    'A size written in the Markdown wins over the Settings width.');
  assert.match(app, /closest\('img\[data-doc\]'\)[\s\S]*?isCollapsed[\s\S]*?openPath\(image\.dataset\.doc\)/,
    'A plain click opens a figure in its own tab; a selection does not.');
}

// Review UI: before/after of applied reviews (diff-match-patch, vendored),
// Ask means rewrite, and the agent's questions answered from the panel.
{
  await assert.doesNotReject(access('src/vendor/diff-match-patch/diff_match_patch.mjs'), 'diff-match-patch must be vendored.');
  await assert.doesNotReject(access('src/vendor/diff-match-patch/LICENSE'), 'diff-match-patch licence must be vendored.');
  const list = await readFile('src/vendor/diff-match-patch/VERSION', 'utf8');
  const hashes = [...list.matchAll(/^ {2}([0-9a-f]{64}) {2}(\S+)$/gm)];
  assert.equal(hashes.length, 2, 'VERSION lists the licence and the module.');
  for (const [, hash, file] of hashes) {
    const actual = createHash('sha256').update(await readFile(`src/vendor/diff-match-patch/${file}`)).digest('hex');
    assert.equal(actual, hash, `${file} must match its VERSION hash.`);
  }
  assert.match(await readFile('src/review-diff.mjs', 'utf8'), /from '\.\/vendor\/diff-match-patch\/diff_match_patch\.mjs'/);
  assert.match(app, /^import \{ diffView, passageSource, passageText, wordDiff \} from '\.\/review-diff\.mjs';$/m);
  assert.match(readme, /\[diff-match-patch\]\(https:\/\/github\.com\/google\/diff-match-patch\) \| 1\.0\.5 \|[^\n]*\| Apache-2\.0 \|/,
    'The README lists diff-match-patch with its version and licence.');
  assert.ok(page.includes('diff-match-patch 1.0.5') && page.includes('diff-match-patch Apache-2.0'), 'About lists diff-match-patch.');

  const raw = 'Title\n\nFirst line of a\nparagraph here.\n\nNext.\n';
  assert.equal(passageText(raw, { line: 3 }), 'First line of a\nparagraph here.', 'before runs to the end of the paragraph.');
  assert.equal(passageText(raw, { line: 2, end: 3 }), 'First line of a\nparagraph here.', 'A blank first line is not kept.');
  assert.equal(passageSource(raw, {}), '', 'No line, no before.');
  assert.equal(passageSource('x'.repeat(BEFORE_LIMIT + 1), { line: 1 }), '', 'A passage too long for the store is not kept.');
  const diffs = wordDiff('The flow is steady here.', 'The flow is unsteady here, at high Re.');
  assert.deepEqual(diffs.filter(([op]) => op !== 0).map(([op, text]) => `${op}${text}`),
    ['-1steady', '1unsteady', '1, at high Re'], 'Whole words change, never halves of them.');
  assert.deepEqual(wordDiff('Second paragraph here.', 'Second paragraph is changed now.'),
    [[0, 'Second paragraph '], [-1, 'here'], [1, 'is changed now'], [0, '.']]);
  const view = diffView(diffs);
  assert.deepEqual([view.removed, view.added, view.changed, view.cut], [1, 4, true, false]);
  assert.equal(wordDiff('a'.repeat(50_000), 'b'), null, 'Huge texts are not compared.');
  const long = `${'word '.repeat(400)}old ${'tail '.repeat(400)}`;
  const big = diffView(wordDiff(long, long.replace('old', 'new')), { limit: 300 });
  assert.ok(big.parts.some((part) => part.kind === 'gap'), 'Long unchanged runs fold.');
  assert.ok(big.parts.reduce((sum, part) => sum + part.text.length, 0) <= 310, 'The rendered diff is capped.');
  assert.equal(diffView(wordDiff('a b c', 'a b c')).changed, false);
  const many = diffView(wordDiff('x '.repeat(3000), 'y '.repeat(3000)), { limit: 200 });
  assert.ok(many.cut && many.parts.reduce((sum, part) => sum + part.text.length, 0) <= 200, 'A big rewrite is cut.');

  assert.equal(reviewStatus({ status: 'question' }), 'question', 'question is a status of its own.');
  assert.match(page, /<option value="question">Question<\/option>/, 'The status filter has Question.');
  assert.match(app, /const before = picked\.kind === 'markdown' \? passageSource\(state\.markdownSource, picked\.at\) : '';[\s\S]*?\.\.\.\(before \? \{ before \} : \{\}\),\s*\};\s*const store = await invoke\('append_review'/,
    'A new Markdown review saves its passage as before.');
  assert.match(REQUEST_GROUPS[0].hint, /unclear[\s\S]*rewrites it so it answers/, 'The Ask row says Ask means rewrite.');
  assert.match(app, /patchReview\(review, \{ reply: text, status: 'open' \}, [^)]*\{\s*also: \{ question: review\.question \?\? null \},\s*\}\)/,
    'Send saves the reply and opens the item, checked against the question it answers.');
  assert.match(app, /const expected = \{\s*\.\.\.Object\.fromEntries\(Object\.keys\(patch\)[\s\S]*?\.\.\.also,\s*\};/,
    'A review patch expects each field it changes, plus the ones it names.');
  assert.match(app, /invoke\('update_review', \{ document: path, id: review\.id, expectedComment: old, comment \}\)[\s\S]*?patchReview\(current, \{ status: 'open' \}/,
    'Reopen writes its note into the comment, then reopens through the status path.');
  assert.match(styles, /\.review-row\.question \{/);
  assert.match(styles, /\.review-no\[data-review-status='question'\]/, 'A question shows on its highlight badge.');
  for (const token of ['--diff-del', '--diff-ins']) {
    assert.equal(styles.split(`${token}:`).length - 1, 3, `${token} is set for light, dark and the system dark mode.`);
  }
}

assert.match(app, /const quote = selection\.toString\(\)\.replace\(\/\\s\+\/g, ' '\)\.trim\(\);/,
  'A saved quote holds no newlines: the store and the agent view stay one line per item.');

// The command palette: fuzzy matching, ranking, and where Ctrl+K is typing.
{
  assert.equal(fuzzyScore('xyz', 'Split right'), null, 'A query that is not a subsequence does not match.');
  assert.deepEqual(fuzzyScore('neon', 'Monaspace Neon').positions, [10, 11, 12, 13],
    'A run at a word start beats letters scattered through the label.');
  assert.ok(fuzzyScore('sr', 'Split right').score > fuzzyScore('sr', 'Show the raw markdown').score,
    'Word starts close together beat word starts far apart.');
  assert.ok(fuzzyScore('pan', 'Back to one pane').score > fuzzyScore('pan', 'Open the review panel').score - 1);
  const commands = [
    { id: 'a', label: 'Split right', group: 'Panes' },
    { id: 'b', label: 'Font: Monaspace Neon', group: 'Markdown' },
    { id: 'c', label: 'Text size: 20 px', group: 'Markdown' },
    { id: 'd', label: 'Go to paper.pdf', group: 'Tabs' },
  ];
  assert.deepEqual(rankCommands('', commands, ['c', 'd']).map((r) => r.command.id), ['c', 'd', 'a', 'b'],
    'An empty query lists recent commands first, then the registry order.');
  assert.equal(rankCommands('mono neon', commands)[0].command.id, 'b', 'Each word of the query matches on its own.');
  assert.equal(rankCommands('size 20', commands)[0].command.id, 'c');
  assert.deepEqual(rankCommands('markdown', commands).map((r) => r.command.id).sort(), ['b', 'c'], 'The group is searched too.');
  assert.deepEqual(matchCommand('panes split', commands[0]).positions, [0, 1, 2, 3, 4], 'Only label letters are marked.');
  assert.equal(rankCommands('zzz', commands).length, 0);
  const many = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, label: `Go to chapter-${i}-notes.md`, group: 'Tabs' }));
  for (let i = 0; i < 5; i += 1) rankCommands('go ch 42', many);
  let fastest = Infinity;
  for (let i = 0; i < 20; i += 1) {
    const began = performance.now();
    rankCommands('go ch 42', many);
    fastest = Math.min(fastest, performance.now() - began);
  }
  assert.ok(fastest < 16, `Ranking 200 commands fits in a frame (${fastest.toFixed(1)} ms).`);
  assert.equal(rankCommands('go ch 42', many)[0].command.id, 't42');
  for (const [tagName, type, typing] of [['INPUT', 'text', true], ['INPUT', 'search', true], ['INPUT', 'number', true],
    ['INPUT', 'checkbox', false], ['TEXTAREA', '', true], ['SELECT', '', false], ['DIV', '', false], ['BUTTON', 'button', false]]) {
    assert.equal(isTextField({ tagName, type }), typing, `Ctrl+K in ${tagName} ${type}`);
  }
  assert.equal(isTextField({ tagName: 'DIV', isContentEditable: true }), true);
  assert.deepEqual(shortcutKeys('Ctrl+Shift+D', 'macos'), ['⌘', '⇧', 'D']);
  assert.deepEqual(shortcutKeys('Ctrl+Shift+D', 'windows'), ['Ctrl', 'Shift', 'D']);
  const fired = [];
  const select = { value: 'b', options: [{ value: 'a', textContent: 'A' }, { value: 'b', textContent: 'B' }, { value: 'custom', textContent: '?' }, { value: 'h', hidden: true, textContent: 'H' }],
    dispatchEvent: (event) => fired.push([event.type, select.value]) };
  const choices = selectChoices(select, { id: 'x', label: 'Thing', group: 'View' })();
  assert.deepEqual(choices.map((c) => [c.label, c.current]), [['Thing: A', false], ['Thing: B', true]],
    'A menu becomes one choice per visible option, with the current one marked.');
  choices[0].run();
  assert.deepEqual(fired, [['change', 'a']], 'A choice sets the menu and fires its change event, as a pick by hand does.');
  assert.deepEqual(selectChoices(select, { id: 'x', label: 'Thing', when: () => false })(), []);

  assert.match(app, /import \{ createPalette, isTextField, selectChoices \} from '\.\/palette\.mjs';/);
  assert.match(app, /key === 'k' && !isTextField\(event\.target\)\) \{\s*event\.preventDefault\(\);\s*palette\.toggle\(\);/,
    'Ctrl+K toggles the palette, but not while typing in a text field.');
  for (const call of ["splitPane('right')", 'setRaw(true)', 'toggleReviewPanel', 'printDocument', 'openFind', 'activateTab(index)',
    "dockTo('center')", 'movePaneFocus(direction)', 'applyDirectFormat(format)', 'toggleSettings(true)']) {
    assert.ok(app.slice(app.indexOf('const palette = createPalette'), app.indexOf("window.addEventListener('keydown'")).includes(call),
      `The palette calls ${call}, as the button or shortcut does.`);
  }
  for (const menu of ['ui.mdFont', 'ui.mdSize', 'ui.mdWidth', 'ui.setUiFont', 'ui.setCodeFont', 'ui.poll', 'ui.zoom', 'ui.pageView']) {
    assert.ok(app.includes(`selectChoices(${menu},`), `${menu} is offered as palette choices.`);
  }
  assert.match(page, /<button id="paletteOpen"[^>]*title="Command palette \(Ctrl\+K\)"/, 'Settings opens the palette.');
  assert.match(styles, /\.palette-box \{[^}]*background: var\(--widget\);/, 'The palette uses the theme tokens.');
  assert.match(styles, /@media print \{\s*#palette \{\s*display: none !important;/);
  assert.match(readme, /\*\*Command palette\*\*/);
  assert.match(readme, /`Ctrl\+K` command palette/);
}
// Finding your way (src/navigate.mjs): the sidebar, back and forward, link previews.
{
  const navigate = await readFile('src/navigate.mjs', 'utf8');
  assert.equal(linkDestination('#section.2'), 'section.2', 'A named destination comes back as its name.');
  assert.deepEqual(linkDestination(`#${escape(JSON.stringify([{ num: 5, gen: 0 }, { name: 'XYZ' }, 72, 700, null]))}`),
    [{ num: 5, gen: 0 }, { name: 'XYZ' }, 72, 700, null], 'An explicit destination comes back as its array.');
  assert.equal(linkDestination('#page=3'), null, 'A hash with parameters is not a destination.');
  assert.equal(linkDestination('#'), null);
  const doc = {
    numPages: 4,
    getDestination: async (name) => (name === 'eq' ? [{ num: 9, gen: 0 }, { name: 'XYZ' }, 100, 500, null] : null),
    getPageIndex: async () => 1,
    cachedPageNumber: () => null,
  };
  assert.deepEqual(await locateDestination(doc, 'eq'), { page: 2, explicit: [{ num: 9, gen: 0 }, { name: 'XYZ' }, 100, 500, null], top: 500, left: 100 });
  assert.deepEqual((await locateDestination(doc, [3, { name: 'FitH' }, 400]))?.page, 4, 'A page index destination lands on that page.');
  assert.equal(await locateDestination(doc, 'missing'), null, 'A destination that does not exist goes nowhere.');
  const line = (x, y, width, str = 'text') => ({ str, transform: [10, 0, 0, 10, x, y], width });
  const twoColumns = { items: [line(50, 490, 200), line(50, 478, 200), line(300, 490, 200), line(300, 478, 200)] };
  assert.deepEqual(columnAt(twoColumns, 500, 320), [300, 500], 'A preview of the right column takes that column.');
  assert.deepEqual(columnAt(twoColumns, 500, 60), [50, 250], 'And of the left column the left one.');
  assert.deepEqual(columnAt(twoColumns, 500, null), [50, 500], 'Without a left edge it takes the whole measure.');
  const numbered = { items: [line(80, 490, 200), line(80, 478, 300), line(450, 490, 20, '(1)')] };
  assert.deepEqual(columnAt(numbered, 500, 100), [80, 470], 'An equation number alone at the right is part of the column.');
  assert.equal(columnAt({ items: [] }, 500, 100), null);

  assert.match(page, /<aside id="outline" hidden aria-label="Outline and pages">/, 'The sidebar is off until asked for.');
  assert.match(page, /<div id="outlineTree" role="tree"/);
  assert.match(page, /<div id="outlineGrip" role="separator"[^>]*tabindex="0"/, 'The sidebar edge is a separator the keyboard can reach.');
  assert.match(page, /<div id="linkPreview" role="tooltip" hidden><\/div>/, 'A link preview is a tooltip.');
  assert.doesNotMatch(page, /id="toggleOutline"|id="outlineToggle"/, 'The sidebar has no toolbar button of its own.');
  assert.match(app, /import \{ createNavigator \} from '\.\/navigate\.mjs';/);
  for (const [label, shortcut] of [['Show the outline', 'Ctrl\\+Shift\\+O'], ['Hide the outline', 'Ctrl\\+Shift\\+O'], ['Back', 'Alt\\+←'], ['Forward', 'Alt\\+→']]) {
    assert.match(app, new RegExp(`label: '${label}', group: 'View', shortcut: '${shortcut}'`), `The palette offers ${label} with its shortcut.`);
  }
  for (const jump of [/case 'g':\n\s+nav\.push\(\);\n\s+ui\.markdownStage/, /case 'g':\n\s+nav\.push\(\);\n\s+pdfViewer\.currentPageNumber/,
    /if \(again \|\| !findPushed\) \{\n\s+nav\.push\(\);/, /async function applyTarget\(target\) \{[^}]*\}\n\s+nav\.push\(\);/]) {
    assert.match(app, jump, `A jump remembers where it started: ${jump}`);
  }
  assert.match(navigate, /linkService\.goToDestination = async/, 'Links in a PDF go through the navigator, which remembers the place.');
  assert.doesNotMatch(navigate, /scrollIntoView\(\{ block: 'nearest'/, 'The sidebar scrolls itself, never the panes behind it.');
  assert.match(navigate, /const THUMB_CACHE = \d+;/, 'The page pictures are bounded.');
  assert.match(styles, /#outline \{[^}]*background: var\(--chrome\);/, 'The sidebar uses the theme tokens.');
  assert.match(styles, /body\.outline-open #stage > #viewerContainer,\nbody\.outline-open #stage > #markdownStage \{\n\s+left: var\(--outline-width/,
    'The sidebar pushes the page instead of covering it.');
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\n\s+#linkPreview \{\n\s+animation: none;/, 'The preview does not fade in under reduced motion.');
  assert.match(readme, /### Find your way/);
  assert.match(readme, /`Ctrl\+Shift\+O` outline, `Alt\+←`\/`Alt\+→` back and forward/);
}
// Places: one store, newest first, capped, and a view update never reorders it.
{
  const map = new Map();
  const store = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  const file = (n) => ({ path: `/p/${n}.pdf`, name: `${n}.pdf`, kind: 'pdf' });
  for (let n = 0; n < PLACES_MAX + 20; n += 1) notePlace(file(n), null, { opened: true, now: n, store });
  assert.equal(readPlaces(store).length, PLACES_MAX, `At most ${PLACES_MAX} files are kept.`);
  assert.equal(recentPlaces(8, store)[0].path, `/p/${PLACES_MAX + 19}.pdf`, 'The file opened last comes first.');
  assert.equal(placeOf('/p/0.pdf', store), null, 'The oldest files are dropped first.');
  notePlace(file(100), { kind: 'pdf', page: 3 }, { now: 1e6, store });
  assert.deepEqual(placeOf('/p/100.pdf', store), { kind: 'pdf', page: 3 }, 'A view is kept per file.');
  assert.equal(readPlaces(store).findIndex((e) => e.path === '/p/100.pdf'), PLACES_MAX + 19 - 100, 'Saving a view does not move the file up the list.');
  assert.equal(readPlaces(store).find((e) => e.path === '/p/100.pdf').opened, 100, 'nor change when it was opened.');
  notePlace(file(100), null, { opened: true, now: 2e6, store });
  assert.deepEqual([recentPlaces(1, store)[0].path, placeOf('/p/100.pdf', store)?.page], ['/p/100.pdf', 3], 'Opening it again moves it up and keeps its place.');
  forgetPlace('/p/100.pdf', store);
  assert.equal(placeOf('/p/100.pdf', store), null, 'A forgotten file is gone.');
  map.set(PLACES_KEY, '{broken');
  assert.deepEqual(readPlaces(store), [], 'A damaged store reads as empty.');
  const full = { getItem: () => null, setItem() { throw new Error('quota'); } };
  notePlace(file(1), null, { store: full });
  assert.deepEqual([folderOf('/a/b/c.pdf'), folderOf('C:\\x\\y.md'), folderOf('/c.pdf')], ['/a/b', 'C:\\x', '/']);
  const now = Date.UTC(2026, 9, 30, 12);
  assert.deepEqual([0, 5, 180, 60 * 30, 60 * 24 * 3].map((minutes) => openedLabel(now - minutes * 60_000, now)),
    ['just now', '5 min ago', '3 h ago', 'yesterday', '3 days ago']);
}

// Ctrl+wheel and pinch: a notch is a 25% step, a pinch follows the fingers,
// and a fit within 3% is a detent.
{
  assert.equal(wheelFactor({ deltaY: -100 }), 1.25);
  assert.equal(wheelFactor({ deltaY: 120 }), 0.8);
  assert.equal(wheelFactor({ deltaY: -3, deltaMode: 1 }), 1.25, 'Lines count as pixels.');
  assert.ok(Math.abs(wheelFactor({ deltaY: -4 }) - Math.exp(0.04)) < 1e-12, 'A pinch delta is followed exactly.');
  assert.deepEqual([clampScale(10), clampScale(0.01), clampScale(0.05, 0.1)], [ZOOM_MAX, ZOOM_MIN, 0.1],
    'The zoom stays in range, or where it started when that was outside it.');
  assert.deepEqual(snapScale(1.47, { 'page-width': 1.5, 'page-fit': 1.2 }), { scale: 1.5, preset: 'page-width' });
  assert.deepEqual(snapScale(1.4, { 'page-width': 1.5 }), { scale: 1.4, preset: null }, 'Further away it does not snap.');
  assert.match(app, /pinchZoom\(window, \{ start: startPinch \}\)/, 'A pinch anywhere is caught, so the webview never zooms its own page.');
  assert.match(app, /label: 'Open recent…', group: 'File'[^\n]*palette\.open\('Open recent: '\)/, 'The palette opens the recent files.');
  assert.match(page, /<section id="recent"[^>]*hidden>/, 'The recent list starts hidden.');
  assert.match(readme, /remembers your place/i);
}
assert.doesNotMatch(app, /chip\.tabIndex = -1/, 'Tab reaches the review card buttons.');
assert.match(app, /comment\.setAttribute\('aria-label', 'Review comment'\)/, 'A review comment box has a name.');
assert.match(styles, /\.review-row \{[^}]*--fg-dim: var\(--review-dim\);/,
  'Dim text on a review row uses the colour that reads on every tint.');
assert.match(styles, /\.review-no \{[^}]*color: var\(--review-no-fg\);/, 'Review numbers keep their contrast in both themes.');
await access('tests/browser/run.mjs');

// 0.18: what a rebuild changed, colours that survive Night, panes that fill the window.
{
  const colours = await readFile('src/page-colors.mjs', 'utf8');
  const changes = await readFile('src/pdf-changes.mjs', 'utf8');
  const panesSource = await readFile('src/panes.mjs', 'utf8');
  assert.doesNotMatch(app, /pageColors/, 'Every webview draws plain pages; pdf-next recolours them itself.');
  assert.doesNotMatch(colours, /\.filter\s*=/, 'Recolouring uses blend modes WebKit draws, never ctx.filter.');
  assert.match(colours, /globalCompositeOperation = 'color';\s*context\.drawImage\(copy\.canvas, 0, 0\);/, 'Colours keep their hue in Night and Sepia.');
  assert.match(styles, /body\.mode-night \.pdfViewer \.canvasWrapper canvas:not\(\[data-recolored\]\)/, 'A page is never shown white before it is recoloured.');
  assert.match(changes, /export const CHANGE_BUDGET = \{ pages: [\d_]+, ms: [\d_]+ \}/, 'Background comparison has a page and time budget.');
  assert.match(app, /case '\.':\s*case ',':\s*stepChange\(key === '\.' \? 1 : -1\);/, '. and , go to the next and previous change.');
  assert.match(app, /label: 'Next change', group: 'View', shortcut: '\.'/, 'Next change is in the palette.');
  assert.match(app, /label: 'Fill the window with this pane', group: 'Panes', shortcut: 'Ctrl\+Shift\+M'/, 'Maximising a pane is in the palette.');
  assert.match(panesSource, /live\.api\.maximize\(\)/, 'Maximising uses dockview\'s own maximised group.');
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\) \{\s*#markdown \.changed\.changed-fade,\s*\.change-marks\.fading > i \{/, 'Without motion a change is marked without fading.');
  assert.match(readme, /`\.`\/`,` next and previous change/);
}

console.log(`Frontend contracts passed (PDF.js ${vendored}).`);

// The website: install lines that match the README, and a version the publish step fills in.
{
  const site = await readFile('site/index.html', 'utf8');
  const decoded = site.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  for (const line of [
    'brew install --cask machine-made/tap/pdf-next',
    'winget install RicardoFrantz.pdf-next',
    'curl -fsSL https://machine-made.github.io/pdf-next/pdf-next.asc',
    'echo "deb [signed-by=/etc/apt/keyrings/pdf-next.asc] https://machine-made.github.io/pdf-next stable main"',
  ]) {
    assert.ok(readme.includes(line) && decoded.includes(line), `The README and the website both say: ${line}`);
  }
  assert.ok(site.includes('{{version}}'), 'The website names the version through {{version}}, filled in by pages.yml.');
  for (const match of site.matchAll(/(?:src|href)="((?:shots|fonts)\/[^"]+|icon\.png)"/g)) await access(`site/${match[1]}`);
  // Every shot on the page is one tools/screenshots.mjs takes, so a release can
  // replace it; the committed ones are the fallback.
  const { OUTPUTS } = await import('./screenshots.mjs');
  const shown = new Set([...site.matchAll(/shots\/([\w.-]+)/g)].map((match) => match[1]));
  assert.ok(shown.size >= 5 && shown.has('social.png'), 'The website shows its screenshots and a social card.');
  for (const shot of shown) assert.ok(OUTPUTS.includes(shot), `site/index.html shows shots/${shot}, which tools/screenshots.mjs does not take.`);
  for (const shot of OUTPUTS) await access(`site/shots/${shot}`);
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  const pages = await readFile('.github/workflows/pages.yml', 'utf8');
  const release = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(ci, /node tools\/screenshots\.mjs --bin src-tauri\/target\/release\/pdf-next/, 'CI takes the screenshots in the app it built.');
  assert.match(pages, /node tools\/screenshots\.mjs/, 'A release retakes the website screenshots.');
  assert.match(pages, /concurrency:\s*\n\s*group: apt-repository/, 'The website never pushes to gh-pages while apt does.');
  assert.match(release, /website:\s*\n\s*needs: \[publish, apt\][\s\S]*?uses: \.\/\.github\/workflows\/pages\.yml/, 'release.yml publishes the website after apt.');
}
