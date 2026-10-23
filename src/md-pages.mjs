/// Page views of a Markdown article: where one A4 page ends and the next begins.

export const PAGE_VIEWS = ['continuous', 'single', 'two'];

/// A saved or chosen value, or the kind's default when it is not on that
/// kind's menu. A PDF is already one page per sheet, so it has no continuous view.
export function validPageView(kind, value) {
  const menu = kind === 'pdf' ? PAGE_VIEWS.slice(1) : PAGE_VIEWS;
  return menu.includes(value) ? value : kind === 'pdf' ? 'single' : 'continuous';
}

/// Fill each page with whole blocks until the next one would pass `limit`.
///
/// `blocks` are the top-level blocks in reading order, each with the `top` and
/// `bottom` it has when laid out in one column of page width, and `keepNext`
/// for a heading. A page may be shorter than `limit`, never taller, except for
/// a block taller than a page, which stands alone. A heading never ends a page
/// unless the page would otherwise be empty. Returns `[start, end)` pairs.
export function paginate(blocks, limit) {
  const pages = [];
  let start = 0;
  for (let i = 1; i <= blocks.length; i++) {
    if (i < blocks.length && blocks[i].bottom - blocks[start].top <= limit) {
      continue;
    }
    let cut = i;
    if (i < blocks.length) {
      while (cut > start && blocks[cut - 1].keepNext) {
        cut--;
      }
      if (cut === start) {
        cut = i;
      }
    }
    pages.push([start, cut]);
    start = cut;
    i = cut;
  }
  return pages;
}
