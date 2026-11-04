// The review panel after an agent has worked: the saved `before`, the
// before/after diff of done items, and Reopen with a note.
import { start } from './harness.mjs';

const { page, ok, selectText, shot, finish } = await start();
const row = (id) => page.locator(`.review-row[data-review-id="${id}"]`);
const changeFile = async (text) => {
  await page.evaluate((text) => {
    window.__files['/d/a.md'] = text;
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: Date.now() });
  }, text);
  await page.waitForTimeout(400);
};
const editStore = async (change) => {
  await page.evaluate((source) => {
    (0, eval)(source)(window.__store);
    window.__store.revision += 1;
    window.__emit('reviews-changed', { path: '/d/a.md' });
  }, change.toString());
  await page.waitForTimeout(250);
};

await selectText('#markdown', 'Second paragraph');
await page.keyboard.press('Control+Shift+N');
await page.waitForTimeout(150);
ok(await page.$eval('#noteRequests .request-group', (g) => /rewrites it so it answers/.test(g.title)), 'The Ask row says Ask means rewrite the text');
ok(await page.$eval('.request-chip[data-request="ask:why"]', (c) => /rewrites/.test(c.title)), 'Each Ask button carries the hint');
await page.click('.request-chip[data-request="ask:why"]');
await page.keyboard.press('Enter');
await page.waitForTimeout(250);
ok(await page.evaluate(() => window.__store.reviews[0].before) === 'Second paragraph here.', 'A new Markdown review saves the source of its passage as before');

await editStore((st) => { st.reviews[0].status = 'done'; st.reviews[0].resolution = 'reworded'; });
await changeFile('Hello brave new world.\n\nSecond paragraph is changed now.\n');
ok(await row('r1').locator('.review-diff').count() === 1, 'A done item shows a before/after');
const ins = await row('r1').locator('.review-diff ins').allTextContents();
const del = await row('r1').locator('.review-diff del').allTextContents();
ok(ins.join('|').includes('is changed now') && del.join('|').includes('here'), `The diff marks words in (${ins.join('|')}) and out (${del.join('|')})`);
ok(/1 word out, 3 in/.test(await row('r1').locator('.review-diff-head').textContent()), 'The diff head counts the words');
await shot('review-diff', { clip: { x: 1100, y: 0, width: 400, height: 600 } });
ok(await row('r1').getByRole('button', { name: 'Resolve' }).count() === 0, 'There is no Resolve button: pdf-next closes comments itself');
await row('r1').getByRole('button', { name: 'Reopen' }).click();
await page.waitForTimeout(100);
ok(await page.evaluate(() => document.activeElement?.className) === 'review-reopen-note', 'Reopen asks for a note');
await page.keyboard.type('Still too vague');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const reopened = await page.evaluate(() => window.__store.reviews[0]);
ok(reopened.status === 'open' && reopened.comment === 'Reopened: Still too vague', `Reopen puts the note in the comment and the item back to open (${reopened.status}, ${reopened.comment})`);
ok(await page.evaluate(() => window.__calls.some(([c, a]) => c === 'update_review' && a.comment === 'Reopened: Still too vague')), 'The note is saved with update_review');

// A reopen whose status write fails keeps the note once when sent again.
await editStore((st) => { st.reviews[0].status = 'done'; });
await page.evaluate(() => { window.__fail.patch_review = 'review file is locked'; });
await row('r1').getByRole('button', { name: 'Reopen' }).click();
await page.keyboard.type('Cite it');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
await page.evaluate(() => { window.__fail = {}; });
await row('r1').locator('.review-reopen-note').press('Enter');
await page.waitForTimeout(300);
const again = await page.evaluate(() => window.__store.reviews[0]);
ok(again.status === 'open' && again.comment === 'Reopened: Still too vague\nReopened: Cite it', `A retried reopen adds its note once (${JSON.stringify(again.comment)})`);

await editStore((st) => { st.reviews[0].status = 'done'; });
await changeFile('Hello brave new world.\n');
ok(/gone from the file/.test(await row('r1').locator('.review-diff-head').textContent()) &&
  (await row('r1').locator('.review-diff del').textContent()) === 'Second paragraph here.', 'A passage that is gone shows its before as removed');

// Many done items whose quotes are gone: the panel compares each passage once, not on every repaint.
const words = (n, salt) => Array.from({ length: n }, (_, i) => `w${(i * salt) % 911}`).join(' ');
await changeFile(`${words(500, 7)}.\n`);
const many = Array.from({ length: 25 }, (_, i) => ({
  id: `r${i + 1}`, file: 'a.md', kind: 'markdown', at: { line: 1 }, quote: 'gone from the text', action: 'polish',
  status: 'done', resolution: 'rewrote', before: `${words(500, 11 + i)}.`, anchor: { prefix: 'nothing here', suffix: 'nor here' },
}));
await page.evaluate((reviews) => {
  Object.assign(window.__store, { reviews, nextId: 26, revision: window.__store.revision + 1 });
  window.__emit('reviews-changed', { path: '/d/a.md' });
}, many);
await page.waitForTimeout(2000);
const repaint = () => page.evaluate(async () => {
  const filter = document.getElementById('reviewStatusFilter');
  const started = performance.now();
  for (const value of ['done', 'all']) {
    filter.value = value;
    filter.dispatchEvent(new Event('change'));
  }
  return performance.now() - started;
});
await repaint();
const took = await repaint();
ok(await page.locator('.review-diff').count() === 25 && took < 300, `Repainting 25 done before/afters reuses their diffs (${took.toFixed(0)} ms)`);
await finish();
