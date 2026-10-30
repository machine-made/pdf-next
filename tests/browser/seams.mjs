// Where the 0.18 features meet: presentation with the palette, the outline,
// zoom gestures, remembered places and tab switches.
import { start } from './harness.mjs';

// Night recolours a page once it is drawn: a slow page must not show white
// halfway (PDF.js shows a page that takes over half a second as it draws).
{
  const { page, ok, openMenu, close } = await start({ initial: '/d/dense-page.pdf' });
  await page.waitForSelector('#viewer .page canvas', { timeout: 20_000 });
  await page.waitForTimeout(500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 40 });
  await page.evaluate(() => {
    window.__white = 0;
    window.__watch = true;
    const night = () => document.body.classList.contains('mode-night');
    const tick = () => {
      if (!window.__watch) return;
      for (const canvas of document.querySelectorAll('#viewer .page canvas')) {
        if (night() && canvas.isConnected && !canvas.hidden && canvas.width && !canvas.dataset.recolored) window.__white += 1;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await openMenu();
  await page.click('#mode');
  await page.waitForFunction(() => [...document.querySelectorAll('#viewer .page canvas')].some((c) => c.dataset.recolored), null, { timeout: 60_000 });
  const white = await page.evaluate(() => {
    window.__watch = false;
    return window.__white;
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  ok(white === 0, `A slow page in Night shows once it is recoloured, never white halfway (${white} white frames)`);
  await close();
}

const { page, ok, finish } = await start({ initial: '/d/navigate.pdf' });
await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
await page.waitForTimeout(400);
const presenting = () => page.evaluate(() => document.body.classList.contains('presenting'));
const pageNo = () => page.$eval('#page', (i) => Number(i.value));
const press = async (key, wait = 150) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(wait);
};
const place = () => page.evaluate(() => JSON.parse(localStorage.getItem('pdf-next.places') || '[]')
  .find((entry) => entry.path === '/d/navigate.pdf')?.view ?? null);

await page.selectOption('#zoom', '1');
await page.$eval('#viewerContainer', (c) => { c.scrollTop = 200; });
await page.waitForTimeout(600);
ok(String((await place())?.scale) === '1', 'Reading at 100% is remembered');
await page.evaluate(() => document.activeElement?.blur());

// The palette opened over a presentation takes its keys.
await press('F5', 400);
ok(await presenting(), 'F5 presents the PDF');
const before = await pageNo();
await press('Control+k');
await page.keyboard.type('next pk');
ok(await page.$eval('#paletteInput', (i) => i.value) === 'next pk' && await pageNo() === before,
  'Typing in the palette while presenting types, and does not step pages');
await press('Backspace');
ok(await page.$eval('#paletteInput', (i) => i.value) === 'next p', 'Backspace edits the query');
await press('Escape');
ok(await presenting() && await page.$eval('#palette', (p) => p.hidden), 'Esc closes the palette and keeps presenting');

// Ctrl+wheel does not zoom the presented page away from the screen fit.
const box = await page.$eval('#viewerContainer', (c) => c.getBoundingClientRect().toJSON());
await page.mouse.move(box.left + box.width / 2, box.top + box.height / 2);
await page.keyboard.down('Control');
for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -100);
await page.keyboard.up('Control');
await page.waitForTimeout(400);
ok(await page.evaluate(() => document.getElementById('zoom').value) === 'page-fit', 'Ctrl+wheel leaves a presented page fitted');

// Presenting is not where you were reading.
await page.waitForTimeout(600);
ok(String((await place())?.scale) === '1', `The remembered place keeps the reading zoom while presenting (${JSON.stringify(await place())})`);
await press('Escape', 400);
ok(!(await presenting()) && await page.$eval('#zoom', (s) => s.value) === '1', 'Esc comes back at the reading zoom');

// The outline makes way for a presentation and comes back after it.
await press('Control+Shift+O', 300);
ok(await page.$eval('#outline', (o) => !o.hidden), 'Ctrl+Shift+O opens the outline');
await press('F5', 400);
const shown = await page.evaluate(() => ({
  outline: getComputedStyle(document.getElementById('outline')).display,
  left: document.getElementById('viewerContainer').getBoundingClientRect().left - document.getElementById('stage').getBoundingClientRect().left,
}));
ok(shown.outline === 'none' && Math.abs(shown.left) < 1, `Presenting hides the outline and gives the page the whole screen (${JSON.stringify(shown)})`);
await press('Escape', 400);
ok(await page.$eval('#outline', (o) => getComputedStyle(o).display !== 'none'), 'and it is back afterwards');
await press('Control+Shift+O', 300);

// Back and forward while presenting turn pages and keep the screen fit.
await press('g', 300);
await press('Shift+G', 300);
ok(await pageNo() === 4, 'G goes to the last page');
await press('F5', 400);
await press('Alt+ArrowLeft', 400);
ok(await presenting() && await pageNo() === 1 && await page.$eval('#zoom', (s) => s.value) === 'page-fit',
  `Alt+Left while presenting goes back a page, still fitted (page ${await pageNo()})`);
await press('Alt+ArrowRight', 400);
ok(await pageNo() === 4 && await page.$eval('#zoom', (s) => s.value) === 'page-fit', 'Alt+Right goes forward again');

// F5 in the palette presents, rather than staying in the palette, where the
// window would take it as reload (WebView2).
await press('Escape', 400);
await press('Control+k');
await page.evaluate(() => {
  window.__f5 = null;
  window.addEventListener('keydown', (event) => {
    if (event.key === 'F5') window.setTimeout(() => { window.__f5 ??= event.defaultPrevented; });
  }, { capture: true });
});
await press('F5', 400);
ok(await page.evaluate(() => window.__f5) === true && await presenting() && await page.$eval('#palette', (p) => p.hidden),
  'F5 in the palette is taken by the app and presents');
await press('Escape', 400);

// A menu stays open, under its button, when the window changes size.
await page.evaluate(() => document.getElementById('viewMenuButton').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
await page.setViewportSize({ width: 1300, height: 860 });
await page.waitForTimeout(200);
const menu = await page.evaluate(() => ({
  open: !document.getElementById('viewMenu').hidden,
  right: document.getElementById('viewMenu').getBoundingClientRect().right,
}));
ok(menu.open && menu.right <= 1300, `The View menu stays open inside a resized window (${JSON.stringify(menu)})`);
await page.mouse.click(600, 500);
await page.setViewportSize({ width: 1500, height: 900 });
await page.waitForTimeout(200);

// Another tab, or closing the presented one, ends the presentation.
await page.evaluate(() => window.__emit('open-files', ['/d/a.md']));
await page.waitForSelector('#markdown p');
await press('Control+1', 600);
await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
await page.evaluate(() => document.activeElement?.blur());
await press('F5', 400);
ok(await presenting(), 'Presenting again');
await press('Control+Tab', 600);
await page.waitForSelector('#markdown p');
ok(!(await presenting()) && await page.evaluate(() => window.__fullscreen === false), 'Switching to another tab ends it and leaves full screen');
await page.waitForTimeout(300);
ok(await page.$eval('#markdown', (a) => !a.dataset.pages), 'and the other file shows as it was');
await press('Control+Tab', 600);
await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
await page.evaluate(() => document.activeElement?.blur());
await press('F5', 400);
await press('Control+w', 600);
await press('Control+w', 600);
ok(!(await presenting()) && await page.evaluate(() => !document.body.classList.contains('has-file')), 'Closing every tab while presenting ends it');

await finish();
