// Ctrl+U: underline a selection, or toggle the raw Markdown view.
import { start } from './harness.mjs';

const { page, ok, selectText, finish } = await start();
await page.locator('#markdown').click({ position: { x: 5, y: 5 } }).catch(() => {});
await selectText('#markdown', 'brave new');
await page.keyboard.press('Control+u');
await page.waitForTimeout(300);
ok(await page.evaluate(() => window.__files['/d/a.md'].startsWith('Hello <u>brave new</u> world.')), 'Ctrl+U underlines the selection');
ok(await page.evaluate(() => document.querySelector('#markdownRaw').hidden), 'Ctrl+U with a selection does not open the raw view');
await page.evaluate(() => getSelection().removeAllRanges());
await page.keyboard.press('Control+u');
await page.waitForTimeout(100);
ok(await page.evaluate(() => !document.querySelector('#markdownRaw').hidden), 'Ctrl+U without a selection opens the raw view');
await page.keyboard.press('Control+u');
await page.waitForTimeout(200);
await page.evaluate(() => {
  const p = document.querySelector('#markdown p');
  const range = document.createRange();
  range.setStart(p.childNodes[1], 3);
  range.setEnd(p.lastChild, 3);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
});
await page.keyboard.press('Control+u');
await page.waitForTimeout(200);
ok(await page.evaluate(() => document.querySelector('#markdownRaw').hidden), 'A selection across markup does not open the raw view');
await finish();
