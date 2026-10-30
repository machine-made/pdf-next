// Ctrl+wheel, ⌘+wheel and trackpad pinch. A pinch reaches a webview as wheel
// events with ctrlKey set, and WebKit also sends gesturestart/change/end; both
// end up here as one stream of scale factors. `start` decides what the gesture
// zooms and returns a session ({ update(factor), commit() }), or null; the
// session is committed once the stream has been quiet for `settle` ms.

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 6;
/// How close, relative, a scale must come to a fit to land on it.
export const SNAP = 0.03;

/// The factor one wheel event asks for. A mouse notch is one 25% step; the
/// small deltas of a pinch follow the fingers.
export function wheelFactor({ deltaY = 0, deltaMode = 0 }) {
  const delta = deltaY * (deltaMode === 1 ? 33 : deltaMode === 2 ? 400 : 1);
  if (Math.abs(delta) >= 50) return delta < 0 ? 1.25 : 0.8;
  return Math.exp(-delta / 100);
}

/// Inside the zoom range, widened to take in `from` when the gesture started
/// outside it (a huge picture fitted at 10%), so the first event cannot jump.
export function clampScale(scale, from = 1) {
  return Math.min(Math.max(ZOOM_MAX, from), Math.max(Math.min(ZOOM_MIN, from), scale));
}

/// A gentle detent: within SNAP of a fit, the fit. `fits` maps a preset name
/// to the scale it stands for; the nearest one in reach wins.
export function snapScale(scale, fits = {}) {
  let best = { scale, preset: null };
  let distance = SNAP;
  for (const [preset, fit] of Object.entries(fits)) {
    const off = fit > 0 ? Math.abs(scale / fit - 1) : Infinity;
    if (off < distance) {
      distance = off;
      best = { scale: fit, preset };
    }
  }
  return best;
}

export function pinchZoom(target, { start, settle = 150 }) {
  let session = null;
  let timer = 0;
  let gesture = 0;
  const commit = () => {
    window.clearTimeout(timer);
    timer = 0;
    const done = session;
    session = null;
    done?.commit();
  };
  const step = (event, factor) => {
    if (!session) session = start(event);
    if (!session || !Number.isFinite(factor) || factor <= 0) return;
    session.update(factor);
    window.clearTimeout(timer);
    timer = window.setTimeout(commit, settle);
  };
  target.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    if (!gesture) step(event, wheelFactor(event));
  }, { passive: false });
  target.addEventListener('gesturestart', (event) => {
    event.preventDefault();
    gesture = 1;
  });
  target.addEventListener('gesturechange', (event) => {
    event.preventDefault();
    const scale = event.scale || 1;
    step(event, scale / (gesture || 1));
    gesture = scale;
  });
  target.addEventListener('gestureend', (event) => {
    event.preventDefault();
    gesture = 0;
  });
  return { commit, get active() { return Boolean(session); } };
}
