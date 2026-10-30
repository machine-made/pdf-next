// Sets the notes of every published release to what tools/release_notes.mjs
// prints for its tag. A release whose version has no CHANGELOG.md section
// keeps its notes, and one that already matches is not touched. Only notes
// this tool wrote are rewritten (they end in its "## Download" list): the
// releases written by hand before 0.16.4 keep theirs.
// Usage: node tools/sync_release_notes.mjs [--dry-run]   (needs gh; GH_TOKEN in CI)
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.GITHUB_REPOSITORY || 'machine-made/pdf-next';
const dryRun = process.argv.includes('--dry-run');
const gh = (args, input) => execFileSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 << 20 });
const tidy = (text) => (text || '').replace(/\r\n/g, '\n').trimEnd();
const generated = (body) => /\n## Download\n\n- \*\*Windows\*\*: /.test(tidy(body));

const releases = gh(['api', '--paginate', `repos/${repo}/releases?per_page=100`,
  '--jq', '.[] | select(.draft | not) | {tag: .tag_name, body}'])
  .split('\n').filter(Boolean).map((line) => JSON.parse(line));
const latest = gh(['api', `repos/${repo}/releases/latest`, '--jq', '.tag_name']).trim();

const changed = [];
const without = [];
const kept = [];
for (const { tag, body } of releases) {
  if (!generated(body)) {
    kept.push(tag);
    continue;
  }
  const notes = spawnSync(process.execPath, ['tools/release_notes.mjs', tag], { cwd: root, encoding: 'utf8' });
  if (notes.status !== 0) {
    without.push(tag);
    continue;
  }
  if (tidy(body) === tidy(notes.stdout)) {
    continue;
  }
  changed.push(tag);
  console.log(`${dryRun ? 'would update' : 'updating'} ${tag}`);
  if (!dryRun) {
    // Editing an older release must not make it the one the update check offers.
    const keep = tag === latest ? [] : ['--latest=false'];
    gh(['release', 'edit', tag, '--repo', repo, '--notes-file', '-', ...keep], notes.stdout);
  }
}

console.log(`${releases.length} published releases: ${changed.length} ${dryRun ? 'would change' : 'changed'}, ` +
  `${releases.length - changed.length - without.length - kept.length} already match, ${without.length} have no CHANGELOG.md section` +
  (without.length ? ` (${without.join(', ')})` : '') + `, ${kept.length} have notes written by hand.`);
