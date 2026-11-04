// The inbox (0.19): pdf-next closes a Markdown comment itself when the file
// changes and its quoted text is removed or edited; a comment whose text is
// still there stays open. The panel has no question flow and no Resolve.
// The mock backend settles the store before it announces `file-changed`, as
// the Rust watcher does; see `settleStore` in harness.mjs.
import { start } from './harness.mjs';

const wake = [
  'The wake behind the cylinder sheds vortices at a steady frequency downstream of the body.',
  'The flow stays laminar below the critical Reynolds number and unsteady above it.',
  'A third paragraph about stability and its growth rate near onset of shedding.',
];
const files = { '/d/a.md': `${wake.join('\n\n')}\n` };
const { page, ok, selectText, finish } = await start({ files });
const row = (id) => page.locator(`.review-row[data-review-id="${id}"]`);
const store = () => page.evaluate(() => window.__store);
const changeFile = async (text) => {
  await page.evaluate((text) => {
    window.__files['/d/a.md'] = text;
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: Date.now() });
  }, text);
  await page.waitForTimeout(500);
};
const review = async (quote) => {
  await selectText('#markdown', quote);
  await page.keyboard.press('Control+Shift+N');
  await page.waitForTimeout(150);
  await page.keyboard.type('reword this');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
};

await review('steady frequency');
await review('laminar below the critical');
await review('growth rate near onset');
ok((await store()).reviews.map((r) => `${r.id}:${r.status}`).join() === 'r1:open,r2:open,r3:open', 'Three open comments');

// An edit elsewhere in the file: every quote is still there, every comment stays open.
await changeFile(`${wake.join('\n\n')}\n\nA closing line.\n`);
ok((await store()).reviews.every((r) => r.status === 'open'), 'A change that leaves the quoted text alone closes nothing');

// The second paragraph is edited inside the quote, then the first one is deleted.
await changeFile([wake[0], wake[1].replace('laminar below the critical', 'laminar well below the critical'), wake[2]].join('\n\n') + '\n');
await changeFile([wake[1].replace('laminar below the critical', 'laminar well below the critical'), wake[2]].join('\n\n') + '\n');
const after = await store();
const byId = (id) => after.reviews.find((r) => r.id === id);
ok(byId('r1').status === 'done' && /removed/.test(byId('r1').resolution), `A deleted quote closes its comment (${byId('r1').status}, ${byId('r1').resolution})`);
ok(byId('r2').status === 'done' && /edited/.test(byId('r2').resolution), `An edited quote closes its comment (${byId('r2').status}, ${byId('r2').resolution})`);
ok(byId('r3').status === 'open', 'An unchanged quote stays open');
await page.evaluate(() => window.__emit('reviews-changed', { path: '/d/a.md' }));
await page.waitForTimeout(300);
ok((await row('r1').locator('.review-status').textContent()).startsWith('done') &&
  (await row('r2').locator('.review-status').textContent()).startsWith('done') &&
  (await row('r3').locator('.review-status').textContent()) === 'open', 'The panel shows done and open');
ok((await page.textContent('#reviewCount')) === '3/3 · 2 done', `The head counts the done comments (${await page.textContent('#reviewCount')})`);

// No question flow, no Resolve.
ok(await page.locator('.review-question, .review-reply, .review-reply-box, .review-question-count').count() === 0, 'No question control is in the panel');
ok(await page.locator('#reviewList button', { hasText: /^(Send|Resolve)$/ }).count() === 0, 'No Send or Resolve button');
ok((await page.$$eval('#reviewStatusFilter option', (options) => options.map((o) => o.value))).join() === 'all,open,done', 'The status filter is All, Open, Done');
// A store written by an older version could still carry a question: it reads as open.
await page.evaluate(() => {
  window.__store.reviews[2].status = 'question';
  window.__store.revision += 1;
  window.__emit('reviews-changed', { path: '/d/a.md' });
});
await page.waitForTimeout(300);
ok(await row('r3').getAttribute('data-status') === 'open' && await page.locator('.review-question').count() === 0, 'An unknown status reads as open and shows no question');

// Reopen puts a done comment back to open with the reader's note.
await row('r2').getByRole('button', { name: 'Reopen' }).click();
await page.keyboard.type('Still unclear');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const reopened = (await store()).reviews.find((r) => r.id === 'r2');
ok(reopened.status === 'open' && reopened.comment.endsWith('Reopened: Still unclear'), `Reopen works (${reopened.status}, ${JSON.stringify(reopened.comment)})`);
ok(await row('r2').getAttribute('data-status') === 'open', 'and the row is open again');
// The Done button: the reader closes an open comment, and it is the reader's close.
ok(await row('r1').getByRole('button', { name: 'Done' }).count() === 0, 'A done comment has no Done button');
ok((await store()).reviews.find((r) => r.id === 'r1').closedBy === 'pdf-next', 'A comment pdf-next closed carries closedBy');
await row('r3').getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(300);
const closed = (await store()).reviews.find((r) => r.id === 'r3');
ok(closed.status === 'done' && closed.closedBy === undefined, `Done closes an open comment without closedBy (${closed.status}, ${closed.closedBy})`);
ok(await row('r3').getAttribute('data-status') === 'done' && await row('r3').getByRole('button', { name: 'Reopen' }).count() === 1, 'The row shows done and offers Reopen');
await row('r3').getByRole('button', { name: 'Reopen' }).click();
await page.keyboard.type('Not yet');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
ok((await store()).reviews.find((r) => r.id === 'r3').status === 'open', 'Reopen brings it back');

// A save the backend refuses: the reason is in the status line and the comment stays open. This is a generic patch
// failure; the PDF rule (a PDF comment closes only after a successful build) is the Rust tests' (main.rs) and the
// mock's patch_review.
await page.evaluate(() => { window.__fail.patch_review = 'the review store could not be written: disk full'; });
await row('r3').getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(300);
ok(/disk full/.test(await page.textContent('#status')) && await page.$eval('#status', (el) => el.classList.contains('error')),
  `A refused save is shown as an error (${await page.textContent('#status')})`);
ok((await store()).reviews.find((r) => r.id === 'r3').status === 'open', 'and the comment stays open');
await page.evaluate(() => { window.__fail = {}; });

// The store is saved but a file of someone else's stands where the inbox goes.
const warning = "wake_review.txt is not pdf-next's inbox; move it so the agent can read the comments";
await page.evaluate((text) => { window.__inboxWarning = text; }, warning);
await row('r3').getByRole('button', { name: 'Done' }).click();
await page.waitForTimeout(400);
ok((await page.textContent('#status')) === warning && await page.$eval('#status', (el) => el.classList.contains('error')),
  `The foreign inbox file is named in the status line (${await page.textContent('#status')})`);
ok((await store()).reviews.find((r) => r.id === 'r3').status === 'done', 'and the save went through');
await page.evaluate(() => { window.__inboxWarning = null; });

// A comment whose quote was never seen in place (a store from before 0.19) is never closed by pdf-next: it is marked
// unverifiable and stays open, even though its text is not in the file.
await page.evaluate(() => {
  window.__store.reviews.push({
    id: 'r9', file: 'a.md', kind: 'markdown', at: { line: 1 }, quote: 'a sentence that was never here', comment: '',
    action: 'improve', status: 'open', resolution: '', color: 1, anchor: { documentRevision: 'sha256:old' },
  });
});
await changeFile(`${wake[1]}\n\nA closing line.\n`);
const unseen = (await store()).reviews.find((r) => r.id === 'r9');
ok(unseen.status === 'open' && unseen.unverifiable === true && !unseen.verifiedDigest,
  `A quote never seen in place is not closed (${unseen.status}, unverifiable ${unseen.unverifiable})`);
await finish();
