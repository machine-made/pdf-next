// The review flow end to end on Markdown: a review with each action, editing
// a comment, filters, remove and Undo, reattach by picking, and marks that
// follow the text when the file changes under them.
import { start } from './harness.mjs';

const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike'];
const raw = `${words.map((w) => `The ${w} paragraph says ${w} things.`).join('\n\n')}\n`;
const { page, ok, selectText, finish } = await start({ files: { '/d/a.md': raw } });
const store = () => page.evaluate(() => window.__store);
const rows = () => page.$$eval('#reviewList .review-row', (r) => r.map((x) => x.dataset.reviewId));
const settle = (ms = 250) => page.waitForTimeout(ms);
const status = () => page.textContent('#status');

const actions = ['improve', 'polish', 'clarify', 'shorten', 'expand', 'check', 'define', 'gloss', 'bold', 'italic', 'delete'];
for (const [i, action] of actions.entries()) {
  await selectText('#markdown', `${words[i]} things`);
  await page.keyboard.press('Control+Shift+N');
  await settle(100);
  await page.selectOption('#noteAction', action);
  if (action === 'improve') {
    await page.keyboard.press('Enter');
    await settle(100);
    ok(await page.$eval('#noteBox', (b) => !b.hidden) && (await status()).includes('Add an instruction'), 'Improve without words or buttons is not saved');
    await page.fill('#noteText', 'Say it better');
  }
  await page.click('#noteSave');
  await settle();
}
await selectText('#markdown', `${words[11]} things`);
await page.keyboard.press('Control+Shift+N');
await settle(100);
await page.click('.request-chip[data-request="ask:why"]');
await page.keyboard.press('Enter');
await settle();
let saved = (await store()).reviews;
ok(saved.length === 12, `Twelve reviews saved (${saved.length})`);
ok(saved.map((r) => r.action).join() === [...actions, 'request'].join(), 'Each with its action');
ok(saved.every((r, i) => r.quote === `${words[i]} things` && r.at.line === 1 + 2 * i), 'Each with its quote and source line');
ok(saved.every((r) => r.anchor?.prefix && r.anchor?.documentRevision), 'Each with context and the document revision');
ok(saved.every((r) => r.status === 'open' && r.file === 'a.md' && r.kind === 'markdown'), 'All open, on a.md');
ok(saved[0].comment === 'Say it better' && saved.slice(1).every((r) => r.comment === ''), 'Only the improve review has a comment');
ok(new Set(saved.map((r) => r.id)).size === 12, 'IDs are unique');
ok(await page.$eval('#reviewPane', (p) => !p.hidden), 'Saving opens the review panel');
ok((await rows()).length === 12 && await page.textContent('#reviewCount') === '12/12', 'The panel lists all twelve');
ok(await page.$$eval('#markdown mark.review', (m) => m.length) >= 12, 'Each review marks its text');
ok(await page.$eval('#reviewList .review-row[data-review-id="r11"] .review-action-label', (l) => l.textContent) === 'Delete selection', 'The row says its action');

await page.fill('#reviewList .review-row[data-review-id="r2"] .review-comment', 'Fewer words');
await page.click('#markdown', { position: { x: 5, y: 5 } });
await settle(400);
saved = (await store()).reviews;
ok(saved[1].comment === 'Fewer words', 'Editing a comment in the panel saves it');
ok(await page.evaluate(() => window.__calls.some((c) => c[0] === 'update_review' && c[1].id === 'r2' && c[1].expectedComment === '')), 'The save says what it expects on disk');

await page.selectOption('#reviewActionFilter', 'delete');
await settle(100);
ok((await rows()).join() === 'r11' && await page.textContent('#reviewCount') === '1/12', 'Filter by action: Delete shows one');
await page.selectOption('#reviewActionFilter', 'request');
await settle(100);
ok((await rows()).join() === 'r12', 'Filter by action: Request');
await page.selectOption('#reviewActionFilter', 'all');
await page.evaluate(() => {
  window.__store.reviews[2].status = 'applied';
  window.__store.reviews[3].status = 'resolved';
  window.__store.revision += 1;
  window.__emit('reviews-changed', { path: '/d/a.md' });
});
await settle(300);
await page.selectOption('#reviewStatusFilter', 'applied');
await settle(100);
ok((await rows()).join() === 'r3', 'An agent write shows up; filter by status: Applied');
ok(await page.$eval('#reviewList .review-row[data-review-id="r3"]', (r) => [...r.querySelectorAll('button')].map((b) => b.textContent).includes('Resolve')), 'An applied review offers Resolve');
await page.click('#reviewList .review-row[data-review-id="r3"] button:has-text("Resolve")');
await settle();
ok((await store()).reviews[2].status === 'resolved' && (await rows()).length === 0, 'Resolve resolves it, and the Applied filter empties');
ok(await page.textContent('#reviewList') === 'No reviews match these filters.', 'An empty filter says so');
await page.selectOption('#reviewStatusFilter', 'resolved');
await settle(100);
ok((await rows()).join() === 'r3,r4', 'Filter by status: Resolved');
await page.click('#reviewList .review-row[data-review-id="r4"] button:has-text("Reopen")');
await settle(100);
await page.keyboard.type('Not checked yet');
await page.keyboard.press('Enter');
await settle();
ok((await store()).reviews[3].status === 'open' && (await store()).reviews[3].comment === 'Reopened: Not checked yet', 'Reopen with a note puts it back to open');
await page.selectOption('#reviewStatusFilter', 'open');
await settle(100);
ok((await rows()).length === 11, 'Filter by status: Open');
await page.selectOption('#reviewStatusFilter', 'all');

await page.click('#reviewList .review-row[data-review-id="r5"] button:has-text("Remove review")');
await settle();
ok(!(await store()).reviews.some((r) => r.id === 'r5') && !(await rows()).includes('r5'), 'Remove review removes it at once');
ok((await status()).includes('Review r5 removed') && await page.$('#status .status-action') !== null, 'The status line offers Undo');
await page.click('#markdown', { position: { x: 5, y: 5 } });
await page.keyboard.press('Control+z');
await settle();
saved = (await store()).reviews;
ok(saved.some((r) => r.id === 'r5' && r.action === 'expand' && r.quote === 'echo things'), 'Ctrl+Z restores it with the same ID and fields');
ok(saved.map((r) => r.id).join() === 'r1,r2,r3,r4,r5,r6,r7,r8,r9,r10,r11,r12', 'in its old place');
await page.keyboard.press('Control+z');
await settle();
ok(!(await store()).reviews.some((r) => r.id === 'r11'), 'A second Ctrl+Z takes back the Delete review made earlier');
await page.keyboard.press('Control+z');
await settle();
ok((await store()).reviews.some((r) => r.id === 'r11'), 'That removal is itself undoable');
await page.keyboard.press('Control+z');
await settle(150);
ok((await status()).includes('Nothing to undo'), 'Then there is nothing left to undo');
await page.click('#reviewList .review-row[data-review-id="r6"] button:has-text("Remove review")');
await settle();
await page.click('#status .status-action');
await settle();
ok((await store()).reviews.some((r) => r.id === 'r6'), 'The Undo button restores too');
const ids = (await store()).nextId;
ok(ids === 13, `Restoring does not issue new IDs (nextId ${ids})`);

await page.evaluate(() => getSelection().removeAllRanges());
await page.click('#reviewList .review-row[data-review-id="r1"] button:has-text("Reattach")');
await settle(100);
ok(await page.evaluate(() => document.body.classList.contains('reattach-picking')) && (await status()).includes('Select the new text for r1'), 'Reattach with no selection waits for one');
await page.keyboard.press('Escape');
await settle(100);
ok(!(await page.evaluate(() => document.body.classList.contains('reattach-picking'))), 'Esc cancels the pick');
await page.click('#reviewList .review-row[data-review-id="r1"] button:has-text("Reattach")');
await settle(100);
const box = await page.evaluate(() => {
  const walk = document.createTreeWalker(document.getElementById('markdown'), NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) {
    const at = walk.currentNode.textContent.indexOf('The mike paragraph');
    if (at >= 0) {
      const range = document.createRange();
      range.setStart(walk.currentNode, at + 4);
      range.setEnd(walk.currentNode, at + 18);
      const r = range.getBoundingClientRect();
      return { x0: r.left + 1, x1: r.right - 1, y: r.top + r.height / 2 };
    }
  }
  return null;
});
await page.mouse.move(box.x0, box.y);
await page.mouse.down();
await page.mouse.move(box.x1, box.y, { steps: 8 });
await page.mouse.up();
await settle(400);
const moved = (await store()).reviews[0];
ok(moved.quote === 'mike paragraph' && moved.at.line === 25, `Picking new text reattaches the review (${moved.quote}, line ${moved.at.line})`);
ok(moved.comment === 'Say it better' && moved.action === 'improve', 'and keeps its comment and action');

await page.evaluate(() => {
  window.__files['/d/a.md'] = `A new first paragraph.\n\n${window.__files['/d/a.md']}`;
  window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 7 });
});
await settle(1000);
const mark = await page.$eval('#reviewList .review-row[data-review-id="r9"]', (r) => r.dataset.reviewId).catch(() => null);
const marked = await page.$$eval('#markdown mark.review', (m) => m.map((x) => x.textContent));
ok(mark && marked.includes('india things'), 'After the file changes, marks find their text again');
const healed = (await store()).reviews.find((r) => r.id === 'r9');
ok(healed.at.line === 19, `The review's line follows the text (17 -> ${healed.at.line})`);
ok(await page.evaluate(() => window.__calls.filter((c) => c[0] === 'patch_review' && c[1].patch.at).length) >= 12, 'Every moved review is healed with a compare-and-swap patch');
await finish();
