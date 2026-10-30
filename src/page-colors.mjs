/// Night and Sepia page colours.
///
/// PDF.js draws page colours through a canvas filter. WebKit (the macOS and
/// Linux webviews) accepts the filter and draws nothing different, so pages
/// stayed white there. Where that happens, PDF.js draws plain pages and each
/// canvas is recoloured once it is drawn, with blend modes every webview
/// draws: ink goes to the foreground colour, paper to the background.

export const canvasFilters = (() => {
  try {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    context.filter = 'invert(1)';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1, 1);
    return context.getImageData(0, 0, 1, 1).data[0] < 128;
  } catch {
    return false;
  }
})();

const rgb = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/// Map each channel c of a drawn canvas to fg + (bg - fg) * c.
export function recolorCanvas(canvas, { foreground, background }) {
  const context = canvas?.getContext('2d');
  if (!context || !canvas.width || !canvas.height) return;
  const fg = rgb(foreground);
  const bg = rgb(background);
  const fill = (operation, color) => {
    context.globalCompositeOperation = operation;
    context.fillStyle = `rgb(${color.join(' ')})`;
    context.fillRect(0, 0, canvas.width, canvas.height);
  };
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  if (bg[0] + bg[1] + bg[2] < fg[0] + fg[1] + fg[2]) {
    // Dark paper: invert, scale to the range, lift to the paper colour.
    fill('difference', [255, 255, 255]);
    fill('multiply', fg.map((value, i) => value - bg[i]));
    fill('lighter', bg);
  } else {
    fill('multiply', bg.map((value, i) => value - fg[i]));
    fill('lighter', fg);
  }
  context.restore();
}

/// For a `pagerendered` event: recolour the canvas that view just drew.
export function recolorRendered(event, colors) {
  if (canvasFilters || !colors || event?.error) return;
  recolorCanvas(event?.source?.canvas, colors);
}
