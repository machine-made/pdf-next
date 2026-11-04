/// The caret in the rendered Markdown view, in source terms. The DOM has no
/// offsets: a caret is a point in one text node. Its place in the source is the
/// one place in the block where the text on either side of it appears exactly
/// as written. Offsets are UTF-16 indices into the .md text, as Rust splices them.

import { blockSpan, escapeRegExp, SMART } from './md-edit.mjs';

/// A pause this long ends a run of typed characters: a run is one undo step.
const TYPING_PAUSE_MS = 600;

/// A run of typed characters is cut here: a longer run is undone in steps of this size.
const TYPED_RUN_LIMIT = 200;

export const CARET_MESSAGES = {
  skipped: 'Math, code, links, tables and figures are not edited here',
  markup: 'The caret is next to formatting or a link: move it into plain text',
  repeated: 'That text appears more than once in its paragraph: move the caret to a longer passage',
  empty: 'Click in the text to place the caret',
  paragraph: 'This would join two paragraphs: not done here',
};

/// A rendered text as a pattern over the source. A run of whitespace in the
/// source matches any run in the text, and smart punctuation matches its
/// source forms.
function plainPattern(text) {
  return text
    .split(/\s+/)
    .map((word) => [...word].map((character) => SMART[character] ?? escapeRegExp(character)).join(''))
    .join('\\s+');
}

/// The source offset of a caret: `at` UTF-16 units into `text`, a text node of
/// the rendered block whose source line is `line`. The text on each side of the
/// caret must make one exact match in the block; none is refused as markup, more
/// than one as repeated. `start` and `end` bound the matched run in the source:
/// the caret may not leave it, because the markup beside it is not plain text.
export function offsetInText(raw, line, text, at) {
  if (!text.trim()) return { error: 'empty' };
  const block = blockSpan(raw, line, line);
  const pattern = new RegExp(
    `(?<before>${plainPattern(text.slice(0, at))})(?<after>${plainPattern(text.slice(at))})`,
    'gu',
  );
  const found = [...raw.slice(block.start, block.end).matchAll(pattern)];
  if (found.length === 0) return { error: 'markup' };
  if (found.length > 1) return { error: 'repeated' };
  const start = block.start + found[0].index;
  return {
    offset: start + found[0].groups.before.length,
    start,
    end: start + found[0][0].length,
  };
}

/// The caret again, after the file changed: the text on each side of it is
/// searched for in the whole source, and the match nearest `near` (the old
/// offset) wins. Null when that text is gone.
export function relocate(raw, text, at, near) {
  if (!text.trim()) return null;
  const pattern = new RegExp(
    `(?<before>${plainPattern(text.slice(0, at))})(?<after>${plainPattern(text.slice(at))})`,
    'gu',
  );
  const found = [...raw.matchAll(pattern)];
  if (found.length === 0) return null;
  const best = found.reduce((a, b) => (Math.abs(b.index - near) < Math.abs(a.index - near) ? b : a));
  return {
    offset: best.index + best.groups.before.length,
    start: best.index,
    end: best.index + best[0].length,
  };
}

/// How many rendered characters `source` takes up. A run of whitespace in the
/// source takes up as much of the rendered run as it has characters, so a
/// source offset inside a run of spaces stays inside it.
function renderedLength(text, source) {
  let i = 0;
  let j = 0;
  while (i < text.length && j < source.length) {
    if (/\s/.test(text[i])) {
      let run = 0;
      while (i + run < text.length && /\s/.test(text[i + run])) run += 1;
      let seen = 0;
      while (j + seen < source.length && /\s/.test(source[j + seen])) seen += 1;
      i += seen === 0 ? run : Math.min(run, seen);
      j += seen;
    } else if (/\s/.test(source[j])) {
      j += 1;
    } else {
      i += 1;
      j += 1;
    }
  }
  return i;
}

/// Where source `offset` falls among the rendered text nodes of its block:
/// `{ index, at, start, end }` into `texts`, with `start`/`end` the node's run in
/// the source, or null. A node places the offset when its own text matches the
/// source exactly once in the block and spans the offset. An offset inside markup
/// goes to the end of the node before it.
export function nodeAtOffset(raw, offset, texts) {
  const line = raw.slice(0, offset).split('\n').length;
  const block = blockSpan(raw, line, line);
  const region = raw.slice(block.start, block.end);
  let before = null;
  for (const [index, text] of texts.entries()) {
    if (!text.trim()) continue;
    const found = [...region.matchAll(new RegExp(plainPattern(text), 'gu'))];
    if (found.length !== 1) continue;
    const start = block.start + found[0].index;
    const end = start + found[0][0].length;
    if (start <= offset && offset <= end) {
      return { index, at: renderedLength(text, raw.slice(start, offset)), start, end };
    }
    if (end <= offset) before = { index, at: text.length, start, end };
  }
  return before;
}

/// Typing `text` at `caret` ({ offset, start, end }). The edit carries the caret
/// after it, bounds included.
export function insertEdit(caret, text) {
  return {
    start: caret.offset,
    expected: '',
    replacement: text,
    after: { offset: caret.offset + text.length, start: caret.start, end: caret.end + text.length },
  };
}

/// Backspace at `caret`: removes the character before it, inside the run only,
/// never a line break.
export function backspaceEdit(raw, caret) {
  if (caret.offset <= caret.start) return { error: 'markup' };
  if (raw[caret.offset - 1] === '\n') return { error: 'paragraph' };
  const offset = caret.offset - 1;
  return {
    start: offset,
    expected: raw[offset],
    replacement: '',
    after: { offset, start: caret.start, end: caret.end - 1 },
  };
}

/// Delete at `caret`: removes the character after it, inside the run only,
/// never a line break.
export function forwardDeleteEdit(raw, caret) {
  if (caret.offset >= caret.end) return { error: 'markup' };
  if (raw[caret.offset] === '\n') return { error: 'paragraph' };
  return {
    start: caret.offset,
    expected: raw[caret.offset],
    replacement: '',
    after: { offset: caret.offset, start: caret.start, end: caret.end - 1 },
  };
}

/// True when the typed character `edit` continues the run that `last` ends:
/// the same place, a typed character too, within the pause, and under the run limit.
export function continuesTyping(last, edit, elapsedMs) {
  return Boolean(last?.typing) && edit.expected === '' && edit.replacement !== '' &&
    last.after.offset === edit.start && elapsedMs < TYPING_PAUSE_MS &&
    (last.edits?.length ?? 0) < TYPED_RUN_LIMIT;
}
