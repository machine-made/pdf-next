// pdf-next viewer. One file, one window, one job: show the document and keep
// showing the newest version of it.
import { canvasFilters, recolorRendered } from './page-colors.mjs';
import { bootIsFine, failures, mark } from './smoke.mjs';
import { createPanes, snapshotOfStage } from './panes.mjs';
import { createPaneViewers, imagePane, paintMarkdownCopy } from './pane-viewers.mjs';
import { REQUEST_GROUPS, reviewRequests, requestsLabel, toggleRequest } from './review-requests.mjs';
import { ACTION_LABELS, REVIEW_ACTIONS, contextAt, findAllSpans, madeOnOlderVersion, findNormalizedSpan, normalizeReviewText, resolveMarkdownReview, resolveReviewAnchor, selectionContext, reviewIdNum, reviewLabel, reviewAction, reviewStatus, reviewColor, sameReviewQuote, reattachedReviewAnchor } from './review-label.mjs';
import { mapCollapsedIndex, reconcilePendingComment, reconcilePendingComments } from './review-sync.mjs';
import { watchPdfRendering } from './pdf-rendering.mjs';
import { paginate, validPageView } from './md-pages.mjs';
import { FORMAT_LABELS, blockSpan, deleteEdit, figureWidthEdit, formatEdit, parentheticalEdit, sourceSpan } from './md-edit.mjs';
import { colourCode } from './code-colour.mjs';
import { createPalette, isTextField, selectChoices } from './palette.mjs';
import { createFocusMode, isFullscreen, setFullscreen, wirePopover } from './quiet.mjs';
import { diffView, passageSource, passageText, wordDiff } from './review-diff.mjs';
import {
  REVIEW_SIZE_DEFAULT,
  REVIEW_SIZE_STEPS,
  nearestReviewSize,
  nextReviewSize,
} from './review-size.mjs';
import * as pdfjsLib from './vendor/pdfjs/build/pdf.min.mjs';

// pdf_viewer.mjs resolves the core library through this global. Never assign
// globalThis.pdfjsWorker: PDF.js reads that as "parse on the UI thread".
globalThis.pdfjsLib = pdfjsLib;

const { getDocument, GlobalWorkerOptions, PDFWorker } = pdfjsLib;
const { EventBus, PDFFindController, PDFLinkService, PDFViewer, ScrollMode, SpreadMode } = await import(
  './vendor/pdfjs/web/pdf_viewer.mjs'
);

const { invoke, convertFileSrc } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

GlobalWorkerOptions.workerSrc = './vendor/pdfjs/build/pdf.worker.min.mjs';

/** A folder under the vendored PDF.js, as an absolute URL. */
function vendorUrl(folder) {
  return new URL(`./vendor/pdfjs/${folder}`, document.baseURI).href;
}

// A rendered page canvas is the dominant per-document cost. The cap must hold a
// whole page at fit-width on a 4K screen: an A4 page 3840 px wide is 21 MP. At
// the old 4 MP even a 1080p fit-width page (5.2 MP) took PDF.js's crop path,
// which redraws the visible strip on every short scroll and shows a blurred
// page meanwhile. Measured in Chromium on a 40-page paper at fit-width, 2x
// density, 4.5 pages at 1500 px/s: 4 MP gave 70 redraws and 71 of 72 frames
// blurred; 32 MP gave 4 redraws and none blurred. The cost: page canvases held
// after a 22-page scroll went from 8.6 MP to 60 MP (about 240 MB). 2^25 is
// also PDF.js's own desktop default.
const MAX_CANVAS_PIXELS = 33_554_432;
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6];
const PAGE_MODES = ['night', 'sepia', 'invert'];
// null is plain pages: a real stop, so white is always one press away rather
// than something you have to know a modifier for.
const MODE_CYCLE = [null, 'night', 'invert', 'sepia'];
const PAGE_COLORS = {
  night: { background: '#1b1b1b', foreground: '#d6d1c4' },
  sepia: { background: '#f4ecd8', foreground: '#5b4636' },
};
document.body.classList.toggle('recolored-pages', !canvasFilters);
const pageColorsFor = (mode) => (canvasFilters ? PAGE_COLORS[mode] || null : null);

const el = (id) => document.getElementById(id);
/// The Markdown copies shown in panes that are not live (see src/panes.mjs).
const paneArticles = () => document.querySelectorAll('#panes .pane-snapshot article#markdown');
const paneMarkdownStages = () => document.querySelectorAll('#panes .pane-snapshot #markdownStage');
const ui = {
  bar: el('bar'),
  open: el('open'),
  prev: el('prev'),
  next: el('next'),
  page: el('page'),
  pages: el('pages'),
  zoom: el('zoom'),
  zoomIn: el('zoomIn'),
  zoomOut: el('zoomOut'),
  copyPath: el('copyPath'),
  copyName: el('copyName'),
  mode: el('mode'),
  modeName: el('modeName'),
  wrap: el('wrap'),
  viewMenuButton: el('viewMenuButton'),
  viewMenu: el('viewMenu'),
  dockMenuButton: el('dockMenuButton'),
  dockMenu: el('dockMenu'),
  fullScreen: el('fullScreen'),
  present: el('present'),
  raw: el('raw'),
  mdFont: el('mdFont'),
  mdSize: el('mdSize'),
  mdWidth: el('mdWidth'),
  pageView: el('pageView'),
  splitView: el('splitView'),
  notes: el('notes'),
  reduce: el('reduce'),
  dockButtons: {
    left: el('dockLeft'),
    right: el('dockRight'),
    top: el('dockTop'),
    bottom: el('dockBottom'),
    center: el('dockCenter'),
  },
  tabs: el('tabs'),
  stage: el('stage'),
  panes: el('panes'),
  imagePrev: el('imagePrev'),
  imageNext: el('imageNext'),
  imageIndex: el('imageIndex'),
  poll: el('poll'),
  waiting: el('waiting'),
  update: el('update'),
  findToggle: el('findToggle'),
  find: el('find'),
  findInput: el('findInput'),
  findCount: el('findCount'),
  findPrev: el('findPrev'),
  findNext: el('findNext'),
  findClose: el('findClose'),
  container: el('viewerContainer'),
  viewer: el('viewer'),
  image: el('image'),
  imageBox: el('imageBox'),
  imageStage: el('imageStage'),
  rotate: el('rotate'),
  markdown: el('markdown'),
  markdownRaw: el('markdownRaw'),
  markdownStage: el('markdownStage'),
  figureResizer: el('figureResizer'),
  figureResizerLabel: el('figureResizerLabel'),
  figureResizerGrip: el('figureResizerGrip'),
  print: el('print'),
  printPages: el('printPages'),
  printRules: el('printRules'),
  status: el('status'),
  noteBox: el('noteBox'),
  noteRef: el('noteRef'),
  noteQuote: el('noteQuote'),
  noteRequests: el('noteRequests'),
  noteAction: el('noteAction'),
  noteText: el('noteText'),
  noteInsert: el('noteInsert'),
  noteSave: el('noteSave'),
  noteCancel: el('noteCancel'),
  noteClose: el('noteClose'),
  reviewPane: el('reviewPane'),
  reviewList: el('reviewList'),
  reviewCount: el('reviewCount'),
  reviewActionFilter: el('reviewActionFilter'),
  reviewStatusFilter: el('reviewStatusFilter'),
  reviewSizeDown: el('reviewSizeDown'),
  reviewSizeUp: el('reviewSizeUp'),
  reviewChip: el('reviewChip'),
  reviewMenu: el('reviewMenu'),
  reviewMenuAdd: el('reviewMenuAdd'),
  reviewMenuDelete: el('reviewMenuDelete'),
  reviewMenuDefine: el('reviewMenuDefine'),
  reviewMenuGloss: el('reviewMenuGloss'),
  reviewMenuCopy: el('reviewMenuCopy'),
  reviewMenuReview: el('reviewMenuReview'),
  reviewMenuEdit: el('reviewMenuEdit'),
  reviewMenuEditText: el('reviewMenuEditText'),
  editBox: el('editBox'),
  editRef: el('editRef'),
  editText: el('editText'),
  editSave: el('editSave'),
  editCancel: el('editCancel'),
  editClose: el('editClose'),
  settingsToggle: el('settingsToggle'),
  settingsPanel: el('settingsPanel'),
  settingsClose: el('settingsClose'),
  setFont: el('setFont'),
  setSize: el('setSize'),
  setWidth: el('setWidth'),
  setPoll: el('setPoll'),
  setDirectEdits: el('setDirectEdits'),
  setFocusMode: el('setFocusMode'),
  setUiFont: el('setUiFont'),
  setCodeFont: el('setCodeFont'),
  aboutVersion: el('aboutVersion'),
  aboutUpdate: el('aboutUpdate'),
  aboutSource: el('aboutSource'),
  figureSelects: document.querySelectorAll('#settingsPanel select[data-figure]'),
};

/// What a presentation took over (view, zoom, page, full screen), to give back on Esc; null otherwise.
let presentation = null;

const state = {
  file: null,
  document: null,
  task: null,
  mode: null,
  natural: null,
  /// Which screen half the window fills, or null when it is free.
  docked: null,
  wrap: false,
  imageScale: 'fit',
  /// Quarter turns clockwise, as degrees: 0, 90, 180 or 270. Per view, not per
  /// file — a fresh open comes up upright.
  imageRotation: 0,
  markdownScale: 1,
  markdownRaw: false,
  /// The page view chosen for each kind, remembered between launches.
  pageViews: { pdf: 'single', md: 'continuous' },
  statusTimer: 0,
  /// This build and its platform, from Rust; and the newer release a check
  /// found, if any — { version, url } — which turns the button into a download.
  version: '',
  platform: '',
  update: null,
  pendingRevision: null,
  pendingReviews: false,
  generation: 0,
  siblings: [],
  siblingIndex: -1,
  // Tabs hold paths, never documents: only the active file is ever loaded, so
  // ten open tabs cost the same resident memory as one.
  tabs: [],
  active: -1,
  views: new Map(),
  paneDirection: 'right',
  selectedFigure: null,
  restoringMarkdownView: null,
  // Blocks extracted from rendered markdown, per path: { path, texts: string[] }
  markdownBlocks: null,
  // Find hits in the rendered article: { hits: Element[][], index }, or null.
  mdFind: null,
  // `sha256:` of the Markdown file as read, the `documentRevision` of new reviews.
  markdownDigest: null,
  pendingNote: null,
  pendingRequests: [],
  pendingNotePdf: null,
  reviews: [],
  nextId: 1,
  reviewRevision: 0,
  reviewDocumentPath: null,
  reviewConflicts: new Map(),
  reviewLocations: new Map(),
  reattachReviewId: null,
  reopenReviewId: null,
  // Source lines where the paint found each applied review, for its before/after.
  reviewSpans: new Map(),
  reviewActionFilter: 'all',
  reviewStatusFilter: 'all',
  selectedReviewId: null,
  reviewOpen: false,
  reviewGrown: false,
  reviewSize: REVIEW_SIZE_DEFAULT,
};

// One pane by default; splitting tiles the window (src/panes.mjs).
const panes = createPanes({
  host: ui.panes,
  stage: ui.stage,
  library: window['dockview-core'],
  onActivate: (path) => void focusPane(path),
  onClose: (path) => {
    const index = state.tabs.findIndex((tab) => tab.path === path);
    if (index >= 0) void closeTab(index);
  },
  onExit: (order) => onPanesExit(order),
  onLayout: () => {
    saveSession();
    watchVisiblePanes();
  },
});

// One worker for the life of the process. getDocument would otherwise spawn a
// fresh one per load — a whole thread plus a 1.2 MB module compile on every
// rebuild — and passing it explicitly means loadingTask.destroy() tears down the
// document without terminating the worker, keeping fonts and cmaps warm.
const pdfWorker = new PDFWorker();

const eventBus = new EventBus();
const linkService = new PDFLinkService({ eventBus });
// A web link in a PDF opens in the system browser, as in a markdown file. The
// click handler on the stage sends it there; the window itself never leaves
// the app, and the navigation guard in Rust blocks it if anything slips past.
linkService.externalLinkEnabled = true;
const findController = new PDFFindController({ eventBus, linkService });

// PDFViewer._resetView drops its page views without freeing their canvases, so
// a reload leaves up to ten backing stores for the garbage collector to notice.
// At one reload per second that is a large, avoidable sawtooth.
class TidyViewer extends PDFViewer {
  _resetView() {
    for (const pageView of this._pages || []) {
      try {
        pageView.destroy();
      } catch {
        // A page already torn down is not an error.
      }
    }
    super._resetView();
  }
}

const pdfViewer = new TidyViewer({
  container: ui.container,
  viewer: ui.viewer,
  eventBus,
  linkService,
  findController,
  maxCanvasPixels: MAX_CANVAS_PIXELS,
  enableOptimizedPartialRendering: true,
  textLayerMode: 1,
  annotationMode: 1,
});
linkService.setViewer(pdfViewer);
watchPdfRendering(pdfViewer);

// Read-only viewers for the visible panes that are not live (src/pane-viewers.mjs).
const paneViewers = createPaneViewers({
  load: loadPdf,
  makeViewer: (options) => new TidyViewer({
    ...options, maxCanvasPixels: MAX_CANVAS_PIXELS, enableOptimizedPartialRendering: true, textLayerMode: 1, annotationMode: 0,
  }),
  EventBus,
  pageColors: () => pageColorsFor(state.mode),
  recolor: (event) => recolorRendered(event, PAGE_COLORS[state.mode]),
  spreadMode: () => (state.pageViews.pdf === 'two' ? SpreadMode.EVEN : SpreadMode.NONE),
  text: { collect: collectTextParts, wrap: wrapSpanParts },
  onPick: (path) => pickPane(path),
  remember: (path, view) => {
    if (view && state.tabs.some((tab) => tab.path === path)) state.views.set(path, view);
  },
});
eventBus.on('pagerendered', (event) => recolorRendered(event, PAGE_COLORS[state.mode]));
eventBus.on('pagerendered', ({ error }) => {
  if (error) {
    setStatus(`Could not render PDF: ${error.message || error}`, { error: true, sticky: true });
  }
});

// ── Title ─────────────────────────────────────────────────────────────────

/// The window title carries the build, so "which version are you on?" is
/// answered by looking at the window rather than by hunting for an about box.
/// The version arrives from Rust a moment after the first paint, which is why
/// this is a function and not a constant.
///
/// document.title alone is not enough: WebView2 never passes it to the window,
/// so on Windows the frame kept saying "pdf-next" whatever was open. Rust sets
/// the real one; document.title is set too, for the platforms that follow it.
let sentTitle = null;

function setTitle(name) {
  const app = state.version ? `pdf-next ${state.version}` : 'pdf-next';
  const title = name ? `${name} — ${app}` : app;
  document.title = title;
  // A reload every second would otherwise cross the IPC boundary every second
  // to set the title it already has.
  if (title === sentTitle) {
    return;
  }
  sentTitle = title;
  invoke('set_title', { title }).catch(() => {});
}

// ── Status ────────────────────────────────────────────────────────────────

/// Show a short message. `action` adds one button to it, such as Undo; a
/// message with a button stays up longer, long enough to reach it.
function setStatus(message, { error = false, sticky = false, action = null } = {}) {
  window.clearTimeout(state.statusTimer);
  ui.status.textContent = message;
  if (message && action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      ui.status.classList.remove('on', 'actionable');
      action.run();
    });
    ui.status.append(button);
  }
  ui.status.classList.toggle('on', Boolean(message));
  ui.status.classList.toggle('actionable', Boolean(message && action));
  ui.status.classList.toggle('error', error);
  if (message && !sticky) {
    state.statusTimer = window.setTimeout(() => {
      ui.status.classList.remove('on', 'actionable');
    }, action ? 10_000 : 2200);
  }
}

// ── Undo ──────────────────────────────────────────────────────────────────
// One stack per window for changes made through the app: a removed review,
// and later a direct edit to a Markdown file. Each entry knows its file, and
// Ctrl+Z undoes the newest entry for the file on screen.

const UNDO_LIMIT = 20;
const undoStack = [];

function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > UNDO_LIMIT) {
    undoStack.splice(0, undoStack.length - UNDO_LIMIT);
  }
}

/// Undo the newest change made to the file on screen. True when there was one.
async function undoLast() {
  const path = state.file?.path;
  let index = -1;
  for (let at = undoStack.length - 1; at >= 0; at -= 1) {
    if (undoStack[at].path === path) {
      index = at;
      break;
    }
  }
  if (index < 0) {
    return false;
  }
  const [entry] = undoStack.splice(index, 1);
  try {
    await entry.run();
  } catch (error) {
    if (state.file?.path === path) {
      setStatus(`Could not undo ${entry.label}: ${String(error)}`, { error: true });
    }
  }
  return true;
}

/// Put a removed review back exactly as it was: same ID, same fields, same
/// place in the list. An unsaved comment draft comes back with it.
async function restoreRemovedReview(path, record, draft) {
  const store = await invoke('restore_review', { document: path, review: record });
  if (state.file?.path !== path) {
    return;
  }
  if (draft) {
    pendingComments.set(commentDraftKey(path, record.id), draft);
  }
  applyReviewStore(store, { authoritative: true });
  selectReview(record.id);
  setStatus(`Review ${record.id} restored`);
}

// ── View state, preserved across reloads ──────────────────────────────────

function captureView() {
  if (state.file?.kind === 'image') {
    return {
      kind: 'image',
      scale: state.imageScale,
      rotation: state.imageRotation,
      top: ui.imageStage.scrollTop,
      left: ui.imageStage.scrollLeft,
    };
  }
  if (state.file?.kind === 'markdown' || state.file?.kind === 'json') {
    let anchorLine = null;
    let anchorDoc = null;
    let anchorOffset = 0;
    if (state.file.kind === 'markdown' && !state.markdownRaw && ui.markdownStage && ui.markdown) {
      const stageTop = ui.markdownStage.getBoundingClientRect?.()?.top ?? 0;
      const stageBottom = ui.markdownStage.getBoundingClientRect?.()?.bottom ?? Infinity;
      const fig = state.selectedFigure?.isConnected && ui.markdown.contains?.(state.selectedFigure)
        ? state.selectedFigure
        : null;
      const figRect = fig?.getBoundingClientRect?.();
      if (fig?.dataset?.doc && figRect && figRect.bottom > stageTop && figRect.top < stageBottom) {
        anchorDoc = fig.dataset.doc;
        anchorOffset = Math.round(figRect.top - stageTop);
      } else {
        const candidates = ui.markdown.querySelectorAll?.('img[data-doc], [data-line]') || [];
        for (const node of candidates) {
          const host = node.matches?.('span.src') && node.parentElement ? node.parentElement : node;
          const rect = host.getBoundingClientRect?.();
          if (rect && rect.bottom > stageTop + 4) {
            if (node.dataset?.doc) anchorDoc = node.dataset.doc;
            else if (node.dataset?.line) anchorLine = Number(node.dataset.line);
            anchorOffset = Math.round(rect.top - stageTop);
            break;
          }
        }
      }
    }
    return {
      kind: state.file.kind,
      scale: state.markdownScale,
      raw: state.markdownRaw,
      top: ui.markdownStage.scrollTop,
      left: ui.markdownStage.scrollLeft,
      ...(anchorDoc ? { anchorDoc, anchorOffset } : {}),
      ...(anchorLine ? { anchorLine, anchorOffset } : {}),
    };
  }
  if (!state.document) {
    return null;
  }
  return {
    kind: 'pdf',
    page: pdfViewer.currentPageNumber || 1,
    scale: pdfViewer.currentScaleValue || 'auto',
    top: ui.container.scrollTop,
    left: ui.container.scrollLeft,
  };
}

function restoreView(view) {
  if (!view || view.kind !== 'pdf') {
    return;
  }
  pdfViewer.currentScaleValue = view.scale;
  if (view.page > 1 && view.page <= pdfViewer.pagesCount) {
    pdfViewer.currentPageNumber = view.page;
  }
  // Scroll last: setting the page already moves the container.
  ui.container.scrollTop = view.top;
  ui.container.scrollLeft = view.left;
}

function restoreImageView(view) {
  if (!view || view.kind !== 'image') {
    return;
  }
  setImageRotation(view.rotation || 0, { refit: false });
  setImageScale(view.scale, { refit: false });
  ui.imageStage.scrollTop = view.top;
  ui.imageStage.scrollLeft = view.left;
}

// ── Loading ───────────────────────────────────────────────────────────────

// Served by the doc protocol with Cache-Control: no-store, so the webview's
// HTTP cache never accumulates a copy per revision. The revision query still
// matters: it makes each reload a distinct URL, so nothing in the pipeline can
// answer from memory.
function sourceUrl(file) {
  return `${convertFileSrc(file.path, 'doc')}?v=${file.revision}`;
}

/// Tear the previous document down completely before loading the next one.
///
/// This matters more than anything else in the app: the viewer reloads on every
/// rebuild, and a PDF.js document that is merely dereferenced keeps its worker,
/// font and image caches and rendered canvases alive. Measured at ~77 MB leaked
/// per reload before this was awaited properly.
async function releaseDocument() {
  const task = state.task;
  state.task = null;
  state.document = null;
  if (!task) {
    return;
  }
  try {
    // Drop the page views first so their canvases go with the document.
    pdfViewer.setDocument(null);
    linkService.setDocument(null);
  } catch {
    // An empty viewer is not an error.
  }
  try {
    await task.destroy();
  } catch {
    // A task destroyed mid-flight is expected during rapid rebuilds.
  }
}

/// Everything above the stage — the toolbar, plus the tab strip when it is
/// showing. Measured rather than read from --bar-height: the strip appears and
/// disappears, and a window fit that guessed this would be wrong by its height.
function chromeHeight() {
  const measured = window.innerHeight - ui.stage.clientHeight;
  if (measured > 0 && measured < window.innerHeight) {
    return measured;
  }
  const declared = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--bar-height'),
  );
  return Number.isFinite(declared) ? declared : 36;
}

/// Wrap the window tightly around the document. Only on a fresh open — doing it
/// on every rebuild would make the window jump around while you work.
async function fitWindow(width, height, recenter, exact = false) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return;
  }
  try {
    await invoke('fit_window', { width, height, recenter, exact });
  } catch {
    // A window that will not resize is not worth failing the open over.
  }
}

// ── Image zoom ────────────────────────────────────────────────────────────

/// An image has no viewer of its own. 'fit' is the CSS default — max-width:100%,
/// height follows — and a number is an explicit width in CSS pixels.
/// 'page-fit' fills the window with the whole picture, larger or smaller than
/// 100%, and follows the window when it changes size. Either way the browser
/// scales the bitmap it already decoded, so zoom costs no memory.
function setImageScale(value, { refit = true } = {}) {
  state.imageScale = value;
  document.body.classList.toggle('image-zoomed', value !== 'fit');
  layoutImage();
  updateZoomControl(value === 'fit' ? 'auto' : String(value), imageScale());
  if (refit) {
    scheduleWrap();
  }
}

/// The picture's natural size as it reads on screen: a quarter turn swaps
/// width and height.
function turnedNatural() {
  const { naturalWidth: width, naturalHeight: height } = ui.image;
  return state.imageRotation % 180 === 0 ? [width, height] : [height, width];
}

/// The stage's padding, which fit-width has to leave alone on each side.
function stagePadding() {
  const style = getComputedStyle(ui.imageStage);
  return [
    Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight),
    Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
  ];
}

/// Size the picture and its box for the current scale and rotation.
///
/// Upright, the stylesheet does the work: the box wraps the image, and 'fit'
/// is max-width:100%. Turned, the box is given the turned picture's size —
/// scale times the swapped natural size, or the stage width for 'fit' — and
/// the image inside is given its own, unturned size, then rotated in place by
/// the stylesheet. Scrolling, zoom, wrap and the window fit all read the box.
function layoutImage() {
  const rotation = state.imageRotation;
  const { naturalWidth: width, naturalHeight: height } = ui.image;
  ui.imageBox.style.setProperty('--image-turn', `${rotation}deg`);
  document.body.classList.toggle('image-turned', rotation !== 0);

  const scale = state.imageScale === 'page-fit' ? pageFitScale() : state.imageScale;
  if (rotation === 0 || !width) {
    ui.imageBox.style.width = '';
    ui.imageBox.style.height = '';
    if (scale === 'fit' || !width) {
      ui.image.style.width = '';
      ui.image.style.height = '';
    } else {
      ui.image.style.width = `${Math.round(width * scale)}px`;
      ui.image.style.height = 'auto';
    }
    return;
  }

  const [turnedWidth, turnedHeight] = turnedNatural();
  let shownWidth;
  if (typeof scale === 'number') {
    shownWidth = turnedWidth * scale;
  } else {
    const [padX] = stagePadding();
    shownWidth = Math.min(turnedWidth, ui.imageStage.clientWidth - padX);
  }
  const shownHeight = (shownWidth * turnedHeight) / turnedWidth;
  const quarter = rotation % 180 !== 0;
  ui.imageBox.style.width = `${Math.round(shownWidth)}px`;
  ui.imageBox.style.height = `${Math.round(shownHeight)}px`;
  ui.image.style.width = `${Math.round(quarter ? shownHeight : shownWidth)}px`;
  ui.image.style.height = `${Math.round(quarter ? shownWidth : shownHeight)}px`;
}

/// One button, a quarter turn clockwise per press; four presses is upright.
/// The zoom is untouched — 100% is still one picture pixel per screen pixel —
/// so only the box changes shape, and the window follows it when wrapping.
function setImageRotation(degrees, { refit = true } = {}) {
  state.imageRotation = ((degrees % 360) + 360) % 360;
  const turned = state.imageRotation !== 0;
  ui.rotate.classList.toggle('on', turned);
  ui.rotate.setAttribute('aria-pressed', String(turned));
  ui.rotate.title = turned
    ? `Rotated ${state.imageRotation}° — click for another quarter turn`
    : 'Rotate a quarter turn clockwise';
  ui.rotate.setAttribute('aria-label', ui.rotate.title);
  layoutImage();
  if (refit) {
    scheduleWrap();
  }
}

/// What the image is actually displayed at, whether CSS or a number set it.
function imageScale() {
  if (typeof state.imageScale === 'number') {
    return state.imageScale;
  }
  if (state.imageScale === 'page-fit') {
    return pageFitScale();
  }
  const natural = ui.image.naturalWidth || 0;
  return natural ? ui.image.offsetWidth / natural : 1;
}

/// The scale a picture opens at in a new window: 100%, or less when 100%
/// would not fit on the screen. The window is then sized to the picture.
function openingImageScale() {
  const [width, height] = turnedNatural();
  if (!width || !height) {
    return 1;
  }
  // The title bar and borders come off the work area too. WebKitGTK reports
  // no frame, so assume at least a usual one rather than overshoot.
  const frameX = Math.max(16, window.outerWidth - window.innerWidth);
  const frameY = Math.max(40, window.outerHeight - window.innerHeight);
  const pane = state.reviewOpen ? REVIEW_PANE_WIDTH : 0;
  const scale = Math.min(
    (window.screen.availWidth - frameX - pane) / width,
    (window.screen.availHeight - frameY - chromeHeight()) / height,
  );
  // Round down, so a rounded-up box never raises a scrollbar.
  return Math.max(0.01, Math.min(1, Math.floor(scale * 1000) / 1000));
}

/// The 'page-fit' scale: the whole picture in the stage, rounded down so the
/// rounded-up box never raises a scrollbar that would shrink the stage again.
function pageFitScale() {
  return Math.max(0.01, Math.floor(imageContainScale() * 1000) / 1000);
}

/// The scale at which the whole image fits inside the stage, both axes.
function imageContainScale() {
  const [width, height] = turnedNatural();
  if (!width || !height) {
    return 1;
  }
  const [padX, padY] = stagePadding();
  return Math.min(
    (ui.imageStage.clientWidth - padX) / width,
    (ui.imageStage.clientHeight - padY) / height,
  );
}

// ─ Markdown reload highlighting ────────────────────────────────────────
// Falsifiers: (1) edit one paragraph → exactly one block marked;
// (2) reload with no edit → none; (3) insert a paragraph above → only
// the new one marked.

/// LCS-based diff: returns indices into `after` array that are new or changed.
/// Pure function, no side effects. Compares at most 4000 blocks per document;
/// skips highlighting above 250,000 block pairs to bound UI-thread work.
function changedIndices(before, after) {
  const n = Math.min(before.length, 4000);
  const m = Math.min(after.length, 4000);
  if (n * m > 250_000) {
    return [];
  }

  // Build LCS table.
  const dp = Array(n + 1)
    .fill(0)
    .map(() => Array(m + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (before[i - 1] === after[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Mark which elements of `after` are in the LCS.
  const used = Array(m).fill(false);
  let i = n,
    j = m;
  while (i > 0 && j > 0) {
    if (before[i - 1] === after[j - 1]) {
      used[j - 1] = true;
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  // Return indices of elements NOT in the LCS.
  return Array.from({ length: m }, (_, i) => (used[i] ? null : i)).filter(
    (i) => i !== null
  );
}

/// Extract { element, text } pairs from the markdown article.
/// element = owner of the anchor (anchor's parent for p/li/h/blockquote/pre,
/// or next sibling for table/math). text = element.textContent with
/// whitespace collapsed.
function markdownBlocks(article) {
  const blocks = [];
  const anchors = article.querySelectorAll('span.src[data-line]');

  for (const anchor of anchors) {
    let element = anchor.parentElement;

    // If anchor is first child, element is the parent.
    // Otherwise, anchor precedes a table/math, so use next sibling.
    if (anchor.previousElementSibling === null) {
      // Anchor is first child, parent is the block.
      // element is already set.
    } else {
      // Anchor has preceding siblings or is not first, so it precedes the block.
      element = anchor.nextElementSibling || anchor.parentElement;
    }

    if (element && element !== anchor) {
      const text = element.textContent.trim().replace(/\s+/g, ' ');
      blocks.push({ element, text });
    }
  }

  return blocks;
}

/// Apply highlight to changed blocks. Changes fade out after ~3s.
let highlightTimeout = 0;
function highlightChangedBlocks(indices, blocks) {
  if (highlightTimeout) {
    window.clearTimeout(highlightTimeout);
  }

  // Apply the 'changed' class to mark blocks.
  for (const idx of indices) {
    if (blocks[idx]) {
      blocks[idx].element.classList.add('changed');
    }
  }

  // Force reflow to establish the initial state.
  void blocks[0]?.element.offsetWidth;

  // Add the fade class and set up removal.
  window.requestAnimationFrame(() => {
    for (const idx of indices) {
      if (blocks[idx]) {
        blocks[idx].element.classList.add('changed-fade');
      }
    }

    highlightTimeout = window.setTimeout(() => {
      for (const idx of indices) {
        if (blocks[idx]) {
          blocks[idx].element.classList.remove('changed', 'changed-fade');
        }
      }
    }, 3200);
  });
}

// ── Markdown ──────────────────────────────────────────────────────────────

// A reading column plus its margins. The window a fresh markdown file opens
// into, before the reader resizes it and the per-file memory takes over.
const MARKDOWN_WINDOW_WIDTH = 780;
/// The space between two page boxes; style.css gives the grid the same.
const PAGE_GAP = 24;
const REVIEW_PANE_WIDTH = 280;
const REVIEW_TINTS = 16;
const REVIEW_CHIP_MS = 500;
const COMMENT_SAVE_MS = 400;

/// Rendered or raw. Both nodes stay in the DOM with the same content, so the
/// toggle is a visibility flip — no re-render, no IPC round trip.
function setRaw(on, { persist = true } = {}) {
  state.markdownRaw = on;
  ui.markdown.hidden = on;
  ui.markdownRaw.hidden = !on;
  if (on && ui.figureResizer) {
    ui.figureResizer.hidden = true;
    state.selectedFigure = null;
  }
  ui.raw.classList.toggle('on', on);
  ui.raw.setAttribute('aria-pressed', String(on));
  if (!on) {
    schedulePaginate();
  }
  if (!persist) {
    return;
  }
  try {
    localStorage.setItem('pdf-next.md-raw', on ? '1' : '');
  } catch {
    // Preference only.
  }
}

/// One of the markdown text menus (font, size, width): the menu's `data-md`
/// names the attribute on the article that style.css keys on. An unknown saved
/// value falls back to the option the page marks as selected.
function setMarkdownStyle(select, value, { persist = true } = {}) {
  const legacyWidth = { narrow: '520', normal: '720', wide: '1000', full: '100%' };
  const options = Array.from(select.options);
  const mapped =
    select.dataset.md === 'width' &&
    !options.some((option) => option.value === value) &&
    legacyWidth[value]
      ? legacyWidth[value]
      : value;
  const chosen = options.some((option) => option.value === mapped)
    ? mapped
    : (options.find((option) => option.defaultSelected) ?? options[0]).value;
  const style = select.dataset.md;
  select.value = chosen;
  ui.markdown.dataset[style] = chosen;
  for (const article of paneArticles()) article.dataset[style] = chosen;
  if (style === 'width') {
    const cssWidth = chosen === '100%' ? '100%' : /^\d+$/.test(chosen) ? `${chosen}px` : '';
    if (cssWidth) {
      ui.markdownStage?.style?.setProperty?.('--md-width', cssWidth);
      for (const stage of paneMarkdownStages()) stage.style.setProperty('--md-width', cssWidth);
    } else {
      ui.markdownStage?.style?.removeProperty?.('--md-width');
      for (const stage of paneMarkdownStages()) stage.style.removeProperty('--md-width');
    }
  }
  if (!persist) {
    return;
  }
  try {
    localStorage.setItem(`pdf-next.md-${style}`, chosen);
  } catch {
    // Preference only.
  }
}

/// Markdown zoom is CSS zoom on the column: the text reflows at the new size,
/// which is what zooming prose should do — no bitmap scaling involved.
function setMarkdownScale(scale) {
  state.markdownScale = scale;
  ui.markdown.style.zoom = String(scale);
  ui.markdownRaw.style.zoom = String(scale);
  updateZoomControl(String(scale), scale);
  schedulePaginate();
  scheduleWrap();
  if (state.selectedFigure && typeof positionFigureResizer === 'function') {
    positionFigureResizer();
  }
}

// ── Page views ────────────────────────────────────────────────────────────

/// The article's own block, as opposed to the article or one of its page boxes.
function isBlockOwner(element) {
  return Boolean(element) && element !== ui.markdown && !element.classList.contains('md-page');
}

/// One menu for PDF and Markdown, remembered per kind. PDF.js lays out the
/// spreads itself; Markdown is cut into A4 page boxes by paginateMarkdown.
function setPageView(value, { persist = true, apply = true } = {}) {
  const key = state.file?.kind === 'pdf' ? 'pdf' : 'md';
  const chosen = validPageView(key, value);
  state.pageViews[key] = chosen;
  ui.pageView.value = chosen;
  document.body.classList.toggle('pages-on', key === 'md' && chosen !== 'continuous');
  if (persist) {
    try {
      localStorage.setItem(`pdf-next.page-view.${key}`, chosen);
    } catch {
      // Preference only.
    }
  }
  if (!apply) {
    return;
  }
  if (key === 'pdf') {
    applyPdfSpread();
    scheduleWrap();
  } else {
    schedulePaginate();
  }
}

/// Pages in pairs with the cover alone, as in a printed book: PDF.js calls that
/// even spreads (1 | 2 3 | 4 5). PDF.js forgets the spread mode whenever a
/// document is set, so this runs after every load.
function applyPdfSpread() {
  if (state.document) {
    pdfViewer.spreadMode = state.pageViews.pdf === 'two' && !presentation ? SpreadMode.EVEN : SpreadMode.NONE;
    if (presentation) pdfViewer.scrollMode = ScrollMode.PAGE;
  }
}

/// The menu shows only what the open kind can do: a PDF has no continuous
/// A4 flow to switch to, it is one page per sheet already.
function syncPageViewMenu(kind) {
  const continuous = ui.pageView.querySelector('option[value="continuous"]');
  continuous.hidden = continuous.disabled = kind === 'pdf';
  setPageView(state.pageViews[kind === 'pdf' ? 'pdf' : 'md'], { persist: false, apply: false });
}

let paginateFrame = 0;

/// One pass per frame, however many things changed in it.
function schedulePaginate() {
  const article = ui.markdown;
  const paged = state.pageViews.md !== 'continuous' || article.querySelector(':scope > .md-page');
  if (state.file?.kind !== 'markdown' || !paged || paginateFrame) {
    return;
  }
  paginateFrame = window.requestAnimationFrame(() => {
    paginateFrame = 0;
    paginateMarkdown();
    scheduleWrap();
  });
}

/// Cut the article into A4 page boxes, or put it back in one column.
///
/// The article's nodes are moved, never cloned, so review marks, find marks and
/// line anchors stay on the nodes they were painted on. A block's trailing
/// whitespace text travels with it, which keeps the text the marks are matched
/// in identical in every view. Blocks are laid out once in one box of page
/// width and measured together, so a pass costs one layout, not one per block.
/// A paragraph, table, code block or equation taller than a page is not split.
function paginateMarkdown({ keepPosition = true } = {}) {
  window.cancelAnimationFrame(paginateFrame);
  paginateFrame = 0;
  const article = ui.markdown;
  const view = state.pageViews.md;
  const started = performance.now();
  // Nothing has a size while the raw text is showing; setRaw paginates when it leaves.
  if (article.hidden || !ui.markdownStage.clientWidth) {
    return;
  }
  const sheets = article.querySelectorAll(':scope > .md-page');
  if (view === 'continuous' && !sheets.length) {
    delete article.dataset.pages;
    return;
  }
  const stage = ui.markdownStage;
  const nodes = sheets.length
    ? Array.from(sheets, (sheet) => Array.from(sheet.childNodes)).flat()
    : Array.from(article.childNodes);
  const elements = nodes.filter((node) => node.nodeType === 1);

  let held = null;
  if (keepPosition) {
    const edge = stage.getBoundingClientRect().top;
    const first = elements.find((element) => element.getBoundingClientRect().bottom > edge);
    held = first && { element: first, offset: first.getBoundingClientRect().top - edge };
  }

  if (view === 'continuous') {
    delete article.dataset.pages;
    article.replaceChildren(...nodes);
  } else {
    article.dataset.pages = view;
    const box = document.createElement('section');
    box.className = 'md-page';
    article.replaceChildren(box);
    box.append(...nodes);
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:absolute;visibility:hidden;width:1px;height:calc(var(--page-h) - 2 * var(--page-pad))';
    article.append(probe);
    // A pixel of slack: a fractional overflow would grow the page by one.
    const limit = probe.getBoundingClientRect().height - 1;
    probe.remove();
    const blocks = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        keepNext: /^H[1-6]$/.test(element.tagName) || element.matches('span.src'),
      };
    });
    // Each block with the text nodes that follow it; text before the first
    // block goes with the first.
    const units = [];
    let lead = [];
    for (const node of nodes) {
      if (node.nodeType === 1) {
        units.push([...lead, node]);
        lead = [];
      } else if (units.length) {
        units[units.length - 1].push(node);
      } else {
        lead.push(node);
      }
    }
    // Detached, the nodes move between boxes without touching a laid-out tree.
    article.replaceChildren();
    const pages = paginate(blocks, limit).map(([start, end]) => {
      const sheet = document.createElement('section');
      sheet.className = 'md-page';
      sheet.append(...units.slice(start, end).flat());
      return sheet;
    });
    article.replaceChildren(...(pages.length ? pages : nodes));
  }

  if (held) {
    const edge = stage.getBoundingClientRect().top;
    stage.scrollTop += held.element.getBoundingClientRect().top - edge - held.offset;
  }
  state.pagination = {
    ms: performance.now() - started,
    pages: article.querySelectorAll(':scope > .md-page').length,
  };
}

function applyRestoredMarkdownScroll(view) {
  if (!view || state.file?.kind !== 'markdown' || !ui.markdownStage) return;
  if (view.anchorDoc && ui.markdown?.querySelector) {
    const img = ui.markdown.querySelector(`img[data-doc="${CSS.escape(view.anchorDoc)}"]`);
    if (img) {
      const stageTop = ui.markdownStage.getBoundingClientRect().top;
      const rect = img.getBoundingClientRect();
      ui.markdownStage.scrollTop += rect.top - stageTop - (view.anchorOffset || 0);
      ui.markdownStage.scrollLeft = view.left || 0;
      return;
    }
  }
  if (view.anchorLine && ui.markdown?.querySelector) {
    const span = ui.markdown.querySelector(`[data-line="${view.anchorLine}"]`);
    const host = span?.matches?.('span.src') && span.parentElement ? span.parentElement : span;
    if (host) {
      const stageTop = ui.markdownStage.getBoundingClientRect().top;
      const rect = host.getBoundingClientRect();
      ui.markdownStage.scrollTop += rect.top - stageTop - (view.anchorOffset || 0);
      ui.markdownStage.scrollLeft = view.left || 0;
      return;
    }
  }
  ui.markdownStage.scrollTop = view.top;
  ui.markdownStage.scrollLeft = view.left;
}

/// An image arrives as `data-doc`, the canonical path Rust checked, and gets
/// its `src` here, because only the frontend knows the platform's doc URL. The
/// revision in the URL makes a regenerated figure load again.
function embedMarkdownImages(root, revision) {
  const generation = state.generation;
  if (root === ui.markdown) {
    state.selectedFigure = null;
    if (ui.figureResizer) ui.figureResizer.hidden = true;
  }
  for (const image of root.querySelectorAll('img[data-doc]')) {
    image.src = sourceUrl({ path: image.dataset.doc, revision });
    if (root === ui.markdown && typeof image.decode === 'function') {
      image.decode().then(() => {
        if (state.generation === generation && state.restoringMarkdownView) {
          applyRestoredMarkdownScroll(state.restoringMarkdownView);
        }
      }).catch(() => {});
    }
  }
}

// ── Figures ───────────────────────────────────────────────────────────────
// An image alone in its paragraph is a figure, as in Pandoc: its alt text is
// the caption, numbered when Settings says so. The paragraph stays the block
// it was, so line anchors, pages and reviews work on it unchanged, and the
// caption is text a review can quote.

const FIGURE_SETTINGS = {
  width: { key: 'pdf-next.fig-width', values: ['natural', 'column', '75', '50'], fallback: 'natural' },
  height: { key: 'pdf-next.fig-height', values: ['none', 'screen', 'half'], fallback: 'none' },
  align: { key: 'pdf-next.fig-align', values: ['center', 'left'], fallback: 'center' },
  caption: { key: 'pdf-next.fig-caption', values: ['numbered', 'plain', 'off'], fallback: 'numbered' },
};

function figureSetting(name) {
  const { key, values, fallback } = FIGURE_SETTINGS[name];
  let saved = null;
  try {
    saved = localStorage.getItem(key);
  } catch {
    // Preference only.
  }
  return values.includes(saved) ? saved : fallback;
}

/// Put the figure preferences on the article, where the stylesheet reads them.
function applyFigureSettings() {
  for (const name of Object.keys(FIGURE_SETTINGS)) {
    const key = `fig${name[0].toUpperCase()}${name.slice(1)}`;
    const val = figureSetting(name);
    ui.markdown.dataset[key] = val;
    for (const article of paneArticles()) article.dataset[key] = val;
  }
}

function markFigures(root) {
  const captions = figureSetting('caption') !== 'off';
  for (const paragraph of root.querySelectorAll('p')) {
    const elements = [...paragraph.children].filter((child) => !child.matches('span.src'));
    if (elements.length !== 1 || !elements[0].matches('img') || paragraph.textContent.trim()) continue;
    const image = elements[0];
    paragraph.classList.add('md-figure');
    const alt = image.getAttribute('alt')?.trim();
    if (captions && alt) {
      const caption = document.createElement('span');
      caption.className = 'md-caption';
      caption.textContent = alt;
      paragraph.classList.add('has-caption');
      paragraph.append(caption);
    }
  }
}

/// The HTML arrives already sanitized — ammonia ran on the Rust side — so
/// assigning innerHTML here does not hand the document a script surface, and
/// the CSP forbids inline script besides.
async function showMarkdown(file, view, generation, fit) {
  await releaseDocument();
  const doc = await invoke('read_markdown', { path: file.path });
  if (state.generation !== generation) {
    return;
  }
  // innerHTML replaces the article, so a previous mark.aim is gone with it.
  state.restoringMarkdownView = view || null;
  ui.markdown.innerHTML = doc.html;
  embedMarkdownImages(ui.markdown, file.revision);
  colourCode(ui.markdown);
  markFigures(ui.markdown);
  ui.markdownRaw.textContent = doc.raw;
  state.markdownDigest = doc.digest;
  state.markdownSource = doc.raw;
  setRaw(view?.raw ?? state.markdownRaw, { persist: false });
  setMarkdownScale(view?.scale || 1);

  // The anchors are read where the renderer put them, before any block moves.
  const newBlocks = markdownBlocks(ui.markdown);
  paginateMarkdown({ keepPosition: false });

  // Highlight changed blocks on reload.
  const isReload =
    state.markdownBlocks &&
    state.markdownBlocks.path === file.path &&
    newBlocks.length > 0;

  if (isReload && state.markdownBlocks.texts.length > 0) {
    const newTexts = newBlocks.map((b) => b.text);
    const changed = changedIndices(state.markdownBlocks.texts, newTexts);
    if (changed.length > 0) {
      highlightChangedBlocks(changed, newBlocks);
    }
  }

  // Store blocks for the next reload.
  state.markdownBlocks = {
    path: file.path,
    texts: newBlocks.map((b) => b.text),
  };
  // The new DOM has no marks, and the reviews that follow may be unchanged.
  const reviewed = state.reviewDocumentPath === file.path;
  if (reviewed) {
    paintMarkdownMarks();
  }
  if (state.mdFind && !reviewed) {
    buildMarkdownFind(true);
  }
  // Measured with the content laid out; used by undock as well as the fit.
  state.natural = {
    width: MARKDOWN_WINDOW_WIDTH,
    height: Math.max(ui.markdownStage.scrollHeight, 320),
  };
  if (view) {
    ui.markdownStage.scrollTop = view.top;
    ui.markdownStage.scrollLeft = view.left;
    if (typeof applyRestoredMarkdownScroll === 'function') {
      applyRestoredMarkdownScroll(view);
    }
    return;
  }
  ui.markdownStage.scrollTop = 0;
  if (!fit) {
    return;
  }
  await trimWindowToContent({ recenter: true });
}

/// `_review.json` is prose too, but it is already text — no renderer.
async function showJson(file, view, generation, fit) {
  await releaseDocument();
  const raw = await invoke('read_json', { path: file.path });
  if (state.generation !== generation) {
    return;
  }
  ui.markdown.textContent = '';
  ui.markdownRaw.textContent = raw;
  setRaw(true, { persist: false });
  setMarkdownScale(view?.scale || 1);
  state.natural = {
    width: MARKDOWN_WINDOW_WIDTH,
    height: Math.max(ui.markdownStage.scrollHeight, 320),
  };
  if (view) {
    ui.markdownStage.scrollTop = view.top;
    ui.markdownStage.scrollLeft = view.left;
    return;
  }
  ui.markdownStage.scrollTop = 0;
  if (!fit) {
    return;
  }
  await trimWindowToContent({ recenter: true });
}

// ── Fitting the window to the content ─────────────────────────────────────

/// The size of what is on screen right now, in logical pixels. Read off the
/// rendered element rather than recomputed, so page rotation, mixed page sizes
/// and the image's own aspect ratio all come along for free. Ceiled: a
/// fractional size rounds down into a one-pixel overflow, which raises a
/// scrollbar, which shrinks the viewport, which raises the other scrollbar.
function contentSize() {
  if (state.file?.kind === 'image') {
    if (!ui.image.naturalWidth) {
      return null;
    }
    // The box, not the image: turned a quarter, the image's own box is the
    // wrong way round.
    return [Math.ceil(ui.imageBox.offsetWidth), Math.ceil(ui.imageBox.offsetHeight)];
  }
  if (state.file?.kind === 'markdown' || state.file?.kind === 'json') {
    // The column as laid out, and the whole scroll height: prose has no page,
    // so wrapping it means a window the height of the document, up to the
    // screen.
    const column =
      state.file.kind === 'json' ? ui.markdownRaw : ui.markdown;
    const sheet = ui.markdown.querySelector('.md-page');
    if (sheet && column === ui.markdown) {
      // The window wraps one row of pages, however long the document is. The
      // row's width comes from the page box, not the column, which is only as
      // wide as the window it is in.
      const across = state.pageViews.md === 'two' ? 2 : 1;
      const edge = getComputedStyle(ui.markdownStage);
      return [
        Math.ceil(sheet.offsetWidth * across + PAGE_GAP * (across - 1) +
          parseFloat(edge.paddingLeft) + parseFloat(edge.paddingRight)),
        Math.ceil(sheet.offsetHeight + parseFloat(edge.paddingTop) + parseFloat(edge.paddingBottom)),
      ];
    }
    return [
      Math.ceil(column.offsetWidth || MARKDOWN_WINDOW_WIDTH),
      Math.ceil(ui.markdownStage.scrollHeight),
    ];
  }
  if (!state.document) {
    return null;
  }
  const index = Math.max(0, (pdfViewer.currentPageNumber || 1) - 1);
  const div = pdfViewer.getPageView?.(index)?.div;
  // In two pages the window wraps a full pair, not the cover that stands
  // alone, and each page carries 4px of margin on either side (style.css).
  const pair = pdfViewer.spreadMode !== SpreadMode.NONE && pdfViewer.pagesCount > 1;
  const across = (width) => Math.ceil(pair ? 2 * (width + 8) : width);
  if (div?.offsetWidth) {
    return [across(div.offsetWidth), Math.ceil(div.offsetHeight)];
  }
  if (!state.natural) {
    return null;
  }
  const scale = pdfViewer.currentScale || 1;
  return [across(state.natural.width * scale), Math.ceil(state.natural.height * scale)];
}

/// The window that wraps the content exactly. No scrollbar allowance — with an
/// exact window there is nothing left to scroll — and no padding, because
/// body.wrap-on has already taken the stage's padding to zero. The Review
/// pane sits on the stage, so a trim has to leave room for it.
function wrapWindowSize() {
  const content = contentSize();
  if (!content) {
    return null;
  }
  const extra = state.reviewOpen ? REVIEW_PANE_WIDTH : 0;
  return [content[0] + extra, content[1] + chromeHeight()];
}

let wrapTimer = 0;
let wrapping = false;
let holdTimer = 0;

/// The app is about to resize the window itself. The resize listener must not
/// take that for a size the reader chose and remember it; the hold lasts long
/// enough for the resize to land and its event to fire.
function holdResize() {
  wrapping = true;
  window.clearTimeout(holdTimer);
  holdTimer = window.setTimeout(() => {
    wrapping = false;
  }, 700);
}

/// Coalesce the refits: holding + would otherwise fire a set_size per step.
function scheduleWrap() {
  if (!state.wrap) {
    return;
  }
  window.clearTimeout(wrapTimer);
  wrapTimer = window.setTimeout(applyWrap, 80);
}

async function applyWrap() {
  await trimWindowToContent();
}

/// One-shot: shrink the window to the page that is already on screen.
/// Reloads and tab switches do not call this — only a fresh open, and the
/// wrap button. A docked half-screen is a size the reader asked for.
async function trimWindowToContent({ recenter = false } = {}) {
  if (state.docked) {
    return;
  }
  const size = wrapWindowSize();
  if (!size) {
    return;
  }
  document.body.classList.add('hug');
  holdResize();
  try {
    await fitWindow(size[0], size[1], recenter, true);
  } finally {
    // Restart the hold now the call has returned, so it covers the resize
    // event that follows rather than the round trip that preceded it.
    holdResize();
  }
}

function pageBoxReady() {
  const index = Math.max(0, (pdfViewer.currentPageNumber || 1) - 1);
  const div = pdfViewer.getPageView?.(index)?.div;
  if (!div?.offsetWidth) {
    return false;
  }
  // A leftover page-fit box is "ready" but the wrong size. Wait until 100%.
  const scale = Number(pdfViewer.currentScale);
  if (!Number.isFinite(scale) || Math.abs(scale - 1) > 0.04) {
    return false;
  }
  const want = state.natural?.width;
  if (want > 0) {
    return Math.abs(div.offsetWidth - want) / want < 0.15;
  }
  return true;
}

async function waitForPdfPageBox() {
  if (pageBoxReady()) {
    return;
  }
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      eventBus.off('pagerendered', onRender);
      window.clearTimeout(timer);
      resolve();
    };
    const onRender = () => {
      if (pageBoxReady()) {
        finish();
      }
    };
    const timer = window.setTimeout(finish, 2000);
    eventBus.on('pagerendered', onRender);
  });
}

/// One button: while it is on, the window follows the content. Zoom out and the
/// window comes in with it; zoom in and it grows, up to the screen.
///
/// The scale has to be a number for that to terminate. A preset — page-fit,
/// page-width, auto — is the opposite instruction: it fits the *content to the
/// window*, so resizing the window would rescale the page, which would resize
/// the window again. Turning wrap on pins the live scale to a number, and
/// choosing a preset later turns wrap off.
function setWrap(on) {
  state.wrap = on;
  document.body.classList.toggle('wrap-on', on);
  ui.wrap.classList.toggle('on', on);
  ui.wrap.setAttribute('aria-pressed', String(on));
  const label = on
    ? 'Window follows the content — click to stop (Ctrl+Shift+F)'
    : 'Fit the window to the content (Ctrl+Shift+F)';
  ui.wrap.title = label;
  ui.dockMenuButton.classList.toggle('on', on || Boolean(state.docked));
}

async function toggleWrap() {
  if (state.wrap) {
    setWrap(false);
    return;
  }
  pinScale();
  setWrap(true);
  if (state.docked) {
    // The dock sets an explicit half-screen size; wrap is about to override it,
    // so the pip should stop claiming the window is docked.
    setDocked(null);
  }
  await applyWrap();
}

/// Freeze whatever scale is showing, so a window resize cannot change it.
function pinScale() {
  if (state.file?.kind === 'image') {
    if (typeof state.imageScale !== 'number') {
      setImageScale(imageScale(), { refit: false });
    }
    return;
  }
  if (state.document) {
    const scale = pdfViewer.currentScale;
    pdfViewer.currentScaleValue = String(scale);
    // Pinning a preset to the number it already resolves to is not a scale
    // change, so PDF.js says nothing and the control would keep reading
    // "Fit page" while it is no longer fitting anything.
    updateZoomControl(String(scale), scale);
  }
}

async function showPdf(file, view, generation) {
  await releaseDocument();
  if (state.generation !== generation) {
    return;
  }
  const task = loadPdf(sourceUrl(file));
  // Held for teardown: dropping this reference is what leaks the worker.
  state.task = task;

  const pdfDocument = await task.promise;
  // A rebuild landing mid-load supersedes this one; its task is already gone.
  if (state.generation !== generation) {
    return;
  }
  state.document = pdfDocument;

  pdfViewer.setDocument(pdfDocument);
  linkService.setDocument(pdfDocument, null);
  applyPageColors();

  // Never wait forever: if setDocument fails internally, pagesinit never fires
  // and this closure would be retained for the life of the process.
  await Promise.race([
    new Promise((resolve) => {
      eventBus.on('pagesinit', resolve, { once: true });
    }),
    new Promise((resolve) => window.setTimeout(resolve, 10_000)),
  ]);
  if (state.generation !== generation) {
    return;
  }
  applyPdfSpread();

  if (view) {
    restoreView(view);
  } else {
    // 100%, then trim the window to that page. page-fit into a large or
    // maximized window is what left a band of empty desk on a big screen.
    const page = await pdfDocument.getPage(1);
    const { width, height } = page.getViewport({
      scale: 96 / 72,
    });
    state.natural = { width, height };
    pdfViewer.currentScaleValue = '1';
    await waitForPdfPageBox();
    await trimWindowToContent({ recenter: true });
    scheduleWrap();
  }
  updatePageControls();
}

function loadPdf(url) {
  return getDocument({
    url,
    // Reuse the one worker; without this every reload starts a new thread.
    worker: pdfWorker,
    // The doc protocol answers full GETs only (no Accept-Ranges), so range
    // options would be inert. One streamed read per load is what happens.
    disableRange: true,
    // Absolute, because the worker fetches these itself and a relative path
    // would resolve against the worker's own folder. A wrong folder is a
    // quiet 404: CJK text loses its glyphs, and a scanned page (CCITT and
    // JBIG2 both decode in jbig2.wasm) comes up white.
    cMapUrl: vendorUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: vendorUrl('standard_fonts/'),
    wasmUrl: vendorUrl('wasm/'),
    iccUrl: vendorUrl('iccs/'),
  });
}

// ── Stepping through a folder ─────────────────────────────────────────────

/// Learn what else is next to the open file, so Left/Right can walk the folder.
/// Failing quietly is fine — the viewer just loses the arrows.
async function loadSiblings(file) {
  state.siblings = [];
  state.siblingIndex = -1;
  if (file.kind !== 'image') {
    updateSiblingControls();
    return;
  }
  try {
    const found = await invoke('siblings', { path: file.path });
    state.siblings = Array.isArray(found) ? found : [];
    state.siblingIndex = state.siblings.indexOf(file.path);
  } catch {
    state.siblings = [];
  }
  updateSiblingControls();
}

function updateSiblingControls() {
  const total = state.siblings.length;
  const position = state.siblingIndex;
  const known = position >= 0 && total > 1;
  ui.imageIndex.textContent = known ? `${position + 1} / ${total}` : '';
  ui.imagePrev.disabled = !known || position <= 0;
  ui.imageNext.disabled = !known || position >= total - 1;
}

/// Step to another file in the folder, keeping the window where it is — a
/// window that jumped on every arrow press would be unusable for browsing.
async function stepSibling(delta) {
  if (state.siblingIndex < 0) {
    return;
  }
  const next = state.siblingIndex + delta;
  const path = state.siblings[next];
  if (!path) {
    return;
  }
  try {
    await showInActiveTab(path);
  } catch (error) {
    setStatus(String(error), { error: true });
  }
}

/// Walking a folder replaces what the tab is showing rather than opening a
/// tab per file — browsing 200 PNGs must not leave 200 tabs behind.
async function showInActiveTab(path) {
  const file = await invoke('open_path', { path });
  const tab = state.tabs[state.active];
  if (tab) {
    state.views.delete(tab.path);
    tab.path = file.path;
    tab.name = file.name;
    tab.kind = file.kind;
    renderTabs();
  }
  await openFile(file, { keepWindow: true });
}

/// Delete key: move the file on screen to the Recycle Bin, Trash or trash,
/// after the reader confirms. A folder with none (a network share, WSL's
/// \\wsl.localhost) gets a question about deleting for good instead. A figure
/// is followed by the next one in its folder, or the one before at the end;
/// any other file closes its tab.
async function trashShownFile() {
  const file = state.file;
  if (!file) {
    return;
  }
  const bin = { windows: 'Recycle Bin', macos: 'Trash' }[state.platform] || 'trash';
  let permanent;
  try {
    permanent = (await invoke('trash_plan', { path: file.path })) === 'permanent';
  } catch (error) {
    setStatus(`Could not delete ${file.name}: ${error}`, { error: true });
    return;
  }
  const question = permanent
    ? `${file.name} is in a folder without a ${bin}. Delete it permanently?`
    : `Move ${file.name} to the ${bin}?`;
  if (!window.confirm(question)) {
    return;
  }
  // Read the folder now: the list loaded at open time may not have arrived.
  let siblings = [];
  if (file.kind === 'image') {
    try {
      const found = await invoke('siblings', { path: file.path });
      siblings = Array.isArray(found) ? found : [];
    } catch {
      siblings = [];
    }
  }
  const index = siblings.indexOf(file.path);
  try {
    await invoke('trash_document', { path: file.path, permanent });
  } catch (error) {
    setStatus(`Could not delete ${file.name}: ${error}`, { error: true });
    return;
  }
  const next = index >= 0 ? siblings[index + 1] ?? siblings[index - 1] : null;
  try {
    if (next) {
      await showInActiveTab(next);
    } else {
      await closeTab(state.active);
    }
  } catch (error) {
    setStatus(String(error), { error: true });
    return;
  }
  setStatus(permanent ? `Deleted ${file.name}` : `Moved ${file.name} to the ${bin}`);
}

/// The opening scale estimates the window frame from the webview. When the
/// real frame is larger, the window comes out smaller than the picture.
/// Measure the window that resulted and shrink the picture into it. The
/// window is not trimmed again: on macOS each trim lands 32 px short, so a
/// second trim would clip the picture again.
async function shrinkImageToWindow(generation) {
  await stageSettled();
  if (state.generation !== generation || typeof state.imageScale !== 'number') {
    return;
  }
  const [padX, padY] = stagePadding();
  if (ui.imageBox.offsetWidth <= ui.imageStage.clientWidth - padX + 1 &&
      ui.imageBox.offsetHeight <= ui.imageStage.clientHeight - padY + 1) {
    return;
  }
  const scale = Math.min(state.imageScale, imageContainScale());
  setImageScale(Math.max(0.01, Math.floor(scale * 1000) / 1000), { refit: false });
}

/// Resolve when the stage has kept one size for three samples 50 ms apart.
/// A native resize lands some time after the call that asked for it; macOS
/// can take longer than one resize event, so the size itself is watched.
async function stageSettled(limit = 1500) {
  const deadline = Date.now() + limit;
  let last = '';
  let same = 0;
  while (Date.now() < deadline && same < 3) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const size = `${ui.imageStage.clientWidth}x${ui.imageStage.clientHeight}`;
    same = size === last ? same + 1 : 0;
    last = size;
  }
}

async function showImage(file, fit, view, generation) {
  await releaseDocument();
  if (state.generation !== generation) {
    return;
  }
  if (!view) {
    // A new picture comes up upright. Reset before the swap so the old turn
    // is not applied to the new bitmap for the frame it takes to decode.
    setImageRotation(0, { refit: false });
  }
  ui.image.src = sourceUrl(file);
  ui.image.alt = file.name;
  await ui.image.decode();
  if (state.generation !== generation) {
    return;
  }
  if (view) {
    restoreImageView(view);
  } else {
    // A window that wraps the picture opens it at up to 100%. A kept or docked
    // window keeps its size, so the picture fills it: stepping through a
    // folder of figures shows each one whole.
    setImageScale(fit && !state.docked ? openingImageScale() : 'page-fit', { refit: false });
  }
  if (fit) {
    await trimWindowToContent({ recenter: true });
    if (!view) {
      await shrinkImageToWindow(generation);
    }
  }
  scheduleWrap();
}

async function openFile(
  file,
  { preserveView = false, keepWindow = false, view: given = null } = {},
) {
  // Rebuilds can outpace loading; only the newest one may touch the UI.
  const generation = ++state.generation;
  await flushCommentSave();
  if (state.generation !== generation) {
    return;
  }
  const view = given || (preserveView ? captureView() : null);
  // Pages rendered for paper belong to the document that was open then — but
  // not while a dialog is holding them: a rebuild lands every second in the
  // loop this app is for, and clearing here would print blank sheets.
  if (!printPending) {
    clearPrintPages();
  }
  const supported = ['pdf', 'image', 'markdown', 'json'].includes(file.kind);
  if (!supported) {
    // Nothing can show this, so nothing of the previous file should stay
    // behind it: the empty state comes back, not a stage with a stale PDF.
    state.file = null;
    state.natural = null;
    await releaseDocument();
    ui.image.removeAttribute('src');
    ui.markdown.textContent = '';
    ui.markdownRaw.textContent = '';
    document.body.classList.remove(
      'has-file',
      'kind-pdf',
      'kind-image',
      'kind-markdown',
      'kind-json',
      'file-missing',
    );
    setTitle('');
    setStatus(`Unsupported file type: ${file.name}`, { error: true, sticky: true });
    return;
  }
  if (state.file?.path !== file.path) {
    state.pendingNote = null;
    state.pendingNotePdf = null;
    ui.noteBox.hidden = true;
    ui.noteText.value = '';
    state.reattachReviewId = null;
    document.body.classList.remove('reattach-picking');
    ui.editBox.hidden = true;
    state.pendingEdit = null;
  }
  state.file = file;
  state.natural = null;
  document.body.classList.add('has-file');
  document.body.classList.toggle('kind-pdf', file.kind === 'pdf');
  document.body.classList.toggle('kind-image', file.kind === 'image');
  document.body.classList.toggle('kind-markdown', file.kind === 'markdown');
  document.body.classList.toggle('kind-json', file.kind === 'json');
  syncPageViewMenu(file.kind);
  setTitle(file.name);

  // Free what the outgoing kind was holding: a decoded bitmap or a rendered
  // markdown DOM kept behind another tab is memory doing nothing.
  if (file.kind !== 'image') {
    ui.image.removeAttribute('src');
  }
  if (file.kind !== 'markdown' && file.kind !== 'json') {
    state.selectedFigure = null;
    if (ui.figureResizer) ui.figureResizer.hidden = true;
    ui.markdown.textContent = '';
    ui.markdownRaw.textContent = '';
  }

  try {
    if (file.kind === 'pdf') {
      await showPdf(file, view, generation);
    } else if (file.kind === 'image') {
      await showImage(file, !view && !keepWindow, view, generation);
      void loadSiblings(file);
    } else if (file.kind === 'markdown') {
      await showMarkdown(file, view, generation, !view && !keepWindow);
    } else if (file.kind === 'json') {
      await showJson(file, view, generation, !view && !keepWindow);
    }
    if (state.generation !== generation) {
      return;
    }
    if (file.kind === 'markdown' || file.kind === 'pdf') {
      await loadReviews();
    } else {
      await setReviewOpen(false);
      applyReviewStore({ reviews: [] });
    }
    if (state.generation === generation) {
      document.body.classList.remove('file-missing');
    }
  } catch (error) {
    // A load cancelled by a newer rebuild is expected, not a failure to report.
    if (state.generation !== generation) {
      return;
    }
    setStatus(`Could not open ${file.name}: ${error?.message || error}`, {
      error: true,
      sticky: true,
    });
    return false;
  }
}

async function openPath(path, { activate = true, target = null } = {}) {
  try {
    const file = await invoke('open_path', { path, activate });
    await openInTab(file, { activate, target });
    return file;
  } catch (error) {
    setStatus(String(error), { error: true, sticky: true });
    return null;
  }
}

// ── Landing somewhere in particular ───────────────────────────────────────
//
// `pdf-next paper.pdf --page 12`, or the same written as a link,
// `paper.pdf#page=12&search=Figure%203`. Markdown uses `--line` / `#line=`
// the same way. The PDF fields are the ones links have used for years, so a
// reference that opens in a browser opens here.

/// Keep only the fields that say something, and nothing at all if none do.
/// Rust sends every field on every open, most of them null.
function asTarget(value) {
  if (!value) {
    return null;
  }
  const page = Number.isFinite(value.page) && value.page >= 1 ? Math.round(value.page) : null;
  const line = Number.isFinite(value.line) && value.line >= 1 ? Math.round(value.line) : null;
  const nameddest = value.nameddest || null;
  const search = value.search || null;
  return page || line || nameddest || search ? { page, line, nameddest, search } : null;
}

/// A file to open, however it arrived: a bare path from a drop or an Apple
/// Event, or a path with a target from the command line.
function asOpening(value) {
  if (typeof value === 'string') {
    return { path: value, target: null };
  }
  const path = value?.path;
  return typeof path === 'string' ? { path, target: asTarget(value.target) } : null;
}

/// Land where the caller asked. Called once the document is up, because a page
/// number means nothing to PDF.js before there are pages, and because a search
/// runs from the page you are on — so `#page=5&search=Figure` finds the first
/// "Figure" at or after page 5. Markdown uses `#line=12` the same way, then
/// searches from that block onward.
async function applyTarget(target) {
  if (!target) {
    return;
  }
  if (state.file?.kind === 'markdown') {
    // Line anchors live on the rendered article, not the raw source column.
    setRaw(false, { persist: false });
    // Find marks stay: state.mdFind still points at them.
    unwrapMarks(ui.markdown, 'mark.aim:not(.find)');
    let from = null;
    if (target.line) {
      const anchors = ui.markdown.querySelectorAll('[data-line]');
      for (const anchor of anchors) {
        if (Number(anchor.dataset.line) >= target.line) {
          from = isBlockOwner(anchor.parentElement) ? anchor.parentElement : anchor;
          break;
        }
      }
      if (from) {
        from.scrollIntoView({ block: 'start' });
      } else {
        ui.markdownStage.scrollTop = ui.markdownStage.scrollHeight;
        setStatus(`Line ${target.line} is past the end`);
      }
    }
    if (target.search) {
      const needle = target.search.toLowerCase();
      const walker = document.createTreeWalker(ui.markdown, NodeFilter.SHOW_TEXT);
      let node;
      let marked = false;
      while ((node = walker.nextNode())) {
        if (
          from &&
          from !== node &&
          !from.contains(node) &&
          !(from.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
        ) {
          continue;
        }
        const text = node.nodeValue;
        const index = text.toLowerCase().indexOf(needle);
        if (index < 0) {
          continue;
        }
        const matched = node.splitText(index);
        matched.splitText(target.search.length);
        const mark = document.createElement('mark');
        mark.className = 'aim';
        const range = document.createRange();
        range.selectNode(matched);
        range.surroundContents(mark);
        mark.scrollIntoView({ block: 'center' });
        marked = true;
        break;
      }
      if (!marked) {
        setStatus(`No match for "${target.search}"`);
      }
    }
    return;
  }
  if (state.file?.kind !== 'pdf' || !state.document) {
    return;
  }
  if (target.nameddest) {
    try {
      await linkService.goToDestination(target.nameddest);
    } catch {
      setStatus(`No destination named ${target.nameddest}`, { error: true });
    }
  }
  if (target.page) {
    const landed = Math.min(target.page, pdfViewer.pagesCount || 1);
    pdfViewer.currentPageNumber = landed;
    if (landed !== target.page) {
      setStatus(`Page ${target.page} is past the end — showing ${landed}`);
    }
  }
  if (target.search) {
    // The find bar opens showing what was asked for, and keeps the count, but
    // does not take the keyboard: the reader is here to read.
    ui.findInput.value = target.search;
    ui.find.hidden = false;
    runFind();
  }
  updatePageControls();
}

/// Replace each element matching `selector` under `root` by its children,
/// then join the text that is left, once per parent.
function unwrapMarks(root, selector) {
  const parents = new Set();
  for (const mark of root.querySelectorAll(selector)) {
    const parent = mark.parentNode;
    if (!parent) {
      continue;
    }
    while (mark.firstChild) {
      parent.insertBefore(mark.firstChild, mark);
    }
    mark.remove();
    parents.add(parent);
  }
  for (const parent of parents) {
    parent.normalize();
  }
}

/// A target is an instruction, not a property of the tab: it fires once, and
/// afterwards the tab remembers the place you left it like any other.
async function consumeTarget(tab) {
  const target = tab?.target;
  if (!target) {
    return;
  }
  tab.target = null;
  await applyTarget(target);
}

// ── Tabs ──────────────────────────────────────────────────────────────────
//
// A tab is a path and nothing else. Switching tears the current document down
// through the same releaseDocument() path a rebuild uses and loads the next
// one, so six open tabs cost what one costs. The price is a re-parse on switch,
// paid against a worker whose fonts and cmaps are already warm.
//
// It also means a background tab is never stale: it is read from disk at the
// moment you return to it, without anything having to watch it.

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

function icon(href) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', href);
  use.setAttributeNS(XLINK_NS, 'xlink:href', href);
  svg.append(use);
  return svg;
}

const SESSION_KEY = 'pdf-next.session';

function saveSession() {
  if (typeof localStorage === 'undefined' || launch?.smoke) return;
  try {
    if (!state.tabs.length) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const views = {};
    for (const [k, v] of state.views.entries()) {
      views[k] = v;
    }
    const current = state.tabs[state.active];
    if (current && state.file?.path === current.path) {
      const live = captureView();
      if (live) views[current.path] = live;
    }
    const payload = {
      tabs: state.tabs.map((t) => ({ path: t.path, name: t.name, kind: t.kind })),
      active: state.active,
      views,
      panes: panes.active ? panes.layout() : null,
      paneDirection: state.paneDirection,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  } catch {
    // Preference only.
  }
}

async function restoreSession() {
  if (typeof localStorage === 'undefined' || launch?.smoke) return false;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return false;
  }
  if (!saved || !Array.isArray(saved.tabs) || !saved.tabs.length) return false;
  if (saved.views && typeof saved.views === 'object') {
    for (const [k, v] of Object.entries(saved.views)) {
      if (v && typeof v === 'object') state.views.set(k, v);
    }
  }
  const validTabs = [];
  let activeIdx = -1;
  for (const [index, item] of saved.tabs.entries()) {
    if (typeof item?.path !== 'string') continue;
    try {
      const file = await invoke('open_path', { path: item.path, activate: false });
      if (index === Number(saved.active)) activeIdx = validTabs.length;
      validTabs.push({ path: file.path, name: file.name, kind: file.kind, target: null, file });
    } catch {
      // File moved or deleted since last session.
    }
  }
  if (!validTabs.length) return false;
  // The saved active tab may have been dropped; then the first tab that opened is shown.
  if (activeIdx < 0) activeIdx = 0;
  state.tabs = validTabs.map(({ path, name, kind, target }) => ({ path, name, kind, target }));
  state.active = activeIdx;
  state.paneDirection = saved.paneDirection === 'bottom' ? 'bottom' : 'right';
  const activeEntry = validTabs[activeIdx];
  // The layout is rebuilt before the tabs render, so the strip never flashes.
  const tiled = saved.panes && panes.restore(saved.panes, state.tabs);
  renderTabs();
  if (tiled) panes.mount(activeEntry.path);
  await openFile(activeEntry.file, {
    keepWindow: false,
    view: state.views.get(activeEntry.path) || null,
  });
  if (tiled) {
    for (const path of panes.visible()) void fillPane(path);
    watchVisiblePanes();
    syncPaneControl();
  }
  return true;
}

// ── Panes (tiles with tabs, src/panes.mjs) ─────────────────────────────

/// Paths shown in a pane but not live: kept current when their file changes.
/// A PDF viewer whose pane no longer shows its file is freed.
function watchVisiblePanes() {
  const paths = panes.active ? panes.visible().filter((path) => path !== panes.livePath) : [];
  paneViewers.keep(paths);
  for (const path of paths) if (!panes.snapshotOf(path)) void fillPane(path);
  invoke('watch_secondary', { paths }).catch(() => {});
}

/// The reviews of a document that is not live, to mark its pane with.
async function paneReviews(path) {
  try {
    return (await invoke('read_reviews', { document: path }))?.reviews ?? [];
  } catch {
    return [];
  }
}

/// Leave the live view in its pane before the stage moves on: a Markdown or
/// image copy, or a PDF viewer of its own that starts from the pixels.
function freezeLivePane() {
  const path = panes.livePath;
  if (!panes.active || !path || state.file?.path !== path) return;
  const still = snapshotOfStage({
    kind: state.file.kind,
    markdownStage: ui.markdownStage,
    viewerContainer: ui.container,
    imageStage: ui.imageStage,
    onPick: () => pickPane(path),
  });
  panes.freeze(path, state.file.kind === 'pdf' && state.document
    ? paneViewers.pdf(path, { url: sourceUrl(state.file), view: captureView(), reviews: state.reviews, still })
    : still);
}

/// Bring a pane that is not live up to date with its file, or fill one that
/// has nothing yet (a restored layout): Markdown is rendered with its review
/// marks, a PDF gets a viewer, an image its picture.
async function fillPane(path, revision = 0) {
  const tab = state.tabs.find((item) => item.path === path);
  if (!tab || !panes.has(path) || path === panes.livePath) return;
  let snapshot = panes.snapshotOf(path);
  if (tab.kind === 'pdf') {
    const url = sourceUrl({ path, revision });
    const reviews = await paneReviews(path);
    if (!panes.has(path) || path === panes.livePath) return;
    if (paneViewers.reload(path, url)) {
      paneViewers.setReviews(path, reviews);
    } else {
      panes.freeze(path, paneViewers.pdf(path, { url, view: state.views.get(path) ?? null, reviews }));
    }
    return;
  }
  if (tab.kind === 'image') {
    const url = sourceUrl({ path, revision });
    const image = snapshot?.querySelector('img');
    if (image) image.src = url;
    else panes.freeze(path, imagePane({ url, onPick: () => pickPane(path) }));
    return;
  }
  if (tab.kind === 'markdown') {
    try {
      const [doc, reviews] = await Promise.all([invoke('read_markdown', { path }), paneReviews(path)]);
      if (!panes.has(path) || path === panes.livePath) return;
      if (!snapshot?.querySelector('article#markdown')) {
        snapshot = snapshotOfStage({
          kind: 'markdown',
          markdownStage: ui.markdownStage,
          onPick: () => pickPane(path),
        });
        panes.freeze(path, snapshot);
      }
      const article = snapshot.querySelector('article#markdown');
      const scroller = snapshot.querySelector('#markdownStage');
      const top = scroller?.scrollTop ?? 0;
      article.hidden = false;
      article.innerHTML = doc.html;
      embedMarkdownImages(article, revision);
      colourCode(article);
      markFigures(article);
      paintMarkdownCopy(article, reviews, { collect: collectTextParts, wrap: wrapSpanParts });
      if (scroller) scroller.scrollTop = top;
    } catch {
      // The file may have gone; the pane keeps what it had.
    }
    return;
  }
  if (snapshot) return;
  const wrap = document.createElement('div');
  wrap.className = 'pane-snapshot';
  const card = document.createElement('div');
  card.className = 'pane-placeholder';
  const name = document.createElement('strong');
  name.textContent = tab.name;
  const hint = document.createElement('span');
  hint.className = 'dim';
  hint.textContent = 'Click to show';
  card.append(name, hint);
  const cover = document.createElement('div');
  cover.className = 'pane-cover';
  cover.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    void focusPane(path);
  });
  wrap.append(card, cover);
  panes.freeze(path, wrap);
}

/// Make a pane live where its copy stands, so that a drag begun on the copy
/// selects the same text in the live view.
function pickPane(path) {
  const scroller = panes.snapshotOf(path)?.querySelector(':scope > #markdownStage');
  const tab = state.tabs.find((item) => item.path === path);
  if (scroller && tab) {
    const { anchorLine, anchorDoc, anchorOffset, ...view } = state.views.get(path) ??
      { kind: tab.kind, scale: state.markdownScale, raw: state.markdownRaw };
    state.views.set(path, { ...view, top: scroller.scrollTop, left: scroller.scrollLeft });
  }
  return focusPane(path);
}

async function focusPane(path) {
  const index = state.tabs.findIndex((tab) => tab.path === path);
  if (index >= 0) await activateTab(index, { force: index !== state.active });
}

/// Open a pane beside the live one, in `direction` (right or bottom). It
/// shows the next tab that is not on screen yet, or a file you pick, and
/// becomes the live pane.
async function splitPane(direction = 'right') {
  if (!state.file) {
    setStatus('Open a file first');
    syncPaneControl();
    return;
  }
  const shown = new Set(panes.active ? panes.visible() : [state.tabs[state.active]?.path]);
  const order = [...state.tabs.slice(state.active + 1), ...state.tabs.slice(0, state.active)];
  let next = order.find((tab) => !shown.has(tab.path))?.path;
  if (!next) {
    const picked = await invoke('pick_file').catch(() => null);
    if (!picked) {
      syncPaneControl();
      return;
    }
    const file = await invoke('open_path', { path: picked, activate: false }).catch((error) => {
      setStatus(String(error), { error: true });
      return null;
    });
    if (!file) {
      syncPaneControl();
      return;
    }
    if (!state.tabs.some((tab) => tab.path === file.path)) {
      state.tabs.push({ path: file.path, name: file.name, kind: file.kind, target: null });
      // In a tiled window the new tab needs its panel before it can move.
      renderTabs();
    }
    next = file.path;
    if (shown.has(next)) {
      setStatus(`${file.name} is already on screen`);
      syncPaneControl();
      return;
    }
  }
  const activePath = state.tabs[state.active]?.path;
  if (!panes.active) {
    panes.enter({
      paths: state.tabs.map((tab) => tab.path),
      titles: new Map(state.tabs.map((tab) => [tab.path, tab.name])),
      activePath,
      newPath: next,
      direction,
    });
    // The stage was in the window; the pane that had it is the live one now.
    panes.mount(activePath);
  } else {
    panes.split(next, direction);
  }
  state.paneDirection = direction;
  await focusPane(next);
  syncPaneControl();
  saveSession();
}

/// Back to one pane, keeping every tab.
function mergePanes() {
  if (panes.active) panes.exit();
}

function onPanesExit(order) {
  const live = state.tabs[state.active]?.path;
  const rank = new Map(order.map((path, index) => [path, index]));
  state.tabs.sort((a, b) => (rank.get(a.path) ?? 1e9) - (rank.get(b.path) ?? 1e9));
  state.active = Math.max(0, state.tabs.findIndex((tab) => tab.path === live));
  ui.panes.after(ui.stage);
  invoke('watch_secondary', { paths: [] }).catch(() => {});
  renderTabs();
  syncPaneControl();
}

function syncPaneControl() {
  if (ui.splitView) ui.splitView.value = panes.active ? (state.paneDirection === 'bottom' ? 'bottom' : 'right') : 'off';
}

async function setSplitView(mode) {
  if (mode === 'right' || mode === 'bottom') {
    await splitPane(mode);
  } else {
    mergePanes();
    syncPaneControl();
  }
}

async function movePaneFocus(direction) {
  const path = panes.neighbour(direction);
  if (path) await focusPane(path);
}

function renderTabs() {
  document.body.classList.toggle('has-tabs', state.tabs.length > 1 && !panes.active);
  ui.tabs.textContent = '';
  saveSession();
  if (panes.active) {
    panes.sync(state.tabs);
    return;
  }
  if (state.tabs.length < 2) {
    return;
  }
  state.tabs.forEach((tab, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab';
    button.setAttribute('role', 'tab');
    button.title = tab.path;
    button.setAttribute('aria-selected', String(index === state.active));

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = tab.name;
    button.append(label);

    const shut = document.createElement('span');
    shut.className = 'shut';
    shut.setAttribute('aria-label', `Close ${tab.name}`);
    shut.append(icon('#i-close'));
    button.append(shut);

    button.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('.shut')) {
        void closeTab(index);
        return;
      }
      void activateTab(index);
    });
    button.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        void closeTab(index);
      }
    });
    ui.tabs.append(button);
    if (index === state.active) {
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
}

/// Focus the file if it is already open; otherwise add it next to the current
/// tab, where a file opened from the one you are reading belongs.
///
/// `activate: false` adds the tab and loads nothing: ten files dropped at once
/// cost one parse, not ten, and the one you are looking at stays put. A file
/// already open is left alone in that case.
async function openInTab(file, { activate = true, target = null } = {}) {
  const existing = state.tabs.findIndex((tab) => tab.path === file.path);
  if (existing >= 0) {
    // A file that is already open is aimed rather than opened twice: a second
    // `pdf-next paper.pdf --page 12` moves the tab you are reading. If it is a
    // background tab, the target waits there until you switch to it.
    if (target) {
      state.tabs[existing].target = target;
    }
    if (activate) {
      await activateTab(existing, { force: true });
    } else if (existing === state.active) {
      // Already the one showing: aim it where it stands, without a re-parse.
      await consumeTarget(state.tabs[existing]);
    }
    return;
  }
  const entry = { path: file.path, name: file.name, kind: file.kind, target };
  if (!activate) {
    // Appended, not inserted next to the active tab: files that arrive
    // together must keep the order they arrived in.
    state.tabs.push(entry);
    renderTabs();
    return;
  }
  const at = state.active < 0 ? state.tabs.length : state.active + 1;
  freezeLivePane();
  stashView();
  state.tabs.splice(at, 0, entry);
  state.active = at;
  renderTabs();
  if (panes.active) panes.mount(file.path);
  await openFile(file, { keepWindow: state.tabs.length > 1 });
  await consumeTarget(entry);
}

/// Park the outgoing file's page, zoom and scroll so the tab comes back to the
/// place you left it rather than to the top of the document.
function stashView() {
  const current = state.tabs[state.active];
  if (!current) {
    return;
  }
  const view = captureView();
  if (view) {
    state.views.set(current.path, view);
  }
}

async function activateTab(index, { force = false } = {}) {
  const tab = state.tabs[index];
  if (!tab || (index === state.active && !force)) {
    return;
  }
  freezeLivePane();
  stashView();
  state.active = index;
  renderTabs();
  if (panes.active) panes.mount(tab.path);
  try {
    const file = await invoke('open_path', { path: tab.path });
    // Keep the name fresh in case the file moved out from under the tab.
    tab.name = file.name;
    tab.kind = file.kind;
    await openFile(file, {
      keepWindow: true,
      view: state.views.get(tab.path) || null,
    });
    if (panes.active) watchVisiblePanes();
    // After the remembered view, not before: an explicit page wins over where
    // this tab was last left.
    await consumeTarget(tab);
  } catch (error) {
    setStatus(String(error), { error: true, sticky: true });
  }
}

async function closeTab(index) {
  const tab = state.tabs[index];
  if (!tab) {
    return;
  }
  state.views.delete(tab.path);
  state.tabs.splice(index, 1);
  if (!state.tabs.length) {
    await closeAll();
    return;
  }
  if (index < state.active) {
    state.active -= 1;
    renderTabs();
    return;
  }
  if (index > state.active) {
    renderTabs();
    return;
  }
  // The closed tab was the one showing: take its right-hand neighbour, or the
  // last tab if it was the rightmost.
  state.active = Math.min(index, state.tabs.length - 1);
  renderTabs();
  await activateTab(state.active, { force: true });
}

/// Back to the small empty window you get on a cold start.
async function closeAll() {
  const generation = ++state.generation;
  await flushCommentSave();
  if (state.generation !== generation) {
    return;
  }
  await invoke('close_document');
  if (state.generation !== generation) {
    return;
  }
  if (panes.active) panes.exit();
  state.tabs = [];
  state.active = -1;
  state.views.clear();
  state.file = null;
  state.natural = null;
  state.siblings = [];
  state.siblingIndex = -1;
  state.pendingRevision = null;
  await releaseDocument();
  if (state.generation !== generation) {
    return;
  }
  ui.image.removeAttribute('src');
  ui.markdown.textContent = '';
  ui.markdownRaw.textContent = '';
  setImageRotation(0, { refit: false });
  setImageScale('fit', { refit: false });
  document.body.classList.remove(
    'has-file',
    'kind-pdf',
    'kind-image',
    'kind-markdown',
    'kind-json',
    'file-missing',
  );
  setTitle('');
  ui.waiting.hidden = true;
  updateSiblingControls();
  renderTabs();
  closeFind();
  hideReviewChrome();
  ui.noteBox.hidden = true;
  ui.noteText.value = '';
  state.reviewGrown = false;
  await setReviewOpen(false);
  if (state.generation !== generation) {
    return;
  }
  applyReviewStore({ reviews: [] });
  setStatus('');
}

function cycleTab(delta) {
  if (state.tabs.length < 2) {
    return;
  }
  const count = state.tabs.length;
  void activateTab((state.active + delta + count) % count);
}

// The wheel over the tab strip walks the tabs, wrapping at the ends. A
// trackpad sends a stream of small deltas, so they are summed until they
// make one notch's worth; a mouse wheel moves one tab per notch.
let tabWheel = 0;
let tabWheelAt = 0;
ui.tabs.addEventListener('wheel', (event) => {
  if (state.tabs.length < 2 || event.ctrlKey) {
    return;
  }
  event.preventDefault();
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  const unit = event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100;
  const now = event.timeStamp;
  if (now - tabWheelAt > 300) {
    tabWheel = 0;
  }
  tabWheelAt = now;
  tabWheel += delta / unit;
  if (Math.abs(tabWheel) < 0.5) {
    return;
  }
  const step = tabWheel > 0 ? 1 : -1;
  tabWheel = 0;
  cycleTab(step);
}, { passive: false });

// The wheel over a toolbar menu steps through its choices without opening it:
// up for the next choice (bigger, for size, width and zoom), down for the one
// before. Over the zoom menu and its buttons it zooms through the same ladder
// as + and -. Trackpad deltas are summed to one notch, as on the tab strip.
const wheelNotches = new WeakMap();
function wheelNotch(target, event) {
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : -event.deltaX;
  const unit = event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100;
  const last = wheelNotches.get(target) ?? { sum: 0, at: 0 };
  const sum = (event.timeStamp - last.at > 300 ? 0 : last.sum) + delta / unit;
  if (Math.abs(sum) < 0.5) {
    wheelNotches.set(target, { sum, at: event.timeStamp });
    return 0;
  }
  wheelNotches.set(target, { sum: 0, at: event.timeStamp });
  return sum < 0 ? 1 : -1;
}

/// Move `select` one usable choice in `direction` and announce the change, so
/// every menu keeps its own change handler as the one place it takes effect.
function stepSelect(select, direction) {
  const options = Array.from(select.options);
  let index = select.selectedIndex;
  for (let guard = 0; guard < options.length; guard += 1) {
    index += direction;
    if (index < 0 || index >= options.length) return false;
    const option = options[index];
    if (!option.hidden && !option.disabled) {
      select.selectedIndex = index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  return false;
}

function onMenuWheel(event) {
  const control = event.currentTarget;
  if (control.disabled || event.ctrlKey) return;
  event.preventDefault();
  const direction = wheelNotch(control, event);
  if (!direction) return;
  if (control === ui.zoom || control === ui.zoomIn || control === ui.zoomOut) {
    stepZoom(direction);
  } else {
    stepSelect(control, direction);
  }
}

function wireMenuWheel() {
  const controls = new Set([
    ...document.querySelectorAll('#bar select, #settingsPanel select'),
    ui.zoomIn,
    ui.zoomOut,
  ]);
  for (const control of controls) {
    if (control) control.addEventListener('wheel', onMenuWheel, { passive: false });
  }
}

// ── Page and zoom controls ────────────────────────────────────────────────

function updatePageControls() {
  const count = pdfViewer.pagesCount || 0;
  const current = pdfViewer.currentPageNumber || 1;
  ui.page.value = String(current);
  ui.page.max = String(Math.max(count, 1));
  ui.pages.textContent = count ? `/ ${count}` : '/ —';
  ui.prev.disabled = current <= 1;
  ui.next.disabled = current >= count;
}

function updateZoomControl(scaleValue, scale) {
  const preset = ui.zoom.querySelector(`option[value="${scaleValue}"]`);
  if (preset) {
    removeCustomZoom();
    ui.zoom.value = scaleValue;
    return;
  }
  // Keyboard and button zoom land between presets; show the live percentage in
  // the control rather than letting it read a stale preset.
  let custom = ui.zoom.querySelector('option[value="custom"]');
  if (!custom) {
    custom = document.createElement('option');
    custom.value = 'custom';
    custom.hidden = true;
    ui.zoom.append(custom);
  }
  custom.textContent = `${Math.round(scale * 100)}%`;
  ui.zoom.value = 'custom';
}

function removeCustomZoom() {
  ui.zoom.querySelector('option[value="custom"]')?.remove();
}

function stepZoom(direction) {
  const kind = state.file?.kind;
  const image = kind === 'image';
  const markdown = kind === 'markdown' || kind === 'json';
  if (!image && !markdown && !state.document) {
    return;
  }
  const current = image
    ? imageScale()
    : markdown
      ? state.markdownScale
      : pdfViewer.currentScale;
  const next =
    direction > 0
      ? ZOOM_STEPS.find((step) => step > current + 0.001)
      : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.001);
  if (!next) {
    return;
  }
  if (image) {
    setImageScale(next);
  } else if (markdown) {
    setMarkdownScale(next);
  } else {
    pdfViewer.currentScaleValue = String(next);
  }
}

/// The preset ladder means something slightly different for a bare image: there
/// is no page, so "fit page" is the scale that contains it and the other two
/// fits are the CSS default, which fills the width and lets the height run.
function applyZoomChoice(value) {
  if (state.file?.kind === 'markdown' || state.file?.kind === 'json') {
    // Prose has no page to fit; every preset lands back at the natural size.
    const scale = Number(value);
    setMarkdownScale(Number.isFinite(scale) && scale > 0 ? scale : 1);
    return;
  }
  if (state.file?.kind !== 'image') {
    pdfViewer.currentScaleValue = value;
    return;
  }
  if (value === 'page-fit') {
    setImageScale('page-fit');
  } else if (value === 'auto' || value === 'page-width') {
    setImageScale('fit');
  } else {
    const scale = Number(value);
    if (Number.isFinite(scale) && scale > 0) {
      setImageScale(scale);
    }
  }
}

// ── Page modes ────────────────────────────────────────────────────────────

/// Page colors are drawn into the page canvas, not laid over it, so changing
/// them only shows once the canvas is drawn again. Setting the colors and
/// calling refresh() is not that: refresh() goes through PDFPageView.update(),
/// which — with the page geometry unchanged — resets with keepCanvasWrapper
/// and never calls _resetCanvas(). The old bitmap stays, so leaving sepia used
/// to give a white page with brown text. Dropping each canvas is the fix.
function applyPageColors() {
  const pageColors = pageColorsFor(state.mode);
  pdfViewer.pageColors = pageColors;
  const pages = pdfViewer._pages;
  if (!Array.isArray(pages) || !state.document) {
    return;
  }
  for (const pageView of pages) {
    pageView.pageColors = pageColors;
    try {
      // No keepCanvasWrapper: the canvas has to go or the old colors stay.
      pageView.reset();
    } catch {
      // A page that will not reset is redrawn by the next update anyway.
    }
  }
  pdfViewer.update();
}

function setMode(mode, persist = true) {
  state.mode = mode;
  for (const candidate of PAGE_MODES) {
    document.body.classList.toggle(`mode-${candidate}`, candidate === mode);
  }
  document.body.classList.toggle('mode-auto', !mode);
  ui.mode.classList.toggle('on', Boolean(mode));
  ui.mode.setAttribute('aria-pressed', String(Boolean(mode)));
  ui.mode.title = mode
    ? `Page mode: ${mode} (Shift+click to clear)`
    : 'Page mode: off';
  ui.modeName.textContent = mode ? mode[0].toUpperCase() + mode.slice(1) : 'Clear';
  applyPageColors();
  paneViewers.recolor();
  if (!persist) {
    // A command-line flag styles this window; it is not a new preference.
    return;
  }
  try {
    localStorage.setItem('pdf-next.mode', mode || '');
  } catch {
    // Storage is a convenience here, never a requirement.
  }
}

function cycleMode(clear) {
  if (clear) {
    setMode(null);
    return;
  }
  const index = MODE_CYCLE.indexOf(state.mode ?? null);
  setMode(MODE_CYCLE[(index + 1) % MODE_CYCLE.length]);
}

// ── Find ──────────────────────────────────────────────────────────────────

function openFind() {
  if (state.file?.kind !== 'pdf' && state.file?.kind !== 'markdown') {
    return;
  }
  if (state.file.kind === 'markdown' && state.markdownRaw) {
    setRaw(false, { persist: false });
  }
  ui.find.hidden = false;
  ui.findInput.focus();
  ui.findInput.select();
}

/// Markdown find marks the page, so typing waits for a pause first.
let findTimer = 0;

function closeFind() {
  window.clearTimeout(findTimer);
  findTimer = 0;
  ui.find.hidden = true;
  ui.findCount.textContent = '';
  clearMarkdownFind();
  eventBus.dispatch('findbarclose', { source: null });
  ui.container.focus();
}

/// Most hits that are marked; the count then reads "1000+".
const FIND_LIMIT = 1000;

/// Find in the rendered article. Each hit is one `mark.aim.find`, or several
/// when it crosses inline markup. `state.mdFind` holds them in reading order.
/// One character matches nearly everything, so a search starts at two.
function buildMarkdownFind(keepIndex = false) {
  const index = keepIndex ? (state.mdFind?.index ?? 0) : 0;
  unwrapMarks(ui.markdown, 'mark.aim.find');
  const want = normalizeReviewText(ui.findInput.value);
  const hits = [];
  let capped = false;
  if (want.length >= 2) {
    const { joined, parts } = collectTextParts(ui.markdown, true);
    const spans = findAllSpans(joined, want, FIND_LIMIT + 1);
    capped = spans.length > FIND_LIMIT;
    spans.length = Math.min(spans.length, FIND_LIMIT);
    // Last to first, so that wrapping one hit leaves the offsets of the rest valid.
    for (let at = spans.length - 1; at >= 0; at -= 1) {
      const marks = [];
      wrapSpanParts(ui.markdown, parts, spans[at], () => {
        const mark = document.createElement('mark');
        mark.className = 'aim find';
        marks.push(mark);
        return mark;
      });
      hits.push(marks);
    }
    hits.reverse();
  }
  state.mdFind = { hits, capped, index: Math.min(index, Math.max(0, hits.length - 1)) };
  showMarkdownFind(false);
}

function showMarkdownFind(scroll) {
  const { hits, index, capped } = state.mdFind;
  ui.findCount.textContent = hits.length
    ? `${index + 1} of ${hits.length}${capped ? '+' : ''}`
    : (normalizeReviewText(ui.findInput.value).length >= 2 ? 'No match' : '');
  hits.forEach((marks, at) => marks.forEach((mark) => mark.classList.toggle('current', at === index)));
  if (scroll) {
    hits[index]?.[0].scrollIntoView({ block: 'center' });
  }
}

/// Move to the next (+1) or previous (-1) hit, wrapping at the ends. A step
/// of 0 shows the current one.
function stepMarkdownFind(step) {
  if (!state.mdFind?.hits[0]?.[0].isConnected) {
    buildMarkdownFind();
    step = 0;
  }
  const { hits } = state.mdFind;
  if (hits.length) {
    state.mdFind.index = (state.mdFind.index + step + hits.length) % hits.length;
  }
  showMarkdownFind(true);
}

function clearMarkdownFind() {
  if (state.mdFind) {
    unwrapMarks(ui.markdown, 'mark.aim.find');
    state.mdFind = null;
  }
}

function runFind(type = '', again = false, backwards = false) {
  if (state.file?.kind === 'markdown') {
    if (again) {
      stepMarkdownFind(backwards ? -1 : 1);
    } else {
      buildMarkdownFind();
      showMarkdownFind(true);
    }
    return;
  }
  eventBus.dispatch('find', {
    source: null,
    type,
    query: ui.findInput.value,
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
    findPrevious: backwards,
    matchDiacritics: false,
    ...(again ? { findPrevious: backwards } : {}),
  });
}

// ── Printing ──────────────────────────────────────────────────────────────
//
// One route for all three platforms and all three kinds: lay the document out
// for paper in the webview, then ask the system for its own print dialog — the
// print panel on macOS, the GTK dialog on Linux, the print window every other
// application opens on Windows. Printer, page range, copies, duplex, scaling
// and paper size are the system's to offer; this app has no print settings of
// its own to get wrong, and nothing to keep in sync with three platforms'
// idea of a printer.
//
// Markdown and the raw view print themselves — they are HTML, and the print
// stylesheet reflows them across pages. A PDF cannot: the viewer only ever
// renders the pages you can see, at screen resolution, possibly inverted. So
// every page is rendered again here, at print resolution, on white, into
// #printPages, which is what the dialog then sees. Images take the same route
// for the same reason: one page, one picture, no window chrome.

/// 150 dpi against PDF's 72, the resolution PDF.js itself prints at: sharp on
/// paper without making a 300-page document a gigabyte of canvas.
const PRINT_UNITS = 150 / 72;

/// A print is being prepared: the pages are still being rendered.
let printing = false;
/// The pages are laid out and a dialog has them. This is the one that matters:
/// the dialog outlives the call that opened it on Windows and macOS, and this
/// app reloads the document once a second, so without it the next rebuild —
/// the whole reason the app exists — would empty the DOM the dialog is about
/// to print.
let printPending = false;
/// Whether the window has lost focus since those pages were handed over, which
/// is how the dialog closing is recognised where `afterprint` may not fire.
let printBlurred = false;

/// Drop the rendered pages and the object URLs holding their bitmaps.
///
/// The pages are not kept around: they are the largest thing this app ever
/// allocates, and a document that has been printed once is no more likely to
/// be printed again. Only blob URLs are revoked — an image prints through the
/// same doc:// URL the window is showing, and revoking that would take the
/// picture off the screen.
function clearPrintPages() {
  for (const img of ui.printPages.querySelectorAll('img')) {
    if (img.src.startsWith('blob:')) {
      URL.revokeObjectURL(img.src);
    }
  }
  ui.printPages.textContent = '';
  ui.printRules.textContent = '';
}

/// The dialog is done with the pages: drop them.
function finishPrint() {
  if (!printPending) {
    return;
  }
  printPending = false;
  printBlurred = false;
  clearPrintPages();
}

/// Render every page of the open PDF onto paper-sized images.
///
/// One canvas is reused for all of them and released at the end, so the peak
/// cost is a single page rather than the whole document; what stays is one PNG
/// per page, which is what the print dialog needs in the DOM to offer a page
/// range at all.
async function renderPrintPages(generation) {
  const pdf = state.document;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });

  for (let number = 1; number <= pdf.numPages; number += 1) {
    if (state.generation !== generation) {
      return false; // the file changed under us; that print is stale
    }
    if (pdf.numPages > 4) {
      setStatus(`Preparing page ${number} of ${pdf.numPages}…`, { sticky: true });
    }

    const page = await pdf.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    canvas.width = Math.floor(viewport.width * PRINT_UNITS);
    canvas.height = Math.floor(viewport.height * PRINT_UNITS);
    // Paper is white whatever the reader's page mode is; a night-mode PDF must
    // not come out of the printer as a solid black rectangle.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context,
      viewport,
      transform: [PRINT_UNITS, 0, 0, PRINT_UNITS, 0, 0],
      intent: 'print',
    }).promise;
    page.cleanup();

    if (number === 1) {
      // The paper takes the shape of the page, so an A4 document prints at true
      // size on A4 and a landscape slide comes out landscape. Pages of mixed
      // size follow the first, as they do in every other PDF viewer.
      ui.printRules.textContent = `@page { size: ${Math.round(viewport.width)}pt ${Math.round(
        viewport.height,
      )}pt; margin: 0 }`;
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      throw new Error(`page ${number} could not be rendered`);
    }
    const wrapper = document.createElement('div');
    const img = document.createElement('img');
    img.src = URL.createObjectURL(blob);
    img.alt = '';
    wrapper.append(img);
    ui.printPages.append(wrapper);
    await img.decode().catch(() => {});
  }

  // Releasing the backing store matters more than the canvas object: a
  // letter-size page at 150 dpi is 5 MB that nothing else would free.
  canvas.width = 0;
  canvas.height = 0;
  return true;
}

/// Ctrl/Cmd+P, and the toolbar button.
async function printDocument() {
  if (!state.file || printing) {
    return;
  }
  printing = true;
  printPending = false;
  printBlurred = false;
  clearPrintPages();
  const generation = state.generation;
  let failed = false;

  try {
    if (state.file.kind === 'pdf') {
      // No document, or a rebuild overtook this print: nothing to send.
      if (!state.document || !(await renderPrintPages(generation))) {
        return;
      }
    } else if (state.file.kind === 'image') {
      const img = document.createElement('img');
      img.src = ui.image.src;
      img.alt = '';
      const wrapper = document.createElement('div');
      wrapper.append(img);
      ui.printPages.append(wrapper);
      await img.decode().catch(() => {});
    }
    if (state.generation !== generation) {
      return;
    }
    setStatus('');
    // Claimed before the call, not after: on Linux the dialog blocks and this
    // does not return until it has been closed.
    printPending = true;
    await invoke('print_document');
  } catch (error) {
    failed = true;
    printPending = false;
    setStatus(`Could not print: ${error?.message || error}`, { error: true, sticky: true });
  } finally {
    printing = false;
    // Every way out that never reached a dialog leaves half-built pages and a
    // "preparing page 3 of 40" that nothing else would ever clear.
    if (!printPending) {
      clearPrintPages();
      if (!failed) {
        setStatus('');
      }
    }
  }
}

// Two ways to hear that the dialog has gone. `afterprint` is the direct one,
// and Windows fires it — measured, including when the system dialog opens onto
// a machine with no print spooler at all. macOS and Linux never go through
// window.print(), so there the window coming back after losing focus stands in
// for it, where it fires: a sheet on macOS may never give the page a blur, and
// the price of missing it is pages held until the next print rather than
// anything printed wrongly.
//
// Windows is left out of that fallback deliberately. Its dialog is a separate
// window and this one stays clickable behind it, so clicking back would
// otherwise throw away the pages the dialog is still holding — the bug this
// whole flag exists to prevent, through a different door.
window.addEventListener('afterprint', finishPrint);
window.addEventListener('blur', () => {
  printBlurred = printPending;
});
window.addEventListener('focus', () => {
  if (printBlurred && state.platform !== 'windows') {
    finishPrint();
  }
});

/// Five targets, one function. An edge fills that half of the screen; center —
/// or the edge the window is already on — undocks: the automatic fit, the
/// window wrapped around the page again, at fit-page.
///
/// Docking anywhere fits the width: a half-screen window is there to be read
/// in, and fit-page in one shrinks the text to fit a shape you did not choose.
/// A short top or bottom half does leave the rest of the page below the fold,
/// which is what scrolling is for. Resizing keeps the scroll offset in
/// pixels, which lands on a different page once the layout reflows, so the
/// reader goes back where it was either way.
async function dockTo(edge) {
  const page = state.document ? pdfViewer.currentPageNumber : 0;
  const undocking = edge === 'center' || state.docked === edge;
  // Docking sets an explicit half-screen size, which wrap would immediately
  // undo. Only one of them can own the window.
  if (state.wrap) {
    window.clearTimeout(wrapTimer);
    setWrap(false);
  }

  // A half-screen window is the app's choice, not the reader's: it must not be
  // remembered as the size to reopen this file at.
  holdResize();
  try {
    if (undocking) {
      setDocked(null);
      if (state.document) {
        pdfViewer.currentScaleValue = '1';
        await waitForPdfPageBox();
      }
      await trimWindowToContent({ recenter: true });
    } else {
      await invoke('snap', { edge });
    }
  } catch {
    return;
  } finally {
    holdResize();
  }

  setDocked(undocking ? null : edge);
  if (!state.document) {
    return;
  }
  // The preset is set now; the container observer re-applies it once the window
  // has actually changed shape. The delay is for the page: restoring it before
  // the reflow lands puts the scroll offset on the old layout.
  if (!undocking) {
    pdfViewer.currentScaleValue = 'page-width';
  }
  window.setTimeout(() => {
    if (page > 1) {
      pdfViewer.currentPageNumber = page;
    }
  }, 160);
}

function setDocked(edge) {
  state.docked = edge;
  for (const [name, button] of Object.entries(ui.dockButtons)) {
    if (name === 'center') {
      continue; // an action, not a state — it never lights up
    }
    button.classList.toggle('on', edge === name);
    button.setAttribute('aria-pressed', String(edge === name));
  }
  ui.dockMenuButton.classList.toggle('on', Boolean(edge) || state.wrap);
}


// ── Selection and Ask ─────────────────────────────────────────────────────

/// Find the basename of a file from its path.
function basenameFromPath(path) {
  if (!path) return 'file';
  const match = path.match(/[/\\]([^/\\]*)$/);
  return match ? match[1] : path;
}

async function copyFileText(which) {
  if (!state.file) {
    setStatus('Open a file first');
    return;
  }
  const text = which === 'name' ? state.file.name : state.file.path;
  if (!text) {
    setStatus('Nothing to copy');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    setStatus(which === 'name' ? 'Copied the file name' : 'Copied the full path');
  } catch {
    setStatus('Clipboard refused the text', { error: true });
  }
}

/// The last `[data-line]` at or before `node` in the rendered Markdown.
function lineNear(node, root) {
  if (!node || !root) {
    return null;
  }
  const el = node.nodeType === 3 ? node.parentElement : node;
  if (!(el instanceof Element) || !root.contains(el)) {
    return null;
  }
  const anchor = el.closest('[data-line]');
  if (anchor && root.contains(anchor)) {
    const line = Number(anchor.dataset.line);
    return Number.isFinite(line) && line >= 1 ? line : null;
  }
  const block = el.closest('#markdown > *:not(.md-page), .md-page > *');
  const inBlock = block?.querySelector('[data-line]');
  if (inBlock) {
    const line = Number(inBlock.dataset.line);
    return Number.isFinite(line) && line >= 1 ? line : null;
  }
  const walker = document.createNodeIterator(root, NodeFilter.SHOW_ELEMENT, (candidate) => {
    if (!candidate.hasAttribute('data-line')) {
      return NodeFilter.FILTER_SKIP;
    }
    if (candidate.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return NodeFilter.FILTER_ACCEPT;
    }
    return NodeFilter.FILTER_SKIP;
  });
  let last = null;
  let current;
  while ((current = walker.nextNode())) {
    last = current;
  }
  const line = last ? Number(last.dataset.line) : NaN;
  return Number.isFinite(line) && line >= 1 ? line : null;
}

function pageNear(node) {
  const el = node.nodeType === 3 ? node.parentElement : node;
  const pageEl = el?.closest?.('.page');
  const page = Number(pageEl?.dataset.pageNumber);
  return Number.isFinite(page) && page >= 1 ? page : null;
}

function pdfAnchorForSelection(range, pageNumber, quote) {
  const page = ui.viewer.querySelector(`.page[data-page-number="${pageNumber}"]`);
  const pageView = pdfViewer.getPageView(pageNumber - 1);
  const rect = range.getBoundingClientRect();
  let position = null;
  if (page && pageView?.viewport && pageView.pdfPage && rect) {
    const pageRect = page.getBoundingClientRect();
    const viewport = pageView.viewport;
    const points = pageView.pdfPage.getViewport({ scale: 1, rotation: viewport.rotation });
    position = {
      page: pageNumber,
      x: Math.max(0, (rect.left - pageRect.left) * points.width / viewport.width),
      y: Math.max(0, (rect.top - pageRect.top) * points.height / viewport.height),
    };
  }
  let prefix = '';
  let suffix = '';
  const layer = page?.querySelector('.textLayer');
  if (layer) {
    const text = normalizeReviewText(collectTextParts(layer).joined);
    const found = resolveReviewAnchor([{ page: pageNumber, text }], quote);
    if (found.status === 'located') {
      prefix = text.slice(Math.max(0, found.start - 48), found.start);
      suffix = text.slice(found.end, found.end + 48);
    }
  }
  if (!position && !prefix && !suffix) return null;
  return { prefix, suffix, documentRevision: state.file?.revision ?? null, ...(position ? { position } : {}) };
}

/// `{ line }` / `{ page }`, plus `end` when the range is more than one.
function atRange(start, end, key) {
  if (start == null) {
    return {};
  }
  const lo = end == null ? start : Math.min(start, end);
  const hi = end == null ? start : Math.max(start, end);
  return hi === lo ? { [key]: lo } : { [key]: lo, end: hi };
}

/// Text before and after a Markdown selection, read from a copy of the article
/// with the review and find marks taken out, as paintMarkdownMarks reads it.
function markdownAnchorForSelection(range) {
  if (!ui.markdown.contains(range.startContainer) || !ui.markdown.contains(range.endContainer)) {
    return null;
  }
  const textAround = (limit) => {
    const edge = document.createRange();
    edge.selectNodeContents(ui.markdown);
    limit(edge);
    const copy = edge.cloneContents();
    unwrapMarks(copy, 'mark.aim');
    unwrapReviewMarks(copy);
    return collectTextParts(copy, true).joined;
  };
  const before = textAround((edge) => edge.setEnd(range.startContainer, range.startOffset));
  const after = textAround((edge) => edge.setStart(range.endContainer, range.endOffset));
  const { prefix, suffix } = selectionContext(before, after);
  return { prefix, suffix, documentRevision: state.markdownDigest };
}

/// The current selection as a review record, or null. `context` also reads the
/// surrounding text, which costs a pass over the article: only for saving.
function describeSelection({ context = false } = {}) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return null;
  }
  // Matching collapses whitespace anyway, so the store keeps the quote on one
  // line: an equation read out of MathML puts a newline between glyphs.
  const quote = selection.toString().replace(/\s+/g, ' ').trim();
  if (!quote) {
    return null;
  }
  const file = state.file ? basenameFromPath(state.file.path) : 'file';
  if (state.file?.kind === 'markdown') {
    const start = lineNear(selection.anchorNode, ui.markdown);
    const end = lineNear(selection.focusNode, ui.markdown);
    // Raw mode has no article to read context from, but the digest is still the one this view shows.
    const anchor = context
      ? (markdownAnchorForSelection(selection.getRangeAt(0)) ??
        (state.markdownDigest ? { documentRevision: state.markdownDigest } : null))
      : null;
    return { file, kind: 'markdown', at: atRange(start, end, 'line'), quote, ...(anchor ? { anchor } : {}) };
  }
  if (state.file?.kind === 'pdf') {
    const start = pageNear(selection.getRangeAt(0).startContainer);
    const end = pageNear(selection.getRangeAt(selection.rangeCount - 1).endContainer);
    const range = selection.getRangeAt(0);
    return {
      file, kind: 'pdf', at: atRange(start, end, 'page'), quote,
      anchor: pdfAnchorForSelection(range, start, quote),
    };
  }
  return null;
}

/// Human form of a record: `collab.md:12-18` or `paper.pdf p.7`.
function formatSelection(record) {
  if (!record) {
    return '';
  }
  if (record.kind === 'markdown' && record.at?.line) {
    const end = record.at.end && record.at.end !== record.at.line ? `-${record.at.end}` : '';
    return `${record.file}:${record.at.line}${end}`;
  }
  if (record.kind === 'pdf' && record.at?.page) {
    const end = record.at.end && record.at.end !== record.at.page ? `-${record.at.end}` : '';
    return `${record.file} p.${record.at.page}${end}`;
  }
  return record.file;
}

/// Normalise text for clipboard: collapse spaces, collapse long newlines, cap at 20k, format as quote.
function normaliseText(text) {
  // Collapse runs of spaces/tabs to one space
  let normalized = text.replace(/[ \t]+/g, ' ');
  // Collapse 3+ newlines to 2
  normalized = normalized.replace(/\n{3,}/g, '\n\n');
  // Trim
  normalized = normalized.trim();
  // Cap at 20000 characters
  if (normalized.length > 20000) {
    normalized = normalized.substring(0, 20000) + '…';
  }
  return normalized;
}

function hasLocator(record) {
  return Boolean(record.at?.line || record.at?.page);
}

let reviewAnchorRect = null;

function openNoteBox(action = 'improve') {
  const picked = describeSelection({ context: true });
  const range = selectionInDocument();
  const rect =
    range && (range.getBoundingClientRect().width || range.getBoundingClientRect().height)
      ? range.getBoundingClientRect()
      : reviewAnchorRect;
  hideReviewChrome();
  if (!picked) {
    setStatus('Select some text first');
    return;
  }
  if (!hasLocator(picked)) {
    setStatus(
      picked.kind === 'pdf'
        ? 'Select text on a page'
        : 'Select text on a source line',
    );
    return;
  }

  state.pendingNote = picked;
  state.pendingNotePdf = picked.kind === 'pdf' && state.document
    ? { path: state.file.path, digestPromise: pdfDocumentDigest(state.document).catch(() => null) }
    : null;
  ui.noteRef.textContent = formatSelection(picked);
  ui.noteQuote.textContent = picked.quote;
  ui.noteAction.value = REVIEW_ACTIONS.includes(action) ? action : 'improve';
  ui.noteText.value = '';
  state.pendingRequests = [];
  renderNoteRequests();
  updateNotePlaceholder();
  ui.noteText.hidden = false;
  ui.noteBox.hidden = false;
  placeNoteBox(rect);
  ui.noteText.focus({ preventScroll: true });
}

/// The review card's buttons: Ask, Change, Scope and Tone rows. Clicking
/// builds the request; the note stays optional and focus stays in it, so
/// Enter still saves.
function renderNoteRequests() {
  if (!ui.noteRequests) return;
  const chosen = state.pendingRequests || [];
  if (!ui.noteRequests.childElementCount) {
    for (const { group, label, hint, items } of REQUEST_GROUPS) {
      const name = document.createElement('span');
      name.className = 'request-group';
      name.textContent = label;
      const row = document.createElement('div');
      row.className = 'request-chips';
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', label);
      if (hint) {
        name.title = hint;
        name.classList.add('has-hint');
        row.setAttribute('aria-description', hint);
      }
      for (const [item, text] of items) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'request-chip';
        chip.dataset.request = `${group}:${item}`;
        chip.textContent = text;
        if (hint) chip.title = `${text} ${hint}`;
        row.append(chip);
      }
      ui.noteRequests.append(name, row);
    }
  }
  for (const chip of ui.noteRequests.querySelectorAll('.request-chip')) {
    chip.setAttribute('aria-pressed', String(chosen.includes(chip.dataset.request)));
  }
  updateNotePlaceholder();
}

function placeNoteBox(rect) {
  if (rect && (rect.width || rect.height)) {
    const height = ui.noteBox.offsetHeight || 72;
    const below = rect.bottom + 8;
    const y =
      below + height <= window.innerHeight - 8
        ? below
        : Math.max(8, rect.top - height - 8);
    placeFloating(ui.noteBox, rect.left, y);
    return;
  }
  placeFloating(ui.noteBox, Math.max(8, window.innerWidth / 2 - 130), Math.max(8, window.innerHeight / 3));
}

/// Improve needs an instruction; every other action stands on its own.
/// For Parenthetical definition (`define`) and Gloss (`gloss`), you can leave
/// it blank to ask the agent, type a suggestion for the agent to revise and
/// expand, or click "Insert () in file" to insert `term (explanation)` directly.
function updateNotePlaceholder() {
  const action = ui.noteAction.value;
  if (action === 'define' || action === 'gloss') {
    ui.noteText.placeholder =
      action === 'define'
        ? 'Optional definition (blank = ask agent, or suggest for agent / Insert ())'
        : 'Optional gloss (blank = ask agent, or suggest for agent / Insert ())';
    if (ui.noteInsert) {
      ui.noteInsert.hidden = !(state.pendingNote?.kind === 'markdown' && directEditsEnabled());
    }
    return;
  }
  if (ui.noteInsert) {
    ui.noteInsert.hidden = true;
  }
  ui.noteText.placeholder = action === 'improve' && !(state.pendingRequests || []).length
    ? 'Instruction, or click the buttons (Enter to save)'
    : 'Optional note (Enter to save)';
}

async function insertNoteParenthetical() {
  const picked = state.pendingNote;
  const text = ui.noteText.value.trim();
  if (!picked || picked.kind !== 'markdown' || !state.file || state.file.kind !== 'markdown') {
    return;
  }
  if (!text) {
    setStatus('Type the parenthetical definition or gloss to insert, or press Save to ask the agent');
    ui.noteText.focus();
    return;
  }
  const raw = state.markdownSource;
  if (typeof raw !== 'string') return;
  const span = sourceSpan(raw, picked.at?.line, picked.at?.end, picked.quote);
  if (span.error) {
    setStatus(
      span.error === 'repeated'
        ? 'That term appears more than once in its paragraph: select a longer phrase or press Save for the agent'
        : 'Selection crosses markup: press Save to let the agent insert it',
      { error: true },
    );
    return;
  }
  const edit = parentheticalEdit(raw, span, text);
  if (!edit) return;
  const label = ui.noteAction.value === 'gloss' ? 'Gloss' : 'Parenthetical definition';
  closeNoteBox();
  await writeMarkdownEdit(edit, label);
}

/// A box about to hide must not keep the focus: a hidden field that still
/// has it makes the next shortcut look like typing, and it is ignored.
function releaseFocus(box) {
  const active = document.activeElement;
  if (active instanceof HTMLElement && box.contains(active)) active.blur();
}

/// Close the review composer without saving. Esc, the × in its corner, Cancel
/// and a click outside an empty composer all end here.
function closeNoteBox() {
  releaseFocus(ui.noteBox);
  hideReviewChrome();
  ui.noteBox.hidden = true;
  if (ui.noteInsert) ui.noteInsert.hidden = true;
  ui.noteText.value = '';
  state.pendingNote = null;
  state.pendingNotePdf = null;
}

let noteSaveInFlight = false;

async function saveNote() {
  if (!state.pendingNote || !state.file) {
    return;
  }
  if (noteSaveInFlight) return;
  const requests = reviewRequests({ requests: state.pendingRequests });
  const chosenAction = REVIEW_ACTIONS.includes(ui.noteAction.value) ? ui.noteAction.value : 'improve';
  const comment = ui.noteText.value.trim();
  // Buttons alone make a request; Improve still needs words when no button is on.
  const action = chosenAction === 'improve' && requests.length && !comment ? 'request' : chosenAction;
  if (action === 'improve' && !comment) {
    setStatus('Add an instruction, or click a button on the card');
    ui.noteText.focus();
    return;
  }
  noteSaveInFlight = true;
  ui.noteSave.disabled = true;
  const selection = state.pendingNote;
  const pdfSnapshot = state.pendingNotePdf;
  const picked = structuredClone(selection);
  const path = state.file.path;
  try {
    let anchor = picked.anchor;
    let source = null;
    let sourceHintUnavailable = false;
    if (picked.kind === 'pdf' && anchor?.position) {
      const capturedPdf = pdfSnapshot?.path === path ? pdfSnapshot : null;
      let digest;
      try {
        digest = capturedPdf ? await capturedPdf.digestPromise : await pdfDocumentDigest();
        if (!digest) digest = 'unverified';
      } catch {
        digest = 'unverified';
      }
      if (state.file?.path !== path) return;
      anchor = { ...anchor, documentRevision: digest };
      source = digest.startsWith('sha256:')
        ? await optionalSourceHint(path, anchor.position, digest)
        : null;
      sourceHintUnavailable = !source;
      if (state.file?.path !== path) return;
    }
    const before = picked.kind === 'markdown' ? passageSource(state.markdownSource, picked.at) : '';
    const review = {
      file: picked.file,
      kind: picked.kind,
      at: picked.at,
      quote: picked.quote,
      comment,
      action,
      status: 'open',
      resolution: '',
      color: ((Math.max(1, Number(state.nextId) || 1) - 1) % REVIEW_TINTS) + 1,
      ...(anchor ? { anchor } : {}),
      ...(source ? { source } : {}),
      ...(requests.length ? { requests } : {}),
      ...(before ? { before } : {}),
    };
    const store = await invoke('append_review', {
      document: path,
      review,
    });
    if (state.file?.path !== path) {
      return;
    }
    applyReviewStore(store);
    if (state.pendingNote === selection && state.pendingNotePdf === pdfSnapshot) {
      state.pendingNote = null;
      state.pendingNotePdf = null;
      ui.noteBox.hidden = true;
      ui.noteText.value = '';
    }
    await setReviewOpen(true);
    const added = store.reviews[store.reviews.length - 1];
    if (added?.id) {
      selectReview(added.id);
    }
    if (action === 'delete' && added?.id) {
      const id = added.id;
      pushUndo({
        path,
        label: `delete review ${id}`,
        run: async () => {
          await deleteReview(id);
        },
      });
      setStatus(`Marked for deletion · ${id}`, {
        action: { label: 'Undo', run: () => void undoLast() },
      });
    } else {
      setStatus(sourceHintUnavailable
        ? 'Review saved; source hint unavailable, PDF quote and location retained'
        : 'Review saved');
    }
  } catch (error) {
    if (state.file?.path === path) {
      setStatus(String(error), { error: true });
    }
  } finally {
    noteSaveInFlight = false;
    if (ui.noteSave?.isConnected) ui.noteSave.disabled = false;
  }
}

async function optionalSourceHint(path, position, expectedRevision) {
  let timer = 0;
  try {
    const hint = await Promise.race([
      invoke('review_source_hint', { document: path, position }),
      new Promise((resolve) => { timer = window.setTimeout(() => resolve(null), 500); }),
    ]);
    if (hint && typeof hint.file === 'string' && Number.isInteger(hint.line) && hint.line > 0 &&
        hint.documentRevision === expectedRevision) {
      return {
        file: hint.file, line: hint.line, method: hint.method,
        verified: hint.verified === false ? false : hint.verified,
        documentRevision: hint.documentRevision,
      };
    }
    setStatus('Source hint unavailable; quote and PDF location will be saved');
    return null;
  } catch {
    setStatus('Source hint unavailable; quote and PDF location will be saved');
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/// Ask is a projection of the same record: a markdown quote for a session.
async function askSelection() {
  const picked = describeSelection();
  if (!picked) {
    setStatus('Select some text first');
    return;
  }

  const normalized = normaliseText(picked.quote);
  const lines = normalized.split('\n');
  const quoted = lines.map((line) => `> ${line}`).join('\n');
  const payload = `${formatSelection(picked)}\n${quoted}\n`;

  try {
    await navigator.clipboard.writeText(payload);
    const lineCount = lines.length;
    const s = lineCount === 1 ? '' : 's';
    setStatus(`Copied ${lineCount} line${s} for the session`);
  } catch {
    setStatus('Clipboard refused the text', { error: true });
  }
}

function reviewPaintSignature(reviews) {
  return reviews
    .map((review) => `${review.id}\t${review.kind}\t${JSON.stringify(review.at)}\t${review.quote}\t${review.action}\t${review.status}\t${review.color}\t${JSON.stringify(review.anchor)}`)
    .join('\n');
}

function reviewRowById(id) {
  for (const row of ui.reviewList.querySelectorAll('.review-row')) {
    if (row.dataset.reviewId === id) {
      return row;
    }
  }
  return null;
}

let commentSaveTimer = 0;
let commentFlushPromise = null;
let commentFlushAgain = false;
const pendingComments = new Map();
// What the reader is typing into a review row besides its comment: a reply to
// the agent's question, or the note for a reopen. Kept across repaints.
const reviewTextDrafts = new Map();
const reviewDiffCache = new Map();

function commentDraftKey(path, id) {
  return `${path}\u0000${id}`;
}

function reviewStateKey(path, id) {
  return `${path}\u0000${id}`;
}

function draftsForPath(path) {
  return new Map([...pendingComments.values()]
    .filter((draft) => draft.path === path)
    .map((draft) => [draft.id, draft]));
}

function applyReviewStore(store, { authoritative = false } = {}) {
  const reviews = Array.isArray(store?.reviews) ? store.reviews : [];
  const revision = Number(store?.revision);
  if (!authoritative && state.reviewDocumentPath === state.file?.path && Number.isSafeInteger(revision) &&
      revision < state.reviewRevision) {
    void loadReviews({ fromDisk: true });
    return false;
  }
  const samePaint = state.reviewDocumentPath === state.file?.path &&
    reviewPaintSignature(reviews) === reviewPaintSignature(state.reviews);
  // A Markdown paint draws the panel itself, with where it found each review.
  const paintDrawsPanel = !samePaint && state.file?.kind === 'markdown';
  state.reviews = reviews;
  state.nextId = Number.isSafeInteger(Number(store?.nextId)) && Number(store.nextId) > 0
    ? Number(store.nextId)
    : Math.max(1, ...reviews.map((review) => reviewIdNum(review.id) + 1));
  state.reviewRevision = Number.isSafeInteger(revision) ? revision : 0;
  state.reviewDocumentPath = state.file?.path || null;
  if (!paintDrawsPanel) {
    renderReviewList();
  }
  if (!samePaint) {
    paintReviewMarks();
  }
  return true;
}

async function loadReviews({ fromDisk = false } = {}) {
  if (!state.file || (state.file.kind !== 'markdown' && state.file.kind !== 'pdf')) {
    applyReviewStore({ reviews: [] });
    return;
  }
  const path = state.file.path;
  const generation = state.generation;
  try {
    const store = await invoke('read_reviews', { document: path });
    if (state.generation !== generation || state.file?.path !== path) {
      return;
    }
    if (state.reviewDocumentPath !== path) {
      state.reviewConflicts.clear();
      state.reviewLocations.clear();
    }
    if (store == null) {
      if (state.reviewDocumentPath === path) {
        setStatus('Review data temporarily unavailable; existing reviews and drafts are preserved.', { error: true });
        return;
      }
      applyReviewStore({ reviews: [] }, { authoritative: true });
      return;
    }
    const diskReviews = Array.isArray(store?.reviews) ? store.reviews : [];
    for (const key of state.reviewConflicts.keys()) {
      if (key.startsWith(`${path}\u0000`)) state.reviewConflicts.delete(key);
    }
    const drafts = draftsForPath(path);
    const originals = [...drafts.values()].map((draft) => draft.original).filter(Boolean);
    const result = reconcilePendingComments(drafts, diskReviews, originals);
    for (const [id, draft] of drafts) {
      const key = commentDraftKey(path, id);
      const stateKey = reviewStateKey(path, id);
      const next = result.pending.get(id);
      if (next) pendingComments.set(key, { ...draft, ...next });
      else pendingComments.delete(key);
      if (result.conflicts.has(id)) {
        const disk = diskReviews.find((review) => review.id === id);
        state.reviewConflicts.set(stateKey, {
          reason: result.conflicts.get(id),
          diskComment: disk ? String(disk.comment || '') : '',
        });
      }
      else state.reviewConflicts.delete(stateKey);
    }
    applyReviewStore(store, { authoritative: true });
  } catch (error) {
    if (state.generation !== generation || state.file?.path !== path) {
      return;
    }
    if (state.reviewDocumentPath === path) {
      if (!/never opened|does not exist/i.test(String(error))) {
        setStatus(`Review data temporarily unavailable: ${String(error)}`, { error: true });
      }
      return;
    }
    applyReviewStore({ reviews: [] });
    if (!/never opened|does not exist/i.test(String(error))) {
      setStatus(String(error), { error: true });
    }
  }
}

/// Disk first. Never flush a panel draft onto an agent write.
async function reloadReviewsFromDisk() {
  await loadReviews({ fromDisk: true });
}

function renderReviewList() {
  const active = document.activeElement;
  const activeTextarea = active?.matches?.('.review-comment, .review-reply, .review-reopen-note') ? active : null;
  const activeId = activeTextarea?.closest('.review-row')?.dataset.reviewId;
  const activeClass = ['review-comment', 'review-reply', 'review-reopen-note'].find((name) => activeTextarea?.classList.contains(name));
  const selectionStart = activeTextarea?.selectionStart;
  const selectionEnd = activeTextarea?.selectionEnd;
  ui.reviewList.textContent = '';
  const records = [...state.reviews];
  for (const draft of draftsForPath(state.file?.path).values()) {
    if (!records.some((review) => review.id === draft.id) && draft.original) {
      records.push({ ...draft.original, comment: draft.comment, _draftOnly: true });
    }
  }
  const visible = records.filter((review) =>
    (state.reviewActionFilter === 'all' || reviewAction(review) === state.reviewActionFilter) &&
    (state.reviewStatusFilter === 'all' || (review.status || 'open') === state.reviewStatusFilter));
  ui.reviewCount.textContent = `${visible.length}/${records.length}`;
  const questions = records.filter((review) => !review._draftOnly && reviewStatus(review) === 'question').length;
  if (questions) {
    const asked = document.createElement('span');
    asked.className = 'review-question-count';
    asked.textContent = ` · ${questions} question${questions === 1 ? '' : 's'}`;
    ui.reviewCount.append(asked);
  }
  if (!visible.length) {
    const empty = document.createElement('p');
    empty.className = 'review-empty';
    empty.textContent = records.length ? 'No reviews match these filters.' : 'No reviews yet — select text and press Enter.';
    ui.reviewList.append(empty);
    return;
  }
  for (const review of visible) {
    const row = document.createElement('article');
    row.className = 'review-row';
    row.dataset.reviewId = review.id;
    row.dataset.reviewTint = String(reviewTint(review));
    row.dataset.action = review.action || 'improve';
    row.dataset.status = reviewStatus(review);
    if (reviewStatus(review) === 'question' && !review._draftOnly) row.classList.add('question');
    const stateKey = reviewStateKey(state.file?.path, review.id);
    const conflict = state.reviewConflicts.get(stateKey);
    if (conflict) row.classList.add('conflict');
    if (review._draftOnly) row.classList.add('draft-only');
    const locationStatus = state.reviewLocations.get(stateKey);
    if (locationStatus && !['located', 'changed', 'positioned', 'preserved', 'lines'].includes(locationStatus)) {
      row.classList.add('unlocated');
    }
    if (state.reattachReviewId === review.id) row.classList.add('picking');
    if (review.id === state.selectedReviewId) {
      row.classList.add('on');
    }

    const loc = document.createElement('div');
    loc.className = 'review-loc';
    const action = document.createElement('span');
    action.className = 'review-action-label';
    action.textContent = ACTION_LABELS[reviewAction(review)];
    loc.append(makeReviewBadge(review), action, document.createTextNode(formatSelection(review)));
    const asked = reviewRequests(review);
    if (asked.length) {
      const requests = document.createElement('span');
      requests.className = 'review-requests-label';
      requests.textContent = requestsLabel(asked);
      loc.append(requests);
    }
    row.append(loc);

    const status = document.createElement('div');
    status.className = 'review-status';
    status.textContent = review._draftOnly
      ? 'Removed on disk · your unsaved draft is preserved'
      : `${reviewStatus(review) === 'question' ? 'question · the agent waits for your answer' : reviewStatus(review)}${review.resolution ? ` · ${review.resolution}` : ''}`;
    row.append(status);
    if (!review._draftOnly) appendReviewQuestion(row, review);
    if (locationStatus === 'preserved') {
      const location = document.createElement('div');
      location.className = 'review-location';
      location.textContent = 'Applied deletion · original excerpt retained';
      row.append(location);
    } else if (locationStatus === 'positioned') {
      const location = document.createElement('div');
      location.className = 'review-location';
      location.textContent = 'PDF position saved · text match unavailable';
      row.append(location);
    } else if (locationStatus === 'lines') {
      const location = document.createElement('div');
      location.className = 'review-location';
      location.textContent = 'Placed by its line range · select the text and Reattach to pin it';
      row.append(location);
    } else if (locationStatus === 'changed') {
      const location = document.createElement('div');
      location.className = 'review-location';
      location.textContent = 'Text changed since the review · marked between its old neighbours';
      row.append(location);
    } else if (locationStatus && !['located', 'positioned', 'preserved'].includes(locationStatus)) {
      const location = document.createElement('div');
      location.className = 'review-location';
      location.textContent = locationStatus === 'ambiguous'
        ? 'Ambiguous match · not highlighted · Reattach to pin it'
        : 'Unlocated · not highlighted · Reattach to pin it';
      row.append(location);
    }
    if (state.reattachReviewId === review.id) {
      const picking = document.createElement('div');
      picking.className = 'review-location review-picking';
      picking.textContent = 'Select the new text in the document… (Esc cancels)';
      row.append(picking);
    }
    if (state.file?.kind === 'markdown' && madeOnOlderVersion(review, state.markdownDigest, locationStatus)) {
      const older = document.createElement('div');
      older.className = 'review-location';
      older.textContent = 'Made on an earlier version of this file';
      row.append(older);
    }
    if (conflict?.reason === 'changed') {
      const diskValue = document.createElement('div');
      diskValue.className = 'review-conflict-value';
      diskValue.textContent = `On disk: ${conflict.diskComment ?? String(review.comment || '')}`;
      row.append(diskValue);
    }

    const quote = document.createElement('blockquote');
    quote.className = 'review-quote';
    quote.textContent = review.quote;
    row.append(quote);

    const comment = document.createElement('textarea');
    comment.className = 'review-comment';
    comment.setAttribute('aria-label', 'Review comment');
    comment.rows = 2;
    const act = reviewAction(review);
    if (act === 'define') {
      comment.placeholder = 'No suggestion (agent will define in ()) — or type suggestion';
    } else if (act === 'gloss') {
      comment.placeholder = 'No suggestion (agent will add gloss) — or type suggestion';
    }
    const pending = pendingComments.get(commentDraftKey(state.file?.path, review.id));
    comment.value = pending?.comment ?? review.comment ?? '';
    comment.addEventListener('click', (event) => event.stopPropagation());
    comment.addEventListener('input', () => scheduleCommentSave(review.id, comment.value));
    comment.addEventListener('blur', () => {
      void flushCommentSave();
    });
    row.append(comment);
    if (review.reply && reviewStatus(review) !== 'question') {
      const reply = document.createElement('div');
      reply.className = 'review-reply-text';
      const label = document.createElement('span');
      label.className = 'review-reply-label';
      label.textContent = 'You answered';
      reply.append(label, document.createTextNode(review.reply));
      row.append(reply);
    }
    if (!review._draftOnly && reviewStatus(review) === 'applied') appendReviewDiff(row, review);

    const actions = document.createElement('div');
    actions.className = 'review-actions';
    if (!review._draftOnly && reviewStatus(review) === 'open') {
      const reattach = document.createElement('button');
      reattach.type = 'button';
      reattach.textContent = state.reattachReviewId === review.id ? 'Cancel reattach' : 'Reattach';
      reattach.title = 'Pin this review to other text: select it first, or click here and then select it';
      reattach.addEventListener('pointerdown', (event) => event.preventDefault());
      reattach.addEventListener('click', (event) => {
        event.stopPropagation();
        void reattachReview(review);
      });
      actions.append(reattach);
    }
    if (review._draftOnly) {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copy draft';
      copy.addEventListener('click', async (event) => {
        event.stopPropagation();
        try {
          await navigator.clipboard.writeText(review.comment || '');
          setStatus('Draft copied');
        } catch { setStatus('Clipboard refused the draft', { error: true }); }
      });
      const discard = document.createElement('button');
      discard.type = 'button';
      discard.textContent = 'Discard draft';
      discard.addEventListener('click', (event) => {
        event.stopPropagation();
        discardReviewDraft(review.id);
      });
      actions.append(copy, discard);
    } else if (conflict?.reason === 'changed') {
      const useDisk = document.createElement('button');
      useDisk.type = 'button';
      useDisk.textContent = 'Use disk';
      useDisk.addEventListener('click', (event) => {
        event.stopPropagation();
        discardReviewDraft(review.id);
      });
      const saveDraft = document.createElement('button');
      saveDraft.type = 'button';
      saveDraft.textContent = 'Save my draft';
      saveDraft.addEventListener('click', (event) => {
        event.stopPropagation();
        void saveDraftAfterConflict(review.id);
      });
      actions.append(useDisk, saveDraft);
    }
    const settled = !review._draftOnly && ['applied', 'resolved'].includes(reviewStatus(review));
    if (settled && state.reopenReviewId === review.id) {
      row.append(reopenForm(review));
    } else if (settled) {
      if (reviewStatus(review) === 'applied') {
        const resolve = document.createElement('button');
        resolve.type = 'button';
        resolve.textContent = 'Resolve';
        resolve.title = 'The change is right: close this review';
        resolve.addEventListener('click', (event) => {
          event.stopPropagation();
          void patchReview(review, { status: 'resolved' }, 'Review resolved');
        });
        actions.append(resolve);
      }
      const reopen = document.createElement('button');
      reopen.type = 'button';
      reopen.textContent = 'Reopen';
      reopen.title = 'Not right yet: say what is still wrong and send it back to the agent';
      reopen.addEventListener('click', (event) => {
        event.stopPropagation();
        state.reopenReviewId = review.id;
        renderReviewList();
        reviewRowById(review.id)?.querySelector('.review-reopen-note')?.focus({ preventScroll: true });
      });
      actions.append(reopen);
    }
    if (!review._draftOnly) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove review';
      remove.addEventListener('click', (event) => {
        event.stopPropagation();
        void deleteReview(review.id);
      });
      actions.append(remove);
    }
    row.append(actions);

    row.addEventListener('click', () => {
      selectReview(review.id);
      void jumpToReview(review);
    });
    ui.reviewList.append(row);
  }
  if (activeId) {
    const textarea = reviewRowById(activeId)?.querySelector(`.${activeClass}`);
    if (textarea instanceof HTMLTextAreaElement || textarea instanceof HTMLInputElement) {
      textarea.focus({ preventScroll: true });
      if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
        textarea.setSelectionRange(selectionStart, selectionEnd);
      }
    }
  }
}

function reviewTextDraftKey(id, kind) {
  return `${state.file?.path}\u0000${id}\u0000${kind}`;
}

/// A field for the reader to write to the agent, with its send button.
/// Enter sends, Shift+Enter is a new line; the text survives repaints.
function reviewTextField(review, kind, { placeholder, label, send, cancel = null }) {
  const key = reviewTextDraftKey(review.id, kind);
  const box = document.createElement('div');
  box.className = `review-${kind}-box`;
  const field = document.createElement('textarea');
  field.className = kind === 'reply' ? 'review-reply' : 'review-reopen-note';
  field.rows = 2;
  field.placeholder = placeholder;
  field.setAttribute('aria-label', kind === 'reply' ? 'Your answer to the agent' : 'What is still wrong');
  field.value = reviewTextDrafts.get(key) ?? '';
  field.addEventListener('click', (event) => event.stopPropagation());
  field.addEventListener('input', () => reviewTextDrafts.set(key, field.value));
  const go = () => void send(field.value.trim(), key);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      go();
    } else if (event.key === 'Escape' && cancel) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    }
  });
  const actions = document.createElement('div');
  actions.className = 'review-actions';
  if (cancel) {
    const back = document.createElement('button');
    back.type = 'button';
    back.textContent = 'Cancel';
    back.addEventListener('click', (event) => {
      event.stopPropagation();
      cancel();
    });
    actions.append(back);
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'review-send';
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    go();
  });
  actions.append(button);
  box.append(field, actions);
  return box;
}

/// The agent's question, for an item it handed back to the reader.
function appendReviewQuestion(row, review) {
  if (reviewStatus(review) !== 'question') return;
  const asked = document.createElement('div');
  asked.className = 'review-question';
  const label = document.createElement('span');
  label.className = 'review-question-label';
  label.textContent = 'The agent asks';
  asked.append(label, document.createTextNode(String(review.question || '(no question text)')));
  row.append(asked, reviewTextField(review, 'reply', {
    placeholder: 'Your answer (Enter to send)', label: 'Send', send: (text, key) => sendReviewReply(review, text, key),
  }));
}

async function sendReviewReply(review, text, key) {
  if (!text) {
    setStatus('Write an answer first');
    return;
  }
  const path = state.file?.path;
  // The answer is to this question: a reworded one, or a store write by the
  // agent elsewhere, is not a conflict, a changed question is.
  const ok = await patchReview(review, { reply: text, status: 'open' }, `Answer sent · ${review.id} is open again`, {
    also: { question: review.question ?? null },
  });
  if (ok && state.file?.path === path) reviewTextDrafts.delete(key);
}

function reopenForm(review) {
  return reviewTextField(review, 'reopen', {
    placeholder: 'What is still wrong? (Enter to reopen)',
    label: 'Reopen',
    send: (text, key) => reopenReview(review, text, key),
    cancel: () => {
      state.reopenReviewId = null;
      renderReviewList();
    },
  });
}

/// Back to the agent, with the reader's note in the comment it reads.
async function reopenReview(review, note, key) {
  if (!note) {
    setStatus('Say in a few words what is still wrong');
    return;
  }
  const path = state.file?.path;
  if (!path) return;
  const generation = state.generation;
  const old = String(review.comment || '');
  const line = `Reopened: ${note}`;
  // Sent again after the status write failed: the note is already there.
  const saved = old === line || old.endsWith(`\n${line}`);
  const comment = (old ? `${old}\n${line}` : line).slice(-2000);
  try {
    if (!saved) {
      const store = await invoke('update_review', { document: path, id: review.id, expectedComment: old, comment });
      if (state.generation !== generation || state.file?.path !== path) return;
      applyReviewStore(store);
    }
  } catch (error) {
    if (state.generation !== generation || state.file?.path !== path) return;
    setStatus(/conflict/i.test(String(error))
      ? 'The review changed on disk; reloaded it, your note is kept. Check it and reopen again.'
      : String(error), { error: true });
    await loadReviews({ fromDisk: true });
    return;
  }
  const current = state.reviews.find((item) => item.id === review.id) || review;
  if (await patchReview(current, { status: 'open' }, `Review ${review.id} reopened`)) {
    reviewTextDrafts.delete(key);
    if (state.reopenReviewId === review.id) state.reopenReviewId = null;
    renderReviewList();
  }
}

/// The text an applied Markdown review's passage has now: from where the
/// paint found it, or its saved lines when its quote and context are gone but
/// the paragraph there still shares words with `before`. Null: passage gone.
function appliedPassageNow(review) {
  const raw = state.markdownSource;
  if (typeof raw !== 'string') return null;
  const key = reviewStateKey(state.file?.path, review.id);
  const found = state.reviewSpans?.get(key);
  if (found?.line) return passageText(raw, found);
  const status = state.reviewLocations.get(key);
  const text = passageText(raw, review.at);
  if (!text) return null;
  if (status === 'lines') return text;
  const diffs = cachedDiff(review.before, text);
  const kept = diffs ? diffs.filter(([op]) => op === 0).reduce((sum, [, part]) => sum + part.trim().length, 0) : 0;
  return kept >= 0.3 * review.before.trim().length ? text : null;
}

/// The panel repaints often; each pair of texts is compared once.
function cachedDiff(before, after) {
  const key = `${before}\u0000${after}`;
  if (!reviewDiffCache.has(key)) {
    if (reviewDiffCache.size > 200) reviewDiffCache.clear();
    reviewDiffCache.set(key, wordDiff(before, after));
  }
  return reviewDiffCache.get(key);
}

function reviewDiffFor(review) {
  const after = appliedPassageNow(review);
  const diffs = after === null ? [[-1, review.before]] : cachedDiff(review.before, after);
  return diffs ? { ...diffView(diffs), gone: after === null } : null;
}

/// Before/after of an applied Markdown review, word by word.
function appendReviewDiff(row, review) {
  if (state.file?.kind !== 'markdown' || typeof review.before !== 'string' || !review.before) return;
  const view = reviewDiffFor(review);
  const box = document.createElement('div');
  box.className = 'review-diff';
  const head = document.createElement('div');
  head.className = 'review-diff-head';
  if (!view) {
    head.textContent = 'Before/after · the passage is too long to compare here';
    box.append(head);
    row.append(box);
    return;
  }
  head.textContent = view.gone
    ? 'Before/after · the passage is gone from the file'
    : view.changed
      ? `Before/after · ${view.removed} word${view.removed === 1 ? '' : 's'} out, ${view.added} in`
      : 'Before/after · the passage has not changed';
  const body = document.createElement('div');
  body.className = 'review-diff-body';
  for (const part of view.parts) {
    const node = document.createElement(part.kind === 'del' ? 'del' : part.kind === 'ins' ? 'ins' : 'span');
    if (part.kind === 'gap') node.className = 'review-diff-gap';
    node.textContent = part.text;
    body.append(node);
  }
  if (view.cut) {
    const more = document.createElement('span');
    more.className = 'review-diff-gap';
    more.textContent = ' … (cut)';
    body.append(more);
  }
  box.append(head, body);
  row.append(box);
}

function selectReview(id) {
  state.selectedReviewId = id;
  for (const row of ui.reviewList.querySelectorAll('.review-row')) {
    row.classList.toggle('on', row.dataset.reviewId === id);
  }
}

async function setReviewOpen(on) {
  const was = state.reviewOpen;
  state.reviewOpen = Boolean(on);
  document.body.classList.toggle('review-open', state.reviewOpen);
  ui.reviewPane.hidden = !state.reviewOpen;
  ui.notes.classList.toggle('on', state.reviewOpen);
  ui.notes.setAttribute('aria-pressed', String(state.reviewOpen));
  // A selection already made gains or loses the review chip with the mode.
  scheduleReviewChip();
  if (state.reviewOpen && !was && !state.reviewGrown) {
    try {
      const [width, height] = await invoke('window_size');
      await invoke('fit_window', {
        width: width + REVIEW_PANE_WIDTH,
        height,
        recenter: false,
        exact: true,
      });
      state.reviewGrown = true;
    } catch {
      // The pane still opens; the stage just shares the current width.
    }
  }
}

function toggleReviewPanel() {
  if (!state.file || (state.file.kind !== 'markdown' && state.file.kind !== 'pdf')) {
    setStatus('Open a PDF or markdown file first');
    return;
  }
  void setReviewOpen(!state.reviewOpen);
}

function setReviewSize(px, { persist = true } = {}) {
  const size = nearestReviewSize(px);
  state.reviewSize = size;
  document.documentElement.style.setProperty('--review-size', `${size}px`);
  const first = REVIEW_SIZE_STEPS[0];
  const last = REVIEW_SIZE_STEPS[REVIEW_SIZE_STEPS.length - 1];
  ui.reviewSizeDown.disabled = size <= first;
  ui.reviewSizeUp.disabled = size >= last;
  if (persist) {
    try {
      localStorage.setItem('pdf-next.review-size', String(size));
    } catch {
      // Preference only.
    }
  }
}

function stepReviewSize(delta) {
  setReviewSize(nextReviewSize(state.reviewSize, delta));
}

function scheduleCommentSave(id, comment) {
  const path = state.file?.path;
  const key = commentDraftKey(path, id);
  const old = pendingComments.get(key);
  const current = state.reviews.find((review) => review.id === id) || old?.original;
  if (!path || !current) return;
  pendingComments.set(key, {
    id, path, comment,
    expectedComment: old?.expectedComment ?? String(current.comment || ''),
    original: old?.original || current,
  });
  state.reviewConflicts.delete(reviewStateKey(path, id));
  window.clearTimeout(commentSaveTimer);
  commentSaveTimer = window.setTimeout(() => {
    void flushCommentSave();
  }, COMMENT_SAVE_MS);
}

async function flushCommentSave() {
  window.clearTimeout(commentSaveTimer);
  commentSaveTimer = 0;
  if (commentFlushPromise) {
    // The running save took its list of drafts before this call. Run the
    // list again when it ends, so an edit made during the save is not left.
    commentFlushAgain = true;
    return commentFlushPromise;
  }
  commentFlushPromise = (async () => {
    do {
      commentFlushAgain = false;
      for (const pending of [...pendingComments.values()]) {
        if (pending.path === state.file?.path && !state.reviews.some((review) => review.id === pending.id)) {
          state.reviewConflicts.set(reviewStateKey(pending.path, pending.id), { reason: 'removed' });
          renderReviewList();
          continue;
        }
        if (String(pending.comment).trim() === String(pending.expectedComment).trim()) {
          if (pendingComments.get(commentDraftKey(pending.path, pending.id)) === pending) {
            pendingComments.delete(commentDraftKey(pending.path, pending.id));
          }
          continue;
        }
        await updateReviewComment(pending, { quiet: true });
      }
    } while (commentFlushAgain);
  })();
  try {
    await commentFlushPromise;
  } finally {
    commentFlushPromise = null;
  }
}

async function updateReviewComment(pending, { quiet = false } = {}) {
  const { id, path } = pending;
  const generation = state.generation;
  const key = commentDraftKey(path, id);
  try {
    const store = await invoke('update_review', {
      document: path, id, expectedComment: pending.expectedComment, comment: pending.comment.trim(),
    });
    const latest = pendingComments.get(key);
    if (latest === pending) {
      pendingComments.delete(key);
    } else if (latest && latest.expectedComment === pending.expectedComment) {
      pendingComments.set(key, { ...latest, expectedComment: pending.comment.trim() });
    }
    if (state.generation !== generation || state.file?.path !== path) return;
    state.reviewConflicts.delete(reviewStateKey(path, id));
    applyReviewStore(store);
    if (!quiet) {
      selectReview(id);
      setStatus('Review updated');
    }
  } catch (error) {
    if (state.generation !== generation || state.file?.path !== path) return;
    if (/conflict|changed|expected|not found/i.test(String(error))) {
      state.reviewConflicts.set(reviewStateKey(path, id), { reason: /not found/i.test(String(error)) ? 'removed' : 'changed' });
      await loadReviews({ fromDisk: true });
    }
    setStatus(/conflict|changed|expected/i.test(String(error))
      ? 'Review changed on disk; your draft is preserved for conflict resolution.'
      : String(error), { error: true });
    renderReviewList();
    const textarea = reviewRowById(id)?.querySelector('.review-comment');
    if (textarea instanceof HTMLTextAreaElement) textarea.value = pending.comment;
    return false;
  }
  return true;
}

/// Remove a review at once, with no question asked: the toast and Ctrl+Z can
/// put it back, which beats a dialog that is clicked through anyway.
async function deleteReview(id) {
  if (!state.file) {
    return;
  }
  const path = state.file.path;
  const generation = state.generation;
  try {
    const expectedRecord = state.reviews.find((review) => review.id === id);
    const store = await invoke('delete_review', { document: path, id, expectedRecord });
    if (state.generation !== generation || state.file?.path !== path) {
      return;
    }
    const draftKey = commentDraftKey(path, id);
    const draft = pendingComments.get(draftKey) ?? null;
    pendingComments.delete(draftKey);
    applyReviewStore(store);
    if (state.selectedReviewId === id) {
      state.selectedReviewId = null;
    }
    if (expectedRecord) {
      pushUndo({
        path,
        label: `review ${id}`,
        run: () => restoreRemovedReview(path, expectedRecord, draft),
      });
    }
    setStatus(`Review ${id} removed`, {
      action: expectedRecord ? { label: 'Undo', run: () => void undoLast() } : null,
    });
  } catch (error) {
    if (state.generation === generation && state.file?.path === path) {
      setStatus(String(error), { error: true });
    }
  }
}

/// Compare-and-swap one record: each patched field, and each field in `also`,
/// must still hold the value shown.
async function patchReview(review, patch, message, { also = {} } = {}) {
  if (!state.file) return false;
  const path = state.file.path;
  const generation = state.generation;
  const expected = {
    ...Object.fromEntries(Object.keys(patch).map((key) => [key, Object.hasOwn(review, key) ? review[key] : null])),
    ...also,
  };
  try {
    const store = await invoke('patch_review', { document: path, id: review.id, patch, expected });
    if (state.generation !== generation || state.file?.path !== path) return false;
    applyReviewStore(store);
    setStatus(message);
    return true;
  } catch (error) {
    if (state.generation === generation && state.file?.path === path) {
      const conflict = /conflict/i.test(String(error));
      setStatus(conflict
        ? 'The review changed on disk; reloaded it, your text is kept. Check it and send again.'
        : `Review update failed: ${String(error)}`, { error: true });
      if (conflict) await loadReviews({ fromDisk: true });
    }
    return false;
  }
}

function discardReviewDraft(id) {
  const path = state.file?.path;
  if (!path) return;
  pendingComments.delete(commentDraftKey(path, id));
  state.reviewConflicts.delete(reviewStateKey(path, id));
  renderReviewList();
  setStatus('Draft discarded');
}

async function saveDraftAfterConflict(id) {
  const path = state.file?.path;
  const key = commentDraftKey(path, id);
  const pending = pendingComments.get(key);
  if (!path || !pending) return;
  const generation = state.generation;
  try {
    const store = await invoke('read_reviews', { document: path });
    if (state.generation !== generation || state.file?.path !== path) return;
    if (store == null) {
      setStatus('Review data temporarily unavailable; your draft is preserved.', { error: true });
      return;
    }
    const current = store?.reviews?.find((review) => review.id === id);
    if (!current) {
      state.reviewConflicts.set(reviewStateKey(path, id), { reason: 'removed' });
      applyReviewStore(store, { authoritative: true });
      setStatus('Review was removed on disk; draft is retained for copying.', { error: true });
      return;
    }
    applyReviewStore(store, { authoritative: true });
    const rebased = { ...pending, expectedComment: String(current.comment || '') };
    pendingComments.set(key, rebased);
    state.reviewConflicts.delete(reviewStateKey(path, id));
    renderReviewList();
    await updateReviewComment(rebased, { quiet: true });
  } catch (error) {
    if (state.generation === generation && state.file?.path === path) {
      setStatus(`Could not refresh the review before saving your draft: ${String(error)}`, { error: true });
    }
  }
}

/// Reattach pins a review to other text. With text selected it takes that
/// selection at once; otherwise it waits for the next selection (pick mode).
/// The new text need not match the old quote: after an edit it rarely can.
async function reattachReview(review) {
  const kind = state.file?.kind;
  if (!state.file?.path || (kind !== 'pdf' && kind !== 'markdown')) return;
  if (state.reattachReviewId === review.id) {
    cancelReattach();
    return;
  }
  const picked = describeSelection({ context: true });
  if (picked && picked.kind === kind && picked.quote) {
    await pinReviewTo(review, picked);
    return;
  }
  state.reattachReviewId = review.id;
  document.body.classList.add('reattach-picking');
  renderReviewList();
  setStatus(`Select the new text for ${review.id} (Esc cancels)`, { sticky: true });
}

async function pinReviewTo(review, picked) {
  const path = state.file?.path;
  const generation = state.generation;
  const kind = state.file?.kind;
  const label = kind === 'pdf' ? 'PDF' : 'Markdown';
  if (!(kind === 'pdf' ? picked.anchor?.position : picked.anchor?.prefix || picked.anchor?.suffix)) {
    setStatus(`The selected text has no ${kind === 'pdf' ? 'PDF position' : 'surrounding text'} to attach to`, { error: true });
    return;
  }
  try {
    const digest = kind === 'pdf' ? await pdfDocumentDigest() : state.markdownDigest;
    if (state.generation !== generation || state.file?.path !== path) return;
    const nextAnchor = reattachedReviewAnchor(review.anchor, picked.anchor, review.at, review.quote);
    if (digest) nextAnchor.documentRevision = digest;
    // The review takes the selected text as its quote, and its place: the
    // page or lines it is on. A selection with no locator keeps the old one.
    const patch = { anchor: nextAnchor, quote: picked.quote };
    if (picked.at?.line || picked.at?.page) patch.at = picked.at;
    await patchReview(review, patch, `Review ${review.id} reattached to the selected ${label} text`);
  } catch (error) {
    if (state.generation === generation && state.file?.path === path) {
      setStatus(`Could not reattach review: ${String(error)}`, { error: true });
    }
  }
}

/// In pick mode, a finished selection completes the reattach.
async function finishReattachPick() {
  const id = state.reattachReviewId;
  if (!id) return;
  const review = state.reviews.find((item) => item.id === id);
  if (!review) {
    cancelReattach();
    return;
  }
  const picked = describeSelection({ context: true });
  if (!picked || picked.kind !== state.file?.kind || !hasLocator(picked) || !selectionInDocument()) return;
  cancelReattach({ quiet: true });
  await pinReviewTo(review, picked);
}

function cancelReattach({ quiet = false } = {}) {
  if (!state.reattachReviewId) return;
  state.reattachReviewId = null;
  document.body.classList.remove('reattach-picking');
  renderReviewList();
  if (!quiet) setStatus('Reattach canceled');
}

async function jumpToReview(review) {
  const target = {
    page: review.at?.page || null,
    line: review.at?.line || null,
    nameddest: null,
    search: review.quote || null,
  };
  if (target.page || target.line || target.search) {
    await applyTarget(target);
  }
}

function reviewTint(review) {
  return typeof review === 'object' ? reviewColor(review, REVIEW_TINTS) : reviewColor({ id: review }, REVIEW_TINTS);
}

function makeReviewBadge(review) {
  const badge = document.createElement('span');
  badge.className = 'review-no';
  badge.textContent = reviewLabel(review, state.reviews);
  badge.dataset.reviewId = review.id;
  badge.dataset.reviewTint = String(reviewTint(review));
  if (reviewStatus(review) === 'question') {
    badge.dataset.reviewStatus = 'question';
    badge.title = `The agent asks: ${review.question || ''}`;
  }
  return badge;
}

function clearReviewBadges(root) {
  if (!root) {
    return;
  }
  for (const node of root.querySelectorAll('.review-no, .review-nos')) {
    node.remove();
  }
}

function placeMarkdownBadge(host, review) {
  let pack = host.querySelector(':scope > .review-nos');
  if (!pack) {
    pack = document.createElement('span');
    pack.className = 'review-nos';
    host.append(pack);
  }
  pack.append(makeReviewBadge(review));
}

function placePdfBadge(page, anchor, review) {
  if (!page) {
    return;
  }
  const badge = makeReviewBadge(review);
  if (anchor) {
    const pageRect = page.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const top = Math.max(0, rect.top - pageRect.top - 12);
    const near = [...page.querySelectorAll(':scope > .review-no')].filter((node) => {
      const other = Number.parseFloat(node.style.top);
      return Number.isFinite(other) && Math.abs(other - top) < 10;
    }).length;
    const baseLeft = rect.right - pageRect.left;
    badge.style.left = `${Math.min(Math.max(0, page.clientWidth - 58), baseLeft + (near % 4) * 24)}px`;
    badge.style.top = `${top + Math.floor(near / 4) * 18}px`;
  } else {
    badge.style.right = '8px';
    badge.style.top = '8px';
  }
  page.append(badge);
}

function applyReviewTint(el, id) {
  if (!el) {
    return;
  }
  if (el.classList.contains('page')) {
    el.classList.add('review-page');
  } else if (el.closest('.textLayer')) {
    el.classList.add('review');
  } else {
    el.classList.add('review-block');
  }
  el.dataset.reviewId = id;
  const review = state.reviews.find((item) => item.id === id);
  el.dataset.reviewTint = String(reviewTint(review || id));
  if (reviewAction(review) === 'delete') el.dataset.reviewAction = 'delete';
  if (reviewStatus(review) === 'question') el.dataset.reviewStatus = 'question';
}

function clearReviewTint(el) {
  if (!el) {
    return;
  }
  el.classList.remove('review-block', 'review', 'review-page');
  delete el.dataset.reviewId;
  delete el.dataset.reviewTint;
  delete el.dataset.reviewAction;
  delete el.dataset.reviewStatus;
}

function unwrapReviewMarks(root) {
  if (!root) {
    return;
  }
  clearReviewBadges(root);
  for (const hit of root.querySelectorAll('.review-hit')) {
    hit.remove();
  }
  // `review-q` — not `span`. PDF.js makes every textLayer span
  // `position:absolute`; a nested span's wash then covers the whole line.
  unwrapMarks(root, 'mark.review, review-q');
  for (const el of [...root.querySelectorAll('.review-block, span.review, [data-review-tint]')]) {
    if (el.classList.contains('review-no') || el.classList.contains('review-nos')) {
      el.remove();
      continue;
    }
    clearReviewTint(el);
  }
}

const BLOCK_ELEMENTS = 'p,li,h1,h2,h3,h4,h5,h6,td,th,tr,table,ul,ol,dt,dd,blockquote,pre,div,hr,figcaption,summary';

/// The text of `root` in reading order, lower-cased and with runs of white
/// space as one space, plus where each text node sits in it. Badges are not
/// text of the document. PDF.js splits a line into spans, so between two nodes
/// a space is added; with `inline` (Markdown) nodes inside one block run
/// together, as `wa**ke**` reads, and a space goes only where the source has
/// one or a block ends.
function collectTextParts(root, inline = false) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts = [];
  let joined = '';
  let node;
  let owner = null;
  let badge = false;
  let block = null;
  let lastBlock = null;
  let spaced = false;
  // `joined.endsWith` would flatten a string of megabytes at every node.
  let endsSpace = false;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (parent !== owner) {
      owner = parent;
      badge = Boolean(parent?.closest('.review-nos'));
      block = inline ? (parent?.closest(BLOCK_ELEMENTS) ?? null) : null;
    }
    if (badge) {
      continue;
    }
    const piece = node.textContent.replace(/\s+/g, ' ').toLowerCase();
    if (!piece.trim()) {
      spaced = inline;
      continue;
    }
    if (joined && !endsSpace && !piece.startsWith(' ') && (!inline || spaced || block !== lastBlock)) {
      joined += ' ';
      endsSpace = true;
    }
    spaced = false;
    lastBlock = block;
    const used = piece.startsWith(' ') && endsSpace ? piece.trimStart() : piece;
    const start = joined.length;
    joined += used;
    endsSpace = used.endsWith(' ');
    parts.push({
      node,
      start,
      end: joined.length,
      drop: piece.length - used.length,
    });
  }
  return { joined, parts };
}

function offsetsInPart(part, idx, end) {
  const localStart = Math.max(0, idx - part.start) + (part.drop || 0);
  const localEnd = Math.min(part.end, end) - part.start + (part.drop || 0);
  const from = mapCollapsedIndex(part.node.textContent, localStart);
  const to = mapCollapsedIndex(part.node.textContent, localEnd);
  return [from, Math.max(from, to)];
}

/// Wrap only the matched characters. Markdown uses `<mark class="review">`.
/// PDF uses a custom `<review-q>` — never a `<span>` — because PDF.js styles
/// every textLayer span as `position:absolute`, and a nested span's
/// background then paints the whole sentence box.
function wrapQuoteFragments(root, quote, id, { asMark = false, match = null } = {}) {
  const needle = String(quote || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!root || needle.length < 2) {
    return null;
  }
  const { joined, parts } = collectTextParts(root, asMark);
  const found = match || findNormalizedSpan(joined, needle);
  if (!found) {
    return null;
  }
  return wrapSpanParts(root, parts, found, () => {
    const wrap = document.createElement(asMark ? 'mark' : 'review-q');
    if (asMark) {
      wrap.className = 'review';
    }
    applyReviewTint(wrap, id);
    return wrap;
  });
}

/// Wrap the text nodes under `found` in elements from `makeWrap`, splitting
/// the first and last node at the span's edges. Returns the first element.
/// Wrapping later spans first keeps the offsets of earlier ones valid.
function wrapSpanParts(root, parts, found, makeWrap) {
  let first = null;
  // `parts` is in reading order: find the first one that ends after the span
  // starts, and stop at the first that starts after it ends.
  let low = 0;
  for (let high = parts.length; low < high;) {
    const middle = (low + high) >> 1;
    if (parts[middle].end > found.start) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  for (let at = low; at < parts.length && parts[at].start < found.end; at += 1) {
    const part = parts[at];
    const node = part.node;
    if (!node.parentNode || !root.contains(node)) {
      continue;
    }
    const [from, to] = offsetsInPart(part, found.start, found.end);
    if (to <= from) {
      continue;
    }
    const textLen = node.textContent.length;
    const endAt = Math.min(Math.max(to, from), textLen);
    const startAt = Math.min(from, endAt);
    if (endAt < textLen) {
      node.splitText(endAt);
    }
    const mid = startAt > 0 ? node.splitText(startAt) : node;
    const wrap = makeWrap();
    mid.parentNode.insertBefore(wrap, mid);
    wrap.appendChild(mid);
    if (!first) {
      first = wrap;
    }
  }
  return first;
}

function wrapPdfQuote(layer, quote, id, match = null) {
  return wrapQuoteFragments(layer, quote, id, { asMark: false, match });
}

function wrapQuoteIn(root, quote, id) {
  return wrapQuoteFragments(root, quote, id, { asMark: true });
}

function markdownReviewMark(id, { changed = false } = {}) {
  const mark = document.createElement('mark');
  mark.className = changed ? 'review changed' : 'review';
  applyReviewTint(mark, id);
  return mark;
}

/// A review saved without context: look for its quote in the blocks of its
/// line range, or tint those blocks. Returns the block that takes the badge.
function paintMarkdownByLines(review) {
  const start = review.at.line;
  const end = review.at.end || start;
  const hosts = [];
  for (const anchor of ui.markdown.querySelectorAll('[data-line]')) {
    const line = Number(anchor.dataset.line);
    if (line < start || line > end) {
      continue;
    }
    hosts.push(isBlockOwner(anchor.parentElement) ? anchor.parentElement : anchor);
  }
  let badgeHost = null;
  let wrapped = false;
  for (const host of hosts) {
    if (wrapQuoteIn(host, review.quote, review.id)) {
      wrapped = true;
      badgeHost ??= host;
    }
  }
  if (!wrapped) {
    for (const host of hosts) {
      applyReviewTint(host, review.id);
      badgeHost ??= host;
    }
  }
  return badgeHost;
}

/// The block that carries a mark's line anchor, where its badge goes.
function markdownBadgeHost(mark) {
  let host = mark.parentElement;
  while (isBlockOwner(host) && !host.querySelector(':scope > [data-line]')) {
    host = host.parentElement;
  }
  return isBlockOwner(host) ? host : mark.parentElement;
}

function paintMarkdownMarks() {
  // A find mark inside a word would split the text a review quote is matched in.
  const finding = state.mdFind;
  unwrapMarks(ui.markdown, 'mark.aim');
  unwrapReviewMarks(ui.markdown);
  // Every review is matched against the text as it is now, before any mark
  // splits it, then wrapped from the last offset to the first.
  const text = collectTextParts(ui.markdown, true);
  const joined = text.joined;
  let parts = text.parts;
  const locations = new Map();
  const located = [];
  const byLines = new Map();
  for (const review of state.reviews) {
    if (!review.at?.line) {
      continue;
    }
    const found = resolveMarkdownReview(joined, review, { normalized: true });
    if (found.status === 'located' || found.status === 'changed') {
      located.push({ review, found });
    } else if (found.legacy) {
      byLines.set(review, null);
    }
    const gone = reviewAction(review) === 'delete' && ['applied', 'resolved'].includes(reviewStatus(review));
    // `lines`: no context was saved, so the line range stands in for the text.
    locations.set(
      reviewStateKey(state.file.path, review.id),
      found.status === 'located' || found.status === 'changed'
        ? found.status
        : found.legacy ? 'lines' : gone ? 'preserved' : found.status,
    );
  }
  const hosts = new Map();
  const heals = [];
  const spans = new Map();
  let lowest = Infinity;
  for (const item of [...located].sort((one, two) => two.found.start - one.found.start)) {
    if (item.found.end > lowest) {
      // Overlaps one already wrapped: the text nodes have been split since.
      ({ parts } = collectTextParts(ui.markdown, true));
    }
    lowest = item.found.start;
    const changed = item.found.status === 'changed';
    let last = null;
    const first = wrapSpanParts(ui.markdown, parts, item.found, () => {
      last = markdownReviewMark(item.review.id, { changed });
      return last;
    });
    hosts.set(item.review, first && markdownBadgeHost(first));
    if (first && item.review.before && reviewStatus(item.review) === 'applied') {
      spans.set(reviewStateKey(state.file.path, item.review.id),
        atRange(lineNear(first, ui.markdown), lineNear(last ?? first, ui.markdown), 'line'));
    }
    if (first && !changed) {
      const heal = markdownHealPatch(item.review, joined, item.found, first, last);
      if (heal) heals.push(heal);
    }
  }
  for (const review of byLines.keys()) {
    hosts.set(review, paintMarkdownByLines(review));
  }
  // After all the matching: a badge is text too.
  for (const review of state.reviews) {
    if (hosts.get(review)) {
      placeMarkdownBadge(hosts.get(review), review);
    }
  }
  state.reviewLocations = locations;
  state.reviewSpans = spans;
  renderReviewList();
  if (finding) {
    buildMarkdownFind(true);
  }
  scheduleReviewHeal(heals);
}

/// The rewrite an open Markdown review needs after the text around it moved:
/// fresh context from where its quote stands now, and the source lines it is
/// on. Null when the record already says so.
function markdownHealPatch(review, joined, found, first, last) {
  if (reviewStatus(review) !== 'open' || review._draftOnly) return null;
  const { prefix, suffix } = contextAt(joined, found.start, found.end);
  const at = atRange(lineNear(first, ui.markdown), lineNear(last ?? first, ui.markdown), 'line');
  const anchor = review.anchor ?? {};
  const contextMoved = (anchor.prefix ?? '') !== prefix || (anchor.suffix ?? '') !== suffix;
  const linesMoved = at.line != null &&
    (at.line !== review.at?.line || (at.end ?? null) !== (review.at?.end ?? null));
  if (!contextMoved && !linesMoved) return null;
  const patch = {};
  const expected = {};
  if (contextMoved) {
    patch.anchor = {
      ...anchor, prefix, suffix, ...(state.markdownDigest ? { documentRevision: state.markdownDigest } : {}),
    };
    expected.anchor = review.anchor ?? null;
  }
  if (linesMoved) {
    patch.at = { ...review.at, ...at };
    if (at.end == null) delete patch.at.end;
    expected.at = review.at ?? null;
  }
  return { id: review.id, patch, expected };
}

let reviewHealTimer = 0;

/// Write healed locations back, after the paint and out of its way. Each
/// write is a compare-and-swap: a record changed meanwhile (by an agent, or
/// by you) is left alone, and the next paint looks again.
function scheduleReviewHeal(heals) {
  window.clearTimeout(reviewHealTimer);
  reviewHealTimer = 0;
  if (!heals.length || state.file?.kind !== 'markdown') return;
  const path = state.file.path;
  const generation = state.generation;
  reviewHealTimer = window.setTimeout(async () => {
    reviewHealTimer = 0;
    let store = null;
    for (const { id, patch, expected } of heals) {
      if (state.generation !== generation || state.file?.path !== path) return;
      try {
        store = await invoke('patch_review', { document: path, id, patch, expected });
      } catch {
        // A conflict means someone else wrote first; the next paint retries.
      }
    }
    if (store && state.generation === generation && state.file?.path === path) {
      applyReviewStore(store);
    }
  }, 400);
}

let pdfReviewTextDocument = null;
let pdfReviewTextPagesPromise = null;
let pdfDigestDocument = null;
let pdfDigestPromise = null;
let pdfPaintSerial = 0;

async function pdfDocumentDigest(pdf = state.document) {
  if (!pdf) throw new Error('PDF is not open');
  if (pdfDigestDocument === pdf && pdfDigestPromise) return pdfDigestPromise;
  pdfDigestDocument = pdf;
  pdfDigestPromise = (async () => {
    const bytes = await pdf.getData();
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `sha256:${hex}`;
  })();
  try {
    return await pdfDigestPromise;
  } catch (error) {
    if (pdfDigestDocument === pdf) {
      pdfDigestDocument = null;
      pdfDigestPromise = null;
    }
    throw error;
  }
}

async function pdfReviewTextPages() {
  const pdf = state.document;
  if (!pdf) return [];
  if (pdfReviewTextDocument === pdf && pdfReviewTextPagesPromise) return pdfReviewTextPagesPromise;
  pdfReviewTextDocument = pdf;
  pdfReviewTextPagesPromise = (async () => {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      pages.push({
        page: number,
        text: content.items.map((item) => item.str || '').join(' '),
      });
      if (pdf !== state.document) return [];
    }
    return pages;
  })().catch(() => []);
  return pdfReviewTextPagesPromise;
}

function placePdfBadgeAtPosition(page, review, position) {
  const pageView = pdfViewer.getPageView(position.page - 1);
  if (!pageView?.viewport) return;
  const cssX = position.x * pageView.viewport.width / pageView.pdfPage.getViewport({
    scale: 1, rotation: pageView.viewport.rotation,
  }).width;
  const cssY = position.y * pageView.viewport.height / pageView.pdfPage.getViewport({
    scale: 1, rotation: pageView.viewport.rotation,
  }).height;
  const badge = makeReviewBadge(review);
  const near = page.querySelectorAll(':scope > .review-no').length;
  badge.style.left = `${Math.max(0, cssX + (near % 4) * 24)}px`;
  badge.style.top = `${Math.max(0, cssY - 12 + Math.floor(near / 4) * 18)}px`;
  page.append(badge);
}

async function paintPdfMarks() {
  const generation = state.generation;
  const pdf = state.document;
  const serial = ++pdfPaintSerial;
  let digest;
  let textPages;
  try {
    [digest, textPages] = await Promise.all([pdfDocumentDigest(pdf), pdfReviewTextPages()]);
  } catch {
    return;
  }
  if (serial !== pdfPaintSerial || pdf !== state.document || generation !== state.generation || state.file?.kind !== 'pdf') return;
  for (const page of ui.viewer.querySelectorAll('.page')) {
    clearReviewBadges(page);
    clearReviewTint(page);
    unwrapReviewMarks(page.querySelector('.textLayer'));
  }
  if (!textPages.length) return;
  const locationUpdates = new Map();
  for (const review of state.reviews) {
    const start = review.at?.page;
    const anchor = review.anchor || { position: start ? { page: start } : null };
    if (reviewAction(review) === 'delete' && ['applied', 'resolved'].includes(reviewStatus(review))) {
      locationUpdates.set(reviewStateKey(state.file.path, review.id), 'preserved');
      continue;
    }
    const resolved = resolveReviewAnchor(textPages, review.quote, anchor);
    if (resolved.status !== 'located' && resolved.status !== 'changed') {
      const position = anchor.position;
      const sameRevision = anchor.documentRevision != null && anchor.documentRevision === digest;
      const page = position?.page && ui.viewer.querySelector(`.page[data-page-number="${position.page}"]`);
      if (sameRevision && page) {
        locationUpdates.set(reviewStateKey(state.file.path, review.id), 'positioned');
        placePdfBadgeAtPosition(page, review, position);
      } else {
        locationUpdates.set(reviewStateKey(state.file.path, review.id), resolved.status);
      }
      continue;
    }
    locationUpdates.set(reviewStateKey(state.file.path, review.id), resolved.status);
    const page = ui.viewer.querySelector(`.page[data-page-number="${resolved.page}"]`);
    const layer = page?.querySelector('.textLayer');
    if (!page) continue;
    if (layer) {
      const local = resolveReviewAnchor([{ page: resolved.page, text: collectTextParts(layer).joined }], review.quote, {
        ...anchor, position: { ...anchor.position, page: resolved.page },
      });
      const first = local.status === 'located' || local.status === 'changed'
        ? wrapPdfQuote(layer, review.quote, review.id, { start: local.start, end: local.end })
        : null;
      if (first && local.status === 'changed') {
        for (const piece of layer.querySelectorAll(`review-q[data-review-id="${review.id}"]`)) {
          piece.classList.add('changed');
        }
      }
      if (first) {
        placePdfBadge(page, first, review);
        continue;
      }
    }
    const sameRevision = anchor.documentRevision != null && anchor.documentRevision === digest;
    if (sameRevision && anchor.position?.page === resolved.page) {
      placePdfBadgeAtPosition(page, review, anchor.position);
    }
  }
  state.reviewLocations = locationUpdates;
  renderReviewList();
}

function paintReviewMarks() {
  if (state.file?.kind === 'markdown') {
    paintMarkdownMarks();
  } else if (state.file?.kind === 'pdf') {
    paintPdfMarks();
  }
}

function reviewFromEvent(event) {
  const host =
    event.target instanceof Element
      ? event.target.closest('[data-review-id], .review-page')
      : null;
  if (!host) {
    return null;
  }
  return host.dataset.reviewId || null;
}

let reviewChipTimer = 0;

function hideReviewMenu() {
  ui.reviewMenu.hidden = true;
}

function hideReviewChip() {
  window.clearTimeout(reviewChipTimer);
  reviewChipTimer = 0;
  ui.reviewChip.hidden = true;
}

function hideReviewChrome() {
  hideReviewChip();
  hideReviewMenu();
}

function placeFloating(node, x, y) {
  const pad = 8;
  const width = node.offsetWidth || 28;
  const height = node.offsetHeight || 28;
  node.style.left = `${Math.max(pad, Math.min(x, window.innerWidth - width - pad))}px`;
  node.style.top = `${Math.max(pad, Math.min(y, window.innerHeight - height - pad))}px`;
}

function selectionInDocument() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const el = node.nodeType === 3 ? node.parentElement : node;
  if (!(el instanceof Element)) {
    return null;
  }
  if (el.closest('#reviewPane, #noteBox, #editBox, #reviewChip, #reviewMenu, #bar, #find, #tabs')) {
    return null;
  }
  if (!el.closest('#markdown, #markdownRaw, #viewer, #viewerContainer, #markdownStage')) {
    return null;
  }
  return range;
}

function reviewFromSelection() {
  const picked = describeSelection();
  if (!picked || !hasLocator(picked) || !selectionInDocument()) {
    return null;
  }
  return picked;
}

function showReviewChip() {
  const range = selectionInDocument();
  if (!range || !reviewFromSelection() || !ui.noteBox.hidden || !ui.reviewMenu.hidden) {
    return;
  }
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    return;
  }
  reviewAnchorRect = rect;
  ui.reviewChip.hidden = false;
  placeFloating(ui.reviewChip, rect.right + 4, rect.top - 34);
}

function scheduleReviewChip() {
  window.clearTimeout(reviewChipTimer);
  reviewChipTimer = 0;
  ui.reviewChip.hidden = true;
  // Picking text for Reattach: the selection is the answer, not a new review.
  if (state.reattachReviewId) {
    hideReviewMenu();
    return;
  }
  if (!ui.noteBox.hidden) {
    hideReviewMenu();
    return;
  }
  if (state.file?.kind !== 'markdown' && state.file?.kind !== 'pdf') {
    hideReviewMenu();
    return;
  }
  // Outside review mode a selection is for copying: no chip.
  if (!state.reviewOpen || !reviewFromSelection()) {
    hideReviewMenu();
    return;
  }
  if (!ui.reviewMenu.hidden) {
    return;
  }
  reviewChipTimer = window.setTimeout(showReviewChip, REVIEW_CHIP_MS);
}

function onDocumentContextMenu(event) {
  if (state.file?.kind !== 'markdown' && state.file?.kind !== 'pdf') {
    return;
  }
  const edits = Boolean(markdownEditTarget());
  // Outside review mode, and with nothing to edit, the system menu stays,
  // with its Copy.
  if (!state.reviewOpen && !edits) {
    return;
  }
  if (!reviewFromSelection()) {
    return;
  }
  event.preventDefault();
  hideReviewChip();
  ui.reviewMenuReview.hidden = !state.reviewOpen;
  ui.reviewMenuCopy.hidden = state.reviewOpen;
  ui.reviewMenuEdit.hidden = !edits;
  ui.reviewMenu.hidden = false;
  placeFloating(ui.reviewMenu, event.clientX, event.clientY);
}

// ── Direct edits to Markdown ──────────────────────────────────────────────
// Bold, italic and the rest write the .md itself, through Rust, which first
// checks that the file is still the one on screen. Each edit can be undone.
// On by default; Settings turns it off.

function directEditsEnabled() {
  try {
    return localStorage.getItem('pdf-next.direct-edits') !== '0';
  } catch {
    return true;
  }
}

/// The selection, when it can be edited in place: rendered Markdown (not the
/// raw view), on a source line, with direct edits on.
/// Which rendered Markdown pane holds a non-empty selection: 'main', 'split' or null.
function renderedMarkdownSelection() {
  if (state.file?.kind !== 'markdown') return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const element = node.nodeType === 3 ? node.parentElement : node;
  if (!(element instanceof Element)) return null;
  if (ui.markdown.contains(element)) return 'main';
  return null;
}

function markdownEditTarget() {
  if (state.file?.kind !== 'markdown' || state.markdownRaw || !directEditsEnabled() ||
      typeof state.markdownSource !== 'string') {
    return null;
  }
  const range = selectionInDocument();
  if (!range || !ui.markdown.contains(range.commonAncestorContainer)) return null;
  const picked = describeSelection();
  if (!picked?.at?.line || !picked.quote) return null;
  return { range, picked };
}

async function applyDirectFormat(format) {
  hideReviewChrome();
  const target = markdownEditTarget();
  if (!target) {
    setStatus(state.file?.kind !== 'markdown'
      ? 'Formatting edits Markdown files only; add a review instead'
      : renderedMarkdownSelection()
        ? 'This selection cannot be traced to a line of the source: add a review instead'
        : 'Select text in the rendered Markdown to format it', { error: Boolean(renderedMarkdownSelection()) });
    return;
  }
  const node = target.range.commonAncestorContainer;
  const element = node.nodeType === 3 ? node.parentElement : node;
  if (element?.closest('pre, code, math')) {
    setStatus('Formatting does not apply inside code or equations', { error: true });
    return;
  }
  const raw = state.markdownSource;
  const span = sourceSpan(raw, target.picked.at.line, target.picked.at.end, target.picked.quote);
  if (!span.error && /\n[ \t]*\n/.test(raw.slice(span.start, span.end))) {
    setStatus('Formatting works within one paragraph: select less, or use Edit text… (Ctrl+E)', { error: true });
    return;
  }
  if (span.error) {
    setStatus(span.error === 'repeated'
      ? 'That text appears more than once in its paragraph: select a longer passage'
      : 'The selection crosses formatting or a link: use Edit text… (Ctrl+E)', { error: true });
    return;
  }
  const edit = formatEdit(raw, span, format);
  await writeMarkdownEdit(edit, `${FORMAT_LABELS[format]}${edit.removed ? ' removed' : ''}`);
}

/// Write one edit, then show the file as it now is. Undo writes the inverse,
/// against the digest this edit produced, so it never undoes over a change
/// made since.
async function writeMarkdownEdit({ start, expected, replacement }, label) {
  const file = state.file;
  if (!file || expected === replacement) return;
  const path = file.path;
  try {
    const next = await invoke('edit_markdown', {
      path, expectedDigest: state.markdownDigest, start, expectedText: expected, replacement,
    });
    pushUndo({
      path,
      label: label.toLowerCase(),
      run: async () => {
        await invoke('edit_markdown', {
          path, expectedDigest: next, start, expectedText: replacement, replacement: expected,
        });
        if (state.file?.path === path) {
          await openFile(state.file, { preserveView: true });
          setStatus(`Undone: ${label}`);
        }
      },
    });
    if (state.file?.path === path) {
      await openFile(state.file, { preserveView: true });
    }
    setStatus(`${label} · saved to ${file.name}`, { action: { label: 'Undo', run: () => void undoLast() } });
  } catch (error) {
    if (state.file?.path === path) {
      setStatus(`Could not edit the file: ${String(error)}`, { error: true });
    }
  }
}

/// Edit text: the source of the selection, or of its whole paragraph when the
/// selection crosses markup, in a small editor.
function openEditBox() {
  hideReviewChrome();
  const target = markdownEditTarget();
  if (!target) {
    setStatus(state.file?.kind === 'markdown'
      ? 'Select text in the rendered Markdown to edit it'
      : 'Edit text works on Markdown files only');
    return;
  }
  const raw = state.markdownSource;
  const { line, end } = target.picked.at;
  let span = sourceSpan(raw, line, end, target.picked.quote);
  let where = 'selection';
  if (span.error) {
    span = blockSpan(raw, line, end);
    where = span.endLine > span.line ? `lines ${span.line}–${span.endLine}` : `line ${span.line}`;
  }
  const expected = raw.slice(span.start, span.end);
  state.pendingEdit = { path: state.file.path, digest: state.markdownDigest, start: span.start, expected };
  ui.editRef.textContent = `${state.file.name} · ${where}`;
  ui.editText.value = expected;
  ui.editText.rows = Math.min(14, Math.max(3, expected.split('\n').length + 1));
  ui.editBox.hidden = false;
  const rect = target.range.getBoundingClientRect();
  const height = ui.editBox.offsetHeight || 160;
  const below = rect.bottom + 8;
  placeFloating(ui.editBox, rect.left, below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - height - 8));
  ui.editText.focus({ preventScroll: true });
}

function closeEditBox() {
  releaseFocus(ui.editBox);
  ui.editBox.hidden = true;
  ui.editText.value = '';
  state.pendingEdit = null;
}

async function saveEditBox() {
  const pending = state.pendingEdit;
  if (!pending || state.file?.path !== pending.path) {
    closeEditBox();
    return;
  }
  if (pending.digest !== state.markdownDigest) {
    setStatus('The file changed while you were editing; select the text again', { error: true });
    return;
  }
  const replacement = ui.editText.value;
  closeEditBox();
  await writeMarkdownEdit({ start: pending.start, expected: pending.expected, replacement }, 'Edit');
}

/// Right-click Delete: in rendered Markdown with direct edits on, deletes the
/// selected text immediately and pushes an Undo entry; otherwise creates a
/// 1-click delete review with Undo.
async function deleteSelectionNow() {
  hideReviewChrome();
  const target = markdownEditTarget();
  if (target) {
    const raw = state.markdownSource;
    const { line, end } = target.picked.at;
    const span = sourceSpan(raw, line, end, target.picked.quote);
    if (!span.error) {
      const edit = deleteEdit(raw, span);
      window.getSelection()?.removeAllRanges();
      await writeMarkdownEdit(edit, 'Delete');
      return;
    }
    if (!state.reviewOpen) {
      openEditBox();
      return;
    }
  }
  // The note box opens so a note can go with the deletion; Save (Enter) makes the review.
  if (state.reviewOpen) {
    openNoteBox('delete');
  }
}

// ── Settings ──────────────────────────────────────────────────────────────
// One place for the preferences. The Markdown and reload menus in the toolbar
// stay as shortcuts; the panel mirrors them and drives the same setters.

const UI_FONTS = ['system', 'mm-sans', 'weft'];
const SETTINGS_MIRRORS = [['setFont', 'mdFont'], ['setSize', 'mdSize'], ['setWidth', 'mdWidth'], ['setPoll', 'poll']];

function applyUiFont(value, { persist = true } = {}) {
  const chosen = UI_FONTS.includes(value) ? value : 'system';
  if (chosen === 'system') {
    delete document.documentElement.dataset.uiFont;
  } else {
    document.documentElement.dataset.uiFont = chosen;
  }
  if (ui.setUiFont) ui.setUiFont.value = chosen;
  if (!persist) return;
  try {
    localStorage.setItem('pdf-next.ui-font', chosen);
  } catch {
    // Preference only.
  }
}

const CODE_FONTS = ['system', 'monaspace-neon', 'monaspace-argon', 'monaspace-xenon', 'monaspace-radon', 'monaspace-krypton'];

/// The font for code blocks, inline code and the raw Markdown view.
function applyCodeFont(value, { persist = true } = {}) {
  const chosen = CODE_FONTS.includes(value) ? value : 'system';
  if (chosen === 'system') {
    delete document.documentElement.dataset.codeFont;
  } else {
    document.documentElement.dataset.codeFont = chosen;
  }
  if (ui.setCodeFont) ui.setCodeFont.value = chosen;
  if (!persist) return;
  try {
    localStorage.setItem('pdf-next.code-font', chosen);
  } catch {
    // Preference only.
  }
}

function syncSettings() {
  for (const [mine, theirs] of SETTINGS_MIRRORS) {
    const select = ui[mine];
    if (!select.options.length) {
      // Copy the menu with its groups, so Settings shows the fonts clustered too.
      for (const child of ui[theirs].children) {
        const copy = child.cloneNode(true);
        for (const option of copy.tagName === 'OPTION' ? [copy] : copy.querySelectorAll('option')) {
          option.removeAttribute('selected');
        }
        select.append(copy);
      }
    }
    select.value = ui[theirs].value;
  }
  ui.setDirectEdits.checked = directEditsEnabled();
  ui.setFocusMode.checked = focusModeEnabled();
  for (const select of ui.figureSelects) select.value = figureSetting(select.dataset.figure);
  ui.aboutVersion.textContent = state.version ? `Version ${state.version}` : '';
}

function toggleSettings(open = ui.settingsPanel.hidden) {
  if (open) syncSettings();
  else releaseFocus(ui.settingsPanel);
  ui.settingsPanel.hidden = !open;
  ui.settingsToggle.setAttribute('aria-pressed', String(open));
}

// ── Wiring ────────────────────────────────────────────────────────────────

ui.settingsToggle.addEventListener('click', () => toggleSettings());
ui.settingsClose.addEventListener('click', () => toggleSettings(false));
for (const [mine, theirs] of SETTINGS_MIRRORS) {
  ui[mine].addEventListener('change', () => {
    const select = ui[theirs];
    if (select.dataset.md) {
      setMarkdownStyle(select, ui[mine].value);
      schedulePaginate();
      scheduleWrap();
      if (state.selectedFigure) positionFigureResizer();
    } else {
      select.value = ui[mine].value;
      select.dispatchEvent(new Event('change'));
    }
  });
}
ui.setDirectEdits.addEventListener('change', () => {
  try {
    localStorage.setItem('pdf-next.direct-edits', ui.setDirectEdits.checked ? '1' : '0');
  } catch {
    // Preference only.
  }
});
ui.setUiFont.addEventListener('change', () => applyUiFont(ui.setUiFont.value));
ui.setCodeFont.addEventListener('change', () => applyCodeFont(ui.setCodeFont.value));
for (const select of ui.figureSelects) {
  select.addEventListener('change', () => {
    const name = select.dataset.figure;
    try {
      localStorage.setItem(FIGURE_SETTINGS[name].key, select.value);
    } catch {
      // Preference only.
    }
    applyFigureSettings();
    if (state.selectedFigure) positionFigureResizer();
    // Captions are text in the article: adding or removing them re-renders.
    if (name === 'caption' && state.file?.kind === 'markdown') {
      void openFile(state.file, { preserveView: true });
      for (const path of panes.visible()) void fillPane(path);
    }
  });
}
ui.aboutUpdate.addEventListener('click', () => ui.update.click());
ui.aboutSource.addEventListener('click', () => {
  void invoke('open_link', { url: 'https://github.com/machine-made/pdf-next' }).catch(() => {});
});

ui.open.addEventListener('click', async () => {
  const picked = await invoke('pick_file');
  if (picked) {
    await openPath(picked);
  }
});

ui.prev.addEventListener('click', () => {
  pdfViewer.currentPageNumber = Math.max(1, pdfViewer.currentPageNumber - 1);
});

ui.next.addEventListener('click', () => {
  pdfViewer.currentPageNumber = Math.min(
    pdfViewer.pagesCount,
    pdfViewer.currentPageNumber + 1,
  );
});

ui.page.addEventListener('change', () => {
  const requested = Number(ui.page.value);
  if (Number.isFinite(requested)) {
    pdfViewer.currentPageNumber = Math.min(
      Math.max(1, Math.trunc(requested)),
      pdfViewer.pagesCount || 1,
    );
  }
  updatePageControls();
});

ui.zoom.addEventListener('change', () => {
  const value = ui.zoom.value;
  if (value === 'custom') {
    return;
  }
  // A fit preset is the opposite instruction to wrap — it sizes the content to
  // the window — so asking for one turns wrap off rather than fighting it.
  if (state.wrap && (value === 'auto' || value === 'page-fit' || value === 'page-width')) {
    setWrap(false);
  }
  applyZoomChoice(value);
});

ui.zoomIn.addEventListener('click', () => stepZoom(1));
ui.zoomOut.addEventListener('click', () => stepZoom(-1));
wireMenuWheel();
ui.copyPath.addEventListener('click', () => void copyFileText('path'));
ui.copyName.addEventListener('click', () => void copyFileText('name'));
ui.mode.addEventListener('click', (event) => cycleMode(event.shiftKey || event.altKey));
ui.print.addEventListener('click', printDocument);
ui.reduce.addEventListener('click', () => void reduceOpenPdf());

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}

/// Write `{stem}_reduced.pdf` beside the open PDF (original untouched).
async function reduceOpenPdf() {
  if (!state.file || state.file.kind !== 'pdf') {
    setStatus('Open a PDF first');
    return;
  }
  if (ui.reduce.disabled) {
    return;
  }
  ui.reduce.disabled = true;
  setStatus('Reducing…', { sticky: true });
  try {
    const result = await invoke('reduce_pdf', { path: state.file.path });
    if (!result?.wrote) {
      setStatus(`Already small (${formatBytes(result?.before)})`);
      return;
    }
    const pct =
      result.before > 0
        ? Math.round(((result.before - result.after) * 100) / result.before)
        : 0;
    setStatus(
      `${formatBytes(result.before)} → ${formatBytes(result.after)} (${pct}% · ${result.path})`,
    );
    await openPath(result.path);
  } catch (error) {
    setStatus(`Could not reduce: ${error?.message || error}`, { error: true, sticky: true });
  } finally {
    ui.reduce.disabled = false;
  }
}

// ── Updates ───────────────────────────────────────────────────────────────
//
// One button, and one check at launch. Starting the app asks GitHub for the
// latest release, once, a moment after the first paint; a press asks again.
// If it is newer the button lights up and becomes the download — opened in
// your browser, so the file arrives visibly, from the repo, the same way a
// first install does. Nothing polls: there is no timer and no background
// check, and the launch check is the only network request the app makes on
// its own.

const RELEASES_API =
  'https://api.github.com/repos/machine-made/pdf-next/releases/latest';

/// `v0.6.0` or `0.6.0` → [0, 6, 0]; anything else → null.
function parseVersion(text) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text || '');
  return match ? match.slice(1, 4).map(Number) : null;
}

function isNewer(candidate, current) {
  for (let i = 0; i < 3; i += 1) {
    if (candidate[i] !== current[i]) {
      return candidate[i] > current[i];
    }
  }
  return false;
}

/// The installer for this platform, in order of preference; null when the
/// release has none, in which case the release page itself is the target.
function pickAsset(assets, platform) {
  const preferred = {
    windows: [/-setup\.exe$/i, /\.msi$/i],
    macos: [/\.dmg$/i],
    linux: [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i],
  }[platform] || [];
  for (const pattern of preferred) {
    const asset = assets.find((entry) => pattern.test(entry?.name || ''));
    if (asset?.browser_download_url) {
      return asset.browser_download_url;
    }
  }
  return null;
}

/// A press, or the one check at launch. `quiet` is the launch: it says
/// nothing unless there is a newer release, so an offline machine or a
/// current build gets no message at all.
async function checkForUpdates({ quiet = false } = {}) {
  if (state.update) {
    try {
      saveSession();
      await invoke('open_download', { url: state.update.url });
      setStatus(`Downloading pdf-next ${state.update.version} in your browser`);
    } catch (error) {
      setStatus(String(error), { error: true });
    }
    return;
  }
  ui.update.disabled = true;
  if (!quiet) {
    setStatus('Checking for updates…', { sticky: true });
  }
  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status}`);
    }
    const release = await response.json();
    const latest = parseVersion(release?.tag_name);
    const current = parseVersion(state.version);
    if (!latest || !current) {
      throw new Error('could not read the version number');
    }
    if (!isNewer(latest, current)) {
      if (!quiet) {
        setStatus(`You have the latest version (${state.version})`);
      }
      return;
    }
    const version = latest.join('.');
    const url = pickAsset(release?.assets || [], state.platform) || release?.html_url;
    if (typeof url !== 'string') {
      throw new Error('the release has nothing to download');
    }
    state.update = { version, url };
    ui.update.classList.add('available');
    ui.update.title = `Download pdf-next ${version}`;
    ui.update.setAttribute('aria-label', ui.update.title);
    setStatus(
      quiet
        ? `pdf-next ${version} is available — press the update button to download it`
        : `pdf-next ${version} is available — press the button again to download it`,
      { sticky: true },
    );
  } catch (error) {
    if (!quiet) {
      setStatus(`Could not check for updates: ${error?.message || error}`, {
        error: true,
      });
    }
  } finally {
    ui.update.disabled = false;
  }
}

ui.update.addEventListener('click', () => checkForUpdates());
ui.wrap.addEventListener('click', toggleWrap);
ui.raw.addEventListener('click', () => setRaw(!state.markdownRaw));
ui.pageView.addEventListener('change', () => setPageView(ui.pageView.value));
ui.splitView?.addEventListener('change', () => void setSplitView(ui.splitView.value));
// A figure that arrives after the cut changes its block's height.
ui.markdown.addEventListener('load', () => {
  schedulePaginate();
  if (state.restoringMarkdownView) {
    applyRestoredMarkdownScroll(state.restoringMarkdownView);
    window.requestAnimationFrame(() => {
      if (state.restoringMarkdownView) {
        applyRestoredMarkdownScroll(state.restoringMarkdownView);
      }
    });
  }
}, true);
for (const select of [ui.mdFont, ui.mdSize, ui.mdWidth]) {
  select.addEventListener('change', () => {
    setMarkdownStyle(select, select.value);
    if (!ui.settingsPanel.hidden) syncSettings();
    schedulePaginate();
    scheduleWrap();
    if (state.selectedFigure) positionFigureResizer();
  });
}
ui.notes.addEventListener('click', () => toggleReviewPanel());
ui.reviewSizeDown.addEventListener('click', () => stepReviewSize(-1));
ui.reviewSizeUp.addEventListener('click', () => stepReviewSize(1));
ui.reviewActionFilter.addEventListener('change', () => {
  state.reviewActionFilter = ui.reviewActionFilter.value;
  renderReviewList();
});
ui.reviewStatusFilter.addEventListener('change', () => {
  state.reviewStatusFilter = ui.reviewStatusFilter.value;
  renderReviewList();
});
ui.noteAction.addEventListener('change', updateNotePlaceholder);
// Clicking a button keeps the caret in the note, so Enter saves right after.
ui.noteRequests?.addEventListener('mousedown', (event) => {
  if (event.target.closest?.('.request-chip')) event.preventDefault();
});
ui.noteRequests?.addEventListener('click', (event) => {
  const chip = event.target.closest?.('.request-chip');
  if (!chip) return;
  state.pendingRequests = toggleRequest(state.pendingRequests || [], chip.dataset.request);
  renderNoteRequests();
  ui.noteText.focus({ preventScroll: true });
});
if (ui.noteInsert) {
  ui.noteInsert.addEventListener('click', () => void insertNoteParenthetical());
}
ui.reviewChip.addEventListener('pointerdown', (event) => {
  event.preventDefault();
});
ui.reviewChip.addEventListener('click', () => openNoteBox());
ui.reviewMenuAdd.addEventListener('pointerdown', (event) => {
  event.preventDefault();
});
ui.reviewMenuAdd.addEventListener('click', () => openNoteBox());
ui.reviewMenuDelete.addEventListener('pointerdown', (event) => event.preventDefault());
ui.reviewMenuDelete.addEventListener('click', () => void deleteSelectionNow());
if (ui.reviewMenuDefine) {
  ui.reviewMenuDefine.addEventListener('pointerdown', (event) => event.preventDefault());
  ui.reviewMenuDefine.addEventListener('click', () => openNoteBox('define'));
}
if (ui.reviewMenuGloss) {
  ui.reviewMenuGloss.addEventListener('pointerdown', (event) => event.preventDefault());
  ui.reviewMenuGloss.addEventListener('click', () => openNoteBox('gloss'));
}
for (const button of [ui.reviewMenuCopy, ui.reviewMenuEditText, ...ui.reviewMenuEdit.querySelectorAll('[data-format]')]) {
  // Keep the selection: these act on it.
  button.addEventListener('pointerdown', (event) => event.preventDefault());
}
ui.reviewMenuCopy.addEventListener('click', async () => {
  const text = window.getSelection()?.toString() ?? '';
  hideReviewMenu();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    setStatus('Clipboard refused the text', { error: true });
  }
});
for (const button of ui.reviewMenuEdit.querySelectorAll('[data-format]')) {
  button.addEventListener('click', () => void applyDirectFormat(button.dataset.format));
}
ui.reviewMenuEditText.addEventListener('click', () => openEditBox());
ui.editSave.addEventListener('click', () => void saveEditBox());
ui.editCancel.addEventListener('click', () => closeEditBox());
ui.editClose.addEventListener('click', () => closeEditBox());
ui.editText.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void saveEditBox();
  }
});
document.addEventListener('selectionchange', scheduleReviewChip);
// A selection is finished when the button or the Shift key is let go.
document.addEventListener('pointerup', () => {
  if (state.reattachReviewId) window.setTimeout(() => void finishReattachPick(), 0);
});
document.addEventListener('keyup', (event) => {
  if (state.reattachReviewId && event.key === 'Shift') void finishReattachPick();
});
ui.container.addEventListener('contextmenu', onDocumentContextMenu);
ui.markdownStage.addEventListener('contextmenu', onDocumentContextMenu);
ui.container.addEventListener('scroll', hideReviewChrome, { passive: true });
function hideFigureResizer() {
  if (state.selectedFigure) {
    state.selectedFigure.classList.remove('md-figure-selected');
    state.selectedFigure = null;
  }
  if (ui.figureResizer) {
    ui.figureResizer.hidden = true;
  }
}

function positionFigureResizer() {
  const image = state.selectedFigure;
  if (!image || !image.isConnected || !ui.figureResizer || !ui.markdownStage) {
    hideFigureResizer();
    return;
  }
  const stageRect = ui.markdownStage.getBoundingClientRect();
  const imgRect = image.getBoundingClientRect();
  if (!imgRect.width || !imgRect.height) {
    hideFigureResizer();
    return;
  }
  const top = imgRect.top - stageRect.top + ui.markdownStage.scrollTop;
  const left = imgRect.left - stageRect.left + ui.markdownStage.scrollLeft;
  ui.figureResizer.style.top = `${Math.round(top)}px`;
  ui.figureResizer.style.left = `${Math.round(left)}px`;
  ui.figureResizer.style.width = `${Math.round(imgRect.width)}px`;
  ui.figureResizer.style.height = `${Math.round(imgRect.height)}px`;
  const containerWidth = image.parentElement?.getBoundingClientRect?.()?.width || ui.markdown.clientWidth || imgRect.width;
  const columnWidth = Math.max(1, containerWidth);
  const pct = Math.min(100, Math.max(10, Math.round((imgRect.width / columnWidth) * 100)));
  if (ui.figureResizerLabel) {
    ui.figureResizerLabel.textContent = `${pct}%`;
  }
  ui.figureResizer.hidden = false;
}

function selectFigureForResize(image) {
  if (state.selectedFigure && state.selectedFigure !== image) {
    state.selectedFigure.classList.remove('md-figure-selected');
  }
  state.selectedFigure = image;
  image.classList.add('md-figure-selected');
  positionFigureResizer();
}

if (ui.figureResizerGrip) {
  ui.figureResizerGrip.addEventListener('pointerdown', (event) => {
    const image = state.selectedFigure;
    if (event.button !== 0 || !image || !image.isConnected) return;
    event.preventDefault();
    event.stopPropagation();
    ui.figureResizerGrip.setPointerCapture(event.pointerId);
    const containerWidth = image.parentElement?.getBoundingClientRect?.()?.width || ui.markdown.clientWidth || image.getBoundingClientRect().width;
    const columnWidth = Math.max(1, containerWidth);
    const startX = event.clientX;
    const startWidth = image.getBoundingClientRect().width;
    let lastPct = Math.min(100, Math.max(10, Math.round((startWidth / columnWidth) * 100)));
    const onMove = (moveEvent) => {
      const nextWidth = Math.max(48, startWidth + (moveEvent.clientX - startX));
      lastPct = Math.min(100, Math.max(10, Math.round((nextWidth / columnWidth) * 100)));
      image.style.width = `${lastPct}%`;
      image.style.maxWidth = '100%';
      image.setAttribute('width', `${lastPct}%`);
      positionFigureResizer();
    };
    const onUp = async () => {
      ui.figureResizerGrip.removeEventListener('pointermove', onMove);
      ui.figureResizerGrip.removeEventListener('pointerup', onUp);
      ui.figureResizerGrip.removeEventListener('pointercancel', onUp);
      schedulePaginate();
      const line = lineNear(image, ui.markdown);
      if (line && directEditsEnabled() && typeof state.markdownSource === 'string') {
        const edit = figureWidthEdit(state.markdownSource, line, lastPct);
        if (edit && !edit.error) {
          await writeMarkdownEdit(edit, `Figure width ${lastPct}%`);
        } else if (edit?.error === 'several-images') {
          setStatus('More than one image shares this paragraph, so the width is not saved. Put each figure in its own paragraph.', { error: true });
        } else if (edit?.error === 'malformed-attribute') {
          setStatus('This figure\'s width is not saved: its size is not a plain value such as 60% or 5cm. Edit the file by hand.', { error: true });
        }
      }
    };
    ui.figureResizerGrip.addEventListener('pointermove', onMove);
    ui.figureResizerGrip.addEventListener('pointerup', onUp);
    ui.figureResizerGrip.addEventListener('pointercancel', onUp);
  });
}

ui.markdownStage.addEventListener('wheel', () => {
  state.restoringMarkdownView = null;
}, { passive: true });
ui.markdownStage.addEventListener('scroll', () => {
  hideReviewChrome();
  if (state.selectedFigure) positionFigureResizer();
}, { passive: true });
document.addEventListener('pointerdown', (event) => {
  state.restoringMarkdownView = null;
  const target = event.target;
  if (target instanceof Element && !target.closest('img[data-doc], #figureResizer')) {
    hideFigureResizer();
  }
  if (target instanceof Element && target.closest('#reviewChip, #reviewMenu, #noteBox, #editBox')) {
    return;
  }
  hideReviewMenu();
  if (!ui.settingsPanel.hidden && target instanceof Element && !target.closest('#settingsPanel, #settingsToggle')) {
    toggleSettings(false);
  }
  // A click elsewhere closes a composer you have not typed in. One with text
  // stays, so a stray click cannot lose a comment.
  if (!ui.noteBox.hidden && !ui.noteText.value.trim()) {
    closeNoteBox();
  }
});

// Single-click selects a figure in Markdown for drag-resizing; double-click
// (or Ctrl/Cmd-click) opens the figure full size in a tab of its own.
ui.markdown.addEventListener('click', (event) => {
  const image = event.target instanceof Element ? event.target.closest('img[data-doc]') : null;
  if (!image || event.button !== 0 || !window.getSelection()?.isCollapsed || state.reattachReviewId) return;
  event.preventDefault();
  if (event.detail === 2 || event.ctrlKey || event.metaKey) {
    state.selectedFigure = image;
    if (ui.figureResizer) ui.figureResizer.hidden = true;
    void openPath(image.dataset.doc);
    return;
  }
  if (event.detail === 1) {
    selectFigureForResize(image);
  }
});
// A link in a markdown file must not leave the page. A relative one —
// `[notes](other.md)` — resolves against the app origin, which the navigation
// guard trusts, so following it would replace the viewer with a blank 404 and
// no way back. Rust now refuses relative URLs too; this is the second lock.
// Only same-page anchors — footnotes, and headings that carry an id — do
// anything, and they scroll rather than navigate.
ui.container.addEventListener('click', (event) => {
  const link =
    event.target instanceof Element ? event.target.closest('.annotationLayer a[href]') : null;
  const href = link?.getAttribute('href') || '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    // Only the web leaves; mailto and every other scheme do nothing.
    event.preventDefault();
    if (/^https?:/i.test(href)) {
      void invoke('open_link', { url: href }).catch((error) => {
        setStatus(String(error), { error: true });
      });
    }
    return;
  }
  const reviewId = reviewFromEvent(event);
  if (reviewId) {
    selectReview(reviewId);
    void setReviewOpen(true);
  }
});

// An equation label keeps its percent-encoding in the id as well as in the
// link, while a hand-written link to a heading may be encoded where the id is
// not. The fragment is tried as written, then decoded.
function markdownFragmentTarget(fragment, root = ui.markdown) {
  const find = (id) => id && root.querySelector(`[id="${CSS.escape(id)}"]`);
  let decoded;
  try {
    decoded = decodeURIComponent(fragment);
  } catch {
    decoded = '';
  }
  return find(fragment) || find(decoded) || null;
}

ui.markdown.addEventListener('click', (event) => {
  const reviewId = reviewFromEvent(event);
  if (reviewId) {
    selectReview(reviewId);
    void setReviewOpen(true);
  }
  const anchor =
    event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (!anchor) {
    return;
  }
  event.preventDefault();
  const href = anchor.getAttribute('href') || '';
  if (href.startsWith('#')) {
    // Same page: footnotes, and links to headings.
    markdownFragmentTarget(href.slice(1))?.scrollIntoView({ block: 'start' });
    return;
  }
  if (/^https?:/i.test(href)) {
    // The web: the system browser's, never this window's.
    void invoke('open_link', { url: href }).catch((error) => {
      setStatus(String(error), { error: true });
    });
    return;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return;
  }
  // A path next to this file: another note, a figure, the paper it cites.
  // Opened as a tab when it is a kind pdf-next shows; the backend says so
  // otherwise.
  const target = siblingPath(href);
  if (target) {
    void openPath(target);
  }
});

/** A relative link, resolved against the folder of the file being read. */
function siblingPath(href, from = state.file?.path) {
  const bare = href.split(/[?#]/, 1)[0];
  let relative;
  try {
    relative = decodeURIComponent(bare);
  } catch {
    return null;
  }
  if (!relative || !from) {
    return null;
  }
  const cut = Math.max(from.lastIndexOf('/'), from.lastIndexOf('\\'));
  return from.slice(0, cut + 1) + relative;
}
for (const [edge, button] of Object.entries(ui.dockButtons)) {
  button.addEventListener('click', () => dockTo(edge));
}
ui.imagePrev.addEventListener('click', () => stepSibling(-1));
ui.imageNext.addEventListener('click', () => stepSibling(1));
ui.rotate.addEventListener('click', () => setImageRotation(state.imageRotation + 90));

// A turned picture at 'fit', and any picture at 'page-fit', is sized by script,
// not by max-width, so it has to be laid out again when the stage changes
// shape. An upright picture at 'fit' costs nothing.
new ResizeObserver(() => {
  if (state.file?.kind === 'image' && (state.imageScale === 'page-fit' ||
      (state.imageRotation !== 0 && state.imageScale === 'fit'))) {
    layoutImage();
  }
}).observe(ui.imageStage);

ui.poll.addEventListener('change', () => {
  const seconds = Number(ui.poll.value) || 0;
  invoke('set_poll_seconds', { seconds });
  try {
    localStorage.setItem('pdf-next.poll', String(seconds));
  } catch {
    // Preference only.
  }
});

window.addEventListener('resize', () => {
  hideReviewChrome();
});

// A preset — fit page, fit width, auto — is a promise about the viewport, and
// PDF.js on its own only keeps it at the size the viewport had when it was
// chosen. Re-applying the same preset makes it recompute; it says nothing if
// the scale comes out unchanged. Watched on the container rather than the
// window, because the tab strip appearing takes height off the viewport
// without the window changing at all. One frame per burst of resize events.
let refitFrame = 0;
new ResizeObserver(() => {
  if (!state.document || !Number.isNaN(Number.parseFloat(pdfViewer.currentScaleValue))) {
    return;
  }
  window.cancelAnimationFrame(refitFrame);
  refitFrame = window.requestAnimationFrame(() => {
    if (state.document) {
      pdfViewer.currentScaleValue = pdfViewer.currentScaleValue;
    }
  });
}).observe(ui.container);

ui.findToggle.addEventListener('click', () => (ui.find.hidden ? openFind() : closeFind()));
ui.findClose.addEventListener('click', closeFind);
ui.findNext.addEventListener('click', () => runFind('again', true, false));
ui.findPrev.addEventListener('click', () => runFind('again', true, true));

ui.findInput.addEventListener('input', () => {
  window.clearTimeout(findTimer);
  if (state.file?.kind === 'markdown') {
    findTimer = window.setTimeout(() => {
      findTimer = 0;
      runFind('');
    }, 150);
  } else {
    runFind('');
  }
});
ui.findInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (findTimer) {
      // Enter on a query that has not been searched yet searches it.
      window.clearTimeout(findTimer);
      findTimer = 0;
      runFind('');
      return;
    }
    runFind('again', true, event.shiftKey);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeFind();
  }
});

ui.noteText.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void saveNote();
  }
});

ui.noteSave.addEventListener('click', () => void saveNote());
ui.noteCancel.addEventListener('click', () => closeNoteBox());
ui.noteClose.addEventListener('click', () => closeNoteBox());


eventBus.on('textlayerrendered', () => {
  if (state.file?.kind === 'pdf' && state.reviews.length) {
    paintPdfMarks();
  }
});

eventBus.on('pagechanging', updatePageControls);
eventBus.on('pagesloaded', updatePageControls);
eventBus.on('scalechanging', (event) => {
  // On a window resize PDF.js reports the computed scale with no preset, even
  // though it is still tracking "fit page" — so fall back to the live value.
  const value = event.presetValue || pdfViewer.currentScaleValue || event.scale;
  updateZoomControl(String(value), event.scale);
  scheduleWrap();
});
eventBus.on('updatefindmatchescount', ({ matchesCount }) => {
  ui.findCount.textContent = matchesCount?.total
    ? `${matchesCount.current}/${matchesCount.total}`
    : '';
});
eventBus.on('updatefindcontrolstate', ({ matchesCount, state: findState }) => {
  if (findState === 1) {
    ui.findCount.textContent = 'No match';
    return;
  }
  ui.findCount.textContent = matchesCount?.total
    ? `${matchesCount.current}/${matchesCount.total}`
    : '';
});

// ── Command palette ───────────────────────────────────────────────────────
// Every command calls what its button or shortcut calls; `when` keeps the list
// to what applies to the file and window as they are when the palette opens.

const palette = createPalette({
  platform: () => state.platform,
  onOpen: syncSettings,
  onError: (error) => setStatus(String(error?.message || error), { error: true }),
});
{
  const kind = () => state.file?.kind;
  const hasFile = () => Boolean(state.file);
  const markdown = () => kind() === 'markdown';
  const reviewable = () => kind() === 'pdf' || kind() === 'markdown';
  const rendered = () => markdown() && !state.markdownRaw;
  const editable = () => rendered() && Boolean(renderedMarkdownSelection());
  const reviewSelection = () => reviewable() && Boolean(reviewFromSelection());
  const figureLabels = { width: 'Figure width', height: 'Figure height', align: 'Figure place', caption: 'Figure captions' };
  const modeLabels = [[null, 'Clear'], ['night', 'Night'], ['invert', 'Invert'], ['sepia', 'Sepia']];
  const directEdits = (on) => {
    ui.setDirectEdits.checked = on;
    ui.setDirectEdits.dispatchEvent(new Event('change'));
  };
  palette.add(
    { label: 'Open file…', group: 'File', shortcut: 'Ctrl+O', icon: '#i-open', run: () => ui.open.click() },
    { label: 'Reload', group: 'File', shortcut: 'Ctrl+R', when: hasFile, run: () => openFile(state.file, { preserveView: true }) },
    { label: 'Print…', group: 'File', shortcut: 'Ctrl+P', icon: '#i-print', when: hasFile, run: printDocument },
    { label: 'Copy the full path', group: 'File', icon: '#i-copy-path', when: hasFile, run: () => copyFileText('path') },
    { label: 'Copy the file name', group: 'File', icon: '#i-copy-name', when: hasFile, run: () => copyFileText('name') },
    { label: 'Reduce PDF size', group: 'File', icon: '#i-reduce', when: () => kind() === 'pdf', run: reduceOpenPdf },
    { label: 'Move the file to the trash…', group: 'File', shortcut: 'Delete', when: hasFile, run: trashShownFile },
    { label: 'Undo', group: 'File', shortcut: 'Ctrl+Z', run: () => undoLast().then((done) => done || setStatus('Nothing to undo')) },
    { label: 'Check for updates', group: 'File', icon: '#i-update', run: () => checkForUpdates() },
    { label: 'Find', group: 'View', shortcut: 'Ctrl+F', icon: '#i-find', when: reviewable, run: openFind },
    { label: 'Zoom in', group: 'View', shortcut: '+', icon: '#i-zoom-in', when: hasFile, run: () => stepZoom(1) },
    { label: 'Zoom out', group: 'View', shortcut: '-', icon: '#i-zoom-out', when: hasFile, run: () => stepZoom(-1) },
    selectChoices(ui.zoom, { id: 'zoom', label: 'Zoom', group: 'View', when: hasFile }),
    selectChoices(ui.pageView, { id: 'page-view', label: 'Page view', group: 'View', when: reviewable }),
    { label: 'Next page', group: 'View', shortcut: 'n', icon: '#i-next', when: () => kind() === 'pdf', run: () => ui.next.click() },
    { label: 'Previous page', group: 'View', shortcut: 'p', icon: '#i-prev', when: () => kind() === 'pdf', run: () => ui.prev.click() },
    { label: 'Next file in folder', group: 'View', shortcut: '→', icon: '#i-next', when: () => kind() === 'image', run: () => stepSibling(1) },
    { label: 'Previous file in folder', group: 'View', shortcut: '←', icon: '#i-prev', when: () => kind() === 'image', run: () => stepSibling(-1) },
    { label: 'Rotate a quarter turn clockwise', group: 'View', icon: '#i-rotate', when: () => kind() === 'image', run: () => setImageRotation(state.imageRotation + 90) },
    { label: 'Page mode: next', group: 'View', icon: '#i-mode', run: () => cycleMode(false) },
    () => modeLabels.map(([mode, name]) => ({
      id: `mode:${mode}`, label: `Page mode: ${name}`, group: 'View', icon: '#i-mode',
      current: state.mode === mode, run: () => setMode(mode),
    })),
    { label: 'Show the raw markdown', group: 'Markdown', shortcut: 'Ctrl+U', icon: '#i-raw', when: rendered, run: () => setRaw(true) },
    { label: 'Show the rendered markdown', group: 'Markdown', shortcut: 'Ctrl+U', icon: '#i-raw', when: () => markdown() && state.markdownRaw, run: () => setRaw(false) },
    selectChoices(ui.mdFont, { id: 'md-font', label: 'Font', group: 'Markdown', when: markdown }),
    selectChoices(ui.mdSize, { id: 'md-size', label: 'Text size', group: 'Markdown', when: markdown }),
    selectChoices(ui.mdWidth, { id: 'md-width', label: 'Column width', group: 'Markdown', when: markdown }),
    ...[['bold', 'Ctrl+B'], ['italic', 'Ctrl+I'], ['underline', 'Ctrl+U'], ['strike', 'Ctrl+S'], ['code', '']].map(([format, shortcut]) => ({
      label: `${FORMAT_LABELS[format]} the selection`, group: 'Markdown', shortcut, when: editable, run: () => applyDirectFormat(format),
    })),
    { label: 'Edit the selected text…', group: 'Markdown', shortcut: 'Ctrl+E', when: editable, run: openEditBox },
    { label: 'Delete the selection', group: 'Markdown', shortcut: 'Delete', when: () => Boolean(markdownEditTarget()) || (state.reviewOpen && reviewSelection()), run: deleteSelectionNow },
    { label: 'Open the review panel', group: 'Review', shortcut: 'Ctrl+Shift+R', icon: '#i-review', when: () => reviewable() && !state.reviewOpen, run: toggleReviewPanel },
    { label: 'Close the review panel', group: 'Review', shortcut: 'Ctrl+Shift+R', icon: '#i-review', when: () => state.reviewOpen, run: toggleReviewPanel },
    { label: 'Add a review of the selection', group: 'Review', shortcut: 'Ctrl+Shift+N', icon: '#i-add-review', when: reviewSelection, run: () => openNoteBox() },
    { label: 'Parenthetical definition of the selection…', group: 'Review', when: reviewSelection, run: () => openNoteBox('define') },
    { label: 'Gloss the selection…', group: 'Review', when: reviewSelection, run: () => openNoteBox('gloss') },
    { label: 'Copy the selection as a review quote', group: 'Review', shortcut: 'Ctrl+Shift+A', icon: '#i-ask', when: () => reviewable() && Boolean(describeSelection()), run: askSelection },
    { label: 'Larger review text', group: 'Review', when: () => state.reviewOpen, run: () => stepReviewSize(1) },
    { label: 'Smaller review text', group: 'Review', when: () => state.reviewOpen, run: () => stepReviewSize(-1) },
    selectChoices(ui.reviewActionFilter, { id: 'review-action', label: 'Show reviews by action', group: 'Review', when: () => state.reviewOpen }),
    selectChoices(ui.reviewStatusFilter, { id: 'review-status', label: 'Show reviews by status', group: 'Review', when: () => state.reviewOpen }),
    { label: 'Split right', group: 'Panes', shortcut: 'Ctrl+Shift+D', when: hasFile, run: () => splitPane('right') },
    { label: 'Split down', group: 'Panes', shortcut: 'Ctrl+Shift+E', when: hasFile, run: () => splitPane('bottom') },
    { label: 'Back to one pane', group: 'Panes', when: () => panes.active, run: () => setSplitView('off') },
    ...[['left', '←'], ['right', '→'], ['up', '↑'], ['down', '↓']].map(([direction, arrow]) => ({
      label: `Move to the pane ${direction === 'up' ? 'above' : direction === 'down' ? 'below' : `on the ${direction}`}`,
      group: 'Panes', shortcut: `Ctrl+Alt+${arrow}`, when: () => panes.active, run: () => movePaneFocus(direction),
    })),
    { label: 'Fit the window to the content', group: 'Window', shortcut: 'Ctrl+Shift+F', icon: '#i-wrap', run: toggleWrap },
    ...[['left', 'left half', '←'], ['right', 'right half', '→'], ['top', 'top half', '↑'], ['bottom', 'bottom half', '↓']].map(([edge, half, arrow]) => ({
      label: `Fill the ${half} of the screen`, group: 'Window', shortcut: `Ctrl+Shift+${arrow}`, icon: `#i-dock-${edge}`, run: () => dockTo(edge),
    })),
    { label: 'Center and fit the window to the page', group: 'Window', shortcut: 'Ctrl+Shift+Enter', icon: '#i-dock-center', run: () => dockTo('center') },
    { label: 'Full screen', group: 'Window', shortcut: 'F11', icon: '#i-fullscreen', run: () => toggleFullScreen() },
    { label: 'Present', group: 'View', shortcut: 'F5', icon: '#i-present', when: reviewable, run: startPresentation },
    { label: 'Open settings', group: 'Settings', shortcut: 'Ctrl+,', icon: '#i-settings', when: () => ui.settingsPanel.hidden, run: () => toggleSettings(true) },
    { label: 'Close settings', group: 'Settings', shortcut: 'Ctrl+,', icon: '#i-settings', when: () => !ui.settingsPanel.hidden, run: () => toggleSettings(false) },
    selectChoices(ui.setUiFont, { id: 'ui-font', label: 'Interface font', group: 'Settings' }),
    selectChoices(ui.setCodeFont, { id: 'code-font', label: 'Code font', group: 'Settings' }),
    selectChoices(ui.poll, { id: 'poll', label: 'Check for changes', group: 'Settings' }),
    ...Array.from(ui.figureSelects, (select) => selectChoices(select, { id: `figure-${select.dataset.figure}`, label: figureLabels[select.dataset.figure], group: 'Settings' })),
    () => [true, false].map((on) => ({
      id: `focus-mode:${on}`, label: `Hide the toolbar while reading: ${on ? 'on' : 'off'}`, group: 'Settings',
      current: focusModeEnabled() === on, run: () => setFocusModeEnabled(on),
    })),
    () => [true, false].map((on) => ({
      id: `direct-edits:${on}`, label: `Edit the Markdown file in place: ${on ? 'on' : 'off'}`, group: 'Settings',
      current: directEditsEnabled() === on, run: () => directEdits(on),
    })),
    () => state.tabs.map((tab, index) => ({
      id: `tab:${tab.path}`, label: `Go to ${tab.name}`, group: 'Tabs', detail: tab.path === tab.name ? '' : tab.path,
      shortcut: index < 9 ? `Ctrl+${index + 1}` : '', current: index === state.active, run: () => activateTab(index),
    })),
    { label: 'Next tab', group: 'Tabs', shortcut: 'Ctrl+Tab', icon: '#i-next', when: () => state.tabs.length > 1, run: () => cycleTab(1) },
    { label: 'Previous tab', group: 'Tabs', shortcut: 'Ctrl+Shift+Tab', icon: '#i-prev', when: () => state.tabs.length > 1, run: () => cycleTab(-1) },
    { label: 'Close tab', group: 'Tabs', shortcut: 'Ctrl+W', icon: '#i-close', when: hasFile, run: () => closeTab(state.active) },
    { label: 'Close all tabs', group: 'Tabs', icon: '#i-close', when: () => state.tabs.length > 1, run: closeAll },
  );
  el('paletteOpen')?.addEventListener('click', () => {
    toggleSettings(false);
    palette.open();
  });
}

// ── Quiet toolbar, focus mode, full screen, presentation ─────────────────

const viewMenu = wirePopover(ui.viewMenuButton, ui.viewMenu);
const dockMenu = wirePopover(ui.dockMenuButton, ui.dockMenu);

function focusModeEnabled() {
  try {
    return localStorage.getItem('pdf-next.focus-mode') !== '0';
  } catch {
    return true;
  }
}

function setFocusModeEnabled(on) {
  try {
    localStorage.setItem('pdf-next.focus-mode', on ? '1' : '0');
  } catch {
    // Preference only.
  }
  ui.setFocusMode.checked = on;
  focusMode.check();
}

const focusMode = createFocusMode({
  bar: ui.bar,
  enabled: focusModeEnabled,
  blocked: () => !state.file || state.reviewOpen || palette.isOpen || viewMenu.isOpen || dockMenu.isOpen ||
    [ui.settingsPanel, ui.find, ui.noteBox, ui.editBox, ui.reviewMenu].some((box) => !box.hidden),
});
ui.setFocusMode.addEventListener('change', () => setFocusModeEnabled(ui.setFocusMode.checked));

function showFullScreen(on) {
  ui.fullScreen.classList.toggle('on', on);
  ui.fullScreen.setAttribute('aria-pressed', String(on));
}

async function toggleFullScreen(on) {
  try {
    const next = on ?? !(await isFullscreen());
    // Wrap sizes the window to the page; full screen is the opposite instruction.
    if (next && state.wrap) setWrap(false);
    holdResize();
    await setFullscreen(next);
    showFullScreen(next);
  } catch (error) {
    setStatus(`Full screen did not work: ${error?.message || error}`, { error: true });
  }
}

/// Markdown pages fill the screen in presentation: one A4 box, scaled to fit.
const A4_PX = { width: (210 * 96) / 25.4, height: (297 * 96) / 25.4 };

const presentedSheets = () => Array.from(ui.markdown.querySelectorAll(':scope > .md-page'));

function presentedSheet() {
  const stage = ui.markdownStage.getBoundingClientRect();
  const middle = stage.top + stage.height / 2;
  const sheets = presentedSheets();
  let best = 0;
  sheets.forEach((sheet, index) => {
    const box = sheet.getBoundingClientRect();
    const old = sheets[best].getBoundingClientRect();
    if (Math.abs(box.top + box.height / 2 - middle) < Math.abs(old.top + old.height / 2 - middle)) best = index;
  });
  return best;
}

function showSheet(index) {
  const sheet = presentedSheets()[index];
  if (!sheet) return;
  const stage = ui.markdownStage;
  const box = sheet.getBoundingClientRect();
  const top = stage.getBoundingClientRect().top;
  stage.scrollTop += box.top - top - Math.max(0, (stage.clientHeight - box.height) / 2);
}

function fitPresentation() {
  if (presentation?.kind !== 'markdown') return;
  const index = presentedSheet();
  const stage = ui.markdownStage;
  setMarkdownScale(Math.min((stage.clientHeight - 16) / A4_PX.height, (stage.clientWidth - 16) / A4_PX.width));
  paginateMarkdown({ keepPosition: false });
  showSheet(index);
}

async function startPresentation() {
  const kind = state.file?.kind;
  if (presentation) return;
  if (!(kind === 'pdf' && state.document) && kind !== 'markdown') {
    setStatus('Open a PDF or Markdown file to present');
    return;
  }
  if (panes.active) {
    setStatus('Go back to one pane to present');
    return;
  }
  if (palette.isOpen) palette.close();
  viewMenu.close(false);
  dockMenu.close(false);
  toggleSettings(false);
  if (!ui.find.hidden) closeFind();
  hideReviewChrome();
  presentation = {
    kind,
    fullscreen: await isFullscreen().catch(() => false),
    wrap: state.wrap,
    page: pdfViewer.currentPageNumber,
    scale: kind === 'pdf' ? pdfViewer.currentScaleValue : state.markdownScale,
    scrollMode: pdfViewer.scrollMode,
    view: state.pageViews.md,
    raw: state.markdownRaw,
    scrollTop: ui.markdownStage.scrollTop,
  };
  document.body.classList.add('presenting');
  if (state.wrap) setWrap(false);
  if (kind === 'pdf') {
    applyPdfSpread();
    pdfViewer.currentScaleValue = 'page-fit';
    pdfViewer.currentPageNumber = presentation.page;
  } else {
    if (state.markdownRaw) setRaw(false, { persist: false });
    setPageView('single', { persist: false, apply: false });
    paginateMarkdown();
    fitPresentation();
  }
  holdResize();
  await setFullscreen(true).catch(() => {});
}

function stepPresentation(delta) {
  if (presentation.kind === 'pdf') {
    pdfViewer.currentPageNumber = Math.min(Math.max(1, pdfViewer.currentPageNumber + delta), pdfViewer.pagesCount);
  } else {
    showSheet(Math.min(Math.max(0, presentedSheet() + delta), presentedSheets().length - 1));
  }
}

async function stopPresentation() {
  const saved = presentation;
  if (!saved) return;
  presentation = null;
  document.body.classList.remove('presenting');
  const restore = () => {
    if (saved.kind === 'pdf' && state.document) pdfViewer.currentPageNumber = saved.page;
    else if (saved.kind === 'markdown') ui.markdownStage.scrollTop = saved.scrollTop;
  };
  if (saved.kind === 'pdf' && state.document) {
    pdfViewer.scrollMode = saved.scrollMode;
    applyPdfSpread();
    pdfViewer.currentScaleValue = String(saved.scale);
  } else if (saved.kind === 'markdown') {
    setMarkdownScale(saved.scale);
    setPageView(saved.view, { persist: false, apply: false });
    paginateMarkdown({ keepPosition: false });
    if (saved.raw) setRaw(true, { persist: false });
  }
  restore();
  if (!saved.fullscreen) {
    holdResize();
    await setFullscreen(false).catch(() => {});
  }
  if (saved.wrap) {
    setWrap(true);
    scheduleWrap();
  }
  // Leaving full screen reshapes the window a moment later; land on the page again then.
  window.setTimeout(restore, 200);
}

ui.fullScreen.addEventListener('click', () => void toggleFullScreen());
ui.present.addEventListener('click', () => void startPresentation());
window.addEventListener('resize', () => {
  if (presentation) fitPresentation();
  void isFullscreen().then(showFullScreen, () => {});
});

// Ahead of every other key handler: while presenting, the reading keys and a
// clicker (which sends PageUp and PageDown) step pages, and Esc gives the view back.
window.addEventListener('keydown', (event) => {
  if (!presentation || event.ctrlKey || event.metaKey || event.altKey) return;
  const steps = {
    ArrowRight: 1, ArrowDown: 1, PageDown: 1, Enter: 1, n: 1, j: 1, ' ': event.shiftKey ? -1 : 1,
    ArrowLeft: -1, ArrowUp: -1, PageUp: -1, Backspace: -1, p: -1, k: -1, Home: -Infinity, End: Infinity,
  };
  if (event.key === 'Escape' || event.key === 'F5') void stopPresentation();
  else if (event.key in steps) stepPresentation(steps[event.key]);
  else return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

window.addEventListener('keydown', (event) => {
  const typing =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLTextAreaElement ||
    event.target instanceof HTMLSelectElement;
  // A key that moves the reader ends the restored scroll; late figures must not pull it back.
  if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey) state.restoringMarkdownView = null;
  const key = event.key.toLowerCase();

  // Esc closes the composer wherever focus went: its action menu, the page,
  // the review panel. Before anything else, so no other Esc use takes it.
  if (key === 'escape' && !ui.noteBox.hidden) {
    event.preventDefault();
    closeNoteBox();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && key === 'k' && !isTextField(event.target)) {
    event.preventDefault();
    palette.toggle();
    return;
  }
  if ((event.key === 'F11' || event.key === 'F5') && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    void (event.key === 'F11' ? toggleFullScreen() : startPresentation());
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === ',') {
    event.preventDefault();
    toggleSettings();
    return;
  }
  if (key === 'escape' && !ui.settingsPanel.hidden) {
    event.preventDefault();
    toggleSettings(false);
    return;
  }
  if (key === 'escape' && !ui.editBox.hidden) {
    event.preventDefault();
    closeEditBox();
    return;
  }
  if (key === 'escape' && state.reattachReviewId) {
    event.preventDefault();
    cancelReattach();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'o') {
    event.preventDefault();
    ui.open.click();
    return;
  }
  // Panes: Ctrl+Shift+D splits right, Ctrl+Shift+E splits down, Ctrl+Alt+arrows move between them.
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && (key === 'd' || key === 'e')) {
    event.preventDefault();
    void splitPane(key === 'd' ? 'right' : 'bottom');
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.altKey && !event.shiftKey && panes.active) {
    const paneKeys = { arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down' };
    if (paneKeys[key]) {
      event.preventDefault();
      void movePaneFocus(paneKeys[key]);
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
    const dockKeys = {
      arrowleft: 'left',
      arrowright: 'right',
      arrowup: 'top',
      arrowdown: 'bottom',
      enter: 'center',
    };
    if (dockKeys[key]) {
      event.preventDefault();
      void dockTo(dockKeys[key]);
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'f') {
    event.preventDefault();
    void toggleWrap();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'a') {
    if (!typing) {
      event.preventDefault();
      void askSelection();
      return;
    }
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'n') {
    if (!typing) {
      event.preventDefault();
      void openNoteBox();
      return;
    }
  }
  if (
    !typing &&
    event.key === 'Enter' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    ui.noteBox.hidden &&
    state.reviewOpen &&
    reviewFromSelection()
  ) {
    event.preventDefault();
    openNoteBox();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'r') {
    event.preventDefault();
    toggleReviewPanel();
    return;
  }
  // Ctrl+B (bold), Ctrl+I (italic), Ctrl+S (strike), Ctrl+U (underline) and
  // Ctrl+E (edit text) edit a Markdown selection in place. Checked before
  // Ctrl+U's raw-view toggle so selecting text and pressing Ctrl+U underlines.
  // A selection in rendered Markdown always means "format this": when the edit
  // cannot be made, the status line says why, rather than Ctrl+U falling
  // through to the raw view and hiding the text that was just selected.
  const formatKey = key === 'b' || key === 'i' || key === 's' || key === 'u' || key === 'e';
  const selectedPane = formatKey && !typing && (event.ctrlKey || event.metaKey) &&
    !event.shiftKey && !event.altKey && !state.markdownRaw ? renderedMarkdownSelection() : null;
  if (selectedPane) {
    event.preventDefault();
    const formatByKey = { b: 'bold', i: 'italic', s: 'strike', u: 'underline' };
    if (selectedPane === 'split') {
      setStatus('Formatting edits the file in the main pane: open this file there to format it', { error: true });
    } else if (!directEditsEnabled()) {
      setStatus('Editing the Markdown file is off in Settings; add a review instead', { error: true });
    } else if (key === 'e') {
      openEditBox();
    } else {
      void applyDirectFormat(formatByKey[key]);
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'u') {
    event.preventDefault();
    if (state.file?.kind === 'markdown') {
      setRaw(!state.markdownRaw);
    }
    return;
  }
  // WebView2 has Ctrl+P of its own, and it would print the viewer as it stands
  // on screen — window chrome, one visible page. Ours has to win.
  if ((event.ctrlKey || event.metaKey) && key === 'p') {
    event.preventDefault();
    void printDocument();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'w') {
    event.preventDefault();
    void closeTab(state.active);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'tab') {
    event.preventDefault();
    cycleTab(event.shiftKey ? -1 : 1);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key >= '1' && key <= '9') {
    event.preventDefault();
    void activateTab(Number(key) - 1);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'f') {
    event.preventDefault();
    openFind();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && key === 'r') {
    event.preventDefault();
    if (state.file) {
      openFile(state.file, { preserveView: true });
    }
    return;
  }
  if (typing) {
    return;
  }
  // Ctrl+Z (Cmd+Z) undoes the last change made through the app to this file.
  // In a text field it stays the field's own undo, by the return above.
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && key === 'z') {
    event.preventDefault();
    void undoLast().then((done) => {
      if (!done) setStatus('Nothing to undo');
    });
    return;
  }
  // Delete on an active selection deletes the selected text (or marks it for
  // deletion in review mode); with no selection, Delete / Cmd+Backspace moves
  // the shown file to the Trash after confirmation.
  if ((key === 'delete' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) ||
      (state.platform === 'macos' && event.metaKey && key === 'backspace')) {
    event.preventDefault();
    if (markdownEditTarget() || (state.reviewOpen && reviewFromSelection())) {
      void deleteSelectionNow();
    } else {
      void trashShownFile();
    }
    return;
  }
  if (key === 'escape') {
    if (!ui.reviewMenu.hidden || !ui.reviewChip.hidden) {
      hideReviewChrome();
      return;
    }
    if (!ui.find.hidden) {
      closeFind();
      return;
    }
  }
  // Zoom is the one thing that means the same in both modes.
  if (key === '+' || key === '=') {
    event.preventDefault();
    stepZoom(1);
    return;
  }
  if (key === '-') {
    event.preventDefault();
    stepZoom(-1);
    return;
  }
  // Left and Right step through the tabs whenever there are tabs to step
  // through. With a single file open there is nothing to switch to, so they go
  // back to walking the folder — which is what they are for in a folder of
  // figures opened one at a time.
  if (state.tabs.length > 1 && (key === 'arrowright' || key === 'arrowleft')) {
    event.preventDefault();
    cycleTab(key === 'arrowright' ? 1 : -1);
    return;
  }
  // Arrows walk the folder in image mode; in a PDF they scroll the page, which
  // is what a reader expects there.
  if (state.file?.kind === 'image') {
    if (key === 'arrowright' || key === 'pagedown' || key === ' ') {
      event.preventDefault();
      stepSibling(1);
    } else if (key === 'arrowleft' || key === 'pageup') {
      event.preventDefault();
      stepSibling(-1);
    }
    return;
  }
  // The same reading keys work on a markdown column as on a PDF.
  if (state.file?.kind === 'markdown' || state.file?.kind === 'json') {
    switch (key) {
      case 'j':
        ui.markdownStage.scrollBy({ top: 90 });
        break;
      case 'k':
        ui.markdownStage.scrollBy({ top: -90 });
        break;
      case 'g':
        ui.markdownStage.scrollTo({
          top: event.shiftKey ? ui.markdownStage.scrollHeight : 0,
        });
        break;
      default:
        return;
    }
    event.preventDefault();
    return;
  }
  if (state.file?.kind !== 'pdf') {
    return;
  }
  switch (key) {
    case 'j':
      ui.container.scrollBy({ top: 90 });
      break;
    case 'k':
      ui.container.scrollBy({ top: -90 });
      break;
    case 'n':
      ui.next.click();
      break;
    case 'p':
      ui.prev.click();
      break;
    case 'g':
      pdfViewer.currentPageNumber = event.shiftKey ? pdfViewer.pagesCount : 1;
      break;
    default:
      return;
  }
  event.preventDefault();
});

// Files arriving from outside: dropped on the window, double-clicked in the
// Finder, or handed over by a second `pdf-next file.pdf` while this one runs.
// Several at once open as tabs, and the first one is the one you end up
// looking at.
async function openMany(items) {
  const [first, ...rest] = items.map(asOpening).filter(Boolean);
  if (first === undefined) {
    return;
  }
  await openPath(first.path, { target: first.target });
  // The rest become tabs and nothing more: a tab is read from disk when it is
  // switched to, so loading it now would be a parse nobody sees. A target
  // travels with the tab and fires when you get there.
  for (const item of rest) {
    await openPath(item.path, { activate: false, target: item.target });
  }
}

// Whether the window has ever been told a drag was over it. A drop that
// brings no file name is a different fault from a drop that never arrives,
// and the difference is not visible from outside without this.
let sawDrag = false;
listen('tauri://drag-enter', () => {
  sawDrag = true;
});
// A drop that brings no paths is not answered here. The Rust side looks for
// the names where the webview did not, opens them if they are there, and says
// `drop-empty` when they are not. Answering both would race that.
listen('tauri://drag-drop', (event) => {
  const paths = event.payload?.paths || [];
  if (paths.length > 0) void openMany(paths);
});
listen('drop-empty', () => {
  const key = state.platform === 'macos' ? '⌘O' : 'Ctrl+O';
  setStatus(
    sawDrag
      ? `That drop carried no file name. Open it with ${key} instead.`
      : `Nothing was dropped. Open a file with ${key}.`,
    { error: true, sticky: true },
  );
  sawDrag = false;
});
// Registered before startup asks for `pending_files`, so nothing can fall in
// the gap between the two.
const openFilesReady = listen('open-files', (event) =>
  openMany(Array.isArray(event.payload) ? event.payload : []),
);

// The watcher fires at most once a second, and only when something moved.
listen('reviews-changed', async (event) => {
  if (!state.file || event.payload?.path !== state.file.path) {
    return;
  }
  if (document.visibilityState === 'hidden') {
    state.pendingReviews = true;
    return;
  }
  await reloadReviewsFromDisk();
  if (launch?.smoke && state.file?.name === 'dense-page.pdf' && event.payload?.kind === 'missing') {
    await invoke('smoke_report', {
      ok: state.reviews.length === 32,
      detail: `sidecar missing; sidecarMissingReviews=${state.reviews.length}`,
    });
  }
});

listen('file-changed', async (event) => {
  const { path, kind, revision } = event.payload || {};
  if (panes.active && path && path !== state.file?.path && panes.visible().includes(path)) {
    if (kind !== 'missing' && document.visibilityState !== 'hidden') {
      await fillPane(path, revision);
    }
    return;
  }
  if (!state.file || path !== state.file.path) {
    return;
  }
  if (kind === 'missing') {
    document.body.classList.add('file-missing');
    ui.waiting.hidden = false;
    setStatus('Rebuilding — waiting for the file', { sticky: true });
    return;
  }
  document.body.classList.remove('file-missing');
  ui.waiting.hidden = true;
  // Rebuilding with the window minimised is the common case in a compile loop;
  // re-parsing a document nobody is looking at is pure waste. Catch up on the
  // newest revision when the window comes back.
  if (document.visibilityState === 'hidden') {
    state.pendingRevision = revision;
    return;
  }
  const opened = await openFile({ ...state.file, revision }, { preserveView: true });
  if (opened === false || state.file?.path !== path || state.file?.revision !== revision) return;
  setStatus('Reloaded');
  if (launch?.smoke && (state.file?.kind === 'pdf' || state.file?.name === 'review-parity.md')) void reportSmoke();
});

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    saveSession();
    // A hidden window does not need warm font and image caches; they rebuild
    // lazily on return. cleanup() refuses to run mid-render, which is fine —
    // that tick is simply skipped.
    paneViewers.cleanup();
    try {
      await state.document?.cleanup();
    } catch {
      // Rendering in flight; nothing to free this time.
    }
    return;
  }
  if (state.pendingRevision !== null) {
    const revision = state.pendingRevision;
    state.pendingRevision = null;
    state.pendingReviews = false;
    if (state.file) {
      await openFile({ ...state.file, revision }, { preserveView: true });
    }
    return;
  }
  if (state.pendingReviews) {
    state.pendingReviews = false;
    await reloadReviewsFromDisk();
  }
});

// ── Theme ─────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

listen('theme-changed', (event) => applyTheme(event.payload));

// ── Start ─────────────────────────────────────────────────────────────────

// Each step the boot waits on is marked before it is entered, so a launch
// that hangs names the call it hung in. The window is already up by now, and
// a window with nothing in it is the failure being guarded against.
mark('os_theme');
applyTheme(await invoke('os_theme'));
mark('preferences');

try {
  const saved = localStorage.getItem('pdf-next.mode');
  setMode(PAGE_MODES.includes(saved) ? saved : null);
} catch {
  setMode(null);
}

// Raw markdown is a way of reading, not a per-file quirk, so it is a global
// preference like the page mode.
try {
  setRaw(localStorage.getItem('pdf-next.md-raw') === '1', { persist: false });
} catch {
  setRaw(false, { persist: false });
}
for (const select of [ui.mdFont, ui.mdSize, ui.mdWidth]) {
  let saved = null;
  try {
    saved = localStorage.getItem(`pdf-next.md-${select.dataset.md}`);
  } catch {
    // Preference only.
  }
  setMarkdownStyle(select, saved, { persist: false });
}
try {
  applyUiFont(localStorage.getItem('pdf-next.ui-font'), { persist: false });
} catch {
  applyUiFont('system', { persist: false });
}
try {
  applyCodeFont(localStorage.getItem('pdf-next.code-font'), { persist: false });
} catch {
  applyCodeFont('system', { persist: false });
}
applyFigureSettings();

for (const key of ['pdf', 'md']) {
  let saved = null;
  try {
    saved = localStorage.getItem(`pdf-next.page-view.${key}`);
  } catch {
    // Preference only.
  }
  state.pageViews[key] = validPageView(key, saved);
}

// Watching is on by default at one second; the control only exists to slow it
// down or stop it.
try {
  const saved = localStorage.getItem('pdf-next.poll');
  const seconds = ['0', '1', '2', '3'].includes(saved) ? Number(saved) : 1;
  ui.poll.value = String(seconds);
  await invoke('set_poll_seconds', { seconds });
} catch {
  ui.poll.value = '1';
}

try {
  const saved = Number(localStorage.getItem('pdf-next.review-size'));
  setReviewSize(REVIEW_SIZE_STEPS.includes(saved) ? saved : REVIEW_SIZE_DEFAULT, {
    persist: false,
  });
} catch {
  setReviewSize(REVIEW_SIZE_DEFAULT, { persist: false });
}

// Command-line flags style this launch without changing saved preferences.
mark('launch_options');
const launch = await invoke('launch_options').catch(() => ({}));
if (!launch?.smoke) {
  bootIsFine();
}
state.version = String(launch?.version || '');
state.platform = String(launch?.platform || '');
setTitle(state.file?.name || '');
if (typeof launch?.poll === 'number') {
  // The flag wins over the saved preference, which was already sent above.
  // The control only knows a few values; a --poll it cannot show is left
  // reading whatever it did, while the watcher runs at what was asked.
  if (ui.poll.querySelector(`option[value="${launch.poll}"]`)) {
    ui.poll.value = String(launch.poll);
  }
  await invoke('set_poll_seconds', { seconds: launch.poll }).catch(() => {});
}
if (launch?.mode) {
  const requested = launch.mode === 'clear' ? null : launch.mode;
  if (requested === null || PAGE_MODES.includes(requested)) {
    setMode(requested, false);
  }
}

window.addEventListener('beforeunload', () => {
  saveSession();
});

mark('initial_file');
const initial = await invoke('initial_file');
// Files that reached the app before this code was listening — a Finder
// double-click on macOS lands here. Asking also switches the app to live
// `open-files` events, so the listener must be in place first.
mark('pending_files');
await openFilesReady;
const pending = await invoke('pending_files').catch(() => []);
mark('opening');
if (initial) {
  await openInTab(initial, { target: asTarget(launch?.target) });
  // Extra paths on the command line become tabs; the first one stays showing.
  // The launch file may be queued again among the pending ones; openInTab
  // knows it already and leaves it alone.
  for (const item of [...(launch?.rest || []), ...pending]) {
    const opening = asOpening(item);
    if (opening) {
      await openPath(opening.path, { activate: false, target: opening.target });
    }
  }
  if (['left', 'right', 'top', 'bottom'].includes(launch?.dock)) {
    await dockTo(launch.dock);
  }
} else if (pending.length) {
  await openMany(pending);
} else if (!launch?.smoke) {
  await restoreSession();
}
mark('open');
ui.container.focus();

// ── Smoke verdict ─────────────────────────────────────────────────────────

/// Did the launch file actually reach the screen?
///
/// "The window opened" is not the question — 0.9.0 opened a window on macOS
/// and drew nothing in it. A PDF has arrived when PDF.js has painted a page
/// canvas, so that is what this waits for, and pixels are what it reports.
async function renderedPixels() {
  const painted = () =>
    [...ui.viewer.querySelectorAll('canvas')].some(
      (canvas) => canvas.width > 0 && canvas.height > 0,
    );
  if (painted()) {
    return true;
  }
  // A page can still be in flight; PDF.js says so when it finishes one.
  return new Promise((resolve) => {
    const done = (value) => {
      eventBus.off('pagerendered', onRendered);
      window.clearTimeout(timer);
      resolve(value);
    };
    const onRendered = () => done(painted());
    const timer = window.setTimeout(() => done(false), 20_000);
    eventBus.on('pagerendered', onRendered);
  });
}

/// Wait for a condition that a decoding image or a laid-out column reaches a
/// tick or two after the open resolves. Polling, not an event, because the
/// thing being waited for may already be true.
async function settles(test, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (test()) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return test();
}

function sharpPdfViewport(view) {
  const rendered = view?.detailView || view;
  const canvas = rendered?.canvas;
  if (rendered?.renderingState !== 3 || !canvas || canvas.hidden) {
    return false;
  }
  const rect = canvas.getBoundingClientRect();
  const page = view.div.getBoundingClientRect();
  const bounds = ui.container.getBoundingClientRect();
  const visible = {
    left: bounds.left + ui.container.clientLeft,
    top: bounds.top + ui.container.clientTop,
  };
  visible.right = visible.left + ui.container.clientWidth;
  visible.bottom = visible.top + ui.container.clientHeight;
  const density = window.devicePixelRatio || 1;
  const left = Math.max(page.left, visible.left);
  const top = Math.max(page.top, visible.top);
  const right = Math.min(page.right, visible.right);
  const bottom = Math.min(page.bottom, visible.bottom);
  return right > left && bottom > top && rect.width > 0 && rect.height > 0 &&
    rect.left <= left + 2 && rect.top <= top + 2 &&
    rect.right >= right - 2 && rect.bottom >= bottom - 2 &&
    canvas.width >= Math.floor(rect.width * density) - 2 &&
    canvas.height >= Math.floor(rect.height * density) - 2;
}

async function smokePdfScroll() {
  const view = pdfViewer.getPageView(0);
  const start = ui.container.scrollTop + view.div.getBoundingClientRect().top -
    ui.container.getBoundingClientRect().top;
  const metrics = { density: window.devicePixelRatio || 1, scrollMs: [], renderMs: [], hashes: [] };
  const starts = new Map();
  const onRender = ({ source }) => starts.set(source, performance.now());
  const onRendered = ({ source, error }) => {
    if (error) {
      failures.push(`PDF render failed: ${error}`);
    }
    if (starts.has(source)) {
      metrics.renderMs.push(Math.round(performance.now() - starts.get(source)));
      starts.delete(source);
    }
  };
  eventBus.on('pagerender', onRender);
  eventBus.on('pagerendered', onRendered);
  try {
    for (const fraction of [0, 0.3, 0.6, 0.3, 0]) {
      const began = performance.now();
      ui.container.scrollTop = Math.max(0, start + view.viewport.height * fraction);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
      pdfViewer.update();
      if (!await settles(() => sharpPdfViewport(view))) {
        const rendered = view.detailView || view;
        throw new Error(`PDF stayed unsharp after scrolling to ${fraction}: ${JSON.stringify({
          density: metrics.density, state: rendered.renderingState,
          width: rendered.canvas?.width, height: rendered.canvas?.height,
          canvas: rendered.canvas?.getBoundingClientRect(),
          page: view.div.getBoundingClientRect(), visible: ui.container.getBoundingClientRect(),
          completed: metrics,
        })}`);
      }
      metrics.scrollMs.push(Math.round(performance.now() - began));
      const canvas = (view.detailView || view).canvas;
      const rect = canvas.getBoundingClientRect();
      const visible = ui.container.getBoundingClientRect();
      const density = window.devicePixelRatio || 1;
      const x = Math.max(0, Math.floor((Math.max(rect.left, visible.left) - rect.left) * density));
      const y = Math.max(0, Math.floor((Math.max(rect.top, visible.top) - rect.top) * density));
      const pixels = canvas.getContext('2d').getImageData(x, y,
        Math.min(256, canvas.width - x), Math.min(256, canvas.height - y)).data;
      let hash = 2166136261;
      for (const byte of pixels) {
        hash = Math.imul(hash ^ byte, 16777619) >>> 0;
      }
      metrics.hashes.push(hash.toString(16));
    }
    if (metrics.hashes[0] !== metrics.hashes[4] || metrics.hashes[1] !== metrics.hashes[3]) {
      throw new Error('PDF pixels changed after scrolling away and back');
    }
    if (state.file?.name === 'dense-page.pdf' && new Set(metrics.hashes).size < 2) {
      throw new Error('Dense PDF pixels did not change while scrolling');
    }
    return metrics;
  } finally {
    eventBus.off('pagerender', onRender);
    eventBus.off('pagerendered', onRendered);
  }
}

/// Smoke only, on review-parity.md. Stage 1 drives find and review creation in
/// the real page; the build server then edits the file, and stage 2 checks that
/// the review is still painted on the right occurrence after the reload.
/// Returns what to report.
async function smokeMarkdownReview() {
  const second = () => {
    const mark = ui.markdown.querySelector('mark.review');
    const marks = ui.markdown.querySelectorAll('mark.review').length;
    return marks === 1 && mark.textContent === 'Repeat this phrase' &&
      mark.closest('p')?.textContent.includes('there');
  };
  const counted = (text) => settles(() => ui.findCount.textContent === text, 5_000);
  if (!await settles(() => ui.markdown.textContent.includes('Review parity'))) throw new Error('fixture not shown');
  const staged = state.reviews.length ? 2 : 1;
  if (staged === 1) {
    openFind();
    const type = (text) => {
      ui.findInput.value = text;
      ui.findInput.dispatchEvent(new Event('input'));
    };
    const current = () => ui.markdown.querySelectorAll('mark.find.current').length;
    // `wake` is `wa**ke**` in the first paragraph: one hit across two marks.
    type('wake');
    if (!await counted('1 of 2') || current() !== 2) throw new Error(`find across markup: ${ui.findCount.textContent}, ${current()} current marks`);
    ui.findNext.click();
    if (ui.findCount.textContent !== '2 of 2' || current() !== 1) throw new Error(`find next: ${ui.findCount.textContent}`);
    ui.findPrev.click();
    if (ui.findCount.textContent !== '1 of 2' || current() !== 2) throw new Error(`find previous: ${ui.findCount.textContent}`);
    type('wake is long');
    if (!await counted('1 of 1')) throw new Error(`find across two marks and a space: ${ui.findCount.textContent}`);
    type('w');
    if (!await counted('') || ui.markdown.querySelector('mark.find')) throw new Error('one character must not search');
    closeFind();
    if (ui.markdown.querySelector('mark.find')) throw new Error('closing find left marks');
    // A review on the second of two identical phrases, made as a reader makes it.
    const node = document.createTreeWalker([...ui.markdown.querySelectorAll('p')].at(-1), NodeFilter.SHOW_TEXT).nextNode();
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 'Repeat this phrase'.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    openNoteBox('delete');
    await saveNote();
    if (!await settles(second, 5_000)) throw new Error(`review on the second occurrence: ${ui.markdown.querySelectorAll('mark.review').length} marks`);
    const review = state.reviews[0];
    if (!review?.anchor?.prefix || review.anchor.documentRevision !== state.markdownDigest) throw new Error('review saved without context or digest');
    // The reload that follows paints the review into page boxes: small ones,
    // so this short file spans several.
    ui.markdown.style.setProperty('--page-h', '40mm');
    ui.markdown.style.setProperty('--page-pad', '5mm');
    setPageView('two', { persist: false });
    return `find and review checked, stage=1; digest=${state.markdownDigest}`;
  }
  const digest = state.reviews[0].anchor.documentRevision;
  if (!await settles(() => ui.markdown.textContent.includes('Appended after') && second(), 10_000)) {
    throw new Error(`review not painted on the second occurrence after reload: ${ui.markdown.querySelectorAll('mark.review').length} marks`);
  }
  if (digest === state.markdownDigest) throw new Error('the file changed but its digest did not');
  if (ui.reviewList.textContent.includes('earlier version')) throw new Error('a located review was flagged as made on an earlier version');
  openFind();
  ui.findInput.value = 'phrase';
  ui.findInput.dispatchEvent(new Event('input'));
  if (!await counted('1 of 2')) throw new Error(`find after reload: ${ui.findCount.textContent}`);
  if (ui.markdown.querySelectorAll('mark.review').length !== 1) throw new Error('find split the review mark');
  closeFind();
  const boxes = ui.markdown.querySelectorAll(':scope > .md-page').length;
  if (boxes < 2 || !ui.markdown.querySelector('.md-page mark.review')) throw new Error(`review not inside the pages: ${boxes} boxes`);
  setPageView('continuous', { persist: false });
  if (!await settles(() => !ui.markdown.querySelector('.md-page') && second())) throw new Error('review lost when the pages were removed');
  return `review still on the second occurrence after reload, in ${boxes} page boxes and in one column, stage=2`;
}

/// Smoke only. A long Markdown file in A4 boxes: nothing lost or reordered,
/// the same find hits as in one column, and the time one pagination takes.
async function smokeMarkdownPages() {
  if (!await settles(() => ui.markdown.textContent.includes('Page view'))) throw new Error('fixture not shown');
  const boxes = () => ui.markdown.querySelectorAll(':scope > .md-page');
  const whole = ui.markdown.textContent;
  const hits = async () => {
    closeFind();
    openFind();
    ui.findInput.value = 'paragraph';
    ui.findInput.dispatchEvent(new Event('input'));
    if (!await settles(() => /^\d+ of \d+\+?$/.test(ui.findCount.textContent))) throw new Error(`no find count: ${ui.findCount.textContent}`);
    const count = ui.findCount.textContent;
    closeFind();
    return count;
  };
  const continuous = await hits();
  setPageView('single', { persist: false });
  if (!await settles(() => boxes().length >= 2 && state.pagination?.pages === boxes().length)) throw new Error(`single page view: ${boxes().length} boxes`);
  const { ms, pages } = state.pagination;
  const a4 = 210 / 25.4 * 96;
  const first = boxes()[0];
  if (Math.abs(first.offsetWidth - a4) > 2) throw new Error(`page box ${first.offsetWidth} px wide, not A4`);
  const tall = [...boxes()].filter((box) => box.children.length > 1 && box.offsetHeight > 297 / 25.4 * 96 + 2);
  if (tall.length) throw new Error(`${tall.length} pages grew past A4 with more than one block`);
  if (ui.markdown.textContent !== whole) throw new Error('pagination changed the text');
  if (await hits() !== continuous) throw new Error(`find in pages: ${ui.findCount.textContent}, in one column: ${continuous}`);
  setPageView('two', { persist: false });
  if (!await settles(() => ui.markdown.dataset.pages === 'two' && boxes().length === pages)) throw new Error('two page view');
  const inRow = () => [...boxes()].filter((box) => box.offsetTop === boxes()[0].offsetTop).length;
  // A narrow window shows one per row; wrapping the window to the pages widens it.
  await trimWindowToContent({ recenter: true });
  // A screen narrower than two A4 pages (CI runners are) needs zooming out, as a reader would.
  const scale = state.markdownScale;
  // Only #markdown is zoomed; the stage's 32 px padding stays fixed.
  const room = (ui.markdown.parentElement.clientWidth - 32) / (2 * a4 + 24) * 0.98;
  if (!await settles(() => inRow() === 2, 1_000) && room < scale) setMarkdownScale(room);
  if (!await settles(() => inRow() === 2, 3_000)) throw new Error(`two page view: ${inRow()} per row`);
  const row = inRow();
  setMarkdownScale(scale);
  setPageView('continuous', { persist: false });
  if (!await settles(() => boxes().length === 0 && ui.markdown.textContent === whole)) throw new Error('continuous view did not restore the article');
  setPageView('two', { persist: false });
  if (!await settles(() => boxes().length === pages)) throw new Error('two page view after continuous');
  return `${pages} pages, one pagination ${Math.round(ms)} ms, ${row} per row, find ${continuous}`;
}

/// Smoke only. A PDF in two pages: PDF.js even spreads, the cover alone.
async function smokePdfSpread() {
  setPageView('two', { persist: false });
  pdfViewer.currentScaleValue = 'page-fit';
  const spreads = () => ui.viewer.querySelectorAll('.spread');
  if (pdfViewer.spreadMode !== SpreadMode.EVEN) throw new Error(`spread mode ${pdfViewer.spreadMode}`);
  const pagesIn = () => [...spreads()].map((spread) => spread.querySelectorAll('.page').length).join('+');
  if (!await settles(() => pagesIn() === '1+2')) throw new Error(`spreads ${pagesIn()}`);
  const [, pair] = spreads();
  const [left, right] = pair.querySelectorAll('.page');
  if (right.getBoundingClientRect().left < left.getBoundingClientRect().right - 1) throw new Error('pages 2 and 3 are not side by side');
  if (!await settles(() => [...pair.querySelectorAll('canvas')].length === 2 &&
    [...pair.querySelectorAll('canvas')].every((canvas) => canvas.width > 0))) throw new Error('the pair did not render');
  return `spreads ${pagesIn()}, spreadMode=EVEN`;
}

/// The coloured blocks in the real window: spans exist only where a tag asked
/// for them, the text is untouched, and every mode's token colour reaches the
/// screen with AA contrast against the block's own background.
async function smokeMarkdownCode() {
  if (!await settles(() => ui.markdown.querySelector('.hljs-keyword'))) throw new Error('python block not coloured');
  const [tagged, untagged, unknown] = ui.markdown.querySelectorAll('pre > code');
  if (untagged.querySelector('[class^="hljs"]') || unknown.querySelector('[class^="hljs"]')) throw new Error('untagged or unknown block coloured');
  if (!tagged.querySelector(':scope > [data-line]')) throw new Error('coloured block lost its line anchor');
  if (!tagged.textContent.startsWith('def wake(re, n=3):\n    """Strouhal number."""')) throw new Error('coloured text changed');
  const light = (css) => {
    const [r, g, b] = css.match(/\d+/g).slice(0, 3).map((v) => v / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const seen = [];
  for (const mode of [null, 'night', 'sepia', 'invert']) {
    setMode(mode, false);
    const bg = getComputedStyle(tagged.parentElement).backgroundColor;
    const colours = [...new Set([...tagged.querySelectorAll('[class^="hljs-"]')].map((el) => getComputedStyle(el).color))];
    const low = Math.min(...colours.map((c) => {
      const [hi, lo] = [light(c), light(bg)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    }));
    if (colours.length < 4 || low < 4.5) throw new Error(`${mode || 'day'}: ${colours.length} colours, lowest contrast ${low.toFixed(2)}`);
    seen.push(`${mode || 'day'} ${colours.length} colours >= ${low.toFixed(2)}:1`);
  }
  setMode(null, false);
  return `code colour: ${seen.join(', ')}`;
}

/// Report to the build server whether this launch works, then let it end the
/// process. Only ever runs under PDF_NEXT_SMOKE; a reader never gets here.
async function reportSmoke() {
  // Read late, never early. The status bar is where a load that failed
  // cleanly leaves its reason — the caller catches the rejection and writes
  // it there, so it never reaches the failure buffer — and the failure may
  // arrive while this function is still waiting for a page. Without it a
  // blank window reports only that it is blank, which is the part already
  // known.
  const note = () => {
    const said = (ui.status.textContent || '').trim();
    return (
      (said ? ` status: ${said}` : '') +
      (failures.length ? ` after: ${failures.join(' | ')}` : '')
    );
  };
  bootIsFine();
  const reportGeneration = state.generation;
  const reportPath = state.file?.path || null;
  const currentReport = () => reportGeneration === state.generation && reportPath === state.file?.path;
  try {
    const file = state.file;
    if (!file) {
      await invoke('smoke_report', {
        ok: false,
        detail: `no file opened${note()}`,
      });
      return;
    }
    if (file.kind === 'pdf') {
      const pages = state.document?.numPages ?? 0;
      const painted = await renderedPixels();
      if (!currentReport()) return;
      // Cross the canvas cap even on a 1x runner. A painted low-resolution
      // base without a completed detail canvas must not count as sharp.
      let sharp = false;
      const scroll = [];
      if (painted) {
        pdfViewer.currentScaleValue = '6';
        sharp = await settles(() => sharpPdfViewport(pdfViewer.getPageView(0)));
        if (!currentReport()) return;
        if (sharp) {
          scroll.push(await smokePdfScroll());
          if (!currentReport()) return;
          if (file.name === 'dense-page.pdf') {
            const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
            try {
              // Exercise PDF.js density changes even when CI has a 1x screen.
              for (const density of [2, 3]) {
                Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: density });
                window.dispatchEvent(new Event('resize'));
                if (!await settles(() => sharpPdfViewport(pdfViewer.getPageView(0)))) {
                  throw new Error(`PDF stayed unsharp at ${density}x density`);
                }
                scroll.push(await smokePdfScroll());
                if (!currentReport()) return;
              }
            } finally {
              if (descriptor) {
                Object.defineProperty(window, 'devicePixelRatio', descriptor);
              } else {
                delete window.devicePixelRatio;
              }
              window.dispatchEvent(new Event('resize'));
            }
          }
        }
      }
      if (!currentReport()) return;
      const ok = pages > 0 && painted && sharp && failures.length === 0;
      let revisionDetail = '';
      let spreadDetail = '';
      if (ok && file.name === 'three-pages.pdf') {
        spreadDetail = `; ${await smokePdfSpread()}`;
        if (!currentReport()) return;
      }
      if (ok) {
        const digest = await pdfDocumentDigest();
        if (!currentReport()) return;
        const reviews = state.reviews;
        const rows = [...ui.reviewList.querySelectorAll('.review-row')];
        revisionDetail = `; reviewsCount=${reviews.length}`;
        if (file.name === 'dense-page.pdf' && reviews.length > 0) {
          const ids = new Set(reviews.map((review) => review.id));
          const rowIds = new Set(rows.map((row) => row.dataset.reviewId));
          const tints = new Set(rows.map((row) => Number(row.dataset.reviewTint)));
          const serializedIds = new Set(reviews.filter((review) => typeof review.id === 'string').map((review) => review.id));
          const agentExtensions = reviews.filter((review) =>
            review.agentExtension?.token === `review-${review.id}` &&
            review.source?.agentExtension?.token === `source-${review.id}`);
          const expectedDenseReviews = reviews.every((review, index) =>
            review.id === `r${index + 1}` &&
            review.quote === `Scroll render ${index * 8}` &&
            review.color === (index % 16) + 1 &&
            review.source?.file === `chapter-${index + 1}.tex` &&
            review.action === (index % 2 === 0 ? 'delete' : 'improve'));
          if (reviews.length !== 32 || ids.size !== 32 || rowIds.size !== 32 ||
              rows.length !== 32 || tints.size !== 16 || serializedIds.size !== 32 ||
              state.nextId !== 33 || agentExtensions.length !== 32 || !expectedDenseReviews) {
            throw new Error(`Dense review store failed integrity checks: reviews=${reviews.length}, rows=${rows.length}, ids=${ids.size}, tints=${tints.size}, extensions=${agentExtensions.length}`);
          }
          revisionDetail += `; uniqueRowIds=${rowIds.size}; uniqueTints=${tints.size}; serializedIds=${serializedIds.size}; agentExtensions=${agentExtensions.length}; nextId=${state.nextId}`;
        }
        revisionDetail += `; documentSha256=${digest.slice('sha256:'.length)}; sourceRevision=${file.revision}; reviewsRevision=${state.reviewRevision}`;
      }
      await invoke('smoke_report', {
        ok,
        detail: ok
          ? `${file.name} rendered sharply at 600%, ${pages} page${pages === 1 ? '' : 's'}; scroll=${JSON.stringify(scroll)}${revisionDetail}${spreadDetail}`
          : `${file.name} did not render sharply: ${pages} pages, painted=${painted}, sharp=${sharp}${note()}`,
      });
      return;
    }
    if (file.kind === 'markdown' && file.name === 'review-parity.md' && failures.length === 0) {
      const detail = await smokeMarkdownReview();
      await invoke('smoke_report', { ok: true, detail: `${file.name} ${detail}; sourceRevision=${file.revision}` });
      return;
    }
    if (file.kind === 'markdown' && file.name === 'code.md' && failures.length === 0) {
      await invoke('smoke_report', { ok: true, detail: `${file.name} ${await smokeMarkdownCode()}` });
      return;
    }
    if (file.kind === 'markdown' && file.name === 'pages.md' && failures.length === 0) {
      await invoke('smoke_report', { ok: true, detail: `${file.name} ${await smokeMarkdownPages()}` });
      return;
    }
    // Images and markdown have their own containers; a non-empty one is the
    // same evidence a painted canvas is for a PDF. An <img> decodes after the
    // open resolves, so this waits rather than asking once and calling a
    // picture that had not arrived yet a failure.
    const shown = await settles(() =>
      file.kind === 'image'
        ? ui.image.naturalWidth > 0
        : file.kind === 'json'
          ? (ui.markdownRaw?.textContent || '').trim().length > 0
          : (ui.markdown?.textContent || '').trim().length > 0,
    ) && (file.name !== 'images.md' || await settles(() => {
      const images = [...ui.markdown.querySelectorAll('img')];
      return images.length > 0 && images.every((image) => image.naturalWidth > 0);
    }));
    // A new picture opens whole: the window wraps it, and no part of it
    // needs a scroll. The resize lands after the open, so wait for it.
    const whole = file.kind !== 'image' || await settles(() =>
      ui.imageBox.offsetWidth <= ui.imageStage.clientWidth + 1 &&
      ui.imageBox.offsetHeight <= ui.imageStage.clientHeight + 1, 5_000);
    const scaleNote = file.kind === 'image' ? `, scale ${imageScale().toFixed(3)}` : '';
    // trash-me.png sits beside trash-next.png. Delete moves it to the trash
    // and shows trash-next.png, which fills the window at 'page-fit'.
    if (file.name === 'trash-me.png' && shown && whole && failures.length === 0) {
      window.confirm = () => true;
      await trashShownFile();
      const stepped = await settles(() =>
        state.file?.name === 'trash-next.png' && ui.image.naturalWidth > 0, 10_000);
      const [padX, padY] = stagePadding();
      const fills = stepped && state.imageScale === 'page-fit' && await settles(() =>
        Math.abs(ui.imageBox.offsetWidth - (ui.imageStage.clientWidth - padX)) <= 1 ||
        Math.abs(ui.imageBox.offsetHeight - (ui.imageStage.clientHeight - padY)) <= 1, 5_000);
      await invoke('smoke_report', {
        ok: stepped && fills,
        detail: `Delete on trash-me.png; then ${state.file?.name || 'nothing'} shown at ${
          state.imageScale} scale ${imageScale().toFixed(3)}, box ${ui.imageBox.offsetWidth}x${
          ui.imageBox.offsetHeight}, stage ${ui.imageStage.clientWidth}x${ui.imageStage.clientHeight}${
          fills ? ', fills the window' : ', does not fill the window'}${note()}`,
      });
      return;
    }
    await invoke('smoke_report', {
      ok: shown && whole && failures.length === 0,
      detail: shown && whole && failures.length === 0
        ? `${file.name} rendered (${file.kind})${scaleNote}`
        : `${file.name} did not render${shown && !whole ? ' whole' : ''} (${file.kind})${scaleNote}${
          shown && !whole
            ? `; box ${ui.imageBox.offsetWidth}x${ui.imageBox.offsetHeight}, stage ${ui.imageStage.clientWidth}x${ui.imageStage.clientHeight}, inner ${window.innerWidth}x${window.innerHeight}, outer ${window.outerWidth}x${window.outerHeight}, screen ${window.screen.availWidth}x${window.screen.availHeight}`
            : ''}${note()}`,
    });
  } catch (error) {
    if (!currentReport()) return;
    await invoke('smoke_report', {
      ok: false,
      detail: `smoke check threw: ${error?.message || error}${note()}`,
    }).catch(() => {});
  }
}

if (launch?.smoke) {
  void reportSmoke();
}

// The launch check, after the document is up so the first paint never waits on
// the network. Quiet: an offline machine or a current build hears nothing.
window.setTimeout(() => {
  void checkForUpdates({ quiet: true });
}, 3000);
