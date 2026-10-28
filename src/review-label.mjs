/// Stable review badges and conservative text matching helpers.

export function reviewIdNum(id) {
  const n = Number.parseInt(String(id || '').replace(/^r/i, ''), 10);
  return Number.isFinite(n) && n >= 1 ? n : 0;
}

export function normalizeReviewText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/// For each character of `normalizeReviewText(text)`, its index in `text`.
/// A space stands for the whitespace run before the next word.
function normalizedIndexMap(text) {
  const map = [];
  for (const run of text.matchAll(/\S+/g)) {
    if (map.length) map.push(run.index - 1);
    // Lower case can lengthen a word; extra characters map to its last one.
    const length = run[0].toLowerCase().length;
    for (let k = 0; k < length; k += 1) map.push(run.index + Math.min(k, run[0].length - 1));
  }
  return map;
}

/// Return the full quote only when it has one exact occurrence.
export function findNormalizedSpan(joined, needle) {
  const want = normalizeReviewText(needle);
  const hay = normalizeReviewText(joined);
  if (want.length < 2 || !hay) {
    return null;
  }
  const start = hay.indexOf(want);
  if (start < 0 || hay.indexOf(want, start + 1) >= 0) {
    return null;
  }
  return { start, end: start + want.length };
}

/// Every non-overlapping occurrence of `want` in `hay`, which the caller has
/// already normalized, so that offsets index the caller's own text. At most
/// `limit` of them.
export function findAllSpans(hay, want, limit = Infinity) {
  const spans = [];
  const needle = normalizeReviewText(want);
  for (let at = needle ? hay.indexOf(needle) : -1; at >= 0 && spans.length < limit;
    at = hay.indexOf(needle, at + needle.length)) {
    spans.push({ start: at, end: at + needle.length });
  }
  return spans;
}

export function reviewLabel(review, reviews) {
  return String(review?.id || 'review');
}

/// What a review asks of the agent. Improve needs an instruction; the others
/// say what to do by themselves. Unknown actions read as Improve.
export const REVIEW_ACTIONS = ['improve', 'polish', 'shorten', 'expand', 'check', 'define', 'gloss', 'bold', 'italic', 'delete'];

export const ACTION_LABELS = {
  improve: 'Improve',
  polish: 'Polish',
  shorten: 'Shorten',
  expand: 'Expand',
  check: 'Check',
  define: 'Parenthetical definition',
  gloss: 'Gloss',
  bold: 'Make bold',
  italic: 'Make italic',
  delete: 'Delete selection',
};

export function reviewAction(review) {
  return REVIEW_ACTIONS.includes(review?.action) ? review.action : 'improve';
}

export function reviewStatus(review) {
  return ['open', 'applied', 'resolved'].includes(review?.status) ? review.status : 'open';
}

export function reviewColor(review, count = 16) {
  const color = Number(review?.color);
  if (Number.isInteger(color) && color >= 1 && color <= count) return color;
  const n = reviewIdNum(review?.id);
  return n > 0 ? ((n - 1) % count) + 1 : 1;
}

export function sameReviewQuote(review, selectedQuote) {
  const quote = normalizeReviewText(review?.quote);
  return quote.length >= 2 && quote === normalizeReviewText(selectedQuote);
}

export function reattachedReviewAnchor(previous, next, at, quote) {
  const original = previous?.original ?? {
    anchor: previous ? { ...previous } : null,
    at: at ? { ...at } : {},
    quote: String(quote || ''),
  };
  return { ...next, original };
}

function matchesContext(text, start, end, { prefix, suffix }, loose = false) {
  const squeeze = (value) => (loose ? value.replace(/ /g, '') : value);
  // Normalized text has at most one space between characters. Even a loose
  // comparison needs only twice the context length, plus a boundary space.
  const scale = loose ? 2 : 1;
  return (!prefix || squeeze(text.slice(Math.max(0, start - prefix.length * scale - 1), start).trimEnd()).endsWith(prefix)) &&
    (!suffix || squeeze(text.slice(end, end + suffix.length * scale + 1).trimStart()).startsWith(suffix));
}

/// Yield each occurrence of `want` in `text`. The loose form ignores spaces,
/// because PDF.js splits a word at a font change or inline math, and the
/// page text then has a space that the selected text does not have.
function* occurrences(text, want, loose) {
  if (!loose) {
    let from = 0;
    while ((from = text.indexOf(want, from)) >= 0) {
      yield { start: from, end: from + want.length };
      from += 1;
    }
    return;
  }
  const map = [];
  let compact = '';
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== ' ') {
      compact += text[index];
      map.push(index);
    }
  }
  const needle = want.replace(/ /g, '');
  // Without spaces, "in the wake" is also inside "within the wake". A loose
  // match must therefore start and end at a word boundary.
  const wordCharacter = (character) => /[\p{L}\p{N}]/u.test(character || '');
  let from = 0;
  while (needle && (from = compact.indexOf(needle, from)) >= 0) {
    const start = map[from];
    const end = map[from + needle.length - 1] + 1;
    if (!wordCharacter(text[start - 1]) && !wordCharacter(text[end])) yield { start, end };
    from += 1;
  }
}

/// How many characters of saved context still agree with the text around a
/// candidate: the tail of the prefix plus the head of the suffix. Bounded by
/// the context length, so a repetitive page costs little per candidate.
function contextScore(text, start, end, { prefix, suffix }, loose = false) {
  const squeeze = (value) => (loose ? value.replace(/ /g, '') : value);
  const scale = loose ? 2 : 1;
  let score = 0;
  if (prefix) {
    const before = squeeze(text.slice(Math.max(0, start - prefix.length * scale - 1), start).trimEnd());
    while (score < prefix.length && score < before.length &&
      prefix[prefix.length - 1 - score] === before[before.length - 1 - score]) score += 1;
  }
  if (suffix) {
    const after = squeeze(text.slice(end, end + suffix.length * scale + 1).trimStart());
    let head = 0;
    while (head < suffix.length && head < after.length && suffix[head] === after[head]) head += 1;
    score += head;
  }
  return score;
}

/// Agreeing context characters that let a candidate stand without a full
/// match: about two words on one side.
const CONTEXT_EVIDENCE = 8;
/// A quote this long is distinctive on its own: one occurrence of it is
/// taken even when the text around it has changed.
const DISTINCT_QUOTE = 12;
/// Context used to find a quote whose own words were edited.
const EDGE_CONTEXT = 24;

/// Where a quote stood, when its own words are gone but the text on both
/// sides of it is still there: the text between them is what it became.
function changedSpan(list, want, anchor) {
  const prefix = normalizeReviewText(anchor?.prefix).slice(-EDGE_CONTEXT);
  const suffix = normalizeReviewText(anchor?.suffix).slice(0, EDGE_CONTEXT);
  // Both sides distinctive, or one side long and the other at least present:
  // a quote at the end of a paragraph has little after it.
  const strongPrefix = prefix.length >= EDGE_CONTEXT || (prefix.length >= DISTINCT_QUOTE && suffix.length >= DISTINCT_QUOTE);
  const strongSuffix = suffix.length >= EDGE_CONTEXT || (prefix.length >= DISTINCT_QUOTE && suffix.length >= DISTINCT_QUOTE);
  if (!prefix || !suffix || (!strongPrefix && !strongSuffix)) return null;
  const reach = Math.max(400, want.length * 4);
  let found = null;
  for (const item of list) {
    const text = item.text;
    if (strongPrefix) {
      for (let from = text.indexOf(prefix); from >= 0; from = text.indexOf(prefix, from + 1)) {
        const after = from + prefix.length;
        const next = text.indexOf(suffix, after);
        if (next < 0 || next - after > reach) continue;
        if (found) return null;
        found = { item, start: after, end: next };
      }
    } else {
      for (let next = text.indexOf(suffix); next >= 0; next = text.indexOf(suffix, next + 1)) {
        const from = text.lastIndexOf(prefix, next - prefix.length);
        if (from < 0 || next - (from + prefix.length) > reach) continue;
        if (found) return null;
        found = { item, start: from + prefix.length, end: next };
      }
    }
  }
  if (!found) return null;
  let { start, end } = found;
  const text = found.item.text;
  while (start < end && text[start] === ' ') start += 1;
  while (end > start && text[end - 1] === ' ') end -= 1;
  return end > start ? { ...found, start, end } : null;
}

/// Locate a quote by exact text and captured context.
///
/// A candidate whose saved context matches in full wins, as before. When the
/// text around a quote has been edited, which is what an agent fixing nearby
/// reviews does, the candidate is still taken: a single occurrence of a
/// distinctive quote, or the one candidate whose context clearly agrees best.
/// Those results carry `moved: true`. A repeated quote with no deciding
/// context stays ambiguous, and a match that ignores spaces is used only when
/// the quote has no exact occurrence. When the quote itself is gone but its
/// neighbours are not, the result is `changed`, spanning what stands between.
export function resolveReviewAnchor(pages, quote, anchor = {}) {
  const want = normalizeReviewText(quote);
  // `normalized` text is already lower-cased with single spaces: a caller that
  // matches many quotes in one long text need not rewrite it for each.
  const list = (Array.isArray(pages) ? pages : []).map((item) => ({
    page: Number(item?.page), text: item?.normalized ? item.text : normalizeReviewText(item?.text),
    source: item?.normalized ? null : String(item?.text || ''),
  })).filter((item) => Number.isInteger(item.page) && item.page > 0);
  if (want.length < 2) return { status: 'unlocated' };
  const loose = !list.some((item) => item.text.includes(want));
  const squeeze = (value) => (loose ? value.replace(/ /g, '') : value);
  const context = {
    prefix: squeeze(normalizeReviewText(anchor?.prefix).slice(-48)),
    suffix: squeeze(normalizeReviewText(anchor?.suffix).slice(0, 48)),
  };
  // Offsets index the text the caller passed. The map is built only for
  // the page that holds the match.
  const located = ({ item, start, end }, extra = {}) => {
    const map = item.source === null ? null : normalizedIndexMap(item.source);
    return map
      ? { status: 'located', page: item.page, start: map[start], end: map[end - 1] + 1, ...extra }
      : { status: 'located', page: item.page, start, end, ...extra };
  };
  let count = 0;
  let found = null;
  let fullMatches = 0;
  let best = null;
  let bestScore = -1;
  let secondScore = -1;
  for (const item of list) {
    for (const { start, end } of occurrences(item.text, want, loose)) {
      count += 1;
      if (matchesContext(item.text, start, end, context, loose)) {
        fullMatches += 1;
        found = { item, start, end };
        continue;
      }
      const score = contextScore(item.text, start, end, context, loose);
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = { item, start, end };
      } else if (score > secondScore) {
        secondScore = score;
      }
    }
  }
  if (fullMatches === 1) return located(found);
  if (fullMatches > 1) return { status: 'ambiguous' };
  if (count === 1 && (want.replace(/ /g, '').length >= DISTINCT_QUOTE || bestScore >= CONTEXT_EVIDENCE)) {
    return located(best, { moved: true });
  }
  if (count > 1 && bestScore >= CONTEXT_EVIDENCE && bestScore - Math.max(0, secondScore) >= CONTEXT_EVIDENCE) {
    return located(best, { moved: true });
  }
  if (count === 0) {
    const changed = changedSpan(list, want, anchor);
    if (changed) return { ...located(changed), status: 'changed' };
  }
  return { status: count > 1 ? 'ambiguous' : 'unlocated' };
}

/// Context for a selection: the normalized text just before and after it.
export function selectionContext(before, after) {
  return {
    prefix: normalizeReviewText(before).slice(-48),
    suffix: normalizeReviewText(after).slice(0, 48),
  };
}

/// Locate a Markdown review in the article's text. Offsets index `text`. A
/// review saved without context cannot be told apart from a repeat of its
/// quote, so `legacy` asks the caller to use the line range instead.
export function resolveMarkdownReview(text, review, { normalized = false } = {}) {
  const anchor = review?.anchor;
  const found = resolveReviewAnchor([{ page: 1, text, normalized }], review?.quote, anchor);
  if (found.status !== 'located' && found.status !== 'changed') {
    return { status: found.status, legacy: !anchor?.prefix && !anchor?.suffix };
  }
  return {
    status: found.status, start: found.start, end: found.end, ...(found.moved ? { moved: true } : {}),
  };
}

/// An open review whose recorded document digest differs from the file now
/// shown, and that the shown text does not locate: a located review is right
/// for this text whichever version it was made on.
export function madeOnOlderVersion(review, digest, locationStatus) {
  const made = review?.anchor?.documentRevision;
  return Boolean(digest && made && made !== digest && reviewStatus(review) === 'open' &&
    locationStatus !== 'located');
}

/// The saved context a located review should carry now: the text around its
/// match. When it differs from what is saved, the review has drifted and the
/// record is rewritten, so the next edit starts from where the quote is.
export function contextAt(text, start, end) {
  return selectionContext(text.slice(Math.max(0, start - 200), start), text.slice(end, end + 200));
}
