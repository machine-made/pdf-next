// The review card: where it opens, its request buttons, and what Enter saves.
import { start } from './harness.mjs';

const { page, ok, selectText, shot, finish } = await start();
await selectText('#markdown', 'Second paragraph');
const bottom = await page.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().bottom);
await page.keyboard.press('Control+Shift+N');
await page.waitForTimeout(150);
ok(await page.$eval('#noteBox', (b) => !b.hidden), 'Review card opens');
ok(await page.$$eval('#noteRequests .request-chip', (c) => c.length) === 17, 'Card has 17 buttons in four rows');
const top = await page.$eval('#noteBox', (b) => b.getBoundingClientRect().top);
ok(Math.abs(top - bottom) < 60, `Card sits next to the selection (${Math.round(top)} vs ${Math.round(bottom)})`);
for (const request of ['ask:why', 'ask:how', 'scope:phrase', 'scope:paragraph', 'tone:jfm']) {
  await page.click(`.request-chip[data-request="${request}"]`);
}
ok(await page.evaluate(() => document.activeElement.id) === 'noteText', 'Focus stays in the note after clicks');
ok(await page.$$eval('.request-chip[aria-pressed="true"]', (c) => c.map((x) => x.dataset.request).join(',')) === 'ask:why,ask:how,scope:paragraph,tone:jfm', 'Scope swaps, others stack');
await shot('review-card', { clip: { x: 0, y: 0, width: 900, height: 420 } });
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
const saved = await page.evaluate(() => window.__store?.reviews?.[0]);
ok(saved?.action === 'request' && saved.comment === '' && saved.requests.join(',') === 'ask:why,ask:how,scope:paragraph,tone:jfm', 'Enter saves a request with the buttons, no note needed');
ok(await page.$eval('#noteBox', (b) => b.hidden), 'Card closes after saving');
ok((await page.textContent('#reviewList')).includes('Why? · How? · Paragraph · JFM style'), 'Review panel shows the buttons');
await selectText('#markdown', 'Second');
await page.keyboard.press('Control+Shift+N');
await page.waitForTimeout(150);
ok(await page.$$eval('.request-chip[aria-pressed="true"]', (c) => c.length) === 0, 'A new card starts clean');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
ok(await page.evaluate(() => window.__store.reviews.length) === 1, 'Improve with nothing on is not saved');
await page.keyboard.press('Escape');
await finish();
