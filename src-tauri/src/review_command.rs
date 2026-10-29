//! Headless review commands. This module is called before the viewer CLI
//! parser so review automation never creates a window.

use std::ffi::OsString;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use crate::review_directory::AllowedDocuments;
use serde_json::{json, Value};

const HELP: &str = "Usage:\n  pdf-next reviews brief <PDF|MD> [--since <revision>]\n  pdf-next reviews next <PDF|MD>\n  pdf-next reviews done <PDF|MD> rN <what you changed> [--built <command>]\n  pdf-next reviews ask <PDF|MD> rN <question>\n  pdf-next reviews add <MD> --line N [--end M] --quote <text> [--action A] [--request R]... [--comment <text>]\n  pdf-next reviews add <PDF> --page N [--end M] --quote <text> [--action A] [--request R]... [--comment <text>]\n  pdf-next reviews relocate <MD> [--expected-revision N] [--dry-run]\n  pdf-next reviews list <PDF|MD>\n  pdf-next reviews update <PDF|MD> --id rN --patch <JSONfile|-> --expected-revision N [--dry-run]\n  pdf-next reviews restore <PDF|MD> --record <JSONfile|-> --expected-revision N\n\nCommands:\n  brief      Print the short view: one line per open review (also in {stem}_review.agent.txt).\n             With --since, only the items changed after that store revision.\n  next       Print the first open review in reading order, with its Markdown source lines.\n  done       Mark one review applied, with what you changed. A PDF needs --built <command>.\n  ask        Ask the reader about an open review; it waits until the reader replies in the app.\n  add        File a review. --request takes a review card word such as ask:why (repeatable).\n  relocate   Find the open reviews of an edited Markdown file again and record their lines.\n  list       Print the document's review store as JSON.\n  update     Compare-and-patch one review using the sidecar revision.\n  restore    Put a removed review back under its own ID (the full record, as listed).\n\nOptions:\n  --id ID                    Stable review ID, for example r12.\n  --patch FILE               JSON object of allowed review fields; - reads stdin.\n  --record FILE              One complete review record, as `list` printed it; - reads stdin.\n  --expected-revision N      Sidecar revision read with the patch (required for update and restore).\n  --dry-run                  Validate and print the result without writing.\n  -h, --help                 Show this help.\n\nExamples:\n  pdf-next reviews brief notes.md\n  pdf-next reviews next notes.md\n  pdf-next reviews done notes.md r12 \"stated the ideal-gas assumption\"\n  pdf-next reviews done paper.pdf r3 \"split the long sentence\" --built \"latexmk -pdf paper.tex\"\n  pdf-next reviews ask notes.md r4 \"Which reference do you mean?\"\n  pdf-next reviews add notes.md --line 12 --quote \"the exit speed\" --request ask:why --request scope:paragraph\n  pdf-next reviews relocate notes.md\n  pdf-next reviews update paper.pdf --id r12 --patch patch.json --expected-revision 8\n\nAgent workflow: read the open items with `brief` or one at a time with `next`, fix each in the\nsource, and close it with `done` (or append \"<id> <what you changed>\" to {stem}_review.done). An Ask\n(why, how, more, example, source, derive) means the text is unclear: rewrite the text so it answers\nthe question, and say in the done note what you changed. When you cannot do an item without the\nreader, `ask` (or append \"<id> ? <question>\"); the reply comes back in that item's line.\nNever edit the JSON store yourself.\n\nFor a PDF: find the quote in the LaTeX entry point or its included files, edit the source, compile\nit, and mark the item done only after a successful build. Treat source hints as candidates;\nequation symbols need their context. For Markdown, `at` names the source lines; edit the .md.";
const MAX_PATCH_BYTES: usize = 16_000;
/// A whole record may be as large as the store allows one to be.
const MAX_RECORD_BYTES: usize = 64_000;

/// Handle `reviews` arguments. `None` leaves normal viewer arguments to the
/// existing CLI parser; `Some` is the process exit status for this command.
pub(crate) fn maybe_run<I>(arguments: I) -> Option<i32>
where
    I: IntoIterator<Item = OsString>,
{
    let args: Vec<OsString> = arguments.into_iter().collect();
    if args.first().is_none_or(|arg| arg != "reviews") {
        return None;
    }
    Some(match run(&args[1..]) {
        Ok(output) => {
            println!("{output}");
            0
        }
        Err(CliError::Usage(message)) => {
            eprintln!("pdf-next: {message}\n\n{HELP}");
            2
        }
        Err(CliError::Runtime(message)) => {
            eprintln!("pdf-next: {message}");
            1
        }
    })
}

#[derive(Debug)]
enum CliError {
    Usage(String),
    Runtime(String),
}

fn usage(message: impl Into<String>) -> CliError {
    CliError::Usage(message.into())
}

fn runtime(message: impl Into<String>) -> CliError {
    CliError::Runtime(message.into())
}

fn run(args: &[OsString]) -> Result<String, CliError> {
    if args.is_empty() || args.iter().any(|arg| arg == "--help" || arg == "-h") {
        return Ok(HELP.to_string());
    }
    let command = args[0]
        .to_str()
        .ok_or_else(|| usage("command name must be UTF-8"))?;
    match command {
        "list" => run_list(&args[1..]),
        "update" => run_update(&args[1..]),
        "restore" => run_restore(&args[1..]),
        "brief" => run_brief(&args[1..]),
        "next" => run_next(&args[1..]),
        "done" => run_done(&args[1..]),
        "ask" => run_ask(&args[1..]),
        "add" => run_add(&args[1..]),
        "relocate" => run_relocate(&args[1..]),
        other => Err(usage(format!("unknown reviews command `{other}`"))),
    }
}

fn document_path(arg: &OsString) -> Result<(String, AllowedDocuments), CliError> {
    let canonical = fs::canonicalize(Path::new(arg)).map_err(|error| runtime(error.to_string()))?;
    let metadata = fs::metadata(&canonical).map_err(|error| runtime(error.to_string()))?;
    if !metadata.is_file() {
        return Err(runtime("document is not a regular file"));
    }
    if !matches!(crate::kind_for(&canonical), "pdf" | "markdown") {
        return Err(runtime("reviews commands require a PDF or Markdown file"));
    }
    let document = canonical
        .to_str()
        .ok_or_else(|| runtime("document path must be UTF-8"))?
        .to_string();
    let mut allowed = AllowedDocuments::default();
    allowed.insert(canonical).map_err(runtime)?;
    Ok((document, allowed))
}

fn run_list(args: &[OsString]) -> Result<String, CliError> {
    if args.len() != 1 {
        return Err(usage("reviews list needs exactly one document path"));
    }
    let (document, allowed) = document_path(&args[0])?;
    apply_inbox(&document, &allowed)?;
    let store = crate::list_reviews(&document, &allowed).map_err(runtime)?;
    serde_json::to_string_pretty(&store).map_err(|error| runtime(error.to_string()))
}

fn run_update(args: &[OsString]) -> Result<String, CliError> {
    if args.is_empty() {
        return Err(usage("reviews update needs a document path"));
    }
    let (document, allowed) = document_path(&args[0])?;
    let mut id = None;
    let mut patch_path = None;
    let mut expected_revision = None;
    let mut dry_run = false;
    let mut rest = args[1..].iter();
    while let Some(option) = rest.next() {
        let name = option
            .to_str()
            .ok_or_else(|| usage("option name must be UTF-8"))?;
        match name {
            "--id" if id.is_none() => {
                id = Some(rest.next().ok_or_else(|| usage("--id needs a value"))?);
            }
            "--patch" if patch_path.is_none() => {
                patch_path = Some(rest.next().ok_or_else(|| usage("--patch needs a value"))?);
            }
            "--expected-revision" if expected_revision.is_none() => {
                let value = rest
                    .next()
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| usage("--expected-revision needs a non-negative integer"))?;
                expected_revision = Some(
                    value
                        .parse::<u64>()
                        .map_err(|_| usage("--expected-revision needs a non-negative integer"))?,
                );
            }
            "--dry-run" if !dry_run => dry_run = true,
            "--help" | "-h" => return Ok(HELP.to_string()),
            _ => return Err(usage(format!("unknown or repeated option `{name}`"))),
        }
    }
    let id = id
        .and_then(|value| value.to_str())
        .ok_or_else(|| usage("--id is required and must be UTF-8"))?;
    if !valid_id(id) {
        return Err(usage("--id must be an ID such as r12"));
    }
    let patch_path = patch_path.ok_or_else(|| usage("--patch is required"))?;
    let revision = expected_revision.ok_or_else(|| usage("--expected-revision is required"))?;
    let patch_text = read_patch(patch_path)?;
    let patch: Value = serde_json::from_str(&patch_text)
        .map_err(|error| usage(format!("invalid patch JSON: {error}")))?;
    if !patch.is_object() || patch.as_object().is_some_and(|object| object.is_empty()) {
        return Err(usage("patch must be a non-empty JSON object"));
    }
    let expected = json!({"$revision": revision});
    let store = crate::patch_review_record(&document, id, &patch, &expected, &allowed, dry_run)
        .map_err(runtime)?;
    serde_json::to_string_pretty(&store).map_err(|error| runtime(error.to_string()))
}

/// Lines waiting in `{stem}_review.done` are applied before any command reads
/// the store, so what it prints is current.
fn apply_inbox(document: &str, allowed: &AllowedDocuments) -> Result<(), CliError> {
    let admitted = crate::open_review_document(document, allowed).map_err(runtime)?;
    crate::apply_done_inbox(&admitted).map_err(runtime)?;
    Ok(())
}

fn number_option(value: Option<&OsString>, name: &str) -> Result<u64, CliError> {
    value
        .and_then(|value| value.to_str())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| usage(format!("{name} needs a non-negative integer")))
}

/// `reviews brief <doc> [--since N]`: the agent view, the same text as
/// `{stem}_review.agent.txt`, or only what changed after revision N.
fn run_brief(args: &[OsString]) -> Result<String, CliError> {
    let since = match args {
        [_] => None,
        [_, flag, value] if flag == "--since" => Some(number_option(Some(value), "--since")?),
        _ => {
            return Err(usage(
                "reviews brief needs one document path and optionally --since <revision>",
            ))
        }
    };
    let (document, allowed) = document_path(&args[0])?;
    apply_inbox(&document, &allowed)?;
    let admitted = crate::open_review_document(&document, &allowed).map_err(runtime)?;
    crate::review_brief(&admitted, since)
        .map(|view| view.trim_end().to_string())
        .map_err(runtime)
}

/// `reviews next <doc>`: the first open item, so an agent never reads the
/// whole list.
fn run_next(args: &[OsString]) -> Result<String, CliError> {
    if args.len() != 1 {
        return Err(usage("reviews next needs exactly one document path"));
    }
    let (document, allowed) = document_path(&args[0])?;
    apply_inbox(&document, &allowed)?;
    let admitted = crate::open_review_document(&document, &allowed).map_err(runtime)?;
    crate::review_next(&admitted)
        .map(|view| view.trim_end().to_string())
        .map_err(runtime)
}

/// The ID and free text of `done` and `ask`, plus `--built` for `done`.
fn id_and_text<'a>(
    args: &'a [OsString],
    command: &str,
    what: &str,
    built_allowed: bool,
) -> Result<(&'a str, String, Option<String>), CliError> {
    if args.len() < 3 {
        return Err(usage(format!(
            "reviews {command} needs a document, an ID and {what}"
        )));
    }
    let id = args[1]
        .to_str()
        .filter(|id| valid_id(id))
        .ok_or_else(|| usage("the ID must look like r12"))?;
    let mut words = Vec::new();
    let mut built = None;
    let mut rest = args[2..].iter();
    while let Some(arg) = rest.next() {
        let text = arg
            .to_str()
            .ok_or_else(|| usage("arguments must be UTF-8"))?;
        if text == "--built" && built_allowed {
            built = Some(
                rest.next()
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| usage("--built needs the build command"))?
                    .to_string(),
            );
        } else {
            words.push(text.to_string());
        }
    }
    let text = words.join(" ");
    if text.trim().is_empty() {
        return Err(usage(format!("say {what}")));
    }
    Ok((id, text, built))
}

fn open_count(store: &crate::ReviewFile) -> usize {
    store
        .reviews
        .iter()
        .filter(|review| review.status == "open")
        .count()
}

/// `reviews done <doc> <id> <what you changed…> [--built <command>]`.
fn run_done(args: &[OsString]) -> Result<String, CliError> {
    let (id, text, built) = id_and_text(args, "done", "what you changed", true)?;
    if text.len() > 4_000 {
        return Err(usage("what you changed is longer than 4 000 characters"));
    }
    let (document, allowed) = document_path(&args[0])?;
    apply_inbox(&document, &allowed)?;
    let admitted = crate::open_review_document(&document, &allowed).map_err(runtime)?;
    let store = crate::mark_review_done(&admitted, id, &text, built.as_deref()).map_err(runtime)?;
    Ok(format!("{id} applied; {} open", open_count(&store)))
}

/// `reviews ask <doc> <id> <question…>`.
fn run_ask(args: &[OsString]) -> Result<String, CliError> {
    let (id, text, _) = id_and_text(args, "ask", "the question", false)?;
    if text.len() > 2_000 {
        return Err(usage("the question is longer than 2 000 characters"));
    }
    let (document, allowed) = document_path(&args[0])?;
    apply_inbox(&document, &allowed)?;
    let admitted = crate::open_review_document(&document, &allowed).map_err(runtime)?;
    let store = crate::ask_review_question(&admitted, id, &text).map_err(runtime)?;
    Ok(format!(
        "{id} waits on the reader; {} open",
        open_count(&store)
    ))
}

/// `reviews add <doc> --line N [--end M] | --page N, --quote, --action,
/// --request…, --comment`: prints the new ID.
fn run_add(args: &[OsString]) -> Result<String, CliError> {
    if args.is_empty() {
        return Err(usage("reviews add needs a document path"));
    }
    let (document, allowed) = document_path(&args[0])?;
    let mut at = serde_json::Map::new();
    let mut quote = None;
    let mut action = None;
    let mut comment = String::new();
    let mut requests = Vec::new();
    let mut rest = args[1..].iter();
    while let Some(option) = rest.next() {
        let name = option
            .to_str()
            .ok_or_else(|| usage("option name must be UTF-8"))?;
        let mut text = || {
            rest.next()
                .and_then(|value| value.to_str())
                .map(str::to_string)
                .ok_or_else(|| usage(format!("{name} needs a value")))
        };
        match name {
            "--line" | "--page" | "--end" if !at.contains_key(&name[2..]) => {
                let value = number_option(Some(&OsString::from(text()?)), name)?;
                at.insert(name[2..].to_string(), json!(value));
            }
            "--quote" if quote.is_none() => quote = Some(text()?),
            "--action" if action.is_none() => action = Some(text()?),
            "--comment" if comment.is_empty() => comment = text()?,
            "--request" => requests.push(text()?),
            "--help" | "-h" => return Ok(HELP.to_string()),
            _ => return Err(usage(format!("unknown or repeated option `{name}`"))),
        }
    }
    let quote = quote
        .filter(|quote| !quote.trim().is_empty())
        .ok_or_else(|| usage("--quote is required: the text the review is about"))?;
    let action = action.unwrap_or_else(|| {
        if requests.is_empty() || !comment.is_empty() {
            "improve".into()
        } else {
            "request".into()
        }
    });
    let review = serde_json::from_value(json!({
        "at": at,
        "quote": quote,
        "comment": comment,
        "action": action,
        "requests": requests,
        "file": "",
        "kind": "",
    }))
    .map_err(|error| usage(error.to_string()))?;
    let (id, _) = crate::add_review_record(&document, review, &allowed).map_err(runtime)?;
    Ok(id)
}

/// `reviews relocate <doc.md> [--expected-revision N] [--dry-run]`.
fn run_relocate(args: &[OsString]) -> Result<String, CliError> {
    if args.is_empty() {
        return Err(usage("reviews relocate needs a Markdown document path"));
    }
    let (document, allowed) = document_path(&args[0])?;
    let mut expected_revision = None;
    let mut dry_run = false;
    let mut rest = args[1..].iter();
    while let Some(option) = rest.next() {
        let name = option
            .to_str()
            .ok_or_else(|| usage("option name must be UTF-8"))?;
        match name {
            "--expected-revision" if expected_revision.is_none() => {
                expected_revision = Some(number_option(rest.next(), name)?);
            }
            "--dry-run" if !dry_run => dry_run = true,
            "--help" | "-h" => return Ok(HELP.to_string()),
            _ => return Err(usage(format!("unknown or repeated option `{name}`"))),
        }
    }
    apply_inbox(&document, &allowed)?;
    let (report, store) = crate::relocate_reviews(&document, expected_revision, &allowed, dry_run)
        .map_err(runtime)?;
    let mut out = String::new();
    for (id, outcome) in &report {
        out.push_str(&match outcome {
            crate::Relocated::Moved { from, to } => format!("{id} moved {from} -> {to}\n"),
            crate::Relocated::Unchanged => format!("{id} unchanged\n"),
            crate::Relocated::NotFound => format!("{id} not found\n"),
        });
    }
    let moved = report
        .iter()
        .filter(|(_, outcome)| matches!(outcome, crate::Relocated::Moved { .. }))
        .count();
    out.push_str(&format!(
        "{moved} moved, revision {}{}",
        store.revision,
        if dry_run && moved > 0 {
            " (dry run)"
        } else {
            ""
        }
    ));
    Ok(out)
}

fn run_restore(args: &[OsString]) -> Result<String, CliError> {
    if args.is_empty() {
        return Err(usage("reviews restore needs a document path"));
    }
    let (document, allowed) = document_path(&args[0])?;
    let mut record_path = None;
    let mut expected_revision = None;
    let mut rest = args[1..].iter();
    while let Some(option) = rest.next() {
        let name = option
            .to_str()
            .ok_or_else(|| usage("option name must be UTF-8"))?;
        match name {
            "--record" if record_path.is_none() => {
                record_path = Some(rest.next().ok_or_else(|| usage("--record needs a value"))?);
            }
            "--expected-revision" if expected_revision.is_none() => {
                let value = rest
                    .next()
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| usage("--expected-revision needs a non-negative integer"))?;
                expected_revision = Some(
                    value
                        .parse::<u64>()
                        .map_err(|_| usage("--expected-revision needs a non-negative integer"))?,
                );
            }
            "--help" | "-h" => return Ok(HELP.to_string()),
            _ => return Err(usage(format!("unknown or repeated option `{name}`"))),
        }
    }
    let record_path = record_path.ok_or_else(|| usage("--record is required"))?;
    let revision = expected_revision.ok_or_else(|| usage("--expected-revision is required"))?;
    let record_text = read_json_input(record_path, MAX_RECORD_BYTES, "review record")?;
    let record = serde_json::from_str(&record_text)
        .map_err(|error| usage(format!("invalid review record JSON: {error}")))?;
    let store = crate::restore_review_record(&document, record, Some(revision), &allowed)
        .map_err(runtime)?;
    serde_json::to_string_pretty(&store).map_err(|error| runtime(error.to_string()))
}

fn read_patch(path: &OsString) -> Result<String, CliError> {
    read_json_input(path, MAX_PATCH_BYTES, "patch")
}

fn read_json_input(path: &OsString, limit: usize, what: &str) -> Result<String, CliError> {
    if path == "-" {
        return read_bounded(io::stdin().lock(), limit, what);
    }
    let file = fs::File::open(PathBuf::from(path)).map_err(|error| runtime(error.to_string()))?;
    read_bounded(file, limit, what)
}

fn read_bounded(input: impl Read, limit: usize, what: &str) -> Result<String, CliError> {
    let mut bytes = Vec::with_capacity(limit);
    input
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| runtime(error.to_string()))?;
    if bytes.len() > limit {
        return Err(usage(format!("{what} JSON exceeds {limit} bytes")));
    }
    String::from_utf8(bytes).map_err(|error| usage(error.to_string()))
}

pub(crate) fn valid_id(id: &str) -> bool {
    id.strip_prefix('r').is_some_and(|number| {
        !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
    })
}

#[cfg(test)]
mod tests {
    use super::{maybe_run, run, run_list, run_update, CliError, MAX_PATCH_BYTES};
    use std::ffi::OsString;
    use std::fs;

    fn arguments(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn help_is_consumed_before_viewer_argument_parsing() {
        assert_eq!(maybe_run(arguments(&["reviews", "--help"])), Some(0));
        assert_eq!(maybe_run(arguments(&["paper.pdf"])), None);
    }

    #[test]
    fn unsupported_commands_and_incomplete_updates_are_usage_errors() {
        assert!(matches!(
            run(&arguments(&["delete"])),
            Err(CliError::Usage(_))
        ));
        assert!(matches!(
            run(&arguments(&["update"])),
            Err(CliError::Usage(_))
        ));
    }

    #[test]
    fn list_and_update_use_the_sidecar_revision_cas() {
        let directory = tempfile::tempdir().unwrap();
        let pdf = directory.path().join("paper.pdf");
        let sidecar = directory.path().join("paper_review.json");
        let patch = directory.path().join("patch.json");
        fs::write(&pdf, b"%PDF-1.7\n").unwrap();
        fs::write(
            &sidecar,
            r#"{"format":3,"revision":8,"nextId":2,"document":{"pdf":"paper.pdf","project":"."},"reviews":[{"id":"r1","file":"paper.pdf","kind":"pdf","at":{"page":1},"quote":"selected text","comment":"","action":"improve","status":"open","resolution":"","color":1}]}"#,
        )
        .unwrap();
        let document = pdf.to_str().unwrap();
        let listed: serde_json::Value =
            serde_json::from_str(&run_list(&arguments(&[document])).unwrap()).unwrap();
        assert_eq!(listed["revision"], 8);
        assert_eq!(listed["reviews"][0]["id"], "r1");

        fs::write(&patch, r#"{"color":3}"#).unwrap();
        let updated: serde_json::Value = serde_json::from_str(
            &run_update(&arguments(&[
                document,
                "--id",
                "r1",
                "--patch",
                patch.to_str().unwrap(),
                "--expected-revision",
                "8",
            ]))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(updated["revision"], 9);
        assert_eq!(updated["reviews"][0]["color"], 3);

        fs::write(&patch, r#"{"color":4}"#).unwrap();
        let dry_run: serde_json::Value = serde_json::from_str(
            &run_update(&arguments(&[
                document,
                "--id",
                "r1",
                "--patch",
                patch.to_str().unwrap(),
                "--expected-revision",
                "9",
                "--dry-run",
            ]))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(dry_run["revision"], 9);
        assert_eq!(dry_run["reviews"][0]["color"], 4);

        let stale = run_update(&arguments(&[
            document,
            "--id",
            "r1",
            "--patch",
            patch.to_str().unwrap(),
            "--expected-revision",
            "8",
        ]));
        assert!(matches!(stale, Err(CliError::Runtime(message)) if message.contains("conflict")));
        fs::write(&patch, vec![b' '; MAX_PATCH_BYTES + 1]).unwrap();
        let oversized = run_update(&arguments(&[
            document,
            "--id",
            "r1",
            "--patch",
            patch.to_str().unwrap(),
            "--expected-revision",
            "9",
        ]));
        assert!(
            matches!(oversized, Err(CliError::Usage(message)) if message.contains("16000 bytes"))
        );
        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(sidecar).unwrap()).unwrap();
        assert_eq!(persisted["revision"], 9);
        assert_eq!(persisted["reviews"][0]["color"], 3);
    }

    #[test]
    fn list_and_update_work_on_a_markdown_document() {
        let directory = tempfile::tempdir().unwrap();
        let markdown = directory.path().join("notes.md");
        let sidecar = directory.path().join("notes_review.json");
        let patch = directory.path().join("patch.json");
        fs::write(&markdown, b"# Title\n\nselected text\n").unwrap();
        fs::write(
            &sidecar,
            r#"{"format":3,"revision":2,"nextId":2,"reviews":[{"id":"r1","file":"notes.md","kind":"markdown","at":{"line":3},"quote":"selected text","comment":"","action":"improve","status":"open","resolution":"","color":1}]}"#,
        )
        .unwrap();
        let document = markdown.to_str().unwrap();
        let listed: serde_json::Value =
            serde_json::from_str(&run_list(&arguments(&[document])).unwrap()).unwrap();
        assert_eq!(listed["revision"], 2);
        assert_eq!(listed["reviews"][0]["kind"], "markdown");

        fs::write(&patch, r#"{"status":"applied","resolution":"reworded"}"#).unwrap();
        let updated: serde_json::Value = serde_json::from_str(
            &run_update(&arguments(&[
                document,
                "--id",
                "r1",
                "--patch",
                patch.to_str().unwrap(),
                "--expected-revision",
                "2",
            ]))
            .unwrap(),
        )
        .unwrap();
        assert_eq!(updated["revision"], 3);
        assert_eq!(updated["reviews"][0]["status"], "applied");
    }

    #[test]
    fn the_agent_loop_runs_through_add_next_ask_done_and_relocate() {
        let directory = tempfile::tempdir().unwrap();
        let markdown = directory.path().join("notes.md");
        fs::write(
            &markdown,
            "# Title\n\nThe wake grows downstream of the body.\n",
        )
        .unwrap();
        let document = markdown.to_str().unwrap();
        let add = |extra: &[&str]| {
            let mut args = vec!["add", document];
            args.extend_from_slice(extra);
            run(&arguments(&args))
        };
        assert_eq!(
            add(&[
                "--line",
                "3",
                "--quote",
                "the wake grows",
                "--request",
                "ask:why",
                "--request",
                "scope:paragraph"
            ])
            .unwrap(),
            "r1"
        );
        assert!(
            matches!(add(&["--line", "3", "--quote", "x", "--request", "ask:vibes"]), Err(CliError::Runtime(m)) if m.contains("unknown request"))
        );
        assert!(matches!(add(&["--line", "3"]), Err(CliError::Usage(m)) if m.contains("--quote")));
        assert!(
            matches!(add(&["--page", "3", "--quote", "the wake"]), Err(CliError::Runtime(m)) if m.contains("at.line"))
        );
        let next = run(&arguments(&["next", document])).unwrap();
        assert!(
            next.contains(
                "r1 L3 make the text say why; scope: whole paragraph | \"the wake grows\""
            ),
            "{next}"
        );
        assert!(next.contains("rewrite it so it answers that"), "{next}");
        assert!(
            next.ends_with("3| The wake grows downstream of the body."),
            "{next}"
        );
        assert_eq!(
            run(&arguments(&["ask", document, "r1", "Why", "of", "what?"])).unwrap(),
            "r1 waits on the reader; 0 open"
        );
        assert_eq!(
            run(&arguments(&["next", document])).unwrap(),
            "# notes.md: nothing open, 1 waiting on the reader"
        );
        let brief = run(&arguments(&["brief", document, "--since", "0"])).unwrap();
        assert!(brief.contains("1 waiting on the reader (r1)"), "{brief}");
        assert!(matches!(
            run(&arguments(&["brief", document, "--since", "x"])),
            Err(CliError::Usage(_))
        ));
        add(&["--line", "3", "--quote", "downstream of the body"]).unwrap();
        fs::write(
            &markdown,
            "# Title\n\nA new line.\n\nThe wake grows downstream of the body.\n",
        )
        .unwrap();
        let relocated = run(&arguments(&["relocate", document])).unwrap();
        assert_eq!(
            relocated,
            "r1 moved L3 -> L5\nr2 moved L3 -> L5\n2 moved, revision 4"
        );
        assert_eq!(
            run(&arguments(&["done", document, "r2", "said", "where"])).unwrap(),
            "r2 applied; 0 open"
        );
    }

    #[test]
    fn other_document_kinds_are_refused() {
        let directory = tempfile::tempdir().unwrap();
        let text = directory.path().join("notes.txt");
        fs::write(&text, b"x").unwrap();
        let refused = run_list(&arguments(&[text.to_str().unwrap()]));
        assert!(
            matches!(refused, Err(CliError::Runtime(message)) if message.contains("PDF or Markdown"))
        );
    }
}
