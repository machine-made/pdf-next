# Code signing

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
[SignPath Foundation](https://signpath.org/).

The Windows application (`pdf-next.exe`), its setup program (`pdf-next_<version>_x64-setup.exe`)
and its installer (`pdf-next_<version>_x64_en-US.msi`) are signed. They are built by GitHub Actions
from this repository, from the tag of the release, by the workflow in
[`.github/workflows/release.yml`](../.github/workflows/release.yml), and nothing else is signed.

**Team roles**

- Committers and reviewers: [Ricardo Frantz](https://github.com/ricardofrantz). Changes are
  written with AI coding agents and reach `main` only through pull requests he reviews and merges.
- Approvers: [Ricardo Frantz](https://github.com/ricardofrantz) approves every signing request
  in SignPath, after the release build has passed its tests, its smoke test and a Defender scan.

**Privacy**

pdf-next sends nothing about you or your documents anywhere. Its one network request asks GitHub
for the latest version number. The details are in the [privacy policy](../PRIVACY.md).

---

## Setting it up (maintainer notes)

Signing stays off until the steps below are done; until then a release is built and published
exactly as before, unsigned.

1. **Apply.** At https://signpath.org/apply, apply for the project `machine-made/pdf-next` with your
   GitHub account. Answers for the form:
   - Project: pdf-next, a PDF, image and Markdown viewer that reloads when the file changes.
   - Repository: https://github.com/machine-made/pdf-next. Licence: MIT.
   - Downloads: https://github.com/machine-made/pdf-next/releases, winget `RicardoFrantz.pdf-next`.
   - Build: GitHub Actions on GitHub-hosted runners, from release tags.
   - Code signing policy: this page.
   - Third-party parts: Mozilla PDF.js (Apache-2.0); Rust crates under MIT or Apache-2.0;
     highlight.js (BSD-3-Clause); fonts under the SIL Open Font License and the GUST Font
     License. Ask SignPath whether the font licences need a note.
2. **Multi-factor authentication** on GitHub and on SignPath.
3. **In SignPath**, once approved: a project with the slug `pdf-next`; a signing policy
   `release-signing` that needs a manual approval; the GitHub.com trusted build system linked to the
   project; and two artifact configurations, pasted from
   [`.signpath/pdf-next-app.xml`](../.signpath/pdf-next-app.xml) as `pdf-next-app` and
   [`.signpath/pdf-next-installers.xml`](../.signpath/pdf-next-installers.xml) as
   `pdf-next-installers`. Install the SignPath GitHub App on the repository.
4. **In GitHub** (Settings → Secrets and variables → Actions): the secret `SIGNPATH_API_TOKEN` (a
   SignPath submitter token) and the variable `SIGNPATH_ORGANIZATION_ID`. The slugs above are the
   defaults; set `SIGNPATH_PROJECT_SLUG` or `SIGNPATH_SIGNING_POLICY_SLUG` only if yours differ.

## What a release then does

1. The bundle jobs build every platform into a draft release, run the tests and the smoke test,
   and scan the Windows files with Defender, as before.
2. The `sign-windows` job rebuilds the Windows binary and sends it to SignPath. Approve the request
   in SignPath (the job waits up to an hour).
3. It builds the setup program and the MSI around the signed binary and sends them for signing.
   Approve the second request.
4. It checks every signature, runs the smoke test and the Defender scan on the signed files, and
   replaces the Windows files in the draft.
5. Only then is the release published, and winget and the apt repository follow.

A refused or timed-out signature leaves the release a draft.

## Before publishing: Microsoft's file check

Signing lowers the chance of a Defender false positive a lot, but a new file can still be judged
by Defender's cloud model on users' machines. While the release is a draft, submit the setup
program at https://www.microsoft.com/wdsi/filesubmission, signed in as a *software developer*.
Say it is a new release of pdf-next to check before publishing, and give the release URL. If a
release is ever flagged, the same form, with "incorrectly detected" and the detection name, is
how the detection is removed.
