/// Night and Sepia page colours, drawn the same way in every webview.
///
/// PDF.js draws plain pages and each canvas is recoloured once it is drawn,
/// with blend modes every webview draws (WebKit ignores a canvas filter, and
/// PDF.js's own page colours map luminance, which turns plots grey). A
/// `color` blend keeps the hue and saturation of what is drawn and takes only
/// the lightness under it: underneath goes the page with its lightness mapped
/// (white to the background's, black to the foreground's), on top a copy of
/// the original carrying, for neutral pixels, the tint that paper and ink
/// should have. Paper comes out as the background, black ink as the
/// foreground, and a blue line stays blue, only lighter or darker.

const LUMA = [0.3, 0.59, 0.11];
const rgb = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
const css = (color) => `rgb(${color.map((value) => Math.round(Math.min(255, Math.max(0, value)))).join(' ')})`;
const luma = (color) => color.reduce((sum, value, i) => sum + value * LUMA[i], 0);

/// One copy of the page being recoloured, reused, and let go once pages stop
/// arriving so a large page does not keep its pixels twice.
let scratch = null;
let freeTimer = 0;

function original(canvas) {
  scratch ??= document.createElement('canvas');
  if (scratch.width !== canvas.width) scratch.width = canvas.width;
  if (scratch.height !== canvas.height) scratch.height = canvas.height;
  const context = scratch.getContext('2d');
  context.globalCompositeOperation = 'copy';
  context.drawImage(canvas, 0, 0);
  window.clearTimeout(freeTimer);
  freeTimer = window.setTimeout(() => {
    scratch.width = 0;
    scratch.height = 0;
  }, 2000);
  return context;
}

/// Map a drawn canvas so white goes to `background`, black to `foreground`
/// and colours keep their hue.
export function recolorCanvas(canvas, { foreground, background }) {
  const context = canvas?.getContext('2d');
  if (!context || !canvas.width || !canvas.height) return;
  const fg = rgb(foreground);
  const bg = rgb(background);
  const { width, height } = canvas;
  const fill = (target, operation, color) => {
    target.globalCompositeOperation = operation;
    target.fillStyle = css(color);
    target.fillRect(0, 0, width, height);
  };
  // The tint of a neutral pixel of value c is a + b c: what the per-channel
  // map fg + (bg - fg) c has beyond its luma. The copy is the original scaled
  // into [lift, 255] so that tint fits, then the tint.
  const span = bg.map((value, i) => value - fg[i]);
  const a = fg.map((value) => value - luma(fg));
  const b = span.map((value) => value - luma(span));
  const lift = Math.max(0, ...a.map((value) => -value));
  const scale = 255 - lift - Math.max(0, ...a.map((value, i) => value + b[i]));
  const copy = original(canvas);
  fill(copy, 'multiply', b.map((value) => scale + value));
  fill(copy, 'lighter', a.map((value) => value + lift));
  // Underneath, lightness only: white to the background's, black to the foreground's.
  const dark = luma(bg) < luma(fg);
  const low = dark ? luma(bg) : luma(fg);
  const range = Math.abs(luma(bg) - luma(fg));
  const alpha = 1 - range / 255;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (dark) fill(context, 'difference', [255, 255, 255]);
  if (alpha > 0.004) {
    context.globalAlpha = alpha;
    fill(context, 'source-over', [low / alpha, low / alpha, low / alpha]);
    context.globalAlpha = 1;
  }
  context.globalCompositeOperation = 'color';
  context.drawImage(copy.canvas, 0, 0);
  context.restore();
  canvas.dataset.recolored = 'true';
}

/// For a `pagerendered` event: recolour the canvas that view just drew.
export function recolorRendered(event, colors) {
  if (!colors || event?.error) return;
  recolorCanvas(event?.source?.canvas, colors);
}
