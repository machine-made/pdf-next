// PDF viewing: page navigation, zoom presets and the wheel, page view, find.
import { start } from './harness.mjs';

const { page, ok, finish } = await start({ initial: '/d/three-pages.pdf' });
await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
await page.waitForTimeout(300);
const pageNo = () => page.$eval('#page', (i) => Number(i.value));
const pageWidth = () => page.$eval('#viewer .page', (p) => Math.round(p.getBoundingClientRect().width));
const zoomText = () => page.$eval('#zoom', (s) => s.options[s.selectedIndex].textContent);
const settle = (ms = 250) => page.waitForTimeout(ms);

ok(await page.evaluate(() => document.body.classList.contains('kind-pdf')), 'The window is in PDF mode');
ok(await page.textContent('#pages') === '/ 3', 'Three pages are counted');
ok(await pageNo() === 1 && await page.$eval('#prev', (b) => b.disabled), 'Page 1 first, Previous disabled');
await page.click('#next');
await settle();
ok(await pageNo() === 2, 'Next goes to page 2');
await page.click('#viewerContainer', { position: { x: 5, y: 5 } });
await page.keyboard.press('n');
await settle();
ok(await pageNo() === 3 && await page.$eval('#next', (b) => b.disabled), 'n goes to the last page and disables Next');
await page.keyboard.press('p');
await settle();
ok(await pageNo() === 2, 'p goes back a page');
await page.keyboard.press('g');
await settle();
ok(await pageNo() === 1, 'g goes to the first page');
await page.keyboard.press('Shift+G');
await settle();
ok(await pageNo() === 3, 'Shift+G goes to the last page');
await page.fill('#page', '2');
await page.press('#page', 'Enter');
await settle();
ok(await pageNo() === 2, 'Typing 2 in the page box goes to page 2');
await page.fill('#page', '99');
await page.press('#page', 'Enter');
await settle();
ok(await pageNo() === 3, 'A page past the end lands on the last page');

await page.selectOption('#zoom', '1');
await settle(400);
const at100 = await pageWidth();
await page.selectOption('#zoom', '2');
await settle(400);
const at200 = await pageWidth();
ok(Math.abs(at200 / at100 - 2) < 0.05, `200% is twice 100% (${at100} -> ${at200} px)`);
await page.selectOption('#zoom', 'page-width');
await settle(400);
const container = await page.$eval('#viewerContainer', (c) => c.clientWidth);
const fitWidth = await pageWidth();
ok(fitWidth > container * 0.85 && fitWidth <= container, `Fit width fills the window (${fitWidth} of ${container} px)`);
await page.selectOption('#zoom', 'page-fit');
await settle(400);
const fitHeight = await page.$eval('#viewer .page', (p) => p.getBoundingClientRect().height);
const containerHeight = await page.$eval('#viewerContainer', (c) => c.clientHeight);
ok(fitHeight <= containerHeight && fitHeight > containerHeight * 0.8, `Fit page shows a whole page (${Math.round(fitHeight)} of ${containerHeight} px)`);
await page.selectOption('#zoom', '1');
await settle(400);
await page.click('#zoomIn');
await settle(400);
ok(await zoomText() === '125%', `Zoom in steps 100% -> ${await zoomText()}`);
await page.keyboard.press('-');
await page.keyboard.press('-');
await settle(400);
ok(await zoomText() === '75%', `- twice steps to ${await zoomText()}`);
await page.hover('#zoom');
await page.mouse.wheel(0, -100);
await settle(400);
ok(await zoomText() === '100%', `Wheel up on the zoom menu zooms in (${await zoomText()})`);
await page.mouse.wheel(0, 100);
await settle(400);
ok(await zoomText() === '75%', 'Wheel down zooms out');
await page.hover('#zoomOut');
await page.mouse.wheel(0, -100);
await settle(400);
ok(await zoomText() === '100%', 'Wheel over the zoom-out button zooms too');
await page.keyboard.press('=');
await settle(400);
ok(await zoomText() === '125%', '= zooms in like +');

ok(await page.$eval('#pageView option[value="continuous"]', (o) => o.hidden), 'Continuous is not offered for a PDF');
await page.selectOption('#zoom', '0.5');
await page.selectOption('#pageView', 'two');
await settle(500);
ok(await page.$$eval('#viewer .spread', (s) => s.length) === 2, 'Two pages lays the pages out in spreads (1 | 2 3)');
const spread = await page.$$eval('#viewer .spread', (s) => s.map((x) => x.querySelectorAll('.page').length).join(','));
ok(spread === '1,2', `The cover stands alone (${spread})`);
ok(await page.evaluate(() => localStorage.getItem('pdf-next.page-view.pdf')) === 'two', 'Two pages is remembered for PDFs');
await page.selectOption('#pageView', 'single');
await settle(500);
ok(await page.$$eval('#viewer .spread', (s) => s.length) === 0, 'Single page drops the spreads');

await page.fill('#page', '1');
await page.press('#page', 'Enter');
await settle();
await page.keyboard.press('Control+f');
await settle(100);
ok(await page.$eval('#find', (f) => !f.hidden) && await page.evaluate(() => document.activeElement.id) === 'findInput', 'Ctrl+F opens find with focus in it');
await page.keyboard.type('page');
await page.waitForFunction(() => /\/3$/.test(document.getElementById('findCount').textContent), null, { timeout: 5000 }).catch(() => {});
ok(await page.textContent('#findCount') === '1/3', `"page" is found on each page (${await page.textContent('#findCount')})`);
await page.keyboard.press('Enter');
await settle(400);
ok(await page.textContent('#findCount') === '2/3', 'Enter goes to the next match');
await page.keyboard.press('Shift+Enter');
await settle(400);
ok(await page.textContent('#findCount') === '1/3', 'Shift+Enter goes back');
await page.click('#findNext');
await page.click('#findNext');
await settle(400);
ok(await page.textContent('#findCount') === '3/3' && await pageNo() === 3, 'The next-match button walks to page 3');
ok(await page.$$eval('#viewer .highlight', (h) => h.length) > 0, 'Matches are highlighted');
await page.fill('#findInput', 'zzqq');
await settle(500);
ok(await page.textContent('#findCount') === 'No match', 'An absent word says No match');
await page.keyboard.press('Escape');
await settle(100);
ok(await page.$eval('#find', (f) => f.hidden), 'Esc closes find');

// Night and Sepia: every webview draws plain pages and pdf-next recolours
// each canvas itself, the same with the canvas filter working (Chromium,
// WebView2) or ignored (WebKit). Paper takes the mode's background, black ink
// its foreground, and the blue rule every fixture page draws stays blue.
const NIGHT = { paper: [27, 27, 27], ink: [214, 209, 196] };
const SEPIA = { paper: [244, 236, 216], ink: [91, 70, 54] };
const hue = ([r, g, b]) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return null;
  const h = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
  return (h * 60 + 360) % 360;
};
const near = (one, two, tolerance) => one.every((v, i) => Math.abs(v - two[i]) <= tolerance);
/// Points on page 1 in clear mode: paper, a fully black pixel of text, the middle of the blue rule.
const probes = () => page.$eval('#viewer .page canvas', (c) => {
  const { data, width, height } = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  const at = (x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)];
  let ink = null;
  for (let y = Math.round(height * 0.12); y < height * 0.2 && !ink; y += 1) {
    for (let x = Math.round(width * 0.1); x < width * 0.3; x += 1) {
      if (at(x, y).every((v) => v < 8)) {
        ink = [x, y];
        break;
      }
    }
  }
  const x = Math.round(width * 236 / 595);
  let rule = null;
  for (let y = Math.round(height * 0.22); y < height * 0.27; y += 1) {
    const [r, g, b] = at(x, y);
    if (b > 240 && r < 15 && g < 15) {
      rule = [x, y + 1];
      break;
    }
  }
  return { paper: [4, 4], ink, rule, colours: { ink: ink && at(...ink), rule: rule && at(...rule) } };
});
const sample = (points) => page.$eval('#viewer .page canvas', (c, points) => {
  const context = c.getContext('2d');
  return Object.fromEntries(Object.entries(points).filter(([, p]) => Array.isArray(p)).map(([name, [x, y]]) => [name, [...context.getImageData(x, y, 1, 1).data].slice(0, 3)]));
}, points);
const checkMode = async (name, colours, points, how) => {
  const got = await sample(points);
  ok(near(got.paper, colours.paper, 2), `${name} paper is ${colours.paper} ${how} (${got.paper})`);
  ok(near(got.ink, colours.ink, 3), `${name} black text is the foreground ${colours.ink} ${how} (${got.ink})`);
  const turned = hue(got.rule);
  ok(turned !== null && Math.abs(turned - 240) <= 20 && Math.max(...got.rule) - Math.min(...got.rule) > 40, `${name} keeps the blue rule blue ${how} (${got.rule}, hue ${Math.round(turned)})`);
};
const modes = async (how) => {
  await page.click('#mode', { modifiers: ['Shift'] });
  await settle(900);
  const points = await probes();
  ok(points.ink && points.rule && near(points.colours.rule, [0, 0, 255], 12), `Clear pages are white with black text and a blue rule ${how} (${JSON.stringify(points.colours)})`);
  await page.click('#mode');
  await settle(1200);
  await checkMode('Night', NIGHT, points, how);
  await page.click('#zoomIn');
  await settle(1500);
  await page.click('#zoomOut');
  await settle(1500);
  ok(near((await sample(points)).paper, NIGHT.paper, 2), `Night paper stays so when the page is drawn again, recoloured once ${how}`);
  await page.click('#mode');
  await page.click('#mode');
  await settle(1200);
  await checkMode('Sepia', SEPIA, points, how);
  await page.click('#mode', { modifiers: ['Shift'] });
  await settle(1200);
  ok((await sample(points)).paper.every((v) => v === 255), `Clear brings white paper back ${how}`);
};
await page.selectOption('#zoom', '1');
await page.$eval('#viewerContainer', (c) => { c.scrollTop = 0; });
await settle(600);
await modes('with the canvas filter');
const cost = await page.evaluate(async () => {
  const { recolorCanvas } = await import('./page-colors.mjs');
  const make = document.createElement.bind(document);
  let made = 0;
  document.createElement = (name, ...rest) => {
    if (String(name).toLowerCase() === 'canvas') made += 1;
    return make(name, ...rest);
  };
  const canvases = Array.from({ length: 4 }, () => {
    const canvas = make('canvas');
    canvas.width = 1700;
    canvas.height = 2200;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1700, 2200);
    context.fillStyle = '#000';
    context.fillRect(100, 100, 800, 40);
    return canvas;
  });
  const time = (run) => {
    const started = performance.now();
    for (const canvas of canvases) {
      run(canvas);
      canvas.getContext('2d').getImageData(0, 0, 1, 1);
    }
    return (performance.now() - started) / canvases.length;
  };
  // What a canvas filter or the old per-channel map costs: three fills.
  const map = time((canvas) => {
    const context = canvas.getContext('2d');
    for (const [operation, colour] of [['difference', '#fff'], ['multiply', '#bbb6a9'], ['lighter', '#1b1b1b']]) {
      context.globalCompositeOperation = operation;
      context.fillStyle = colour;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.globalCompositeOperation = 'source-over';
  });
  const full = time((canvas) => recolorCanvas(canvas, { background: '#1b1b1b', foreground: '#d6d1c4' }));
  document.createElement = make;
  return { map: Math.round(map), full: Math.round(full), made };
});
ok(cost.full < 150 && cost.full - cost.map < 100, `Recolouring a 3.7-megapixel page in software costs ${cost.full} ms, ${cost.full - cost.map} ms more than the luminance map alone`);
ok(cost.made <= 1, `One scratch canvas serves every page (${cost.made} made for four)`);
await page.addInitScript(() => Object.defineProperty(CanvasRenderingContext2D.prototype, 'filter', { get: () => 'none', set() {} }));
await page.reload();
await page.waitForSelector('#viewer .page canvas', { timeout: 10_000 });
await page.selectOption('#zoom', '1');
await settle(600);
ok(await page.evaluate(() => { const c = document.createElement('canvas').getContext('2d'); c.filter = 'invert(1)'; return c.filter; }) === 'none', 'The canvas filter is off, as in WebKit');
await modes('without it');
await page.click('#mode');
await settle(400);
await page.keyboard.press('Control+p');
await page.waitForSelector('#printPages img', { state: 'attached', timeout: 10_000 }).catch(() => {});
await page.evaluate(() => {
  const img = document.querySelector('#printPages img');
  if (!img) return;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  window.__printed = [...canvas.getContext('2d').getImageData(4, 4, 1, 1).data].slice(0, 3);
});
const printed = await page.evaluate(() => window.__printed);
ok(Array.isArray(printed) && printed.every((v) => v === 255), `Printing in Night still prints white paper (${printed})`);
await finish();
