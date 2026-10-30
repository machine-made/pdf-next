// Finding your way: the outline and pages sidebar, back and forward through
// jumps, and previews of internal links, in a PDF and in Markdown.
import { start } from './harness.mjs';

const settle = (page, ms = 300) => page.waitForTimeout(ms);
const labelOf = (page) => page.$eval('#outlineTree', (t) => t.querySelector('.current .outline-label')?.textContent ?? '');

// navigate.pdf (from navigate.tex): four pages, an outline of six entries,
// and links on page 1 to an equation, a figure, a section and a reference.
{
  const { page, ok, shot, close } = await start({ initial: '/d/navigate.pdf' });
  await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
  await settle(page);
  const pageNo = () => page.$eval('#page', (input) => Number(input.value));
  const scrollTop = () => page.$eval('#viewerContainer', (c) => Math.round(c.scrollTop));

  ok(await page.$eval('#outline', (o) => o.hidden), 'The sidebar is off by default');
  const before = await page.$eval('#viewerContainer', (c) => c.getBoundingClientRect().left);
  await page.keyboard.press('Control+Shift+O');
  await page.waitForSelector('#outlineTree [role="treeitem"]');
  const labels = await page.$$eval('#outlineTree .outline-label', (l) => l.map((x) => x.textContent));
  ok(labels.join('|') === 'Introduction|Background|Method|Equations|Results|Conclusion', `Ctrl+Shift+O shows the PDF outline (${labels.join(', ')})`);
  const pages = await page.$$eval('#outlineTree .outline-page', (l) => l.map((x) => x.textContent).join(''));
  ok(pages === '112234', `Each entry names its page (${pages})`);
  ok(await page.$eval('#outlineTree [role="treeitem"]', (i) => i.getAttribute('aria-expanded')) === 'true', 'Sections with subsections are open');
  const after = await page.$eval('#viewerContainer', (c) => c.getBoundingClientRect().left);
  const width = await page.$eval('#outline', (o) => o.getBoundingClientRect().width);
  ok(Math.abs(after - before - width) < 2, `The sidebar pushes the page instead of covering it (${before} -> ${after}, ${width} px)`);
  const currentLabel = () => labelOf(page);
  ok(await currentLabel() === '', 'Above the first heading no section is current');
  await page.$eval('#viewerContainer', (c) => { c.scrollTop = 150; });
  await settle(page);
  ok(await currentLabel() === 'Introduction', `Below its heading the first section is current (${await currentLabel()})`);
  await page.$eval('#viewerContainer', (c) => { c.scrollTop = 0; });
  await settle(page);

  await page.click('#outlineTree .outline-item:has(> .outline-row .outline-label:text-is("Results")) > .outline-row');
  await settle(page, 500);
  ok(await pageNo() === 3, `Clicking Results goes to page 3 (${await pageNo()})`);
  ok(await currentLabel() === 'Results', 'Results is highlighted');
  await page.$eval('#viewerContainer', (c) => { c.scrollTop = c.scrollHeight; });
  await settle(page);
  ok(await currentLabel() === 'Conclusion', 'Scrolling to the end highlights Conclusion');

  // Keyboard: arrows move, Enter goes, Esc gives the page the keyboard back.
  await page.focus('#outlineTree [role="treeitem"]');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.activeElement.querySelector('.outline-label')?.textContent) === 'Method', 'ArrowDown moves through the outline');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => document.activeElement.querySelector('.outline-label')?.textContent) === 'Equations', 'ArrowRight goes into a section');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  ok(await page.$eval('#outlineTree [role="treeitem"]:nth-child(2)', (i) => i.getAttribute('aria-expanded')) === 'false', 'ArrowLeft closes a section');
  await page.keyboard.press('Enter');
  await settle(page, 500);
  ok(await pageNo() === 2, `Enter goes to Method (${await pageNo()})`);
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.activeElement.id) === 'viewerContainer', 'Esc gives the focus back to the page');
  await page.focus('#outlineTree [role="treeitem"]:nth-child(2)');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');

  // Back and forward.
  await page.keyboard.press('Alt+ArrowLeft');
  await settle(page);
  ok(await pageNo() === 4, `Alt+Left goes back to where Method was chosen (${await pageNo()})`);
  await page.keyboard.press('Alt+ArrowRight');
  await settle(page);
  ok(await pageNo() === 2, `Alt+Right goes forward again (${await pageNo()})`);
  await page.keyboard.press('g');
  await settle(page);
  await page.fill('#page', '3');
  await page.press('#page', 'Enter');
  await settle(page);
  const onThree = await scrollTop();
  await page.$eval('#viewerContainer', (c) => { c.scrollTop += 40; });
  await settle(page);
  await page.click('#viewerContainer', { position: { x: 5, y: 5 } });
  await page.keyboard.press('Alt+ArrowLeft');
  await settle(page);
  ok(await pageNo() === 1, `Back undoes the page entry; scrolling pushed nothing (${await pageNo()})`);
  await page.keyboard.press('Alt+ArrowLeft');
  await settle(page);
  ok(await pageNo() === 2, `Back again undoes g (${await pageNo()})`);
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 4 })));
  await settle(page);
  ok(await pageNo() === 1, 'The mouse forward button goes forward');
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 4 })));
  await settle(page);
  ok(await pageNo() === 3 && Math.abs(await scrollTop() - onThree - 40) < 4, 'Forward lands where you were, scroll included');
  await page.evaluate(() => window.dispatchEvent(new MouseEvent('mouseup', { button: 3 })));
  await settle(page);
  ok(await pageNo() === 1, 'The mouse back button goes back');

  // A link in the page: the preview, then the jump, then back.
  await page.selectOption('#zoom', '1');
  await page.keyboard.press('g');
  await settle(page, 600);
  const link = '#viewer .page[data-page-number="1"] .annotationLayer section[data-internal-link] > a[href*="equation"]';
  await page.waitForSelector(link);
  await page.hover(link);
  await page.waitForSelector('#linkPreview:not([hidden]) canvas', { timeout: 3000 }).catch(() => {});
  const card = await page.$eval('#linkPreview', (c) => ({
    hidden: c.hidden, caption: c.textContent, width: c.querySelector('canvas')?.width ?? 0, inside: c.getBoundingClientRect().right <= innerWidth && c.getBoundingClientRect().bottom <= innerHeight,
  }));
  ok(!card.hidden && card.caption === 'Page 2' && card.width > 0, `Hovering the equation link shows page 2 in a card (${card.caption})`);
  ok(card.inside, 'The card stays inside the window');
  ok(await page.$eval(link, (a) => a.getAttribute('aria-describedby')) === 'linkPreview', 'The link is described by the card');
  ok(await page.evaluate(() => document.activeElement.id) !== 'linkPreview', 'The card does not take the focus');
  const ink = await page.$eval('#linkPreview canvas', (c) => {
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) dark += 1;
    return dark;
  });
  ok(ink > 50, `The card shows the equation's ink (${ink} dark pixels)`);
  await shot('navigate-pdf-preview');
  await page.mouse.move(5, 300);
  await settle(page, 100);
  ok(await page.$eval('#linkPreview', (c) => c.hidden), 'Leaving the link hides the card');
  await page.hover(link);
  await page.waitForSelector('#linkPreview:not([hidden])');
  await page.keyboard.press('Escape');
  ok(await page.$eval('#linkPreview', (c) => c.hidden), 'Esc hides the card');
  await page.click(link);
  await settle(page, 600);
  ok(await pageNo() === 2, `Clicking the link still follows it (${await pageNo()})`);
  await page.keyboard.press('Alt+ArrowLeft');
  await settle(page);
  ok(await pageNo() === 1, 'Back returns from the link');
  await page.keyboard.press('Control+r');
  await settle(page, 1000);
  ok(await pageNo() === 1, `A rebuild after following a link stays where you are (${await pageNo()})`);

  // A find result and a `--page` target are jumps too.
  await page.keyboard.press('Control+f');
  await page.keyboard.type('Conclusion');
  await settle(page, 400);
  await page.keyboard.press('Enter');
  await settle(page, 600);
  ok(await pageNo() === 4, `Find goes to Conclusion (${await pageNo()})`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+ArrowLeft');
  await settle(page);
  ok(await pageNo() === 1, `Back returns from the find result (${await pageNo()})`);
  await page.evaluate(() => window.__emit('open-files', [{ path: '/d/navigate.pdf', target: { page: 3 } }]));
  await settle(page, 1500);
  ok(await pageNo() === 3, `A --page target lands on page 3 (${await pageNo()})`);
  await page.keyboard.press('Alt+ArrowLeft');
  await settle(page);
  ok(await pageNo() === 1, `Back returns from it (${await pageNo()})`);

  // Pages: drawn only where you look, freed when the sidebar closes.
  await page.click('#outlineTabPages');
  await page.waitForSelector('#outlineThumbs .outline-thumb canvas');
  await settle(page, 500);
  const thumbs = await page.$$eval('#outlineThumbs .outline-thumb', (t) => t.map((b) => {
    const canvas = b.querySelector('canvas');
    return canvas ? canvas.width : 0;
  }));
  ok(thumbs.length === 4 && thumbs.every((w) => w > 0 && w <= 224), `Four small page pictures (${thumbs.join(', ')} px wide)`);
  ok(await page.$eval('#outlineThumbs [aria-current="page"]', (b) => b.dataset.page) === '1', 'The current page is marked');
  await page.click('#outlineThumbs .outline-thumb[data-page="4"]');
  await settle(page, 500);
  ok(await pageNo() === 4, 'Clicking a page goes there');
  await page.focus('#outlineThumbs .outline-thumb[data-page="4"]');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await settle(page, 500);
  ok(await pageNo() === 3, `ArrowUp and Enter on the pages go to page 3 (${await pageNo()})`);
  await page.keyboard.press('Escape');
  const shown = [];
  await page.keyboard.press('Control+r');
  for (let i = 0; i < 10; i += 1) {
    shown.push(await page.$$eval('#outlineThumbs canvas', (c) => c.length));
    await settle(page, 60);
  }
  ok(shown.every((n) => n === 4), `A rebuild keeps the pictures on screen while it redraws them (${shown.join(' ')})`);
  await page.keyboard.press('Control+Shift+O');
  ok(await page.$eval('#outline', (o) => o.hidden) && await page.$$eval('#outlineThumbs canvas', (c) => c.length) === 0, 'Closing the sidebar frees the pictures');
  await page.keyboard.press('Control+Shift+O');
  await page.waitForSelector('#outlineThumbs .outline-thumb canvas');
  ok(await page.$eval('#outlineTabPages', (t) => t.getAttribute('aria-selected')) === 'true', 'The Pages tab is remembered');
  await close();
}

// Lazy pictures: a long PDF draws the pages near the view, keeps a bounded
// number of them, and draws the rest as you scroll to them.
function longPdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let i = 0; i < pages; i += 1) {
    const text = `BT /F1 96 Tf 72 600 Td (${i + 1}) Tj ET`;
    kids.push(`${objects.length + 1} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`);
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;
  let out = '%PDF-1.7\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
{
  const { page, ok, close } = await start({ viewport: { width: 1200, height: 600 } });
  const body = longPdf(80);
  await page.route('**/d/long.pdf*', (route) => route.fulfill({ body, contentType: 'application/pdf' }));
  await page.evaluate(() => {
    localStorage.setItem('pdf-next.outline-tab', 'pages');
    window.__pick = '/d/long.pdf';
  });
  await page.keyboard.press('Control+o');
  await page.waitForSelector('#viewer .page canvas', { timeout: 15_000 });
  await page.keyboard.press('Control+Shift+O');
  await page.waitForSelector('#outlineThumbs .outline-thumb canvas');
  await settle(page, 800);
  const drawn = () => page.$$eval('#outlineThumbs canvas', (c) => c.length);
  const first = await drawn();
  ok(await page.$$eval('#outlineThumbs .outline-thumb', (t) => t.length) === 80 && first > 0 && first < 12, `Only the pages near the view are drawn (${first} of 80)`);
  for (let step = 0; step < 40; step += 1) {
    await page.$eval('#outlineThumbs', (box) => { box.scrollTop += 400; });
    await settle(page, 60);
  }
  await settle(page, 800);
  ok(await page.$eval('#outlineThumbs .outline-thumb[data-page="80"]', (b) => Boolean(b.querySelector('canvas'))), 'Scrolling down draws the last page');
  const kept = await drawn();
  ok(kept <= 48, `At most 48 pictures are kept (${kept})`);
  ok(await page.$eval('#outlineThumbs .outline-thumb[data-page="1"]', (b) => !b.querySelector('canvas')), 'The first ones were let go');
  await close();
}

// Markdown: headings as the outline, previews of headings, footnotes and equations.
const html = [
  '<h1 id="md-intro"><span class="src" data-line="1"></span>Intro</h1>',
  '<p><span class="src" data-line="3"></span>See <a href="#md-results">Results</a>, a note<sup class="footnote-reference"><a href="#md-1">1</a></sup> and <a href="#md-math:eq:one">(1)</a>.</p>',
  ...Array.from({ length: 12 }, (_, i) => `<p><span class="src" data-line="${5 + i}"></span>Filler paragraph ${i} with enough words to take some room on the page.</p>`),
  '<h2 id="md-method"><span class="src" data-line="20"></span>Method</h2>',
  '<p><math display="block"><mtable><mtr><mtd></mtd><mtd><mi>a</mi><mo>=</mo><mi>b</mi></mtd><mtd id="md-math:eq:one"><mtext>(1)</mtext></mtd></mtr></mtable></math></p>',
  ...Array.from({ length: 12 }, (_, i) => `<p><span class="src" data-line="${30 + i}"></span>More filler ${i} so that the next heading is further down.</p>`),
  '<h3 id="md-detail"><span class="src" data-line="50"></span>Detail</h3>',
  '<p><span class="src" data-line="52"></span>Detail text.</p>',
  '<h2 id="md-results"><span class="src" data-line="60"></span>Results</h2>',
  '<p><span class="src" data-line="62"></span>The results paragraph.</p>',
  ...Array.from({ length: 20 }, (_, i) => `<p><span class="src" data-line="${70 + i}"></span>Trailing filler ${i}.</p>`),
  '<div class="footnote-definition" id="md-1"><sup class="footnote-definition-label">1</sup><p>The footnote text.</p></div>',
].join('\n');
const files = { '/d/a.md': { raw: '# Intro\n', html }, '/d/b.md': 'Plain text, no headings.\n' };
const { page, ok, openMenu, finish } = await start({ files, viewport: { width: 1200, height: 700 } });
await page.waitForSelector('#markdown h1');
await openMenu();
await page.click('#outlineToggle');
await settle(page, 300);
ok(await page.evaluate(() => document.body.classList.contains('outline-open')) && await page.$eval('#outlineToggle', (b) => b.getAttribute('aria-pressed')) === 'true', 'Outline in the View menu opens the sidebar and shows as pressed');
await page.click('#outlineToggle');
await settle(page, 300);
ok(!await page.evaluate(() => document.body.classList.contains('outline-open')) && await page.$eval('#outlineToggle', (b) => b.getAttribute('aria-pressed')) === 'false', 'and closes it again');
await page.keyboard.press('Escape');
await page.keyboard.press('Control+Shift+O');
await page.waitForSelector('#outlineTree [role="treeitem"]');
const mdLabels = await page.$$eval('#outlineTree .outline-label', (l) => l.map((x) => `${x.closest('[role="treeitem"]').getAttribute('aria-level')}${x.textContent}`));
ok(mdLabels.join('|') === '1Intro|2Method|3Detail|2Results', `The headings are the outline (${mdLabels.join(', ')})`);
ok(await page.$eval('#outlineTabPages', (t) => t.hidden), 'Markdown has no Pages tab');
const stageTop = () => page.$eval('#markdownStage', (s) => Math.round(s.scrollTop));
await page.click('#outlineTree .outline-label:text-is("Results")');
await settle(page);
const atResults = await page.$eval('#md-results', (h) => Math.round(h.getBoundingClientRect().top - document.querySelector('#markdownStage').getBoundingClientRect().top));
ok(atResults >= 0 && atResults < 60, `Clicking Results scrolls to it (${atResults} px from the top)`);
ok(await labelOf(page) === 'Results', 'Results is highlighted');
await page.$eval('#markdownStage', (s) => { s.scrollTop = document.querySelector('#md-method').offsetTop - 20; });
await page.$eval('#md-method', (h) => h.scrollIntoView({ block: 'start' }));
await settle(page);
ok(await labelOf(page) === 'Method', 'Scrolling to Method highlights it');
await page.keyboard.press('Alt+ArrowLeft');
await settle(page);
ok(await labelOf(page) === 'Intro' && await stageTop() < 5, 'Back returns to the top, where Results was chosen');
await page.keyboard.press('Alt+ArrowRight');
await settle(page);
ok(await labelOf(page) === 'Method', 'Forward returns to where Back was pressed');

await page.keyboard.press('g');
await settle(page);
const preview = async (href) => {
  await page.mouse.move(5, 5);
  await settle(page, 50);
  await page.hover(`#markdown a[href="${href}"]`);
  await page.waitForSelector('#linkPreview:not([hidden])', { timeout: 2000 }).catch(() => {});
  return page.$eval('#linkPreview', (c) => (c.hidden ? null : { text: c.innerText.replace(/\s+/g, ' ').trim(), ids: c.querySelectorAll('[id]').length, md: c.classList.contains('link-preview-md') }));
};
const heading = await preview('#md-results');
ok(heading?.text === 'Results The results paragraph.' && heading.ids === 0, `A heading link previews the heading and its paragraph (${heading?.text})`);
ok(heading?.md, 'The card is set like the article');
const note = await preview('#md-1');
ok(note?.text === '1 The footnote text.', `A footnote reference previews the footnote (${note?.text})`);
const equation = await preview('#md-math:eq:one');
ok(Boolean(equation?.text.includes('(1)')) && await page.$$eval('#linkPreview math', (m) => m.length) === 1, `An equation reference previews the equation (${equation?.text})`);
await page.click('#markdown a[href="#md-1"]');
await settle(page);
ok(await page.$eval('#linkPreview', (c) => c.hidden), 'Following the link hides the card');
const atNote = await stageTop();
ok(atNote > 200, `Clicking the footnote reference still scrolls there (${atNote})`);
await page.keyboard.press('Alt+ArrowLeft');
await settle(page);
ok(await stageTop() < 5, 'Back returns from the footnote');

// A rebuild keeps the sidebar and its scroll; another file swaps the outline.
await page.$eval('#outlineTree', (t) => { t.style.height = '40px'; t.scrollTop = 20; });
const kept = await page.$eval('#outlineTree', (t) => t.scrollTop);
await page.keyboard.press('Control+r');
await settle(page, 500);
ok(!await page.$eval('#outline', (o) => o.hidden) && await page.$eval('#outlineTree', (t) => t.scrollTop) === kept, `A reload keeps the sidebar open and scrolled (${kept})`);
await page.$eval('#outlineTree', (t) => { t.style.height = ''; });

// Resize by dragging, remembered.
const grip = await page.$eval('#outlineGrip', (g) => { const r = g.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 100 }; });
await page.mouse.move(grip.x, grip.y);
await page.mouse.down();
await page.mouse.move(grip.x + 80, grip.y, { steps: 4 });
await page.mouse.up();
const dragged = await page.$eval('#outline', (o) => Math.round(o.getBoundingClientRect().width));
ok(Math.abs(dragged - 320) <= 2 && await page.evaluate(() => localStorage.getItem('pdf-next.outline-width')) === String(dragged), `Dragging the edge widens the sidebar to ${dragged} px and remembers it`);

await page.keyboard.press('Control+k');
await page.keyboard.type('hide outline');
await page.keyboard.press('Enter');
await settle(page, 150);
ok(await page.$eval('#outline', (o) => o.hidden), 'The palette hides the outline');
await page.keyboard.press('Control+k');
await page.keyboard.type('show outline');
await page.keyboard.press('Enter');
await settle(page, 150);
ok(!await page.$eval('#outline', (o) => o.hidden), 'The palette shows it again');
await page.keyboard.press('Control+k');
await page.keyboard.type('back');
const listed = await page.$$eval('#paletteList .palette-label', (o) => o.map((x) => x.textContent));
ok(listed.includes('Back'), `Back is in the palette (${listed.slice(0, 3).join(', ')})`);
await page.keyboard.press('Escape');

// With panes, the sidebar shows the live pane's file.
const host = () => page.evaluate(() => document.querySelector('#outline').closest('.pane-body')?.dataset.path);
await page.evaluate(() => { window.__pick = '/d/b.md'; });
await page.keyboard.press('Control+Shift+D');
await page.waitForSelector('#panes:not([hidden]) .dv-groupview');
await settle(page, 500);
ok(await host() === '/d/b.md' && await page.$eval('#outlineEmpty', (e) => !e.hidden && e.textContent) === 'No headings in this file.', 'With two panes the sidebar is in the live one, showing its file');
await page.click('.pane-body[data-path="/d/a.md"] .pane-cover');
await settle(page, 500);
ok(await host() === '/d/a.md' && await page.$$eval('#outlineTree [role="treeitem"]', (i) => i.length) === 4, 'Making the other pane live brings its outline');
await finish();
