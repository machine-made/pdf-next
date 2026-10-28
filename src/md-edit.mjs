/// Direct edits to a Markdown file: map a selection of rendered text back to
/// the source, then wrap it in formatting or replace it. Pure functions over
/// the source string; the app sends the result to Rust, which checks the file
/// is still the one shown before it writes.

/// Markers for each format: what goes before and after the selected text.
export const FORMATS = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<u>', '</u>'],
  strike: ['~~', '~~'],
  code: ['`', '`'],
};

export const FORMAT_LABELS = {
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  strike: 'Strikethrough',
  code: 'Code',
};

/// Offsets where each line of `raw` starts, plus one past the end.
function lineStarts(raw) {
  const starts = [0];
  for (let at = raw.indexOf('\n'); at >= 0; at = raw.indexOf('\n', at + 1)) starts.push(at + 1);
  starts.push(raw.length + 1);
  return starts;
}

/// The source of the block a selection sits in: from its first line to the
/// end of the paragraph its last line belongs to (the next blank line).
/// Lines are 1-based, as in a review's `at`.
export function blockSpan(raw, line, end = line) {
  const starts = lineStarts(raw);
  const total = starts.length - 1;
  const first = Math.min(Math.max(1, Number(line) || 1), total);
  let last = Math.min(Math.max(first, Number(end) || first), total);
  const lineText = (n) => raw.slice(starts[n - 1], starts[n] - 1);
  for (let guard = 0; last < total && guard < 400 && lineText(last + 1).trim() !== ''; guard += 1) last += 1;
  let stop = starts[last] - 1;
  if (stop > raw.length) stop = raw.length;
  if (raw[stop - 1] === '\r') stop -= 1;
  return { start: starts[first - 1], end: stop, line: first, endLine: last };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/// The renderer's smart punctuation turns source quotes and dashes into
/// typographic ones; a rendered character matches either form.
const SMART = {
  '‘': "['‘]", '’': "['’]", '“': '["“]', '”': '["”]',
  '–': '(?:--|–)', '—': '(?:---|—)', '…': '(?:\\.\\.\\.|…)',
};
// Latin letters, digits and underscore at an edge make the boundary matter;
// dashes also count as inside a word ("two-dimensional"). Other scripts run
// without spaces, so no boundary is checked for them.
const WORD_EDGE = /[\p{Script=Latin}\p{N}_]/u;
const WORD_CLASS = '\\p{Script=Latin}\\p{N}_\\-\\u2010-\\u2015';
const wordPattern = (word) => [...word].map((character) => SMART[character] ?? escapeRegExp(character)).join('');

/// Where the selected rendered text stands in the source, within its block.
/// It must appear there exactly once, as plain text: a selection that crosses
/// markup (a link, an emphasis marker, math) has no plain-text span, and one
/// that repeats in the block cannot be told apart. Either way the result says
/// why, so the app can offer something else.
export function sourceSpan(raw, line, end, quote) {
  const words = String(quote || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { error: 'empty' };
  const block = blockSpan(raw, line, end);
  const region = raw.slice(block.start, block.end);
  // A word at either edge must not sit inside a longer word: "is" is not in "This".
  const lead = WORD_EDGE.test(words[0].charAt(0)) ? `(?<![${WORD_CLASS}])` : '';
  const tail = WORD_EDGE.test(words.at(-1).slice(-1)) ? `(?![${WORD_CLASS}])` : '';
  const pattern = new RegExp(lead + words.map(wordPattern).join('\\s+') + tail, 'gu');
  const found = [...region.matchAll(pattern)];
  if (found.length === 0) return { error: 'markup', block };
  if (found.length > 1) return { error: 'repeated', block };
  const start = block.start + found[0].index;
  return { start, end: start + found[0][0].length, block };
}

/// The edit that formats `span` of `raw`, or removes that formatting when the
/// span already carries it: { start, expected, replacement }.
export function formatEdit(raw, span, format) {
  const markers = FORMATS[format];
  if (!markers) throw new Error(`unknown format: ${format}`);
  const [open, close] = markers;
  const text = raw.slice(span.start, span.end);
  const before = raw.slice(Math.max(0, span.start - open.length), span.start);
  const after = raw.slice(span.end, span.end + close.length);
  // A single star is italic only when it is not half of a bold pair.
  const single = format === 'italic';
  const wrapped = before === open && after === close &&
    (!single || (raw[span.start - 2] !== '*' && raw[span.end + 1] !== '*'));
  if (wrapped) {
    return {
      start: span.start - open.length,
      expected: `${open}${text}${close}`,
      replacement: text,
      removed: true,
    };
  }
  return { start: span.start, expected: text, replacement: `${open}${text}${close}`, removed: false };
}

/// The edit that removes `span` from `raw`, tidying an adjacent space so
/// deleting a word mid-sentence does not leave a double space or a space
/// before punctuation.
export function deleteEdit(raw, span) {
  let { start, end } = span;
  const before = raw[start - 1];
  const after = raw[end];
  if (before === ' ' && (after === ' ' || (after && ',.;:!?)]}'.includes(after)))) {
    start -= 1;
  } else if (after === ' ' && (start === 0 || raw[start - 1] === '\n')) {
    end += 1;
  }
  return {
    start,
    expected: raw.slice(start, end),
    replacement: '',
  };
}

/// The edit that appends a parenthetical explanation `term (explanation)`
/// right after `span` in `raw`.
export function parentheticalEdit(raw, span, explanation) {
  // One line: a blank line in the explanation would split the paragraph.
  const clean = String(explanation || '').replace(/\s+/g, ' ').trim().replace(/^\(\s*(.*?)\s*\)$/, '$1').trim();
  if (!clean) return null;
  const expected = raw.slice(span.start, span.end);
  return {
    start: span.start,
    expected,
    replacement: `${expected} (${clean})`,
  };
}

/// The edit that sets or updates `{width=N%}` on the Markdown image in the
/// block at 1-based `line`.
export function figureWidthEdit(raw, line, widthPct) {
  const pct = Math.min(100, Math.max(10, Math.round(Number(widthPct) || 100)));
  const block = blockSpan(raw, line, line);
  const region = raw.slice(block.start, block.end);
  // A path may hold one pair of parentheses: ![a](img(1).png).
  const images = [...region.matchAll(/(!\[[^\]]*\]\((?:[^()\n]|\([^()\n]*\))+\))(\{[^}\n]*\})?/g)];
  if (images.length === 0) return { error: 'no-image', block };
  // Two images in one block: which one is meant is not known, so leave both alone.
  if (images.length > 1) return { error: 'several-images', block };
  const match = images[0];
  const [full, imagePart, attrs] = match;
  let nextAttrs;
  if (attrs) {
    const inner = attrs.slice(1, -1).trim();
    // "width = 80%" and "width= 80%" are the same key; the value stops before "height=3".
    if (/(^|\s)width\s*=/.test(inner)) {
      nextAttrs = `{${inner.replace(/(^|\s)width\s*=(?:\s*(?!\S*\s*=|[#.])\S+)?/, `$1width=${pct}%`)}}`;
    } else {
      nextAttrs = inner ? `{width=${pct}% ${inner}}` : `{width=${pct}%}`;
    }
  } else {
    nextAttrs = `{width=${pct}%}`;
  }
  const start = block.start + match.index;
  return {
    start,
    expected: full,
    replacement: `${imagePart}${nextAttrs}`,
  };
}
