/// What a PDF rebuild changed. The text of every page of the open build is
/// kept, whitespace collapsed; after a rebuild each page is compared with the
/// one before it, and what is new is marked on the page for a few seconds,
/// as Markdown marks a changed block, and as a tick in a strip at the right
/// edge that stays, faint, until the next build. Pages on screen are compared
/// as their text layer is drawn; the rest one at a time in the background,
/// within a budget, or when they are first shown.

import { wordDiff } from './review-diff.mjs';

/// Pages read in the background per build, and how long that may go on.
export const CHANGE_BUDGET = { pages: 500, ms: 20_000 };
/// The highlight's life, as in Markdown (style.css `.changed`).
const FADE_MS = 3200;
const MAX_BOXES = 400;

/// A page's text items as one string, each whitespace run one space, items
/// joined by a space; with `map`, where each character came from.
export function flatten(items, map = false) {
  let text = '';
  let space = true;
  const item = map ? [] : null;
  const offset = map ? [] : null;
  const push = (ch, i, j) => {
    text += ch;
    item?.push(i);
    offset?.push(j);
  };
  items.forEach((str, i) => {
    for (let j = 0; j < str.length; j += 1) {
      const ch = str[j];
      if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === ' ' || ch === '\f') {
        if (!space) push(' ', i, j);
        space = true;
      } else {
        push(ch, i, j);
        space = false;
      }
    }
    if (!space) {
      push(' ', i, str.length);
      space = true;
    }
  });
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    item?.pop();
    offset?.pop();
  }
  return { text, item, offset };
}

/// The spans of `after` that are new against `before`, as [start, end)
/// offsets; a deletion marks the word it left behind. Null when the texts
/// are too long to compare.
export function changedSpans(before, after) {
  if (before === after) return [];
  const runs = wordDiff(before, after);
  if (!runs) return null;
  const spans = [];
  let at = 0;
  const add = (start, end) => {
    while (start < end && after[start] === ' ') start += 1;
    while (end > start && after[end - 1] === ' ') end -= 1;
    if (start >= end) return;
    const last = spans.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
  };
  for (const [op, text] of runs) {
    if (op === 1) {
      add(at, at + text.length);
      at += text.length;
    } else if (op === 0) {
      at += text.length;
    } else if (after.length) {
      let start = Math.min(at, after.length - 1);
      let end = start + 1;
      while (start > 0 && after[start - 1] !== ' ') start -= 1;
      while (end < after.length && after[end] !== ' ') end += 1;
      if (after[start] === ' ' && start + 1 < after.length) start += 1;
      add(start, end);
    }
  }
  return spans;
}

const textParams = { includeMarkedContent: true, disableNormalization: true };

/// `viewer()` is the PDF.js viewer, `container` its scroller and `host` the
/// positioned element the strip goes in.
export function createChangeMarks({ host, container, eventBus, viewer, budget = CHANGE_BUDGET }) {
  const strip = document.createElement('div');
  strip.className = 'change-ticks';
  strip.hidden = true;
  host.append(strip);

  let path = null;
  let pdf = null;
  let build = 0;
  let current = new Map(); // page -> text of this build
  let previous = null; // page -> text of the build before, or null
  let previousCount = 0;
  let changes = new Map(); // page -> { whole, spans, at: [fraction] }
  let checked = new Set();
  let painted = new Set();
  let freshTimer = 0;
  let tickFrame = 0;

  const pageView = (number) => viewer()?.getPageView?.(number - 1) ?? null;

  function record(number, text, positions) {
    current.set(number, text);
    if (!previous || checked.has(number)) return checked.has(number);
    checked.add(number);
    strip.dataset.checked = String(checked.size);
    let entry = null;
    if (number > previousCount) {
      entry = { whole: true, spans: [], at: [0] };
    } else if (previous.has(number)) {
      const spans = changedSpans(previous.get(number), text);
      if (spans === null) entry = { whole: true, spans: [], at: [0] };
      else if (spans.length) entry = { whole: false, spans, text, at: spans.map((span) => positions(span[0])) };
    }
    if (entry) {
      changes.set(number, entry);
      tickFrame ||= window.requestAnimationFrame(drawTicks);
    }
    return true;
  }

  // ── On the page ──────────────────────────────────────────────────────────

  function textNodeAt(div, offset) {
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    let node;
    let last = null;
    while ((node = walker.nextNode())) {
      last = node;
      if (offset <= node.length) return [node, offset];
      offset -= node.length;
    }
    return last ? [last, last.length] : null;
  }

  function boxes(view, entry, flat) {
    const { textDivs } = view._textHighlighter;
    const rects = [];
    for (const [start, end] of entry.spans) {
      const first = textDivs[flat.item[start]];
      const last = textDivs[flat.item[end - 1]];
      const from = first && textNodeAt(first, flat.offset[start]);
      const to = last && textNodeAt(last, flat.offset[end - 1] + 1);
      if (!from || !to) continue;
      const range = document.createRange();
      try {
        range.setStart(...from);
        range.setEnd(...to);
      } catch {
        continue;
      }
      for (const rect of range.getClientRects()) {
        if (rect.width > 0.5 && rect.height > 0.5) rects.push(rect);
        if (rects.length >= MAX_BOXES) return rects;
      }
    }
    return rects;
  }

  function paint(number) {
    const entry = changes.get(number);
    const view = pageView(number);
    const div = view?.div;
    if (!entry || !div) return;
    painted.add(number);
    div.querySelector(':scope > .change-marks')?.remove();
    const layer = document.createElement('div');
    layer.className = 'change-marks';
    const page = div.getBoundingClientRect();
    if (!page.width || !page.height) return;
    const put = (left, top, width, height) => {
      const box = document.createElement('i');
      box.style.left = `${left}%`;
      box.style.top = `${top}%`;
      box.style.width = `${width}%`;
      box.style.height = `${height}%`;
      layer.append(box);
    };
    if (entry.whole) {
      put(0, 0, 100, 100);
    } else {
      const strs = view._textHighlighter?.textContentItemsStr;
      if (!strs) return;
      const flat = flatten(strs, true);
      if (flat.text !== entry.text) return;
      for (const rect of boxes(view, entry, flat)) {
        put(
          ((rect.left - page.left) / page.width) * 100,
          ((rect.top - page.top) / page.height) * 100,
          (rect.width / page.width) * 100,
          (rect.height / page.height) * 100,
        );
      }
    }
    if (!layer.childElementCount) return;
    layer.classList.add('fresh');
    div.append(layer);
    void layer.offsetWidth;
    window.requestAnimationFrame(() => layer.classList.add('fading'));
    window.setTimeout(() => layer.remove(), FADE_MS);
  }

  function onTextLayer({ source, pageNumber }) {
    if (!pdf || !source?.div) return;
    const strs = source._textHighlighter?.textContentItemsStr;
    if (!strs) return;
    if (!checked.has(pageNumber) || !current.has(pageNumber)) {
      const flat = flatten(strs);
      const top = source.div.getBoundingClientRect();
      record(pageNumber, flat.text, (start) => {
        const map = flatten(strs, true);
        const rect = source._textHighlighter.textDivs[map.item[start]]?.getBoundingClientRect();
        return rect && top.height ? Math.min(1, Math.max(0, (rect.top - top.top) / top.height)) : 0;
      });
    }
    if (!painted.has(pageNumber)) paint(pageNumber);
  }

  // ── In the background ────────────────────────────────────────────────────

  async function readPage(document, number) {
    const page = await document.getPage(number);
    const content = await page.getTextContent(textParams);
    const items = content.items.filter((item) => item.str !== undefined);
    const viewport = page.getViewport({ scale: 1 });
    return {
      text: flatten(items.map((item) => item.str)).text,
      positions: (start) => {
        const map = flatten(items.map((item) => item.str), true);
        const item = items[map.item[start]];
        if (!item) return 0;
        const [, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return Math.min(1, Math.max(0, (y - (item.height || 0)) / viewport.height));
      },
    };
  }

  function order(count) {
    const from = viewer()?.currentPageNumber || 1;
    const list = [];
    for (let step = 0; list.length < count; step += 1) {
      if (from + step <= count) list.push(from + step);
      if (step && from - step >= 1) list.push(from - step);
      if (from + step > count && from - step < 1) break;
    }
    return list;
  }

  function runBackground() {
    const mine = build;
    const document = pdf;
    const began = performance.now();
    void (async () => {
      let read = 0;
      for (const number of order(document.numPages)) {
        if (mine !== build) return;
        if (read >= budget.pages || performance.now() - began > budget.ms) break;
        if (current.has(number) && (!previous || checked.has(number))) continue;
        try {
          const { text, positions } = await readPage(document, number);
          if (mine !== build) return;
          read += 1;
          if (!current.has(number) || !checked.has(number)) record(number, text, positions);
        } catch {
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
      if (mine === build) strip.dataset.done = 'true';
    })();
  }

  // ── The strip ────────────────────────────────────────────────────────────

  /// Where a change sits in the scroller's content, in pixels.
  function offsetOf(number, fraction) {
    const div = pageView(number)?.div;
    if (!div) return null;
    const box = div.getBoundingClientRect();
    const scroller = container.getBoundingClientRect();
    return box.top - scroller.top + container.scrollTop + fraction * box.height;
  }

  function positions() {
    const list = [];
    for (const [number, entry] of changes) {
      for (const fraction of entry.at) {
        const y = offsetOf(number, fraction);
        if (y !== null) list.push({ number, y });
      }
    }
    return list.sort((one, two) => one.y - two.y);
  }

  function place() {
    const outer = host.getBoundingClientRect();
    const inner = container.getBoundingClientRect();
    strip.style.top = `${inner.top - outer.top}px`;
    strip.style.height = `${container.clientHeight}px`;
    strip.style.right = `${outer.right - inner.right + (container.offsetWidth - container.clientWidth)}px`;
  }

  function drawTicks() {
    tickFrame = 0;
    strip.textContent = '';
    strip.hidden = !changes.size;
    strip.dataset.count = String(changes.size);
    if (!changes.size) return;
    place();
    const height = container.scrollHeight || 1;
    const seen = new Set();
    for (const { number, y } of positions()) {
      const top = Math.round((y / height) * 400) / 4;
      if (seen.has(top)) continue;
      seen.add(top);
      const tick = document.createElement('button');
      tick.type = 'button';
      tick.tabIndex = -1;
      tick.className = 'change-tick';
      tick.dataset.page = String(number);
      tick.title = `Changed on page ${number}`;
      tick.setAttribute('aria-label', tick.title);
      tick.style.top = `${top}%`;
      tick.addEventListener('click', () => go({ number, y }));
      strip.append(tick);
    }
  }

  function settle() {
    window.clearTimeout(freshTimer);
    strip.classList.remove('fading');
    strip.classList.add('fresh');
    void strip.offsetWidth;
    window.requestAnimationFrame(() => strip.classList.add('fading'));
    freshTimer = window.setTimeout(() => strip.classList.remove('fresh', 'fading'), FADE_MS);
  }

  function go({ number, y }) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    container.scrollTo({ top: Math.max(0, y - container.clientHeight / 3), behavior: still ? 'auto' : 'smooth' });
    painted.delete(number);
    if (pageView(number)?.textLayer?.div?.isConnected && pageView(number)._textHighlighter?.textContentItemsStr?.length) {
      paint(number);
    }
  }

  const resize = new ResizeObserver(() => {
    if (changes.size) drawTicks();
  });
  resize.observe(container);
  const content = viewer()?.viewer ?? container.firstElementChild;
  if (content) resize.observe(content);
  eventBus.on('textlayerrendered', onTextLayer);

  function reset() {
    build += 1;
    window.cancelAnimationFrame(tickFrame);
    tickFrame = 0;
    changes = new Map();
    checked = new Set();
    painted = new Set();
    strip.dataset.checked = '0';
    delete strip.dataset.done;
    for (const layer of host.querySelectorAll('.change-marks')) layer.remove();
    drawTicks();
  }

  return {
    /// A document is shown. The same path as before is a rebuild.
    load(document, at) {
      const rebuild = Boolean(document && pdf !== document && at === path && current.size);
      previous = rebuild ? current : null;
      previousCount = rebuild ? pdf?.numPages ?? previousCount : 0;
      current = new Map();
      pdf = document;
      path = document ? at : null;
      reset();
      if (!document) return;
      if (rebuild) settle();
      const mine = build;
      window.setTimeout(() => {
        if (mine === build) runBackground();
      }, 300);
    },
    clear() {
      path = null;
      pdf = null;
      previous = null;
      current = new Map();
      reset();
    },
    /// Scroll to the next (+1) or previous (-1) change; false when none.
    step(direction) {
      const list = positions();
      if (!list.length) return false;
      const target = container.scrollTop + container.clientHeight / 3;
      const pick = direction > 0
        ? list.find((item) => item.y > target + 24) ?? list[0]
        : list.findLast((item) => item.y < target - 24) ?? list.at(-1);
      go(pick);
      return true;
    },
    get count() {
      return changes.size;
    },
    dispose() {
      build += 1;
      window.cancelAnimationFrame(tickFrame);
      window.clearTimeout(freshTimer);
      resize.disconnect();
      eventBus.off('textlayerrendered', onTextLayer);
      strip.remove();
    },
  };
}
