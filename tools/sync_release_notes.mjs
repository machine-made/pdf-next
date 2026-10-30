// Sets the notes of every published release to what tools/release_notes.mjs
// prints for its tag. A release whose version has no CHANGELOG.md section
// keeps its notes, and one that already matches is not touched. Only notes
// this tool wrote (they end in its "## Download" list) and the old
// download-only template are rewritten: notes written by hand keep theirs.
// Usage: node tools/sync_release_notes.mjs [--dry-run]   (needs gh; GH_TOKEN in CI)
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.GITHUB_REPOSITORY || 'machine-made/pdf-next';
const dryRun = process.argv.includes('--dry-run');
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 << 20 });
const tidy = (text) => (text || '').replace(/\r\n/g, '\n').trimEnd();
const generated = (body) => /\n## Download\n\n- \*\*Windows\*\*: /.test(tidy(body)) ||
  tidy(body).startsWith('Download the build for your system below.');

const releases = gh(['api', '--paginate', `repos/${repo}/releases?per_page=100`,
  '--jq', '.[] | select(.draft | not) | {tag: .tag_name, name, body}'])
  .split('\n').filter(Boolean).map((line) => JSON.parse(line));
const latest = gh(['api', `repos/${repo}/releases/latest`, '--jq', '.tag_name']).trim();

const changed = [];
const without = [];
const kept = [];
for (const { tag, name, body } of releases) {
  if (!generated(body)) {
    kept.push(tag);
    continue;
  }
  const notes = spawnSync(process.execPath, ['tools/release_notes.mjs', tag], { cwd: root, encoding: 'utf8' });
  if (notes.status !== 0) {
    without.push(tag);
    continue;
  }
  const title = spawnSync(process.execPath, ['tools/release_notes.mjs', tag, '--title'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (tidy(body) === tidy(notes.stdout) && name === title) {
    continue;
  }
  changed.push(tag);
  console.log(`${dryRun ? 'would update' : 'updating'} ${tag}${name === title ? '' : ` (title: ${title})`}`);
  if (!dryRun) {
    // Editing an older release must not make it the one the update check offers.
    const keep = tag === latest ? [] : ['--latest=false'];
    gh(['release', 'edit', tag, '--repo', repo, '--title', title, '--notes-file', '-', ...keep], notes.stdout);
  }
}

console.log(`${releases.length} published releases: ${changed.length} ${dryRun ? 'would change' : 'changed'}, ` +
  `${releases.length - changed.length - without.length - kept.length} already match, ${without.length} have no CHANGELOG.md section` +
  (without.length ? ` (${without.join(', ')})` : '') + `, ${kept.length} have notes written by hand.`);
