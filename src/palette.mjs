// The command palette: one searchable list of every action, setting and open
// tab. The app registers commands; this module owns the list, the matching and
// the dialog, which is built hidden in idle time so the first open is quick.

const RECENT_KEY = 'pdf-next.palette-recent';
const RECENT_MAX = 8;
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const GAP = 0.5;
const CONSECUTIVE = 4;
const BATCH = 40;

const wordChar = (c) => /[\p{L}\p{N}]/u.test(c);

/// Subsequence match of `query` (spaces ignored) in `text`, best placement by
/// dynamic programming: a word start earns more than a letter inside a word,
/// a run of letters more than scattered ones. Null when it does not match.
export function fuzzyScore(query, text) {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  const n = q.length;
  const m = t.length;
  let seen = 0;
  for (let j = 0; j < m && seen < n; j += 1) if (t[j] === q[seen]) seen += 1;
  if (seen < n) return null;
  const bonus = new Float64Array(m);
  for (let j = 0; j < m; j += 1) {
    const prev = j ? text[j - 1] : '';
    const here = text[j];
    if (j === 0) bonus[j] = 10;
    else if (!wordChar(prev) && wordChar(here)) bonus[j] = 8;
    else if (prev !== prev.toUpperCase() && here !== here.toLowerCase()) bonus[j] = 6;
  }
  const score = Array.from({ length: n }, () => new Float64Array(m).fill(-Infinity));
  const from = Array.from({ length: n }, () => new Int32Array(m).fill(-1));
  for (let j = 0; j < m; j += 1) {
    if (t[j] === q[0]) score[0][j] = 1 + bonus[j] - 0.1 * j;
  }
  for (let i = 1; i < n; i += 1) {
    const last = score[i - 1];
    let best = -Infinity;
    let bestAt = -1;
    for (let j = 1; j < m; j += 1) {
      best -= GAP;
      if (j >= 2 && last[j - 2] - GAP > best) {
        best = last[j - 2] - GAP;
        bestAt = j - 2;
      }
      if (t[j] !== q[i]) continue;
      const run = last[j - 1] + CONSECUTIVE;
      if (run === -Infinity && best === -Infinity) continue;
      score[i][j] = 1 + bonus[j] + Math.max(run, best);
      from[i][j] = run >= best ? j - 1 : bestAt;
    }
  }
  let end = -1;
  for (let j = 0; j < m; j += 1) {
    if (score[n - 1][j] > (end < 0 ? -Infinity : score[n - 1][end])) end = j;
  }
  if (end < 0) return null;
  const positions = new Array(n);
  for (let i = n - 1, j = end; i >= 0; i -= 1) {
    positions[i] = j;
    j = from[i][j];
  }
  return { score: score[n - 1][end], positions };
}

/// Every word of the query must match, each on its own, in the label or in
/// the group. Positions are the matched letters of the label, to mark them.
export function matchCommand(query, command) {
  let score = 0;
  const positions = new Set();
  for (const word of query.trim().split(/\s+/)) {
    const own = fuzzyScore(word, command.label);
    const group = command.group ? fuzzyScore(word, command.group) : null;
    if (!own && !group) return null;
    if (own && (!group || own.score >= group.score - 2)) {
      score += own.score;
      for (const p of own.positions) positions.add(p);
    } else {
      score += group.score - 2;
    }
  }
  return { score, positions: [...positions].sort((a, b) => a - b) };
}

/// The list as shown: recent commands first for an empty query, otherwise the
/// best matches first, a recent one ahead of an equal stranger.
export function rankCommands(query, commands, recent = []) {
  const rank = new Map(recent.map((id, index) => [id, index]));
  if (!query.trim()) {
    return commands
      .map((command, index) => ({ command, index, recent: rank.get(command.id) ?? Infinity }))
      .sort((a, b) => a.recent - b.recent || a.index - b.index)
      .map(({ command, recent: at }) => ({ command, positions: [], recent: at !== Infinity }));
  }
  const found = [];
  commands.forEach((command, index) => {
    const match = matchCommand(query, command);
    if (!match) return;
    const lift = rank.has(command.id) ? 3 - rank.get(command.id) * 0.25 : 0;
    found.push({ command, positions: match.positions, score: match.score + lift, index });
  });
  return found.sort((a, b) => b.score - a.score || a.index - b.index);
}

/// Where Ctrl+K is a keystroke, not a command: a field that takes text.
export function isTextField(target) {
  if (!target || typeof target.tagName !== 'string') return false;
  if (target.tagName === 'TEXTAREA') return true;
  if (target.tagName === 'INPUT') {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(target.type);
  }
  return Boolean(target.isContentEditable);
}

/// A menu as palette choices, "Label: Option", made when the palette opens so
/// the current value is marked. Choosing one sets the menu and fires its
/// change event, so it goes through the same code as picking it by hand.
export function selectChoices(select, { id, label, group, icon, when = () => true }) {
  return () => {
    if (!select || !when()) return [];
    return Array.from(select.options)
      .filter((option) => !option.hidden && !option.disabled && option.value !== 'custom')
      .map((option) => ({
        id: `${id}:${option.value}`,
        label: `${label}: ${option.textContent.trim()}`,
        group,
        icon,
        current: select.value === option.value,
        run: () => {
          select.value = option.value;
          select.dispatchEvent(new Event('change'));
        },
      }));
  };
}

/// "Ctrl+Shift+D" as keys; on macOS as the symbols printed on the keys.
export function shortcutKeys(text, platform) {
  const mac = { Ctrl: '⌘', Shift: '⇧', Alt: '⌥', Enter: '↩', Backspace: '⌫' };
  return text.split('+').map((key) => (platform === 'macos' ? mac[key] ?? key : key));
}

export function createPalette({ platform = () => '', onOpen = () => {}, onError = () => {} } = {}) {
  const entries = [];
  let root = null;
  let input = null;
  let list = null;
  let empty = null;
  let candidates = [];
  let shown = [];
  let active = -1;
  let previous = null;
  let savedRange = null;
  let opened = false;

  const readRecent = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
    } catch {
      return [];
    }
  };
  const remember = (id) => {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((other) => other !== id)].slice(0, RECENT_MAX)));
    } catch {
      // Preference only.
    }
  };

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'palette';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Command palette');
    const box = document.createElement('div');
    box.className = 'palette-box';
    const search = document.createElement('div');
    search.className = 'palette-search';
    input = document.createElement('input');
    input.id = 'paletteInput';
    input.type = 'text';
    input.placeholder = 'Type a command, setting or file name';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'paletteList');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-label', 'Search commands');
    search.append(iconOf('#i-find'), input);
    list = document.createElement('div');
    list.id = 'paletteList';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Commands');
    empty = document.createElement('div');
    empty.className = 'palette-empty dim';
    empty.textContent = 'No matching command';
    const foot = document.createElement('div');
    foot.className = 'palette-foot dim';
    for (const [keys, what] of [[['↑', '↓'], 'move'], [['↩'], 'run'], [['Esc'], 'close']]) {
      const hint = document.createElement('span');
      for (const key of keys) hint.append(kbd(key));
      hint.append(` ${what}`);
      foot.append(hint);
    }
    box.append(search, list, foot);
    root.append(box);
    document.body.append(root);

    input.addEventListener('input', render);
    root.addEventListener('keydown', onKey);
    root.addEventListener('pointerdown', (event) => {
      if (!box.contains(event.target)) {
        event.preventDefault();
        close();
      } else if (event.target !== input) {
        event.preventDefault();
      }
    });
    list.addEventListener('scroll', () => {
      if (list.children.length < shown.length && list.scrollTop + list.clientHeight * 2 > list.scrollHeight) {
        grow(list.children.length + BATCH);
      }
    }, { passive: true });
    list.addEventListener('pointermove', (event) => {
      const item = event.target.closest?.('.palette-item');
      if (item && Number(item.dataset.index) !== active) setActive(Number(item.dataset.index), false);
    });
    list.addEventListener('click', (event) => {
      const item = event.target.closest?.('.palette-item');
      if (item) void runAt(Number(item.dataset.index));
    });
    document.addEventListener('focusin', (event) => {
      if (opened && !root.contains(event.target)) input.focus({ preventScroll: true });
    });
  }

  function onKey(event) {
    event.stopPropagation();
    const key = event.key;
    const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[key] ??
      (key === 'Tab' ? (event.shiftKey ? -1 : 1) : 0);
    if (step) {
      event.preventDefault();
      if (!shown.length) return;
      const wrap = Math.abs(step) === 1;
      const next = active + step;
      setActive(wrap ? (next + shown.length) % shown.length : Math.max(0, Math.min(shown.length - 1, next)));
    } else if (key === 'Enter') {
      event.preventDefault();
      if (active >= 0) void runAt(active);
    } else if (key === 'Escape' || ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'k')) {
      event.preventDefault();
      close();
    }
  }

  function collect() {
    const out = [];
    for (const entry of entries) {
      try {
        if (typeof entry === 'function') {
          for (const made of entry()) out.push(made);
        } else if (!entry.when || entry.when()) {
          out.push(entry);
        }
      } catch {
        // A command that cannot say whether it applies is not offered.
      }
    }
    return out.map((command) => ({ ...command, id: command.id || `${command.group || ''}:${command.label}` }));
  }

  function render() {
    shown = rankCommands(input.value, candidates, readRecent());
    list.replaceChildren();
    if (!shown.length) list.append(empty);
    else grow(BATCH);
    list.scrollTop = 0;
    active = -1;
    setActive(shown.length ? 0 : -1, false);
  }

  /// Rows are made as they come into reach, so a long list opens as fast as a
  /// short one.
  function grow(count) {
    const fragment = document.createDocumentFragment();
    for (let index = list.children.length; index < Math.min(count, shown.length); index += 1) {
      const item = row(shown[index], index);
      if (shown[index].recent && !shown[index + 1]?.recent) item.classList.add('palette-recent-last');
      fragment.append(item);
    }
    list.append(fragment);
  }

  function row({ command, positions }, index) {
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.id = `palette-item-${index}`;
    item.dataset.index = String(index);
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.append(command.icon ? iconOf(command.icon) : spacer());
    const label = document.createElement('span');
    label.className = 'palette-label';
    let at = 0;
    for (const p of positions) {
      if (p > at) label.append(command.label.slice(at, p));
      const mark = document.createElement('mark');
      mark.textContent = command.label[p];
      label.append(mark);
      at = p + 1;
    }
    label.append(command.label.slice(at));
    item.append(label);
    if (command.current) {
      const current = document.createElement('span');
      current.className = 'palette-current';
      current.textContent = 'current';
      item.append(current);
    }
    if (command.detail) {
      const detail = document.createElement('span');
      detail.className = 'palette-detail dim';
      detail.textContent = `\u200e${command.detail}\u200e`;
      item.append(detail);
    }
    const tail = document.createElement('span');
    tail.className = 'palette-tail';
    if (command.group) {
      const group = document.createElement('span');
      group.className = 'palette-group dim';
      group.textContent = command.group;
      tail.append(group);
    }
    if (command.shortcut) {
      const keys = document.createElement('span');
      keys.className = 'palette-keys';
      for (const key of shortcutKeys(command.shortcut, platform())) keys.append(kbd(key));
      tail.append(keys);
    }
    item.append(tail);
    return item;
  }

  function setActive(index, scroll = true) {
    list.children[active]?.setAttribute('aria-selected', 'false');
    if (index >= list.children.length) grow(index + BATCH);
    active = index;
    const item = index >= 0 ? list.children[index] : null;
    if (!item) {
      input.removeAttribute('aria-activedescendant');
      return;
    }
    item.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', item.id);
    if (scroll) item.scrollIntoView({ block: 'nearest' });
  }

  async function runAt(index) {
    const command = shown[index]?.command;
    if (!command) return;
    remember(command.id);
    close();
    try {
      await command.run();
    } catch (error) {
      onError(error);
    }
  }

  function open() {
    if (opened) return;
    build();
    previous = document.activeElement;
    const selection = window.getSelection();
    savedRange = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
    onOpen();
    candidates = collect();
    input.value = '';
    opened = true;
    root.hidden = false;
    render();
    input.focus({ preventScroll: true });
  }

  function close() {
    if (!opened) return;
    opened = false;
    root.hidden = true;
    list.replaceChildren();
    shown = [];
    candidates = [];
    input.removeAttribute('aria-activedescendant');
    if (previous?.isConnected && typeof previous.focus === 'function' && previous !== document.body) {
      previous.focus({ preventScroll: true });
    } else {
      input.blur();
    }
    if (savedRange) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    previous = null;
    savedRange = null;
  }

  (window.requestIdleCallback || ((fn) => window.setTimeout(fn, 200)))(() => build());

  return {
    /// Commands ({ id?, label, group?, shortcut?, icon?, when?, run }), or
    /// functions that return a list of them when the palette opens.
    add(...items) {
      entries.push(...items);
    },
    open,
    close,
    toggle() {
      if (opened) close();
      else open();
    },
    get isOpen() {
      return opened;
    },
  };
}

function iconOf(href) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon palette-icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', href);
  use.setAttributeNS(XLINK_NS, 'xlink:href', href);
  svg.append(use);
  return svg;
}

function spacer() {
  const span = document.createElement('span');
  span.className = 'palette-icon';
  return span;
}

function kbd(text) {
  const key = document.createElement('kbd');
  key.textContent = text;
  return key;
}
