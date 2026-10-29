# AGENTS.md

How agents work on pdf-next. Read this before changing anything.

## Workflow

Carry every change through the whole chain without stopping to ask:

1. Work on a branch, never on `main`.
2. Open a pull request against `main`.
3. Merge it yourself when CI is green and nothing is left open.
4. Releases tag themselves (see below). Do not push tags.

## Releasing

A release is a pull request that bumps the version, in all three places:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml` (and the `pdf-next` entry in `src-tauri/Cargo.lock`)

### Tags are made by GitHub, not by you

Do not run `git tag` / `git push --tags`, and do not create tags or releases
through the API. Some agent environments refuse tag pushes outright, so the
tag is made on GitHub's side:

1. The version-bump PR is merged into `main`.
2. `.github/workflows/tag.yml` runs on that push. It checks that the three
   versions agree, and if `v<version>` does not exist yet it creates the tag
   with GitHub's own token.
3. A tag pushed with that token does not start other workflows, so `tag.yml`
   then starts `release.yml` on the new tag (`gh workflow run release.yml
   --ref v<version>`). `release.yml` builds Windows, macOS and Linux
   installers and publishes the release, then winget and apt follow.

A merge without a version change tags nothing, so ordinary PRs are safe.

If a release did not start (for example `tag.yml` failed on mismatched
versions), fix the versions in a new PR, or run the tag workflow again from
GitHub: Actions → Tag release → Run workflow on `main`, or

```sh
gh workflow run tag.yml -R machine-made/pdf-next --ref main
```

It is safe to run twice: an existing tag is left alone. To rebuild the release
of a tag that already exists, start `release.yml` on it directly:

```sh
gh workflow run release.yml -R machine-made/pdf-next --ref v<version>
```

### The changelog

Every release has a section in `CHANGELOG.md`, written in the same pull
request as the version bump. A version without one cannot be released:
`tools/check_frontend.mjs` fails in CI, `tag.yml` will not tag it, and
`release.yml` uses the section as the release notes.

The style is Claude Code's changelog: a `## <version>` heading with no date,
then flat bullets, one sentence each, starting with `Added`, `Fixed`,
`Improved`, `Changed` or `Removed`, or with a platform (`Windows:`, `macOS:`,
`Linux:`). Describe what a user sees, not the code. Newest version first.

```markdown
## 0.16.5

- Added a button to copy the review list
- Fixed the zoom menu forgetting its value after a reload
- Windows: fixed the installer asking twice for permission
```

### Choosing the next version

You choose the next version yourself; do not ask. Look at what changed since
the last tag (`git log v<last>..HEAD`) and pick one step from the current
version:

- **Patch** (0.16.3 → 0.16.4): fixes, small features, new options, docs,
  dependency updates. Most releases.
- **Minor** (0.16.4 → 0.17.0): a large new feature or a change in how people
  use the app, a new or changed review sidecar field that agents must learn,
  or a dropped feature.
- **Major** (0.x → 1.0.0): only when the maintainer asks for it.

When in doubt between two, take the smaller one. If the maintainer names a
version, use that. Say in the PR which bump you chose and why, in one line.

## Checks before merging

Run what CI runs:

```sh
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cd ..
node tools/check_frontend.mjs
```

CI also builds the app and runs `tools/smoke.mjs` on Windows, macOS and Linux.
A pull request is ready when:

- formatting, lint and tests pass, and CI is green on all three platforms;
- no review comment or nit is left open;
- the diff is lean, with few code comments;
- there is proof it works (a test, a check, or a run), not just "done".

When a change has a user-visible part, add a contract to
`tools/check_frontend.mjs` or a Rust test, and say in the PR how you checked it.

## Commits and pull requests

- Write commit messages that say what changed and why, in plain words.
- Do not put links to agent sessions, chat logs or other private context in
  commits, pull requests or code.
- Keep scratch files out of the repo: test screenshots, logs and temporary
  scripts go in a temp directory, not the working tree.

## Code

- The frontend is plain ES modules in `src/`, served as is (no bundler).
  Third-party code is vendored under `src/vendor/` with its licence and a
  `VERSION` file, and listed in the README's "What it is built with".
- The backend is Rust in `src-tauri/src/`. Every file the frontend may read is
  checked there; keep it that way.
- Review store rules for agents editing documents are in the README
  ("Review tasks for agents") and `docs/_review.json`.
