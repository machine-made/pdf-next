// Prints the release notes for a version: its section of CHANGELOG.md, then
// how to install. Exits 1 when CHANGELOG.md has no section for it, so a
// release never ships without a changelog entry. With --title, prints the
// release title instead: "pdf-next 0.18.0 · Quiet" when the minor version has
// a name in tools/release-names.json, otherwise "pdf-next v0.16.5".
// Usage: node tools/release_notes.mjs [version] [--title]   (default: package.json)
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const version = (args.find((arg) => !arg.startsWith('--')) || JSON.parse(readFileSync('package.json', 'utf8')).version).replace(/^v/, '');
if (args.includes('--title')) {
  const names = JSON.parse(readFileSync(new URL('./release-names.json', import.meta.url), 'utf8'));
  const name = names[version.split('.').slice(0, 2).join('.')];
  console.log(name ? `pdf-next ${version} · ${name}` : `pdf-next v${version}`);
  process.exit(0);
}
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const heading = `## ${version}\n`;
const start = changelog.indexOf(heading);
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" section.`);
  process.exit(1);
}
const rest = changelog.slice(start + heading.length);
const next = rest.search(/^## /m);
const section = (next < 0 ? rest : rest.slice(0, next)).trim();
if (!/^- /m.test(section)) {
  console.error(`CHANGELOG.md's "## ${version}" section has no entries.`);
  process.exit(1);
}

console.log(`${section}

## Download

- **Windows**: \`.exe\` installer, or \`winget install RicardoFrantz.pdf-next\`. If SmartScreen warns (an unsigned build), choose *More info → Run anyway*.
- **macOS**: universal \`.dmg\` (Intel and Apple Silicon), or \`brew install --cask machine-made/tap/pdf-next\`. Unsigned, so the first launch needs \`xattr -dr com.apple.quarantine /Applications/pdf-next.app\`.
- **Debian and Ubuntu**: \`apt install pdf-next\` once the repository at https://machine-made.github.io/pdf-next is added (see the README), or the \`.deb\` and \`.AppImage\` below.`);
