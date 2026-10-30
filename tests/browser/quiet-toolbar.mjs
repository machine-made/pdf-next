// The quiet toolbar: the View and Window menus (mouse and keyboard), focus mode
// (when the bar fades and what brings it back), full screen and presentation.
import { defaultFiles, start } from './harness.mjs';

const long = Array.from({ length: 70 }, (_, i) => `Paragraph ${i + 1} of the long file, with enough words in it to fill a line or two of the column.`).join('\n\n');
const { page, ok, close } = await start({ files: { ...defaultFiles, '/d/long.md': `${long}\n` } });
const active = () => page.evaluate(() => document.activeElement?.id || '');
const expanded = (id) => page.$eval(`#${id}`, (b) => b.getAttribute('aria-expanded'));
const shown = (id) => page.$eval(`#${id}`, (e) => !e.hidden);
const hidden = () => page.evaluate(() => document.body.classList.contains('bar-hidden'));
const press = async (key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(30);
};

// The bar itself: about ten controls, no Ask or Add review, no update button until there is one.
const visible = await page.$$eval('#bar > .group > :is(button, select, input)', (c) => c.filter((x) => x.getClientRects().length).map((x) => x.id));
ok(visible.length <= 10, `The Markdown toolbar shows ${visible.length} controls (${visible.join(' ')})`);
ok(!(await page.$('#ask')) && !(await page.$('#note')), 'Ask and Add review are not toolbar buttons');
ok(await page.$eval('#update', (b) => getComputedStyle(b).display) === 'none', 'The update button hides until an update is found');
await page.evaluate(() => document.getElementById('update').classList.add('available'));
ok(await page.$eval('#update', (b) => getComputedStyle(b).display) !== 'none', 'and shows when one is');
await page.evaluate(() => document.getElementById('update').classList.remove('available'));

// View menu with the mouse.
await page.click('#viewMenuButton');
ok(await shown('viewMenu') && await expanded('viewMenuButton') === 'true', 'The View button opens its menu');
const inMenu = await page.$$eval('#viewMenu :is(button, select)', (c) => c.filter((x) => x.getClientRects().length).map((x) => x.id));
ok(['pageView', 'raw', 'mdFont', 'mdSize', 'mdWidth', 'splitView', 'mode', 'poll', 'copyPath', 'copyName', 'print'].every((id) => inMenu.includes(id)) && !inMenu.includes('reduce'),
  `It holds what applies to Markdown (${inMenu.join(' ')})`);
const box = await page.$eval('#viewMenu', (m) => { const r = m.getBoundingClientRect(); return { top: r.top, right: r.right, width: r.width }; });
const button = await page.$eval('#viewMenuButton', (b) => b.getBoundingClientRect().bottom);
ok(box.top >= button && box.right <= 1500 && box.width > 150, 'It opens under its button, inside the window');
await page.click('#mode');
ok(await shown('viewMenu') && await page.textContent('#modeName') === 'Night', 'Page mode cycles in the menu, which stays open');
await page.click('#mode', { modifiers: ['Shift'] });
ok(await page.textContent('#modeName') === 'Clear', 'Shift+click clears it');
const size = await page.$eval('#mdSize', (s) => s.value);
await page.hover('#mdSize');
await page.mouse.wheel(0, -100);
await page.waitForTimeout(60);
ok(await page.$eval('#mdSize', (s) => s.value) !== size, 'The wheel steps a menu inside the View menu');
await page.mouse.click(700, 500);
ok(!(await shown('viewMenu')) && await expanded('viewMenuButton') === 'false', 'A click outside closes it');

// View menu with the keyboard.
await page.focus('#viewMenuButton');
await press('Enter');
ok(await shown('viewMenu') && await active() === 'pageView', 'Enter opens it with focus on the first control');
await press('ArrowDown');
ok(await active() === 'raw', 'ArrowDown moves to the next control');
await press('ArrowDown');
ok(await active() === 'mdFont', 'and on to the font menu');
const font = await page.$eval('#mdFont', (s) => s.value);
await press('ArrowRight');
ok(await active() === 'mdFont', 'Left and Right on a menu stay on it');
await page.$eval('#mdFont', (s, v) => { s.value = v; s.dispatchEvent(new Event('change')); }, font);
await press('ArrowUp');
ok(await active() === 'raw', 'ArrowUp goes back');
await press('End');
ok(await active() === 'print', 'End goes to the last control');
await press('ArrowDown');
ok(await active() === 'pageView', 'ArrowDown wraps round to the first');
await press('Home');
ok(await active() === 'pageView', 'Home is the first control');
await press('Escape');
ok(!(await shown('viewMenu')) && await active() === 'viewMenuButton', 'Esc closes it and gives focus back to the button');
ok(await page.$eval('#find', (f) => f.hidden) && await page.$eval('#settingsPanel', (p) => p.hidden), 'and does nothing else');
await press('ArrowDown');
ok(await shown('viewMenu') && await active() === 'pageView', 'ArrowDown on the button opens the menu too');
await press('End');
await press('Tab');
ok(!(await shown('viewMenu')), 'Tab out of the menu closes it');

// Window menu: the dock picker is a grid the arrows move around.
await page.focus('#dockMenuButton');
await press('Enter');
ok(await shown('dockMenu') && await active() === 'dockTop', 'The Window menu opens on the top half');
const moves = [];
for (const key of ['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown']) {
  await press(key);
  moves.push(await active());
}
ok(moves.join() === 'dockCenter,dockLeft,dockCenter,dockRight,dockBottom,wrap', `Arrows move like the screen (${moves})`);
await press('Escape');
await page.click('#dockMenuButton');
await page.click('#dockLeft');
await page.waitForTimeout(100);
ok(!(await shown('dockMenu')), 'Picking a half closes the menu');
ok(await page.evaluate(() => window.__calls.some(([cmd, a]) => cmd === 'snap' && a.edge === 'left')), 'and docks the window to it');
ok(await page.$eval('#dockMenuButton', (b) => b.classList.contains('on')), 'The Window button shows the window is docked');
await page.mouse.move(700, 500);
await press('Control+Shift+ArrowRight');
await page.waitForTimeout(100);
ok(await page.evaluate(() => window.__calls.some(([cmd, a]) => cmd === 'snap' && a.edge === 'right')), 'The dock shortcuts still work');

// Focus mode: the bar fades a while after you start reading, and nothing moves.
const stageTop = () => page.$eval('#stage', (s) => s.getBoundingClientRect().top);
const top = await stageTop();
const read = async () => {
  await page.mouse.move(600, 500);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(2400);
};
await page.evaluate(() => document.activeElement?.blur());
await read();
ok(await hidden(), 'The toolbar fades about two seconds into reading');
ok(await page.$eval('#bar', (b) => getComputedStyle(b).opacity) !== '1' && await stageTop() === top, 'It fades in place: the page does not move');
await page.mouse.move(600, 30);
ok(!(await hidden()), 'The pointer near the top brings it back');
await read();
await press('Alt');
ok(!(await hidden()), 'So does Alt');
await read();
ok(await hidden(), 'and it fades again');
await press('Tab');
ok(!(await hidden()) && await page.evaluate(() => document.getElementById('bar').contains(document.activeElement)), `Tabbing into the toolbar shows it (${await hidden()}, ${await active()})`);
await page.waitForTimeout(2400);
ok(!(await hidden()), 'It stays while a toolbar control has keyboard focus');
await page.evaluate(() => document.activeElement?.blur());

const stays = async (what, openIt, closeIt) => {
  await read();
  await openIt();
  await page.waitForTimeout(50);
  const back = !(await hidden());
  await page.mouse.move(600, 500);
  await page.mouse.wheel(0, 60);
  await page.waitForTimeout(2400);
  ok(back && !(await hidden()), `It comes back and stays while ${what} is open`);
  await closeIt();
  await page.waitForTimeout(50);
  await page.evaluate(() => document.activeElement?.blur());
};
await stays('Settings', () => press('Control+,'), () => press('Escape'));
await stays('find', () => press('Control+f'), () => press('Escape'));
await stays('the palette', () => press('Control+k'), () => press('Escape'));
await stays('the Review panel', () => press('Control+Shift+R'), () => press('Control+Shift+R'));
await stays('a menu', () => page.click('#viewMenuButton'), () => press('Escape'));

await page.evaluate(() => {
  const box = document.getElementById('setFocusMode');
  box.checked = false;
  box.dispatchEvent(new Event('change'));
});
await read();
ok(!(await hidden()) && await page.evaluate(() => localStorage.getItem('pdf-next.focus-mode')) === '0', 'Settings turns focus mode off, and it is remembered');
await press('Control+k');
await page.keyboard.type('hide toolbar on');
await press('Enter');
ok(await page.$eval('#setFocusMode', (b) => b.checked), 'The palette turns it back on');
await read();
ok(await hidden(), 'and the bar fades again');

// Full screen.
await press('F11');
await page.waitForTimeout(50);
ok(await page.evaluate(() => window.__fullscreen === true) && await page.$eval('#fullScreen', (b) => b.getAttribute('aria-pressed')) === 'true', 'F11 makes the window full screen');
await press('F11');
await page.waitForTimeout(50);
ok(await page.evaluate(() => window.__fullscreen === false), 'and F11 again leaves it');

// Presenting Markdown: single A4 pages, one on screen at a time.
await page.evaluate(() => { window.__pick = '/d/long.md'; });
await press('Control+o');
await page.waitForFunction(() => document.getElementById('markdown').textContent.includes('Paragraph 70'));
await page.waitForTimeout(200);
const mdScroll = await page.$eval('#markdownStage', (s) => s.scrollTop);
await press('F5');
await page.waitForTimeout(300);
const sheets = await page.$$eval('#markdown > .md-page', (s) => s.length);
ok(await page.evaluate(() => document.body.classList.contains('presenting')) && sheets > 1, `F5 presents Markdown as ${sheets} single pages`);
ok(await page.$eval('#bar', (b) => getComputedStyle(b).display) === 'none' && await page.evaluate(() => window.__fullscreen === true), 'full screen, without the toolbar');
const centred = () => page.evaluate(() => {
  const stage = document.getElementById('markdownStage').getBoundingClientRect();
  const middle = stage.top + stage.height / 2;
  return [...document.querySelectorAll('#markdown > .md-page')].findIndex((s) => { const r = s.getBoundingClientRect(); return r.top <= middle && r.bottom >= middle; });
});
const fits = await page.evaluate(() => {
  const stage = document.getElementById('markdownStage').getBoundingClientRect();
  const r = document.querySelector('#markdown > .md-page').getBoundingClientRect();
  return r.height <= stage.height && r.width <= stage.width;
});
ok(fits, 'A page fits the screen');
const first = await centred();
await press('PageDown');
const second = await centred();
await press('Space');
const third = await centred();
await press('PageUp');
ok(second === first + 1 && third === first + 2 && await centred() === first + 1, `PageDown, Space and PageUp step pages (${first}, ${second}, ${third})`);
await press('Escape');
await page.waitForTimeout(300);
ok(!(await page.evaluate(() => document.body.classList.contains('presenting'))) && await page.$eval('#markdown', (a) => !a.dataset.pages), 'Esc leaves, back to the continuous column');
ok(await page.$eval('#markdownStage', (s) => s.scrollTop) === mdScroll && await page.evaluate(() => window.__fullscreen === false), 'at the same place, out of full screen');
await close();

// Presenting a PDF: one page fitted to the screen; the view, zoom and page come back.
{
  const { page, ok, finish } = await start({ initial: '/d/three-pages.pdf' });
  const pageNo = () => page.$eval('#page', (i) => Number(i.value));
  const step = async (key) => {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    return pageNo();
  };
  await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
  await page.selectOption('#zoom', '0.75');
  await page.fill('#page', '2');
  await page.press('#page', 'Enter');
  await page.waitForTimeout(300);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('F5');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.body.classList.contains('presenting')) && await page.$eval('#bar', (b) => getComputedStyle(b).display) === 'none', 'F5 presents the PDF without the toolbar');
  const onScreen = await page.$$eval('#viewer .page', (p) => p.filter((x) => x.getClientRects().length && getComputedStyle(x).display !== 'none').length);
  const fitted = await page.evaluate(() => {
    const stage = document.getElementById('viewerContainer').getBoundingClientRect();
    const r = [...document.querySelectorAll('#viewer .page')].find((p) => p.getClientRects().length).getBoundingClientRect();
    return r.height <= stage.height + 1 && r.width <= stage.width + 1;
  });
  ok(onScreen === 1 && fitted && await pageNo() === 2, `One page at a time, fitted to the screen, on the same page (${onScreen} shown)`);
  const walk = [await step('ArrowRight'), await step('ArrowLeft'), await step('PageDown'), await step('PageDown'), await step('Space'), await step('Home'), await step('End'), await step('PageUp')];
  ok(walk.join() === '3,2,3,3,3,1,3,2', `Arrows, PageUp/PageDown (a clicker), Space, Home and End step pages (${walk})`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({
    presenting: document.body.classList.contains('presenting'),
    zoom: document.getElementById('zoom').value,
    pages: [...document.querySelectorAll('#viewer .page')].filter((x) => x.getClientRects().length).length,
    fullscreen: window.__fullscreen,
  }));
  ok(!back.presenting && back.zoom === '0.75' && back.pages === 3 && !back.fullscreen && await pageNo() === 2,
    `Esc gives back the view, zoom and page (${JSON.stringify(back)}, page ${await pageNo()})`);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('present');
  ok((await page.$$eval('#paletteList .palette-label', (l) => l.map((x) => x.textContent)))[0] === 'Present', 'The palette has Present');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.body.classList.contains('presenting')), 'and it presents');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await finish();
}
