/// The quiet toolbar: its two small menus, focus mode (the bar fades while you
/// read) and the window's full screen.

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled])';
const ARROWS = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] };

const centre = (node) => {
  const r = node.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};

/// The control an arrow lands on: the nearest one that way, rows before
/// columns, so a list steps by rows and the dock grid moves like the grid.
/// Up and Down wrap round at the ends.
function neighbour(list, at, [dx, dy]) {
  if (at < 0) return list[0];
  const [x, y] = centre(list[at]);
  let best = null;
  let score = Infinity;
  for (const node of list) {
    const [nx, ny] = centre(node);
    const along = (nx - x) * dx + (ny - y) * dy;
    if (node === list[at] || along <= 1) continue;
    const next = along * 4 + Math.abs((nx - x) * dy) + Math.abs((ny - y) * dx);
    if (next < score) [best, score] = [node, next];
  }
  return best ?? (dy ? list[(at + dy + list.length) % list.length] : null);
}

/// A toolbar button that opens a small panel of controls under it. Esc, Tab
/// out or a click elsewhere closes it, and focus goes back to the button. The
/// arrows move between the controls, except Left and Right on a menu, which
/// step its value. A control marked data-close closes the panel once it runs.
export function wirePopover(button, panel, { onOpen = () => {} } = {}) {
  const items = () => Array.from(panel.querySelectorAll(FOCUSABLE)).filter((node) => node.getClientRects().length);
  const place = () => {
    const at = button.getBoundingClientRect();
    const width = panel.offsetWidth;
    panel.style.top = `${Math.round(at.bottom + 4)}px`;
    panel.style.left = `${Math.round(Math.max(8, Math.min(at.right - width, window.innerWidth - width - 8)))}px`;
  };
  const open = (focus = false) => {
    onOpen();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    if (focus) items()[0]?.focus();
  };
  const close = (refocus = true) => {
    if (panel.hidden) return;
    const inside = panel.contains(document.activeElement);
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (refocus && inside) button.focus();
  };
  // A click from the keyboard (Enter, Space) has no pointer detail: it takes focus in.
  button.addEventListener('click', (event) => (panel.hidden ? open(event.detail === 0) : close()));
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && panel.hidden) {
      event.preventDefault();
      open(true);
    } else if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  panel.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-close]')) close();
  });
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const list = items();
    const at = list.indexOf(document.activeElement);
    let next;
    if (event.key === 'Home' || event.key === 'End') {
      next = event.key === 'Home' ? list[0] : list.at(-1);
    } else if (ARROWS[event.key]) {
      if (event.target instanceof HTMLSelectElement && !ARROWS[event.key][1]) return;
      next = neighbour(list, at, ARROWS[event.key]);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    next?.focus();
  });
  panel.addEventListener('focusout', (event) => {
    const to = event.relatedTarget;
    if (to && !panel.contains(to) && to !== button) close(false);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close(false);
  }, true);
  window.addEventListener('resize', () => close(false));
  return {
    open,
    close,
    get isOpen() {
      return !panel.hidden;
    },
  };
}

/// Focus mode: once you scroll or move into the page, the toolbar fades after
/// `delay` ms without the pointer near the top. The pointer within `near` px
/// of the top, Alt, or keyboard focus in the bar brings it back; `blocked()` (a panel,
/// menu or dialog open, no file) keeps it. Only opacity changes, so nothing
/// below moves, and the controls stay in the tab order.
export function createFocusMode({ bar, enabled, blocked, near = 48, delay = 2000 }) {
  let timer = 0;
  let pointerNear = false;
  const hidden = () => document.body.classList.contains('bar-hidden');
  const focused = () => Boolean(bar.querySelector(':focus-visible'));
  const canHide = () => enabled() && !pointerNear && !focused() && !blocked();
  const show = () => {
    window.clearTimeout(timer);
    timer = 0;
    // Only when set: even a no-op remove rewrites the attribute, which the observer below hears.
    if (hidden()) document.body.classList.remove('bar-hidden');
  };
  const later = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = 0;
      if (canHide()) document.body.classList.add('bar-hidden');
    }, delay);
  };
  const reading = () => {
    if (!hidden() && !timer && canHide()) later();
  };
  const check = () => {
    if (!canHide()) show();
  };
  window.addEventListener('pointermove', (event) => {
    const was = pointerNear;
    pointerNear = event.clientY <= Math.max(near, bar.getBoundingClientRect().bottom);
    if (pointerNear) show();
    else if (was) later();
    else reading();
  }, { passive: true });
  document.addEventListener('scroll', reading, { capture: true, passive: true });
  window.addEventListener('wheel', reading, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Alt') return reading();
    show();
    later();
  });
  bar.addEventListener('focusin', () => focused() && show());
  bar.addEventListener('focusout', () => later());
  // A panel, menu or dialog opening, or the file closing, brings the bar back.
  new MutationObserver(check).observe(document.body, { attributes: true, subtree: true, attributeFilter: ['hidden'] });
  new MutationObserver(check).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return { show, reading, check, get hidden() { return hidden(); } };
}

/// The window's full screen, through the Tauri window API when it is there
/// (it needs core:window:allow-set-fullscreen and allow-is-fullscreen), and the
/// page's own Fullscreen API otherwise.
const appWindow = () => window.__TAURI__?.window?.getCurrentWindow?.() ?? null;

export async function isFullscreen() {
  const win = appWindow();
  return win ? Boolean(await win.isFullscreen()) : Boolean(document.fullscreenElement);
}

export async function setFullscreen(on) {
  const win = appWindow();
  if (win) {
    await win.setFullscreen(on);
  } else if (on && !document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.();
  } else if (!on && document.fullscreenElement) {
    await document.exitFullscreen();
  }
}
