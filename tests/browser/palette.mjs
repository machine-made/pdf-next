// The command palette (Ctrl+K): what it lists, `when` rules, fuzzy filter,
// keyboard and focus, running commands, and timing with many tabs.
import { start } from './harness.mjs';

// Frame budget for opening and filtering; shared CI runners get some slack.
const frame = process.env.CI ? 40 : 16;

const { page, ok, selectText, shot, finish } = await start();
const open = () => page.evaluate(() => !!document.getElementById('palette') && !document.getElementById('palette').hidden);
const labels = async () => { await page.evaluate(() => { const l = document.getElementById('paletteList'); for (let i = 0; i < 20; i++) { l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); } }); return page.$$eval('#paletteList .palette-label', l => l.map(x => x.textContent)); };
const active = () => page.evaluate(() => document.activeElement?.id);
const run = async (query) => { await page.keyboard.press('Control+k'); await page.keyboard.type(query); await page.keyboard.press('Enter'); await page.waitForTimeout(150); };

await page.waitForTimeout(300);
await page.focus('#viewerContainer');
const before = await active();
const t = await page.evaluate(() => { const t0 = performance.now(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); return performance.now() - t0; });
ok(await open(), 'Ctrl+K opens the palette');
ok(t < frame, `First open in ${t.toFixed(1)} ms`);
for (let i = 0; i < 3; i += 1) {
  await page.$eval('#paletteList', (l) => { l.scrollTop = l.scrollHeight; });
  await page.waitForTimeout(50);
}
const count = await page.$$eval('#paletteList [role=option]', l => l.length);
ok(count > 60, `Scrolling the list shows all ${count} commands`);
ok(await active() === 'paletteInput', 'Focus moves to the search field');
ok(await page.evaluate(() => { const r = document.getElementById('palette'); const i = document.getElementById('paletteInput'); return r.getAttribute('role') === 'dialog' && r.getAttribute('aria-modal') === 'true' && document.getElementById('paletteList').getAttribute('role') === 'listbox' && i.getAttribute('aria-activedescendant') === 'palette-item-0' && document.getElementById('palette-item-0').getAttribute('aria-selected') === 'true'; }), 'Dialog, listbox, options and aria-activedescendant');
await shot('palette-empty');
const all = await labels();
ok(all.includes('Font: Monaspace Neon') && all.includes('Text size: 20 px') && all.includes('Figure width: Column width'), 'Settings and menus appear as choices');
ok(all.includes('Go to a.md'), 'Open tabs appear as "Go to <file>"');
ok(await page.evaluate(() => [...document.querySelectorAll('#paletteList .palette-item')].some(i => i.textContent.includes('Split right') && i.querySelector('.palette-keys')?.textContent === 'CtrlShiftD')), 'Shortcuts are shown as keys');
ok(!all.includes('Next page') && !all.includes('Reduce PDF size') && !all.includes('Rotate a quarter turn clockwise'), '`when` hides PDF and image commands for Markdown');
ok(!all.includes('Back to one pane') && !all.some(l => l.startsWith('Move to the pane')), '`when` hides pane commands with one pane');
ok(!all.includes('Close the review panel') && all.includes('Open the review panel') && !all.some(l => l.startsWith('Show reviews by')), '`when` follows the review panel');
ok(!all.includes('Bold the selection') && !all.includes('Next tab'), '`when` hides selection and tab-stepping commands');

await page.keyboard.type('mono neon');
let l = await labels();
ok(l[0] === 'Font: Monaspace Neon', `Fuzzy filter: "mono neon" -> ${l[0]}`);
const marked = await page.$eval('#paletteList .palette-label', x => [...x.querySelectorAll('mark')].map(m => m.textContent).join(''));
ok(marked.length >= 6 && marked.endsWith('Neon'), `Matched letters are marked (${marked})`);
await shot('palette-filter');
await page.keyboard.press('Enter'); await page.waitForTimeout(100);
ok(!(await open()), 'Enter runs and closes');
ok(await page.$eval('#markdown', a => a.dataset.font) === 'monaspace-neon' && await page.$eval('#mdFont', s => s.value) === 'monaspace-neon', 'Font command sets the font through the toolbar menu');
ok(await page.evaluate(() => localStorage.getItem('pdf-next.md-font')) === 'monaspace-neon', 'The font is saved as the menu saves it');
ok(await active() === before, `Focus returns after running (${before})`);

await page.keyboard.press('Control+k');
ok((await labels())[0] === 'Font: Monaspace Neon', 'Recent command first with an empty query');
ok(await page.$eval('#paletteList .palette-item', i => i.querySelector('.palette-current') !== null), 'The current value is marked');
await page.keyboard.press('ArrowDown');
ok(await page.$eval('#paletteInput', i => i.getAttribute('aria-activedescendant')) === 'palette-item-1', 'ArrowDown moves the active item');
await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
const n = await page.$$eval('#paletteList [role=option]', x => x.length);
ok(await page.$eval('#paletteInput', i => i.getAttribute('aria-activedescendant')) === `palette-item-${n - 1}`, 'ArrowUp wraps to the end');
await page.keyboard.press('Tab');
ok(await active() === 'paletteInput', 'Tab keeps focus in the palette');
await page.keyboard.press('Shift+Tab');
ok(await active() === 'paletteInput', 'Shift+Tab keeps focus in the palette');
await page.keyboard.press('Escape'); await page.waitForTimeout(50);
ok(!(await open()), 'Esc closes');
ok(await active() === before, 'Esc returns focus to where it was');

await page.keyboard.press('Control+k'); await page.keyboard.type('raw');
ok((await labels())[0] === 'Show the raw markdown', 'raw -> Show the raw markdown');
await page.keyboard.press('Enter'); await page.waitForTimeout(50);
ok(await page.evaluate(() => !document.querySelector('#markdownRaw').hidden && document.querySelector('#raw').getAttribute('aria-pressed') === 'true'), 'The palette opens the raw view');
await run('rendered');
ok(await page.evaluate(() => document.querySelector('#markdownRaw').hidden), 'And back to the rendered view');

await page.keyboard.press('Control+k'); await page.keyboard.type('size 20');
await page.click('#paletteList .palette-item >> nth=0'); await page.waitForTimeout(50);
ok(await page.$eval('#mdSize', s => s.value) === '20' && await page.$eval('#markdown', a => a.dataset.size) === '20', 'A mouse click runs Text size: 20 px');

await run('mode sepia');
ok(await page.evaluate(() => document.body.classList.contains('mode-sepia')), 'Page mode: Sepia');
await page.keyboard.press('Control+k'); await page.waitForTimeout(30); await shot('palette-sepia'); await page.keyboard.press('Escape');
await run('mode clear');

await selectText('#markdown', 'brave new');
await page.keyboard.press('Control+k');
l = await labels();
ok(l.includes('Bold the selection') && l.includes('Edit the selected text…'), 'Selection commands appear with a selection');
await page.keyboard.type('bold sel'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
ok(await page.evaluate(() => window.__files['/d/a.md'].startsWith('Hello **brave new** world.')), 'Bold the selection edits the file, with the selection kept across the palette');

await page.evaluate(() => { window.__pick = '/d/b.md'; });
await run('split right'); await page.waitForTimeout(500);
ok(await page.evaluate(() => !document.getElementById('panes').hidden && document.querySelectorAll('#panes .dv-groupview').length === 2), 'Split right from the palette makes two panes');
await page.keyboard.press('Control+k');
l = await labels();
ok(l.includes('Back to one pane') && l.includes('Move to the pane on the left'), 'Pane commands appear with two panes');
ok(l.includes('Go to b.md'), 'The new tab is listed');
await page.keyboard.type('one pane'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
ok(await page.evaluate(() => document.getElementById('panes').hidden || !document.querySelector('#panes .dv-groupview')), 'Back to one pane');
await run('go a.md'); await page.waitForTimeout(200);
ok(await page.evaluate(() => document.title.startsWith('a.md')), 'Go to a.md switches the tab');

await page.keyboard.press('Control+Shift+R'); await page.waitForTimeout(100);
await page.keyboard.press('Control+k');
l = await labels();
ok(l.includes('Close the review panel') && l.includes('Show reviews by status: Open'), 'Review commands appear with the panel open');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+Shift+R'); await page.waitForTimeout(50);

await page.keyboard.press('Control+f'); await page.waitForTimeout(50);
await page.keyboard.type('par');
await page.keyboard.press('Control+k');
ok(!(await open()), 'Ctrl+K in the find field does not open the palette');
await page.keyboard.type('a');
ok(await page.$eval('#findInput', i => i.value) === 'para' && await active() === 'findInput', 'Typing in the find field is unaffected');
await page.keyboard.press('Escape');

await page.click('#settingsToggle'); await page.waitForTimeout(50);
await shot('settings', { clip: { x: 1100, y: 30, width: 400, height: 260 } });
await page.click('#paletteOpen'); await page.waitForTimeout(50);
ok(await open() && await page.evaluate(() => document.getElementById('settingsPanel').hidden), 'The Settings entry opens the palette');
await page.keyboard.type('code font radon'); await page.keyboard.press('Enter');
ok(await page.evaluate(() => localStorage.getItem('pdf-next.code-font')) === 'monaspace-radon', 'Code font from the palette');
await run('interface font weft');
ok(await page.evaluate(() => document.documentElement.dataset.uiFont) === 'weft', 'Interface font from the palette');

await page.keyboard.press('Control+k'); await page.mouse.click(5, 880); await page.waitForTimeout(50);
ok(!(await open()), 'A click outside closes');
await page.keyboard.press('Control+k'); await page.keyboard.type('zzqqxx');
ok(await page.$eval('#paletteList', x => x.textContent.includes('No matching')), 'No match says so');
ok(!(await page.$eval('#paletteInput', i => i.hasAttribute('aria-activedescendant'))), 'No active item without matches');
await page.keyboard.press('Control+k');
ok(!(await open()), 'Ctrl+K again closes');

await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
await page.keyboard.press('Control+k'); await page.keyboard.type('font');
await shot('palette-dark');
await page.keyboard.press('Escape');

await page.evaluate(() => window.__listeners['open-files']({ payload: Array.from({ length: 100 }, (_, i) => `/d/many-${i}.md`) }));
await page.waitForTimeout(300);
const big = await page.evaluate(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); const input = document.getElementById('paletteInput'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); const n = document.querySelectorAll('#paletteList [role=option]').length; document.getElementById('paletteInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return n; });
ok(big >= 200, `${big} commands with 100 more tabs`);
const timing = await page.evaluate(() => {
  const times = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    times.push(performance.now() - t0);
    document.getElementById('paletteInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  const input = document.getElementById('paletteInput');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  const t0 = performance.now();
  for (const q of ['g', 'go', 'go m', 'go many', 'go many 4', 'go many 42']) { input.value = q; input.dispatchEvent(new Event('input')); }
  const typed = (performance.now() - t0) / 6;
  const top = document.querySelector('#paletteList .palette-label').textContent;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return { times, typed, top };
});
console.log('timing', JSON.stringify(timing));
ok(timing.typed < frame, `Filtering takes ${timing.typed.toFixed(1)} ms a keystroke`);
ok(timing.top === 'Go to many-42.md', `"go many 42" -> ${timing.top}`);
const warm = Math.max(...timing.times.slice(1));
ok(warm < frame, `Warm open under ${frame} ms (max ${warm.toFixed(1)} ms over ${big} commands)`);
await finish();
