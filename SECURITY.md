# Security policy

## Supported versions

Only the latest release gets security fixes. Update before you report: the app's update button,
`winget upgrade RicardoFrantz.pdf-next`, `brew upgrade --cask pdf-next` or `apt upgrade pdf-next`.

## Report a vulnerability

Report it privately at
https://github.com/machine-made/pdf-next/security/advisories/new.
Do not open a public issue.

Include:

- the pdf-next version and your operating system;
- the file that triggers the problem (PDF, Markdown, image or review sidecar), or a way to make one;
- what happens and what you expected.

You get an answer within 7 days. A confirmed problem is fixed in a new release, and the advisory is
published with credit to you unless you ask otherwise.

## Antivirus warnings

Windows builds are not code-signed, so Microsoft Defender or SmartScreen can warn about a new
release. Every Windows installer is scanned with Defender before the release is published. If your
antivirus flags a release, report it the same way and give the detection name and the file's SHA-256.
