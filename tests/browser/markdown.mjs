// Markdown rendering and find: math, code colours, images and figures, links.
// The HTML is shaped like the Rust renderer's output (span.src line anchors,
// img[data-doc], md- ids); the real renderer runs in tests/e2e.
import { start } from './harness.mjs';

const filler = Array.from({ length: 30 }, (_, i) => `<p><span class="src" data-line="${40 + i * 2}"></span>Filler paragraph ${i} about the wake.</p>`).join('\n');
const html = `<h1 id="md-top"><span class="src" data-line="1"></span>Top</h1>
<p><span class="src" data-line="3"></span>Inline <math><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math> and see <a href="#md-math:eq:ns">(1)</a>, <a href="#md-end">the end</a>, <a href="https://example.org/paper">a paper</a>, <a href="other.md">other notes</a>, <a href="mailto:a@b.c">mail</a>.</p>
<math display="block"><mtable displaystyle="true" style="width: 100%"><mtr><mtd style="width: 50%"></mtd><mtd><mi>a</mi><mo>=</mo><mi>b</mi></mtd><mtd style="width: 50%; justify-items: right" id="md-math:eq:ns"><mtext>(1)</mtext></mtd></mtr></mtable></math>
<pre><code class="language-python"><span class="src" data-line="7"></span>def wake(re):
    return "x"  # comment
</code></pre>
<pre><code><span class="src" data-line="11"></span>plain &lt;b&gt;block&lt;/b&gt;
</code></pre>
<p><span class="src" data-line="14"></span><img data-doc="/d/swatch.png" alt="A swatch"></p>
<p><span class="src" data-line="16"></span><img data-doc="/d/swatch.png" alt="Half" width="50%"></p>
<p><span class="src" data-line="18"></span>Text with <img data-doc="/d/swatch.png" alt="inline"> inside.</p>
<p><span class="src" data-line="20"></span><span class="md-image-refused" title="image not shown: only local image files are shown">remote</span></p>
${filler}
<h2 id="md-end"><span class="src" data-line="99"></span>End</h2>
<p><span class="src" data-line="101"></span>Wake again, and the wake once more.</p>`;
const files = {
  '/d/doc.md': { raw: '# Top\n', html },
  '/d/other.md': 'Other notes.\n',
};
const { page, ok, finish } = await start({ files, initial: '/d/doc.md' });
await page.waitForTimeout(300);
const scrollTop = () => page.$eval('#markdownStage', (s) => s.scrollTop);

ok(await page.$$eval('#markdown math', (m) => m.length) === 2, 'Inline and display math are in the page');
ok(await page.$eval('#markdown math', (m) => getComputedStyle(m).fontFamily.includes('New Computer Modern Math')), 'Math is set in New Computer Modern Math');
ok(await page.$eval('#markdown math[display="block"]', (m) => getComputedStyle(m).display.includes('math')), 'Display math keeps MathML layout');
const math = await page.$eval('#markdown math msup', (m) => m.getBoundingClientRect().width);
ok(math > 5, `MathML is laid out (${Math.round(math)} px superscript)`);

ok(await page.$$eval('#markdown code.language-python .hljs-keyword', (k) => k.map((x) => x.textContent).join()) === 'def,return', 'Python keywords are coloured');
ok(await page.$eval('#markdown code.language-python .hljs-string', (s) => s.textContent) === '"x"', 'Strings are coloured');
ok(await page.$eval('#markdown code.language-python .hljs-comment', (c) => getComputedStyle(c).fontStyle) === 'italic', 'Comments are italic');
const colours = await page.$eval('#markdown code.language-python', (code) => {
  const of = (sel) => getComputedStyle(code.querySelector(sel)).color;
  return new Set([of('.hljs-keyword'), of('.hljs-string'), of('.hljs-comment'), getComputedStyle(code).color]).size;
});
ok(colours === 4, `Keywords, strings, comments and text have their own colours (${colours})`);
ok(await page.$eval('#markdown code.language-python .src', (s) => s.dataset.line) === '7', 'The line anchor survives colouring');
ok(await page.$$eval('#markdown pre:nth-of-type(2) code [class^="hljs"]', (s) => s.length) === 0, 'A block with no language stays plain');
ok(await page.$eval('#markdown pre:nth-of-type(2) code', (c) => c.textContent.includes('<b>block</b>')), 'HTML in a plain block shows as text');

await page.waitForFunction(() => [...document.querySelectorAll('#markdown img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 5000 }).catch(() => {});
ok(await page.$$eval('#markdown img', (i) => i.every((x) => x.naturalWidth === 64)), 'Local images load from their data-doc path');
const figures = await page.$$eval('#markdown p.md-figure', (p) => p.length);
ok(figures === 2, `An image alone in its paragraph is a figure, one inside text is not (${figures})`);
ok(await page.$eval('#markdown p.md-figure .md-caption', (c) => c.textContent) === 'A swatch', 'The alt text is the caption');
ok(await page.$eval('#markdown p.md-figure .md-caption', (c) => getComputedStyle(c, '::before').content.includes('Figure')), 'Captions are numbered');
const column = await page.$eval('#markdown', (a) => a.clientWidth - parseFloat(getComputedStyle(a).paddingLeft) - parseFloat(getComputedStyle(a).paddingRight));
const half = await page.$eval('#markdown img[width="50%"]', (i) => i.getBoundingClientRect().width);
ok(Math.abs(half - column / 2) < 3, `{width=50%} is half the column (${Math.round(half)} of ${Math.round(column)} px)`);
ok(await page.$eval('#markdown .md-image-refused', (s) => s.textContent === 'remote' && s.title.includes('not shown')), 'A refused image shows its alt text and why');
await page.evaluate(() => {
  const s = document.getElementById('setFigWidth');
  s.value = 'column';
  s.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(100);
const full = await page.$eval('#markdown p.md-figure img:not([width])', (i) => i.getBoundingClientRect().width);
ok(Math.abs(full - column) < 3, `Figure width: column width fills the column (${Math.round(full)} px)`);
ok(Math.abs(await page.$eval('#markdown img[width="50%"]', (i) => i.getBoundingClientRect().width) - half) < 3, 'A width in the file wins over the setting');
await page.evaluate(() => {
  const s = document.getElementById('setFigCaption');
  s.value = 'off';
  s.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(200);
ok(await page.$$eval('#markdown .md-caption', (c) => c.every((x) => getComputedStyle(x).display === 'none')), 'Captions: None hides them');

await page.click('#markdown a[href="#md-end"]');
await page.waitForTimeout(200);
const endView = await page.$eval('#md-end', (h) => {
  const stage = document.getElementById('markdownStage');
  const r = h.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return { top: Math.round(r.top - s.top), inView: r.top >= s.top && r.bottom <= s.bottom, atEnd: stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2 };
});
ok(await scrollTop() > 300 && endView.inView && (endView.top < 40 || endView.atEnd), `An in-page link scrolls to its heading (${JSON.stringify(endView)})`);
await page.evaluate(() => { document.getElementById('markdownStage').scrollTop = 0; });
await page.click('#markdown a[href="#md-math:eq:ns"]');
await page.waitForTimeout(100);
ok(await page.evaluate(() => location.hash === ''), 'In-page links do not navigate the window');
await page.click('#markdown a[href^="https:"]');
await page.waitForTimeout(100);
const opened = await page.evaluate(() => window.__calls.filter((c) => c[0] === 'open_link').map((c) => c[1].url));
ok(opened.join() === 'https://example.org/paper', `A web link goes to open_link (${opened})`);
await page.click('#markdown a[href^="mailto:"]');
await page.waitForTimeout(100);
ok(await page.evaluate(() => window.__calls.filter((c) => c[0] === 'open_link').length) === 1 && page.url().endsWith('/index.html'), 'A mailto link does nothing');
await page.evaluate(() => { window.__fail.open_link = 'only web links open'; });
await page.click('#markdown a[href^="https:"]');
await page.waitForTimeout(100);
ok(await page.$eval('#status', (s) => s.classList.contains('error') && s.textContent.includes('only web links')), 'A refused web link says why in the status line');
await page.evaluate(() => { delete window.__fail.open_link; });
await page.click('#markdown a[href="other.md"]');
await page.waitForTimeout(400);
ok(await page.evaluate(() => document.title.startsWith('other.md')), 'A relative link opens the file');
ok(await page.$$eval('#tabs .tab', (t) => t.map((x) => x.textContent).join('|')) === 'doc.md|other.md', 'in a tab next to this one');
await page.keyboard.press('Control+1');
await page.waitForTimeout(400);

await page.keyboard.press('Control+f');
await page.keyboard.type('wake');
await page.waitForTimeout(400);
const count = await page.textContent('#findCount');
ok(count === '1 of 33', `Find counts every hit in the article (${count})`);
ok(await page.$$eval('#markdown mark.aim.find', (m) => m.length) === 33, 'Each hit is marked');
ok(await page.$$eval('#markdown mark.aim.find.current', (m) => m.length) === 1, 'One hit is current');
ok(await page.$$eval('#markdown code mark.aim.find', (m) => m.length) === 1, 'Hits inside code are found too');
await page.keyboard.press('Shift+Enter');
await page.waitForTimeout(150);
ok(await page.textContent('#findCount') === '33 of 33', 'Shift+Enter wraps to the last hit');
const last = await page.$eval('#markdown mark.aim.find.current', (m) => {
  const r = m.getBoundingClientRect();
  return r.top > 0 && r.bottom < innerHeight;
});
ok(last, 'The current hit is scrolled into view');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
ok(await page.textContent('#findCount') === '1 of 33', 'Enter wraps back to the first');
await page.fill('#findInput', 'w');
await page.waitForTimeout(300);
ok(await page.$$eval('#markdown mark.aim.find', (m) => m.length) === 0 && await page.textContent('#findCount') === '', 'One letter does not search');
await page.fill('#findInput', 'filler paragraph 2');
await page.press('#findInput', 'Enter');
await page.waitForTimeout(150);
ok(await page.textContent('#findCount') === '1 of 11', `Case and spaces are ignored (${await page.textContent('#findCount')})`);
await page.fill('#findInput', 'nowhere at all');
await page.waitForTimeout(300);
ok(await page.textContent('#findCount') === 'No match', 'No match says so');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
ok(await page.$eval('#find', (f) => f.hidden) && await page.$$eval('#markdown mark.aim', (m) => m.length) === 0, 'Esc closes find and clears the marks');
ok(await page.$eval('#markdown p', (p) => p.textContent.startsWith('Inline')), 'The text is whole again after the marks go');
await page.keyboard.press('Control+u');
await page.keyboard.press('Control+f');
await page.waitForTimeout(100);
ok(await page.$eval('#markdownRaw', (r) => r.hidden) && await page.$eval('#find', (f) => !f.hidden), 'Find from the raw view goes back to the rendered page');
await finish();
