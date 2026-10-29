//! Find a Markdown review's quote again after the file was edited, without
//! the app. The text searched is the one the app matches in (the rendered
//! words, lower case, one space between), and the rules are those of
//! `resolveReviewAnchor` in src/review-label.mjs, so the CLI and the app agree
//! on where a review stands. Only when those rules find nothing does a fuzzy
//! search (diff-match-patch) look for an edited quote near its old line.

use diff_match_patch_rs::{Compat, DiffMatchPatch};

/// Agreeing context characters that let a candidate stand without a full
/// match. Same values as review-label.mjs.
const CONTEXT_EVIDENCE: usize = 8;
const DISTINCT_QUOTE: usize = 12;
const EDGE_CONTEXT: usize = 24;
const CONTEXT: usize = 48;
/// The longest pattern diff-match-patch matches in one piece.
const MATCH_BITS: usize = 32;

/// A document's rendered text, with the source line of each character.
pub(crate) struct Rendered {
    pub(crate) chars: Vec<char>,
    /// The first line of the top-level block the character is in: the line
    /// the app records in `at` for a selection there.
    pub(crate) block_lines: Vec<u32>,
    /// The character's own source line.
    pub(crate) lines: Vec<u32>,
}

/// The rendered text of `source`, as the app's `collectTextParts` joins it:
/// text inside one block runs together, a space stands where the source has
/// white space or a block ends. Images and raw HTML have no text.
pub(crate) fn rendered(source: &str) -> Rendered {
    use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_SMART_PUNCTUATION);
    options.insert(Options::ENABLE_MATH);
    let offsets = crate::line_start_offsets(source);
    let line = |at: usize| crate::line_at_offset(&offsets, at) as u32;
    let merged: Vec<_> = pulldown_cmark::TextMergeWithOffset::new(
        Parser::new_ext(source, options).into_offset_iter(),
    )
    .collect();
    let mut out = Rendered {
        chars: Vec::with_capacity(source.len()),
        block_lines: Vec::with_capacity(source.len()),
        lines: Vec::with_capacity(source.len()),
    };
    let mut depth = 0usize;
    let mut block_line = 1;
    let mut image = 0usize;
    let mut space = false;
    let push = |out: &mut Rendered,
                text: &str,
                range: &std::ops::Range<usize>,
                block_line: u32,
                space: &mut bool| {
        for (at, ch) in text.char_indices() {
            if ch.is_whitespace() {
                *space = true;
                continue;
            }
            let source_line = line(range.start + at.min(range.len().saturating_sub(1)));
            if std::mem::take(space) && out.chars.last().is_some_and(|last| *last != ' ') {
                out.chars.push(' ');
                out.block_lines.push(block_line);
                out.lines.push(source_line);
            }
            for lower in ch.to_lowercase() {
                out.chars.push(lower);
                out.block_lines.push(block_line);
                out.lines.push(source_line);
            }
        }
    };
    let inline = |tag: &Tag| {
        matches!(
            tag,
            Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Link { .. } | Tag::Image { .. }
        )
    };
    let inline_end = |tag: &TagEnd| {
        matches!(
            tag,
            TagEnd::Emphasis
                | TagEnd::Strong
                | TagEnd::Strikethrough
                | TagEnd::Link
                | TagEnd::Image
        )
    };
    for (event, range) in crate::math_fences(source, merged) {
        match event {
            Event::Start(tag) => {
                if depth == 0 {
                    block_line = line(range.start);
                }
                depth += 1;
                if matches!(tag, Tag::Image { .. }) {
                    image += 1;
                }
                space |= !inline(&tag);
            }
            Event::End(tag) => {
                depth = depth.saturating_sub(1);
                if matches!(tag, TagEnd::Image) {
                    image = image.saturating_sub(1);
                }
                space |= !inline_end(&tag);
            }
            Event::Text(text) | Event::Code(text) if image == 0 => {
                push(&mut out, &text, &range, block_line, &mut space);
            }
            Event::InlineMath(tex) => {
                push(&mut out, &math_text(&tex), &range, block_line, &mut space)
            }
            Event::DisplayMath(tex) => {
                if depth == 0 {
                    block_line = line(range.start);
                }
                space = true;
                push(&mut out, &math_text(&tex), &range, block_line, &mut space);
                space = true;
            }
            Event::SoftBreak | Event::HardBreak => space = true,
            _ => {}
        }
    }
    out
}

/// TeX as plain letters: `v^*` reads `v*`, `\alpha` is dropped. The app sees
/// MathML glyphs there, so a quote across an equation is found by context.
fn math_text(tex: &str) -> String {
    let mut out = String::with_capacity(tex.len());
    let mut command = false;
    for ch in tex.chars() {
        if ch == '\\' {
            command = true;
            continue;
        }
        if command && ch.is_ascii_alphabetic() {
            continue;
        }
        command = false;
        if !matches!(ch, '^' | '_' | '{' | '}') {
            out.push(ch);
        }
    }
    out
}

/// `normalizeReviewText`: white space runs as one space, trimmed, lower case.
pub(crate) fn normalize(text: &str) -> Vec<char> {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
        .chars()
        .collect()
}

/// The saved context of a selection at `start..end`, as `contextAt` makes it.
pub(crate) fn context_at(text: &[char], start: usize, end: usize) -> (String, String) {
    let before: String = text[start.saturating_sub(200)..start].iter().collect();
    let after: String = text[end..(end + 200).min(text.len())].iter().collect();
    let prefix = normalize(&before);
    let suffix = normalize(&after);
    (
        prefix[prefix.len().saturating_sub(CONTEXT)..]
            .iter()
            .collect(),
        suffix[..suffix.len().min(CONTEXT)].iter().collect(),
    )
}

#[derive(Debug, PartialEq)]
pub(crate) enum Found {
    /// The quote, at `start..end` of the text. `moved`: its context changed.
    Located {
        start: usize,
        end: usize,
        moved: bool,
    },
    /// The quote's own words changed; this is what stands between its context.
    Changed {
        start: usize,
        end: usize,
    },
    /// More than one place fits; these are the candidates.
    Ambiguous(Vec<(usize, usize)>),
    Unlocated,
}

fn find_from(hay: &[char], needle: &[char], from: usize) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&at| hay[at..at + needle.len()] == *needle)
}

/// The last occurrence of `needle` that starts at or before `before`.
fn rfind_until(hay: &[char], needle: &[char], before: usize) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    (0..=before.min(hay.len() - needle.len()))
        .rev()
        .find(|&at| hay[at..at + needle.len()] == *needle)
}

fn squeezed(text: &[char], loose: bool) -> Vec<char> {
    text.iter()
        .copied()
        .filter(|ch| !loose || *ch != ' ')
        .collect()
}

fn trimmed(text: &[char]) -> (usize, usize) {
    let start = text.iter().position(|ch| *ch != ' ').unwrap_or(text.len());
    let end = text
        .iter()
        .rposition(|ch| *ch != ' ')
        .map_or(start, |at| at + 1);
    (start, end)
}

fn before_context(text: &[char], start: usize, prefix: &[char], loose: bool) -> Vec<char> {
    let scale = if loose { 2 } else { 1 };
    let piece = &text[start.saturating_sub(prefix.len() * scale + 1)..start];
    let (_, end) = trimmed(piece);
    squeezed(&piece[..end], loose)
}

fn after_context(text: &[char], end: usize, suffix: &[char], loose: bool) -> Vec<char> {
    let scale = if loose { 2 } else { 1 };
    let piece = &text[end..(end + suffix.len() * scale + 1).min(text.len())];
    let (start, _) = trimmed(piece);
    squeezed(&piece[start..], loose)
}

fn matches_context(
    text: &[char],
    at: (usize, usize),
    prefix: &[char],
    suffix: &[char],
    loose: bool,
) -> bool {
    (prefix.is_empty() || before_context(text, at.0, prefix, loose).ends_with(prefix))
        && (suffix.is_empty() || after_context(text, at.1, suffix, loose).starts_with(suffix))
}

fn context_score(
    text: &[char],
    at: (usize, usize),
    prefix: &[char],
    suffix: &[char],
    loose: bool,
) -> usize {
    let mut score = 0;
    if !prefix.is_empty() {
        let before = before_context(text, at.0, prefix, loose);
        score += prefix
            .iter()
            .rev()
            .zip(before.iter().rev())
            .take_while(|(a, b)| a == b)
            .count();
    }
    if !suffix.is_empty() {
        let after = after_context(text, at.1, suffix, loose);
        score += suffix
            .iter()
            .zip(&after)
            .take_while(|(a, b)| a == b)
            .count();
    }
    score
}

/// Every occurrence of `want`. The loose form ignores spaces but must start
/// and end at a word boundary.
fn occurrences(text: &[char], want: &[char], loose: bool) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    if !loose {
        let mut from = 0;
        while let Some(at) = find_from(text, want, from) {
            found.push((at, at + want.len()));
            from = at + 1;
        }
        return found;
    }
    let (compact, map): (Vec<char>, Vec<usize>) = text
        .iter()
        .enumerate()
        .filter(|(_, ch)| **ch != ' ')
        .map(|(at, ch)| (*ch, at))
        .unzip();
    let needle = squeezed(want, true);
    let word = |at: Option<&char>| at.is_some_and(|ch| ch.is_alphanumeric());
    let mut from = 0;
    while let Some(at) = find_from(&compact, &needle, from) {
        let start = map[at];
        let end = map[at + needle.len() - 1] + 1;
        if !word(start.checked_sub(1).and_then(|before| text.get(before))) && !word(text.get(end)) {
            found.push((start, end));
        }
        from = at + 1;
    }
    found
}

/// `changedSpan`: the quote's words are gone, but the text on both sides is
/// still there; what stands between them is what it became.
fn changed_span(
    text: &[char],
    want: &[char],
    prefix: &str,
    suffix: &str,
) -> Option<(usize, usize)> {
    let prefix = normalize(prefix);
    let prefix = &prefix[prefix.len().saturating_sub(EDGE_CONTEXT)..];
    let suffix = normalize(suffix);
    let suffix = &suffix[..suffix.len().min(EDGE_CONTEXT)];
    let both = prefix.len() >= DISTINCT_QUOTE && suffix.len() >= DISTINCT_QUOTE;
    let strong_prefix = prefix.len() >= EDGE_CONTEXT || both;
    let strong_suffix = suffix.len() >= EDGE_CONTEXT || both;
    if prefix.is_empty() || suffix.is_empty() || (!strong_prefix && !strong_suffix) {
        return None;
    }
    let reach = (want.len() * 4).max(400);
    let mut found = None;
    if strong_prefix {
        let mut from = 0;
        while let Some(at) = find_from(text, prefix, from) {
            from = at + 1;
            let after = at + prefix.len();
            let Some(next) = find_from(text, suffix, after) else {
                continue;
            };
            if next - after > reach {
                continue;
            }
            if found.is_some() {
                return None;
            }
            found = Some((after, next));
        }
    } else {
        let mut from = 0;
        while let Some(next) = find_from(text, suffix, from) {
            from = next + 1;
            let Some(at) = next
                .checked_sub(prefix.len())
                .and_then(|before| rfind_until(text, prefix, before))
            else {
                continue;
            };
            if next - (at + prefix.len()) > reach {
                continue;
            }
            if found.is_some() {
                return None;
            }
            found = Some((at + prefix.len(), next));
        }
    }
    let (start, end) = found?;
    let (from, to) = trimmed(&text[start..end]);
    (to > from).then_some((start + from, start + to))
}

/// `resolveReviewAnchor` on one text.
pub(crate) fn resolve(text: &[char], quote: &str, prefix: &str, suffix: &str) -> Found {
    let want = normalize(quote);
    if want.len() < 2 {
        return Found::Unlocated;
    }
    let loose = find_from(text, &want, 0).is_none();
    let prefix_context = normalize(prefix);
    let prefix_context = squeezed(
        &prefix_context[prefix_context.len().saturating_sub(CONTEXT)..],
        loose,
    );
    let suffix_context = normalize(suffix);
    let suffix_context = squeezed(&suffix_context[..suffix_context.len().min(CONTEXT)], loose);
    let all = occurrences(text, &want, loose);
    let full: Vec<(usize, usize)> = all
        .iter()
        .copied()
        .filter(|at| matches_context(text, *at, &prefix_context, &suffix_context, loose))
        .collect();
    if full.len() == 1 {
        return Found::Located {
            start: full[0].0,
            end: full[0].1,
            moved: false,
        };
    }
    if full.len() > 1 {
        return Found::Ambiguous(full);
    }
    let mut scores: Vec<(usize, (usize, usize))> = all
        .iter()
        .map(|at| {
            (
                context_score(text, *at, &prefix_context, &suffix_context, loose),
                *at,
            )
        })
        .collect();
    // Stable, so the first of equal scores wins, as in the app.
    scores.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    let best = scores.first().copied();
    let second = scores.get(1).map_or(0, |(score, _)| *score);
    match best {
        Some((score, (start, end)))
            if all.len() == 1
                && (squeezed(&want, true).len() >= DISTINCT_QUOTE || score >= CONTEXT_EVIDENCE) =>
        {
            Found::Located {
                start,
                end,
                moved: true,
            }
        }
        Some((score, (start, end)))
            if all.len() > 1 && score >= CONTEXT_EVIDENCE && score - second >= CONTEXT_EVIDENCE =>
        {
            Found::Located {
                start,
                end,
                moved: true,
            }
        }
        _ if all.is_empty() => match changed_span(text, &want, prefix, suffix) {
            Some((start, end)) => Found::Changed { start, end },
            None => Found::Unlocated,
        },
        _ if all.len() > 1 => Found::Ambiguous(all),
        _ => Found::Unlocated,
    }
}

/// An edited quote near character `near`: diff-match-patch finds its first
/// and last half, and the text between must differ from the quote by no
/// more than a third of it.
pub(crate) fn fuzzy(text: &[char], quote: &str, near: usize) -> Option<(usize, usize)> {
    let want = normalize(quote);
    if squeezed(&want, true).len() < DISTINCT_QUOTE {
        return None;
    }
    let mut dmp = DiffMatchPatch::new();
    dmp.set_match_distance(4_000);
    dmp.set_match_threshold(0.4);
    let hay: String = text.iter().collect();
    let piece = |range: std::ops::Range<usize>| want[range].iter().collect::<String>();
    // The first and the last half, each at most MATCH_BITS long: an edit
    // inside the quote changes its length, so its end is found on its own.
    let half = want.len().div_ceil(2).min(MATCH_BITS);
    let start = dmp.match_main::<Compat>(&hay, &piece(0..half), near)?;
    let tail = want.len() - half;
    let end = dmp.match_main::<Compat>(&hay, &piece(tail..want.len()), start + tail)? + half;
    // To the nearest word boundary: an edit shifts where a half matches.
    let word = |at: usize| text.get(at).is_some_and(|ch| ch.is_alphanumeric());
    let boundary = |at: usize| at == 0 || at >= text.len() || !word(at - 1) || !word(at);
    let snap = |at: usize| {
        let back = (0..=at).rev().find(|at| boundary(*at)).unwrap_or(0);
        let ahead = (at..=text.len())
            .find(|at| boundary(*at))
            .unwrap_or(text.len());
        if at - back <= ahead - at {
            back
        } else {
            ahead
        }
    };
    let start = snap(start);
    let end = snap(end.min(text.len()));
    if end <= start || end - start > want.len() * 2 {
        return None;
    }
    let (from, to) = trimmed(&text[start..end]);
    let (start, end) = (start + from, start + to);
    let found: String = text[start..end].iter().collect();
    let diffs = dmp
        .diff_main::<Compat>(&piece(0..want.len()), &found)
        .ok()?;
    (dmp.diff_levenshtein(&diffs) * 3 <= want.len()).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::{context_at, fuzzy, rendered, resolve, Found};

    fn text(source: &str) -> Vec<char> {
        rendered(source).chars
    }

    #[test]
    fn rendered_text_reads_like_the_app() {
        let source = "# Wake\n\nThe *flow* sepa**rates**\nbehind the `body`.\n\n- one\n- two ![alt](a.png)\n";
        let out = rendered(source);
        let joined: String = out.chars.iter().collect();
        assert_eq!(joined, "wake the flow separates behind the body. one two");
        let at = joined.find("behind").unwrap();
        assert_eq!((out.lines[at], out.block_lines[at]), (4, 3));
        let two = joined.find("two").unwrap();
        assert_eq!(
            (out.lines[two], out.block_lines[two]),
            (7, 6),
            "a list is one top-level block"
        );
    }

    #[test]
    fn resolve_follows_the_app_rules() {
        let hay = text("the wake grows. then the wake shrinks. far away the wake stays.\n");
        let found = resolve(&hay, "the wake", "then", "shrinks");
        assert!(
            matches!(found, Found::Located { moved: false, .. }),
            "{found:?}"
        );
        assert!(
            matches!(resolve(&hay, "the wake", "", ""), Found::Ambiguous(ref all) if all.len() == 3)
        );
        let unique = resolve(&hay, "far away the wake stays", "nothing like this", "");
        assert!(
            matches!(unique, Found::Located { moved: true, .. }),
            "{unique:?}"
        );
        assert_eq!(resolve(&hay, "a vortex", "", ""), Found::Unlocated);
    }

    #[test]
    fn a_reworded_quote_is_found_between_its_context_or_fuzzily() {
        let source = "We assume the flow is steady and the wall is smooth in every case here.\n";
        let hay = text(source);
        let found = resolve(
            &hay,
            "the flow is steady",
            "we assume",
            "and the wall is smooth in every case",
        );
        assert!(matches!(found, Found::Located { .. }));
        let edited =
            text("We assume the flow is periodic and the wall is smooth in every case here.\n");
        let changed = resolve(
            &edited,
            "the flow is steady",
            "we assume",
            "and the wall is smooth in every case",
        );
        let Found::Changed { start, end } = changed else {
            panic!("{changed:?}");
        };
        assert_eq!(
            edited[start..end].iter().collect::<String>(),
            "the flow is periodic"
        );
        let (start, end) = fuzzy(&edited, "the flow is steady and the wall", 0).unwrap();
        assert_eq!(
            edited[start..end].iter().collect::<String>(),
            "the flow is periodic and the wall"
        );
        assert_eq!(fuzzy(&edited, "an unrelated sentence about heat", 0), None);
        let (prefix, suffix) = context_at(&hay, 10, 28);
        assert_eq!(
            (prefix.as_str(), suffix.as_str()),
            ("we assume", "and the wall is smooth in every case here.")
        );
    }
}
