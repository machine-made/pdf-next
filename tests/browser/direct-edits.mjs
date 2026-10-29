// Direct edits to the Markdown file: the format keys, the right-click menu,
// Edit text…, Delete, Undo, and the Settings switch that turns them off.
import { start } from './harness.mjs';

const raw = 'One alpha two.\n\nThree bravo four.\n\nFive charlie six.\n\nSeven delta eight.\n\nNine echo ten.\n';
const { page, ok, selectText, finish } = await start({ files: { '/d/a.md': raw } });
const file = () => page.evaluate(() => window.__files['/d/a.md']);
const settle = (ms = 300) => page.waitForTimeout(ms);
const status = () => page.textContent('#status');
const undo = async () => {
  await page.click('#markdown', { position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await settle();
};

await selectText('#markdown', 'alpha');
await page.keyboard.press('Control+b');
await settle();
ok((await file()).startsWith('One **alpha** two.'), 'Ctrl+B makes the selection bold in the file');
ok((await status()).includes('Bold · saved to a.md'), 'The status line says what was saved');
ok(await page.$eval('#markdown p', (p) => p.textContent.includes('**alpha**')), 'The page shows the file as it now is');
await selectText('#markdown', 'bravo');
await page.keyboard.press('Control+i');
await settle();
ok((await file()).includes('Three *bravo* four.'), 'Ctrl+I makes it italic');
await selectText('#markdown', 'charlie');
await page.keyboard.press('Control+s');
await settle();
ok((await file()).includes('Five ~~charlie~~ six.'), 'Ctrl+S strikes it through');

await selectText('#markdown', 'delta');
const sel = await page.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.mouse.click(sel.x, sel.y, { button: 'right' });
await settle(100);
ok(await page.$eval('#reviewMenu', (m) => !m.hidden) && await page.$eval('#reviewMenuEdit', (g) => !g.hidden), 'Right-click on a selection shows the edit menu');
await page.click('#reviewMenu button[data-format="code"]');
await settle();
ok((await file()).includes('Seven `delta` eight.'), 'Code from the menu wraps it in backticks');

await selectText('#markdown', 'echo');
await page.keyboard.press('Control+e');
await settle(100);
ok(await page.$eval('#editBox', (b) => !b.hidden) && await page.$eval('#editText', (t) => t.value) === 'echo', 'Ctrl+E opens Edit text with the source of the selection');
await page.fill('#editText', 'echoes and more');
await page.keyboard.press('Control+Enter');
await settle();
ok((await file()).includes('Nine echoes and more ten.') && await page.$eval('#editBox', (b) => b.hidden), 'Ctrl+Enter saves the new text');
await selectText('#markdown', 'Nine echoes');
await page.keyboard.press('Control+e');
await settle(100);
await page.keyboard.press('Escape');
await settle(100);
ok(await page.$eval('#editBox', (b) => b.hidden) && (await file()).includes('Nine echoes and more ten.'), 'Esc closes Edit text without writing');

await undo();
ok((await file()).includes('Nine echo ten.') && (await status()).includes('Undone: Edit'), 'Ctrl+Z undoes the last edit');
await undo();
ok((await file()).includes('Seven delta eight.'), 'and the one before');
await undo();
await undo();
await undo();
ok(await file() === raw, 'Undo walks back to the file as it was');
await undo();
ok((await status()).includes('Nothing to undo'), 'and then has nothing left');

await selectText('#markdown', 'bravo');
await page.keyboard.press('Delete');
await settle();
ok((await file()).includes('Three four.') || (await file()).includes('Three  four.'), `Delete removes the selected text (${JSON.stringify((await file()).split('\n\n')[1])})`);
await undo();
ok(await file() === raw, 'Undo puts it back');

await selectText('#markdown', 'bravo four');
await page.evaluate(() => {
  const p = document.querySelectorAll('#markdown p')[1];
  const range = document.createRange();
  range.setStart(p.lastChild, 6);
  range.setEnd(document.querySelectorAll('#markdown p')[2].lastChild, 4);
  getSelection().removeAllRanges();
  getSelection().addRange(range);
});
await page.keyboard.press('Control+b');
await settle();
ok(await file() === raw && (await status()).includes('within one paragraph'), 'A selection across two paragraphs is not formatted, and the status says why');

await page.evaluate(() => { window.__files['/d/a.md'] = window.__files['/d/a.md'].replace('alpha', 'ALPHA'); });
await selectText('#markdown', 'alpha');
await page.keyboard.press('Control+b');
await settle();
ok((await status()).includes('Could not edit the file') && await page.$eval('#status', (s) => s.classList.contains('error')), 'An edit the backend refuses (file changed) says so');
ok((await file()).startsWith('One ALPHA two.'), 'and writes nothing');
await page.evaluate(() => window.__emit('file-changed', { path: '/d/a.md', kind: 'changed', revision: 9 }));
await settle();

await page.click('#settingsToggle');
await page.uncheck('#setDirectEdits');
await page.keyboard.press('Escape');
await selectText('#markdown', 'bravo');
await page.keyboard.press('Control+b');
await settle();
ok((await status()).includes('Editing the Markdown file is off'), 'With edits off in Settings, Ctrl+B says so');
ok(!(await file()).includes('**bravo**'), 'and does not touch the file');
await finish();
