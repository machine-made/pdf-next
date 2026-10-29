/// Tiled panes with tabs, on dockview-core (src/vendor/dockview).
///
/// The app keeps one live viewer, the `#stage`. With one pane there is no
/// layout at all: the classic tab strip and the stage, as before. Splitting
/// builds a dockview layout in `#panes` with one tab per open file; the stage
/// moves into whichever tab is active, and every other visible tab shows a
/// snapshot of where it was left (a live render for Markdown, kept current
/// when the file changes). Clicking a pane makes it the live one. When the
/// layout is back to a single group, dockview goes away and the tab strip
/// returns, in the order the tabs had in that group.

const DIRECTIONS = { right: 'right', bottom: 'below', below: 'below', left: 'left', top: 'above', above: 'above' };

export function createPanes({ host, stage, library, onActivate, onClose, onExit, onLayout }) {
  let api = null;
  let livePath = null;
  let quiet = 0; // > 0 while our own calls move or activate panels
  let exiting = false;
  const bodies = new Map(); // path -> the panel's content element

  const quietly = (run) => {
    quiet += 1;
    try {
      return run();
    } finally {
      quiet -= 1;
    }
  };

  function body(path) {
    let element = bodies.get(path);
    if (!element) {
      element = document.createElement('div');
      element.className = 'pane-body';
      element.dataset.path = path;
      bodies.set(path, element);
    }
    return element;
  }

  function panel(path) {
    return api?.getPanel(path) ?? null;
  }

  function create() {
    host.hidden = false;
    document.body.classList.add('panes');
    api = library.createDockview(host, {
      theme: { name: 'pdf-next', className: 'dockview-theme-light dockview-theme-pdf-next' },
      disableFloatingGroups: true,
      // Pointer events, not HTML5 drag and drop: on Windows the window's own
      // file-drop handler (dragDropEnabled) swallows HTML5 drops.
      dndStrategy: 'pointer',
      createComponent: ({ id }) => ({
        element: body(id),
        init() {},
      }),
    });
    api.onDidActivePanelChange((event) => {
      const active = event?.panel ?? event;
      if (quiet || exiting || !active?.id || active.id === livePath) return;
      onActivate(active.id);
    });
    api.onDidRemovePanel((removed) => {
      bodies.delete(removed.id);
      if (quiet || exiting) return;
      onClose(removed.id);
    });
    api.onDidRemoveGroup(() => {
      if (!exiting && api.groups.length <= 1) queueMicrotask(exit);
    });
    api.onDidLayoutChange(() => {
      if (!exiting) onLayout();
    });
  }

  /// Back to one pane: the stage returns to the window and the strip takes
  /// the tabs in their order in the last group.
  function exit() {
    if (!api || exiting) return;
    exiting = true;
    const order = (api.groups[0]?.panels ?? []).map((item) => item.id);
    const disposed = api;
    api = null;
    livePath = null;
    bodies.clear();
    disposed.dispose();
    host.textContent = '';
    host.hidden = true;
    document.body.classList.remove('panes');
    exiting = false;
    onExit(order);
  }

  /// Split: every open file goes in one group, then `newPath` opens beside
  /// the active one. The new pane becomes the live one, as in a terminal.
  function enter({ paths, titles, activePath, newPath, direction }) {
    if (api) return split(newPath, direction);
    create();
    quietly(() => {
      for (const path of paths) {
        if (path === newPath) continue;
        api.addPanel({ id: path, component: 'file', title: titles.get(path) ?? path });
      }
      api.addPanel({
        id: newPath,
        component: 'file',
        title: titles.get(newPath) ?? newPath,
        position: { referencePanel: activePath, direction: DIRECTIONS[direction] ?? 'right' },
      });
    });
    return true;
  }

  /// Move `path` into a new group beside the active group.
  function split(path, direction) {
    if (!api) return false;
    const target = panel(path);
    const reference = api.activeGroup;
    if (!target || !reference) return false;
    quietly(() => {
      target.api.moveTo({ group: reference, position: DIRECTIONS[direction] ?? 'right' });
    });
    return true;
  }

  /// Put the live stage in `path`'s tab and make it the active tab.
  function mount(path) {
    const target = panel(path);
    if (!target) return;
    const element = body(path);
    element.querySelector(':scope > .pane-snapshot')?.remove();
    element.append(stage);
    livePath = path;
    quietly(() => target.api.setActive());
  }

  /// Leave `snapshot` in `path`'s tab, where the stage just was.
  function freeze(path, snapshot) {
    if (!api || !snapshot || !bodies.has(path)) return;
    const element = body(path);
    element.querySelector(':scope > .pane-snapshot')?.remove();
    element.append(snapshot);
    snapshot.dispatchEvent(new Event('pane-attached'));
  }

  function snapshotOf(path) {
    return bodies.get(path)?.querySelector(':scope > .pane-snapshot') ?? null;
  }

  /// Make the open panels match the tabs: add new files to the live group,
  /// drop closed ones, keep titles current.
  function sync(tabs) {
    if (!api) return;
    const wanted = new Set(tabs.map((tab) => tab.path));
    quietly(() => {
      for (const item of [...api.panels]) {
        if (!wanted.has(item.id)) item.api.close();
      }
      for (const tab of tabs) {
        const existing = panel(tab.path);
        if (existing) {
          if (existing.title !== tab.name) existing.api.setTitle(tab.name);
          continue;
        }
        const live = livePath ? panel(livePath) : null;
        api.addPanel({
          id: tab.path,
          component: 'file',
          title: tab.name,
          inactive: true,
          ...(live ? { position: { referencePanel: live.id, direction: 'within' } } : {}),
        });
      }
    });
    if (api.groups.length <= 1) queueMicrotask(exit);
  }

  /// The active pane's neighbour in `direction`, by where the groups sit.
  function neighbour(direction) {
    if (!api?.activeGroup) return null;
    const from = api.activeGroup.element.getBoundingClientRect();
    const cx = from.left + from.width / 2;
    const cy = from.top + from.height / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const group of api.groups) {
      if (group === api.activeGroup || !group.activePanel) continue;
      const box = group.element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const ahead = direction === 'left' ? x < cx - 1
        : direction === 'right' ? x > cx + 1
          : direction === 'up' ? y < cy - 1
            : y > cy + 1;
      if (!ahead) continue;
      const along = direction === 'left' || direction === 'right' ? Math.abs(x - cx) : Math.abs(y - cy);
      const across = direction === 'left' || direction === 'right' ? Math.abs(y - cy) : Math.abs(x - cx);
      const distance = along + across * 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = group;
      }
    }
    return best?.activePanel?.id ?? null;
  }

  /// Each group's showing tab: what is on screen.
  function visible() {
    return api ? api.groups.map((group) => group.activePanel?.id).filter(Boolean) : [];
  }

  function layout() {
    return api ? api.toJSON() : null;
  }

  /// Rebuild a saved layout over the open tabs. Files that are no longer
  /// open are dropped; if fewer than two groups survive, nothing is built.
  function restore(saved, tabs) {
    if (api || !saved?.grid) return false;
    const open = new Set(tabs.map((tab) => tab.path));
    const panels = Object.fromEntries(Object.entries(saved.panels ?? {}).filter(([id]) => open.has(id)));
    const prune = (node) => {
      if (node.type === 'leaf') {
        const views = (node.data?.views ?? []).filter((id) => open.has(id));
        if (!views.length) return null;
        const activeView = views.includes(node.data.activeView) ? node.data.activeView : views[0];
        return { ...node, data: { ...node.data, views, activeView } };
      }
      const data = (node.data ?? []).map(prune).filter(Boolean);
      return data.length ? { ...node, data } : null;
    };
    const root = prune(saved.grid.root);
    const leaves = (node) => (node?.type === 'leaf' ? 1 : (node?.data ?? []).reduce((sum, child) => sum + leaves(child), 0));
    if (!root || leaves(root) < 2) return false;
    create();
    try {
      quietly(() => api.fromJSON({ ...saved, grid: { ...saved.grid, root }, panels, activeGroup: undefined }));
    } catch {
      exiting = true;
      api.dispose();
      api = null;
      host.textContent = '';
      host.hidden = true;
      document.body.classList.remove('panes');
      exiting = false;
      return false;
    }
    // Tabs opened since the layout was saved join the first group.
    quietly(() => {
      for (const tab of tabs) {
        if (!panel(tab.path)) api.addPanel({ id: tab.path, component: 'file', title: tab.name, inactive: true });
      }
    });
    return true;
  }

  return {
    get active() {
      return Boolean(api);
    },
    get livePath() {
      return livePath;
    },
    enter,
    split,
    mount,
    freeze,
    snapshotOf,
    sync,
    exit,
    neighbour,
    visible,
    layout,
    restore,
    has: (path) => Boolean(panel(path)),
    groupCount: () => api?.groups.length ?? 0,
  };
}

/// A still copy of the live view, for a pane the stage is leaving. The copy
/// keeps the viewer's ids so it is styled exactly like the live one; a cover
/// on top takes the click that makes the pane live again, and passes the
/// wheel through so the copy still scrolls.
export function snapshotOfStage({ kind, markdownStage, viewerContainer, imageStage, onPick }) {
  const source = kind === 'pdf' ? viewerContainer : kind === 'image' ? imageStage : markdownStage;
  if (!source) return null;
  const wrap = document.createElement('div');
  wrap.className = `pane-snapshot pane-snapshot-${kind === 'json' ? 'markdown' : kind}`;
  const copy = source.cloneNode(true);
  copy.removeAttribute('tabindex');
  if (kind === 'pdf') {
    const from = source.querySelectorAll('canvas');
    copy.querySelectorAll('canvas').forEach((canvas, index) => {
      const original = from[index];
      if (!original?.width || !original?.height) return;
      try {
        canvas.getContext('2d')?.drawImage(original, 0, 0);
      } catch {
        // A canvas that cannot be read stays blank in the copy.
      }
    });
  }
  const cover = document.createElement('div');
  cover.className = 'pane-cover';
  cover.title = 'Click to work in this pane';
  cover.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    onPick?.();
  });
  cover.addEventListener('wheel', (event) => {
    copy.scrollBy({ left: event.deltaX, top: event.deltaY });
  }, { passive: true });
  wrap.append(copy, cover);
  const top = source.scrollTop;
  const left = source.scrollLeft;
  wrap.addEventListener('pane-attached', () => {
    copy.scrollTop = top;
    copy.scrollLeft = left;
  });
  return wrap;
}
