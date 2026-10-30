// Every Markdown font loads from its vendored file under the app CSP and sets
// the text; the wheel walks the menu across its groups; saved choices that
// are gone fall back to the default.
import { readFile } from 'node:fs/promises';
import { axePath, start } from './harness.mjs';

const text = 'Plain text with ação, Łódź and Ærø.';
const files = {
  '/d/a.md': { raw: `${text}\n\n*Italic* and **bold**.\n`, html: `<p>${text}</p>\n<p><em>Italic ação Łódź</em> and <strong>bold</strong>.</p>` },
};
const { page, ok, openMenu, finish } = await start({ files });
const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable');
await cdp.send('CSS.enable');
const rendered = async (selector) => {
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  return fonts;
};
await page.evaluate(() => {
  window.__violations = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
});

const choices = await page.$$eval('#mdFont option', (o) => o.map((x) => [x.value, x.parentElement.label]));
const system = new Set(['serif', 'sans', 'mono']);
const italics = new Set(['lexend', 'manrope', 'space-grotesk', 'weft', 'heddle']);
const pick = (value) => page.evaluate(async (value) => {
  const select = document.getElementById('mdFont');
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await new Promise(requestAnimationFrame);
  const stack = getComputedStyle(document.querySelector('#markdown p')).fontFamily;
  const family = stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const faces = () => [...document.fonts].filter((f) => f.family.replace(/^["']|["']$/g, '') === family);
  const declared = faces().length;
  if (declared) {
    await document.fonts.load(`16px "${family}"`, 'ação Łódź');
    await document.fonts.load(`italic 16px "${family}"`, 'ação Łódź').catch(() => {});
  }
  await document.fonts.ready;
  return {
    stack,
    family,
    declared,
    loaded: faces().filter((f) => f.status === 'loaded').map((f) => `${f.style} ${f.unicodeRange.split(',')[0]}`),
    failed: faces().filter((f) => f.status === 'error').length,
    check: document.fonts.check(`16px "${family}"`, 'ação Łódź'),
  };
}, value);

let faced = 0;
for (const [value, group] of choices) {
  const r = await pick(value);
  const name = `${group} / ${value}`;
  if (system.has(value)) {
    ok(r.declared === 0 && r.stack.length > 0, `${name}: a system stack (${r.family})`);
    continue;
  }
  faced += 1;
  const latin = r.loaded.filter((f) => f.startsWith('normal') || f.startsWith('oblique')).length;
  const italic = r.loaded.filter((f) => f.startsWith('italic')).length;
  ok(r.declared > 0 && r.failed === 0 && r.check && latin > 0, `${name}: "${r.family}" loads (${r.loaded.length} faces loaded, ${r.failed} failed)`);
  if (group !== 'TeX' && group !== 'Monaspace (GitHub)' && !italics.has(value)) ok(italic > 0, `${name}: its italic loads`);
  await page.waitForTimeout(30);
  const used = await rendered('#markdown p');
  ok(used.some((f) => f.isCustomFont && f.glyphCount > 20), `${name}: the text is drawn with the web font (${used.map((f) => `${f.familyName}${f.isCustomFont ? '*' : ''}:${f.glyphCount}`).join(', ')})`);
  ok(!used.some((f) => !f.isCustomFont && f.glyphCount > 2), `${name}: no glyph falls back to a system font`);
}
ok(faced === choices.length - 3 && faced === 23, `${faced} fonts with vendored faces checked`);
ok((await page.evaluate(() => window.__violations)).length === 0, 'No CSP violation while loading fonts');

// The menu, its groups and the wheel across them.
ok(await page.$$eval('#mdFont optgroup', (g) => g.map((x) => x.label).join('|')) === 'TeX|Serif|Sans|System|Monaspace (GitHub)|machine-made', 'Font menu groups are in order');
ok(await page.$$eval('#mdFont optgroup[label="Serif"] option', (o) => o.length) === 9 && await page.$$eval('#mdFont optgroup[label="Sans"] option', (o) => o.length) === 7, 'Nine serif and seven sans fonts');
ok(!(await page.$eval('#mdFont', (s) => s.innerHTML)).match(/krypton|radon/i) && !(await page.$eval('#setCodeFont', (s) => s.innerHTML)).match(/krypton|radon/i), 'No Krypton or Radon in the font menus');
const value = () => page.$eval('#mdFont', (s) => s.value);
const wheel = async (dy) => {
  await openMenu();
  await page.hover('#mdFont');
  await page.mouse.wheel(0, dy);
  await page.waitForTimeout(350);
};
for (const [from, dy, to] of [['latin-modern', -100, 'literata'], ['literata', 100, 'latin-modern'], ['spectral', -100, 'atkinson-hyperlegible-next'], ['space-grotesk', -100, 'serif'], ['atkinson-hyperlegible-next', 100, 'spectral']]) {
  await pick(from);
  await wheel(dy);
  ok(await value() === to, `Wheel ${dy < 0 ? 'up' : 'down'} from ${from} reaches ${to} (${await value()})`);
}
ok(await page.$eval('#markdown', (a) => a.dataset.font) === 'spectral', 'The article follows the wheel');

// Settings mirrors the menu with its groups; the palette lists every font.
await page.click('#settingsToggle');
await page.waitForTimeout(100);
ok(await page.$$eval('#setFont optgroup', (g) => g.map((x) => x.label).join('|')) === 'TeX|Serif|Sans|System|Monaspace (GitHub)|machine-made', 'Settings font menu keeps the groups');
ok(await page.$eval('#setFont', (s) => s.options.length) === choices.length && await page.$eval('#setFont', (s) => s.value) === 'spectral', 'Settings offers every font and mirrors the choice');
await page.$eval('#setFont', (s) => { s.value = 'newsreader'; s.dispatchEvent(new Event('change', { bubbles: true })); });
ok(await value() === 'newsreader' && await page.$eval('#markdown', (a) => a.dataset.font) === 'newsreader', 'A font picked in Settings reaches the toolbar menu');
ok(await page.$eval('#markdown', (a) => getComputedStyle(a).fontOpticalSizing) === 'auto', 'Newsreader follows the text size with its optical sizes');
await page.click('#settingsToggle');
await page.waitForTimeout(100);
await page.focus('#markdownStage');
await page.keyboard.press('Control+k');
await page.waitForTimeout(100);
const listed = async () => {
  await page.evaluate(() => { const l = document.getElementById('paletteList'); for (let i = 0; i < 30; i++) { l.scrollTop = l.scrollHeight; l.dispatchEvent(new Event('scroll')); } });
  return page.$$eval('#paletteList .palette-label', (l) => l.map((x) => x.textContent));
};
const labels = await listed();
const names = await page.$$eval('#mdFont option', (o) => o.map((x) => `Font: ${x.textContent.trim()}`));
ok(names.every((n) => labels.includes(n)), `The palette lists all ${names.length} fonts`);
await page.keyboard.type('font eb garamond');
await page.keyboard.press('Enter');
await page.waitForTimeout(150);
ok(await value() === 'eb-garamond', 'A font from the palette');

const axe = await readFile(axePath, 'utf8');
await page.evaluate(axe);
await page.click('#settingsToggle');
await page.waitForTimeout(100);
await openMenu();
const violations = await page.evaluate(() => window.axe.run(document, {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
  resultTypes: ['violations'],
}).then((r) => r.violations.filter((v) => ['serious', 'critical'].includes(v.impact) && !v.nodes.every((n) => /^#dv-tab-\d+$/.test(n.target.join(' ')))).map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)));
ok(violations.length === 0, `axe passes with the font menus open${violations.length ? `\n      ${violations.join('\n      ')}` : ''}`);

// Krypton and Radon are gone: a saved choice of them falls back to the defaults.
await page.evaluate(() => {
  localStorage.setItem('pdf-next.md-font', 'monaspace-krypton');
  localStorage.setItem('pdf-next.code-font', 'monaspace-radon');
});
await page.reload();
await page.waitForSelector('#markdown p');
ok(await value() === 'latin-modern' && await page.$eval('#markdown', (a) => a.dataset.font) === 'latin-modern', 'A saved Monaspace Krypton falls back to Latin Modern');
ok(await page.evaluate(() => !document.documentElement.dataset.codeFont && document.getElementById('setCodeFont').value === 'system'), 'A saved Monaspace Radon code font falls back to the system mono');
ok(await page.evaluate(() => getComputedStyle(document.querySelector('#markdown p')).fontFamily.startsWith('"Latin Modern Roman"')), 'The text is set in Latin Modern again');
await finish();
