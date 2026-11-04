// Caret editing in the rendered Markdown view: a click puts a caret, typing,
// Space, Backspace and Delete change the .md one character at a time, Ctrl+Z
// undoes typing as steps, writes run one at a time through a queue, math, code,
// links and tables are skipped, and the right-click delete is named apart from
// the request to the agent.
import { createHash } from 'node:crypto';
import { start } from './harness.mjs';

const raw = 'Hello brave new world.\n\nSecond paragraph here.\n\nSame sentence. Same sentence.\n';
// A file in the { raw, html } form: math, a link, a code block and a table.
const rich = {
  raw: 'Hello brave new world.\n\nSee [the link](https://example.com) now.\n\nEnergy $E = mc^2$ here.\n\n```\nlet code = 1;\n```\n\n| a | b |\n|---|---|\n| cell | two |\n',
  html: [
    '<p><span class="src" data-line="1"></span>Hello brave new world.</p>',
    '<p><span class="src" data-line="3"></span>See <a href="https://example.com">the link</a> now.</p>',
    '<p><span class="src" data-line="5"></span>Energy <math><mi>E</mi><mo>=</mo></math> here.</p>',
    '<span class="src" data-line="7"></span><pre><code>let code = 1;</code></pre>',
    '<span class="src" data-line="11"></span><table><tr><td>cell</td><td>two</td></tr></table>',
  ].join('\n'),
};
// The commands the app calls while it only reads and types into the one file.
const READ_ONLY_OR_EDIT = ['launch_options', 'initial_file', 'pending_files', 'files_exist', 'open_path', 'read_markdown',
  'read_json', 'read_reviews', 'window_size', 'os_theme', 'siblings', 'set_poll_seconds', 'set_title', 'fit_window', 'edit_markdown'];

let dialogs = 0;
const session = async (files, initial = '/d/a.md', platform = '') => {
  const s = await start({ files, initial, platform });
  s.page.on('dialog', (dialog) => {
    dialogs += 1;
    void dialog.dismiss();
  });
  return s;
};

// ── Session 1: a to e and the queue, on the plain file ─────────────────────
const one = await session({ '/d/a.md': raw });
const { page, ok, selectText } = one;
const file = () => page.evaluate(() => window.__files['/d/a.md']);
const calls = () => page.evaluate(() => window.__calls);
const editCalls = async () => (await calls()).filter(([cmd]) => cmd === 'edit_markdown');
const settle = (ms = 300) => page.waitForTimeout(ms);
const status = () => page.textContent('#status');
const fresh = async () => {
  await page.reload();
  await page.waitForSelector('#markdown p');
  dialogs = 0;
};
// A point in rendered text: its middle, or its right or left edge.
const spot = (text, where = 'mid', on = page) => on.evaluate(([text, where]) => {
  const walk = document.createTreeWalker(document.querySelector('#markdown'), NodeFilter.SHOW_TEXT);
  let node;
  while (walk.nextNode()) if (walk.currentNode.textContent.includes(text)) { node = walk.currentNode; break; }
  const at = node.textContent.indexOf(text);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + text.length);
  const box = range.getBoundingClientRect();
  const x = where === 'end' ? box.right - 1 : where === 'start' ? box.left + 1 : box.left + box.width / 2;
  return { x, y: box.top + box.height / 2 };
}, [text, where]);
// The text before the DOM caret, within its own text node, or null.
const caretText = () => page.evaluate(() => {
  const s = getSelection();
  if (!s.isCollapsed || !s.anchorNode || s.anchorNode.nodeType !== 3) return null;
  return s.anchorNode.textContent.slice(0, s.anchorOffset);
});
const undo = async () => {
  await page.keyboard.press('Control+z');
  await settle();
};

// a. A click puts a caret; typing inserts at that spot and the caret stays after it.
{
  const p = await spot('brave', 'end');
  await page.mouse.click(p.x, p.y);
  await settle(100);
  await page.keyboard.type('x');
  await settle(400);
  ok(await file() === raw.replace('brave new', 'bravex new'), 'A click at the end of brave, then a typed x, puts x in the .md right after brave');
  ok((await caretText())?.endsWith('bravex'), `After the re-render the caret sits after the x (${JSON.stringify(await caretText())})`);
  await fresh();
}

// b. A double-click puts a caret and selects no word; a typed x lands at the click point, before the word.
{
  const p = await spot('brave', 'start');
  await page.mouse.dblclick(p.x, p.y);
  await settle(200);
  const picked = await page.evaluate(() => ({ collapsed: getSelection().isCollapsed, text: getSelection().toString() }));
  ok(picked.collapsed && picked.text === '', `A double-click selects no word (${JSON.stringify(picked)})`);
  ok(await file() === raw, 'and changes nothing');
  await page.keyboard.type('x');
  await settle(400);
  ok(await file() === raw.replace('Hello brave', 'Hello xbrave'),
    'After a double-click at the start of brave, a typed x lands there: the word stays whole');
  await fresh();
}

// c. Space, Backspace and Delete each change the .md by one character; each check stands on its own.
{
  const p = await spot('brave', 'end');
  await page.mouse.click(p.x, p.y);
  await settle(100);
  await page.keyboard.press('Space');
  await settle(300);
  ok(await file() === raw.replace('brave new', 'brave  new'), 'Space inserts one space');
  await fresh();
}
{
  // Backspace after brave removes its last letter: exact text, and exactly one edit with an empty replacement.
  const p = await spot('brave', 'end');
  await page.mouse.click(p.x, p.y);
  await settle(100);
  await page.keyboard.press('Backspace');
  await settle(300);
  const writes = (await editCalls()).map(([, args]) => args.replacement);
  ok(await file() === raw.replace('brave new', 'brav new') && writes.length === 1 && writes[0] === '',
    `Backspace removes the character before the caret: one edit, empty replacement (${JSON.stringify(writes)})`);
  await fresh();
}
{
  const p = await spot('brave', 'end');
  await page.mouse.click(p.x, p.y);
  await settle(100);
  await page.keyboard.press('Delete');
  await settle(300);
  ok(await file() === raw.replace('brave new', 'bravenew'), 'Delete removes the character after the caret');
  ok(dialogs === 0 && !(await calls()).some(([cmd]) => cmd === 'trash_plan'), 'Delete with the caret in text does not open the trash confirmation');
  await page.evaluate(() => { getSelection().removeAllRanges(); document.activeElement?.blur(); });
  await page.keyboard.press('Delete');
  await settle(300);
  ok(dialogs === 1 && (await calls()).some(([cmd]) => cmd === 'trash_plan'), 'Delete with no caret in the page still asks about the trash');
  await fresh();
}

// d. Select a sentence and press Delete, or Backspace: it is gone from the .md. No right-click.
{
  await selectText('#markdown', 'Second paragraph here.');
  await page.keyboard.press('Delete');
  await settle(300);
  ok(!(await file()).includes('Second paragraph here.'), 'Delete removes the selected sentence from the .md');
  await fresh();
  await selectText('#markdown', 'brave new');
  await page.keyboard.press('Backspace');
  await settle(300);
  ok(await file() === 'Hello world.\n\nSecond paragraph here.\n\nSame sentence. Same sentence.\n', 'Backspace removes the selected words from the .md');
  await fresh();
}

// e. Ctrl+Z undoes the typed word as one step, then the Delete, then the Backspace.
{
  const p = await spot('brave', 'end');
  await page.mouse.click(p.x, p.y);
  await settle(100);
  await page.keyboard.type(' abc');
  await settle(400);
  await page.keyboard.press('Delete');
  await settle(300);
  await page.keyboard.press('Backspace');
  await settle(300);
  ok(await file() === 'Hello brave abnew world.\n\nSecond paragraph here.\n\nSame sentence. Same sentence.\n', 'Typed text, Delete and Backspace are all in the .md');
  await undo();
  ok(await file() === 'Hello brave abcnew world.\n\nSecond paragraph here.\n\nSame sentence. Same sentence.\n', 'Ctrl+Z undoes the Backspace first');
  await undo();
  ok(await file() === 'Hello brave abc new world.\n\nSecond paragraph here.\n\nSame sentence. Same sentence.\n', 'then the Delete');
  await undo();
  ok(await file() === raw, 'and then the whole typed word, as one step');
  await undo();
  ok((await status()).includes('Nothing to undo') && await file() === raw, 'A fourth Ctrl+Z says there is nothing to undo, and the file stays as it was');
  await fresh();
}

// f0. Enter does not split a paragraph in the rendered view; it says so.
{
  const p = await spot('brave', 'end');
  await page.mouse.click(p.x, p.y);
  await settle(100);
  await page.keyboard.press('Enter');
  await settle(300);
  ok(await file() === raw && (await status()).includes('A new paragraph is not typed'), 'Enter changes nothing in the .md and the status line says why');
  await fresh();
}

// g. Ten items of the queue: the typed-over selection, Delete twice, Ctrl+Z at once, the run cap.
// The mock answers at once, so a write is slowed (window.__editDelay) to make keys arrive while it runs.
{
  // Item 1: keys pressed while a selection is being replaced all land, in order.
  await selectText('#markdown', 'Second paragraph here.');
  await page.evaluate(() => { window.__editDelay = 150; });
  await page.keyboard.press('x');
  await page.keyboard.press('y');
  await page.keyboard.press('z');
  await settle(900);
  ok(await file() === raw.replace('Second paragraph here.', 'xyz'), `Keys pressed while a selection is replaced land in order (${JSON.stringify((await file()).split('\n')[2])})`);
  await fresh();
}
{
  // Item 1: Delete twice while the first Delete is written: no trash confirmation, and nothing else changes.
  // A real click first puts the focus in the article, as a reader's does; then the selection is made in it.
  const c = await spot('Second', 'mid');
  await page.mouse.click(c.x, c.y);
  await settle(100);
  await selectText('#markdown', 'Second paragraph here.');
  await page.evaluate(() => { window.__editDelay = 150; });
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');
  await settle(900);
  ok(dialogs === 0 && !(await calls()).some(([cmd]) => cmd === 'trash_plan'), 'Delete pressed twice at once never reaches the trash confirmation');
  ok((await editCalls()).length === 1 && await file() === raw.replace('Second paragraph here.', ''),
    `the sentence is removed by one write, and nothing else is written (${(await editCalls()).length} writes)`);
  await fresh();
}
{
  // Item 3: Ctrl+Z pressed while two typed characters are still being written undoes them, with no error.
  const p = await spot('brave', 'end');
  await page.mouse.click(p.x, p.y);
  await settle(100);
  await page.evaluate(() => { window.__editDelay = 150; });
  await page.keyboard.press('a');
  await page.keyboard.press('b');
  await page.keyboard.press('Control+z');
  await settle(900);
  ok(await file() === raw && !(await status()).includes('changed') && !(await status()).includes('Could not'),
    `Ctrl+Z at once undoes the two typed characters, with no error (${await status()})`);
  await fresh();
}
{
  // Item 6: a run of typed characters is capped at 200 per undo step: 205 characters make two steps.
  const p = await spot('brave', 'end');
  await page.mouse.click(p.x, p.y);
  await settle(100);
  await page.keyboard.type('x'.repeat(205));
  await settle(800);
  await undo();
  ok((await file()).length === raw.length + 200, `The newest five characters are one undo step (length ${(await file()).length})`);
  await undo();
  ok(await file() === raw, 'The next undo step takes back the first 200 characters');
  await fresh();
}

// Item 2 and item 5: a file that changes on disk while a key is in flight refuses the queued keys, and the .md is not corrupted.
{
  const p = await spot('brave', 'end');
  await page.mouse.click(p.x, p.y);
  await settle(100);
  await page.evaluate(() => { window.__editDelay = 400; });
  await page.keyboard.press('a');
  await settle(80);
  await page.keyboard.press('b');
  await settle(60);
  const external = 'External line.\n\n' + raw;
  await page.evaluate((external) => {
    window.__files['/d/a.md'] = external;
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 9 });
  }, external);
  await settle(900);
  ok(await file() === external, 'A file that changed on disk while keys were queued is not written to: the .md is as the other program left it');
  ok((await status()).includes('2 typed keys were not written'), `The status line says how many keys were discarded (${await status()})`);
  await fresh();
}

// ── Session 2: f, math, code, a link and a table on the rich file ──────────
const two = await session({ '/d/a.md': rich });
const twoEdits = () => two.page.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
{
  const rfile = () => two.page.evaluate(() => window.__files['/d/a.md'].raw);
  for (const [name, selector] of [['math', '#markdown math'], ['code', '#markdown pre'], ['a link', '#markdown a'], ['a table', '#markdown table']]) {
    const box = await two.page.locator(selector).first().boundingBox();
    await two.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await two.page.waitForTimeout(150);
    await two.page.keyboard.press('x');
    await two.page.waitForTimeout(250);
    ok(await rfile() === rich.raw && await twoEdits() === 0, `A click and a key in ${name} change nothing in the .md, and no edit is written`);
    ok((await two.page.textContent('#status')).includes('not edited here'), `and the status line says why (${name})`);
    const outside = await two.page.evaluate(() => {
      const node = getSelection().anchorNode;
      const el = node && (node.nodeType === 3 ? node.parentElement : node);
      return !el?.closest?.('math, pre, code, a[href], table');
    });
    ok(outside, `The DOM selection is outside the ${name} element`);
  }
}
{
  // Backspace or Delete at the edge of the text run beside a link: refused, the link markup stays, no edit written.
  const rfile = () => two.page.evaluate(() => window.__files['/d/a.md'].raw);
  for (const [text, at, key] of [[' now.', 0, 'Backspace'], ['See ', 4, 'Delete']]) {
    const before = await twoEdits();
    await two.page.evaluate(([text, at]) => {
      const walk = document.createTreeWalker(document.querySelector('#markdown'), NodeFilter.SHOW_TEXT);
      let node;
      while (walk.nextNode()) if (walk.currentNode.textContent === text) { node = walk.currentNode; break; }
      const range = document.createRange();
      range.setStart(node, at);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      document.getElementById('markdown').focus();
    }, [text, at]);
    await two.page.waitForTimeout(100);
    await two.page.keyboard.press(key);
    await two.page.waitForTimeout(250);
    ok(await rfile() === rich.raw && await twoEdits() === before, `${key} at the edge of "${text.trim()}", next to the link, leaves the link markup alone and writes nothing`);
    ok((await two.page.textContent('#status')).includes('next to formatting or a link'), `and the status line says why (${key})`);
  }
}
await two.close();

// ── Session 3: g, h, i, j on the plain file; the reload caret; k on the review menu ──
const three = await session({ '/d/a.md': raw });
const p3 = three.page;
const file3 = () => p3.evaluate(() => window.__files['/d/a.md']);
{
  // A selection that repeats in its paragraph. The caret case, a text run beside markup that repeats, is in session 5.
  await three.selectText('#markdown', 'Same sentence');
  await p3.keyboard.type('x');
  await p3.waitForTimeout(300);
  ok((await p3.textContent('#status')).includes('more than once') && await file3() === raw, 'Typing over a selected phrase that repeats in its paragraph is refused with the repeated message, and the file is unchanged');
  await p3.reload();
  await p3.waitForSelector('#markdown p');
}
{
  // h. A change on disk after the caret: the caret keeps its source position.
  const p = await spot('brave', 'end', p3);
  await p3.mouse.click(p.x, p.y);
  await p3.waitForTimeout(100);
  await p3.evaluate(() => {
    window.__files['/d/a.md'] = window.__files['/d/a.md'].replace('Second paragraph here.', 'Second paragraph changed here.');
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 9 });
  });
  await p3.waitForTimeout(400);
  await p3.keyboard.type('y');
  await p3.waitForTimeout(400);
  ok(await file3() === raw.replace('brave new', 'bravey new').replace('Second paragraph here.', 'Second paragraph changed here.'), 'After a reload the caret still types at its source position');
  await p3.reload();
  await p3.waitForSelector('#markdown p');
}
{
  // Item 4: a change BEFORE the caret: the caret is found again by the text around it, and types there.
  const p = await spot('Second', 'end', p3);
  await p3.mouse.click(p.x, p.y);
  await p3.waitForTimeout(100);
  const external = raw.replace('Hello brave', 'New sentence.\n\nHello brave');
  await p3.evaluate((external) => {
    window.__files['/d/a.md'] = external;
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 9 });
  }, external);
  await p3.waitForTimeout(400);
  await p3.keyboard.type('Z');
  await p3.waitForTimeout(400);
  ok(await file3() === external.replace('Second paragraph', 'SecondZ paragraph'), 'A new sentence before the caret: the caret is still after the same word, and types there');
  await p3.reload();
  await p3.waitForSelector('#markdown p');
}
{
  // i. Five characters typed quickly: every write goes in order, and none is lost.
  const p = await spot('brave', 'end', p3);
  await p3.mouse.click(p.x, p.y);
  await p3.waitForTimeout(100);
  await p3.keyboard.type('abcde');
  await p3.waitForTimeout(600);
  const order = (await p3.evaluate(() => window.__calls)).filter(([cmd]) => cmd === 'edit_markdown').map(([, args]) => args.replacement).join('');
  ok(order === 'abcde' && await file3() === raw.replace('brave new', 'braveabcde new'), `Five quick keys write in order, none lost (${order})`);
  // j. Every command the app calls is in the read-or-edit list, and every edit is on the one file. The mock cannot see disk writes.
  const log = await p3.evaluate(() => window.__calls);
  const unknown = log.map(([cmd]) => cmd).filter((cmd) => !READ_ONLY_OR_EDIT.includes(cmd));
  const otherFile = log.filter(([cmd, args]) => cmd === 'edit_markdown' && args.path !== '/d/a.md');
  ok(unknown.length === 0 && otherFile.length === 0 && await p3.evaluate(() => Object.keys(window.__files).join()) === '/d/a.md',
    `After typed edits the only commands are reads and edits of /d/a.md (unknown: ${JSON.stringify(unknown)})`);
  await p3.reload();
  await p3.waitForSelector('#markdown p');
}
{
  // k. The direct delete is not named like the request to the agent, and the request still makes a review.
  await p3.keyboard.press('Control+Shift+R');
  await p3.waitForTimeout(200);
  await three.selectText('#markdown', 'Second paragraph here.');
  const box = await p3.evaluate(() => {
    const r = getSelection().getRangeAt(0).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p3.mouse.click(box.x, box.y, { button: 'right' });
  await p3.waitForTimeout(150);
  const direct = (await p3.textContent('#reviewMenuDelete')).trim();
  ok(!/delete/i.test(direct) && /file/i.test(direct), `The direct delete item is not named delete (${JSON.stringify(direct)})`);
  await p3.click('#reviewMenuAdd');
  await p3.waitForTimeout(150);
  await p3.selectOption('#noteAction', 'delete');
  await p3.click('#noteSave');
  await p3.waitForTimeout(400);
  const reviews = await p3.evaluate(() => window.__store?.reviews ?? []);
  ok(reviews.some((r) => r.action === 'delete') && await file3() === raw, 'The request to the agent still makes a delete review, and the .md is unchanged');
}
{
  // Item 1: a selection made while a write runs is not acted on at the old caret. Delete is refused with a message:
  // the sentence stays, and no trash dialog opens.
  await p3.reload();
  await p3.waitForSelector('#markdown p');
  dialogs = 0;
  const p = await spot('brave', 'end', p3);
  await p3.mouse.click(p.x, p.y);
  await p3.waitForTimeout(100);
  await p3.evaluate(() => { window.__editDelay = 400; });
  await p3.keyboard.press('a');
  await three.selectText('#markdown', 'Second paragraph here.');
  await p3.keyboard.press('Delete');
  await p3.waitForTimeout(50);
  const message = await p3.textContent('#status');
  await p3.waitForTimeout(900);
  // The first key is the one write: its text is in the file, the selected sentence is intact, and no second write was made.
  const writes = await p3.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  ok(message.includes('Wait for the write to end, then select again') && dialogs === 0 && await file3() === raw.replace('brave new', 'bravea new') && writes === 1,
    `A selection made while a write runs is refused on Delete: the sentence stays, no trash dialog, one write (${writes}) (${JSON.stringify(message)})`);
  await p3.evaluate(() => { window.__editDelay = 0; });
}
{
  // Item 2: a Delete with focus on a button, while a write runs, opens no trash dialog.
  await p3.reload();
  await p3.waitForSelector('#markdown p');
  dialogs = 0;
  const p = await spot('brave', 'end', p3);
  await p3.mouse.click(p.x, p.y);
  await p3.waitForTimeout(100);
  await p3.evaluate(() => { window.__editDelay = 400; });
  await p3.keyboard.press('a');
  await p3.focus('#settingsToggle');
  await p3.keyboard.press('Delete');
  await p3.waitForTimeout(900);
  const trashed = await p3.evaluate(() => window.__calls.some(([cmd]) => cmd === 'trash_plan'));
  ok(dialogs === 0 && !trashed, 'A Delete with focus on a button while a write runs opens no trash dialog');
  await p3.evaluate(() => { window.__editDelay = 0; });
}
{
  // Item 4: a selection queued from the menu is snapshotted with the digest it was read at. The typed key's read is
  // held, a change lands meanwhile and is read, and the queued selection then runs: it must be refused, not written
  // into the changed file.
  await p3.reload();
  await p3.waitForSelector('#markdown p');
  const p = await spot('brave', 'end', p3);
  await p3.mouse.click(p.x, p.y);
  await p3.waitForTimeout(100);
  await p3.evaluate(() => { window.__readDelay = 700; });
  await p3.keyboard.press('a');
  await p3.waitForTimeout(100);
  await three.selectText('#markdown', 'Second paragraph here.');
  await p3.evaluate(() => document.getElementById('reviewMenuDelete').click());
  await p3.waitForTimeout(100);
  await p3.evaluate(() => {
    window.__files['/d/a.md'] = 'External line.\n\n' + window.__files['/d/a.md'];
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 9 });
  });
  await p3.waitForTimeout(1500);
  const after = await file3();
  ok(after.startsWith('External line.') && after.includes('Second paragraph here.') && (await p3.textContent('#status')).includes('changed on disk'),
    `A queued selection write made before the file changed is refused: the sentence stays, and the status names the change (${JSON.stringify((await p3.textContent('#status')))})`);
  await p3.reload();
  await p3.waitForSelector('#markdown p');
}
await three.close();

// ── Session 4: item 3 (Delete in a code block), items 5 and 6 (composition, dead keys, AltGr) on the rich file ──
// AltGr is ctrl+alt on Windows only: this session is a Windows one.
const four = await session({ '/d/a.md': rich }, '/d/a.md', 'windows');
const pf = four.page;
const rtext = () => pf.evaluate(() => { const f = window.__files['/d/a.md']; return typeof f === 'object' ? f.raw : f; });
const edits4 = () => pf.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
{
  // Item 3: a Delete after a click in a code block: no trash dialog, no write, the status says why.
  dialogs = 0;
  const box = await pf.locator('#markdown pre').first().boundingBox();
  await pf.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await pf.waitForTimeout(150);
  await pf.keyboard.press('Delete');
  await pf.waitForTimeout(300);
  const trashed = await pf.evaluate(() => window.__calls.some(([cmd]) => cmd === 'trash_plan'));
  ok(dialogs === 0 && !trashed && await edits4() === 0 && await rtext() === rich.raw,
    'A Delete after a click in a code block: no trash dialog, no edit, file unchanged');
  ok((await pf.textContent('#status')).includes('not edited here'), 'and the status says why');
  await pf.keyboard.press('Backspace');
  await pf.waitForTimeout(300);
  ok(dialogs === 0 && await edits4() === 0 && await rtext() === rich.raw,
    'A Backspace after the same click in a code block: no edit, file unchanged');
}
{
  // Item 5: a composed character arrives once, at compositionend, as one edit.
  const p = await spot('brave', 'end', pf);
  await pf.mouse.click(p.x, p.y);
  await pf.waitForTimeout(100);
  await pf.evaluate(() => {
    const el = document.getElementById('markdown');
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'é', bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { data: 'é', bubbles: true }));
  });
  await pf.waitForTimeout(400);
  ok(await rtext() === rich.raw.replace('brave new', 'braveé new') && await edits4() === 1,
    `A composed é arrives once, in one edit (${await edits4()} writes)`);
  // A key during composition is not taken: no write.
  const before = await edits4();
  await pf.evaluate(() => document.getElementById('markdown').dispatchEvent(new KeyboardEvent('keydown', { key: 'e', isComposing: true, bubbles: true, cancelable: true })));
  await pf.waitForTimeout(250);
  ok(await edits4() === before, 'A keydown during composition (isComposing) writes nothing');
  // A dead key is left to the browser: its default is not cancelled.
  const cancelled = await pf.evaluate(() => {
    const e = new KeyboardEvent('keydown', { key: 'Dead', bubbles: true, cancelable: true });
    document.getElementById('markdown').dispatchEvent(e);
    return e.defaultPrevented;
  });
  ok(cancelled === false && await edits4() === before, 'A dead key is not cancelled, so the browser can compose it');
}
{
  // Item 6: AltGr arrives as ctrl+alt; the character is typed once, not taken as a shortcut.
  const p = await spot('brave', 'end', pf);
  await pf.mouse.click(p.x, p.y);
  await pf.waitForTimeout(100);
  const before = await edits4();
  await pf.evaluate(() => document.getElementById('markdown').dispatchEvent(new KeyboardEvent('keydown', { key: '@', ctrlKey: true, altKey: true, bubbles: true, cancelable: true })));
  await pf.waitForTimeout(400);
  // The file already holds the é from the block above: the @ goes after brave, before it.
  ok(await rtext() === rich.raw.replace('brave new', 'brave@é new') && await edits4() === before + 1,
    'AltGr with ctrl and alt types @ once, after brave');
}
await four.close();

// ── Session 6: compositions at a stale caret (items 1 and 2), and a key after a click during a write (item 6) ──
const six = await session({ '/d/a.md': rich });
const p6 = six.page;
const rtext6 = () => p6.evaluate(() => { const f = window.__files['/d/a.md']; return typeof f === 'object' ? f.raw : f; });
const edits6 = () => p6.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
const dom6 = () => p6.evaluate(() => document.getElementById('markdown').textContent);
{
  // Item 1: a composition that starts after a click in a code block takes no text. First, before any write: a write re-renders
  // the file from its text, and the mock drops the code block from a re-rendered file.
  const box = await p6.locator('#markdown pre').first().boundingBox();
  await p6.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p6.waitForTimeout(100);
  await p6.evaluate(() => {
    const el = document.getElementById('markdown');
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { data: 'é', bubbles: true }));
  });
  await p6.waitForTimeout(400);
  // The status is the skipped message: a composition in code is not refused for lack of a selection.
  const status = await p6.textContent('#status');
  ok(await rtext6() === rich.raw && await edits6() === 0 && status.includes('Math, code, links, tables and figures are not edited here'),
    `A composition after a click in a code block: the file is unchanged, no write, the skipped message (${JSON.stringify(status)})`);
}
{
  // Item 1: a composition that starts with a selection (not a caret) takes no text, even though an earlier click left a caret.
  // Item 2: the accent the browser put in the DOM is gone after the refusal (the file is shown again from its own text).
  const p = await spot('brave', 'end', p6);
  await p6.mouse.click(p.x, p.y);
  await p6.waitForTimeout(100);
  await six.selectText('#markdown', 'new world.');
  await p6.waitForTimeout(100);
  await p6.evaluate(() => {
    const el = document.getElementById('markdown');
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'é', bubbles: true }));
    // The browser puts the composed text in the DOM in place of the selection, then sends compositionend.
    const range = getSelection().getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode('é'));
    el.dispatchEvent(new CompositionEvent('compositionend', { data: 'é', bubbles: true }));
  });
  await p6.waitForTimeout(500);
  const status = await p6.textContent('#status');
  ok(await rtext6() === rich.raw && await edits6() === 0 && status.includes('Select no text and click where you want to type'),
    `A composed é over a selected sentence is refused: the file is unchanged, no write (${JSON.stringify(status)})`);
  const dom = await dom6();
  ok(!dom.includes('é') && dom.includes('Hello brave new world.'), 'After the refusal the rendered text has no é, and the sentence is back');
}
await six.close();

// ── Session 6b: a click in the code block during a write is kept (item 6) ──
const sixb = await session({ '/d/a.md': rich });
const p6b = sixb.page;
const rtext6b = () => p6b.evaluate(() => { const f = window.__files['/d/a.md']; return typeof f === 'object' ? f.raw : f; });
{
  // Item 6: a click in the code block during a write is kept. The key typed after it is refused, not written at the write's caret.
  const p6 = p6b;
  const rtext6 = rtext6b;
  const p = await spot('brave', 'end', p6);
  await p6.mouse.click(p.x, p.y);
  await p6.waitForTimeout(100);
  await p6.evaluate(() => { window.__editDelay = 400; });
  await p6.keyboard.press('a');
  await p6.waitForTimeout(100);
  const box = await p6.locator('#markdown pre').first().boundingBox();
  await p6.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p6.waitForTimeout(50);
  await p6.keyboard.press('b');
  await p6.waitForTimeout(900);
  await p6.evaluate(() => { window.__editDelay = 0; });
  const status = await p6.textContent('#status');
  ok(await rtext6() === rich.raw.replace('brave', 'bravea') && status.includes('Click in the text to place the caret'),
    `A key typed after a click in a code block, during a write, is not written: only the "a" is (${JSON.stringify(status)})`);
}
await sixb.close();

// ── Session 7: a write that throws with keys queued behind it (item 3), and a write during trash planning (item 4) ──
const seven = await session({ '/d/a.md': raw });
const p7 = seven.page;
const file7 = () => p7.evaluate(() => { const f = window.__files['/d/a.md']; return typeof f === 'object' ? f.raw : f; });
{
  // Item 3: the write throws (not a refusal) with two keys queued behind it. The queue is cleared and reported, a later key
  // is typed, and a later Delete outside the text opens the trash question (it is not blocked by a queue that never drains).
  const p = await spot('brave', 'end', p7);
  await p7.mouse.click(p.x, p.y);
  await p7.waitForTimeout(100);
  await p7.evaluate(() => { window.__editDelay = 300; window.__throwOnce = 'disk error'; });
  await p7.keyboard.press('b');
  await p7.keyboard.press('c');
  await p7.waitForTimeout(700);
  const status = await p7.textContent('#status');
  ok(await file7() === raw && status.includes('disk error') && status.includes('2 typed keys were not written'),
    `A write that throws drops the keys queued behind it and says how many (${JSON.stringify(status)})`);
  await p7.evaluate(() => { window.__editDelay = 0; });
  await p7.keyboard.press('d');
  await p7.waitForTimeout(400);
  ok(await file7() === raw.replace('brave', 'braved'), 'A later key is typed normally after the failed write');
  dialogs = 0;
  await p7.evaluate(() => { getSelection().removeAllRanges(); document.activeElement?.blur(); });
  await p7.keyboard.press('Delete');
  await p7.waitForTimeout(300);
  const planned = await p7.evaluate(() => window.__calls.some(([cmd]) => cmd === 'trash_plan'));
  ok(dialogs === 1 && planned, 'A later Delete outside the text is not blocked: the trash question opens');
}
{
  // Item 4: a write starts while the trash is being planned. The trash question must not open after that write has begun.
  await p7.reload();
  await p7.waitForSelector('#markdown p');
  dialogs = 0;
  const p = await spot('brave', 'end', p7);
  await p7.mouse.click(p.x, p.y);
  await p7.waitForTimeout(100);
  await p7.evaluate(() => { window.__trashDelay = 600; window.__editDelay = 1200; });
  await p7.evaluate(() => { getSelection().removeAllRanges(); document.activeElement?.blur(); });
  await p7.keyboard.press('Delete');
  await p7.waitForTimeout(100);
  // Put a real text caret back, after brave: focusing the article alone would leave the browser to choose one.
  await p7.evaluate(() => {
    const article = document.getElementById('markdown');
    const walk = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    while (walk.nextNode() && !walk.currentNode.textContent.includes('brave'));
    const node = walk.currentNode;
    const range = document.createRange();
    range.setStart(node, node.textContent.indexOf('brave') + 'brave'.length);
    range.collapse(true);
    article.focus();
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await p7.waitForTimeout(100);
  await p7.keyboard.press('a');
  await p7.waitForTimeout(100);
  // The competing write must have begun while the trash was still being planned (trash_plan answers at 600 ms).
  const started = await p7.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  await p7.waitForTimeout(1500);
  await p7.evaluate(() => { window.__trashDelay = 0; window.__editDelay = 0; });
  const trashed = await p7.evaluate(() => window.__calls.some(([cmd]) => cmd === 'trash_document'));
  // The trash was being planned (trash_plan was called), so the no-question result is the guard's, not a Delete that went elsewhere.
  const planned = await p7.evaluate(() => window.__calls.some(([cmd]) => cmd === 'trash_plan'));
  ok(started === 1 && await file7() === raw.replace('brave', 'bravea'),
    `The competing write started while the trash was planned, and landed after brave (${started} writes; ${JSON.stringify((await file7()).split('\n')[0])})`);
  ok(dialogs === 0 && !trashed && planned, 'A write started while the trash is being planned: no trash question opens, nothing is trashed');
}
await seven.close();

// ── Session 8 (Linux): ctrl+alt with a letter is a shortcut, not a typed letter (item 6, negative) ──
const eight = await session({ '/d/a.md': raw }, '/d/a.md', 'linux');
{
  const p = await spot('brave', 'end', eight.page);
  await eight.page.mouse.click(p.x, p.y);
  await eight.page.waitForTimeout(100);
  await eight.page.evaluate(() => document.getElementById('markdown').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, altKey: true, bubbles: true, cancelable: true })));
  await eight.page.waitForTimeout(400);
  const edits = await eight.page.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  ok(await eight.page.evaluate(() => window.__files['/d/a.md']) === raw && edits === 0,
    'Ctrl+Alt+Z on Linux is not typed: the file is unchanged and no write is made');
}
await eight.close();

// ── Session 9 (macOS): Option+key is a character (item 5) ──
const nine = await session({ '/d/a.md': raw }, '/d/a.md', 'macos');
{
  const p = await spot('brave', 'end', nine.page);
  await nine.page.mouse.click(p.x, p.y);
  await nine.page.waitForTimeout(100);
  await nine.page.evaluate(() => document.getElementById('markdown').dispatchEvent(new KeyboardEvent('keydown', { key: '@', altKey: true, bubbles: true, cancelable: true })));
  await nine.page.waitForTimeout(400);
  const edits = await nine.page.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  ok(await nine.page.evaluate(() => window.__files['/d/a.md']) === raw.replace('brave new', 'brave@ new') && edits === 1,
    'On macOS, Option+@ (altKey only) is typed once');
}
await nine.close();

// ── Session 10: a click during a slow write is kept even when the caret was already null (item 2) ──
const ten = await session({ '/d/a.md': rich });
const p10 = ten.page;
const rtext10 = () => p10.evaluate(() => { const f = window.__files['/d/a.md']; return typeof f === 'object' ? f.raw : f; });
{
  // A selection write (caret null), slowed. The click in the code block sets the caret to null again: no caret was set before either.
  await ten.selectText('#markdown', 'brave new');
  await p10.waitForTimeout(100);
  await p10.evaluate(() => { window.__editDelay = 600; });
  await p10.keyboard.press('x');
  await p10.waitForTimeout(100);
  const box = await p10.locator('#markdown pre').first().boundingBox();
  await p10.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p10.waitForTimeout(50);
  await p10.keyboard.press('y');
  await p10.waitForTimeout(1000);
  await p10.evaluate(() => { window.__editDelay = 0; });
  const status = await p10.textContent('#status');
  ok(await rtext10() === rich.raw.replace('brave new', 'x') && status.includes('Click in the text to place the caret'),
    `A click in code during a slow write, then a key: the key is not written at the write's caret (${JSON.stringify(status)})`);
}
await ten.close();

// ── Session 11: a dead key typed while a write runs is written after that write, in order (item 3) ──
const eleven = await session({ '/d/a.md': raw });
const p11 = eleven.page;
{
  const p = await spot('brave', 'end', p11);
  await p11.mouse.click(p.x, p.y);
  await p11.waitForTimeout(100);
  await p11.evaluate(() => { window.__editDelay = 400; });
  await p11.keyboard.press('a');
  await p11.waitForTimeout(100);
  await p11.evaluate(() => {
    const el = document.getElementById('markdown');
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'é', bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { data: 'é', bubbles: true }));
  });
  await p11.waitForTimeout(900);
  await p11.evaluate(() => { window.__editDelay = 0; });
  const file = await p11.evaluate(() => window.__files['/d/a.md']);
  const status = await p11.textContent('#status');
  ok(file === raw.replace('brave new', 'braveaé new'),
    `A dead key typed during a write is written after it, in order: "aé" (status ${JSON.stringify(status)})`);
}
await eleven.close();

// ── Session 12: an Edit box save whose write is dropped resolves, is named in the status, and keeps its text (item 1) ──
const twelve = await session({ '/d/a.md': raw });
const p12 = twelve.page;
{
  const p = await spot('brave', 'end', p12);
  await p12.mouse.click(p.x, p.y);
  await p12.waitForTimeout(100);
  await p12.evaluate(() => { window.__editDelay = 700; });
  await p12.keyboard.press('x');
  await p12.waitForTimeout(100);
  await twelve.selectText('#markdown', 'Second paragraph here.');
  await p12.waitForTimeout(50);
  await p12.keyboard.press('Control+e');
  await p12.waitForTimeout(100);
  await p12.fill('#editText', 'Second paragraph changed.');
  await p12.click('#editSave');
  // The file changes on disk while the key's write is in flight: that write is refused, and the Save queued behind it is dropped.
  await p12.waitForTimeout(100);
  await p12.evaluate((external) => {
    window.__files['/d/a.md'] = external;
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 9 });
  }, 'External line.\n\n' + raw);
  await p12.waitForTimeout(1200);
  await p12.evaluate(() => { window.__editDelay = 0; });
  const status = await p12.textContent('#status');
  const box = await p12.evaluate(() => ({ hidden: document.getElementById('editBox').hidden, text: document.getElementById('editText').value }));
  const writes = await p12.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  ok(status.includes('an edit from the Edit box was not written') && !box.hidden && box.text === 'Second paragraph changed.' && writes === 1,
    `A dropped Edit box save is named in the status, and the box keeps its text (${JSON.stringify(status)}, box hidden ${box.hidden}, writes ${writes})`);
}
await twelve.close();

// ── Session 13: a write queued in one file is not applied to another file with the same text ──
// Both files hold the same text, so they have the same digest. A delete queued behind a slow write in a.md
// carries a.md's digest from before that write; b.md, shown meanwhile, still has it.
const thirteen = await session({ '/d/a.md': raw, '/d/b.md': raw });
const p13 = thirteen.page;
const text13 = (name) => p13.evaluate((name) => window.__files[`/d/${name}.md`], name);
{
  await p13.evaluate(() => window.__emit('open-files', ['/d/b.md']));
  await p13.waitForTimeout(300);
  await p13.keyboard.press('Control+1');
  await p13.waitForTimeout(300);
  const p = await spot('brave', 'end', p13);
  await p13.mouse.click(p.x, p.y);
  await p13.waitForTimeout(100);
  await p13.evaluate(() => { window.__editDelay = 500; });
  await p13.keyboard.press('x');
  await p13.waitForTimeout(50);
  await thirteen.selectText('#markdown', 'Second paragraph here.');
  await p13.evaluate(() => document.getElementById('reviewMenuDelete').click());
  await p13.waitForTimeout(50);
  await p13.keyboard.press('Control+2');
  await p13.waitForTimeout(1500);
  await p13.evaluate(() => { window.__editDelay = 0; });
  const shown13 = await p13.$eval('#tabs .tab[aria-selected="true"]', (tab) => tab.textContent);
  const written = await p13.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').map(([, args]) => args.path));
  ok(shown13 === 'b.md', `The other file was shown while the delete waited (${shown13})`);
  ok(await text13('b') === raw && !written.includes('/d/b.md'),
    `A delete queued in a.md is not written into b.md, which has the same text (writes: ${JSON.stringify(written)})`);
  ok(await text13('a') === raw.replace('brave', 'bravex'), 'and a.md has only the first key');
  ok((await p13.textContent('#status')).includes('not written'), `and the status says it was not written (${JSON.stringify(await p13.textContent('#status'))})`);
  // The mock's digest is the backend's: sha256 of the UTF-8 text, as `sha256:` and 64 hex digits.
  const read = await p13.evaluate(() => window.__TAURI__.core.invoke('read_markdown', { path: '/d/b.md' }));
  ok(read.digest === `sha256:${createHash('sha256').update(raw, 'utf8').digest('hex')}`, `The mock digest is the real SHA-256 (${read.digest})`);
}
await thirteen.close();

// ── Session 14: with Direct edits off and the Review panel open, Delete and Backspace on a selection make a delete review ──
const fourteen = await start({
  files: { '/d/a.md': raw },
  prepare: (page) => page.addInitScript(() => localStorage.setItem('pdf-next.direct-edits', '0')),
});
const p14 = fourteen.page;
for (const key of ['Delete', 'Backspace']) {
  await p14.reload();
  await p14.waitForSelector('#markdown p');
  if (await p14.$eval('#reviewPane', (el) => el.hidden).catch(() => true)) {
    await p14.keyboard.press('Control+Shift+R');
    await p14.waitForTimeout(200);
  }
  await fourteen.selectText('#markdown', 'Second paragraph here.');
  await p14.keyboard.press(key);
  await p14.waitForTimeout(300);
  const note = await p14.evaluate(() => ({ hidden: document.getElementById('noteBox').hidden, action: document.getElementById('noteAction').value }));
  ok(!note.hidden && note.action === 'delete', `${key} on a selection, Direct edits off, Review panel open: the note box opens as a delete review (${JSON.stringify(note)})`);
  await p14.keyboard.press('Escape');
  await p14.waitForTimeout(100);
  await fourteen.selectText('#markdown', 'Second paragraph here.');
  await p14.keyboard.press('x');
  await p14.waitForTimeout(300);
  const writes14 = await p14.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  ok(writes14 === 0 && await p14.evaluate(() => window.__files['/d/a.md']) === raw, `A letter over the selection still writes nothing with Direct edits off (after ${key})`);
}
await fourteen.close();

// ── Pure functions of caret-edit.mjs: characters, smart punctuation, the run limit ──
{
  const unit = await one.page.evaluate(async () => {
    const m = await import('/caret-edit.mjs');
    const raw = 'Wait... then 😀 go -- end --- x.\n';
    const out = {};
    const at = (text) => raw.indexOf(text);
    const back = (offset) => {
      const e = m.backspaceEdit(raw, { offset, start: 0, end: raw.length });
      return [e.start, e.expected, e.replacement, e.after.offset, e.after.end];
    };
    const forward = (offset) => {
      const e = m.forwardDeleteEdit(raw, { offset, start: 0, end: raw.length });
      return [e.start, e.expected, e.replacement, e.after.offset, e.after.end];
    };
    out.backEllipsis = back(at('...') + 3);
    out.backEmoji = back(at('😀') + 2);
    out.backEn = back(at('--') + 2);
    out.backEm = back(at('---') + 3);
    out.backLetter = back(at('Wait') + 4);
    out.forwardEllipsis = forward(at('...'));
    out.forwardEmoji = forward(at('😀'));
    out.forwardEn = forward(at(' -- ') + 1);
    out.forwardEm = forward(at('---'));
    out.length = raw.length;
    return out;
  });
  const L = unit.length;
  const raw13 = 'Wait... then 😀 go -- end --- x.\n';
  const idx = (t) => raw13.indexOf(t);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(eq(unit.backEllipsis, [idx('...'), '...', '', idx('...'), L - 3]), `Backspace after ... removes all three source characters (${JSON.stringify(unit.backEllipsis)})`);
  ok(eq(unit.backEmoji, [idx('😀'), '😀', '', idx('😀'), L - 2]), `Backspace after an emoji removes both UTF-16 units (${JSON.stringify(unit.backEmoji)})`);
  ok(eq(unit.backEn, [idx(' -- ') + 1, '--', '', idx(' -- ') + 1, L - 2]), `Backspace after -- removes both (${JSON.stringify(unit.backEn)})`);
  ok(eq(unit.backEm, [idx('---'), '---', '', idx('---'), L - 3]), `Backspace after --- removes all three (${JSON.stringify(unit.backEm)})`);
  ok(eq(unit.backLetter, [idx('Wait') + 3, 't', '', idx('Wait') + 3, L - 1]), `Backspace after a letter still removes one character (${JSON.stringify(unit.backLetter)})`);
  ok(eq(unit.forwardEllipsis, [idx('...'), '...', '', idx('...'), L - 3]), `Delete before ... removes all three (${JSON.stringify(unit.forwardEllipsis)})`);
  ok(eq(unit.forwardEmoji, [idx('😀'), '😀', '', idx('😀'), L - 2]), `Delete before an emoji removes both units (${JSON.stringify(unit.forwardEmoji)})`);
  ok(eq(unit.forwardEn, [idx(' -- ') + 1, '--', '', idx(' -- ') + 1, L - 2]), `Delete before -- removes both (${JSON.stringify(unit.forwardEn)})`);
  ok(eq(unit.forwardEm, [idx('---'), '---', '', idx('---'), L - 3]), `Delete before --- removes all three (${JSON.stringify(unit.forwardEm)})`);
}
{
  // The caret after smart punctuation, put back into the DOM text after a re-render: rendered offset <-> source offset.
  const result = await one.page.evaluate(async () => {
    const m = await import('/caret-edit.mjs');
    const raw = 'Wait... then a---b and c--d, e…f.\n';
    const rendered = 'Wait… then a—b and c–d, e…f.';
    const rows = [];
    for (const [label, source, at] of [
      ['after the ellipsis', 'Wait...', 'Wait…'.length],
      ['after the em dash', 'Wait... then a---', 'Wait… then a—'.length],
      ['after the en dash', 'Wait... then a---b and c--', 'Wait… then a—b and c–'.length],
      ['after a literal ellipsis', 'Wait... then a---b and c--d, e…', 'Wait… then a—b and c–d, e…'.length],
    ]) {
      const offset = source.length;
      const place = m.nodeAtOffset(raw, offset, [rendered]);
      const back = m.offsetInText(raw, 1, rendered, at);
      rows.push({ label, at: place?.at, wanted: at, offset: back.offset, offsetWanted: offset });
    }
    return rows;
  });
  for (const row of result) {
    ok(row.at === row.wanted && row.offset === row.offsetWanted,
      `The caret ${row.label} maps both ways (DOM offset ${row.at} of ${row.wanted}; source ${row.offset} of ${row.offsetWanted})`);
  }
}
{
  const run = await one.page.evaluate(async () => {
    const { continuesTyping } = await import('/caret-edit.mjs');
    const last = (length) => ({ typing: true, after: { offset: 10 }, edits: [{ replacement: 'x'.repeat(length) }] });
    const edit = (text) => ({ start: 10, expected: '', replacement: text });
    return {
      oneMoreOk: continuesTyping(last(199), edit('a'), 10),
      oneMoreOver: continuesTyping(last(200), edit('a'), 10),
      commitOver: continuesTyping(last(199), edit('abc'), 10),
      commitFits: continuesTyping(last(150), edit('x'.repeat(50)), 10),
      commitTooLong: continuesTyping(last(150), edit('x'.repeat(51)), 10),
    };
  });
  ok(run.oneMoreOk && !run.oneMoreOver, `One more typed character joins a run of 199 characters, not one of 200 (${JSON.stringify(run)})`);
  ok(run.commitFits && !run.commitTooLong && !run.commitOver, `A multi-character commit counts its characters against the 200 limit (${JSON.stringify(run)})`);
}

// ── Session 15: with several tabs open, the arrow keys move the caret in the text and step tabs elsewhere ──
const fifteen = await session({ '/d/a.md': raw, '/d/b.md': raw });
const p15 = fifteen.page;
{
  await p15.evaluate(() => window.__emit('open-files', ['/d/b.md']));
  await p15.waitForTimeout(300);
  await p15.keyboard.press('Control+1');
  await p15.waitForTimeout(300);
  const tab = () => p15.$eval('#tabs .tab[aria-selected="true"]', (t) => t.textContent);
  const p = await spot('brave', 'start', p15);
  await p15.mouse.click(p.x, p.y);
  await p15.waitForTimeout(100);
  for (const [key, typed, expected] of [['ArrowRight', 'x', 'Hello bxrave new world.'], ['Shift+ArrowRight', 'y', null]]) {
    await p15.keyboard.press(key);
    await p15.waitForTimeout(100);
    if (!expected) {
      ok(await tab() === 'a.md', `${key} with the caret in the text does not change tab (${await tab()})`);
      continue;
    }
    ok(await tab() === 'a.md', `${key} with the caret in the text does not change tab (${await tab()})`);
    await p15.keyboard.press(typed);
    await p15.waitForTimeout(400);
    const line = (await p15.evaluate(() => window.__files['/d/a.md'])).split('\n')[0];
    ok(line === expected, `and the caret moved one character: the typed key lands there (${JSON.stringify(line)})`);
  }
  await p15.keyboard.press('ArrowLeft');
  await p15.waitForTimeout(150);
  ok(await tab() === 'a.md', `ArrowLeft with the caret in the text does not change tab (${await tab()})`);
  // Focus outside the text: the arrows step tabs as before.
  await p15.evaluate(() => { getSelection().removeAllRanges(); document.activeElement?.blur(); });
  await p15.keyboard.press('ArrowRight');
  await p15.waitForTimeout(300);
  ok(await tab() === 'b.md', `ArrowRight with no caret in the text still steps to the next tab (${await tab()})`);
}
await fifteen.close();

// ── Session 16: a CRLF file. A soft line break is \r\n; Delete before it and Backspace after it are refused, never half of it ──
const crlf = 'Hello brave\r\nnew world.\r\n';
// The page gets the text as the browser parses it: a soft break is one \n in the DOM, \r\n in the file.
const sixteen = await session({ '/d/a.md': { raw: crlf, html: '<p><span class="src" data-line="1"></span>Hello brave\nnew world.</p>' } });
const p16 = sixteen.page;
{
  const file16 = () => p16.evaluate(() => { const f = window.__files['/d/a.md']; return typeof f === 'object' ? f.raw : f; });
  const p = await spot('brave', 'end', p16);
  await p16.mouse.click(p.x, p.y);
  await p16.waitForTimeout(100);
  await p16.keyboard.press('Delete');
  await p16.waitForTimeout(300);
  const edits = await p16.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  ok(await file16() === crlf && edits === 0, `Delete before a CRLF line break writes nothing (${JSON.stringify(await file16())})`);
  ok((await p16.textContent('#status')).includes('join two paragraphs'), `and the status says why (${JSON.stringify(await p16.textContent('#status'))})`);
  await p16.keyboard.press('x');
  await p16.waitForTimeout(300);
  ok(await file16() === 'Hello bravex\r\nnew world.\r\n', `A typed key at that caret still lands before the \\r (${JSON.stringify(await file16())})`);
}
await sixteen.close();
{
  const crlfRaw = 'Hello brave\r\nnew world.\r\n';
  const result = await one.page.evaluate(async (crlfRaw) => {
    const m = await import('/caret-edit.mjs');
    const at = crlfRaw.indexOf('\r');
    const run = { start: 0, end: crlfRaw.length };
    return {
      beforeCr: m.forwardDeleteEdit(crlfRaw, { ...run, offset: at }).error,
      beforeLf: m.forwardDeleteEdit(crlfRaw, { ...run, offset: at + 1 }).error,
      afterCr: m.backspaceEdit(crlfRaw, { ...run, offset: at + 1 }).error,
      afterLf: m.backspaceEdit(crlfRaw, { ...run, offset: at + 2 }).error,
      letter: m.forwardDeleteEdit(crlfRaw, { ...run, offset: 0 }).expected,
    };
  }, crlfRaw);
  ok(result.beforeCr === 'paragraph' && result.beforeLf === 'paragraph' && result.afterCr === 'paragraph' && result.afterLf === 'paragraph' && result.letter === 'H',
    `Delete and Backspace refuse either half of a \\r\\n and still delete a letter (${JSON.stringify(result)})`);
}

// Session 1's page is used by the pure-function checks above; closing it adds its page errors to the run, which fails on any.
await one.close();

// ── Session 17: Direct edits off, caret in the text: shortcuts still work; other printable keys say editing is off ──
const size = (page) => page.$eval('#markdown', (el) => el.style.zoom || '1');
// A file taller than the window, so j and k have somewhere to scroll.
const tall = Array.from({ length: 80 }, (_, n) => `Paragraph ${n + 1} has some words in it.`).join('\n\n') + '\n';
const seventeen = await start({
  files: { '/d/a.md': tall },
  prepare: (page) => page.addInitScript(() => localStorage.setItem('pdf-next.direct-edits', '0')),
});
{
  const p17 = seventeen.page;
  const scrolled = () => p17.$eval('#markdownStage', (el) => Math.round(el.scrollTop));
  const clearStatus = () => p17.evaluate(() => { document.getElementById('status').textContent = ''; });
  const writes17 = () => p17.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  const p = await spot('Paragraph 1 ', 'end', p17);
  await p17.mouse.click(p.x, p.y);
  await p17.waitForTimeout(100);
  const before = await size(p17);
  await p17.keyboard.press('+');
  await p17.waitForTimeout(300);
  const after = await size(p17);
  ok(before !== after, `With Direct edits off and a caret in the text, + still zooms the text (${before} -> ${after})`);
  await p17.evaluate(() => { document.getElementById('markdownStage').scrollTop = 0; });
  await clearStatus();
  await p17.keyboard.press('j');
  await p17.waitForTimeout(400);
  const down = await scrolled();
  await p17.keyboard.press('j');
  await p17.waitForTimeout(400);
  const down2 = await scrolled();
  await p17.keyboard.press('k');
  await p17.waitForTimeout(400);
  const up = await scrolled();
  ok(down > 0 && down2 > down && up < down2, `j scrolls the text down and k back up (${down}, ${down2}, ${up})`);
  ok(!(await p17.textContent('#status')).includes('off in Settings'), 'and the shortcuts show no editing message');
  await clearStatus();
  await p17.keyboard.press('Space');
  await p17.waitForTimeout(200);
  ok((await p17.textContent('#status')).includes('Editing the Markdown file is off in Settings'), `Space, which has no shortcut in Markdown, says editing is off (${JSON.stringify(await p17.textContent('#status'))})`);
  await clearStatus();
  await p17.keyboard.press('x');
  await p17.waitForTimeout(200);
  ok((await p17.textContent('#status')).includes('Editing the Markdown file is off in Settings') && await writes17() === 0
    && await p17.evaluate(() => window.__files['/d/a.md']) === tall, 'x says editing is off and writes nothing');
  // Delete still says so, as before.
  await clearStatus();
  await p17.keyboard.press('Backspace');
  await p17.waitForTimeout(200);
  ok((await p17.textContent('#status')).includes('off in Settings'), 'Backspace with Direct edits off still says editing is off');
}
await seventeen.close();
const eighteen = await session({ '/d/a.md': raw });
{
  const p = await spot('brave', 'end', eighteen.page);
  await eighteen.page.mouse.click(p.x, p.y);
  await eighteen.page.waitForTimeout(100);
  const before = await size(eighteen.page);
  await eighteen.page.keyboard.press('+');
  await eighteen.page.waitForTimeout(400);
  ok(await eighteen.page.evaluate(() => window.__files['/d/a.md']) === raw.replace('brave new', 'brave+ new') && before === await size(eighteen.page),
    'With Direct edits on, + is typed into the file and does not zoom');
}
await eighteen.close();

// ── Session 19: a re-render while the reader types in another field leaves that field's focus and selection alone ──
const nineteen = await session({ '/d/a.md': raw });
{
  const p19 = nineteen.page;
  const p = await spot('brave', 'end', p19);
  await p19.mouse.click(p.x, p.y);
  await p19.waitForTimeout(100);
  await p19.keyboard.press('Control+f');
  await p19.waitForTimeout(200);
  await p19.keyboard.type('abcde');
  await p19.keyboard.press('ArrowLeft');
  await p19.keyboard.press('ArrowLeft');
  const field = () => p19.evaluate(() => {
    const el = document.activeElement;
    return { id: el.id, value: el.value, at: el.selectionStart, end: el.selectionEnd };
  });
  const typing = await field();
  await p19.evaluate((external) => {
    window.__files['/d/a.md'] = external;
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 9 });
  }, 'Added line.\n\n' + raw);
  await p19.waitForTimeout(600);
  const kept = await field();
  const outside = await p19.evaluate(() => {
    const anchor = getSelection().anchorNode;
    return !anchor || !document.getElementById('markdown').contains(anchor);
  });
  ok(typing.id === 'findInput' && typing.value === 'abcde' && typing.at === 3,
    `The find field has focus with a caret inside its text (${JSON.stringify(typing)})`);
  ok(JSON.stringify(kept) === JSON.stringify(typing) && outside,
    `A re-render while typing in the find field keeps its focus, text and caret, and the window selection stays out of the article (${JSON.stringify(kept)})`);
  // Back in the text, the changed file takes a typed key at the clicked place.
  const back = await spot('brave', 'end', p19);
  await p19.mouse.click(back.x, back.y);
  await p19.waitForTimeout(100);
  await p19.keyboard.press('Z');
  await p19.waitForTimeout(400);
  ok(await p19.evaluate(() => window.__files['/d/a.md']) === ('Added line.\n\n' + raw).replace('brave new', 'braveZ new'),
    'and a click back into the text types at that place in the changed file');
}
await nineteen.close();

// ── Session 20: a paragraph wrapped over three lines, caret on line 2: typed keys land in order, and the caret is put back ──
const wrapped = 'First line of the\nsecond line has words\nthird line ends here.\n\nNext paragraph.\n';
const twenty = await session({ '/d/a.md': wrapped });
{
  const p20 = twenty.page;
  const file20 = () => p20.evaluate(() => { const f = window.__files['/d/a.md']; return typeof f === 'object' ? f.raw : f; });
  const p = await spot('words', 'end', p20);
  await p20.mouse.click(p.x, p.y);
  await p20.waitForTimeout(100);
  await p20.keyboard.press('x');
  await p20.waitForTimeout(400);
  await p20.keyboard.press('y');
  await p20.waitForTimeout(400);
  ok(await file20() === wrapped.replace('words', 'wordsxy'), `Two keys typed on line 2 of a wrapped paragraph land in order (${JSON.stringify(await file20())})`);
  const before = await p20.evaluate(() => {
    const s = getSelection();
    return s.anchorNode?.nodeType === 3 ? s.anchorNode.textContent.slice(0, s.anchorOffset).split(/\s+/).slice(-1)[0] : null;
  });
  ok(before === 'wordsxy', `and the caret is back after the typed text (${JSON.stringify(before)})`);
  ok(!(await p20.textContent('#status')).includes('could not be placed'), 'with no caret message');
}
{
  const result = await twenty.page.evaluate(async () => {
    const m = await import('/caret-edit.mjs');
    const raw = 'First line of the\nsecond line has words\nthird line ends here.\n\nNext paragraph.\n';
    const text = 'First line of the second line has words third line ends here.';
    const out = {};
    const at2 = raw.indexOf('words') + 'wor'.length;
    const at3 = raw.indexOf('ends') + 'en'.length;
    const first = m.nodeAtOffset(raw, 4, [text]);
    out.line1 = first && first.at;
    const second = m.nodeAtOffset(raw, at2, [text]);
    out.line2 = second && [second.index, second.at];
    const third = m.nodeAtOffset(raw, at3, [text]);
    out.line3 = third && [third.index, third.at];
    out.want2 = text.indexOf('words') + 3;
    out.want3 = text.indexOf('ends') + 2;
    // A paragraph after a blank line starts its own block.
    const next = m.nodeAtOffset(raw, raw.indexOf('paragraph') + 3, ['Next paragraph.', text]);
    out.next = next && [next.index, next.at];
    return out;
  });
  ok(result.line1 === 4 && JSON.stringify(result.line2) === JSON.stringify([0, result.want2]) && JSON.stringify(result.line3) === JSON.stringify([0, result.want3])
    && JSON.stringify(result.next) === JSON.stringify([0, 'Next paragraph.'.indexOf('paragraph') + 3]),
  `nodeAtOffset places a caret on line 1, 2 and 3 of a wrapped paragraph, and after a blank line (${JSON.stringify(result)})`);
}
await twenty.close();

// ── Session 21: a presentation never edits the file ──
const longMd = Array.from({ length: 300 }, (_, n) => `Paragraph ${n + 1} has some words in it, enough to fill a line or so of a page.`).join('\n\n') + '\n';
const twentyone = await session({ '/d/a.md': longMd });
{
  const p21 = twentyone.page;
  const centred = () => p21.evaluate(() => {
    const stage = document.getElementById('markdownStage').getBoundingClientRect();
    const middle = stage.top + stage.height / 2;
    return [...document.querySelectorAll('#markdown > .md-page')].findIndex((s) => { const r = s.getBoundingClientRect(); return r.top <= middle && r.bottom >= middle; });
  });
  const writes21 = () => p21.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  const p = await spot('Paragraph 1 ', 'end', p21);
  await p21.mouse.click(p.x, p.y);
  await p21.waitForTimeout(100);
  await p21.keyboard.press('F5');
  await p21.waitForTimeout(500);
  ok(await p21.evaluate(() => document.body.classList.contains('presenting')), 'F5 presents the Markdown file');
  // A click in the slide, as a presenter might make, then the stepping keys.
  const q = await spot('Paragraph 1 ', 'end', p21);
  await p21.mouse.click(q.x, q.y);
  await p21.waitForTimeout(100);
  const start = await centred();
  const seen = [start];
  for (const key of ['n', 'j', 'Space', 'Backspace']) {
    await p21.keyboard.press(key);
    await p21.waitForTimeout(250);
    seen.push(await centred());
  }
  ok(JSON.stringify(seen) === JSON.stringify([start, start + 1, start + 2, start + 3, start + 2]),
    `n, j and Space step the slides forward and Backspace back, with the caret in the slide (${JSON.stringify(seen)})`);
  await p21.keyboard.press('Delete');
  await p21.waitForTimeout(250);
  await p21.keyboard.press('x');
  await p21.waitForTimeout(250);
  ok(await writes21() === 0 && await p21.evaluate(() => window.__files['/d/a.md']) === longMd, `Presenting writes nothing to the file (${await writes21()} writes)`);
  await p21.keyboard.press('Escape');
  await p21.waitForTimeout(400);
  ok(!(await p21.evaluate(() => document.body.classList.contains('presenting'))) && await p21.$eval('#markdown', (el) => el.isContentEditable),
    'Esc leaves the presentation and the article takes a caret again');
  const back = await spot('Paragraph 1 ', 'end', p21);
  await p21.mouse.click(back.x, back.y);
  await p21.waitForTimeout(100);
  await p21.keyboard.press('x');
  await p21.waitForTimeout(400);
  // The harness counts an edit_markdown call even when the command rejects it: the file must hold the key as well.
  ok(await p21.evaluate(() => window.__files['/d/a.md']) === longMd.replace('Paragraph 1 has', 'Paragraph 1 xhas') && await writes21() === 1,
    'and a typed key writes again after the presentation');
  // A composition that starts before the presentation and ends in it writes nothing, shows the file as it is, and
  // leaves no composing state behind: a dead-key composition after the presentation writes once.
  const fileNow = await p21.evaluate(() => window.__files['/d/a.md']);
  const writesBefore = await writes21();
  const q2 = await spot('Paragraph 2 ', 'end', p21);
  await p21.mouse.click(q2.x, q2.y);
  await p21.waitForTimeout(100);
  await p21.evaluate(() => {
    const el = document.getElementById('markdown');
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    // The browser draws the composing text in the article.
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while (walk.nextNode()) if (walk.currentNode.textContent.includes('Paragraph 2 has')) { node = walk.currentNode; break; }
    node.textContent = node.textContent.replace('Paragraph 2 has', 'Paragraph 2 éhas');
  });
  await p21.keyboard.press('F5');
  await p21.waitForTimeout(500);
  await p21.evaluate(() => document.getElementById('markdown').dispatchEvent(new CompositionEvent('compositionend', { data: 'é', bubbles: true })));
  await p21.waitForTimeout(400);
  ok(await writes21() === writesBefore && await p21.evaluate(() => window.__files['/d/a.md']) === fileNow,
    `A composition that ends in the presentation writes nothing (${await writes21() - writesBefore} writes)`);
  ok(await p21.evaluate(() => !document.getElementById('markdown').textContent.includes('Paragraph 2 éhas')),
    'and the composed text is not left in the article');
  await p21.keyboard.press('Escape');
  await p21.waitForTimeout(400);
  const back2 = await spot('Paragraph 2 ', 'end', p21);
  await p21.mouse.click(back2.x, back2.y);
  await p21.waitForTimeout(100);
  const dead = await p21.evaluate(() => {
    const el = document.getElementById('markdown');
    const e = new KeyboardEvent('keydown', { key: 'Dead', bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'é', bubbles: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { data: 'é', bubbles: true }));
    return e.defaultPrevented;
  });
  await p21.waitForTimeout(400);
  ok(dead === false && await writes21() === writesBefore + 1
    && await p21.evaluate(() => window.__files['/d/a.md']) === fileNow.replace('Paragraph 2 has', 'Paragraph 2 éhas'),
  `A dead key and its composition work outside the presentation: one write (${await writes21() - writesBefore})`);
}
await twentyone.close();

// ── Session 22: the block around a caret is its own paragraph, list item or heading, however long ──
const twentytwo = await session({ '/d/a.md': raw });
{
  const result = await twentytwo.page.evaluate(async () => {
    const m = await import('/caret-edit.mjs');
    const out = {};
    // A paragraph of 450 lines (more than the 400 lines the scan once stopped at), the caret on its last line and on its first.
    const lines = Array.from({ length: 450 }, (_, n) => `line ${n + 1} of the long paragraph`);
    const long = `${lines.join('\n')}\n\nNext one.\n`;
    const text = lines.join(' ');
    const last = long.indexOf('line 450') + 'line 45'.length;
    const lastNode = m.nodeAtOffset(long, last, [text]);
    out.last = lastNode && [lastNode.index, lastNode.at];
    out.wantLast = text.indexOf('line 450') + 'line 45'.length;
    const firstNode = m.nodeAtOffset(long, 3, [text]);
    out.first = firstNode && [firstNode.index, firstNode.at];
    // Two adjacent list items with the same text: the caret in the second belongs to the second.
    const list = '- same words\n- same words\n';
    const second = list.indexOf('- same words', 1) + '- same wo'.length;
    const inSecond = m.nodeAtOffset(list, second, ['same words']);
    out.second = inSecond && [inSecond.index, inSecond.at, inSecond.start, inSecond.end];
    out.wantSecond = [0, 'same wo'.length, list.indexOf('same words', 5), list.indexOf('same words', 5) + 'same words'.length];
    const inFirst = m.nodeAtOffset(list, 5, ['same words']);
    out.firstItem = inFirst && [inFirst.index, inFirst.at, inFirst.start];
    // A heading and the line under it, with the same text: each is its own block.
    const head = '# Same\nSame\n';
    const under = m.nodeAtOffset(head, head.lastIndexOf('Same') + 2, ['Same']);
    out.under = under && [under.index, under.at, under.start];
    const over = m.nodeAtOffset(head, 4, ['Same']);
    out.over = over && [over.index, over.at, over.start];
    // A list item wrapped over two lines is one block; so is a numbered one.
    const wrapped = '1. first part\n   second part\n2. first part second part\n';
    const onWrap = m.nodeAtOffset(wrapped, wrapped.indexOf('second') + 3, ['first part second part']);
    out.wrap = onWrap && [onWrap.index, onWrap.at];
    out.wantWrap = 'first part '.length + 3;
    return out;
  });
  ok(JSON.stringify(result.last) === JSON.stringify([0, result.wantLast]) && JSON.stringify(result.first) === JSON.stringify([0, 3]),
    `nodeAtOffset places a caret on the first and the last line of a 450-line paragraph (${JSON.stringify(result)})`);
  ok(JSON.stringify(result.second) === JSON.stringify(result.wantSecond) && JSON.stringify(result.firstItem) === JSON.stringify([0, 3, 2]),
    `a caret in the second of two identical list items belongs to the second, and one in the first to the first (${JSON.stringify(result)})`);
  ok(JSON.stringify(result.under) === JSON.stringify([0, 2, 7]) && JSON.stringify(result.over) === JSON.stringify([0, 2, 2])
    && JSON.stringify(result.wrap) === JSON.stringify([0, result.wantWrap]),
  `a heading and the line under it are separate blocks, and a wrapped list item is one (${JSON.stringify(result)})`);
}
await twentytwo.close();

// ── Session 23: identical neighbours: a click in the first of two identical list items, a file changed under two identical paragraphs ──
const twentythree = await session({ '/d/a.md': raw });
{
  const result = await twentythree.page.evaluate(async () => {
    const m = await import('/caret-edit.mjs');
    const out = {};
    // Two adjacent list items with identical text: a click in each is placed in that item.
    const list = '- same words\n- same words\n';
    out.first = m.offsetInText(list, 1, 'same words', 4);
    out.second = m.offsetInText(list, 2, 'same words', 4);
    // The same for a numbered list, and for a heading over a line of identical text.
    const numbered = '1. same\n2. same\n';
    out.numbered = [m.offsetInText(numbered, 1, 'same', 2).offset, m.offsetInText(numbered, 2, 'same', 2).offset];
    const head = '# Same\nSame\n';
    out.head = [m.offsetInText(head, 1, 'Same', 2).offset, m.offsetInText(head, 2, 'Same', 2).offset];
    // Text that repeats inside one item is still refused.
    out.repeat = m.offsetInText('- a b a b\n', 1, 'a b a b', 1).offset;
    out.repeatNode = m.offsetInText('- go on, go\n', 1, 'go', 1).error;
    // relocate: two identical paragraphs and a line added above; the caret was at the end of the second.
    const before = 'Alpha beta.\n\nAlpha beta.\n';
    const after = 'A long new line added above.\n\nAlpha beta.\n\nAlpha beta.\n';
    const near = before.length - 1;
    out.moved = m.relocate(after, 'Alpha beta.', 'Alpha beta.'.length, near);
    out.movedFirst = m.relocate(after, 'Alpha beta.', 3, 3);
    // Nothing moved above the caret, but the copies are still identical: no copy is chosen.
    out.stayed = m.relocate(`${before}Tail.\n`, 'Alpha beta.', 'Alpha beta.'.length, near);
    // A 13-character line is prepended: the FIRST copy's caret place is now the old offset 16, and it is not the caret's copy.
    out.prepended = m.relocate('12345678901\n\nAlpha beta.\n\nAlpha beta.\n', 'Alpha beta.', 3, 16);
    // The line added above is 7 characters: the old offset 16 lies inside the first copy's new span, which is not the caret's copy.
    out.shortLine = m.relocate('Short\n\nAlpha beta.\n\nAlpha beta.\n', 'Alpha beta.', 3, 16);
    // One match: the same as before, wherever the old offset was.
    out.single = m.relocate('New.\n\nAlpha beta.\n', 'Alpha beta.', 3, 0);
    out.gone = m.relocate('Nothing here.\n', 'Alpha beta.', 3, 0);
    return out;
  });
  ok(result.first.offset === 6 && result.first.start === 2 && result.first.end === 12
    && result.second.offset === 19 && result.second.start === 15 && result.second.end === 25,
  `a click in the first of two identical list items is placed there, and one in the second in the second (${JSON.stringify(result)})`);
  ok(JSON.stringify(result.numbered) === JSON.stringify([5, 13]) && JSON.stringify(result.head) === JSON.stringify([4, 9]),
    `the same holds for numbered items and for a heading over identical text (${JSON.stringify(result)})`);
  ok(result.repeat === 3 && result.repeatNode === 'repeated',
    `and a repeat inside one item is still refused when the run cannot be told apart (${JSON.stringify(result.repeat)}, ${result.repeatNode})`);
  ok(result.moved === null && result.movedFirst === null,
    `relocate returns nothing for two identical copies when the text above them moved (${JSON.stringify([result.moved, result.movedFirst])})`);
  ok(result.shortLine === null && result.prepended === null && result.stayed === null,
    `relocate returns nothing for several identical copies, whatever the old offset (${JSON.stringify([result.shortLine, result.prepended, result.stayed])})`);
  ok(result.single?.offset === 9 && result.gone === null,
    `and still finds a single match anywhere, and nothing for gone text (${JSON.stringify([result.single, result.gone])})`);
}
await twentythree.close();
{
  // In the page: two identical paragraphs, the file changes on disk with a line added above, the caret was in the second.
  const twins = 'Alpha beta.\n\nAlpha beta.\n';
  const changed = 'A long new line added above.\n\n' + twins;
  const s24 = await session({ '/d/a.md': twins });
  const p24 = s24.page;
  const secondEnd = () => p24.evaluate(() => {
    const walk = document.createTreeWalker(document.querySelector('#markdown'), NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) if (walk.currentNode.textContent.includes('Alpha beta.')) nodes.push(walk.currentNode);
    const range = document.createRange();
    range.setStart(nodes.at(-1), nodes.at(-1).textContent.length);
    range.collapse(true);
    const box = range.getBoundingClientRect();
    return { x: box.left - 1, y: box.top + box.height / 2 };
  });
  const at = await secondEnd();
  await p24.mouse.click(at.x, at.y);
  await p24.waitForTimeout(150);
  await p24.evaluate((external) => {
    window.__files['/d/a.md'] = external;
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 9 });
  }, changed);
  await p24.waitForTimeout(600);
  await p24.keyboard.press('Z');
  await p24.waitForTimeout(400);
  const after = await p24.evaluate(() => window.__files['/d/a.md']);
  ok(after === changed || after === changed.replace(/Alpha beta\.\n$/, 'Alpha beta.Z\n'),
    `A key typed after the file changed under two identical paragraphs lands in the second or nowhere, never in the first (${JSON.stringify(after)})`);
  ok(after === changed && await p24.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length) === 0,
    'and with the copies told apart by nothing, no write is sent');
  await s24.close();
}
{
  // In the page: a 13-character line is prepended, so the first copy's caret place equals the old offset (16) of a caret 3 characters into the second.
  const twins = 'Alpha beta.\n\nAlpha beta.\n';
  const changed = '12345678901\n\n' + twins;
  const s25 = await session({ '/d/a.md': twins });
  const p25 = s25.page;
  const at = await p25.evaluate(() => {
    const walk = document.createTreeWalker(document.querySelector('#markdown'), NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) if (walk.currentNode.textContent.includes('Alpha beta.')) nodes.push(walk.currentNode);
    const range = document.createRange();
    range.setStart(nodes.at(-1), 3);
    range.collapse(true);
    const box = range.getBoundingClientRect();
    return { x: box.left - 1, y: box.top + box.height / 2 };
  });
  await p25.mouse.click(at.x, at.y);
  await p25.waitForTimeout(150);
  await p25.evaluate((external) => {
    window.__files['/d/a.md'] = external;
    window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 9 });
  }, changed);
  await p25.waitForTimeout(600);
  await p25.keyboard.press('Z');
  await p25.waitForTimeout(400);
  const after = await p25.evaluate(() => window.__files['/d/a.md']);
  ok(after === changed && await p25.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length) === 0,
    `A prepended line that puts the first copy's caret place on the old offset does not send the key to the first paragraph (${JSON.stringify(after)})`);
  await s25.close();
}

// ── Session 26: F5 twice, or F5 and a tab switch, before the start ends: one presentation, of the file shown at the first F5 ──
{
  const s26 = await session({ '/d/a.md': 'File a text.\n\nMore of a.\n', '/d/b.md': 'File b text.\n\nMore of b.\n' });
  const p26 = s26.page;
  await p26.evaluate(() => window.__emit('open-files', ['/d/b.md']));
  await p26.waitForTimeout(500);
  await p26.keyboard.press('Control+1');
  await p26.waitForTimeout(400);
  const full = () => p26.evaluate(() => window.__calls.filter(([cmd, args]) => cmd === 'setFullscreen' && args.on).length);
  const presenting = () => p26.evaluate(() => document.body.classList.contains('presenting'));
  const shown = () => p26.$eval('#markdown p', (p) => p.textContent.trim());
  await p26.evaluate(() => { window.__fullscreenDelay = 600; });
  await p26.keyboard.press('F5');
  await p26.keyboard.press('F5');
  await p26.waitForTimeout(1000);
  ok(await presenting() && await full() === 1 && (await shown()).startsWith('File a'),
    `F5 twice in quick succession presents once, the file shown (${await full()} fullscreen calls, ${await shown()})`);
  await p26.keyboard.press('Escape');
  await p26.waitForTimeout(400);
  ok(!(await presenting()), 'and one Esc leaves it');
  // F5, then a switch to the other tab before the start has finished: nothing is presented.
  await p26.evaluate(() => { window.__fullscreenDelay = 600; });
  await p26.keyboard.press('F5');
  await p26.waitForTimeout(100);
  await p26.keyboard.press('Control+2');
  await p26.waitForTimeout(1000);
  ok(!(await presenting()) && await full() === 1 && (await shown()).startsWith('File b'),
    `F5 then a tab switch before the start ends presents nothing, and the other tab is shown (${await presenting()}, ${await full()} fullscreen calls, ${await shown()})`);
  // The lock is released: F5 on the shown file presents it.
  await p26.keyboard.press('F5');
  await p26.waitForTimeout(500);
  ok(await presenting() && (await shown()).startsWith('File b'), 'and a later F5 presents the file shown');
  await s26.close();
}
{
  // In the page: a key typed at the end of the 450-line paragraph lands there.
  const longRaw = `${Array.from({ length: 450 }, (_, n) => `line ${n + 1} of the long paragraph`).join('\n')}\n\nNext one.\n`;
  const big = await session({ '/d/a.md': longRaw });
  const pg = big.page;
  await pg.evaluate(() => {
    const walk = document.createTreeWalker(document.querySelector('#markdown'), NodeFilter.SHOW_TEXT);
    let node;
    while (walk.nextNode()) if (walk.currentNode.textContent.includes('line 450')) { node = walk.currentNode; break; }
    node.parentElement.scrollIntoView({ block: 'end' });
  });
  await pg.waitForTimeout(200);
  const at = await spot('line 450 of the long paragraph', 'end', pg);
  await pg.mouse.click(at.x, at.y);
  await pg.waitForTimeout(100);
  await pg.keyboard.press('x');
  await pg.waitForTimeout(400);
  const writes = await pg.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  ok(writes === 1 && await pg.evaluate(() => window.__files['/d/a.md']) === longRaw.replace('line 450 of the long paragraph', 'line 450 of the long paragraphx'),
    `A key typed at the end of a 450-line paragraph lands there (${writes} writes)`);
  await big.close();
}

// ── Session 27: Delete over a mouse selection while presenting writes nothing; it still removes the text afterwards ──
{
  const text27 = 'Hello brave new world.\n\nSecond paragraph here.\n';
  dialogs = 0;
  const s27 = await session({ '/d/a.md': text27 });
  const p27 = s27.page;
  const writes27 = () => p27.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  const file27 = () => p27.evaluate(() => window.__files['/d/a.md']);
  const drag27 = async (word) => {
    const a = await spot(word, 'start', p27);
    const b = await spot(word, 'end', p27);
    await p27.mouse.move(a.x, a.y);
    await p27.mouse.down();
    await p27.mouse.move(b.x, b.y, { steps: 5 });
    await p27.mouse.up();
    await p27.waitForTimeout(100);
    return p27.evaluate(() => getSelection().toString());
  };
  await p27.keyboard.press('F5');
  await p27.waitForTimeout(500);
  const picked = await drag27('brave');
  ok(picked === 'brave', `a mouse drag in the slide selects the word (${JSON.stringify(picked)})`);
  await p27.keyboard.press('Delete');
  await p27.waitForTimeout(400);
  ok(await writes27() === 0 && await file27() === text27 && !dialogs,
    `Delete over a selection while presenting writes nothing and asks nothing (${await writes27()} writes, ${dialogs} dialogs)`);
  // The other ways to act on the same selection: format and edit shortcuts, the right-click menu, the palette.
  await p27.keyboard.press('Control+b');
  await p27.keyboard.press('Control+e');
  await p27.waitForTimeout(300);
  const at27 = await spot('brave', 'mid', p27);
  await p27.mouse.click(at27.x, at27.y, { button: 'right' });
  await p27.waitForTimeout(200);
  ok(await p27.evaluate(() => document.getElementById('reviewMenu').hidden && document.getElementById('editBox').hidden),
    'no edit box or right-click menu over the selection while presenting');
  await drag27('brave');
  await p27.keyboard.press('Control+k');
  await p27.keyboard.type('Remove the selection');
  const listed = await p27.evaluate(() => [...document.querySelectorAll('.palette-item .palette-label')].some((l) => l.textContent.includes('Remove the selection from the file')));
  await p27.keyboard.press('Enter');
  await p27.waitForTimeout(400);
  ok(!listed && await writes27() === 0 && await file27() === text27 && !dialogs,
    `the palette does not offer "Remove the selection" while presenting, and the file is unchanged (${await writes27()} writes)`);
  // The first Esc closes the palette (nothing matched), the second leaves the presentation.
  await p27.keyboard.press('Escape');
  await p27.waitForTimeout(200);
  await p27.keyboard.press('Escape');
  await p27.waitForTimeout(400);
  ok(!(await p27.evaluate(() => document.body.classList.contains('presenting'))), 'Esc leaves the presentation');
  // The normal path is intact.
  await drag27('brave');
  await p27.keyboard.press('Delete');
  await p27.waitForTimeout(400);
  ok(await writes27() === 1 && await file27() === 'Hello new world.\n\nSecond paragraph here.\n',
    `after the presentation, Delete over a selection removes it (${await writes27()} writes, ${JSON.stringify(await file27())})`);
  await s27.close();
}

// Session 27, round 2: the other writes a slide could reach. A figure click, Undo, an Edit box left open.
{
  // A figure picked in a slide shows no resizer, and a drag on the grip writes no width; outside the slide both work.
  const figure = {
    raw: '![A swatch](swatch.png)\n\nText below.\n',
    html: '<p><span class="src" data-line="1"></span><img data-doc="/d/swatch.png" alt="A swatch"></p>\n<p><span class="src" data-line="3"></span>Text below.</p>',
  };
  const sf = await session({ '/d/a.md': figure });
  const pf = sf.page;
  await pf.waitForFunction(() => [...document.querySelectorAll('#markdown img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {});
  const writesF = () => pf.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  const resizerShown = () => pf.evaluate(() => !document.getElementById('figureResizer').hidden);
  // The grip is not clickable in a slide (the stylesheet hides it): the drag is sent as events.
  const dragGrip = () => pf.evaluate(async () => {
    const grip = document.getElementById('figureResizerGrip');
    grip.setPointerCapture = () => {};
    const fire = (type, x) => grip.dispatchEvent(new PointerEvent(type, { button: 0, clientX: x, pointerId: 1, bubbles: true }));
    fire('pointerdown', 100);
    fire('pointermove', 180);
    fire('pointerup', 180);
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await pf.keyboard.press('F5');
  await pf.waitForTimeout(500);
  const fig = await pf.$eval('#markdown img', (img) => { const r = img.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await pf.mouse.click(fig.x, fig.y);
  await pf.waitForTimeout(200);
  const shownIn = await resizerShown();
  await dragGrip();
  ok(!shownIn && await writesF() === 0,
    `a click on a figure while presenting shows no resizer, and a drag on the grip writes no width (shown ${shownIn}, ${await writesF()} writes)`);
  await pf.keyboard.press('Escape');
  await pf.waitForTimeout(400);
  const fig2 = await pf.$eval('#markdown img', (img) => { const r = img.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await pf.mouse.click(fig2.x, fig2.y);
  await pf.waitForTimeout(200);
  const shownOut = await resizerShown();
  await dragGrip();
  ok(shownOut && await writesF() === 1, `after the presentation, a figure click shows the resizer and a drag writes the width (shown ${shownOut}, ${await writesF()} writes)`);
  await sf.close();
}
{
  // Undo (Ctrl+Z, the palette) does nothing in a slide and is not offered; after Esc it undoes.
  const text = 'Hello brave new world.\n\nSecond paragraph here.\n';
  const su = await session({ '/d/a.md': text });
  const pu = su.page;
  const writesU = () => pu.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  const fileU = () => pu.evaluate(() => window.__files['/d/a.md']);
  const typed = text.replace('Hello ', 'Hello x');
  const at = await spot('Hello ', 'end', pu);
  await pu.mouse.click(at.x, at.y);
  await pu.waitForTimeout(100);
  await pu.keyboard.press('x');
  await pu.waitForTimeout(500);
  ok(await fileU() === typed && await writesU() === 1, `a typed key is written, and can be undone (${await writesU()} writes)`);
  // Control: the palette offers Undo outside a slide.
  await pu.keyboard.press('Control+k');
  await pu.keyboard.type('Undo');
  ok(await pu.evaluate(() => [...document.querySelectorAll('.palette-item .palette-label')].some((l) => l.textContent.trim() === 'Undo')),
    'the palette offers Undo outside a presentation');
  await pu.keyboard.press('Escape');
  await pu.waitForTimeout(200);
  await pu.keyboard.press('F5');
  await pu.waitForTimeout(500);
  await pu.keyboard.press('Control+z');
  await pu.waitForTimeout(500);
  ok(await writesU() === 1 && await fileU() === typed, `Ctrl+Z while presenting writes nothing (${await writesU()} writes)`);
  await pu.keyboard.press('Control+k');
  await pu.keyboard.type('Undo');
  const offered = await pu.evaluate(() => [...document.querySelectorAll('.palette-item .palette-label')].some((l) => l.textContent.trim() === 'Undo'));
  await pu.keyboard.press('Enter');
  await pu.waitForTimeout(400);
  ok(!offered && await writesU() === 1 && await fileU() === typed, `the palette does not offer Undo while presenting (offered ${offered}, ${await writesU()} writes)`);
  await pu.keyboard.press('Escape');
  await pu.waitForTimeout(200);
  await pu.keyboard.press('Escape');
  await pu.waitForTimeout(400);
  await pu.keyboard.press('Control+z');
  await pu.waitForTimeout(500);
  ok(await fileU() === text, `after the presentation, Ctrl+Z undoes the typed key (${JSON.stringify(await fileU())})`);
  await su.close();
}
{
  // An Edit box left open when F5 is pressed is closed, and its save writes nothing.
  const text = 'Hello brave new world.\n\nSecond paragraph here.\n';
  const se = await session({ '/d/a.md': text });
  const pe = se.page;
  const writesE = () => pe.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  const a = await spot('brave', 'start', pe);
  const b = await spot('brave', 'end', pe);
  await pe.mouse.move(a.x, a.y);
  await pe.mouse.down();
  await pe.mouse.move(b.x, b.y, { steps: 5 });
  await pe.mouse.up();
  await pe.keyboard.press('Control+e');
  await pe.waitForTimeout(200);
  ok(await pe.evaluate(() => !document.getElementById('editBox').hidden), 'Ctrl+E opens the Edit box');
  await pe.fill('#editText', 'bold');
  await pe.keyboard.press('F5');
  await pe.waitForTimeout(500);
  const open = await pe.evaluate(() => !document.getElementById('editBox').hidden);
  await pe.evaluate(() => document.getElementById('editSave').click());
  await pe.waitForTimeout(400);
  ok(!open && await writesE() === 0 && await pe.evaluate(() => window.__files['/d/a.md']) === text,
    `an Edit box open at F5 is closed and its save writes nothing (open ${open}, ${await writesE()} writes)`);
  await se.close();
}
{
  // The review note box can insert a parenthetical into the file: it is not offered in a slide, and one left open at F5 is closed.
  const text = 'Hello brave new world.\n\nSecond paragraph here.\n';
  const sn = await session({ '/d/a.md': text });
  const pn = sn.page;
  const writesN = () => pn.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  const fileN = () => pn.evaluate(() => window.__files['/d/a.md']);
  const dragN = async () => {
    const a = await spot('brave', 'start', pn);
    const b = await spot('brave', 'end', pn);
    await pn.mouse.move(a.x, a.y);
    await pn.mouse.down();
    await pn.mouse.move(b.x, b.y, { steps: 5 });
    await pn.mouse.up();
    await pn.waitForTimeout(100);
  };
  const offeredN = () => pn.evaluate(() => [...document.querySelectorAll('.palette-item .palette-label')].some((l) => l.textContent.includes('Parenthetical definition')));
  await dragN();
  await pn.keyboard.press('Control+k');
  await pn.keyboard.type('Parenthetical');
  const offeredOut = await offeredN();
  await pn.keyboard.press('Enter');
  await pn.waitForTimeout(300);
  const boxOut = await pn.evaluate(() => !document.getElementById('noteBox').hidden);
  ok(offeredOut && boxOut, `outside a presentation the palette offers the definition and opens the note box (${offeredOut}, ${boxOut})`);
  await pn.fill('#noteText', 'a bold one');
  await pn.keyboard.press('F5');
  await pn.waitForTimeout(500);
  const boxIn = await pn.evaluate(() => !document.getElementById('noteBox').hidden);
  await pn.evaluate(() => document.getElementById('noteInsert').click());
  await pn.waitForTimeout(400);
  ok(!boxIn && await writesN() === 0 && await fileN() === text, `a note box open at F5 is closed and inserts nothing (open ${boxIn}, ${await writesN()} writes)`);
  await dragN();
  await pn.keyboard.press('Control+k');
  await pn.keyboard.type('Parenthetical');
  const offeredIn = await offeredN();
  await pn.keyboard.press('Enter');
  await pn.waitForTimeout(300);
  const boxAfter = await pn.evaluate(() => !document.getElementById('noteBox').hidden);
  ok(!offeredIn && !boxAfter && await writesN() === 0, `the palette does not offer the definition while presenting, and no note box opens (${offeredIn}, ${boxAfter})`);
  await sn.close();
}

// ── Session 5: a text run beside markup that repeats in its block (a *b* a *b* a) is refused, and nothing is written ──
const five = await session({
  '/d/a.md': {
    raw: 'Start a *b* a *b* a end.\n',
    html: '<p><span class="src" data-line="1"></span>Start a <em>b</em> a <em>b</em> a end.</p>',
  },
});
{
  await five.page.evaluate(() => {
    const walk = document.createTreeWalker(document.querySelector('#markdown'), NodeFilter.SHOW_TEXT);
    let node;
    while (walk.nextNode()) if (walk.currentNode.textContent === ' a ') { node = walk.currentNode; break; }
    const range = document.createRange();
    range.setStart(node, 1);
    range.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    document.getElementById('markdown').focus();
  });
  await five.page.waitForTimeout(150);
  await five.page.keyboard.press('x');
  await five.page.waitForTimeout(300);
  const writes = await five.page.evaluate(() => window.__calls.filter(([cmd]) => cmd === 'edit_markdown').length);
  ok((await five.page.textContent('#status')).includes('appears more than once') && writes === 0
    && await five.page.evaluate(() => window.__files['/d/a.md'].raw) === 'Start a *b* a *b* a end.\n',
  'A caret in a run beside markup that repeats in its block is refused with the repeated message, and nothing is written');
}
await five.finish();
