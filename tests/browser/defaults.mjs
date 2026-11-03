// Defaults: a fresh Markdown file is rendered in Latin Modern. Raw is the open
// tab's own state, not a preference the next file inherits. Font, size, width
// and page mode are global; zoom stays with the file.
import { start } from './harness.mjs';

const files = {
  '/d/a.md': 'Hello brave new world.\n\nSecond paragraph here.\n',
  '/d/b.md': 'Other file text.\n',
  '/d/c.md': 'Third file.\n',
};
const snippet = { 'a.md': 'Hello', 'b.md': 'Other file', 'c.md': 'Third file' };
const { page, ok, openMenu, finish } = await start({ files, initial: '/d/a.md' });

const view = () => page.evaluate(() => {
  const stage = document.querySelector('#stage');
  const md = stage?.querySelector('#markdown');
  const raw = stage?.querySelector('#markdownRaw');
  const zoom = document.querySelector('#zoom');
  const mdOn = Boolean(md) && getComputedStyle(md).display !== 'none';
  const rawOn = Boolean(raw) && getComputedStyle(raw).display !== 'none';
  return {
    rendered: mdOn && !rawOn,
    raw: rawOn && !mdOn,
    font: md?.dataset.font || '',
    size: md?.dataset.size || '',
    width: md?.dataset.width || '',
    zoom: zoom?.selectedOptions?.[0]?.textContent || '',
    night: document.body.classList.contains('mode-night'),
    title: document.title,
  };
});

const ready = () => page.waitForFunction(() => {
  const stage = document.querySelector('#stage');
  const md = stage?.querySelector('#markdown');
  const raw = stage?.querySelector('#markdownRaw');
  const zoom = document.querySelector('#zoom')?.selectedOptions?.[0]?.textContent || '';
  const mdOn = md && getComputedStyle(md).display !== 'none' && md.querySelector('p');
  const rawOn = raw && !raw.hidden && raw.textContent.trim().length > 0;
  return Boolean((mdOn || rawOn) && zoom && zoom !== 'Auto');
});

async function waitFile(name) {
  await page.waitForFunction(({ name, snippet }) => {
    if (!document.title.startsWith(name)) return false;
    const stage = document.querySelector('#stage');
    const md = stage?.querySelector('#markdown');
    const raw = stage?.querySelector('#markdownRaw');
    const zoom = document.querySelector('#zoom')?.selectedOptions?.[0]?.textContent || '';
    const mdOn = md && getComputedStyle(md).display !== 'none';
    const rawOn = raw && getComputedStyle(raw).display !== 'none';
    const body = (mdOn ? md.textContent : raw?.textContent) || '';
    return Boolean((mdOn || rawOn) && body.includes(snippet) && zoom && zoom !== 'Auto');
  }, { name, snippet: snippet[name] });
}

async function openPath(path) {
  await page.evaluate((path) => window.__emit('open-files', [path]), path);
  await waitFile(path.split('/').pop());
}

async function goTab(name) {
  const names = await page.$$eval('#tabs .tab .label', (els) => els.map((el) => el.textContent));
  const index = names.indexOf(name);
  if (index >= 0) {
    await page.keyboard.press(`Control+${index + 1}`);
  } else if ((await page.title()).startsWith(name)) {
    return;
  } else {
    const cover = page.locator(`.pane-body[data-path="/d/${name}"] .pane-cover`);
    if (!(await cover.count())) throw new Error(`no tab ${name} (${names.join() || 'strip hidden'})`);
    await cover.click();
  }
  await waitFile(name);
}
async function toggleRaw() {
  await page.evaluate(() => getSelection()?.removeAllRanges());
  const wasRaw = await page.evaluate(() => getComputedStyle(document.querySelector('#markdownRaw')).display !== 'none');
  await page.keyboard.press('Control+u');
  await page.waitForFunction((wasRaw) => {
    const raw = document.querySelector('#markdownRaw');
    return getComputedStyle(raw).display !== 'none' !== wasRaw;
  }, wasRaw);
}

const claim = (name, pass, detail) => {
  console.log(`  ${detail}`);
  ok(Boolean(pass), name);
};

const fresh = await view();
claim('1a', fresh.rendered && fresh.font === 'latin-modern', `rendered=${fresh.rendered} font=${fresh.font}`);

await toggleRaw();
await openPath('/d/b.md');
const openedB = await view();
claim('1b new open', openedB.rendered && openedB.title.startsWith('b.md'), `rendered=${openedB.rendered} raw=${openedB.raw} title=${openedB.title}`);

await toggleRaw();
await page.keyboard.press('Control+w');
await waitFile('a.md');
const aAfterClose = await view();
await openPath('/d/b.md');
const reopenedB = await view();
claim(
  '1b reopen',
  aAfterClose.raw && reopenedB.rendered && reopenedB.title.startsWith('b.md'),
  `A raw=${aAfterClose.raw} B rendered=${reopenedB.rendered} title=${reopenedB.title}`,
);

await goTab('a.md');
await page.click('#tabs .tab:has-text("b.md") .shut');
await page.waitForFunction(() => document.title.startsWith('a.md') && ![...document.querySelectorAll('#tabs .label')].some((el) => el.textContent === 'b.md'));
await openPath('/d/c.md');
await page.keyboard.press('Control+w');
await waitFile('a.md');
const showingRaw = (await view()).raw;
await page.click('#markdownStage');
await page.keyboard.press('Control+k');
await page.waitForSelector('#palette:not([hidden])');
await page.keyboard.type('open recent: c.md');
await page.waitForFunction(() => /open recent:\s*c\.md/i.test(document.querySelector('#paletteList [aria-selected="true"] .palette-label')?.textContent || ''));
await page.keyboard.press('Enter');
await waitFile('c.md');
const recentC = await view();
claim('1b recent', showingRaw && recentC.rendered && recentC.title.startsWith('c.md'), `showing raw=${showingRaw} C rendered=${recentC.rendered} title=${recentC.title}`);

await goTab('a.md');
await goTab('c.md');
if (!(await view()).rendered) await toggleRaw();
await goTab('a.md');
const aRaw = (await view()).raw;
await goTab('c.md');
const otherRendered = (await view()).rendered;
await goTab('a.md');
const aStill = (await view()).raw;
claim('1c', aRaw && otherRendered && aStill, `A raw=${aRaw} other rendered=${otherRendered} A still=${aStill}`);

if (!(await view()).raw) await toggleRaw();
await page.selectOption('#zoom', '1.5');
await page.waitForFunction(() => document.querySelector('#zoom').selectedOptions[0].textContent === '150%');
await page.evaluate(() => sessionStorage.setItem('noInitial', '1'));
await page.reload();
await ready();
const restored = await view();
await openPath('/d/c.md');
const afterRestart = await view();
claim(
  '1d',
  restored.title.startsWith('a.md') && restored.rendered && restored.zoom === '150%' && afterRestart.rendered && afterRestart.zoom === '100%',
  `A rendered=${restored.rendered} zoom=${restored.zoom} title=${restored.title}; C rendered=${afterRestart.rendered} zoom=${afterRestart.zoom}`,
);

await page.addInitScript(() => {
  if (sessionStorage.getItem('plantRawSession') !== '1') return;
  sessionStorage.removeItem('plantRawSession');
  localStorage.setItem('pdf-next.md-raw', '1');
  localStorage.setItem('pdf-next.session', JSON.stringify({
    tabs: [{ path: '/d/a.md', name: 'a.md', kind: 'markdown' }],
    active: 0,
    views: { '/d/a.md': { kind: 'markdown', raw: true, top: 0, left: 0, scale: 1.25 } },
    panes: null,
  }));
});
await page.evaluate(() => {
  sessionStorage.setItem('plantRawSession', '1');
  sessionStorage.setItem('noInitial', '1');
});
await page.reload();
await ready();
const planted = await view();
claim('1e', planted.title.startsWith('a.md') && planted.rendered && planted.zoom === '125%', `rendered=${planted.rendered} raw=${planted.raw} zoom=${planted.zoom} title=${planted.title}`);

await page.click('#settingsToggle');
await page.waitForSelector('#settingsPanel:not([hidden]) #setFont');
await page.selectOption('#setFont', 'serif');
await page.selectOption('#setSize', '22');
await page.selectOption('#setWidth', '900');
await page.keyboard.press('Escape');
await page.waitForFunction(() => document.getElementById('settingsPanel').hidden);
await openMenu();
await page.click('#mode');
await page.waitForFunction(() => document.body.classList.contains('mode-night'));
await page.keyboard.press('Escape');

const four = (v) => v.font === 'serif' && v.size === '22' && v.width === '900' && v.night;
await page.selectOption('#zoom', '1.5');
await page.waitForFunction(() => document.querySelector('#zoom').selectedOptions[0].textContent === '150%');
await openPath('/d/b.md');
const fileB = await view();
await goTab('a.md');
const backA = await view();
await page.keyboard.press('Control+Shift+D');
await page.waitForSelector('#panes .pane-snapshot article#markdown', { state: 'attached' });
const panes = await page.evaluate(() => {
  const same = (el) => el?.dataset.font === 'serif' && el?.dataset.size === '22' && el?.dataset.width === '900';
  const live = document.querySelector('#stage #markdown');
  const snaps = [...document.querySelectorAll('#panes .pane-snapshot article#markdown')];
  return {
    night: document.body.classList.contains('mode-night'),
    live: same(live),
    snap: snaps.length > 0 && snaps.every(same),
    liveData: [live?.dataset.font, live?.dataset.size, live?.dataset.width].join(),
    snapData: snaps.map((el) => [el.dataset.font, el.dataset.size, el.dataset.width].join()).join('|'),
  };
});
await goTab('a.md');
await page.evaluate(() => sessionStorage.setItem('noInitial', '1'));
await page.reload();
await waitFile('a.md');
const reloaded = await view();
claim(
  '1f',
  four(fileB) && fileB.zoom === '100%' && four(backA) && backA.zoom === '150%' && panes.night && panes.live && panes.snap && four(reloaded) && reloaded.zoom === '150%',
  `B ${fileB.font}/${fileB.size}/${fileB.width} night=${fileB.night} zoom=${fileB.zoom}; A ${backA.zoom}; panes live=${panes.liveData} snap=${panes.snapData} night=${panes.night}; reload ${reloaded.font}/${reloaded.size}/${reloaded.width} night=${reloaded.night} zoom=${reloaded.zoom} title=${reloaded.title}`,
);

await finish();
