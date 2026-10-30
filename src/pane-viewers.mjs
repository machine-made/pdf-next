/// What the panes that are not live show (see src/panes.mjs): a read-only
/// PDF.js viewer of their own for a PDF, the picture for an image, and the
/// review marks of their document. Each follows its file when it changes.
/// A PDF pane holds its own document, so a visible PDF pane costs what an
/// open PDF costs; it is torn down when the pane stops showing the file.

import { resolveMarkdownReview, resolveReviewAnchor, reviewAction, reviewColor, reviewStatus } from './review-label.mjs';

const div = (className) => {
  const element = document.createElement('div');
  element.className = className;
  return element;
};

/// The text node and offset under a point in the live viewer, or null.
function caretAt({ x, y }) {
  const position = document.caretPositionFromPoint?.(x, y);
  const range = position ? null : document.caretRangeFromPoint?.(x, y);
  const node = position ? position.offsetNode : range?.startContainer;
  if (node?.nodeType !== Node.TEXT_NODE || !node.parentElement?.closest('#stage #viewer, #stage #markdown')) return null;
  return [node, position ? position.offset : range.startOffset];
}

/// A press in a pane that is not live makes it live; a drag that started
/// there goes on as a selection in the live viewer once it is up, so one
/// gesture both picks the pane and selects the text.
export function dragIntoLive(event, onPick) {
  const from = { x: event.clientX, y: event.clientY };
  let to = null;
  let ready = false;
  let released = event.button !== 0;
  let tries = 0;
  const select = () => {
    if (!ready || !to || Math.hypot(to.x - from.x, to.y - from.y) < 4) return true;
    const start = caretAt(from);
    const end = caretAt(to);
    if (!start || !end) return false;
    window.getSelection()?.setBaseAndExtent(...start, ...end);
    return true;
  };
  // The text layer of a PDF is drawn a moment after the page: keep trying.
  const settle = () => {
    if (ready && released && !select() && tries++ < 120) window.requestAnimationFrame(settle);
  };
  const move = (next) => {
    to = { x: next.clientX, y: next.clientY };
    select();
  };
  const up = (next) => {
    move(next);
    released = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    settle();
  };
  if (!released) {
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
  Promise.resolve(onPick?.()).finally(() => {
    ready = true;
    select();
    settle();
  });
}

/// The cover over a pane that is not live: it takes the press that makes the
/// pane live and passes the wheel to what is under it.
export function paneCover(onPick, scroller) {
  const cover = div('pane-cover');
  cover.title = 'Click to work in this pane';
  cover.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    dragIntoLive(event, onPick);
  });
  cover.addEventListener('wheel', (event) => {
    scroller()?.scrollBy({ left: event.deltaX, top: event.deltaY });
  }, { passive: true });
  return cover;
}

/// An image in a pane that is not live.
export function imagePane({ url, onPick }) {
  const wrap = div('pane-snapshot pane-snapshot-image');
  const stage = div('pane-image');
  const image = document.createElement('img');
  image.alt = '';
  image.src = url;
  stage.append(image);
  wrap.append(stage, paneCover(onPick, () => stage));
  return wrap;
}

// ── Review marks, read-only ───────────────────────────────────────────────

const located = (found) => found.status === 'located' || found.status === 'changed';
const gone = (review) => reviewAction(review) === 'delete' && ['applied', 'resolved'].includes(reviewStatus(review));

function tint(element, review, changed) {
  if (changed) element.classList.add('changed');
  element.dataset.reviewId = review.id;
  element.dataset.reviewTint = String(reviewColor(review, 16));
  if (reviewAction(review) === 'delete') element.dataset.reviewAction = 'delete';
  return element;
}

function badge(review) {
  const node = document.createElement('span');
  node.className = 'review-no';
  node.textContent = String(review.id);
  node.dataset.reviewId = review.id;
  node.dataset.reviewTint = String(reviewColor(review, 16));
  return node;
}

function unwrap(root, selector) {
  for (const node of root.querySelectorAll('.review-no, .review-nos')) node.remove();
  const parents = new Set();
  for (const mark of root.querySelectorAll(selector)) {
    parents.add(mark.parentNode);
    mark.replaceWith(...mark.childNodes);
  }
  for (const parent of parents) parent?.normalize();
}

/// Mark the reviews of a Markdown copy, as the live pane marks them. `text`
/// is the app's own text walker: `collect(root, inline)` and `wrap(root,
/// parts, span, make)`.
export function paintMarkdownCopy(article, reviews, { collect, wrap }) {
  unwrap(article, 'mark.review');
  let { joined, parts } = collect(article, true);
  const found = [];
  for (const review of reviews) {
    if (!review.at?.line || gone(review)) continue;
    const span = resolveMarkdownReview(joined, review, { normalized: true });
    if (located(span)) found.push({ review, span });
  }
  const hosts = [];
  let lowest = Infinity;
  for (const { review, span } of found.sort((one, two) => two.span.start - one.span.start)) {
    if (span.end > lowest) ({ parts } = collect(article, true));
    lowest = span.start;
    const first = wrap(article, parts, span, () => {
      const mark = document.createElement('mark');
      mark.className = 'review';
      return tint(mark, review, span.status === 'changed');
    });
    if (first) hosts.push([first, review]);
  }
  for (const [first, review] of hosts.reverse()) {
    let host = first.parentElement;
    while (host && host !== article && !host.classList.contains('md-page') && !host.querySelector(':scope > [data-line]')) {
      host = host.parentElement;
    }
    if (!host || host === article || host.classList.contains('md-page')) host = first.parentElement;
    let pack = host.querySelector(':scope > .review-nos');
    if (!pack) {
      pack = document.createElement('span');
      pack.className = 'review-nos';
      host.append(pack);
    }
    pack.append(badge(review));
  }
}

function paintPdfPage(page, number, textPages, reviews, { collect, wrap }) {
  const layer = page.querySelector('.textLayer');
  if (!layer) return;
  unwrap(page, 'review-q');
  for (const review of reviews) {
    if (gone(review)) continue;
    const anchor = review.anchor || { position: review.at?.page ? { page: review.at.page } : null };
    const found = resolveReviewAnchor(textPages, review.quote, anchor);
    if (!located(found) || found.page !== number) continue;
    const { joined, parts } = collect(layer);
    const span = resolveReviewAnchor([{ page: number, text: joined }], review.quote, {
      ...anchor, position: { ...anchor.position, page: number },
    });
    if (!located(span)) continue;
    const first = wrap(layer, parts, span, () => tint(document.createElement('review-q'), review, span.status === 'changed'));
    if (!first) continue;
    const box = page.getBoundingClientRect();
    const at = first.getBoundingClientRect();
    const node = badge(review);
    node.style.left = `${Math.min(Math.max(0, page.clientWidth - 58), at.right - box.left)}px`;
    node.style.top = `${Math.max(0, at.top - box.top - 12)}px`;
    page.append(node);
  }
}

// ── PDF panes ─────────────────────────────────────────────────────────────

/// `load(url)` starts a PDF.js loading task on the app's shared worker;
/// `makeViewer(options)` builds a viewer like the app's; `onPick(path)` makes
/// the pane live and resolves when it is.
export function createPaneViewers({ load, makeViewer, EventBus, createChangeMarks, recolor, spreadMode, text, onPick, remember }) {
  const viewers = new Map();

  function pdfPane(path, { url, view, reviews, still }) {
    const wrap = div('pane-snapshot pane-snapshot-pdf');
    const container = div('pane-pdf');
    const pages = div('pdfViewer');
    container.append(pages);
    wrap.append(container);
    // The pixels of the live view, until this viewer has drawn a page.
    if (still) {
      wrap.append(still);
      wrap.addEventListener('pane-attached', () => still.dispatchEvent(new Event('pane-attached')), { once: true });
    }
    wrap.append(paneCover(() => onPick(path), () => container));
    const abort = new AbortController();
    const eventBus = new EventBus();
    let viewer = null;
    const changes = createChangeMarks?.({ host: wrap, container, eventBus, viewer: () => viewer });
    let task = null;
    let source = null;
    let kept = view;
    let marks = reviews ?? [];
    let texts = null;
    let serial = 0;
    let disposed = false;

    const current = () => (viewer?.pdfDocument
      ? { kind: 'pdf', page: viewer.currentPageNumber || 1, scale: viewer.currentScaleValue || 'auto', top: container.scrollTop, left: container.scrollLeft }
      : kept);

    function restore(at) {
      viewer.currentScaleValue = String(at?.scale ?? 'auto');
      if (at?.page > 1 && at.page <= viewer.pagesCount) viewer.currentPageNumber = at.page;
      container.scrollTop = at?.top ?? 0;
      container.scrollLeft = at?.left ?? 0;
    }

    function pageTexts(pdf) {
      if (texts?.pdf !== pdf) {
        texts = {
          pdf,
          pages: (async () => {
            const list = [];
            for (let number = 1; number <= pdf.numPages; number += 1) {
              const content = await (await pdf.getPage(number)).getTextContent();
              list.push({ page: number, text: content.items.map((item) => item.str || '').join(' ') });
            }
            return list;
          })().catch(() => []),
        };
      }
      return texts.pages;
    }

    async function paint(number) {
      const pdf = viewer?.pdfDocument;
      if (!pdf || !marks.length) return;
      const list = await pageTexts(pdf);
      const page = pages.querySelector(`.page[data-page-number="${number}"]`);
      if (pdf === viewer?.pdfDocument && page) paintPdfPage(page, number, list, marks, text);
    }

    async function open(url) {
      const mine = ++serial;
      source = url;
      const next = load(url);
      let pdf;
      try {
        pdf = await next.promise;
      } catch {
        void next.destroy();
        return;
      }
      if (disposed || mine !== serial) {
        void next.destroy();
        return;
      }
      kept = current();
      viewer ??= makeViewer({ container, viewer: pages, eventBus, abortSignal: abort.signal });
      const previous = task;
      task = next;
      const ready = Promise.race([
        new Promise((resolve) => eventBus.on('pagesinit', resolve, { once: true })),
        new Promise((resolve) => window.setTimeout(resolve, 10_000)),
      ]);
      // The old pages go with setDocument, then their document.
      viewer.setDocument(pdf);
      changes?.load(pdf, path);
      void previous?.destroy();
      await ready;
      if (disposed || mine !== serial) return;
      viewer.spreadMode = spreadMode();
      restore(kept);
    }

    eventBus.on('pagerendered', (event) => recolor?.(event));
    eventBus.on('pagerendered', () => still?.remove(), { once: true });
    eventBus.on('textlayerrendered', ({ pageNumber }) => void paint(pageNumber));
    void open(url);

    return {
      element: wrap,
      view: current,
      reload(url) {
        if (url !== source) void open(url);
      },
      setReviews(list) {
        marks = list ?? [];
        for (const page of pages.querySelectorAll('.page')) {
          if (marks.length) void paint(Number(page.dataset.pageNumber));
          else unwrap(page, 'review-q');
        }
      },
      recolor() {
        if (!viewer?.pdfDocument) return;
        for (const pageView of viewer._pages ?? []) {
          try {
            pageView.reset();
          } catch {
            // Redrawn by the update below anyway.
          }
        }
        viewer.update();
      },
      cleanup() {
        viewer?.pdfDocument?.cleanup().catch(() => {});
      },
      dispose() {
        remember(path, current());
        disposed = true;
        serial += 1;
        try {
          viewer?.setDocument(null);
        } catch {
          // An empty viewer is not an error.
        }
        abort.abort();
        changes?.dispose();
        void task?.destroy();
        task = null;
        viewer = null;
        texts = null;
        wrap.remove();
      },
    };
  }

  function drop(path) {
    const viewer = viewers.get(path);
    if (!viewer) return;
    viewers.delete(path);
    viewer.dispose();
  }

  return {
    /// A live PDF viewer for `path`, to put in its pane.
    pdf(path, options) {
      drop(path);
      const viewer = pdfPane(path, options);
      viewers.set(path, viewer);
      viewer.element.addEventListener('pane-detached', () => {
        if (viewers.get(path) === viewer) drop(path);
      }, { once: true });
      return viewer.element;
    },
    has: (path) => viewers.has(path),
    /// Load the newest revision; false when there is no viewer for `path`.
    reload(path, url) {
      viewers.get(path)?.reload(url);
      return viewers.has(path);
    },
    setReviews: (path, reviews) => viewers.get(path)?.setReviews(reviews),
    viewOf: (path) => viewers.get(path)?.view() ?? null,
    /// Free every viewer whose pane no longer shows its file.
    keep(paths) {
      for (const path of [...viewers.keys()]) if (!paths.includes(path)) drop(path);
    },
    recolor() {
      for (const viewer of viewers.values()) viewer.recolor();
    },
    cleanup() {
      for (const viewer of viewers.values()) viewer.cleanup();
    },
    get count() {
      return viewers.size;
    },
  };
}
