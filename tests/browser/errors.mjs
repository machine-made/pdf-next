// The status line when the backend refuses: opening, reading, each review
// write, a comment conflict, and a file that disappears during a rebuild.
import { start } from './harness.mjs';

const { page, ok, selectText, finish } = await start();
const settle = (ms = 300) => page.waitForTimeout(ms);
const fail = (cmd, message) => page.evaluate(([cmd, message]) => { window.__fail[cmd] = message; }, [cmd, message]);
const clear = () => page.evaluate(() => { window.__fail = {}; });
const status = () => page.evaluate(() => {
  const s = document.getElementById('status');
  return { text: s.firstChild?.textContent || '', error: s.classList.contains('error'), on: s.classList.contains('on') };
});
const shows = async (part, name) => {
  const s = await status();
  ok(s.on && s.error && s.text.includes(part), `${name} (${JSON.stringify(s.text)})`);
};

await page.evaluate(() => { window.__pick = '/d/b.md'; });
await fail('open_path', 'no such file: /d/b.md');
await page.keyboard.press('Control+o');
await settle();
await shows('no such file', 'A file that cannot be opened shows the backend error');
ok(await page.evaluate(() => document.title.startsWith('a.md')), 'and the shown file stays');
await clear();

await fail('read_markdown', 'the file is not valid UTF-8');
await page.evaluate(() => window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 5 }));
await settle();
await shows('Could not open a.md', 'A reload that cannot read the file says so');
await clear();
await page.evaluate(() => window.__emit('file-changed', { path: '/d/a.md', kind: 'missing', revision: 6 }));
await settle();
ok(await page.evaluate(() => document.body.classList.contains('file-missing') && !document.getElementById('waiting').hidden), 'A file gone mid-rebuild shows the waiting dot');
ok((await status()).text.includes('Rebuilding'), 'and says it is waiting');
await page.evaluate(() => window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 7 }));
await settle();
ok(!(await page.evaluate(() => document.body.classList.contains('file-missing'))) && (await status()).text === 'Reloaded', 'When it is back the page reloads');

await fail('append_review', 'review file is locked');
await selectText('#markdown', 'brave');
await page.keyboard.press('Control+Shift+N');
await settle(100);
await page.fill('#noteText', 'Why brave?');
await page.keyboard.press('Enter');
await settle();
await shows('review file is locked', 'A review that cannot be saved says why');
ok(await page.$eval('#noteBox', (b) => !b.hidden) && await page.$eval('#noteText', (t) => t.value) === 'Why brave?', 'and the card stays open with the comment');
await clear();
await page.keyboard.press('Enter');
await settle();
ok(await page.evaluate(() => window.__store?.reviews.length) === 1, 'Enter again saves it once the backend accepts');

await fail('update_review', 'review conflict: comment changed on disk');
await page.fill('#reviewList .review-row .review-comment', 'Why so brave?');
await page.click('#markdown', { position: { x: 5, y: 5 } });
await settle(500);
await shows('changed on disk; your draft is preserved', 'A comment conflict keeps the draft and says so');
ok(await page.$eval('#reviewList .review-row .review-comment', (t) => t.value) === 'Why so brave?', 'The draft is still in the panel');
await clear();

await fail('delete_review', 'permission denied');
await page.click('#reviewList .review-row button:has-text("Remove review")');
await settle();
await shows('permission denied', 'A removal the backend refuses says why');
ok(await page.evaluate(() => window.__store.reviews.length) === 1, 'and the review stays');
await clear();

await fail('patch_review', 'review conflict: status changed on disk');
await page.evaluate(() => {
  window.__store.reviews[0].status = 'applied';
  window.__store.revision += 1;
  window.__emit('reviews-changed', { path: '/d/a.md' });
});
await settle();
await page.click('#reviewList .review-row button:has-text("Resolve")');
await settle();
await shows('Review update failed', 'A status change the backend refuses says so');
await clear();

await fail('edit_markdown', 'the file changed on disk');
await selectText('#markdown', 'world');
await page.keyboard.press('Control+i');
await settle();
await shows('Could not edit the file', 'A direct edit the backend refuses says so');
await clear();

await page.evaluate(() => { document.getElementById('status').classList.remove('on'); });
await fail('read_reviews', 'disk is full');
await page.evaluate(() => window.__emit('reviews-changed', { path: '/d/a.md' }));
await settle();
await shows('Review data temporarily unavailable', 'Reviews that cannot be read keep the panel and say so');
ok(await page.$$eval('#reviewList .review-row', (r) => r.length) === 1, 'The panel keeps the reviews it had');
await clear();

const before = await page.evaluate(() => window.__calls.length);
await page.evaluate(() => { document.getElementById('status').classList.remove('on'); });
await page.evaluate(() => window.__emit('file-changed', { path: '/d/elsewhere.md', kind: 'changed', revision: 8 }));
await settle();
ok(!(await status()).on && await page.evaluate((n) => window.__calls.length === n, before), 'A change to another file is ignored');
await finish();
