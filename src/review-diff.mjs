/// Before and after of an applied review: the Markdown source the review was
/// made on, against the passage as the file reads now, as a word-level diff
/// cut to a size the review panel can show.
import { diff_match_patch } from './vendor/diff-match-patch/diff_match_patch.mjs';
import { blockSpan } from './md-edit.mjs';

/// The store keeps at most this many bytes of `before`.
export const BEFORE_LIMIT = 20_000;
/// Longer texts are not compared: the panel says so instead.
export const DIFF_INPUT_LIMIT = 40_000;

const dmp = new diff_match_patch();
dmp.Diff_Timeout = 0.25;

const TOKEN = /\s+|[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu;
const WORD = /[\p{L}\p{M}\p{N}_]+/gu;

/// The source a review covers: its lines, out to the end of the paragraph its
/// last line is in; '' when it has no line.
export function passageText(raw, at) {
  const line = Number(at?.line);
  if (typeof raw !== 'string' || !Number.isInteger(line) || line < 1) return '';
  const span = blockSpan(raw, line, Number(at?.end) || line);
  return raw.slice(span.start, span.end).replace(/^(?:[ \t]*\r?\n)+/, '');
}

/// `before` for a new review: the passage, or '' when it is too long to keep.
export function passageSource(raw, at) {
  const text = passageText(raw, at);
  return new TextEncoder().encode(text).length <= BEFORE_LIMIT ? text : '';
}

/// Word-level diff: runs of [op, text], op -1 removed, 1 added, 0 kept. Each
/// word, space run and punctuation mark is one unit, then the semantic
/// cleanup merges the small runs a reader would not split. Null when either
/// text is too long to compare.
export function wordDiff(before, after) {
  const one = String(before ?? '');
  const two = String(after ?? '');
  if (one.length > DIFF_INPUT_LIMIT || two.length > DIFF_INPUT_LIMIT) return null;
  const codes = new Map();
  const units = [];
  const encode = (text) => (text.match(TOKEN) || []).map((token) => {
    let code = codes.get(token);
    if (code === undefined) {
      code = units.length;
      codes.set(token, code);
      units.push(token);
    }
    return String.fromCharCode(code);
  }).join('');
  const first = encode(one);
  const second = encode(two);
  let diffs;
  if (units.length > 0xffff) {
    diffs = dmp.diff_main(one, two);
    dmp.diff_cleanupSemantic(diffs);
  } else {
    // Cleaned while each character is still one word, so no edit splits a word.
    diffs = dmp.diff_main(first, second, false);
    dmp.diff_cleanupSemantic(diffs);
    dmp.diff_charsToLines_(diffs, units);
  }
  return diffs.map(([op, text]) => [op, text]);
}

const wordCount = (text) => (text.match(WORD) || []).length;

/// What the panel draws from a diff: `parts` of kind same, del, ins or gap (a
/// long unchanged run left out), at most `limit` characters in all; `cut`
/// when the end was left out. Counts are words.
export function diffView(diffs, { context = 60, limit = 1500 } = {}) {
  const parts = [];
  let added = 0;
  let removed = 0;
  for (const [op, text] of diffs) {
    if (op > 0) added += wordCount(text);
    else if (op < 0) removed += wordCount(text);
  }
  let room = limit;
  let cut = false;
  const push = (kind, text) => {
    if (!text) return;
    if (kind === 'gap') {
      parts.push({ kind, text: '…' });
      return;
    }
    if (text.length > room) {
      if (room > 0) parts.push({ kind, text: text.slice(0, room) });
      room = 0;
      cut = true;
      return;
    }
    parts.push({ kind, text });
    room -= text.length;
  };
  diffs.forEach(([op, text], index) => {
    if (cut) return;
    if (op !== 0) {
      push(op < 0 ? 'del' : 'ins', text);
      return;
    }
    const lead = index === 0;
    const last = index === diffs.length - 1;
    if (text.length <= context * (lead || last ? 1 : 2) + 8) {
      push('same', text);
      return;
    }
    const head = text.slice(0, context).replace(/\S*$/, '') || text.slice(0, context);
    const tail = text.slice(-context).replace(/^\S*/, '') || text.slice(-context);
    if (!lead) push('same', head);
    push('gap', '…');
    if (!last) push('same', tail);
  });
  return { parts, added, removed, cut, changed: diffs.some(([op]) => op !== 0) };
}
