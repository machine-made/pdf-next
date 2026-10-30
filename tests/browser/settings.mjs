// Settings: each control takes effect and is still set after a reload.
// Theme and page modes: the OS theme, theme-changed, and the mode button.
import { start } from './harness.mjs';

const { page, ok, finish } = await start({ theme: 'dark' });
const choose = (id, value) => page.evaluate(([id, value]) => {
  const s = document.getElementById(id);
  s.value = value;
  s.dispatchEvent(new Event('change'));
}, [id, value]);
const css = (selector, property) => page.$eval(selector, (e, p) => getComputedStyle(e).getPropertyValue(p), property);
const body = (name) => page.evaluate((name) => document.body.classList.contains(name), name);

ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'The OS theme is applied at start');
const darkBg = await css('body', 'background-color');
await page.evaluate(() => window.__emit('theme-changed', 'light'));
await page.waitForTimeout(100);
ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'light' && await css('body', 'background-color') !== darkBg, 'theme-changed switches the window to light');

const mdBg = () => css('#markdown', 'background-color');
const plain = await mdBg();
ok(await body('mode-auto') && await page.$eval('#mode', (b) => b.getAttribute('aria-pressed')) === 'false', 'No page mode at first');
const seen = [];
for (const expected of ['night', 'invert', 'sepia']) {
  await page.click('#mode');
  await page.waitForTimeout(50);
  seen.push(await body(`mode-${expected}`) ? expected : '?');
}
ok(seen.join() === 'night,invert,sepia', `The mode button cycles night, invert, sepia (${seen})`);
ok(await page.$eval('#mode', (b) => b.getAttribute('aria-pressed')) === 'true', 'and shows as pressed');
const sepia = await mdBg();
ok(sepia === 'rgb(244, 236, 216)' && sepia !== plain, `Sepia colours the Markdown page (${sepia})`);
await page.click('#mode');
await page.waitForTimeout(50);
ok(await body('mode-auto') && await mdBg() === plain, 'One more press is plain pages again');
await page.click('#mode');
await page.click('#mode', { modifiers: ['Shift'] });
await page.waitForTimeout(50);
ok(await body('mode-auto'), 'Shift+click clears the mode');
await page.click('#mode');
await page.waitForTimeout(50);
ok(await mdBg() === 'rgb(27, 27, 27)', 'Night darkens the Markdown page');

await page.click('#settingsToggle');
await page.waitForTimeout(100);
ok(await page.$eval('#settingsPanel', (p) => !p.hidden) && await page.$eval('#settingsToggle', (b) => b.getAttribute('aria-pressed')) === 'true', 'The Settings button opens the panel');
ok(await page.textContent('#aboutVersion') === 'Version 0.0.0-test', 'About shows the version');
const picks = {
  setFont: 'serif', setSize: '22', setWidth: '900', setPoll: '3',
  setFigWidth: '75', setFigHeight: 'half', setFigAlign: 'left', setFigCaption: 'plain',
  setUiFont: 'mm-sans', setCodeFont: 'monaspace-xenon',
};
for (const [id, value] of Object.entries(picks)) await choose(id, value);
await page.uncheck('#setDirectEdits');
await page.waitForTimeout(300);
ok(await page.$eval('#mdFont', (s) => s.value) === 'serif' && await page.$eval('#mdSize', (s) => s.value) === '22' && await page.$eval('#mdWidth', (s) => s.value) === '900', 'Font, size and width reach the toolbar menus');
ok(await page.$eval('#markdown', (a) => [a.dataset.font, a.dataset.size, a.dataset.width].join()) === 'serif,22,900', 'and the article');
ok(await page.$eval('#poll', (s) => s.value) === '3', 'Check for changes reaches the toolbar');
ok(await page.evaluate(() => window.__calls.some((c) => c[0] === 'set_poll_seconds' && c[1].seconds === 3)), 'and the backend watcher');
ok(await page.$eval('#markdown', (a) => [a.dataset.figWidth, a.dataset.figHeight, a.dataset.figAlign, a.dataset.figCaption].join()) === '75,half,left,plain', 'Figure settings reach the article');
ok(await page.evaluate(() => [document.documentElement.dataset.uiFont, document.documentElement.dataset.codeFont].join()) === 'mm-sans,monaspace-xenon', 'Interface and code fonts are set on the page');
ok((await css('#bar', 'font-family')).includes('machine-made Sans'), 'The toolbar is set in mm Sans');
await page.keyboard.press('Escape');
await page.waitForTimeout(50);
ok(await page.$eval('#settingsPanel', (p) => p.hidden), 'Esc closes Settings');
await page.keyboard.press('Control+,');
await page.waitForTimeout(50);
ok(await page.$eval('#settingsPanel', (p) => !p.hidden), 'Ctrl+, opens it');
await page.mouse.click(300, 600);
await page.waitForTimeout(50);
ok(await page.$eval('#settingsPanel', (p) => p.hidden), 'A click outside closes it');
await page.keyboard.press('Control+Shift+R');
await page.click('#reviewSizeUp');
await page.click('#reviewSizeUp');
await page.waitForTimeout(50);
const reviewSize = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--review-size'));
await page.keyboard.press('Control+u');
await page.waitForTimeout(50);

await page.reload();
await page.waitForSelector('#markdownRaw:not([hidden])');
await page.waitForTimeout(300);
await page.click('#settingsToggle');
await page.waitForTimeout(100);
const after = {};
for (const id of Object.keys(picks)) after[id] = await page.$eval(`#${id}`, (s) => s.value);
const kept = Object.entries(picks).filter(([id, value]) => after[id] === value).map(([id]) => id);
ok(kept.length === Object.keys(picks).length, `Every Settings menu is kept after a reload (${kept.length}/${Object.keys(picks).length}: ${JSON.stringify(after)})`);
ok(!(await page.$eval('#setDirectEdits', (c) => c.checked)), 'Edit the file in place stays off');
ok(await page.$eval('#markdown', (a) => [a.dataset.font, a.dataset.size, a.dataset.width, a.dataset.figWidth].join()) === 'serif,22,900,75', 'The article comes back styled');
ok(await page.evaluate(() => window.__calls.some((c) => c[0] === 'set_poll_seconds' && c[1].seconds === 3)), 'The watcher is set to the saved interval at start');
ok(await body('mode-night'), 'The page mode is kept');
ok(await page.$eval('#raw', (b) => b.getAttribute('aria-pressed')) === 'true', 'The raw view is kept');
ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--review-size')) === reviewSize, `The review text size is kept (${reviewSize})`);
await page.evaluate(() => localStorage.setItem('pdf-next.md-size', '999'));
await page.reload();
await page.waitForTimeout(500);
ok(await page.$eval('#mdSize', (s) => s.value) === '17', 'An unknown saved size falls back to the default');
await finish();
