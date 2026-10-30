// Where the 0.18 features meet: presentation with the palette, the outline,
// zoom gestures, remembered places and tab switches.
import { start } from './harness.mjs';

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
