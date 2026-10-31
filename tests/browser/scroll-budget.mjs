// Scrolling a long PDF must keep painting pages. The worker cap in this test is
// 20480 bytes, between one page task and two. One operator list of
// scroll-budget.pdf charges 15872 bytes (six pages, each a full-page red fill
// plus 8000 spaces, flate). The old worker adds every page into one budget and
// then sticks, so a later page draws blank. A page task now starts from zero.
import { start } from './harness.mjs';

const CAP = 20480;
const { page, ok, finish } = await start({
  initial: '/d/scroll-budget.pdf',
  viewport: { width: 700, height: 420 },
  prepare: async (page) => {
    await page.route('**/pdf.worker.min.mjs', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        'const MAX_DOCUMENT_DECODE_BYTES = 256 * 1024 * 1024;',
        `const MAX_DOCUMENT_DECODE_BYTES = ${CAP};`,
      );
      if (!body.includes(`const MAX_DOCUMENT_DECODE_BYTES = ${CAP};`)) {
        throw new Error('worker cap was not replaced');
      }
      await route.fulfill({ response, body });
    });
  },
});

await page.waitForSelector('#viewer .page canvas', { timeout: 15_000 });

// Visible page canvases. A rendered page of this file is red, not white.
async function visibleInk() {
  return page.evaluate(() => {
    const view = document.querySelector('#viewerContainer').getBoundingClientRect();
    const pages = [...document.querySelectorAll('#viewer .page')].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.bottom > view.top + 4 && box.top < view.bottom - 4;
    });
    return pages.map((el) => {
      const canvas = el.querySelector('canvas');
      if (!canvas || canvas.width < 2) return 0;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < data.length; i += 16) {
        if (data[i + 3] && (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250)) ink += 1;
      }
      return ink;
    });
  });
}

async function viewState() {
  return page.evaluate(() => {
    const scroller = document.querySelector('#viewerContainer');
    const view = scroller.getBoundingClientRect();
    const pages = [...document.querySelectorAll('#viewer .page')].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.bottom > view.top + 4 && box.top < view.bottom - 4;
    }).map((el) => el.dataset.pageNumber);
    return { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight, pages };
  });
}

async function settleInk(label) {
  let ink = [];
  for (let i = 0; i < 20; i++) {
    ink = await visibleInk();
    if (ink.length && ink.every((n) => n > 0)) break;
    await page.waitForTimeout(150);
  }
  const view = await viewState();
  ok(ink.length > 0 && ink.every((n) => n > 0), `${label}: visible pages keep ink (${ink.join(', ')}) on page ${view.pages.join('+') || '?'}`);
  return view;
}

await settleInk('open');
const scroller = '#viewerContainer';
for (let pass = 1; pass <= 3; pass++) {
  await page.$eval(scroller, (el) => { el.scrollTop = el.scrollHeight; });
  const down = await settleInk(`down ${pass}`);
  ok(down.top > down.client && down.pages.at(-1) !== '1', `down ${pass} leaves the first page (${down.top} px, page ${down.pages.join('+')})`);
  await page.$eval(scroller, (el) => { el.scrollTop = 0; });
  const up = await settleInk(`up ${pass}`);
  ok(up.top === 0 && up.pages.includes('1'), `up ${pass} returns to the first page`);
}

await finish();
