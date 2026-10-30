//! Property tests: random sequences of review store writes keep the store's
//! invariants, and random HTML-ish Markdown never comes out able to run code.

use crate::{
    change_review_comment, mark_review_done, patch_review_record, remove_review_cas,
    render_markdown, restore_review_record, write_review, AllowedDocuments, Review,
};
use proptest::prelude::*;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

fn config(cases: u32) -> ProptestConfig {
    ProptestConfig {
        cases,
        failure_persistence: None,
        ..ProptestConfig::default()
    }
}

#[derive(Clone, Debug)]
enum Op {
    Add {
        action: &'static str,
        line: u32,
        comment: String,
    },
    Comment(usize, String),
    Status(usize, &'static str),
    Action(usize, &'static str),
    Done(usize, String),
    Delete(usize),
    Restore,
}

fn op() -> impl Strategy<Value = Op> {
    let text = "[a-z \n\t]{0,16}";
    let action = prop::sample::select(vec!["improve", "polish", "delete", "check", "request"]);
    prop_oneof![
        3 => (action.clone(), 1u32..6, text).prop_map(|(action, line, comment)| Op::Add { action, line, comment }),
        1 => (any::<usize>(), text).prop_map(|(i, c)| Op::Comment(i, c)),
        1 => (any::<usize>(), prop::sample::select(vec!["open", "applied", "resolved", "done"])).prop_map(|(i, s)| Op::Status(i, s)),
        1 => (any::<usize>(), action).prop_map(|(i, a)| Op::Action(i, a)),
        1 => (any::<usize>(), "[a-z ]{1,12}").prop_map(|(i, t)| Op::Done(i, t)),
        2 => any::<usize>().prop_map(Op::Delete),
        1 => Just(Op::Restore),
    ]
}

fn seeded_store(dir: &Path) -> (PathBuf, AllowedDocuments) {
    let doc = dir.join("notes.md");
    std::fs::write(&doc, "one\ntwo\nthree\nfour\nfive\n").unwrap();
    let store = json!({
        "format": 3, "revision": 4, "nextId": 3, "x-store": { "keep": [1, 2] },
        "reviews": [
            { "id": "r1", "file": "notes.md", "kind": "markdown", "at": { "line": 1, "x-at": true },
              "quote": "one", "comment": "", "action": "polish", "status": "open", "resolution": "",
              "color": 1, "x-review": "r1 extra" },
            { "id": "r2", "file": "notes.md", "kind": "markdown", "at": { "line": 2 },
              "quote": "two", "comment": "why", "action": "check", "status": "applied",
              "resolution": "checked", "color": 2, "x-review": "r2 extra" },
        ],
    });
    std::fs::write(dir.join("notes_review.json"), store.to_string()).unwrap();
    let mut allowed = AllowedDocuments::default();
    let canonical = std::fs::canonicalize(&doc).unwrap();
    allowed.insert(canonical.clone()).unwrap();
    (canonical, allowed)
}

fn new_review(action: &str, line: u32, comment: &str) -> Review {
    serde_json::from_value(json!({
        "file": "notes.md", "kind": "markdown", "at": { "line": line }, "quote": "two",
        "comment": comment, "action": action, "status": "open",
        "requests": if action == "request" { vec!["ask:why"] } else { vec![] },
    }))
    .unwrap()
}

fn on_disk(dir: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(dir.join("notes_review.json")).unwrap()).unwrap()
}

fn number(id: &str) -> u64 {
    id.strip_prefix('r').and_then(|n| n.parse().ok()).unwrap()
}

proptest! {
    #![proptest_config(config(48))]

    #[test]
    fn review_store_writes_keep_their_invariants(ops in prop::collection::vec(op(), 1..28)) {
        let dir = std::env::temp_dir().join(format!(
            "pdf_next_props_{}_{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let (doc, allowed) = seeded_store(&dir);
        let document = doc.display().to_string();
        let bound = allowed.get(&doc).unwrap().clone();
        let mut issued: BTreeSet<String> = ["r1".into(), "r2".into()].into();
        let mut removed: Vec<Value> = Vec::new();
        let mut revision = 4;
        let mut next_id = 3;
        for op in ops {
            let before = on_disk(&dir);
            let reviews = before["reviews"].as_array().unwrap().clone();
            let pick = |i: usize| (!reviews.is_empty()).then(|| reviews[i % reviews.len()].clone());
            let id_of = |r: &Value| r["id"].as_str().unwrap().to_string();
            let result = match &op {
                Op::Add { action, line, comment } => write_review(&document, new_review(action, *line, comment), &allowed),
                Op::Comment(i, text) => match pick(*i) {
                    Some(r) => change_review_comment(&document, &id_of(&r), r["comment"].as_str().unwrap(), text, &allowed),
                    None => continue,
                },
                Op::Status(i, status) | Op::Action(i, status) => match pick(*i) {
                    Some(r) => {
                        let key = if matches!(op, Op::Status(..)) { "status" } else { "action" };
                        patch_review_record(&document, &id_of(&r), &json!({ key: status }), &json!({ key: r[key] }), &allowed, false)
                    }
                    None => continue,
                },
                Op::Done(i, text) => match pick(*i) {
                    Some(r) => mark_review_done(&bound, &id_of(&r), text, None),
                    None => continue,
                },
                Op::Delete(i) => match pick(*i) {
                    Some(r) => {
                        let done = remove_review_cas(&document, &id_of(&r), &r, &allowed);
                        if done.is_ok() {
                            removed.push(r);
                        }
                        done
                    }
                    None => continue,
                },
                Op::Restore => match removed.pop() {
                    Some(r) => restore_review_record(&document, serde_json::from_value(r).unwrap(), None, &allowed),
                    None => continue,
                },
            };
            let after = on_disk(&dir);
            let now = after["revision"].as_u64().unwrap();
            let next = after["nextId"].as_u64().unwrap();
            let ids: Vec<String> = after["reviews"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap().to_string()).collect();
            if let Err(error) = &result {
                prop_assert_eq!(&after, &before, "a refused {:?} ({}) wrote nothing", op, error);
                continue;
            }
            prop_assert!(now > revision, "revision {} -> {} after {:?}", revision, now, op);
            prop_assert!(next >= next_id, "nextId {} -> {} after {:?}", next_id, next, op);
            revision = now;
            next_id = next;
            prop_assert_eq!(ids.iter().collect::<BTreeSet<_>>().len(), ids.len(), "duplicate IDs {:?}", ids);
            prop_assert!(ids.iter().all(|id| number(id) < next), "an ID at or past nextId {}: {:?}", next, ids);
            if let Op::Add { .. } = op {
                let added = ids.iter().find(|id| !before["reviews"].as_array().unwrap().iter().any(|r| r["id"] == id.as_str())).unwrap();
                prop_assert!(!issued.contains(added), "{} was issued before", added);
                issued.insert(added.clone());
            }
            prop_assert!(ids.iter().all(|id| issued.contains(id)), "an ID nobody issued: {:?}", ids);
            prop_assert_eq!(&after["x-store"], &json!({ "keep": [1, 2] }), "store field lost");
            for r in after["reviews"].as_array().unwrap() {
                match r["id"].as_str().unwrap() {
                    "r1" => {
                        prop_assert_eq!(&r["x-review"], "r1 extra");
                        prop_assert_eq!(&r["at"]["x-at"], true);
                    }
                    "r2" => prop_assert_eq!(&r["x-review"], "r2 extra"),
                    _ => {}
                }
            }
            let view = std::fs::read_to_string(dir.join("notes_review.agent.txt")).unwrap();
            let mut lines = view.lines();
            // With no review left to name the file, the header names the stem.
            let header = format!(" rev {now}:");
            let first = lines.next().unwrap();
            prop_assert!(
                (first.starts_with("# notes.md ") || first.starts_with("# notes ")) && first.contains(&header),
                "{}",
                view
            );
            let listed: BTreeSet<&str> = lines.map(|line| line.split(' ').next().unwrap()).collect();
            let open: BTreeSet<&str> = after["reviews"].as_array().unwrap().iter().filter(|r| r["status"] == "open").map(|r| r["id"].as_str().unwrap()).collect();
            prop_assert_eq!(view.lines().count() - 1, open.len(), "one line per open item:\n{}", view);
            prop_assert_eq!(listed, open);
        }
        drop(allowed);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Pieces that try to get script past the renderer, mixed with Markdown.
const HOSTILE: &[&str] = &[
    "<script>alert(1)</script>",
    "<SCRIPT SRC=//x>",
    "<scr<script>ipt>",
    "</script>",
    "<img src=x onerror=alert(1)>",
    "<svg onload=alert(1)>",
    "<body onload=x>",
    "<a onmouseover=\"x\">",
    "<a href=\"javascript:alert(1)\">x</a>",
    "<a href=\"JaVaScRiPt:alert(1)\">",
    "<a href=\" javascript:x\">",
    "<a href=\"&#106;avascript:x\">",
    "<a href=\"java\tscript:x\">",
    "<a href='javascript&colon;x'>",
    "[x](javascript:alert(1))",
    "[x](JAVASCRIPT:alert(1))",
    "![x](javascript:alert(1))",
    "[x]: javascript:y\n\n[x]",
    "<iframe src=javascript:x>",
    "<object data=x>",
    "<embed src=x>",
    "<form action=javascript:x><button formaction=javascript:y>",
    "<math href=\"javascript:x\"><mi>x</mi></math>",
    "$\\href{javascript:alert(1)}{x}$",
    "$\\url{javascript:x}$",
    "$$\\eqref{x\" onclick=\"y}$$",
    "<style>*{x:y}</style>",
    "<div style=\"background:url(javascript:x)\">",
    "<input onfocus=x autofocus>",
    "<details open ontoggle=x>",
    "<p title=\"a\" onclick=\"b\">",
    "<x onclick=y>",
    "<a href=data:text/html,<script>x</script>>",
    "<base href=javascript:x>",
    "<meta http-equiv=refresh content=0;url=javascript:x>",
];
const MARKDOWN: &[&str] = &[
    "\n\n",
    "\n",
    " ",
    "# ",
    "* ",
    "> ",
    "```\n",
    "`",
    "$",
    "$$",
    "<",
    ">",
    "\"",
    "'",
    "=",
    "&",
    "[",
    "](",
    ")",
    "{width=50%}",
    "text",
    "on",
    "javascript",
    ":",
    "|a|b|\n|-|-|\n",
    "1. ",
    "**",
    "_",
    "<b>",
    "</b>",
    "<span>",
    "<a href=\"#x\">",
];

fn hostile_markdown() -> impl Strategy<Value = String> {
    let piece = prop_oneof![
        2 => prop::sample::select(HOSTILE).prop_map(str::to_string),
        3 => prop::sample::select(MARKDOWN).prop_map(str::to_string),
        1 => "[ -~]{0,8}",
    ];
    prop::collection::vec(piece, 1..30).prop_map(|pieces| pieces.concat())
}

/// Each tag's attributes as (name, value), read the way a browser reads them.
fn attributes(html: &str) -> Vec<(String, String)> {
    let bytes = html.as_bytes();
    let mut found = Vec::new();
    let mut at = 0;
    while let Some(open) = html[at..].find('<').map(|i| at + i) {
        at = open + 1;
        if !bytes.get(at).is_some_and(u8::is_ascii_alphabetic) {
            continue;
        }
        while at < bytes.len()
            && !bytes[at].is_ascii_whitespace()
            && bytes[at] != b'>'
            && bytes[at] != b'/'
        {
            at += 1;
        }
        loop {
            while at < bytes.len() && (bytes[at].is_ascii_whitespace() || bytes[at] == b'/') {
                at += 1;
            }
            if at >= bytes.len() || bytes[at] == b'>' {
                break;
            }
            let start = at;
            while at < bytes.len()
                && !bytes[at].is_ascii_whitespace()
                && !b"=>/".contains(&bytes[at])
            {
                at += 1;
            }
            let name = html[start..at].to_ascii_lowercase();
            let mut value = String::new();
            let mut eq = at;
            while eq < bytes.len() && bytes[eq].is_ascii_whitespace() {
                eq += 1;
            }
            if bytes.get(eq) == Some(&b'=') {
                at = eq + 1;
                while at < bytes.len() && bytes[at].is_ascii_whitespace() {
                    at += 1;
                }
                let quote = bytes.get(at).copied().filter(|q| *q == b'"' || *q == b'\'');
                let begin = at + usize::from(quote.is_some());
                let end = match quote {
                    Some(q) => html[begin..]
                        .find(q as char)
                        .map_or(html.len(), |i| begin + i),
                    None => html[begin..]
                        .find(|c: char| c.is_ascii_whitespace() || c == '>')
                        .map_or(html.len(), |i| begin + i),
                };
                value = html[begin..end].to_string();
                at = (end + usize::from(quote.is_some())).min(html.len());
            }
            found.push((name, value));
        }
    }
    found
}

/// An attribute value as the URL parser sees it: entities decoded, tabs,
/// newlines and leading spaces dropped, lower case.
fn as_url(value: &str) -> String {
    let mut decoded = String::new();
    let mut rest = value;
    while let Some(amp) = rest.find('&') {
        decoded.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let Some(semi) = rest.find(';').filter(|i| *i < 12) else {
            decoded.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..semi];
        let code = match entity.strip_prefix('#') {
            Some(hex) if hex.starts_with(['x', 'X']) => u32::from_str_radix(&hex[1..], 16).ok(),
            Some(dec) => dec.parse().ok(),
            None => match entity {
                "colon" => Some(58),
                "tab" => Some(9),
                "newline" => Some(10),
                "amp" => Some(38),
                "quot" => Some(34),
                "lt" => Some(60),
                "gt" => Some(62),
                _ => None,
            },
        };
        match code.and_then(char::from_u32) {
            Some(c) => decoded.push(c),
            None => decoded.push_str(&rest[..=semi]),
        }
        rest = &rest[semi + 1..];
    }
    decoded.push_str(rest);
    decoded
        .chars()
        .filter(|c| !c.is_ascii_control() && *c != ' ')
        .collect::<String>()
        .to_ascii_lowercase()
}

#[test]
fn the_attribute_reader_finds_what_a_browser_would() {
    let found = attributes(
        r#"<p title="a onclick=b" onclick='x'><a href = "&#106;ava&#x09;script&colon;y">"#,
    );
    let names: Vec<&str> = found.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(names, ["title", "onclick", "href"], "{found:?}");
    assert_eq!(as_url(&found[2].1), "javascript:y");
}

proptest! {
    #![proptest_config(config(400))]

    #[test]
    fn rendered_markdown_never_carries_script(source in hostile_markdown()) {
        let html = render_markdown(&source, Path::new("/nonexistent")).html;
        prop_assert!(!html.to_ascii_lowercase().contains("<script"), "{}\n=> {}", source, html);
        for tag in ["<iframe", "<object", "<embed", "<style", "<form", "<base", "<meta", "<svg"] {
            prop_assert!(!html.to_ascii_lowercase().contains(tag), "{} in {}\n=> {}", tag, source, html);
        }
        for (name, value) in attributes(&html) {
            prop_assert!(!name.starts_with("on"), "event handler {}={:?} from {}\n=> {}", name, value, source, html);
            prop_assert!(name != "style" || !as_url(&value).contains("url("), "style {:?} from {}", value, source);
            let url = as_url(&value);
            for scheme in ["javascript:", "vbscript:", "data:"] {
                prop_assert!(!url.starts_with(scheme), "{}={:?} from {}\n=> {}", name, value, source, html);
            }
        }
    }
}
