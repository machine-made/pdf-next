// Where you were in each file, kept after the tab closes and the app quits:
// one localStorage entry, the file opened last first, at most PLACES_MAX
// files. The empty window and "Open recent…" list the same entries.

export const PLACES_KEY = 'pdf-next.places';
export const PLACES_MAX = 300;

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readPlaces(store = storage()) {
  try {
    const saved = JSON.parse(store?.getItem(PLACES_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((entry) => typeof entry?.path === 'string') : [];
  } catch {
    return [];
  }
}

function writePlaces(list, store) {
  try {
    store?.setItem(PLACES_KEY, JSON.stringify(list.slice(0, PLACES_MAX)));
  } catch {
    // A place is a convenience; a full or blocked store only loses it.
  }
}

/// Remember `file`. `opened` moves it to the front of the list with the time;
/// a `view` alone updates where you are without reordering anything.
export function notePlace(file, view = null, { opened = false, now = Date.now(), store = storage() } = {}) {
  if (typeof file?.path !== 'string') return;
  const list = readPlaces(store);
  const at = list.findIndex((entry) => entry.path === file.path);
  const old = at >= 0 ? list[at] : null;
  const entry = {
    path: file.path,
    name: file.name || old?.name || file.path.split(/[\\/]/).pop(),
    kind: file.kind || old?.kind || '',
    opened: opened || !old ? now : old.opened,
    view: view ?? old?.view ?? null,
  };
  if (at >= 0) list.splice(at, 1);
  if (opened || at < 0) list.unshift(entry);
  else list.splice(at, 0, entry);
  writePlaces(list, store);
}

export function placeOf(path, store = storage()) {
  return readPlaces(store).find((entry) => entry.path === path)?.view ?? null;
}

export function forgetPlace(path, store = storage()) {
  const list = readPlaces(store);
  const kept = list.filter((entry) => entry.path !== path);
  if (kept.length !== list.length) writePlaces(kept, store);
}

export function recentPlaces(count = 8, store = storage()) {
  return readPlaces(store).slice(0, count);
}

/// The folder a path is in, as written.
export function folderOf(path) {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut > 0 ? path.slice(0, cut) : cut === 0 ? path[0] : '';
}

/// "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the date.
export function openedLabel(then, now = Date.now()) {
  const minutes = Math.floor((now - then) / 60_000);
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 2) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
