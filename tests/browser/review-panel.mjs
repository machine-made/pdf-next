// The review panel after an agent has worked: the saved `before`, the
// before/after diff of applied items, Resolve and Reopen with a note, and
// agent questions answered with Send.
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

await editStore((st) => { st.reviews[0].status = 'applied'; st.reviews[0].resolution = 'reworded'; });
await changeFile('Hello brave new world.\n\nSecond paragraph is changed now.\n');
ok(await row('r1').locator('.review-diff').count() === 1, 'An applied item shows a before/after');
const ins = await row('r1').locator('.review-diff ins').allTextContents();
const del = await row('r1').locator('.review-diff del').allTextContents();
ok(ins.join('|').includes('is changed now') && del.join('|').includes('here'), `The diff marks words in (${ins.join('|')}) and out (${del.join('|')})`);
ok(/1 word out, 3 in/.test(await row('r1').locator('.review-diff-head').textContent()), 'The diff head counts the words');
await shot('review-diff', { clip: { x: 1100, y: 0, width: 400, height: 600 } });
await row('r1').getByRole('button', { name: 'Resolve' }).click();
await page.waitForTimeout(200);
ok(await page.evaluate(() => window.__store.reviews[0].status) === 'resolved', 'Resolve marks the item resolved');
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
await editStore((st) => { st.reviews[0].status = 'applied'; });
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

await editStore((st) => { st.reviews[0].status = 'applied'; });
await changeFile('Hello brave new world.\n');
ok(/gone from the file/.test(await row('r1').locator('.review-diff-head').textContent()) &&
  (await row('r1').locator('.review-diff del').textContent()) === 'Second paragraph here.', 'A passage that is gone shows its before as removed');

await changeFile('Hello brave new world.\n\nSecond paragraph here.\n');
await editStore((st) => {
  st.reviews[0].status = 'question';
  st.reviews[0].question = 'Which paragraph do you mean?';
  st.reviews.push({ ...st.reviews[0], id: 'r9', status: 'open', question: undefined, quote: 'Hello' });
  st.nextId = 10;
});
ok(await row('r1').evaluate((r) => r.classList.contains('question')), 'A question item stands out in the panel');
ok((await row('r1').locator('.review-question').textContent()).includes('Which paragraph do you mean?'), 'The agent question is shown');
ok((await page.textContent('#reviewCount')).includes('1 question'), 'The panel head counts questions');
ok(await page.$eval('#markdown .review-no[data-review-id="r1"]', (b) => b.dataset.reviewStatus === 'question'), 'The highlight badge marks the question');
await page.selectOption('#reviewStatusFilter', 'question');
await page.waitForTimeout(100);
ok(await page.$$eval('.review-row', (rows) => rows.map((r) => r.dataset.reviewId).join(',')) === 'r1', 'The Question filter shows only questions');
// The agent rewords its question while the reader types: the old answer is not sent.
await row('r1').locator('.review-reply').fill('The second one');
await page.evaluate(() => { window.__store.reviews[0].question = 'Which one, the first or the second?'; window.__store.revision += 1; });
await row('r1').getByRole('button', { name: 'Send' }).click();
await page.waitForTimeout(250);
ok(await page.evaluate(() => window.__store.reviews[0].status) === 'question', 'A reply to a question that changed meanwhile is refused');
ok((await row('r1').locator('.review-question').textContent()).includes('first or the second'), 'and the new question is shown');
ok(await row('r1').locator('.review-reply').inputValue() === 'The second one', 'and the typed answer is kept');
// Another item changes (the agent closes one): the answer still goes through.
await page.evaluate(() => { window.__store.reviews[1].status = 'applied'; window.__store.revision += 1; });
await row('r1').getByRole('button', { name: 'Send' }).click();
await page.waitForTimeout(250);
const answered = await page.evaluate(() => window.__store.reviews[0]);
ok(answered.reply === 'The second one' && answered.status === 'open', `A reply is not refused because another item changed (${answered.status})`);
ok(await page.evaluate(() => window.__calls.filter(([c]) => c === 'patch_review').at(-1)[1].expected.question === 'Which one, the first or the second?'), 'Send checks the question it answers');
await page.selectOption('#reviewStatusFilter', 'all');
await page.waitForTimeout(100);
ok((await row('r1').locator('.review-reply-text').textContent()).includes('The second one'), 'The reply shows under the item');
ok(!(await page.textContent('#reviewCount')).includes('question'), 'No question left in the head count');

// Many applied items whose quotes are gone: the panel compares each passage once, not on every repaint.
const words = (n, salt) => Array.from({ length: n }, (_, i) => `w${(i * salt) % 911}`).join(' ');
await changeFile(`${words(500, 7)}.\n`);
const many = Array.from({ length: 25 }, (_, i) => ({
  id: `r${i + 1}`, file: 'a.md', kind: 'markdown', at: { line: 1 }, quote: 'gone from the text', action: 'polish',
  status: 'applied', resolution: 'rewrote', before: `${words(500, 11 + i)}.`, anchor: { prefix: 'nothing here', suffix: 'nor here' },
}));
await page.evaluate((reviews) => {
  Object.assign(window.__store, { reviews, nextId: 26, revision: window.__store.revision + 1 });
  window.__emit('reviews-changed', { path: '/d/a.md' });
}, many);
await page.waitForTimeout(2000);
const repaint = () => page.evaluate(async () => {
  const filter = document.getElementById('reviewStatusFilter');
  const started = performance.now();
  for (const value of ['applied', 'all']) {
    filter.value = value;
    filter.dispatchEvent(new Event('change'));
  }
  return performance.now() - started;
});
await repaint();
const took = await repaint();
ok(await page.locator('.review-diff').count() === 25 && took < 300, `Repainting 25 applied before/afters reuses their diffs (${took.toFixed(0)} ms)`);
await finish();
