/// Night and Sepia page colours, drawn the same way in every webview.
///
/// PDF.js draws plain pages and each canvas is recoloured once it is drawn,
/// with blend modes every webview draws (WebKit ignores a canvas filter, and
/// PDF.js's own page colours map luminance, which turns plots grey). Each
/// channel is mapped so paper goes to the background and ink to the
/// foreground; the original is then drawn over that in `color` mode, so a
/// colour keeps its hue and saturation and only its lightness moves. `color`
/// also greys what was neutral, so a last step puts back the tint the
/// foreground and background had: for a neutral pixel that error is linear
/// in its value, and two fills and one draw undo it.

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
  const copy = original(canvas);
  const fill = (target, operation, color) => {
    if (color.every((value) => Math.round(value) <= 0) && operation !== 'multiply') return;
    target.globalCompositeOperation = operation;
    target.fillStyle = css(color);
    target.fillRect(0, 0, width, height);
  };
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  // Each channel c to fg + (bg - fg) c.
  if (bg[0] + bg[1] + bg[2] < fg[0] + fg[1] + fg[2]) {
    fill(context, 'difference', [255, 255, 255]);
    fill(context, 'multiply', fg.map((value, i) => value - bg[i]));
    fill(context, 'lighter', bg);
  } else {
    fill(context, 'multiply', bg.map((value, i) => value - fg[i]));
    fill(context, 'lighter', fg);
  }
  // Hue and saturation from the original, lightness from the map.
  context.globalCompositeOperation = 'color';
  context.drawImage(copy.canvas, 0, 0);
  // A neutral pixel c came out as the grey of its mapped luma; the tint it
  // lost is a + b c per channel. b c is drawn as |b| c, or |b| (1 - c) with
  // b folded into the constant, so every term is a sum of non-negatives.
  const span = bg.map((value, i) => value - fg[i]);
  const a = fg.map((value) => value - luma(fg));
  const b = span.map((value) => value - luma(span));
  if (b.some((value) => Math.abs(value) >= 0.5)) {
    fill(copy, 'difference', b.map((value) => (value < 0 ? 255 : 0)));
    fill(copy, 'multiply', b.map(Math.abs));
    context.globalCompositeOperation = 'lighter';
    context.drawImage(copy.canvas, 0, 0);
  }
  const rest = a.map((value, i) => value + Math.min(0, b[i]));
  fill(context, 'lighter', rest.map((value) => Math.max(0, value)));
  fill(context, 'difference', rest.map((value) => Math.max(0, -value)));
  context.restore();
  canvas.dataset.recolored = 'true';
}

/// For a `pagerendered` event: recolour the canvas that view just drew.
export function recolorRendered(event, colors) {
  if (!colors || event?.error) return;
  recolorCanvas(event?.source?.canvas, colors);
}
