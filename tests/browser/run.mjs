// Run every browser test, each in its own process; exit non-zero if any fails.
//   node tests/browser/run.mjs [--coverage] [name ...]
// --coverage prints the line coverage of src/*.mjs over the run.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageReport, shots } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const coverage = args.includes('--coverage') ? mkdtempSync(join(tmpdir(), 'pdf-next-coverage-')) : null;
const wanted = args.filter((arg) => arg !== '--coverage').map((name) => name.replace(/\.mjs$/, ''));
const env = coverage ? { ...process.env, PDF_NEXT_COVERAGE: coverage } : process.env;
const tests = readdirSync(here)
  .filter((name) => name.endsWith('.mjs') && !['harness.mjs', 'run.mjs'].includes(name))
  .filter((name) => !wanted.length || wanted.includes(name.replace(/\.mjs$/, '')))
  .sort();
const failed = [];
for (const test of tests) {
  console.log(`\n# ${test}`);
  const started = Date.now();
  const { status } = spawnSync(process.execPath, [join(here, test)], { stdio: 'inherit', timeout: 180_000, env });
  console.log(`# ${test}: ${status === 0 ? 'pass' : 'FAIL'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (status !== 0) failed.push(test);
}
console.log(`\n${tests.length - failed.length}/${tests.length} browser test files passed${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
if (failed.length) console.log(`screenshots: ${shots}`);
if (coverage) {
  const rows = coverageReport(coverage);
  const total = rows.reduce((sum, row) => ({ lines: sum.lines + row.lines, covered: sum.covered + row.covered }), { lines: 0, covered: 0 });
  console.log('\nLine coverage of src/*.mjs:');
  for (const { file, lines, covered } of [...rows, { file: 'all', ...total }]) {
    console.log(`  ${file.padEnd(22)} ${String(covered).padStart(5)}/${String(lines).padEnd(5)} ${(100 * covered / lines).toFixed(1).padStart(5)}%`);
  }
  rmSync(coverage, { recursive: true, force: true });
}
process.exit(failed.length || !tests.length ? 1 : 0);
