// Finding your way in a document: the outline and pages sidebar, back and
// forward through jumps, and previews of internal links. The sidebar sits on
// the left of the stage, so with panes open it follows the live pane.

import { recolorCanvas } from './page-colors.mjs';

const WIDTH_KEY = 'pdf-next.outline-width';
const TAB_KEY = 'pdf-next.outline-tab';
const MIN_WIDTH = 160;
const MAX_WIDTH = 520;
const DEFAULT_WIDTH = 240;
const THUMB_WIDTH = 112;
const THUMB_CACHE = 48;
const HISTORY_MAX = 100;
const PREVIEW_DELAY = 400;
const PREVIEW_WIDTH = 440;
const PREVIEW_HEIGHT = 170;
const PREVIEW_CACHE = 6;
const HEADINGS = 'h1, h2, h3, h4';
const BLOCKS = '.footnote-definition, math[display="block"], li, p, figure, table, blockquote, pre, dd';

const stored = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Preference only.
  }
};
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
const free = (canvas) => {
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
};

/// Scroll `node` into view inside `scroller` only: scrollIntoView would also
/// move a pane or the stage behind it.
function reveal(scroller, node) {
  const outer = scroller.getBoundingClientRect();
  const inner = node.getBoundingClientRect();
  if (inner.top < outer.top) scroller.scrollTop -= outer.top - inner.top + 8;
  else if (inner.bottom > outer.bottom) scroller.scrollTop += inner.bottom - outer.bottom + 8;
}

/// Where a PDF destination lands: its page, and the top and left of the spot
/// in PDF units when the destination names them.
export async function locateDestination(doc, dest) {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : await dest;
    if (!Array.isArray(explicit)) return null;
    const [ref, fit, ...args] = explicit;
    const page = ref && typeof ref === 'object'
      ? doc.cachedPageNumber?.(ref) || (await doc.getPageIndex(ref)) + 1
      : Number.isInteger(ref) ? ref + 1 : null;
    if (!page || page > doc.numPages) return null;
    const name = fit?.name;
    const top = name === 'XYZ' ? args[1] : name === 'FitH' || name === 'FitBH' ? args[0] : name === 'FitR' ? args[3] : null;
    const left = name === 'XYZ' || name === 'FitR' ? args[0] : null;
    return { page, explicit, top: Number.isFinite(top) ? top : null, left: Number.isFinite(left) ? left : null };
  } catch {
    return null;
  }
}

/// The destination an annotation-layer link carries in its href, as PDF.js
/// wrote it there: a name, or an explicit destination as JSON.
export function linkDestination(href) {
  if (!href?.startsWith('#') || href.length < 2) return null;
  const text = unescape(href.slice(1));
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return text.includes('=') ? null : text;
}

/// The text column a destination sits in, in PDF units: what the lines just
/// below `top` cover, split where a gutter runs down several of them (an
/// equation number alone at the right is not a column). A destination's
/// `left` picks the column; without one, all of them.
export function columnAt(text, top, left) {
  const spans = [];
  for (const item of text?.items || []) {
    const x = item.transform?.[4];
    const y = item.transform?.[5];
    if (item.str?.trim() && y <= top + 4 && y >= top - 150) spans.push([x, x + item.width, Math.round(y)]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const columns = [];
  for (const [start, end, y] of spans) {
    const last = columns.at(-1);
    if (last && start <= last[1] + 6) {
      last[1] = Math.max(last[1], end);
      last[2].add(y);
    } else {
      columns.push([start, end, new Set([y])]);
    }
  }
  for (let i = columns.length - 1; i > 0; i -= 1) {
    if (columns[i][2].size < 2 || columns[i - 1][2].size < 2) {
      columns[i - 1][1] = Math.max(columns[i - 1][1], columns[i][1]);
      for (const y of columns[i][2]) columns[i - 1][2].add(y);
      columns.splice(i, 1);
    }
  }
  if (!columns.length) return null;
  const column = (left !== null && columns.find(([, end]) => end >= left - 4)) || [columns[0][0], columns.at(-1)[1]];
  return [column[0], column[1]];
}

export function createNavigator({
  file, pdf, viewer, linkService, container, markdown, markdownStage,
  capture, restore, focusPage, openLink, showRendered, colors, onResize, status,
}) {
  const el = (id) => document.getElementById(id);
  const sidebar = el('outline');
  const tree = el('outlineTree');
  const thumbsBox = el('outlineThumbs');
  const empty = el('outlineEmpty');
  const treeTab = el('outlineTabTree');
  const pagesTab = el('outlineTabPages');
  const grip = el('outlineGrip');
  const card = el('linkPreview');

  let open = false;
  let tab = stored(TAB_KEY) === 'pages' ? 'pages' : 'outline';
  let width = clamp(Number(stored(WIDTH_KEY)) || DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
  let built = null; // { path, kind, entries: [{ item, target, at }] }
  let buildSerial = 0;
  let current = null;
  let frame = 0;
  const toggled = new Map(); // path -> Map(key -> expanded), what the reader opened or closed

  const kind = () => file()?.kind;
  const fits = () => kind() === 'pdf' || kind() === 'markdown';
  const shown = () => open && fits();
  const pageTab = () => kind() === 'pdf' && (tab === 'pages' || (built?.kind === 'pdf' && !built.entries.length));

  let applied = '';
  function apply() {
    const on = shown();
    sidebar.hidden = !on;
    document.body.classList.toggle('outline-open', on);
    document.body.style.setProperty('--outline-width', `${width}px`);
    grip.setAttribute('aria-valuenow', String(width));
    if (applied !== `${on}:${width}`) {
      applied = `${on}:${width}`;
      onResize();
    }
  }

  function toggleOutline(on = !open) {
    open = Boolean(on);
    if (!open) {
      if (sidebar.contains(document.activeElement)) focusPage();
      freeThumbs();
    }
    apply();
    if (open) refresh();
  }

  // ── The outline ─────────────────────────────────────────────────────────

  async function pdfNodes(doc) {
    const outline = (await doc.getOutline().catch(() => null)) || [];
    let total = 0;
    const count = (items) => items.forEach((item) => {
      total += 1;
      count(item.items || []);
    });
    count(outline);
    const nodes = (items) => Promise.all(items.map(async (item) => ({
      title: item.title || 'Untitled',
      open: total <= 40 || item.count > 0,
      target: item.dest ? await locateDestination(doc, item.dest) : item.url ? { url: item.url } : null,
      children: await nodes(item.items || []),
    })));
    return nodes(outline);
  }

  function markdownNodes() {
    const root = { level: 0, children: [] };
    const stack = [root];
    markdown.querySelectorAll(HEADINGS).forEach((heading, index) => {
      const level = Number(heading.tagName[1]);
      while (stack.at(-1).level >= level) stack.pop();
      const node = { level, title: heading.textContent.trim() || 'Untitled', open: true, target: { heading: index }, children: [] };
      stack.at(-1).children.push(node);
      stack.push(node);
    });
    return root.children;
  }

  function renderNodes(nodes, level, prefix, into, entries, memory) {
    nodes.forEach((node, index) => {
      const key = `${prefix}/${index}:${node.title}`;
      const item = document.createElement('div');
      item.className = 'outline-item';
      item.setAttribute('role', 'treeitem');
      item.setAttribute('aria-level', String(level));
      item.tabIndex = -1;
      item.dataset.key = key;
      const row = document.createElement('div');
      row.className = 'outline-row';
      row.style.paddingLeft = `${4 + (level - 1) * 14}px`;
      const twisty = document.createElement('span');
      twisty.className = 'outline-twisty';
      twisty.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.className = 'outline-label';
      label.textContent = node.title;
      row.append(twisty, label);
      if (node.target?.page) {
        const number = document.createElement('span');
        number.className = 'outline-page';
        number.textContent = String(node.target.page);
        row.append(number);
      }
      item.append(row);
      entries.push({ item, target: node.target });
      if (node.children.length) {
        item.setAttribute('aria-expanded', String(memory.get(key) ?? node.open));
        const group = document.createElement('div');
        group.setAttribute('role', 'group');
        renderNodes(node.children, level + 1, key, group, entries, memory);
        item.append(group);
      }
      into.append(item);
    });
  }

  async function buildOutline() {
    const serial = ++buildSerial;
    const shownFile = file();
    const doc = shownFile.kind === 'pdf' ? pdf() : null;
    if (shownFile.kind === 'pdf' && !doc) return;
    const nodes = doc ? await pdfNodes(doc) : markdownNodes();
    if (serial !== buildSerial || file() !== shownFile || (doc && pdf() !== doc)) return;
    const path = shownFile.path;
    if (!toggled.has(path)) toggled.set(path, new Map());
    const entries = [];
    const fragment = document.createDocumentFragment();
    renderNodes(nodes, 1, '', fragment, entries, toggled.get(path));
    // One swap, with the scroll and the focus where they were: a rebuild
    // every second while you write must not make the list jump.
    const top = tree.scrollTop;
    const focused = tree.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    tree.replaceChildren(fragment);
    tree.scrollTop = top;
    built = { path, kind: shownFile.kind, entries };
    current = null;
    const again = focused && tree.querySelector(`[data-key="${CSS.escape(focused)}"]`);
    roam(again || entries[0]?.item);
    if (again) again.focus({ preventScroll: true });
    empty.textContent = shownFile.kind === 'pdf' ? 'This PDF has no outline.' : 'No headings in this file.';
    syncTabs();
    update();
  }

  const items = () => [...tree.querySelectorAll('[role="treeitem"]')];
  const visibleItems = () => items().filter((item) => !item.parentElement.closest('[aria-expanded="false"]'));
  const entryOf = (item) => built?.entries.find((entry) => entry.item === item);
  const parentItem = (item) => item.parentElement?.closest('[role="treeitem"]');

  function roam(item) {
    for (const other of tree.querySelectorAll('[role="treeitem"][tabindex="0"]')) other.tabIndex = -1;
    if (item) item.tabIndex = 0;
  }

  function focusItem(item) {
    roam(item);
    item.focus({ preventScroll: true });
    reveal(tree, item.querySelector('.outline-row'));
  }

  function setExpanded(item, on) {
    if (!item.hasAttribute('aria-expanded')) return;
    item.setAttribute('aria-expanded', String(on));
    toggled.get(built.path)?.set(item.dataset.key, on);
    if (!on && item.querySelector('[role="group"]').contains(document.activeElement)) focusItem(item);
    update();
  }

  function go(item) {
    const target = entryOf(item)?.target;
    if (!target) return;
    if (target.url) {
      openLink(target.url);
    } else if (target.heading !== undefined) {
      showRendered();
      const heading = markdown.querySelectorAll(HEADINGS)[target.heading];
      if (!heading) return;
      push();
      heading.scrollIntoView({ block: 'start' });
    } else if (target.page) {
      push();
      viewer.scrollPageIntoView({ pageNumber: target.page, destArray: target.explicit });
    }
    mark(item);
  }

  tree.addEventListener('click', (event) => {
    const item = event.target instanceof Element ? event.target.closest('[role="treeitem"]') : null;
    if (!item) return;
    roam(item);
    if (event.target.closest('.outline-twisty') && item.hasAttribute('aria-expanded')) {
      setExpanded(item, item.getAttribute('aria-expanded') !== 'true');
      return;
    }
    go(item);
  });

  tree.addEventListener('keydown', (event) => {
    const item = event.target instanceof Element ? event.target.closest('[role="treeitem"]') : null;
    if (!item || event.altKey || event.ctrlKey || event.metaKey) return;
    const visible = visibleItems();
    const at = visible.indexOf(item);
    const expanded = item.getAttribute('aria-expanded');
    let next = null;
    switch (event.key) {
      case 'ArrowDown': next = visible[at + 1]; break;
      case 'ArrowUp': next = visible[at - 1]; break;
      case 'Home': next = visible[0]; break;
      case 'End': next = visible.at(-1); break;
      case 'ArrowRight':
        if (expanded === 'false') setExpanded(item, true);
        else if (expanded === 'true') next = item.querySelector('[role="treeitem"]');
        break;
      case 'ArrowLeft':
        if (expanded === 'true') setExpanded(item, false);
        else next = parentItem(item);
        break;
      case 'Enter':
      case ' ':
        go(item);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (next) focusItem(next);
  });

  // ── Where you are ───────────────────────────────────────────────────────

  /// Scrolled to the end, the last sections are as far as they will come up.
  const atEnd = (scroller) => scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;

  /// The reading position as pages: 2.25 is a quarter of the way down page 3.
  function pdfPosition() {
    const box = container.getBoundingClientRect();
    const probe = atEnd(container) ? box.bottom - 1 : box.top + Math.min(box.height / 4, 96);
    let number = viewer.currentPageNumber || 1;
    for (let step = 0; step < 6; step += 1) {
      const div = viewer.getPageView(number - 1)?.div;
      if (!div) break;
      const rect = div.getBoundingClientRect();
      if (probe < rect.top - 8 && number > 1) number -= 1;
      else if (probe > rect.bottom + 8 && number < viewer.pagesCount) number += 1;
      else return number - 1 + clamp((probe - rect.top) / (rect.height || 1), 0, 0.999);
    }
    return number - 1;
  }

  function entryPosition(target) {
    if (!target?.page) return null;
    const box = viewer.getPageView(target.page - 1)?.viewport?.viewBox;
    const height = box ? box[3] - box[1] : 0;
    const down = target.top === null || !height ? 0 : clamp((box[3] - target.top) / height, 0, 0.999);
    return target.page - 1 + down;
  }

  function currentEntry() {
    if (built.kind === 'markdown') {
      const headings = markdown.querySelectorAll(HEADINGS);
      if (!headings.length || markdown.hidden) return null;
      const box = markdownStage.getBoundingClientRect();
      const probe = atEnd(markdownStage) ? box.bottom - 1 : box.top + Math.min(box.height / 4, 96);
      let found = null;
      for (const entry of built.entries) {
        const heading = headings[entry.target.heading];
        if (heading && heading.getBoundingClientRect().top <= probe) found = entry;
      }
      return found;
    }
    const at = pdfPosition() + 0.002;
    let found = null;
    let best = -1;
    for (const entry of built.entries) {
      const position = entryPosition(entry.target);
      if (position !== null && position <= at && position >= best) {
        best = position;
        found = entry;
      }
    }
    return found;
  }

  function mark(item) {
    let shownItem = item;
    while (shownItem && shownItem.parentElement.closest('[aria-expanded="false"]')) shownItem = parentItem(shownItem);
    if (shownItem === current) return;
    current?.classList.remove('current');
    current?.removeAttribute('aria-current');
    current = shownItem || null;
    if (!current) return;
    current.classList.add('current');
    current.setAttribute('aria-current', 'location');
    if (!tree.contains(document.activeElement)) roam(current);
    if (!tree.hidden) reveal(tree, current.querySelector('.outline-row'));
  }

  function update() {
    frame = 0;
    if (!shown() || !built || built.path !== file()?.path) return;
    if (!tree.hidden) mark(currentEntry()?.item ?? null);
    if (thumbs) markThumb(viewer.currentPageNumber || 1);
  }

  const schedule = () => {
    hidePreview();
    if (shown() && !frame) frame = window.requestAnimationFrame(update);
  };
  container.addEventListener('scroll', schedule, { passive: true });
  markdownStage.addEventListener('scroll', schedule, { passive: true });

  // ── Pages ───────────────────────────────────────────────────────────────

  let thumbs = null; // { path, doc, items, rendered: Map(page -> canvas), stale, visible, observer, busy }

  function freeThumbs() {
    if (!thumbs) return;
    thumbs.observer.disconnect();
    for (const canvas of thumbs.rendered.values()) free(canvas);
    thumbs = null;
    thumbsBox.replaceChildren();
  }

  function thumbSize(number) {
    const viewport = viewer.getPageView(number - 1)?.viewport;
    const ratio = viewport?.width ? viewport.height / viewport.width : Math.SQRT2;
    return Math.round(THUMB_WIDTH * ratio);
  }

  function addThumb(number) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline-thumb';
    button.tabIndex = -1;
    button.dataset.page = String(number);
    button.setAttribute('aria-label', `Page ${number}`);
    const sheet = document.createElement('span');
    sheet.className = 'outline-sheet';
    sheet.style.height = `${thumbSize(number)}px`;
    const label = document.createElement('span');
    label.className = 'outline-number';
    label.textContent = String(number);
    button.append(sheet, label);
    thumbsBox.append(button);
    thumbs.observer.observe(button);
    return button;
  }

  function buildThumbs() {
    const doc = pdf();
    const path = file()?.path;
    if (!doc) return;
    if (thumbs?.path !== path) {
      freeThumbs();
      thumbs = {
        path, doc, items: [], rendered: new Map(), stale: new Set(), visible: new Set(), busy: false,
        observer: new IntersectionObserver((seen) => {
          for (const entry of seen) {
            const number = Number(entry.target.dataset.page);
            if (entry.isIntersecting) thumbs?.visible.add(number);
            else thumbs?.visible.delete(number);
          }
          pump();
        }, { root: thumbsBox, rootMargin: '200px 0px' }),
      };
    } else if (thumbs.doc !== doc) {
      // A rebuild: the pictures in view stay up until their new ones are
      // drawn; the rest are let go now.
      thumbs.doc = doc;
      for (const [number, canvas] of [...thumbs.rendered]) {
        if (thumbs.visible.has(number)) {
          thumbs.stale.add(number);
        } else {
          canvas.remove();
          free(canvas);
          thumbs.rendered.delete(number);
        }
      }
    }
    while (thumbs.items.length > doc.numPages) {
      const button = thumbs.items.pop();
      const number = Number(button.dataset.page);
      free(thumbs.rendered.get(number));
      thumbs.rendered.delete(number);
      thumbs.visible.delete(number);
      button.remove();
    }
    while (thumbs.items.length < doc.numPages) thumbs.items.push(addThumb(thumbs.items.length + 1));
    markThumb(viewer.currentPageNumber || 1);
    pump();
  }

  async function pump() {
    if (!thumbs || thumbs.busy) return;
    const job = thumbs;
    const next = [...job.visible].sort((a, b) => a - b)
      .find((number) => !job.rendered.has(number) || job.stale.has(number));
    if (!next) return;
    job.busy = true;
    try {
      await drawThumb(job, next);
    } catch {
      // A page torn down mid-draw by a rebuild is drawn again from the new one.
    }
    job.busy = false;
    if (thumbs === job) void pump();
  }

  async function drawThumb(job, number) {
    const doc = job.doc;
    const page = await doc.getPage(number);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (THUMB_WIDTH * dpr()) / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await drawPage(page, canvas, viewport);
    if (thumbs !== job || job.doc !== doc) {
      free(canvas);
      return;
    }
    const sheet = job.items[number - 1]?.querySelector('.outline-sheet');
    if (!sheet) return free(canvas);
    free(job.rendered.get(number));
    job.rendered.delete(number);
    job.rendered.set(number, canvas);
    job.stale.delete(number);
    sheet.style.height = `${Math.round((THUMB_WIDTH * base.height) / base.width)}px`;
    sheet.replaceChildren(canvas);
    // Only so many pictures are kept; the ones furthest from view go first.
    const near = [...job.visible];
    const middle = near.length ? near.reduce((a, b) => a + b, 0) / near.length : number;
    while (job.rendered.size > THUMB_CACHE) {
      let far = null;
      for (const key of job.rendered.keys()) {
        if (!job.visible.has(key) && (far === null || Math.abs(key - middle) > Math.abs(far - middle))) far = key;
      }
      if (far === null) break;
      const old = job.rendered.get(far);
      old.remove();
      free(old);
      job.rendered.delete(far);
    }
  }

  /// Draw a page in the page mode on screen. A page the main view is not
  /// showing gives back what drawing it cached.
  async function drawPage(page, canvas, viewport, transform = undefined) {
    const palette = colors();
    await page.render({
      canvasContext: canvas.getContext('2d', { alpha: false }),
      viewport,
      transform,
    }).promise;
    if (palette) recolorCanvas(canvas, palette);
    if (!viewer.getPageView(page.pageNumber - 1)?.renderingState) page.cleanup();
  }

  function markThumb(number) {
    if (!thumbs) return;
    const button = thumbs.items[number - 1];
    if (!button || button.getAttribute('aria-current') === 'page') return;
    for (const other of thumbsBox.querySelectorAll('[aria-current]')) {
      other.removeAttribute('aria-current');
      if (other !== document.activeElement) other.tabIndex = -1;
    }
    button.setAttribute('aria-current', 'page');
    if (!thumbsBox.contains(document.activeElement)) button.tabIndex = 0;
    if (!thumbsBox.hidden) reveal(thumbsBox, button);
  }

  thumbsBox.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.outline-thumb') : null;
    if (!button) return;
    push();
    viewer.scrollPageIntoView({ pageNumber: Number(button.dataset.page) });
  });

  thumbsBox.addEventListener('keydown', (event) => {
    const button = event.target instanceof Element ? event.target.closest('.outline-thumb') : null;
    if (!button || !thumbs || event.altKey || event.ctrlKey || event.metaKey) return;
    const at = Number(button.dataset.page) - 1;
    const to = { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: thumbs.items.length - 1 }[event.key];
    if (to === undefined) {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const next = thumbs.items[clamp(to, 0, thumbs.items.length - 1)];
    button.tabIndex = -1;
    next.tabIndex = 0;
    next.focus({ preventScroll: true });
    reveal(thumbsBox, next);
  });

  // ── The sidebar ─────────────────────────────────────────────────────────

  function syncTabs() {
    const pages = pageTab();
    pagesTab.hidden = kind() !== 'pdf';
    treeTab.setAttribute('aria-selected', String(!pages));
    pagesTab.setAttribute('aria-selected', String(pages));
    treeTab.tabIndex = pages ? -1 : 0;
    pagesTab.tabIndex = pages ? 0 : -1;
    tree.hidden = pages || !built?.entries.length;
    empty.hidden = pages || !built || Boolean(built.entries.length);
    thumbsBox.hidden = !pages;
    if (pages && shown()) buildThumbs();
    else freeThumbs();
  }

  function pickTab(name) {
    tab = name;
    store(TAB_KEY, name);
    syncTabs();
    update();
  }

  treeTab.addEventListener('click', () => pickTab('outline'));
  pagesTab.addEventListener('click', () => pickTab('pages'));
  el('outlineTabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.altKey || event.ctrlKey || event.metaKey || pagesTab.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    const to = pageTab() ? treeTab : pagesTab;
    pickTab(to === pagesTab ? 'pages' : 'outline');
    to.focus();
  });
  el('outlineClose').addEventListener('click', () => toggleOutline(false));
  sidebar.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      focusPage();
    }
  });

  function setWidth(px, persist = true) {
    width = Math.round(clamp(px, MIN_WIDTH, Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, window.innerWidth / 2))));
    apply();
    if (persist) store(WIDTH_KEY, String(width));
  }

  grip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    const left = sidebar.getBoundingClientRect().left;
    const move = (moved) => setWidth(moved.clientX - left, false);
    const done = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', done);
      grip.removeEventListener('pointercancel', done);
      store(WIDTH_KEY, String(width));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', done);
    grip.addEventListener('pointercancel', done);
  });
  grip.addEventListener('keydown', (event) => {
    const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    setWidth(width + step);
  });
  grip.setAttribute('aria-valuemin', String(MIN_WIDTH));
  grip.setAttribute('aria-valuemax', String(MAX_WIDTH));

  /// The document on the stage changed: a rebuild, another tab, another pane.
  function refresh() {
    hidePreview();
    previews.clear();
    apply();
    if (!shown()) {
      built = null;
      freeThumbs();
      return;
    }
    if (built?.path !== file().path) {
      built = null;
      tree.replaceChildren();
      freeThumbs();
    }
    syncTabs();
    void buildOutline();
  }

  /// The page mode changed: the pictures are drawn again in the new colours.
  function recolor() {
    previews.clear();
    if (!thumbs) return;
    for (const number of thumbs.rendered.keys()) thumbs.stale.add(number);
    void pump();
  }

  // ── Back and forward ────────────────────────────────────────────────────

  const histories = new Map(); // path -> { back: [], forward: [] }
  const historyOf = (path) => {
    if (!histories.has(path)) histories.set(path, { back: [], forward: [] });
    return histories.get(path);
  };
  const same = (a, b) => Boolean(a && b) && a.kind === b.kind && a.page === b.page &&
    String(a.scale) === String(b.scale) && Math.abs(a.top - b.top) < 4 && Math.abs((a.left || 0) - (b.left || 0)) < 4;

  /// Remember where you are before a jump takes you somewhere else.
  function push() {
    const path = file()?.path;
    if (!path || !fits()) return;
    const here = capture();
    if (!here) return;
    const history = historyOf(path);
    history.forward.length = 0;
    if (same(history.back.at(-1), here)) return;
    history.back.push(here);
    if (history.back.length > HISTORY_MAX) history.back.shift();
  }

  function travel(from, to) {
    const path = file()?.path;
    if (!path || !fits()) return false;
    const history = historyOf(path);
    const here = capture();
    while (history[from].length && same(history[from].at(-1), here)) history[from].pop();
    const view = history[from].pop();
    if (!view) {
      status(from === 'back' ? 'Nothing to go back to' : 'Nothing to go forward to');
      return false;
    }
    if (here) history[to].push(here);
    hidePreview();
    restore(view);
    return true;
  }

  const canGo = (way) => {
    const path = file()?.path;
    return Boolean(path && fits() && histories.get(path)?.[way].length);
  };

  // A link in the PDF itself. PDF.js's own version also leaves a listener
  // that focuses the target page's text the next time it is drawn, and that
  // next time can be a rebuild minutes later, which pulled the view back.
  linkService.goToDestination = async (dest) => {
    const doc = pdf();
    const spot = doc ? await locateDestination(doc, dest) : null;
    if (!spot || pdf() !== doc) return;
    push();
    viewer.scrollPageIntoView({ pageNumber: spot.page, destArray: spot.explicit });
  };
  const followPage = linkService.goToPage.bind(linkService);
  linkService.goToPage = (value) => {
    push();
    return followPage(value);
  };

  window.addEventListener('mouseup', (event) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    travel(event.button === 3 ? 'back' : 'forward', event.button === 3 ? 'forward' : 'back');
  });
  window.addEventListener('mousedown', (event) => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  });

  // ── Link previews ───────────────────────────────────────────────────────

  const previews = new Map(); // href -> { canvas, page }, the last few drawn
  previews.clear = function clear() {
    for (const { canvas } of this.values()) free(canvas);
    Map.prototype.clear.call(this);
  };
  let hoverTimer = 0;
  let hovered = null;
  let previewSerial = 0;

  const linkAt = (target) => {
    if (!(target instanceof Element)) return null;
    const pdfLink = target.closest('.annotationLayer section[data-internal-link] > a[href^="#"]');
    if (pdfLink && container.contains(pdfLink)) return pdfLink;
    const mdLink = target.closest('a[href^="#"]');
    return mdLink && markdown.contains(mdLink) ? mdLink : null;
  };

  function hidePreview() {
    window.clearTimeout(hoverTimer);
    hoverTimer = 0;
    previewSerial += 1;
    hovered?.removeAttribute('aria-describedby');
    hovered = null;
    if (!card.hidden) {
      card.hidden = true;
      card.replaceChildren();
    }
  }

  function onOver(event) {
    const link = linkAt(event.target);
    if (link === hovered) return;
    hidePreview();
    if (!link || event.buttons) return;
    hovered = link;
    hoverTimer = window.setTimeout(() => void showPreview(link), PREVIEW_DELAY);
  }

  function onOut(event) {
    if (hovered && !(event.relatedTarget instanceof Node && hovered.contains(event.relatedTarget))) hidePreview();
  }

  for (const host of [container, markdown]) {
    host.addEventListener('pointerover', onOver);
    host.addEventListener('pointerout', onOut);
  }
  window.addEventListener('pointerdown', hidePreview, true);
  window.addEventListener('blur', hidePreview);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !card.hidden) hidePreview();
  }, true);

  async function pdfPreview(href) {
    const cached = previews.get(href);
    if (cached) {
      previews.delete(href);
      previews.set(href, cached);
      return cached;
    }
    const doc = pdf();
    const dest = linkDestination(href);
    const spot = doc && dest !== null ? await locateDestination(doc, dest) : null;
    if (!spot || pdf() !== doc) return null;
    const page = await doc.getPage(spot.page);
    const base = page.getViewport({ scale: 1 });
    const [x0, , x1, y1] = base.viewBox;
    const at = spot.top ?? y1;
    const [low, high] = columnAt(await page.getTextContent().catch(() => null), at, spot.left) ?? [x0, x1];
    const span = high - low + 24;
    const scale = clamp(PREVIEW_WIDTH / span, PREVIEW_WIDTH / (x1 - x0), 96 / 72);
    const viewport = page.getViewport({ scale: scale * dpr() });
    const [x, y] = viewport.convertToViewportPoint(low - 12, at);
    const width = Math.min(Math.round(clamp(span * scale, 240, PREVIEW_WIDTH) * dpr()), Math.floor(viewport.width));
    const height = Math.min(Math.round(PREVIEW_HEIGHT * dpr()), Math.floor(viewport.height));
    const left = clamp(x, 0, viewport.width - width);
    const top = clamp(y - 4 * dpr(), 0, viewport.height - height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width / dpr()}px`;
    canvas.style.height = `${height / dpr()}px`;
    await drawPage(page, canvas, viewport, [1, 0, 0, 1, -left, -top]);
    if (pdf() !== doc) {
      free(canvas);
      return null;
    }
    const shot = { canvas, page: spot.page };
    previews.set(href, shot);
    while (previews.size > PREVIEW_CACHE) {
      const [oldest, entry] = previews.entries().next().value;
      free(entry.canvas);
      previews.delete(oldest);
    }
    return shot;
  }

  /// The block a Markdown link points at, copied for reading only: a heading
  /// brings the paragraph under it, an equation number its equation.
  function markdownPreview(href) {
    let target = null;
    try {
      const id = decodeURIComponent(href.slice(1));
      target = markdown.querySelector(`[id="${CSS.escape(href.slice(1))}"]`) || markdown.querySelector(`[id="${CSS.escape(id)}"]`);
    } catch {
      return null;
    }
    if (!target) return null;
    const parts = [];
    if (/^H[1-6]$/.test(target.tagName)) {
      parts.push(target);
      const next = target.nextElementSibling;
      if (next && !/^H[1-6]$/.test(next.tagName)) parts.push(next);
    } else {
      parts.push(target.closest(BLOCKS) || target);
    }
    const body = document.createElement('div');
    body.className = 'link-preview-text';
    for (const part of parts) {
      const copy = part.cloneNode(true);
      for (const node of [copy, ...copy.querySelectorAll('[id], [tabindex], [aria-describedby], .review-badge')]) {
        if (node.classList?.contains('review-badge')) {
          node.remove();
          continue;
        }
        node.removeAttribute('id');
        node.removeAttribute('tabindex');
        node.removeAttribute('aria-describedby');
      }
      body.append(copy);
    }
    const look = getComputedStyle(markdown);
    const tokens = getComputedStyle(markdownStage);
    body.style.fontFamily = look.fontFamily;
    for (const name of ['--md-bg', '--md-fg', '--md-dim', '--md-rule', '--md-code-bg', '--md-accent']) {
      body.style.setProperty(name, tokens.getPropertyValue(name));
    }
    return body;
  }

  async function showPreview(link) {
    const serial = ++previewSerial;
    const href = link.getAttribute('href') || '';
    let content = null;
    let caption = '';
    try {
      if (container.contains(link)) {
        const shot = await pdfPreview(href);
        if (shot) {
          content = shot.canvas;
          caption = `Page ${shot.page}`;
        }
      } else {
        content = markdownPreview(href);
      }
    } catch {
      content = null;
    }
    if (serial !== previewSerial || hovered !== link || !content || !link.isConnected) return;
    card.replaceChildren(content);
    card.classList.toggle('link-preview-md', !container.contains(link));
    if (caption) {
      const note = document.createElement('div');
      note.className = 'link-preview-caption';
      note.textContent = caption;
      card.append(note);
    }
    card.style.left = '0px';
    card.style.top = '0px';
    card.hidden = false;
    link.setAttribute('aria-describedby', card.id);
    const rect = link.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    const below = rect.bottom + 6;
    const y = below + box.height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - 6 - box.height);
    card.style.left = `${clamp(rect.left, 8, Math.max(8, window.innerWidth - box.width - 8))}px`;
    card.style.top = `${y}px`;
  }

  apply();
  return {
    toggleOutline,
    get outlineOpen() {
      return open;
    },
    width: () => (shown() ? width : 0),
    refresh,
    recolor,
    push,
    back: () => travel('back', 'forward'),
    forward: () => travel('forward', 'back'),
    canGo,
    hidePreview,
  };
}
